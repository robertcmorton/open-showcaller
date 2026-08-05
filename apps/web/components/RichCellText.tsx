"use client";

import { Fragment, type ReactNode } from "react";

// The cell XML → React, allowlist only: unknown elements contribute their
// text but never markup, so nothing document-authored can inject structure.
const MARK_TAGS: Record<string, (children: ReactNode, key: number) => ReactNode> = {
  bold: (c, k) => <strong key={k}>{c}</strong>,
  strong: (c, k) => <strong key={k}>{c}</strong>,
  italic: (c, k) => <em key={k}>{c}</em>,
  em: (c, k) => <em key={k}>{c}</em>,
  underline: (c, k) => <u key={k}>{c}</u>,
  u: (c, k) => <u key={k}>{c}</u>,
  strike: (c, k) => <s key={k}>{c}</s>,
  s: (c, k) => <s key={k}>{c}</s>,
  highlight: (c, k) => (
    <mark key={k} style={{ background: "var(--warn-soft)", color: "var(--warn)", borderRadius: 2, padding: "0 2px" }}>
      {c}
    </mark>
  ),
  mark: (c, k) => <mark key={k}>{c}</mark>,
  link: (c, k) => (
    <span key={k} style={{ color: "var(--accent-text)", textDecoration: "underline" }}>
      {c}
    </span>
  ),
};

function walk(node: Node, key: number): ReactNode {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent;
  if (node.nodeType !== Node.ELEMENT_NODE) return null;
  const children = [...node.childNodes].map((child, i) => <Fragment key={i}>{walk(child, i)}</Fragment>);
  const tag = (node as Element).tagName.toLowerCase();
  const mark = MARK_TAGS[tag];
  if (mark) return mark(children, key);
  if (tag === "paragraph" || tag === "p") return <Fragment key={key}>{children}{"\n"}</Fragment>;
  return <Fragment key={key}>{children}</Fragment>; // unknown wrapper → text only
}

/** Renders a formatted cell's XML (bold/underline/highlight…) outside the editor. */
export function RichCellText({ xml }: { xml: string }) {
  if (typeof window === "undefined") return null; // grid renders client-side anyway
  const parsed = new DOMParser().parseFromString(`<root>${xml}</root>`, "text/xml");
  if (parsed.querySelector("parsererror")) return <>{xml.replace(/<[^>]+>/g, "")}</>;
  const out = walk(parsed.documentElement, 0);
  return <>{out}</>;
}
