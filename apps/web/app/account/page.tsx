"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "../../lib/api";

/** My account: who I am, what I can access, and my details. */
export default function AccountPage() {
  const [me, setMe] = useState<Awaited<ReturnType<typeof api.me>> | null>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [saved, setSaved] = useState<string | null>(null);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");

  useEffect(() => {
    void api.me().then((m) => {
      setMe(m);
      setName(m.name ?? "");
      setEmail(m.email ?? "");
    });
  }, []);

  if (!me) return <main style={{ padding: "4rem", textAlign: "center", color: "var(--text-3)" }}>Loading…</main>;

  const access =
    me.role === "admin"
      ? "Administrator — full access to every company, event, and show."
      : me.role === "company"
        ? `Company access for ${me.teamName ?? "your company"} — create events and views, run shows.`
        : me.role === "user"
          ? (me.grants ?? []).length > 0
            ? `Access: ${(me.grants ?? []).map((g) => g.kind).join(", ")}`
            : "No grants yet — ask your admin."
          : "Not signed in.";

  return (
    <main style={{ maxWidth: 560, margin: "6vh auto", padding: "0 1.2rem", display: "grid", gap: 14 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
        <h1 style={{ fontSize: "1.3rem", margin: 0 }}>My account</h1>
        <span style={{ flex: 1 }} />
        <Link href="/admin" style={{ color: "var(--accent-text)", fontSize: "var(--fs-sm)" }}>
          ← Dashboard
        </Link>
      </div>

      <div className="panel" style={{ display: "grid", gap: 6 }}>
        <strong>Who I am</strong>
        <div style={{ color: "var(--text-2)", fontSize: "var(--fs-sm)" }}>
          {me.role === "user" ? `${me.name}${me.email ? ` · ${me.email}` : ""}` : me.role === "company" ? me.teamName : me.role === "admin" ? "Server administrator" : "—"}
        </div>
        <div style={{ color: "var(--text-3)", fontSize: "var(--fs-sm)" }}>{access}</div>
      </div>

      {me.role === "user" ? (
        <>
          <form
            className="panel"
            style={{ display: "grid", gap: 10 }}
            onSubmit={(e) => {
              e.preventDefault();
              void api
                .updateMe({ name: name.trim() || undefined, email: email.trim() || undefined })
                .then(() => setSaved("Details saved."))
                .catch((err) => setSaved(String(err)));
            }}
          >
            <strong>My details</strong>
            <div>
              <label className="field-label">Name</label>
              <input className="input" value={name} onChange={(e) => setName(e.target.value)} style={{ width: "100%" }} />
            </div>
            <div>
              <label className="field-label">Email</label>
              <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} style={{ width: "100%" }} />
            </div>
            <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
              <button className="btn btn-primary" type="submit">
                Save details
              </button>
              {saved && <span style={{ color: "var(--text-2)", fontSize: "var(--fs-sm)" }}>{saved}</span>}
            </div>
          </form>

          <form
            className="panel"
            style={{ display: "grid", gap: 10 }}
            onSubmit={(e) => {
              e.preventDefault();
              if (next.length < 8) {
                window.alert("New password must be at least 8 characters.");
                return;
              }
              void api
                .changePassword(current, next)
                .then(() => {
                  setCurrent("");
                  setNext("");
                  window.alert("Password changed. Other signed-in devices were signed out.");
                })
                .catch((err) => window.alert(String(err)));
            }}
          >
            <strong>Change password</strong>
            <div>
              <label className="field-label">Current password</label>
              <input className="input" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} style={{ width: "100%" }} />
            </div>
            <div>
              <label className="field-label">New password (8+ characters)</label>
              <input className="input" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} style={{ width: "100%" }} />
            </div>
            <div>
              <button className="btn btn-primary" type="submit">
                Change password
              </button>
            </div>
          </form>
        </>
      ) : (
        <div className="panel" style={{ color: "var(--text-2)", fontSize: "var(--fs-sm)" }}>
          You're signed in with a {me.role === "admin" ? "server admin" : me.role === "company" ? "company" : ""} token —
          token sign-ins have no editable profile. Email accounts (created under Users &amp; access) can edit their name,
          email, and password here.
        </div>
      )}
    </main>
  );
}
