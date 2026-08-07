"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError, type EventSummary } from "../../../lib/api";
import { WithSideNav } from "../../../components/SideNav";
import { AdminNavSection } from "../../../components/AdminNav";
import { UsersPanel } from "../../../components/UsersPanel";

/** Users & access on its own page (admin only). */
export default function AdminUsersPage() {
  const router = useRouter();
  const [me, setMe] = useState<{ role: string | null } | null>(null);
  const [events, setEvents] = useState<EventSummary[]>([]);
  const [companies, setCompanies] = useState<{ id: string; name: string }[]>([]);

  const reload = useCallback(() => {
    api
      .me()
      .then(setMe)
      .catch(() => setMe({ role: null }));
    api
      .events()
      .then(setEvents)
      .catch((err) => {
        // Not signed in (or not allowed) → the dashboard carries the sign-in gate.
        if (err instanceof ApiError && err.status === 401) router.replace("/admin");
      });
    api.companies().then(setCompanies).catch(() => setCompanies([]));
  }, [router]);
  useEffect(reload, [reload]);

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg)", color: "var(--text)" }}>
      <WithSideNav title="Users & access" settings={<AdminNavSection active="users" />}>
        <main className="admin-main">
          <header style={{ marginBottom: "1.25rem" }}>
            <h1 style={{ fontSize: "1.5rem", fontWeight: 700, letterSpacing: "-0.02em", margin: 0 }}>
              Users &amp; access
            </h1>
            <p style={{ color: "var(--text-2)", margin: "2px 0 0", fontSize: "var(--fs-sm)" }}>
              Who has control of what — accounts, passwords, and grants.
            </p>
          </header>
          {me != null && me.role !== "admin" ? (
            <div className="panel" style={{ color: "var(--text-2)" }}>
              Admins only — this page manages every account on the server.
            </div>
          ) : (
            <UsersPanel companies={companies} events={events} />
          )}
        </main>
      </WithSideNav>
    </div>
  );
}
