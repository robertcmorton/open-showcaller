"use client";

import Link from "next/link";
import type { DocBlock } from "../lib/useRundownDoc";

/**
 * What a screen shows once the server has refused for good.
 *
 * The alternative — and what this replaces — is a spinner that never stops,
 * which tells the person holding the device nothing and gives them nothing to
 * do about it. Every refusal here names the fault, names whose sign-in was
 * used, and offers the one action that will actually fix it.
 */
export function DocBlockedPanel({ block, rundownPath }: { block: DocBlock; rundownPath: string }) {
  return (
    <div className="empty no-print">
      <div className="glyph">⚠</div>
      <div style={{ fontWeight: 600 }}>{block.title}</div>
      <div style={{ color: "var(--text-2)", fontSize: "var(--fs-sm)", marginTop: 6, maxWidth: "44ch", marginInline: "auto" }}>
        {block.detail}
      </div>
      {block.identity && (
        <div style={{ color: "var(--text-3)", fontSize: "var(--fs-xs)", marginTop: 8 }}>
          This device's sign-in: {block.identity}
        </div>
      )}
      <div style={{ display: "flex", gap: 8, justifyContent: "center", marginTop: 14, flexWrap: "wrap" }}>
        {block.action === "sign-in" && (
          <Link className="btn btn-primary" href={`/?next=${encodeURIComponent(rundownPath)}`}>
            Sign in on this device
          </Link>
        )}
        {(block.action === "reload" || block.action === "ask-for-access") && (
          <button type="button" className="btn" onClick={() => window.location.reload()}>
            Try again
          </button>
        )}
      </div>
      <div style={{ color: "var(--text-3)", fontSize: "var(--fs-xs)", marginTop: 10 }}>Code: {block.reason}</div>
    </div>
  );
}
