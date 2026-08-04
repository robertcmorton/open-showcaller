"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { api, csvToSeedRows, type EventSummary, type TemplateSummary } from "../lib/api";
import { Icon } from "../components/ui";

function CreateEventForm({ onCreated }: { onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [location, setLocation] = useState("");
  const today = new Date().toISOString().slice(0, 10);
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState(today);

  if (!open)
    return (
      <button className="btn btn-primary" onClick={() => setOpen(true)}>
        {Icon.plus} New event
      </button>
    );

  return (
    <form
      className="panel"
      style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end", margin: "0 0 4px" }}
      onSubmit={(e) => {
        e.preventDefault();
        if (!name.trim()) return;
        void api.createEvent({ name: name.trim(), location: location.trim() || undefined, startDate, endDate }).then(() => {
          setName("");
          setLocation("");
          setOpen(false);
          onCreated();
        });
      }}
    >
      <div>
        <label className="field-label">Event name</label>
        <input className="input" autoFocus placeholder="Launch Night" value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div>
        <label className="field-label">Location</label>
        <input className="input" placeholder="Main arena" value={location} onChange={(e) => setLocation(e.target.value)} />
      </div>
      <div>
        <label className="field-label">Starts</label>
        <input className="input" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
      </div>
      <div>
        <label className="field-label">Ends</label>
        <input className="input" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <button className="btn btn-primary" type="submit">
          Create event
        </button>
        <button className="btn btn-ghost" type="button" onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function CreateRundownForm({
  eventId,
  templates,
  onCreated,
}: {
  eventId: string;
  templates: TemplateSummary[];
  onCreated: () => void;
}) {
  const [name, setName] = useState("");
  const [templateId, setTemplateId] = useState("");
  const [csv, setCsv] = useState("");
  const [showCsv, setShowCsv] = useState(false);

  return (
    <form
      style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", padding: "10px 16px 14px" }}
      onSubmit={(e) => {
        e.preventDefault();
        if (!name.trim()) return;
        const body: Parameters<typeof api.createRundown>[0] = { eventId, name: name.trim() };
        if (templateId) body.templateId = templateId;
        else if (csv.trim()) {
          const { rows } = csvToSeedRows(csv);
          if (rows.length === 0) {
            window.alert("No rows found in CSV — need a header row with at least a Title column.");
            return;
          }
          body.rows = rows;
        }
        void api.createRundown(body).then(() => {
          setName("");
          setCsv("");
          setShowCsv(false);
          onCreated();
        });
      }}
    >
      <input className="input" placeholder="New rundown name" value={name} onChange={(e) => setName(e.target.value)} />
      <select className="input" value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
        <option value="">Blank</option>
        {templates.map((t) => (
          <option key={t.id} value={t.id}>
            From template: {t.name}
          </option>
        ))}
      </select>
      <button className={`btn ${showCsv ? "is-on" : ""}`} type="button" onClick={() => setShowCsv((s) => !s)}>
        Paste CSV
      </button>
      <button className="btn" type="submit">
        {Icon.plus} Rundown
      </button>
      {showCsv && (
        <textarea
          className="input"
          style={{ width: "100%", minHeight: 90, fontFamily: "var(--font-mono)" }}
          placeholder={"Paste CSV — e.g.\nTitle,Duration,Audio,Script\nWalk in,30m,,\nWelcome,1m30s,Lav 1,Good morning…"}
          value={csv}
          onChange={(e) => setCsv(e.target.value)}
        />
      )}
    </form>
  );
}

export default function Home() {
  const [events, setEvents] = useState<EventSummary[] | null>(null);
  const [templates, setTemplates] = useState<TemplateSummary[]>([]);
  const [error, setError] = useState(false);

  const reload = useCallback(() => {
    api.events().then(setEvents).catch(() => setError(true));
    api.templates().then(setTemplates).catch(() => undefined);
  }, []);
  useEffect(reload, [reload]);

  return (
    <div data-theme="light" style={{ minHeight: "100vh", background: "var(--bg)", color: "var(--text)" }}>
      <main style={{ maxWidth: 880, margin: "0 auto", padding: "3rem 1.5rem" }}>
        <header style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: "1.5rem" }}>
          <div style={{ flex: 1 }}>
            <h1 style={{ fontSize: "1.5rem", fontWeight: 700, letterSpacing: "-0.02em", margin: 0 }}>OpenCall</h1>
            <p style={{ color: "var(--text-2)", margin: "2px 0 0", fontSize: "var(--fs-sm)" }}>
              Rundowns, show calling, and companion screens for live events.
            </p>
          </div>
          <CreateEventForm onCreated={reload} />
        </header>

        {error && (
          <div className="panel" style={{ borderColor: "var(--over)", color: "var(--over)", marginBottom: 16 }}>
            Sync server not reachable — run <code>pnpm dev</code> (and <code>pnpm seed</code> first).
          </div>
        )}

        {events == null && !error && (
          <div style={{ display: "grid", gap: 12 }}>
            <div className="skeleton" style={{ height: 110 }} />
            <div className="skeleton" style={{ height: 110 }} />
          </div>
        )}

        <div style={{ display: "grid", gap: 14 }}>
          {events?.map((event) => (
            <section key={event.id} className="card">
              <div style={{ display: "flex", alignItems: "baseline", gap: 12, padding: "14px 16px 4px" }}>
                <h2 style={{ fontSize: "1.02rem", fontWeight: 650, margin: 0 }}>{event.name}</h2>
                <span style={{ color: "var(--text-3)", fontSize: "var(--fs-sm)" }}>
                  {event.location ? `${event.location} · ` : ""}
                  {event.startDate} → {event.endDate}
                </span>
              </div>
              <ul style={{ listStyle: "none", padding: "0 6px", margin: "6px 0 0" }}>
                {event.rundowns.map((r) => (
                  <li
                    key={r.id}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 12,
                      padding: "9px 10px",
                      borderTop: "1px solid var(--border-subtle)",
                    }}
                  >
                    <Link href={`/rundown/${r.id}`} style={{ color: "var(--text)", textDecoration: "none", flex: 1 }}>
                      <strong style={{ fontWeight: 600 }}>{r.name}</strong>
                      <span style={{ color: "var(--text-3)", marginLeft: 10, fontSize: "var(--fs-sm)" }}>
                        {r.description ?? ""} {r.showDate ? `· ${r.showDate}` : ""}
                      </span>
                    </Link>
                    {(["follow", "timer", "prompter"] as const).map((view) => (
                      <Link key={view} href={`/${view}/${r.id}`} className="chip" style={{ textDecoration: "none" }}>
                        {view}
                      </Link>
                    ))}
                  </li>
                ))}
                {event.rundowns.length === 0 && (
                  <li style={{ padding: "8px 10px", color: "var(--text-3)", fontSize: "var(--fs-sm)", borderTop: "1px solid var(--border-subtle)" }}>
                    No rundowns yet.
                  </li>
                )}
              </ul>
              <CreateRundownForm eventId={event.id} templates={templates} onCreated={reload} />
            </section>
          ))}
        </div>

        {events?.length === 0 && (
          <div className="empty card">
            <div className="glyph">◴</div>
            <div>No events yet — create your first event to get started.</div>
          </div>
        )}
      </main>
    </div>
  );
}
