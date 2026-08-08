"use client";

import { useEffect, useState } from "react";
import { api, API_URL, copyViewOnlyLink, type SnapshotSummary } from "../lib/api";
import type { ColumnDef } from "@opencall/db/doc";

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
  const [codes, setCodes] = useState<{ id: string; joinCode: string | null; role: string; label: string | null }[]>([]);
  const [name, setName] = useState("");
  const reload = () => void api.joinCodes(rundownId).then(setCodes);
  useEffect(reload, [rundownId]);

  // The URL a code holder should be handed, by role.
  const urlFor = (code: string, role: string) => {
    const route = role === "caller" ? "show" : role === "editor" ? "edit" : "view";
    return `${window.location.origin}/${route}/${rundownId}?code=${code}`;
  };

  return (
    <div className="panel" style={panelStyle}>
      <strong>Join codes — enter on the landing page or open the copied URL. Caller → console, editor → edit, follower → view.</strong>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <button
          className="btn btn-sm btn-primary"
          title="Copies a URL that opens this rundown read-only — hand it to camera operators and crew"
          onClick={() =>
            void copyViewOnlyLink(rundownId).then((url) => {
              reload();
              window.alert(`View-only link copied:\n\n${url}\n\nAnyone with it can watch this rundown live.`);
            })
          }
        >
          Copy view-only link
        </button>
        <input
          className="input"
          placeholder="Who is this code for? (e.g. Sarah — Cam 2)"
          title="The name travels with the code — every screen shows who joined with it"
          value={name}
          onChange={(e) => setName(e.target.value)}
          style={{ minWidth: 220 }}
        />
        {(["follower", "editor", "caller"] as const).map((role) => (
          <button
            key={role}
            className="btn btn-sm"
            onClick={() =>
              void api.createJoinCode(rundownId, role, name.trim() || undefined).then(() => {
                setName("");
                reload();
              })
            }
          >
            + {role} code
          </button>
        ))}
      </div>
      <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 6 }}>
        {codes.map((c) => (
          <li key={c.id} style={{ display: "flex", gap: 10, alignItems: "baseline" }}>
            <code style={{ background: "var(--bg)", border: "1px solid var(--border-subtle)", padding: "3px 8px", borderRadius: 4, fontSize: "1rem", letterSpacing: "0.15em" }}>
              {c.joinCode}
            </code>
            <span style={{ color: "var(--text-2)", minWidth: 120 }}>{c.label ?? <span style={{ color: "var(--text-3)" }}>unnamed</span>}</span>
            <span style={{ color: "var(--text-3)" }}>{c.role}</span>
            {c.joinCode && (
              <button className="btn btn-sm" onClick={() => void navigator.clipboard.writeText(urlFor(c.joinCode!, c.role))}>
                Copy URL
              </button>
            )}
            <button
              className="btn btn-sm btn-ghost"
              style={{ color: "var(--over)" }}
              title="Revoke: this code stops working everywhere immediately"
              onClick={() => void api.revokeJoinCode(rundownId, c.id).then(reload)}
            >
              Revoke
            </button>
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

/**
 * In-place restore, armed two-click (no browser dialogs): replaces THIS
 * rundown's content with the snapshot. The server saves a "Before restore"
 * snapshot first and bumps the doc epoch, so every open screen reloads the
 * restored content and pre-restore edits can't leak back.
 */
function RestoreHereButton({ snapshotId }: { snapshotId: string }) {
  const [armed, setArmed] = useState(false);
  return (
    <button
      className={`btn btn-sm ${armed ? "btn-danger is-on" : ""}`}
      title="Replace this rundown's content with this version (a 'Before restore' snapshot is saved first)"
      onClick={() => {
        if (!armed) {
          setArmed(true);
          window.setTimeout(() => setArmed(false), 3500);
          return;
        }
        void api
          .restoreSnapshotInPlace(snapshotId)
          .then(() => window.location.reload())
          .catch((err) => window.alert(String(err)));
      }}
    >
      {armed ? "Replace current content?" : "Restore here"}
    </button>
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
          href={`${API_URL}/rundowns/${rundownId}/report?format=csv`}
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
            <RestoreHereButton snapshotId={s.id} />
            <button
              className="btn btn-sm"
              title="Copy this version into a NEW rundown, leaving the current one untouched"
              onClick={() =>
                void api
                  .restoreSnapshot(s.id)
                  .then(({ id }) => (window.location.href = `/show/${id}`))
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
