"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  api,
  ApiError,
  csvToSeedRows,
  getAdminToken,
  setAdminToken,
  type EventSummary,
  type TemplateSummary,
} from "../../lib/api";
import { Icon } from "../../components/ui";
import { ImportPanel } from "../../components/ImportPanel";
import { SideNavSection, WithSideNav } from "../../components/SideNav";

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
        void api.createEvent({ name: name.trim(), location: location.trim() || undefined, startDate, endDate, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone }).then(() => {
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

function TokenGate({ onUnlocked }: { onUnlocked: () => void }) {
  const [token, setToken] = useState("");
  return (
    <form
      className="panel"
      style={{ maxWidth: 420, margin: "10vh auto", display: "grid", gap: 12 }}
      onSubmit={(e) => {
        e.preventDefault();
        if (!token.trim()) return;
        setAdminToken(token.trim());
        onUnlocked();
      }}
    >
      <div>
        <h2 style={{ margin: "0 0 4px", fontSize: "1.05rem" }}>Admin access</h2>
        <p style={{ margin: 0, color: "var(--text-2)", fontSize: "var(--fs-sm)" }}>
          This server requires the admin token (the <code>ADMIN_TOKEN</code> it was deployed with).
        </p>
      </div>
      <input
        className="input"
        type="password"
        autoFocus
        placeholder="Admin token"
        value={token}
        onChange={(e) => setToken(e.target.value)}
      />
      <button className="btn btn-primary" type="submit">
        Unlock
      </button>
    </form>
  );
}

/** Armed two-click destructive button (no browser dialogs). */
function DangerButton({ label, confirmLabel, onConfirm }: { label: string; confirmLabel: string; onConfirm: () => void }) {
  const [armed, setArmed] = useState(false);
  return (
    <button
      className={`btn btn-sm btn-danger ${armed ? "is-on" : ""}`}
      onClick={() => {
        if (armed) {
          onConfirm();
          setArmed(false);
        } else {
          setArmed(true);
          window.setTimeout(() => setArmed(false), 3000);
        }
      }}
    >
      {armed ? confirmLabel : label}
    </button>
  );
}

export default function AdminPage() {
  const [events, setEvents] = useState<EventSummary[] | null>(null);
  const [templates, setTemplates] = useState<TemplateSummary[]>([]);
  const [live, setLive] = useState<Map<string, string>>(new Map());
  const [error, setError] = useState(false);
  const [locked, setLocked] = useState(false);
  const [importFor, setImportFor] = useState<string | null>(null); // eventId
  const [me, setMe] = useState<{ role: "admin" | "company" | null; teamName?: string } | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [companies, setCompanies] = useState<{ id: string; name: string; companyToken: string | null; eventCount: number }[]>([]);

  const reload = useCallback(() => {
    api
      .events(showArchived)
      .then((data) => {
        setEvents(data);
        setLocked(false);
      })
      .catch((err) => {
        if (err instanceof ApiError && err.status === 401) setLocked(true);
        else setError(true);
      });
    api.templates().then(setTemplates).catch(() => undefined);
    api.me().then(setMe).catch(() => undefined);
    api.companies().then(setCompanies).catch(() => setCompanies([]));
  }, [showArchived]);
  useEffect(reload, [reload]);

  // Live-now poller: which rundowns have a running/paused session.
  useEffect(() => {
    let stop = false;
    const poll = () =>
      api
        .live()
        .then((rows) => {
          if (!stop) setLive(new Map(rows.map((r) => [r.rundownId, r.state])));
        })
        .catch(() => undefined);
    poll();
    const id = setInterval(poll, 10_000);
    return () => {
      stop = true;
      clearInterval(id);
    };
  }, []);

  const rename = (kind: "event" | "rundown", id: string, current: string) => {
    const name = window.prompt(`Rename ${kind}`, current);
    if (!name || name === current) return;
    void (kind === "event" ? api.patchEvent(id, { name }) : api.patchRundown(id, { name })).then(reload);
  };

  if (locked)
    return (
      <div data-theme="light" style={{ minHeight: "100vh", background: "var(--bg)", color: "var(--text)" }}>
        <TokenGate onUnlocked={reload} />
      </div>
    );

  const settings = (
    <>
      <SideNavSection heading="Dashboard">
        <button type="button" className="menu-item" onClick={() => setShowArchived((a) => !a)}>
          <span className="check">{showArchived && "✓"}</span>
          Show archived
        </button>
      </SideNavSection>
      <SideNavSection heading="Credentials">
        {getAdminToken() ? (
          <button
            type="button"
            className="menu-item"
            onClick={() => {
              setAdminToken(null);
              reload();
            }}
          >
            <span className="check" />
            Forget token
          </button>
        ) : (
          <div style={{ color: "var(--text-3)", fontSize: "var(--fs-xs)", padding: "2px 9px" }}>
            Dev-open server — no token needed.
          </div>
        )}
      </SideNavSection>
    </>
  );

  return (
    <div data-theme="light" style={{ minHeight: "100vh", background: "var(--bg)", color: "var(--text)" }}>
      <WithSideNav title={me?.role === "company" ? me.teamName : "Admin"} settings={settings}>
      <main style={{ maxWidth: 960, margin: "0 auto", padding: "3rem 1.5rem" }}>
        <header style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: "1.5rem" }}>
          <div style={{ flex: 1 }}>
            <h1 style={{ fontSize: "1.5rem", fontWeight: 700, letterSpacing: "-0.02em", margin: 0 }}>
              OpenCall{" "}
              <span style={{ color: "var(--text-3)", fontWeight: 500 }}>
                {me?.role === "company" ? me.teamName : "admin"}
              </span>
            </h1>
            <p style={{ color: "var(--text-2)", margin: "2px 0 0", fontSize: "var(--fs-sm)" }}>
              {me?.role === "company"
                ? "Your company's events and shows. Only your own data is visible here."
                : "Every event company, event, and show. Admin sees everything."}
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

        {me?.role === "admin" && (
          <section className="card" style={{ marginBottom: 14, padding: "14px 16px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <h2 style={{ fontSize: "1.02rem", fontWeight: 650, margin: 0, flex: 1 }}>
                Event companies{" "}
                <span style={{ color: "var(--text-3)", fontWeight: 400, fontSize: "var(--fs-sm)" }}>
                  — each company's showcaller credential manages only its own events
                </span>
              </h2>
              <button
                className="btn btn-sm"
                onClick={() => {
                  const name = window.prompt("Company name");
                  if (name?.trim())
                    void api.createCompany(name.trim()).then(({ companyToken }) => {
                      window.alert(`Company created. Showcaller token (share it securely):\n\n${companyToken}`);
                      reload();
                    });
                }}
              >
                {Icon.plus} Company
              </button>
            </div>
            <ul style={{ listStyle: "none", margin: "8px 0 0", padding: 0 }}>
              {companies.map((c) => (
                <li key={c.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 0", borderTop: "1px solid var(--border-subtle)" }}>
                  <strong style={{ minWidth: 160 }}>{c.name}</strong>
                  <span style={{ color: "var(--text-3)", fontSize: "var(--fs-sm)", flex: 1 }}>
                    {c.eventCount} event{c.eventCount === 1 ? "" : "s"}
                  </span>
                  {c.companyToken && (
                    <button
                      className="btn btn-sm"
                      onClick={() => void navigator.clipboard.writeText(c.companyToken!)}
                      title="Copy the showcaller credential for this company"
                    >
                      Copy token
                    </button>
                  )}
                  <button
                    className="btn btn-sm btn-ghost"
                    onClick={() =>
                      void api.rotateCompanyToken(c.id).then(({ companyToken }) => {
                        window.alert(`New token (the old one stops working):\n\n${companyToken}`);
                        reload();
                      })
                    }
                  >
                    Rotate
                  </button>
                </li>
              ))}
              {companies.length === 0 && (
                <li style={{ color: "var(--text-3)", fontSize: "var(--fs-sm)", padding: "6px 0" }}>
                  No companies yet — create one to hand out scoped showcaller credentials.
                </li>
              )}
            </ul>
          </section>
        )}

        <div style={{ display: "grid", gap: 14 }}>
          {events?.map((event) => (
            <section key={event.id} className="card">
              <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "14px 16px 4px", opacity: event.archivedAt ? 0.55 : 1 }}>
                <h2 style={{ fontSize: "1.02rem", fontWeight: 650, margin: 0 }}>{event.name}</h2>
                {event.archivedAt && <span className="chip">archived</span>}
                <span style={{ color: "var(--text-3)", fontSize: "var(--fs-sm)", flex: 1 }}>
                  {event.location ? `${event.location} · ` : ""}
                  {event.startDate} → {event.endDate}
                </span>
                <button className="btn btn-sm btn-ghost" onClick={() => rename("event", event.id, event.name)}>
                  Rename
                </button>
                <button
                  className="btn btn-sm btn-ghost"
                  title="The event's location decides its timezone — the primary time only changes when the location does"
                  onClick={() => {
                    const location = window.prompt("Event location", event.location ?? "");
                    if (location === null) return;
                    const timezone = window.prompt(
                      "Timezone for this location (IANA name)",
                      event.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone,
                    );
                    if (timezone === null) return;
                    void api
                      .patchEvent(event.id, { location, timezone })
                      .then(reload)
                      .catch((err) => window.alert(String(err)));
                  }}
                >
                  Location…
                </button>
                <button
                  className="btn btn-sm btn-ghost"
                  onClick={() => void api.archiveEvent(event.id, !event.archivedAt).then(reload)}
                >
                  {event.archivedAt ? "Unarchive" : "Archive"}
                </button>
                <DangerButton
                  label="Delete"
                  confirmLabel="Delete event + rundowns?"
                  onConfirm={() => void api.deleteEvent(event.id).then(reload)}
                />
              </div>
              <ul style={{ listStyle: "none", padding: "0 6px", margin: "6px 0 0" }}>
                {event.rundowns.map((r) => (
                  <li
                    key={r.id}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      padding: "9px 10px",
                      borderTop: "1px solid var(--border-subtle)",
                      flexWrap: "wrap",
                      opacity: r.archivedAt ? 0.55 : 1,
                    }}
                  >
                    <span style={{ flex: 1, minWidth: 180 }}>
                      <strong style={{ fontWeight: 600 }}>{r.name}</strong>
                      {r.archivedAt && <span className="chip" style={{ marginLeft: 8 }}>archived</span>}
                      {live.has(r.id) && (
                        <span className="live-badge" style={{ marginLeft: 10 }}>
                          {live.get(r.id) === "paused" ? "PAUSED" : "LIVE"}
                        </span>
                      )}
                      <span style={{ color: "var(--text-3)", marginLeft: 10, fontSize: "var(--fs-sm)" }}>
                        {r.description ?? ""} {r.showDate ? `· ${r.showDate}` : ""}
                      </span>
                    </span>
                    <Link href={`/show/${r.id}`} className="btn btn-sm btn-primary" style={{ textDecoration: "none" }}>
                      Show
                    </Link>
                    <Link href={`/edit/${r.id}`} className="btn btn-sm" style={{ textDecoration: "none" }}>
                      Edit
                    </Link>
                    <Link href={`/view/${r.id}`} className="btn btn-sm" style={{ textDecoration: "none" }}>
                      View
                    </Link>
                    {(["follow", "timer", "prompter"] as const).map((view) => (
                      <Link key={view} href={`/${view}/${r.id}`} className="chip" style={{ textDecoration: "none" }}>
                        {view}
                      </Link>
                    ))}
                    <button className="btn btn-sm btn-ghost" onClick={() => rename("rundown", r.id, r.name)}>
                      Rename
                    </button>
                    <button
                      className="btn btn-sm btn-ghost"
                      onClick={() => void api.archiveRundown(r.id, !r.archivedAt).then(reload)}
                    >
                      {r.archivedAt ? "Unarchive" : "Archive"}
                    </button>
                    <button className="btn btn-sm btn-ghost" onClick={() => void api.duplicateRundown(r.id).then(reload)}>
                      Duplicate
                    </button>
                    <DangerButton
                      label="Delete"
                      confirmLabel="Really delete?"
                      onConfirm={() => void api.deleteRundown(r.id).then(reload)}
                    />
                  </li>
                ))}
                {event.rundowns.length === 0 && (
                  <li style={{ padding: "8px 10px", color: "var(--text-3)", fontSize: "var(--fs-sm)", borderTop: "1px solid var(--border-subtle)" }}>
                    No rundowns yet.
                  </li>
                )}
              </ul>
              {importFor === event.id ? (
                <ImportPanel
                  eventId={event.id}
                  onClose={() => setImportFor(null)}
                  onDone={(rundownId) => {
                    setImportFor(null);
                    reload();
                    window.open(`/show/${rundownId}`, "_blank");
                  }}
                />
              ) : (
                <div style={{ padding: "0 16px 4px" }}>
                  <button className="btn btn-sm" onClick={() => setImportFor(event.id)}>
                    ⤒ Import run sheet…
                  </button>
                </div>
              )}
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
      </WithSideNav>
    </div>
  );
}
