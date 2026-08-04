"use client";

import { useEffect, useRef, useState } from "react";
import { ulid } from "ulid";
import {
  PROTOCOL_VERSION,
  type CmdAction,
  type Role,
  type ShowStatePayload,
} from "@opencall/protocol";

const SHOW_WS_URL = process.env.NEXT_PUBLIC_SYNC_WS_URL ?? "ws://localhost:8787";
const OFFSET_SAMPLES = 5;

export interface ShowChannel {
  connected: boolean;
  role: Role | null;
  /** IANA timezone of the event — governs every clock on this surface. */
  timezone: string | null;
  show: ShowStatePayload | null;
  /** Server clock now: Date.now() + measured offset. */
  serverNow: () => number;
  sendCmd: (action: CmdAction, rowId?: string) => void;
}

/**
 * Client for the PROTOCOL.md show channel: hello/welcome, NTP-style clock
 * offset (median of 5 pings, refreshed each connect), seq-guarded show_state,
 * jittered reconnect backoff, idempotent command ids.
 */
export function useShowChannel(rundownId: string, device: "console" | "companion", joinCode?: string): ShowChannel {
  const [connected, setConnected] = useState(false);
  const [role, setRole] = useState<Role | null>(null);
  const [timezone, setTimezone] = useState<string | null>(null);
  const [show, setShow] = useState<ShowStatePayload | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const offsetRef = useRef(0);
  const lastSeqRef = useRef(-1);

  useEffect(() => {
    let closed = false;
    let retryDelay = 500;
    let ws: WebSocket;

    const connect = () => {
      if (closed) return;
      ws = new WebSocket(`${SHOW_WS_URL}/?rundown=${encodeURIComponent(rundownId)}`);
      wsRef.current = ws;
      const pings: number[] = [];

      ws.onopen = () => {
        retryDelay = 500;
        // A join code always wins (it carries the role). Otherwise consoles
        // send the stored admin token as a session token — on dev-open
        // servers any session token maps to caller.
        const auth = joinCode
          ? { kind: "join" as const, code: joinCode.toUpperCase() }
          : device === "console"
            ? { kind: "session" as const, token: localStorage.getItem("oc:admintoken") ?? "dev" }
            : { kind: "join" as const, code: "DEV123" };
        ws.send(JSON.stringify({ v: PROTOCOL_VERSION, t: "hello", auth, device, lastSeq: lastSeqRef.current >= 0 ? lastSeqRef.current : undefined }));
      };

      ws.onmessage = (event) => {
        const msg = JSON.parse(String(event.data));
        if (msg.v !== PROTOCOL_VERSION) return;
        switch (msg.t) {
          case "welcome": {
            setConnected(true);
            setRole(msg.role);
            setTimezone(msg.timezone ?? null);
            lastSeqRef.current = msg.show.seq;
            setShow(msg.show);
            for (let i = 0; i < OFFSET_SAMPLES; i++)
              setTimeout(() => ws.readyState === WebSocket.OPEN && ws.send(JSON.stringify({ v: PROTOCOL_VERSION, t: "ping", t0: Date.now() })), i * 200);
            break;
          }
          case "pong": {
            const rtt = Date.now() - msg.t0;
            pings.push(msg.t1 + rtt / 2 - Date.now());
            if (pings.length >= 1) {
              const sorted = [...pings].sort((a, b) => a - b);
              offsetRef.current = sorted[Math.floor(sorted.length / 2)]!;
            }
            break;
          }
          case "show_state": {
            if (msg.seq <= lastSeqRef.current) break;
            lastSeqRef.current = msg.seq;
            const { v: _v, t: _t, ...payload } = msg;
            setShow(payload as ShowStatePayload);
            break;
          }
        }
      };

      ws.onclose = () => {
        setConnected(false);
        if (closed) return;
        setTimeout(connect, retryDelay + Math.random() * 250);
        retryDelay = Math.min(retryDelay * 2, 8000);
      };
    };

    connect();
    return () => {
      closed = true;
      ws?.close();
    };
  }, [rundownId, device, joinCode]);

  return {
    connected,
    role,
    timezone,
    show,
    serverNow: () => Date.now() + offsetRef.current,
    sendCmd: (action, rowId) => {
      const payload: Record<string, unknown> = { v: PROTOCOL_VERSION, t: "cmd", id: ulid(), action };
      if (rowId) payload.rowId = rowId;
      if (action === "stop") payload.confirm = true;
      wsRef.current?.send(JSON.stringify(payload));
    },
  };
}
