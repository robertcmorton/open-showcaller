"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  api,
  ApiError,
  copyViewOnlyLink,
  csvToSeedRows,
  getAdminToken,
  setAdminToken,
  type EventSummary,
  type TemplateSummary,
} from "../../lib/api";
import { BrandMark, Dropdown, Icon } from "../../components/ui";
import { ImportPanel } from "../../components/ImportPanel";
import { SideNavSection, WithSideNav } from "../../components/SideNav";
import { imageFileToDataUrl, pickImage } from "../../lib/pickImage";
import { AdminNavSection } from "../../components/AdminNav";
import { VersionBadge } from "../../components/VersionBadge";
import { LocationDialog, TimezoneField } from "../../components/TimezoneField";
import { isValidTimeZone } from "@opencall/core";

/** Event artwork slot: click (or drop an image on it) to set, hover ✕ to clear. */
function ImageSlot({ value, hint, onChange }: { value: string | null; hint: string; onChange: (img: string | null) => void }) {
  const [drag, setDrag] = useState(false);
  return (
    <div
      className="img-slot"
      title={value ? `${hint} — click to replace` : `${hint} — click to add, or drop an image`}
      onClick={() => void pickImage().then((img) => img && onChange(img))}
      onDragOver={(e) => {
        e.preventDefault();
        setDrag(true);
      }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDrag(false);
        const file = e.dataTransfer.files?.[0];
        if (file && file.type.startsWith("image/")) void imageFileToDataUrl(file).then((img) => img && onChange(img));
      }}
      style={{
        position: "relative",
        height: 40,
        width: 40,
        borderRadius: 8,
        cursor: "pointer",
        flexShrink: 0,
        display: "grid",
        placeItems: "center",
        border: value && !drag ? "1px solid transparent" : `1.5px dashed ${drag ? "var(--accent)" : "var(--border)"}`,
        background: drag ? "var(--accent-soft)" : undefined,
      }}
    >
      {value ? (
        <img src={value} alt="" style={{ height: 34, width: 34, objectFit: "contain" }} />
      ) : (
        <span style={{ color: "var(--text-3)", fontSize: 18, lineHeight: 1 }}>+</span>
      )}
      {value && (
        <button
          type="button"
          className="img-slot-x"
          title="Remove image"
          onClick={(e) => {
            e.stopPropagation();
            onChange(null);
          }}
        >
          ✕
        </button>
      )}
    </div>
  );
}

/** Sports with a live outcome flow (full time win/lose/draw, golden point…). */
const SPORTS: [string, string][] = [["nrl", "NRL"]];

function SportSelect({ value, onChange, compact }: { value: string | null; onChange: (v: string | null) => void; compact?: boolean }) {
  return (
    <select
      className="input"
      title="Sport drives the live outcome flow — NRL adds the full-time Win / Lose / Golden point pick"
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value || null)}
      style={compact ? { height: 30, fontSize: "var(--fs-sm)", padding: "0 8px" } : undefined}
    >
      <option value="">No sport</option>
      {SPORTS.map(([v, label]) => (
        <option key={v} value={v}>
          {label}
        </option>
      ))}
    </select>
  );
}

/** Today in the USER'S timezone — toISOString() is UTC, which is yesterday
 *  every morning east of Greenwich. */
function localToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Pops the native calendar as soon as a date field is focused or clicked. */
function openDatePicker(e: { currentTarget: HTMLInputElement }): void {
  try {
    e.currentTarget.showPicker?.();
  } catch {
    // showPicker demands a user gesture; the field still works without it.
  }
}

function CreateEventForm({ onCreated, teamId }: { onCreated: () => void; teamId?: string }) {
  const [timezone, setTimezone] = useState(Intl.DateTimeFormat().resolvedOptions().timeZone);
  const [sport, setSport] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [location, setLocation] = useState("");
  const today = localToday();
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
        if (!name.trim() || !isValidTimeZone(timezone)) return;
        void api.createEvent({ name: name.trim(), location: location.trim() || undefined, startDate, endDate, timezone, sport, teamId }).then(() => {
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
        <label className="field-label">Event location</label>
        <input className="input" placeholder="Main arena" value={location} onChange={(e) => setLocation(e.target.value)} />
      </div>
      <div>
        <label className="field-label">Starts</label>
        <input
          className="input"
          type="date"
          value={startDate}
          onFocus={openDatePicker}
          onClick={openDatePicker}
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
          onFocus={openDatePicker}
          onClick={openDatePicker}
          onChange={(e) => setEndDate(e.target.value < startDate ? startDate : e.target.value)}
        />
      </div>
      <TimezoneField value={timezone} onChange={setTimezone} atDate={startDate} />
      <div>
        <label className="field-label">Sport</label>
        <SportSelect value={sport} onChange={setSport} />
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
  leading,
}: {
  eventId: string;
  templates: TemplateSummary[];
  onCreated: () => void;
  /** Rendered at the start of the row (the Import run sheet button). */
  leading?: React.ReactNode;
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
      {leading}
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
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const login = (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password) return;
    setBusy(true);
    setError(null);
    void api
      .login(email.trim(), password)
      .then(({ token: session }) => {
        setAdminToken(session);
        onUnlocked();
      })
      .catch(() => {
        setError("Invalid email or password.");
        setBusy(false);
      });
  };

  return (
    <div style={{ maxWidth: 420, margin: "10vh auto", display: "grid", gap: 14 }}>
      <form
        className="panel"
        style={{ display: "grid", gap: 12 }}
        onSubmit={login}
      >
        <div>
          <h2 style={{ margin: "0 0 4px", fontSize: "1.05rem" }}>Sign in</h2>
          <p style={{ margin: 0, color: "var(--text-2)", fontSize: "var(--fs-sm)" }}>
            This server is locked. Sign in with your account, or use a token below.
          </p>
        </div>
        <input className="input" type="email" autoFocus autoComplete="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
        <input className="input" type="password" autoComplete="current-password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} />
        {error && <div style={{ color: "var(--over)", fontSize: "var(--fs-sm)" }}>{error}</div>}
        <button className="btn btn-primary" type="submit" disabled={busy || !email.trim() || !password}>
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </form>
      <form
        className="panel"
        style={{ display: "grid", gap: 10 }}
        onSubmit={(e) => {
          e.preventDefault();
          if (!token.trim()) return;
          setAdminToken(token.trim());
          onUnlocked();
        }}
      >
        <label className="field-label" style={{ margin: 0 }}>
          Or use a token (admin, company, or personal)
        </label>
        <input
          className="input"
          type="password"
          placeholder="Token"
          value={token}
          onChange={(e) => setToken(e.target.value)}
        />
        <button className="btn" type="submit" disabled={!token.trim()}>
          Unlock with token
        </button>
      </form>
    </div>
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
        onFocus={openDatePicker}
        onClick={openDatePicker}
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
        onFocus={openDatePicker}
        onClick={openDatePicker}
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

/**
 * Phone-sized screens collapse each entity's action buttons into one ⋯ menu
 * (the buttons themselves get .hide-mobile). Desktop is unchanged.
 */
function MobileActions({ children }: { children: React.ReactNode }) {
  return (
    <Dropdown label="⋯" align="right" className="btn btn-sm mobile-only">
      {children}
    </Dropdown>
  );
}

/** Prompt-based date editing for the mobile menu (desktop has the inline editor). */
function promptDates(event: { id: string; startDate: string; endDate: string }, onSaved: () => void): void {
  const start = window.prompt("Start date (YYYY-MM-DD)", event.startDate);
  if (start === null) return;
  const end = window.prompt("End date (YYYY-MM-DD)", event.endDate < start ? start : event.endDate);
  if (end === null) return;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) {
    window.alert("Dates must be YYYY-MM-DD.");
    return;
  }
  if (end < start) {
    window.alert("End date cannot be before the start date.");
    return;
  }
  void api
    .patchEvent(event.id, { startDate: start, endDate: end })
    .then(onSaved)
    .catch((err) => window.alert(String(err)));
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
  const [locEvent, setLocEvent] = useState<EventSummary | null>(null);
  const [templates, setTemplates] = useState<TemplateSummary[]>([]);
  const [live, setLive] = useState<Map<string, string>>(new Map());
  const [error, setError] = useState(false);
  const [locked, setLocked] = useState(false);
  // Import panel target: an event (new rundown), optionally replacing an existing rundown's content.
  const [importFor, setImportFor] = useState<{ eventId: string; replace?: { id: string; name: string } } | null>(null);
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
      <div style={{ minHeight: "100vh", background: "var(--bg)", color: "var(--text)" }}>
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
      {me?.role === "admin" && <AdminNavSection />}
      <SideNavSection heading="Credentials">
        <div style={{ color: "var(--text-3)", fontSize: "var(--fs-xs)", padding: "2px 9px", lineHeight: 1.5 }}>
          {me?.role === "admin" ? (
            <>
              Signed in as <strong style={{ color: "var(--text-2)" }}>Administrator</strong> — full access
            </>
          ) : me?.role === "company" ? (
            <>
              Signed in as <strong style={{ color: "var(--text-2)" }}>{me.teamName}</strong> — company access
            </>
          ) : me?.role === "user" ? (
            <>
              Signed in as <strong style={{ color: "var(--text-2)" }}>{me.name}</strong>
              {me.canManage ? " — manager" : " — view access"}
            </>
          ) : (
            "Not signed in"
          )}
        </div>
        <Link className="menu-item" href="/account">
          <span className="check" />
          My account
        </Link>
        {getAdminToken() ? (
          <button
            type="button"
            className="menu-item"
            onClick={() => {
              // Sessions are revoked server-side; plain tokens are just forgotten.
              const bearer = getAdminToken();
              const done = () => {
                setAdminToken(null);
                reload();
              };
              if (bearer?.startsWith("ses_")) void api.logout().catch(() => undefined).then(done);
              else done();
            }}
          >
            <span className="check" />
            Sign out
          </button>
        ) : (
          <div style={{ color: "var(--text-3)", fontSize: "var(--fs-xs)", padding: "2px 9px" }}>
            Dev-open server — no sign-in needed.
          </div>
        )}
      </SideNavSection>
    </>
  );

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg)", color: "var(--text)" }}>
      <WithSideNav title={me?.role === "company" ? me.teamName : "Admin"} settings={settings}>
      <main className="admin-main">
        <header style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: "1.5rem" }}>
          <div style={{ flex: 1 }}>
            <h1 style={{ fontSize: "1.5rem", fontWeight: 700, letterSpacing: "-0.02em", margin: 0, display: "flex", alignItems: "center", gap: 10 }}>
              <BrandMark size={28} />
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
                {me?.role === "admin" && group.real && (() => {
                  const renameCompany = () => {
                    const name = window.prompt("Rename company", group.name);
                    if (name?.trim() && name.trim() !== group.name)
                      void api.patchCompany(group.id, { name: name.trim() }).then(reload);
                  };
                  const pickLogo = () =>
                    void pickImage().then((logo) => {
                      if (logo) void api.patchCompany(group.id, { logo }).then(reload);
                    });
                  const rotate = () =>
                    void api.rotateCompanyToken(group.id).then(({ companyToken }) => {
                      window.alert(`New token (the old one stops working):\n\n${companyToken}`);
                      reload();
                    });
                  return (
                    <>
                      <span className="hide-mobile" style={{ display: "inline-flex", gap: 8, alignItems: "center" }}>
                        <button className="btn btn-sm btn-ghost" onClick={renameCompany}>
                          Rename
                        </button>
                        <button
                          className="btn btn-sm btn-ghost"
                          title="Company logo — shown beside the company and on its events"
                          onClick={pickLogo}
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
                        <button className="btn btn-sm btn-ghost" onClick={rotate}>
                          Rotate
                        </button>
                        <DangerButton
                          label="Delete company"
                          confirmLabel={`Delete company + ${group.events.length} event${group.events.length === 1 ? "" : "s"}?`}
                          onConfirm={() => void api.deleteCompany(group.id).then(reload)}
                        />
                      </span>
                      <MobileActions>
                        <button type="button" className="menu-item" onClick={renameCompany}>
                          <span className="check" />
                          Rename
                        </button>
                        <button type="button" className="menu-item" onClick={pickLogo}>
                          <span className="check" />
                          Logo…
                        </button>
                        {group.companyToken && (
                          <button
                            type="button"
                            className="menu-item"
                            onClick={() => void navigator.clipboard.writeText(group.companyToken!)}
                          >
                            <span className="check" />
                            Copy token
                          </button>
                        )}
                        <button type="button" className="menu-item" onClick={rotate}>
                          <span className="check" />
                          Rotate token
                        </button>
                        <div className="menu-sep" />
                        <div data-keep-open style={{ padding: "4px 9px" }}>
                          <DangerButton
                            label="Delete company"
                            confirmLabel={`Delete + ${group.events.length} event${group.events.length === 1 ? "" : "s"}?`}
                            onConfirm={() => void api.deleteCompany(group.id).then(reload)}
                          />
                        </div>
                      </MobileActions>
                    </>
                  );
                })()}
              </div>
              <div style={{ display: "grid", gap: 12, paddingLeft: 12, borderLeft: "2px solid var(--border-subtle)" }}>
                {group.events.map((event) => (
            <section key={event.id} className="card">
              <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "14px 16px 4px", opacity: event.archivedAt ? 0.55 : 1 }}>
                <ImageSlot
                  value={event.image1}
                  hint="Event image / home team"
                  onChange={(img) => void api.patchEvent(event.id, { image1: img }).then(reload)}
                />
                <ImageSlot
                  value={event.image2}
                  hint="Away team (sport)"
                  onChange={(img) => void api.patchEvent(event.id, { image2: img }).then(reload)}
                />
                <div style={{ minWidth: 0 }}>
                  <h2 style={{ fontSize: "1.02rem", fontWeight: 650, margin: 0, display: "flex", alignItems: "center", gap: 8 }}>
                    {event.name}
                    {event.archivedAt && <span className="chip">archived</span>}
                  </h2>
                  <div style={{ color: "var(--text-3)", fontSize: "var(--fs-sm)", marginTop: 2 }}>
                    {event.location ? `${event.location} · ` : ""}
                    {event.startDate} → {event.endDate}
                  </div>
                </div>
                <span style={{ flex: 1 }} />
                <span className="hide-mobile" style={{ display: "inline-flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <button className="btn btn-sm btn-ghost" onClick={() => rename("event", event.id, event.name)}>
                  Rename
                </button>
                <DatesEditor key={`${event.startDate}${event.endDate}`} event={event} onSaved={reload} />
                <SportSelect
                  compact
                  value={event.sport}
                  onChange={(v) => void api.patchEvent(event.id, { sport: v }).then(reload)}
                />
                <button
                  className="btn btn-sm btn-ghost"
                  title="The event's location decides its timezone — clocks follow the daylight-saving rules in force there on the show date"
                  onClick={() => setLocEvent(event)}
                >
                  Event location…
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
                </span>
                <MobileActions>
                  <button type="button" className="menu-item" onClick={() => rename("event", event.id, event.name)}>
                    <span className="check" />
                    Rename
                  </button>
                  <button type="button" className="menu-item" onClick={() => promptDates(event, reload)}>
                    <span className="check" />
                    Dates…
                  </button>
                  <button type="button" className="menu-item" onClick={() => setLocEvent(event)}>
                    <span className="check" />
                    Event location…
                  </button>
                  <button
                    type="button"
                    className="menu-item"
                    onClick={() => void api.archiveEvent(event.id, !event.archivedAt).then(reload)}
                  >
                    <span className="check" />
                    {event.archivedAt ? "Unarchive" : "Archive"}
                  </button>
                  <div className="menu-sep" />
                  <div data-keep-open style={{ padding: "4px 9px" }}>
                    <DangerButton
                      label="Delete event"
                      confirmLabel="Delete event + rundowns?"
                      onConfirm={() => void api.deleteEvent(event.id).then(reload)}
                    />
                  </div>
                </MobileActions>
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
                    <Link
                      href={`/show/${r.id}`}
                      className="btn btn-sm btn-primary"
                      style={{ textDecoration: "none" }}
                      title="Showcaller console: full transport (start, pause, next) plus live editing — the caller's screen"
                    >
                      Show
                    </Link>
                    <Link
                      href={`/edit/${r.id}`}
                      className="btn btn-sm"
                      style={{ textDecoration: "none" }}
                      title="Edit the sheet with no transport controls — safe for producers preparing content"
                    >
                      Edit
                    </Link>
                    <Link
                      href={`/view/${r.id}`}
                      className="btn btn-sm"
                      style={{ textDecoration: "none" }}
                      title="Read-only: follows the live show, nothing can be changed — for anyone who just watches"
                    >
                      View
                    </Link>
                    {(
                      [
                        ["follow", "Crew companion for phones — tracks the live cue with your role highlighted"],
                        ["timer", "Full-screen speaker timer — big countdown of the current item"],
                        ["prompter", "Script prompter — large scrolling script that follows the caller"],
                      ] as const
                    ).map(([view, hint]) => (
                      <Link key={view} href={`/${view}/${r.id}`} className="chip" style={{ textDecoration: "none" }} title={hint}>
                        {view}
                      </Link>
                    ))}
                    <span className="hide-mobile">
                      <Dropdown label="⋯" className="btn btn-sm btn-ghost">
                        <button
                          type="button"
                          className="menu-item"
                          title="Copy a URL that opens this rundown read-only — for camera operators and crew"
                          onClick={() =>
                            void copyViewOnlyLink(r.id).then((url) =>
                              window.alert(`View-only link copied:\n\n${url}\n\nAnyone with it can watch this rundown live.`),
                            )
                          }
                        >
                          <span className="check" />
                          Copy view link
                        </button>
                        <button
                          type="button"
                          className="menu-item"
                          title="Re-import from the stored run sheet with the latest import quality — links and codes keep working"
                          onClick={() => setImportFor({ eventId: event.id, replace: { id: r.id, name: r.name } })}
                        >
                          <span className="check" />
                          Update import…
                        </button>
                        <button type="button" className="menu-item" onClick={() => rename("rundown", r.id, r.name)}>
                          <span className="check" />
                          Rename
                        </button>
                        <button type="button" className="menu-item" onClick={() => void api.duplicateRundown(r.id).then(reload)}>
                          <span className="check" />
                          Duplicate
                        </button>
                        <button
                          type="button"
                          className="menu-item"
                          onClick={() => void api.archiveRundown(r.id, !r.archivedAt).then(reload)}
                        >
                          <span className="check" />
                          {r.archivedAt ? "Unarchive" : "Archive"}
                        </button>
                        <div className="menu-sep" />
                        <div data-keep-open style={{ padding: "4px 9px" }}>
                          <DangerButton
                            label="Delete"
                            confirmLabel="Really delete?"
                            onConfirm={() => void api.deleteRundown(r.id).then(reload)}
                          />
                        </div>
                      </Dropdown>
                    </span>
                    <MobileActions>
                      <button
                        type="button"
                        className="menu-item"
                        onClick={() =>
                          void copyViewOnlyLink(r.id).then((url) =>
                            window.alert(`View-only link copied:\n\n${url}`),
                          )
                        }
                      >
                        <span className="check" />
                        Copy view link
                      </button>
                      <button
                        type="button"
                        className="menu-item"
                        onClick={() => setImportFor({ eventId: event.id, replace: { id: r.id, name: r.name } })}
                      >
                        <span className="check" />
                        Update import…
                      </button>
                      <button type="button" className="menu-item" onClick={() => rename("rundown", r.id, r.name)}>
                        <span className="check" />
                        Rename
                      </button>
                      <button
                        type="button"
                        className="menu-item"
                        onClick={() => void api.archiveRundown(r.id, !r.archivedAt).then(reload)}
                      >
                        <span className="check" />
                        {r.archivedAt ? "Unarchive" : "Archive"}
                      </button>
                      <button type="button" className="menu-item" onClick={() => void api.duplicateRundown(r.id).then(reload)}>
                        <span className="check" />
                        Duplicate
                      </button>
                      <div className="menu-sep" />
                      <div data-keep-open style={{ padding: "4px 9px" }}>
                        <DangerButton
                          label="Delete"
                          confirmLabel="Really delete?"
                          onConfirm={() => void api.deleteRundown(r.id).then(reload)}
                        />
                      </div>
                    </MobileActions>
                  </li>
                ))}
                {event.rundowns.length === 0 && (
                  <li style={{ padding: "8px 10px", color: "var(--text-3)", fontSize: "var(--fs-sm)", borderTop: "1px solid var(--border-subtle)" }}>
                    No rundowns yet.
                  </li>
                )}
              </ul>
              {importFor?.eventId === event.id ? (
                <ImportPanel
                  eventId={event.id}
                  replaceRundown={importFor.replace}
                  onClose={() => setImportFor(null)}
                  onDone={(rundownId) => {
                    setImportFor(null);
                    reload();
                    window.open(`/show/${rundownId}`, "_blank");
                  }}
                />
              ) : null}
              <CreateRundownForm
                eventId={event.id}
                templates={templates}
                onCreated={reload}
                leading={
                  !importFor || importFor.eventId !== event.id ? (
                    <button
                      type="button"
                      className="btn btn-sm"
                      title="Create a rundown from an XLSX, CSV, or PDF run sheet"
                      onClick={() => setImportFor({ eventId: event.id })}
                    >
                      ⤒ Import run sheet…
                    </button>
                  ) : undefined
                }
              />
            </section>
                ))}
                {group.events.length === 0 && (
                  <div style={{ color: "var(--text-3)", fontSize: "var(--fs-sm)", padding: "2px 0" }}>
                    No events yet for this company.
                  </div>
                )}
                {(me?.role === "admin" || me?.role === "company") && (
                  <div>
                    <CreateEventForm teamId={group.real ? group.id : undefined} onCreated={reload} />
                  </div>
                )}
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
      <VersionBadge />
      {locEvent && (
        <LocationDialog
          event={locEvent}
          onClose={() => setLocEvent(null)}
          onSaved={() => {
            setLocEvent(null);
            reload();
          }}
        />
      )}
    </div>
  );
}
