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

// Angle brackets a person typed — "<player name>", "<Captain to speak>" — are
// content, not markup. Escaping everything that is not one of the editor's own
// marks keeps that text on screen instead of feeding it to the XML parser,
// which would swallow it as an unknown element.
const EDITOR_TAG_OPEN = /^<\/?(?:paragraph|p|bold|italic|underline|strike|highlight|link|strong|em|u|s|mark)(?:\s[^<>]*)?\/?>/i;

function escapeStrayAngles(xml: string): string {
  let out = "";
  for (let i = 0; i < xml.length; i++) {
    if (xml[i] !== "<") {
      out += xml[i];
      continue;
    }
    const rest = xml.slice(i);
    const tag = rest.match(EDITOR_TAG_OPEN);
    if (tag) {
      out += tag[0];
      i += tag[0].length - 1;
    } else {
      out += "&lt;";
    }
  }
  return out;
}

/** Renders a formatted cell's XML (bold/underline/highlight…) outside the editor. */
export function RichCellText({ xml }: { xml: string }) {
  if (typeof window === "undefined") return null; // grid renders client-side anyway
  const safe = escapeStrayAngles(xml);
  const parsed = new DOMParser().parseFromString(`<root>${safe}</root>`, "text/xml");
  if (parsed.querySelector("parsererror")) return <>{safe.replace(EDITOR_TAG_OPEN, "").replace(/&lt;/g, "<")}</>;
  const out = walk(parsed.documentElement, 0);
  return <>{out}</>;
}
