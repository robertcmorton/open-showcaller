"use client";

import { useCallback, useEffect, useState } from "react";
import { api, type EventSummary } from "../lib/api";
import { Icon } from "./ui";

interface GrantDraft {
  kind: "admin" | "company" | "event" | "view";
  targetId: string;
}

const KIND_LABEL: Record<string, string> = {
  admin: "Admin — everything",
  company: "Company — manage its events & below",
  event: "Event — manage one event",
  view: "View only — see one event",
};

/**
 * Users & access (admin only): the user database — who has control of what.
 * Each user gets a personal access token; grants decide their reach: admin,
 * a whole event company, a single event, or view-only access to an event.
 */
export function UsersPanel({
  companies,
  events,
}: {
  companies: { id: string; name: string }[];
  events: EventSummary[];
}) {
  const [users, setUsers] = useState<
    { id: string; name: string; email: string; accessToken: string | null; hasPassword: boolean; grants: { kind: string; targetId: string }[] }[]
  >([]);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [grants, setGrants] = useState<GrantDraft[]>([]);
  const [draftKind, setDraftKind] = useState<GrantDraft["kind"]>("view");
  const [draftTarget, setDraftTarget] = useState("");

  const reload = useCallback(() => {
    api.users().then(setUsers).catch(() => setUsers([]));
  }, []);
  useEffect(reload, [reload]);

  const targetName = (g: { kind: string; targetId: string }): string => {
    if (g.kind === "admin") return "everything";
    if (g.kind === "company") return companies.find((c) => c.id === g.targetId)?.name ?? "unknown company";
    return events.find((e) => e.id === g.targetId)?.name ?? "unknown event";
  };

  const addGrant = () => {
    if (draftKind !== "admin" && !draftTarget) return;
    setGrants((g) => [...g, { kind: draftKind, targetId: draftKind === "admin" ? "" : draftTarget }]);
    setDraftTarget("");
  };

  const create = () => {
    if (!name.trim() || grants.length === 0) return;
    if (password && password.length < 8) {
      window.alert("Password must be at least 8 characters (or leave it empty).");
      return;
    }
    void api
      .createUser({ name: name.trim(), email: email.trim() || undefined, password: password || undefined, grants })
      .then(({ accessToken }) => {
        window.alert(
          password
            ? `User created. They sign in with their email and password.\n\nBackup access token (share securely if needed):\n${accessToken}`
            : `User created. Their personal access token (share it securely):\n\n${accessToken}\n\nThey enter it on the sign-in page — or set a password so they can sign in with email.`,
        );
        setName("");
        setEmail("");
        setPassword("");
        setGrants([]);
        setCreating(false);
        reload();
      });
  };

  return (
    <section className="card" style={{ marginBottom: 14, padding: "14px 16px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <h2 style={{ fontSize: "1.02rem", fontWeight: 650, margin: 0, flex: 1 }}>
          Users & access{" "}
          <span style={{ color: "var(--text-3)", fontWeight: 400, fontSize: "var(--fs-sm)" }}>
            — who has control of what
          </span>
        </h2>
        <button className="btn btn-sm" onClick={() => setCreating((c) => !c)}>
          {Icon.plus} User
        </button>
      </div>

      {creating && (
        <div className="panel" style={{ margin: "10px 0", display: "grid", gap: 10 }}>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <input className="input" placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} />
            <input className="input" placeholder="Email (needed for password sign-in)" value={email} onChange={(e) => setEmail(e.target.value)} style={{ minWidth: 230 }} />
            <input
              className="input"
              type="password"
              placeholder="Password (optional, min 8)"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <select className="input" value={draftKind} onChange={(e) => setDraftKind(e.target.value as GrantDraft["kind"])}>
              {Object.entries(KIND_LABEL).map(([k, label]) => (
                <option key={k} value={k}>
                  {label}
                </option>
              ))}
            </select>
            {draftKind === "company" && (
              <select className="input" value={draftTarget} onChange={(e) => setDraftTarget(e.target.value)}>
                <option value="">Choose company…</option>
                {companies.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            )}
            {(draftKind === "event" || draftKind === "view") && (
              <select className="input" value={draftTarget} onChange={(e) => setDraftTarget(e.target.value)}>
                <option value="">Choose event…</option>
                {events.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name}
                  </option>
                ))}
              </select>
            )}
            <button className="btn btn-sm" onClick={addGrant} disabled={draftKind !== "admin" && !draftTarget}>
              Add access
            </button>
          </div>
          {grants.length > 0 && (
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {grants.map((g, i) => (
                <span key={i} className="chip">
                  {g.kind}: {targetName(g)}
                  <button
                    className="btn btn-sm btn-ghost"
                    style={{ height: 18, padding: "0 4px" }}
                    onClick={() => setGrants((all) => all.filter((_, j) => j !== i))}
                  >
                    ✕
                  </button>
                </span>
              ))}
            </div>
          )}
          <div>
            <button className="btn btn-primary btn-sm" onClick={create} disabled={!name.trim() || grants.length === 0}>
              Create user & issue token
            </button>
          </div>
        </div>
      )}

      <ul style={{ listStyle: "none", margin: "8px 0 0", padding: 0 }}>
        {users.map((u) => (
          <li
            key={u.id}
            style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 0", borderTop: "1px solid var(--border-subtle)", flexWrap: "wrap" }}
          >
            <strong style={{ minWidth: 140 }}>{u.name}</strong>
            <span style={{ color: "var(--text-3)", fontSize: "var(--fs-xs)" }}>{u.email}</span>
            <span className="chip" title={u.hasPassword ? "Signs in with email + password" : "Token-only — set a password to enable email sign-in"}>
              {u.hasPassword ? "password ✓" : "no password"}
            </span>
            <span style={{ flex: 1, display: "flex", gap: 4, flexWrap: "wrap" }}>
              {u.grants.map((g, i) => (
                <span key={i} className="chip">
                  {g.kind === "view" ? "view" : g.kind}: {targetName(g)}
                </span>
              ))}
              {u.grants.length === 0 && <span className="chip">no access</span>}
            </span>
            {u.accessToken && (
              <button className="btn btn-sm" onClick={() => void navigator.clipboard.writeText(u.accessToken!)}>
                Copy token
              </button>
            )}
            <button
              className="btn btn-sm btn-ghost"
              onClick={() =>
                void api.rotateUserToken(u.id).then(({ accessToken }) => {
                  window.alert(`New token for ${u.name} (the old one stops working):\n\n${accessToken}`);
                  reload();
                })
              }
            >
              Rotate
            </button>
            <button
              className="btn btn-sm btn-ghost"
              title={u.hasPassword ? "Reset this user's password (signs out their devices)" : "Set a password so they can sign in with email"}
              onClick={() => {
                const pw = window.prompt(`${u.hasPassword ? "New" : "Set"} password for ${u.name} (min 8 characters)`);
                if (!pw) return;
                void api
                  .setUserPassword(u.id, pw)
                  .then(() => {
                    window.alert(`Password ${u.hasPassword ? "reset" : "set"} for ${u.name}. Their other sessions were signed out.`);
                    reload();
                  })
                  .catch((err) => window.alert(String(err)));
              }}
            >
              {u.hasPassword ? "Reset password" : "Set password"}
            </button>
            <button className="btn btn-sm btn-danger" onClick={() => void api.deleteUser(u.id).then(reload)}>
              Delete
            </button>
          </li>
        ))}
        {users.length === 0 && (
          <li style={{ color: "var(--text-3)", fontSize: "var(--fs-sm)", padding: "6px 0" }}>
            No users yet — create one and hand them their personal access token.
          </li>
        )}
      </ul>
    </section>
  );
}
