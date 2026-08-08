import { Server, type Hocuspocus } from "@hocuspocus/server";
import * as Y from "yjs";
import { eq } from "drizzle-orm";
import { schema, type DbHandle } from "@opencall/db";
import { adminToken, canManageEvent, canSeeEvent, isOpenAccess, resolveBearer, resolveJoinCode, teamIdForRundown } from "./auth";

/**
 * Doc names are `<rundownId>@<epoch>`. In-place restore bumps the rundown's
 * epoch, so stale clients (still holding pre-restore CRDT state) can neither
 * reconnect nor persist — their state can never merge back. Bare ids are
 * treated as epoch 0 for clients from before this scheme.
 */
export function parseDocName(name: string): { rundownId: string; epoch: number } {
  const at = name.lastIndexOf("@");
  if (at < 0) return { rundownId: name, epoch: 0 };
  const epoch = Number(name.slice(at + 1));
  return Number.isInteger(epoch) && epoch >= 0 ? { rundownId: name.slice(0, at), epoch } : { rundownId: name, epoch: 0 };
}

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
/**
 * Refuses a document connection with a reason the client can SHOW someone.
 *
 * Hocuspocus forwards `error.reason` to the browser verbatim and falls back to
 * the useless string "permission-denied" when it is absent — so a plain thrown
 * message never reaches the person staring at a screen that will not load.
 * These strings are read off phones in venues: they name the fault, never a
 * credential, and are safe to show to whoever is holding the device.
 */
const refuse = (reason: DocRefusal): never => {
  throw Object.assign(new Error(reason), { reason });
};

/** Why a document connection was refused. The client maps these to plain words. */
export type DocRefusal =
  | "no-such-rundown"
  | "sheet-restored-reload"
  | "not-signed-in"
  | "signin-not-recognised"
  | "no-access-for-this-account";

export function createDocServer(handle: DbHandle): Hocuspocus {
  const currentEpoch = async (rundownId: string): Promise<number | null> => {
    const row = await handle.db.query.rundowns.findFirst({
      where: eq(schema.rundowns.id, rundownId),
      columns: { docEpoch: true },
    });
    return row?.docEpoch ?? null;
  };

  return Server.configure({
    async onAuthenticate({ documentName, token, connection }) {
      const { rundownId, epoch } = parseDocName(documentName);
      const liveEpoch = await currentEpoch(rundownId);
      if (liveEpoch == null) refuse("no-such-rundown");
      if (epoch !== liveEpoch) refuse("sheet-restored-reload");
      if (isOpenAccess()) return; // dev-open deployment
      if (token && token === adminToken()) return;
      // "dev" is what a client with no stored credential sends; on a locked
      // deployment that is simply nobody, and saying so is the whole point.
      if (token && token !== "dev") {
        const bearer = await resolveBearer(handle, token);
        if (bearer?.kind === "company" && (await teamIdForRundown(handle, rundownId)) === bearer.teamId) return;
        if (bearer?.kind === "user") {
          const rundown = await handle.db.query.rundowns.findFirst({
            where: eq(schema.rundowns.id, rundownId),
            columns: { eventId: true },
          });
          if (rundown) {
            if (await canManageEvent(handle, bearer, rundown.eventId)) return;
            const event = await handle.db.query.events.findFirst({
              where: eq(schema.events.id, rundown.eventId),
              columns: { teamId: true },
            });
            if (event && (await canSeeEvent(handle, bearer, rundown.eventId, event.teamId))) {
              connection.readOnly = true;
              return;
            }
          }
        }
        const resolved = await resolveJoinCode(handle, token, rundownId);
        if (resolved) {
          if (resolved.role === "follower") connection.readOnly = true;
          return;
        }
        // A credential that resolves to somebody but carries no grant for this
        // sheet is a different problem from one the server does not know at
        // all — the first needs access, the second needs a fresh sign-in.
        refuse(bearer ? "no-access-for-this-account" : "signin-not-recognised");
      }
      refuse("not-signed-in");
    },
    async onLoadDocument({ documentName, document }) {
      const { rundownId } = parseDocName(documentName);
      const row = await handle.db.query.rundowns.findFirst({
        where: eq(schema.rundowns.id, rundownId),
        columns: { doc: true },
      });
      if (row?.doc) Y.applyUpdate(document, row.doc);
      return document;
    },
    async onStoreDocument({ documentName, document }) {
      const { rundownId, epoch } = parseDocName(documentName);
      // A store from a pre-restore document must never clobber the restored doc.
      if ((await currentEpoch(rundownId)) !== epoch) return;
      await handle.db
        .update(schema.rundowns)
        .set({ doc: Y.encodeStateAsUpdate(document), docUpdatedAt: new Date(), updatedAt: new Date() })
        .where(eq(schema.rundowns.id, rundownId));
    },
  });
}
