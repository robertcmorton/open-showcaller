"use client";

import { useId, useMemo, useState } from "react";
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
  const listId = useId();
  const zones = useMemo(
    () => (typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : []),
    [],
  );
  const valid = isValidTimeZone(value);
  const previewMs = atDate ? Date.parse(`${atDate}T12:00:00`) : Date.now();
  return (
    <div>
      <label className="field-label">{label}</label>
      <input
        className="input"
        list={listId}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Australia/Sydney"
        style={{ minWidth: 230 }}
      />
      <datalist id={listId}>
        {zones.map((z) => (
          <option key={z} value={z} />
        ))}
      </datalist>
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
          : "Pick a zone from the list — type a city, e.g. Australia/Sydney."}
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
        <strong>Location &amp; timezone</strong>
        <div>
          <label className="field-label">Location</label>
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
