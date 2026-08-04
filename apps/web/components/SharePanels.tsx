"use client";

import { useEffect, useState } from "react";
import { api, type SnapshotSummary } from "../lib/api";
import type { ColumnDef } from "@open-showcaller/db/doc";

const panelStyle: React.CSSProperties = {
  margin: "0 0 12px",
  fontSize: "var(--fs-sm)",
  display: "flex",
  flexDirection: "column",
  gap: 10,
  maxWidth: 580,
};

export function GuestPassPanel({ rundownId, columns, onClose }: { rundownId: string; columns: ColumnDef[]; onClose: () => void }) {
  const richColumns = columns.filter((c) => c.kind === "richtext");
  const [visible, setVisible] = useState<Record<string, boolean>>(
    Object.fromEntries(richColumns.map((c) => [c.key, true])),
  );
  const [url, setUrl] = useState<string | null>(null);

  return (
    <div className="panel" style={panelStyle}>
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
          <code style={{ background: "var(--bg)", border: "1px solid var(--border-subtle)", padding: "4px 8px", borderRadius: 4, overflowWrap: "anywhere" }}>{url}</code>
          <button className="btn btn-sm" onClick={() => void navigator.clipboard.writeText(url)}>
            Copy
          </button>
          <a className="btn btn-sm" href={url} target="_blank" rel="noreferrer" style={{ textDecoration: "none" }}>
            Open
          </a>
        </div>
      ) : (
        <div>
          <button
            className="btn btn-sm"
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
      <button className="btn btn-sm" style={{ alignSelf: "flex-start" }} onClick={onClose}>
        Close
      </button>
    </div>
  );
}

export function JoinCodesPanel({ rundownId, onClose }: { rundownId: string; onClose: () => void }) {
  const [codes, setCodes] = useState<{ joinCode: string | null; role: string }[]>([]);
  const reload = () => void api.joinCodes(rundownId).then(setCodes);
  useEffect(reload, [rundownId]);

  const companionUrl = (code: string) => `${window.location.origin}/follow/${rundownId}?code=${code}`;

  return (
    <div className="panel" style={panelStyle}>
      <strong>Join codes — crew devices enter with these (QR-able URLs)</strong>
      <div style={{ display: "flex", gap: 8 }}>
        {(["follower", "caller"] as const).map((role) => (
          <button key={role} className="btn btn-sm" onClick={() => void api.createJoinCode(rundownId, role).then(reload)}>
            + {role} code
          </button>
        ))}
      </div>
      <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 6 }}>
        {codes.map((c) => (
          <li key={c.joinCode} style={{ display: "flex", gap: 10, alignItems: "baseline" }}>
            <code style={{ background: "var(--bg)", border: "1px solid var(--border-subtle)", padding: "3px 8px", borderRadius: 4, fontSize: "1rem", letterSpacing: "0.15em" }}>
              {c.joinCode}
            </code>
            <span style={{ color: "var(--text-3)" }}>{c.role}</span>
            {c.joinCode && (
              <button className="btn btn-sm" onClick={() => void navigator.clipboard.writeText(companionUrl(c.joinCode!))}>
                Copy follow URL
              </button>
            )}
          </li>
        ))}
      </ul>
      {codes.length === 0 && <span style={{ color: "var(--text-3)" }}>No codes yet.</span>}
      <button className="btn btn-sm" style={{ alignSelf: "flex-start" }} onClick={onClose}>
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
    <div className="panel" style={panelStyle}>
      <strong>Version history</strong>
      <div>
        <button
          className="btn btn-sm"
          onClick={() => {
            const label = window.prompt("Version label", "Manual save");
            if (label !== null) void api.createSnapshot(rundownId, label || undefined).then(reload);
          }}
        >
          Save version now
        </button>
      </div>
      <div>
        <a
          className="btn btn-sm"
          style={{ textDecoration: "none" }}
          href={`${process.env.NEXT_PUBLIC_SYNC_HTTP_URL ?? "http://localhost:8787"}/rundowns/${rundownId}/report?format=csv`}
          download
        >
          Download as-run report (CSV)
        </a>
      </div>
      {snapshots.length === 0 && <span style={{ color: "var(--text-3)" }}>No versions yet. One is saved automatically when a show starts.</span>}
      <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 6 }}>
        {snapshots.map((s) => (
          <li key={s.id} style={{ display: "flex", gap: 10, alignItems: "baseline" }}>
            <span style={{ flex: 1 }}>
              {s.label ?? "Untitled"}{" "}
              <span style={{ color: "var(--text-3)" }}>{new Date(s.createdAt).toLocaleString()}</span>
            </span>
            <button
              className="btn btn-sm"
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
      <button className="btn btn-sm" style={{ alignSelf: "flex-start" }} onClick={onClose}>
        Close
      </button>
    </div>
  );
}
