"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "../lib/api";

interface ErrorRow {
  id: string;
  at: string;
  source: string;
  message: string;
  stack: string | null;
  url: string | null;
  userAgent: string | null;
}

const SOURCE_COLOR: Record<string, string> = {
  server: "var(--over)",
  process: "var(--over)",
  client: "var(--warn)",
};

/**
 * Admin-only error journal: everything that breaks — server, process, or any
 * visitor's browser — lands here for regular review and fixing.
 */
export function ErrorLogPanel({ onClose }: { onClose: () => void }) {
  const [rows, setRows] = useState<ErrorRow[] | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  const reload = useCallback(() => {
    api
      .errors()
      .then((r) => {
        setRows(r);
        setFailed(false);
      })
      .catch(() => setFailed(true));
  }, []);
  useEffect(reload, [reload]);

  return (
    <section className="card" style={{ marginBottom: 14, padding: "14px 16px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <h2 style={{ fontSize: "1.02rem", fontWeight: 650, margin: 0 }}>
          Error log{" "}
          <span style={{ color: "var(--text-3)", fontWeight: 400, fontSize: "var(--fs-sm)" }}>
            — server, process, and browser errors, newest first
          </span>
        </h2>
        <span style={{ flex: 1 }} />
        <button className="btn btn-sm" onClick={reload}>
          Refresh
        </button>
        <button
          className="btn btn-sm btn-danger"
          disabled={!rows || rows.length === 0}
          onClick={() => void api.clearErrors().then(reload)}
        >
          Clear log
        </button>
        <button className="btn btn-sm btn-ghost" onClick={onClose}>
          ✕
        </button>
      </div>

      {failed && (
        <p style={{ color: "var(--over)", fontSize: "var(--fs-sm)", margin: "10px 0 0" }}>
          Couldn’t load the error log — is the sync server reachable (and are you admin)?
        </p>
      )}
      {rows != null && rows.length === 0 && !failed && (
        <p style={{ color: "var(--text-3)", fontSize: "var(--fs-sm)", margin: "10px 0 0" }}>
          No errors recorded. Come back after the next show.
        </p>
      )}

      {rows != null && rows.length > 0 && (
        <ul style={{ listStyle: "none", margin: "10px 0 0", padding: 0, maxHeight: 420, overflowY: "auto" }}>
          {rows.map((r) => (
            <li key={r.id} style={{ borderTop: "1px solid var(--border-subtle)", padding: "7px 0" }}>
              <button
                type="button"
                onClick={() => setOpenId(openId === r.id ? null : r.id)}
                style={{
                  all: "unset",
                  cursor: "pointer",
                  display: "flex",
                  gap: 10,
                  alignItems: "baseline",
                  width: "100%",
                }}
              >
                <span className="mono" style={{ color: "var(--text-3)", fontSize: "var(--fs-xs)", whiteSpace: "nowrap" }}>
                  {new Date(r.at).toLocaleString()}
                </span>
                <span
                  className="chip"
                  style={{ color: SOURCE_COLOR[r.source] ?? "var(--text-2)", borderColor: SOURCE_COLOR[r.source] ?? "var(--border)" }}
                >
                  {r.source}
                </span>
                <span style={{ fontSize: "var(--fs-sm)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>
                  {r.message}
                </span>
              </button>
              {openId === r.id && (
                <div style={{ margin: "6px 0 2px", fontSize: "var(--fs-xs)", color: "var(--text-2)", display: "grid", gap: 4 }}>
                  {r.url && <div className="mono">{r.url}</div>}
                  {r.userAgent && <div style={{ color: "var(--text-3)" }}>{r.userAgent}</div>}
                  {r.stack && (
                    <pre className="mono" style={{ whiteSpace: "pre-wrap", margin: 0, maxHeight: 180, overflowY: "auto", background: "var(--bg-2)", padding: 8, borderRadius: 6 }}>
                      {r.stack}
                    </pre>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
