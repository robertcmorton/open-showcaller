"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api, getAdminToken, setAdminToken } from "../lib/api";

const ROUTE_BY_ROLE = { caller: "show", editor: "edit", follower: "view" } as const;

/** Personal/company/admin access tokens are pasted here too — they start with a known prefix. */
const looksLikeAccessToken = (v: string): boolean => /^(usr_|co_|oc_)/i.test(v);

/**
 * Landing: crew enter their join code and land on the screen their role
 * allows — Showcaller (full console), Edit (content only), or View
 * (read-only). Access tokens (personal, company, admin) work here too and
 * lead to the dashboard. Admins head to /admin.
 */
export default function Landing() {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loginError, setLoginError] = useState<string | null>(null);
  const [loginBusy, setLoginBusy] = useState(false);

  const submitLogin = (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password) return;
    setLoginBusy(true);
    setLoginError(null);
    api
      .login(email.trim(), password)
      .then(({ token }) => {
        setAdminToken(token);
        router.push("/admin");
      })
      .catch((err) => {
        setLoginError(
          err instanceof Error && err.message.includes("429")
            ? "Too many attempts — wait a minute and try again."
            : "Invalid email or password.",
        );
        setLoginBusy(false);
      });
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const raw = code.trim();
    if (!raw) return;
    setBusy(true);
    setError(null);

    if (looksLikeAccessToken(raw)) {
      // An access token, not a join code: sign in with it (tokens are
      // case-sensitive — use exactly what was pasted) and head to the dashboard.
      const previous = getAdminToken();
      setAdminToken(raw);
      api
        .me()
        .then((me) => {
          if (me.role == null) {
            setAdminToken(previous);
            setError("That access token isn't valid (or has been rotated). Check with your admin.");
            setBusy(false);
            return;
          }
          router.push("/admin");
        })
        .catch(() => {
          setAdminToken(previous);
          setError("Couldn't verify that token — is the server reachable?");
          setBusy(false);
        });
      return;
    }

    const joinCode = raw.toUpperCase();
    api
      .resolveCode(joinCode)
      .then(({ role, rundownId }) => {
        router.push(`/${ROUTE_BY_ROLE[role]}/${rundownId}?code=${encodeURIComponent(joinCode)}`);
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
          <label className="field-label">Join a show — or sign in</label>
          <input
            className="input mono"
            autoFocus
            size={1}
            placeholder="Join code or access token"
            style={{
              width: "100%",
              minWidth: 0,
              fontSize: "1.05rem",
              letterSpacing: looksLikeAccessToken(code.trim()) ? "0.02em" : "0.15em",
              textTransform: looksLikeAccessToken(code.trim()) ? "none" : "uppercase",
            }}
            value={code}
            onChange={(e) => setCode(e.target.value)}
            maxLength={64}
          />
        </div>
        {error && <div style={{ color: "var(--over)", fontSize: "var(--fs-sm)" }}>{error}</div>}
        <button className="btn btn-primary" type="submit" disabled={busy || !code.trim()}>
          {busy ? "Checking…" : "Join"}
        </button>
        <p style={{ margin: 0, color: "var(--text-3)", fontSize: "var(--fs-xs)" }}>
          Your code decides what you can do: <strong>caller</strong> codes open the full console,{" "}
          <strong>editor</strong> codes open the editor without transport, <strong>crew</strong> codes open the
          read-only view. Personal, company, and admin tokens (<code>usr_…</code>, <code>co_…</code>) sign you in to
          the dashboard.
        </p>
      </form>

      <form onSubmit={submitLogin} className="panel" style={{ width: "min(420px, 92vw)", display: "grid", gap: 10 }}>
        <label className="field-label" style={{ margin: 0 }}>
          Sign in with an account
        </label>
        <input
          className="input"
          type="email"
          autoComplete="email"
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <input
          className="input"
          type="password"
          autoComplete="current-password"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        {loginError && <div style={{ color: "var(--over)", fontSize: "var(--fs-sm)" }}>{loginError}</div>}
        <button className="btn" type="submit" disabled={loginBusy || !email.trim() || !password}>
          {loginBusy ? "Signing in…" : "Sign in"}
        </button>
        <p style={{ margin: 0, color: "var(--text-3)", fontSize: "var(--fs-xs)" }}>
          Accounts are created by your admin. No password yet? Your personal access token works in the box above.
        </p>
      </form>

      <Link href="/admin" className="btn btn-ghost" style={{ textDecoration: "none" }}>
        Admin dashboard →
      </Link>
    </main>
  );
}
