"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

const API_URL = process.env.NEXT_PUBLIC_SYNC_HTTP_URL ?? "http://localhost:8787";

interface RundownRow {
  id: string;
  name: string;
  description: string | null;
  showDate: string | null;
}

export default function Home() {
  const [rundowns, setRundowns] = useState<RundownRow[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    fetch(`${API_URL}/rundowns`)
      .then((res) => res.json())
      .then(setRundowns)
      .catch(() => setError(true));
  }, []);

  return (
    <main style={{ maxWidth: 720, margin: "0 auto", padding: "4rem 1.5rem" }}>
      <h1 style={{ fontSize: "1.6rem", marginBottom: 4 }}>Open Showcaller</h1>
      <p style={{ color: "#9a9a9a", marginTop: 0 }}>Phase 2 — collaborative rundown editor.</p>

      <h2 style={{ fontSize: "0.85rem", color: "#8a8a8a", textTransform: "uppercase", letterSpacing: "0.08em", marginTop: "2.5rem" }}>
        Rundowns
      </h2>
      {error && (
        <p style={{ color: "#f85149" }}>
          Sync server not reachable — run <code>pnpm dev</code> (and <code>pnpm seed</code> first).
        </p>
      )}
      {rundowns?.length === 0 && <p style={{ color: "#9a9a9a" }}>No rundowns yet — run <code>pnpm seed</code>.</p>}
      <ul style={{ listStyle: "none", padding: 0 }}>
        {rundowns?.map((r) => (
          <li key={r.id} style={{ borderTop: "1px solid #222" }}>
            <div style={{ display: "flex", alignItems: "baseline", padding: "12px 4px", gap: 12 }}>
              <Link href={`/rundown/${r.id}`} style={{ color: "#e8e8e8", textDecoration: "none", flex: 1 }}>
                <strong>{r.name}</strong>
                <span style={{ color: "#8a8a8a", marginLeft: 12, fontSize: "0.85rem" }}>
                  {r.description ?? ""} {r.showDate ? `· ${r.showDate}` : ""}
                </span>
              </Link>
              {(["follow", "timer", "prompter"] as const).map((view) => (
                <Link key={view} href={`/${view}/${r.id}`} style={{ color: "#8ab4f8", fontSize: "0.8rem", textDecoration: "none" }}>
                  {view}
                </Link>
              ))}
            </div>
          </li>
        ))}
      </ul>
    </main>
  );
}
