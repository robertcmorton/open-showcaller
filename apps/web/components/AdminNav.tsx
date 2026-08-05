"use client";

import Link from "next/link";
import { SideNavSection } from "./SideNav";

/**
 * Admin-only sidebar section: each tool lives on its own page rather than
 * stacking onto the events dashboard.
 */
export function AdminNavSection({ active }: { active?: "users" | "errors" }) {
  return (
    <SideNavSection heading="Admin">
      <Link className="menu-item" href="/admin/users">
        <span className="check">{active === "users" && "✓"}</span>
        Users &amp; access
      </Link>
      <Link className="menu-item" href="/admin/errors">
        <span className="check">{active === "errors" && "✓"}</span>
        Error log
      </Link>
    </SideNavSection>
  );
}
