import { Server } from "@hocuspocus/server";
import * as Y from "yjs";
import { eq } from "drizzle-orm";
import { schema, type DbHandle } from "@open-showcaller/db";

/**
 * Yjs document sync with Postgres/PGlite write-through. Hocuspocus debounces
 * onStoreDocument (2 s quiet / 10 s max by default) — matching the persistence
 * strategy in docs/DATA-MODEL.md §3.
 *
 * Phase-2 note: runs on its own port. Phase 4 folds doc frames and the show
 * channel onto one socket per PROTOCOL.md §0, plus real auth in onAuthenticate.
 */
export function createDocServer(handle: DbHandle, port: number) {
  return Server.configure({
    port,
    async onLoadDocument({ documentName, document }) {
      const row = await handle.db.query.rundowns.findFirst({
        where: eq(schema.rundowns.id, documentName),
        columns: { doc: true },
      });
      if (row?.doc) Y.applyUpdate(document, row.doc);
      return document;
    },
    async onStoreDocument({ documentName, document }) {
      await handle.db
        .update(schema.rundowns)
        .set({ doc: Y.encodeStateAsUpdate(document), docUpdatedAt: new Date(), updatedAt: new Date() })
        .where(eq(schema.rundowns.id, documentName));
    },
  });
}
