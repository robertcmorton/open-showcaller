"use client";

/**
 * Quiet build identity, bottom-right of the dashboard: version · commit ·
 * build date. Answers "which build is this deployment actually running?"
 * at a glance — click to copy the full string for bug reports.
 */
export function VersionBadge() {
  const version = process.env.NEXT_PUBLIC_APP_VERSION ?? "0.0.0";
  const sha = process.env.NEXT_PUBLIC_BUILD_SHA ?? "unknown";
  const date = process.env.NEXT_PUBLIC_BUILD_DATE ?? "";
  const full = `OpenCall v${version} · ${sha}${date ? ` · built ${date}` : ""}`;
  return (
    <button
      type="button"
      className="no-print"
      title={`${full} — click to copy`}
      onClick={() => void navigator.clipboard?.writeText(full).catch(() => undefined)}
      style={{
        position: "fixed",
        right: 12,
        bottom: 8,
        zIndex: 30,
        background: "none",
        border: "none",
        padding: "2px 4px",
        cursor: "pointer",
        font: "inherit",
        fontSize: 11,
        letterSpacing: "0.02em",
        color: "var(--text-3)",
        opacity: 0.75,
      }}
    >
      v{version} · {sha}
    </button>
  );
}
