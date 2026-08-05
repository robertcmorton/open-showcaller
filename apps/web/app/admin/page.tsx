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
import { Dropdown, Icon } from "../../components/ui";
import { ImportPanel } from "../../components/ImportPanel";
import { SideNavSection, WithSideNav } from "../../components/SideNav";
import { pickImage } from "../../lib/pickImage";
import { UsersPanel } from "../../components/UsersPanel";

function CreateEventForm({ onCreated, teamId }: { onCreated: () => void; teamId?: string }) {
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
        void api.createEvent({ name: name.trim(), location: location.trim() || undefined, startDate, endDate, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone, teamId }).then(() => {
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
        <input
          className="input"
          type="date"
          value={startDate}
          onChange={(e) => {
            const v = e.target.value;
            setStartDate(v);
            if (endDate < v) setEndDate(v); // end date may never precede the start
          }}
        />
      </div>
      <div>
        <label className="field-label">Ends</label>
        <input
          className="input"
          type="date"
          min={startDate}
          value={endDate}
          onChange={(e) => setEndDate(e.target.value < startDate ? startDate : e.target.value)}
        />
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
      {templates.length > 0 && (
        <select
          className="input"
          title="Start the new rundown empty, or copy a saved template"
          value={templateId}
          onChange={(e) => setTemplateId(e.target.value)}
        >
          <option value="">Start blank</option>
          {templates.map((t) => (
            <option key={t.id} value={t.id}>
              From template: {t.name}
            </option>
          ))}
        </select>
      )}
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

/** Inline start/end editor for an event card. End can never precede start. */
function DatesEditor({
  event,
  onSaved,
}: {
  event: { id: string; startDate: string; endDate: string };
  onSaved: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [start, setStart] = useState(event.startDate);
  const [end, setEnd] = useState(event.endDate);
  const [error, setError] = useState<string | null>(null);

  if (!open)
    return (
      <button className="btn btn-sm btn-ghost" onClick={() => setOpen(true)}>
        Dates…
      </button>
    );

  return (
    <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
      <input
        className="input"
        type="date"
        value={start}
        onChange={(e) => {
          const v = e.target.value;
          setStart(v);
          if (end < v) setEnd(v);
        }}
        style={{ padding: "3px 6px" }}
      />
      <span style={{ color: "var(--text-3)" }}>→</span>
      <input
        className="input"
        type="date"
        min={start}
        value={end}
        onChange={(e) => setEnd(e.target.value < start ? start : e.target.value)}
        style={{ padding: "3px 6px" }}
      />
      <button
        className="btn btn-sm btn-primary"
        onClick={() => {
          if (end < start) {
            setError("End date cannot be before the start date.");
            return;
          }
          void api
            .patchEvent(event.id, { startDate: start, endDate: end })
            .then(() => {
              setOpen(false);
              setError(null);
              onSaved();
            })
            .catch((err) => setError(String(err)));
        }}
      >
        Save
      </button>
      <button className="btn btn-sm btn-ghost" onClick={() => setOpen(false)}>
        ✕
      </button>
      {error && <span style={{ color: "var(--over)", fontSize: "var(--fs-xs)" }}>{error}</span>}
    </span>
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
  const [me, setMe] = useState<{ role: "admin" | "company" | "user" | null; teamName?: string; name?: string; canManage?: boolean } | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [companies, setCompanies] = useState<{ id: string; name: string; companyToken: string | null; logo: string | null; eventCount: number }[]>([]);

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

  // Events appear underneath their company. Admin sees every company;
  // a company credential sees exactly one group — its own.
  const eventsByTeam = new Map<string, EventSummary[]>();
  for (const event of events ?? []) {
    const list = eventsByTeam.get(event.teamId) ?? [];
    list.push(event);
    eventsByTeam.set(event.teamId, list);
  }
  const groups =
    me?.role === "admin" && companies.length > 0
      ? companies.map((c) => ({
          id: c.id,
          name: c.name,
          companyToken: c.companyToken,
          logo: c.logo,
          real: true,
          events: eventsByTeam.get(c.id) ?? [],
        }))
      : [{ id: "own", name: me?.teamName ?? "Events", companyToken: null, logo: null, real: false, events: events ?? [] }];

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
                {me?.role === "company" ? me.teamName : me?.role === "user" ? me.name : "admin"}
              </span>
            </h1>
            <p style={{ color: "var(--text-2)", margin: "2px 0 0", fontSize: "var(--fs-sm)" }}>
              {me?.role === "company"
                ? "Your company's events and shows. Only your own data is visible here."
                : "Every event company, event, and show. Admin sees everything."}
            </p>
          </div>
          {me?.role === "admin" && (
            <button
              className="btn btn-primary"
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
          )}
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

        {me?.role === "admin" && <UsersPanel companies={companies} events={events ?? []} />}

        <div style={{ display: "grid", gap: 20 }}>
          {groups.map((group) => (
            <section key={group.id}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "2px 2px 8px" }}>
                {"logo" in group && (group as { logo?: string | null }).logo && (
                  <img
                    src={(group as { logo?: string | null }).logo!}
                    alt=""
                    style={{ height: 30, width: 30, objectFit: "contain", borderRadius: 6 }}
                  />
                )}
                <h2 style={{ fontSize: "1.1rem", fontWeight: 700, margin: 0, letterSpacing: "-0.01em" }}>{group.name}</h2>
                <span className="chip">{group.events.length} event{group.events.length === 1 ? "" : "s"}</span>
                <span style={{ flex: 1 }} />
                {me?.role === "admin" && group.real && (
                  <>
                    <button
                      className="btn btn-sm btn-ghost"
                      onClick={() => {
                        const name = window.prompt("Rename company", group.name);
                        if (name?.trim() && name.trim() !== group.name)
                          void api.patchCompany(group.id, { name: name.trim() }).then(reload);
                      }}
                    >
                      Rename
                    </button>
                    <button
                      className="btn btn-sm btn-ghost"
                      title="Company logo — shown beside the company and on its events"
                      onClick={() =>
                        void pickImage().then((logo) => {
                          if (logo) void api.patchCompany(group.id, { logo }).then(reload);
                        })
                      }
                    >
                      Logo
                    </button>
                    {group.companyToken && (
                      <button
                        className="btn btn-sm"
                        title="Copy this company's showcaller credential"
                        onClick={() => void navigator.clipboard.writeText(group.companyToken!)}
                      >
                        Copy token
                      </button>
                    )}
                    <button
                      className="btn btn-sm btn-ghost"
                      onClick={() =>
                        void api.rotateCompanyToken(group.id).then(({ companyToken }) => {
                          window.alert(`New token (the old one stops working):\n\n${companyToken}`);
                          reload();
                        })
                      }
                    >
                      Rotate
                    </button>
                    <DangerButton
                      label="Delete company"
                      confirmLabel={`Delete company + ${group.events.length} event${group.events.length === 1 ? "" : "s"}?`}
                      onConfirm={() => void api.deleteCompany(group.id).then(reload)}
                    />
                  </>
                )}
              </div>
              <div style={{ display: "grid", gap: 12, paddingLeft: 12, borderLeft: "2px solid var(--border-subtle)" }}>
                {group.events.map((event) => (
            <section key={event.id} className="card">
              <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "14px 16px 4px", opacity: event.archivedAt ? 0.55 : 1 }}>
                {event.image1 && (
                  <img src={event.image1} alt="" style={{ height: 36, width: 36, objectFit: "contain" }} />
                )}
                {event.image2 && (
                  <img src={event.image2} alt="" style={{ height: 36, width: 36, objectFit: "contain" }} />
                )}
                <h2 style={{ fontSize: "1.02rem", fontWeight: 650, margin: 0 }}>{event.name}</h2>
                {event.archivedAt && <span className="chip">archived</span>}
                <span style={{ color: "var(--text-3)", fontSize: "var(--fs-sm)", flex: 1 }}>
                  {event.location ? `${event.location} · ` : ""}
                  {event.startDate} → {event.endDate}
                </span>
                <button className="btn btn-sm btn-ghost" onClick={() => rename("event", event.id, event.name)}>
                  Rename
                </button>
                <DatesEditor key={`${event.startDate}${event.endDate}`} event={event} onSaved={reload} />
                <Dropdown label="Images" className="btn btn-sm btn-ghost">
                  <button
                    type="button"
                    className="menu-item"
                    onClick={() =>
                      void pickImage().then((img) => {
                        if (img) void api.patchEvent(event.id, { image1: img }).then(reload);
                      })
                    }
                  >
                    <span className="check" />
                    {event.image1 ? "Replace image / home team" : "Add image (or home team)"}
                  </button>
                  <button
                    type="button"
                    className="menu-item"
                    onClick={() =>
                      void pickImage().then((img) => {
                        if (img) void api.patchEvent(event.id, { image2: img }).then(reload);
                      })
                    }
                  >
                    <span className="check" />
                    {event.image2 ? "Replace away team image" : "Add away team image (sport)"}
                  </button>
                  {(event.image1 || event.image2) && (
                    <>
                      <div className="menu-sep" />
                      <button
                        type="button"
                        className="menu-item"
                        onClick={() => void api.patchEvent(event.id, { image1: null, image2: null }).then(reload)}
                      >
                        <span className="check" />
                        Remove images
                      </button>
                    </>
                  )}
                </Dropdown>
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
                {group.events.length === 0 && (
                  <div style={{ color: "var(--text-3)", fontSize: "var(--fs-sm)", padding: "2px 0" }}>
                    No events yet for this company.
                  </div>
                )}
                <div>
                  <CreateEventForm teamId={group.real ? group.id : undefined} onCreated={reload} />
                </div>
              </div>
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
