"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";

/**
 * App shell with the persistent left settings panel: navigation (main page,
 * dashboard) plus every settings feature the current screen offers, then the
 * page content offset beside it. Collapsible; the state persists per browser.
 * What appears inside is already scoped by the server — a company credential
 * only ever sees its own data, admin sees all.
 */
export function WithSideNav({
  title,
  settings,
  children,
}: {
  title?: string;
  settings?: ReactNode;
  children: ReactNode;
}) {
  // Closed by default — opens only when this browser explicitly opened it
  // before, and never auto-opens on small screens (it overlays the content).
  const [open, setOpen] = useState(false);
  useEffect(() => {
    setOpen(window.innerWidth > 760 && localStorage.getItem("oc:sidenav") === "1");
  }, []);
  const toggle = () => {
    const next = !open;
    setOpen(next);
    localStorage.setItem("oc:sidenav", next ? "1" : "0");
  };

  return (
    <>
      <button
        className="btn btn-sm sidenav-toggle no-print"
        onClick={toggle}
        title={open ? "Collapse panel" : "Open settings panel"}
        style={{ left: open ? 208 : 10 }}
      >
        {open ? "◂" : "▸"}
      </button>
      <aside className={`sidenav no-print ${open ? "" : "closed"}`}>
        <Link href="/" className="sidenav-brand">
          OpenCall
        </Link>
        {title && <div className="sidenav-title">{title}</div>}
        <nav className="sidenav-section">
          <div className="menu-heading">Navigate</div>
          <Link className="menu-item" href="/">
            <span className="check" />
            Login
          </Link>
          <Link className="menu-item" href="/admin">
            <span className="check" />
            Dashboard
          </Link>
        </nav>
        {settings}
      </aside>
      <div className={`with-sidenav ${open ? "" : "sidenav-closed"}`}>{children}</div>
    </>
  );
}

/** A titled group of settings entries inside the panel. */
export function SideNavSection({ heading, children }: { heading: string; children: ReactNode }) {
  return (
    <div className="sidenav-section">
      <div className="menu-heading">{heading}</div>
      {children}
    </div>
  );
}
