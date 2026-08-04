import { Server, type Hocuspocus } from "@hocuspocus/server";
import * as Y from "yjs";
import { eq } from "drizzle-orm";
import { schema, type DbHandle } from "@open-showcaller/db";

/**
 * Yjs document sync with Postgres/PGlite write-through. Hocuspocus debounces
 * onStoreDocument — matching the persistence strategy in docs/DATA-MODEL.md §3.
 *
 * No own listener: doc connections arrive on the shared HTTP server's
 * `/doc` upgrade path (single public port — see server.ts).
 */
export function createDocServer(handle: DbHandle): Hocuspocus {
  return Server.configure({
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
