"use client";

import { useState } from "react";
import * as Y from "yjs";
import { ulid } from "ulid";
import { formatTimeOfDay, parseTimeLoose } from "@opencall/core";
import type { KeyTime } from "@opencall/db/doc";
import { useDismiss } from "./ui";

/**
 * Key times: labeled moments for the day (doors, soundcheck, on-air…), stored
 * in the doc and shown on every header and on print. The real-world run sheet
 * convention is a small KEY TIMES table above the grid.
 */
export function KeyTimesEditor({
  doc,
  keyTimes,
  use24h,
  canEdit,
}: {
  doc: Y.Doc;
  keyTimes: KeyTime[];
  use24h: boolean;
  canEdit: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState("");
  const [time, setTime] = useState("");
  const ref = useDismiss(open, () => setOpen(false));

  const yKeyTimes = doc.getArray<Y.Map<unknown>>("keyTimes");

  const add = () => {
    const sec = parseTimeLoose(time);
    if (!label.trim() || sec == null) return;
    doc.transact(() => {
      const kt = new Y.Map();
      kt.set("id", ulid());
      kt.set("label", label.trim());
      kt.set("sec", sec);
      yKeyTimes.push([kt]);
    });
    setLabel("");
    setTime("");
  };

  const remove = (id: string) => {
    doc.transact(() => {
      const idx = yKeyTimes.toArray().findIndex((kt) => kt.get("id") === id);
      if (idx >= 0) yKeyTimes.delete(idx, 1);
    });
  };

  const summary = keyTimes
    .slice(0, 3)
    .map((kt) => `${kt.label} ${formatTimeOfDay(kt.sec, use24h)}`)
    .join(" · ");

  return (
    <div ref={ref} style={{ position: "relative", display: "inline-flex" }}>
      <button
        type="button"
        className={`chip ${open ? "is-on" : ""}`}
        style={{ cursor: "pointer" }}
        title="Key times — doors, soundcheck, on-air…"
        onClick={() => setOpen((o) => !o)}
      >
        {summary || (canEdit ? "+ key times" : "key times")}
        {keyTimes.length > 3 && ` +${keyTimes.length - 3}`}
      </button>
      {open && (
        <div className="menu" style={{ top: "calc(100% + 5px)", left: 0, minWidth: 280, padding: 10 }}>
          <div className="menu-heading" style={{ padding: "0 0 6px" }}>
            Key times
          </div>
          {keyTimes.length === 0 && (
            <div style={{ color: "var(--text-3)", fontSize: "var(--fs-sm)", padding: "2px 0 8px" }}>
              None yet — doors, soundcheck, on-air…
            </div>
          )}
          {keyTimes.map((kt) => (
            <div key={kt.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "3px 0" }}>
              <span style={{ flex: 1 }}>{kt.label}</span>
              <span className="mono" style={{ color: "var(--text-2)" }}>
                {formatTimeOfDay(kt.sec, use24h)}
              </span>
              {canEdit && (
                <button className="btn btn-sm btn-ghost" onClick={() => remove(kt.id)}>
                  ✕
                </button>
              )}
            </div>
          ))}
          {canEdit && (
            <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
              <input
                className="input"
                placeholder="Label"
                style={{ flex: 1, minWidth: 90 }}
                value={label}
                onChange={(e) => setLabel(e.target.value)}
              />
              <input
                className="input mono"
                placeholder="4:30 pm"
                style={{ width: 90 }}
                value={time}
                onChange={(e) => setTime(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && add()}
              />
              <button className="btn btn-sm" onClick={add} disabled={!label.trim() || parseTimeLoose(time) == null}>
                Add
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
