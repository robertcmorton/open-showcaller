import { computeTiming, formatDuration, formatTimeOfDay, type PlanRow } from "@open-showcaller/core";

const demo: { row: PlanRow; title: string }[] = [
  { row: { id: "1", type: "group", durationSec: null, hardStartSec: 9 * 3600 }, title: "Walk in" },
  { row: { id: "2", type: "cue", durationSec: 90, hardStartSec: null }, title: "Welcome & Applause" },
  { row: { id: "3", type: "cue", durationSec: 90, hardStartSec: null }, title: "Acknowledge Remote Attendance" },
  { row: { id: "4", type: "cue", durationSec: 180, hardStartSec: null }, title: "Highlight Reel" },
  { row: { id: "5", type: "cue", durationSec: 120, hardStartSec: null }, title: "Announcements" },
];

export default function Home() {
  const timing = computeTiming(demo.map((d) => d.row));

  return (
    <main style={{ maxWidth: 720, margin: "0 auto", padding: "4rem 1.5rem" }}>
      <h1 style={{ fontSize: "1.6rem", marginBottom: 4 }}>Open Showcaller</h1>
      <p style={{ color: "#9a9a9a", marginTop: 0 }}>
        Phase 1 scaffold — monorepo, timing engine, protocol, schema, sync server.
      </p>

      <table style={{ borderCollapse: "collapse", width: "100%", marginTop: "2rem", fontVariantNumeric: "tabular-nums" }}>
        <thead>
          <tr style={{ textAlign: "left", color: "#9a9a9a", fontSize: "0.8rem" }}>
            <th style={{ padding: "6px 8px" }}>#</th>
            <th style={{ padding: "6px 8px" }}>Title</th>
            <th style={{ padding: "6px 8px" }}>Start</th>
            <th style={{ padding: "6px 8px" }}>Duration</th>
          </tr>
        </thead>
        <tbody>
          {demo.map((d, i) => {
            const t = timing.rows[i]!;
            const isGroup = d.row.type === "group";
            return (
              <tr key={d.row.id} style={{ background: isGroup ? "#241f16" : "transparent", borderTop: "1px solid #222" }}>
                <td style={{ padding: "8px", color: "#777" }}>{i + 1}</td>
                <td style={{ padding: "8px", fontWeight: isGroup ? 600 : 400 }}>{d.title}</td>
                <td style={{ padding: "8px", fontFamily: "ui-monospace, monospace" }}>
                  {t.startSec != null ? formatTimeOfDay(t.startSec) : "—"}
                </td>
                <td style={{ padding: "8px", fontFamily: "ui-monospace, monospace" }}>
                  {d.row.durationSec != null ? formatDuration(d.row.durationSec) : ""}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <p style={{ color: "#666", fontSize: "0.85rem", marginTop: "2rem" }}>
        Planned: start {formatTimeOfDay(timing.startSec ?? 0)} · dur {formatDuration(timing.totalDurationSec)} · end{" "}
        {formatTimeOfDay(timing.endSec ?? 0)} — computed live by @open-showcaller/core.
      </p>
    </main>
  );
}
