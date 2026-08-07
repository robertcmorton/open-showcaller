"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "../../../lib/api";
import { WithSideNav } from "../../../components/SideNav";
import { AdminNavSection } from "../../../components/AdminNav";
import { ErrorLogPanel } from "../../../components/ErrorLogPanel";

/** The server error journal on its own page (admin only). */
export default function AdminErrorsPage() {
  const router = useRouter();
  const [me, setMe] = useState<{ role: string | null } | null>(null);

  useEffect(() => {
    api
      .me()
      .then((m) => {
        setMe(m);
        if (m.role == null) router.replace("/admin"); // sign-in gate lives there
      })
      .catch(() => router.replace("/admin"));
  }, [router]);

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg)", color: "var(--text)" }}>
      <WithSideNav title="Error log" settings={<AdminNavSection active="errors" />}>
        <main className="admin-main">
          <header style={{ marginBottom: "1.25rem" }}>
            <h1 style={{ fontSize: "1.5rem", fontWeight: 700, letterSpacing: "-0.02em", margin: 0 }}>Error log</h1>
            <p style={{ color: "var(--text-2)", margin: "2px 0 0", fontSize: "var(--fs-sm)" }}>
              Server, process, and browser errors — check regularly, fix what repeats.
            </p>
          </header>
          {me != null && me.role !== "admin" ? (
            <div className="panel" style={{ color: "var(--text-2)" }}>Admins only.</div>
          ) : (
            <ErrorLogPanel onClose={() => router.push("/admin")} />
          )}
        </main>
      </WithSideNav>
    </div>
  );
}
