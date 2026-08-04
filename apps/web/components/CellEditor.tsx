"use client";

import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Collaboration from "@tiptap/extension-collaboration";
import type * as Y from "yjs";

/** TipTap editor bound to one cell's Y.XmlFragment. Mounted only for the active cell. */
export function CellEditor({ fragment, onDone }: { fragment: Y.XmlFragment; onDone: () => void }) {
  const editor = useEditor({
    immediatelyRender: false,
    autofocus: "end",
    extensions: [
      StarterKit.configure({ history: false }),
      Collaboration.configure({ fragment }),
    ],
    onBlur: onDone,
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

  return <EditorContent editor={editor} />;
}
