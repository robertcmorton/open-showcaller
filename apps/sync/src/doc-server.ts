import { Server, type Hocuspocus } from "@hocuspocus/server";
import * as Y from "yjs";
import { eq } from "drizzle-orm";
import { schema, type DbHandle } from "@opencall/db";
import { adminToken, isOpenAccess, resolveBearer, resolveJoinCode, teamIdForRundown } from "./auth";

/**
 * Yjs document sync with Postgres/PGlite write-through. Hocuspocus debounces
 * onStoreDocument — matching the persistence strategy in docs/DATA-MODEL.md §3.
 *
 * No own listener: doc connections arrive on the shared HTTP server's
 * `/doc` upgrade path (single public port — see server.ts).
 *
 * Access (when ADMIN_TOKEN is set): the provider's `token` must be the admin
 * token or a valid join code for this document's rundown. Follower codes get
 * a READ-ONLY connection; caller/editor codes may write. Guests never reach
 * this channel at all (they get the filtered HTTP projection).
 */
export function createDocServer(handle: DbHandle): Hocuspocus {
  return Server.configure({
    async onAuthenticate({ documentName, token, connection }) {
      if (isOpenAccess()) return; // dev-open deployment
      if (token && token === adminToken()) return;
      if (token) {
        const bearer = await resolveBearer(handle, token);
        if (bearer?.kind === "company" && (await teamIdForRundown(handle, documentName)) === bearer.teamId) return;
        const resolved = await resolveJoinCode(handle, token, documentName);
        if (resolved) {
          if (resolved.role === "follower") connection.readOnly = true;
          return;
        }
      }
      throw new Error("doc auth failed");
    },
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
