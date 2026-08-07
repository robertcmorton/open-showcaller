"use client";

import { useMemo, useState } from "react";
import { isValidTimeZone, zoneAbbreviation } from "@opencall/core";
import { api } from "../lib/api";

/**
 * IANA timezone input with the full zone list to pick from and a live preview
 * of the GMT offset ON THE EVENT'S DATE — the show follows the daylight-saving
 * rules in force at its location on the day it plays, not whatever applies
 * today. Every clock (showcaller, remote monitors, live crosses) renders from
 * this zone, so screens in different countries stay in lockstep.
 */
export function TimezoneField({
  value,
  onChange,
  atDate,
  label = "Timezone",
}: {
  value: string;
  onChange: (tz: string) => void;
  /** ISO date the offset preview is computed for (the event's start date). */
  atDate?: string;
  label?: string;
}) {
  // Every zone worldwide, grouped by region for a scannable dropdown.
  const groups = useMemo(() => {
    const zones = typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : [];
    const byRegion = new Map<string, string[]>();
    for (const z of zones) {
      const region = z.includes("/") ? z.slice(0, z.indexOf("/")) : "Other";
      const list = byRegion.get(region) ?? [];
      list.push(z);
      byRegion.set(region, list);
    }
    return [...byRegion.entries()];
  }, []);
  const known = groups.some(([, zs]) => zs.includes(value));
  const valid = isValidTimeZone(value);
  const previewMs = atDate ? Date.parse(`${atDate}T12:00:00`) : Date.now();
  return (
    <div>
      <label className="field-label">{label}</label>
      <select className="input" value={value} onChange={(e) => onChange(e.target.value)} style={{ minWidth: 230 }}>
        {!known && <option value={value}>{value}</option>}
        {groups.map(([region, zs]) => (
          <optgroup key={region} label={region}>
            {zs.map((z) => (
              <option key={z} value={z}>
                {z.includes("/") ? z.slice(z.indexOf("/") + 1).replaceAll("_", " ").replaceAll("/", " / ") : z}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
      <div
        style={{
          marginTop: 4,
          fontSize: "var(--fs-xs)",
          color: valid ? "var(--text-2)" : "var(--over)",
          maxWidth: 320,
          lineHeight: 1.5,
        }}
      >
        {valid
          ? `${zoneAbbreviation(value, Number.isNaN(previewMs) ? Date.now() : previewMs)}${atDate ? ` on ${atDate}` : ""} — every clock and the run of show follow this zone, daylight saving included.`
          : "Pick a zone from the list."}
      </div>
    </div>
  );
}

/**
 * Edit an event's location and the timezone it implies, replacing the old
 * type-the-IANA-name prompts.
 */
export function LocationDialog({
  event,
  onSaved,
  onClose,
}: {
  event: { id: string; location: string | null; timezone: string; startDate: string };
  onSaved: () => void;
  onClose: () => void;
}) {
  const [location, setLocation] = useState(event.location ?? "");
  const [tz, setTz] = useState(event.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone);
  const [saving, setSaving] = useState(false);
  return (
    <div
      style={{ position: "fixed", inset: 0, zIndex: 90, background: "rgba(0, 0, 0, 0.5)", display: "grid", placeItems: "center" }}
      onClick={onClose}
    >
      <div className="panel" style={{ width: 430, maxWidth: "92vw", display: "grid", gap: 12 }} onClick={(e) => e.stopPropagation()}>
        <strong>Event location</strong>
        <div>
          <label className="field-label">Event location</label>
          <input className="input" autoFocus value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Main arena, Sydney" style={{ width: "100%" }} />
        </div>
        <TimezoneField value={tz} onChange={setTz} atDate={event.startDate} />
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button className="btn btn-ghost" type="button" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            type="button"
            disabled={!isValidTimeZone(tz) || saving}
            onClick={() => {
              setSaving(true);
              void api
                .patchEvent(event.id, { location, timezone: tz })
                .then(onSaved)
                .catch((err) => {
                  window.alert(String(err));
                  setSaving(false);
                });
            }}
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
