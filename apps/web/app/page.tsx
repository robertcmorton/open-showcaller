"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { api, csvToSeedRows, type EventSummary, type TemplateSummary } from "../lib/api";
import "../components/editor.css";

const inputStyle: React.CSSProperties = {
  background: "#101010",
  color: "#eee",
  border: "1px solid #333",
  borderRadius: 6,
  padding: "6px 10px",
  font: "inherit",
  fontSize: "0.85rem",
};

function CreateEventForm({ onCreated }: { onCreated: () => void }) {
  const [name, setName] = useState("");
  const [location, setLocation] = useState("");
  const today = new Date().toISOString().slice(0, 10);
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState(today);

  return (
    <form
      style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", margin: "1rem 0" }}
      onSubmit={(e) => {
        e.preventDefault();
        if (!name.trim()) return;
        void api.createEvent({ name: name.trim(), location: location.trim() || undefined, startDate, endDate }).then(() => {
          setName("");
          setLocation("");
          onCreated();
        });
      }}
    >
      <input style={inputStyle} placeholder="Event name" value={name} onChange={(e) => setName(e.target.value)} />
      <input style={inputStyle} placeholder="Location" value={location} onChange={(e) => setLocation(e.target.value)} />
      <input style={inputStyle} type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
      <input style={inputStyle} type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
      <button className="toolbar-btn" type="submit">
        + Create event
      </button>
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
      style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-start", padding: "8px 0 4px" }}
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
      <input style={inputStyle} placeholder="New rundown name" value={name} onChange={(e) => setName(e.target.value)} />
      <select style={inputStyle} value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
        <option value="">Blank</option>
        {templates.map((t) => (
          <option key={t.id} value={t.id}>
            From template: {t.name}
          </option>
        ))}
      </select>
      <button className="toolbar-btn" type="button" onClick={() => setShowCsv((s) => !s)}>
        {showCsv ? "Hide CSV" : "Import CSV"}
      </button>
      <button className="toolbar-btn" type="submit">
        + Rundown
      </button>
      {showCsv && (
        <textarea
          style={{ ...inputStyle, width: "100%", minHeight: 90, fontFamily: "ui-monospace, monospace" }}
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
    <main style={{ maxWidth: 860, margin: "0 auto", padding: "3rem 1.5rem" }}>
      <h1 style={{ fontSize: "1.6rem", marginBottom: 4 }}>Open Showcaller</h1>
      <p style={{ color: "#9a9a9a", marginTop: 0 }}>Events</p>

      {error && (
        <p style={{ color: "#f85149" }}>
          Sync server not reachable — run <code>pnpm dev</code> (and <code>pnpm seed</code> first).
        </p>
      )}

      <CreateEventForm onCreated={reload} />

      {events?.map((event) => (
        <section key={event.id} style={{ borderTop: "1px solid #262626", padding: "1rem 0 0.6rem", marginTop: "0.6rem" }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
            <h2 style={{ fontSize: "1.05rem", margin: 0 }}>{event.name}</h2>
            <span style={{ color: "#8a8a8a", fontSize: "0.8rem" }}>
              {event.location ? `${event.location} · ` : ""}
              {event.startDate} → {event.endDate}
            </span>
          </div>
          <ul style={{ listStyle: "none", padding: 0, margin: "0.5rem 0 0" }}>
            {event.rundowns.map((r) => (
              <li key={r.id} style={{ display: "flex", alignItems: "baseline", gap: 12, padding: "8px 0", borderTop: "1px solid #1c1c1c" }}>
                <Link href={`/rundown/${r.id}`} style={{ color: "#e8e8e8", textDecoration: "none", flex: 1 }}>
                  <strong>{r.name}</strong>
                  <span style={{ color: "#8a8a8a", marginLeft: 10, fontSize: "0.82rem" }}>
                    {r.description ?? ""} {r.showDate ? `· ${r.showDate}` : ""}
                  </span>
                </Link>
                {(["follow", "timer", "prompter"] as const).map((view) => (
                  <Link key={view} href={`/${view}/${r.id}`} style={{ color: "#8ab4f8", fontSize: "0.78rem", textDecoration: "none" }}>
                    {view}
                  </Link>
                ))}
              </li>
            ))}
          </ul>
          <CreateRundownForm eventId={event.id} templates={templates} onCreated={reload} />
        </section>
      ))}
      {events?.length === 0 && <p style={{ color: "#9a9a9a" }}>No events yet — create one above.</p>}
    </main>
  );
}
