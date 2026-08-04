"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api } from "../lib/api";

const ROUTE_BY_ROLE = { caller: "show", editor: "edit", follower: "view" } as const;

/**
 * Landing: crew enter their join code and land on the screen their role
 * allows — Showcaller (full console), Edit (content only), or View
 * (read-only). Admins head to /admin.
 */
export default function Landing() {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = code.trim().toUpperCase();
    if (!trimmed) return;
    setBusy(true);
    setError(null);
    api
      .resolveCode(trimmed)
      .then(({ role, rundownId }) => {
        router.push(`/${ROUTE_BY_ROLE[role]}/${rundownId}?code=${encodeURIComponent(trimmed)}`);
      })
      .catch(() => {
        setError("That code isn't valid (or has been revoked). Check with your showcaller.");
        setBusy(false);
      });
  };

  return (
    <main
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 28,
        padding: "2rem 1.2rem",
      }}
    >
      <div style={{ textAlign: "center" }}>
        <h1 style={{ fontSize: "2rem", fontWeight: 750, letterSpacing: "-0.03em", margin: 0 }}>OpenCall</h1>
        <p style={{ color: "var(--text-2)", margin: "6px 0 0" }}>
          Rundowns, show calling, and companion screens for live events.
        </p>
      </div>

      <form onSubmit={submit} className="panel" style={{ width: "min(420px, 92vw)", display: "grid", gap: 12 }}>
        <div>
          <label className="field-label">Join a show</label>
          <input
            className="input mono"
            autoFocus
            placeholder="Enter your join code — e.g. 3YD8PJ"
            style={{ width: "100%", fontSize: "1.05rem", letterSpacing: "0.15em", textTransform: "uppercase" }}
            value={code}
            onChange={(e) => setCode(e.target.value)}
            maxLength={12}
          />
        </div>
        {error && <div style={{ color: "var(--over)", fontSize: "var(--fs-sm)" }}>{error}</div>}
        <button className="btn btn-primary" type="submit" disabled={busy || !code.trim()}>
          {busy ? "Checking…" : "Join"}
        </button>
        <p style={{ margin: 0, color: "var(--text-3)", fontSize: "var(--fs-xs)" }}>
          Your code decides what you can do: <strong>caller</strong> codes open the full console,{" "}
          <strong>editor</strong> codes open the editor without transport, <strong>crew</strong> codes open the
          read-only view.
        </p>
      </form>

      <Link href="/admin" className="btn btn-ghost" style={{ textDecoration: "none" }}>
        Admin dashboard →
      </Link>
    </main>
  );
}
