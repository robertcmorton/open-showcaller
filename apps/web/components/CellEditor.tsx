"use client";

import { useEffect, useRef, useState, type MutableRefObject } from "react";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Collaboration from "@tiptap/extension-collaboration";
import Underline from "@tiptap/extension-underline";
import Highlight from "@tiptap/extension-highlight";
import Link from "@tiptap/extension-link";
import type * as Y from "yjs";

function FormatButton({
  editor,
  label,
  title,
  active,
  onRun,
}: {
  editor: Editor;
  label: React.ReactNode;
  title: string;
  active: boolean;
  onRun: () => void;
}) {
  return (
    <button
      type="button"
      title={title}
      className={active ? "is-on" : ""}
      // mousedown so the cell editor never loses focus/selection
      onMouseDown={(e) => {
        e.preventDefault();
        onRun();
        editor.chain().focus().run();
      }}
    >
      {label}
    </button>
  );
}

function FormatBar({ editor, suppressBlur }: { editor: Editor; suppressBlur: MutableRefObject<boolean> }) {
  // Re-render on selection/transaction so active states stay current.
  const [, bump] = useState(0);
  useEffect(() => {
    const update = () => bump((n) => n + 1);
    editor.on("transaction", update);
    editor.on("selectionUpdate", update);
    return () => {
      editor.off("transaction", update);
      editor.off("selectionUpdate", update);
    };
  }, [editor]);

  const setLink = () => {
    // window.prompt blurs the editor; keep the cell open through it.
    suppressBlur.current = true;
    const prev = editor.getAttributes("link").href as string | undefined;
    const url = window.prompt("Link URL (empty to remove)", prev ?? "https://");
    if (url !== null) {
      if (url === "" || url === "https://") editor.chain().focus().unsetLink().run();
      else editor.chain().focus().setLink({ href: url }).run();
    }
    setTimeout(() => {
      suppressBlur.current = false;
      editor.chain().focus().run();
    }, 0);
  };

  return (
    <div className="format-bar" style={{ bottom: "calc(100% + 4px)", left: 0 }}>
      <FormatButton editor={editor} title="Bold" label={<strong>B</strong>} active={editor.isActive("bold")} onRun={() => editor.chain().toggleBold().run()} />
      <FormatButton editor={editor} title="Italic" label={<em>I</em>} active={editor.isActive("italic")} onRun={() => editor.chain().toggleItalic().run()} />
      <FormatButton editor={editor} title="Underline" label={<span style={{ textDecoration: "underline" }}>U</span>} active={editor.isActive("underline")} onRun={() => editor.chain().toggleUnderline().run()} />
      <FormatButton editor={editor} title="Strikethrough" label={<s>S</s>} active={editor.isActive("strike")} onRun={() => editor.chain().toggleStrike().run()} />
      <FormatButton editor={editor} title="Highlight" label={<span style={{ background: "var(--warn-soft)", color: "var(--warn)", borderRadius: 2, padding: "0 3px" }}>H</span>} active={editor.isActive("highlight")} onRun={() => editor.chain().toggleHighlight().run()} />
      <FormatButton editor={editor} title="Link" label={<span>🔗</span>} active={editor.isActive("link")} onRun={setLink} />
      <FormatButton editor={editor} title="Clear formatting" label={<span>⌫</span>} active={false} onRun={() => editor.chain().unsetAllMarks().run()} />
    </div>
  );
}

/** TipTap editor bound to one cell's Y.XmlFragment. Mounted only for the active cell. */
export function CellEditor({ fragment, onDone }: { fragment: Y.XmlFragment; onDone: () => void }) {
  const suppressBlur = useRef(false);
  const editor = useEditor({
    immediatelyRender: false,
    autofocus: "end",
    extensions: [
      StarterKit.configure({ history: false }),
      Underline,
      Highlight,
      Link.configure({ openOnClick: false }),
      Collaboration.configure({ fragment }),
    ],
    onBlur: () => {
      if (!suppressBlur.current) onDone();
    },
    editorProps: {
      attributes: { class: "cell-editor" },
      handleKeyDown: (_view, event) => {
        if (event.key === "Escape") {
          onDone();
          return true;
        }
        return false;
      },
    },
  });

  return (
    <div style={{ position: "relative" }}>
      {editor && <FormatBar editor={editor} suppressBlur={suppressBlur} />}
      <EditorContent editor={editor} />
    </div>
  );
}
