"use client";

import { useState } from "react";
import * as Y from "yjs";
import { ulid } from "ulid";
import type { ShowChannel } from "../lib/showChannel";
import type { EditorMode } from "./RundownEditor";
import { Icon } from "./ui";

interface PoolItem {
  id: string;
  title: string;
  note: string;
}

/**
 * Untimed cue pool: cues that live OUTSIDE the timeline (stings, chants,
 * filler) and are fired ad hoc during a live show. Firing logs a timestamped
 * "fire" entry into the as-run report without moving the active row.
 */
export function CuePool({ doc, mode, channel }: { doc: Y.Doc; mode: EditorMode; channel: ShowChannel }) {
  const [collapsed, setCollapsed] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);
  const canEdit = mode !== "view";
  const isLive = channel.show?.state === "running" || channel.show?.state === "paused";
  const canFire = mode === "show" && isLive;

  const yPool = doc.getArray<Y.Map<unknown>>("pool");
  const items: PoolItem[] = yPool.toArray().map((item) => ({
    id: item.get("id") as string,
    title: (item.get("title") as string | undefined) ?? "",
    note: (item.get("note") as string | undefined) ?? "",
  }));

  if (items.length === 0 && !canEdit) return null;

  const add = () => {
    const title = window.prompt("Pool cue title (e.g. Goal sting, Crowd chant)");
    if (!title?.trim()) return;
    doc.transact(() => {
      const item = new Y.Map();
      item.set("id", ulid());
      item.set("title", title.trim());
      item.set("note", "");
      yPool.push([item]);
    });
  };

  const setField = (id: string, field: "title" | "note", value: string) => {
    doc.transact(() => {
      yPool.toArray().find((item) => item.get("id") === id)?.set(field, value);
    });
  };

  const remove = (id: string) => {
    doc.transact(() => {
      const idx = yPool.toArray().findIndex((item) => item.get("id") === id);
      if (idx >= 0) yPool.delete(idx, 1);
    });
  };

  const fire = (item: PoolItem) => {
    channel.sendCmd("fire", `pool:${item.title}`);
    setFlash(item.id);
    window.setTimeout(() => setFlash(null), 900);
  };

  return (
    <section className="pool-section">
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <button className="btn btn-sm btn-ghost" onClick={() => setCollapsed((c) => !c)}>
          {collapsed ? "▸" : "▾"}
        </button>
        <strong style={{ flex: 1, fontSize: "var(--fs-sm)" }}>
          Cue pool <span style={{ color: "var(--text-3)", fontWeight: 400 }}>— untimed cues, fired ad hoc during the show</span>
        </strong>
        {canEdit && (
          <button className="btn btn-sm" onClick={add}>
            {Icon.plus} Pool cue
          </button>
        )}
      </div>
      {!collapsed &&
        items.map((item) => (
          <div key={item.id} className="pool-item">
            {canFire ? (
              <button
                className={`btn btn-sm ${flash === item.id ? "btn-positive" : "btn-primary"}`}
                title="Log this cue into the as-run report now"
                onClick={() => fire(item)}
              >
                {flash === item.id ? "✓ Fired" : "Fire"}
              </button>
            ) : (
              <span className="chip">pool</span>
            )}
            {canEdit ? (
              <>
                <input
                  className="input"
                  defaultValue={item.title}
                  style={{ fontWeight: 600, minWidth: 160 }}
                  onBlur={(e) => setField(item.id, "title", e.currentTarget.value)}
                />
                <input
                  className="input"
                  defaultValue={item.note}
                  placeholder="Notes"
                  style={{ flex: 1 }}
                  onBlur={(e) => setField(item.id, "note", e.currentTarget.value)}
                />
                <button className="btn btn-sm btn-ghost" onClick={() => remove(item.id)}>
                  ✕
                </button>
              </>
            ) : (
              <>
                <strong style={{ minWidth: 160 }}>{item.title}</strong>
                <span style={{ flex: 1, color: "var(--text-2)" }}>{item.note}</span>
              </>
            )}
          </div>
        ))}
      {!collapsed && items.length === 0 && (
        <div style={{ color: "var(--text-3)", fontSize: "var(--fs-sm)", padding: "6px 0 2px" }}>
          Empty — add stings, chants, and filler you might need at any moment.
        </div>
      )}
    </section>
  );
}
