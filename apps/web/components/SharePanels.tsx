"use client";

import { useEffect, useState } from "react";
import { api, type SnapshotSummary } from "../lib/api";
import type { ColumnDef } from "@open-showcaller/db/doc";

const panelStyle: React.CSSProperties = {
  background: "#161616",
  border: "1px solid #2a2a2a",
  borderRadius: 8,
  padding: "12px 14px",
  margin: "0 0 12px",
  fontSize: "0.82rem",
  display: "flex",
  flexDirection: "column",
  gap: 8,
  maxWidth: 560,
};

export function GuestPassPanel({ rundownId, columns, onClose }: { rundownId: string; columns: ColumnDef[]; onClose: () => void }) {
  const richColumns = columns.filter((c) => c.kind === "richtext");
  const [visible, setVisible] = useState<Record<string, boolean>>(
    Object.fromEntries(richColumns.map((c) => [c.key, true])),
  );
  const [url, setUrl] = useState<string | null>(null);

  return (
    <div style={panelStyle}>
      <strong>Guest pass — read-only link, column visibility per pass</strong>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        {richColumns.map((c) => (
          <label key={c.id} style={{ display: "flex", gap: 4, alignItems: "center" }}>
            <input
              type="checkbox"
              checked={visible[c.key] ?? true}
              onChange={(e) => setVisible((v) => ({ ...v, [c.key]: e.target.checked }))}
            />
            {c.title}
          </label>
        ))}
      </div>
      {url ? (
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <code style={{ background: "#0d0d0d", padding: "4px 8px", borderRadius: 4, overflowWrap: "anywhere" }}>{url}</code>
          <button className="toolbar-btn" onClick={() => void navigator.clipboard.writeText(url)}>
            Copy
          </button>
          <a className="toolbar-btn" href={url} target="_blank" rel="noreferrer" style={{ textDecoration: "none" }}>
            Open
          </a>
        </div>
      ) : (
        <div>
          <button
            className="toolbar-btn"
            onClick={() =>
              void api
                .createGuestPass({ rundownId, columns: visible })
                .then(({ token }) => setUrl(`${window.location.origin}/guest/${token}`))
            }
          >
            Create link
          </button>
        </div>
      )}
      <button className="toolbar-btn" style={{ alignSelf: "flex-start" }} onClick={onClose}>
        Close
      </button>
    </div>
  );
}

export function HistoryPanel({ rundownId, onClose }: { rundownId: string; onClose: () => void }) {
  const [snapshots, setSnapshots] = useState<SnapshotSummary[]>([]);
  const reload = () => void api.snapshots(rundownId).then(setSnapshots);
  useEffect(reload, [rundownId]);

  return (
    <div style={panelStyle}>
      <strong>Version history</strong>
      <div>
        <button
          className="toolbar-btn"
          onClick={() => {
            const label = window.prompt("Version label", "Manual save");
            if (label !== null) void api.createSnapshot(rundownId, label || undefined).then(reload);
          }}
        >
          Save version now
        </button>
      </div>
      {snapshots.length === 0 && <span style={{ color: "#8a8a8a" }}>No versions yet. One is saved automatically when a show starts.</span>}
      <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 6 }}>
        {snapshots.map((s) => (
          <li key={s.id} style={{ display: "flex", gap: 10, alignItems: "baseline" }}>
            <span style={{ flex: 1 }}>
              {s.label ?? "Untitled"}{" "}
              <span style={{ color: "#8a8a8a" }}>{new Date(s.createdAt).toLocaleString()}</span>
            </span>
            <button
              className="toolbar-btn"
              onClick={() =>
                void api
                  .restoreSnapshot(s.id)
                  .then(({ id }) => (window.location.href = `/rundown/${id}`))
              }
            >
              Restore as copy
            </button>
          </li>
        ))}
      </ul>
      <button className="toolbar-btn" style={{ alignSelf: "flex-start" }} onClick={onClose}>
        Close
      </button>
    </div>
  );
}
