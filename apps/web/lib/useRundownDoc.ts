"use client";

import { useEffect, useState } from "react";
import * as Y from "yjs";
import { HocuspocusProvider } from "@hocuspocus/provider";
import { API_URL } from "./api";
import { resolveSyncUrl } from "./syncUrl";

const DOC_WS_URL = resolveSyncUrl(process.env.NEXT_PUBLIC_DOC_WS_URL, "ws://localhost:8787/doc");

/**
 * Shared rundown document connection; re-renders the consumer on every doc
 * update. `joinCode` (or the stored admin token) authenticates the connection
 * on locked-down servers; follower codes get a read-only doc.
 *
 * Connections are scoped to the rundown's DOC EPOCH (`<id>@<epoch>`). An
 * in-place restore bumps the epoch and kicks every client; on auth failure
 * the hook refetches the epoch and, if it moved, reconnects with a FRESH
 * Y.Doc — pre-restore state can never merge back.
 */
/** What the document connection is doing — surfaced in the diagnostics bar. */
export interface DocStatus {
  connected: boolean;
  synced: boolean;
  /** Last thing that happened, in words a person can read out of a screenshot. */
  phase: string;
  authFailed: boolean;
  attempts: number;
  epoch: number | null;
  url: string;
  /** Kind of credential sent — never the credential itself. */
  tokenKind: string;
  lastError: string | null;
  /**
   * Set once the server has refused for good. While this is null the screen is
   * still legitimately loading; once it is set, waiting will never help and the
   * surface must say what is wrong instead of spinning forever.
   */
  blocked: DocBlock | null;
}

/** A refusal the server explained, resolved against who the credential turned out to be. */
export interface DocBlock {
  reason: string;
  /** Plain words for whoever is holding the device. */
  title: string;
  detail: string;
  /** The fix that will actually work: sign in again, or ask for access. */
  action: "sign-in" | "reload" | "ask-for-access" | "none";
  /** Who the server says the credential belongs to — the missing half of the diagnosis. */
  identity: string | null;
}

/** Maps a server refusal onto something worth reading on a phone at a venue. */
function describeRefusal(reason: string, identity: string | null, signedIn: boolean): DocBlock {
  const known: Record<string, { title: string; detail: string; action: DocBlock["action"] }> = {
    "no-such-rundown": {
      title: "This run sheet no longer exists",
      detail: "It was deleted, or this link points at a different server.",
      action: "none",
    },
    "sheet-restored-reload": {
      title: "This run sheet was restored from a snapshot",
      detail: "Reload to pick up the restored version.",
      action: "reload",
    },
    "not-signed-in": {
      title: "You are not signed in on this device",
      detail: "Signing in on a computer does not sign in this phone or tablet — each device needs its own sign-in.",
      action: "sign-in",
    },
    "signin-not-recognised": {
      title: "This device's sign-in has expired",
      detail: "The saved sign-in is no longer valid — it expired, or was revoked. Signing in again fixes it.",
      action: "sign-in",
    },
    "no-access-for-this-account": {
      title: "This account cannot open this run sheet",
      detail: "The sign-in works, but it has not been given access to this event. Ask for access, or open the sheet with a join code.",
      action: "ask-for-access",
    },
  };
  // With no credential at all there is no identity worth reporting — saying
  // "not recognised" implies a sign-in that failed, which is a different story.
  const shown = reason === "not-signed-in" ? null : identity;
  const hit = known[reason];
  if (hit) return { reason, identity: shown, ...hit };
  // An unknown refusal still beats an endless spinner: name it and let the
  // screenshot carry the exact string back.
  return {
    reason,
    identity,
    title: "The server refused this connection",
    detail: `Reason: ${reason}.`,
    action: signedIn ? "ask-for-access" : "sign-in",
  };
}

export function useRundownDoc(
  rundownId: string,
  joinCode?: string,
): { doc: Y.Doc; connected: boolean; synced: boolean; status: DocStatus } {
  const [epoch, setEpoch] = useState<number | null>(null);
  const [doc, setDoc] = useState(() => new Y.Doc());
  const [connected, setConnected] = useState(false);
  // The socket opening is not the same as the CONTENT arriving: a long sheet
  // over a phone connection takes a moment, and until it lands the document
  // is legitimately empty. Surfaces use this to say "loading" rather than
  // claiming the rundown has no rows.
  const [synced, setSynced] = useState(false);
  const [phase, setPhase] = useState("starting");
  const [authFailed, setAuthFailed] = useState(false);
  const [attempts, setAttempts] = useState(0);
  const [lastError, setLastError] = useState<string | null>(null);
  const [tokenKind, setTokenKind] = useState("none");
  const [blocked, setBlocked] = useState<DocBlock | null>(null);
  const [, setTick] = useState(0);

  const fetchEpoch = (id: string): Promise<number> =>
    fetch(`${API_URL}/rundowns/${id}/epoch`)
      .then((r) => {
        if (!r.ok) throw new Error(`epoch HTTP ${r.status}`);
        return r.json() as Promise<{ epoch?: number }>;
      })
      .then((b) => b.epoch ?? 0)
      .catch((err) => {
        // The API being unreachable is itself the diagnosis worth showing.
        setLastError(`epoch: ${String(err?.message ?? err)}`);
        return 0;
      });

  useEffect(() => {
    let cancelled = false;
    setPhase("fetching epoch");
    void fetchEpoch(rundownId).then((e) => {
      if (!cancelled) setEpoch(e);
    });
    return () => {
      cancelled = true;
    };
  }, [rundownId]);

  useEffect(() => {
    if (epoch == null) return;
    let cancelled = false;
    const fresh = new Y.Doc();
    setDoc(fresh);
    setSynced(false);
    setBlocked(null);
    const stored = localStorage.getItem("oc:admintoken");
    const token = joinCode ?? stored ?? "dev";
    // Only ever record the KIND of credential — a screenshot must never carry
    // the credential itself.
    setTokenKind(
      joinCode
        ? "join code"
        : !stored
          ? "none (dev)"
          : stored.startsWith("ses_")
            ? "session"
            : stored.startsWith("usr_")
              ? "personal"
              : stored.startsWith("co_")
                ? "company"
                : "admin",
    );
    setPhase("connecting");
    setAttempts((n) => n + 1);
    let concluded = false;
    const provider = new HocuspocusProvider({
      url: DOC_WS_URL,
      name: `${rundownId}@${epoch}`,
      document: fresh,
      token,
      onConnect: () => {
        setConnected(true);
        setPhase("connected, waiting for content");
      },
      onSynced: () => {
        setSynced(true);
        setPhase("synced");
      },
      onDisconnect: () => {
        setConnected(false);
        setPhase("disconnected, retrying");
      },
      onClose: ({ event }: { event: { code?: number; reason?: string } }) => {
        if (event?.code && event.code !== 1000) {
          setLastError(`socket closed ${event.code}${event.reason ? ` ${event.reason}` : ""}`);
        }
      },
      onAuthenticationFailed: ({ reason }: { reason?: string }) => {
        setAuthFailed(true);
        setPhase("authentication refused");
        setLastError(`auth refused${reason ? `: ${reason}` : ""}`);
        // The provider retries forever. Diagnosing the same refusal on every
        // attempt would put a steady stream of requests on the server from a
        // screen that is going nowhere, so conclude it once.
        if (concluded) return;
        concluded = true;
        // Possibly a stale epoch after an in-place restore — follow it. If the
        // epoch has NOT moved the refusal is final: this used to fall through
        // to nothing at all, leaving the screen loading forever with no hint of
        // why, which is exactly the failure a crew member cannot report.
        void fetchEpoch(rundownId).then(async (current) => {
          if (cancelled) return;
          if (current !== epoch) {
            concluded = false; // a moved epoch is a fresh start, not a refusal
            setEpoch(current);
            return;
          }
          // Nothing about this will change by asking again: stop reconnecting
          // so the device isn't retrying a hopeless socket for the rest of the
          // show. "Try again" and sign-in both reload the page.
          provider.disconnect();
          // Ask the server who this credential belongs to. That single answer
          // separates "your sign-in died" from "your account lacks access" —
          // the two causes look identical from inside the socket.
          let identity: string | null = null;
          let signedIn = false;
          try {
            const res = await fetch(`${API_URL}/me`, { headers: { authorization: `Bearer ${token}` } });
            if (res.ok) {
              const me = (await res.json()) as { role?: string | null; name?: string; teamName?: string };
              if (me.role) {
                signedIn = true;
                identity = me.name ?? me.teamName ?? me.role;
              } else {
                identity = "not recognised by the server";
              }
            }
          } catch {
            identity = null;
          }
          if (!cancelled) setBlocked(describeRefusal(reason ?? "permission-denied", identity, signedIn));
        });
      },
    });
    const bump = () => setTick((n) => n + 1);
    fresh.on("update", bump);
    return () => {
      cancelled = true;
      fresh.off("update", bump);
      provider.destroy();
    };
  }, [rundownId, joinCode, epoch]);

  return {
    doc,
    connected,
    synced,
    status: { connected, synced, phase, authFailed, attempts, epoch, url: DOC_WS_URL, tokenKind, lastError, blocked },
  };
}

/** Keeps the screen awake while the surface is visible (companion surfaces in show use). */
export function useWakeLock(): void {
  useEffect(() => {
    type WakeLockSentinel = { release: () => Promise<void> };
    let lock: WakeLockSentinel | null = null;
    const nav = navigator as Navigator & { wakeLock?: { request: (t: "screen") => Promise<WakeLockSentinel> } };
    const acquire = () => nav.wakeLock?.request("screen").then((l) => (lock = l)).catch(() => undefined);
    void acquire();
    const onVisible = () => {
      if (document.visibilityState === "visible") void acquire();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      void lock?.release();
    };
  }, []);
}
