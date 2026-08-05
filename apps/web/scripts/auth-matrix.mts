/**
 * Locked-server access-control matrix: 33 checks across the HTTP API (event
 * scoping per credential), the show channel (caller vs follower roles), and
 * the doc channel (read-only enforcement for view grants). Run it before
 * releases that touch auth.
 *
 * Usage (from repo root, with no other sync instance using .pglite):
 *   cd apps/sync && ADMIN_TOKEN=oc_test_admin ALLOW_DEV_JOIN=0 SYNC_PORT=8899 npx tsx src/server.ts &
 *   cd apps/web  && ../sync/node_modules/.bin/tsx scripts/auth-matrix.mts
 *
 * Creates its own fixtures (companies/events/users prefixed "Matrix") and
 * deletes them afterwards. Exits non-zero on any failure.
 */
import * as Y from "yjs";
import { HocuspocusProvider } from "@hocuspocus/provider";

const API = "http://localhost:8899";
const WS = "ws://localhost:8899";
const ADMIN = "oc_test_admin";

let pass = 0;
let fail = 0;
const check = (label: string, ok: boolean, detail?: unknown) => {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : "   ← " + JSON.stringify(detail)}`);
};

const req = async (path: string, token: string | null, init: RequestInit = {}) => {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await fetch(API + path, { ...init, headers });
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    /* non-JSON */
  }
  return { status: res.status, body: body as any };
};

// ── Fixtures (as admin) ───────────────────────────────────────────────────────
const company = await req("/companies", ADMIN, { method: "POST", body: JSON.stringify({ name: "Matrix Test Co" }) });
const companyToken: string = company.body.companyToken;
const eventA = await req("/events", ADMIN, { method: "POST", body: JSON.stringify({ name: "Matrix Event A", teamId: company.body.id }) });
const eventB = await req("/events", ADMIN, { method: "POST", body: JSON.stringify({ name: "Matrix Event B" }) });
const rdA = await req("/rundowns", ADMIN, { method: "POST", body: JSON.stringify({ eventId: eventA.body.id, name: "Matrix RD A" }) });
const rdB = await req("/rundowns", ADMIN, { method: "POST", body: JSON.stringify({ eventId: eventB.body.id, name: "Matrix RD B" }) });

const mkUser = async (name: string, grants: { kind: string; targetId?: string }[]) =>
  (await req("/users", ADMIN, { method: "POST", body: JSON.stringify({ name, grants }) })).body as { id: string; accessToken: string };

const viewer = await mkUser("Matrix Viewer", [{ kind: "view", targetId: eventA.body.id }]);
const eventMgr = await mkUser("Matrix EventMgr", [{ kind: "event", targetId: eventA.body.id }]);
const companyMgr = await mkUser("Matrix CompanyMgr", [{ kind: "company", targetId: company.body.id }]);
const superUser = await mkUser("Matrix Super", [{ kind: "admin" }]);

// ── HTTP API matrix ───────────────────────────────────────────────────────────
{
  const r = await req("/me", null);
  check("no token: /me → role null", r.body?.role === null && r.body?.devOpen !== true, r.body);
  check("no token: /events → 401", (await req("/events", null)).status === 401);
  check("no token: /users → 401", (await req("/users", null)).status === 401);
  check("bad token: /me → role null", (await req("/me", "usr_nonsense")).body?.role === null);
}
{
  const ev = await req("/events", ADMIN);
  const names = (ev.body as any[]).map((e) => e.name);
  check("admin: sees Event A and B", names.includes("Matrix Event A") && names.includes("Matrix Event B"), names);
}
{
  const ev = await req("/events", companyToken);
  const names = (ev.body as any[]).map((e) => e.name);
  check("company: sees ONLY its own events", names.includes("Matrix Event A") && !names.includes("Matrix Event B"), names);
  check("company: PATCH own event → 200", (await req(`/events/${eventA.body.id}`, companyToken, { method: "PATCH", body: JSON.stringify({ name: "Matrix Event A" }) })).status === 200);
  check("company: PATCH other event → 401", (await req(`/events/${eventB.body.id}`, companyToken, { method: "PATCH", body: JSON.stringify({ name: "nope" }) })).status === 401);
  check("company: /users (admin-only) → 401", (await req("/users", companyToken)).status === 401);
}
{
  const me = await req("/me", viewer.accessToken);
  check("viewer: /me → user, canManage false", me.body?.role === "user" && me.body?.canManage === false, me.body);
  const ev = await req("/events", viewer.accessToken);
  const names = (ev.body as any[]).map((e) => e.name);
  check("viewer: sees ONLY Event A", names.length === 1 && names[0] === "Matrix Event A", names);
  check("viewer: PATCH Event A → 401", (await req(`/events/${eventA.body.id}`, viewer.accessToken, { method: "PATCH", body: JSON.stringify({ name: "hax" }) })).status === 401);
  check("viewer: DELETE rundown → 401", (await req(`/rundowns/${rdA.body.id}`, viewer.accessToken, { method: "DELETE" })).status === 401);
  check("viewer: create rundown in A → 401", (await req("/rundowns", viewer.accessToken, { method: "POST", body: JSON.stringify({ eventId: eventA.body.id, name: "hax" }) })).status === 401);
}
{
  const ev = await req("/events", eventMgr.accessToken);
  const names = (ev.body as any[]).map((e) => e.name);
  check("eventMgr: sees ONLY Event A", names.length === 1 && names[0] === "Matrix Event A", names);
  check("eventMgr: PATCH Event A → 200", (await req(`/events/${eventA.body.id}`, eventMgr.accessToken, { method: "PATCH", body: JSON.stringify({ name: "Matrix Event A" }) })).status === 200);
  check("eventMgr: PATCH Event B → 401", (await req(`/events/${eventB.body.id}`, eventMgr.accessToken, { method: "PATCH", body: JSON.stringify({ name: "hax" }) })).status === 401);
}
{
  const ev = await req("/events", companyMgr.accessToken);
  const names = (ev.body as any[]).map((e) => e.name);
  check("companyMgr: sees company's Event A", names.includes("Matrix Event A") && !names.includes("Matrix Event B"), names);
  check("companyMgr: PATCH Event A → 200", (await req(`/events/${eventA.body.id}`, companyMgr.accessToken, { method: "PATCH", body: JSON.stringify({ name: "Matrix Event A" }) })).status === 200);
}
{
  const me = await req("/me", superUser.accessToken);
  check("admin-grant user: /me → admin", me.body?.role === "admin", me.body);
  const ev = await req("/events", superUser.accessToken);
  check("admin-grant user: sees everything", (ev.body as any[]).some((e) => e.name === "Matrix Event B"));
}
{
  const rotated = await req(`/users/${viewer.id}/rotate-token`, ADMIN, { method: "POST" });
  const oldMe = await req("/me", viewer.accessToken);
  const newMe = await req("/me", rotated.body.accessToken);
  check("rotate: old token dead", oldMe.body?.role === null, oldMe.body);
  check("rotate: new token works", newMe.body?.role === "user", newMe.body);
  viewer.accessToken = rotated.body.accessToken;
}

// ── Show channel ──────────────────────────────────────────────────────────────
type ShowResult = { welcome?: any; cmdReply?: any; closed?: { code: number; reason: string } };
const showChannel = (rundownId: string, token: string, sendCmd: boolean): Promise<ShowResult> =>
  new Promise((resolve) => {
    const out: ShowResult = {};
    const ws = new WebSocket(`${WS}/?rundown=${rundownId}`);
    const timer = setTimeout(() => {
      ws.close();
      resolve(out);
    }, 4000);
    ws.addEventListener("open", () => {
      ws.send(JSON.stringify({ v: 1, t: "hello", auth: { kind: "session", token }, device: "console" }));
    });
    ws.addEventListener("message", (e) => {
      const msg = JSON.parse(String(e.data));
      if (msg.t === "welcome") {
        out.welcome = msg;
        if (sendCmd) ws.send(JSON.stringify({ v: 1, t: "cmd", id: "t-" + Math.random(), action: "start" }));
        else {
          clearTimeout(timer);
          ws.close();
          resolve(out);
        }
      }
      if (msg.t === "cmd_error" || msg.t === "show_state") {
        out.cmdReply = msg;
        clearTimeout(timer);
        ws.close();
        resolve(out);
      }
    });
    ws.addEventListener("close", (e) => {
      out.closed = { code: e.code, reason: String(e.reason) };
      clearTimeout(timer);
      resolve(out);
    });
  });

{
  const r = await showChannel(rdA.body.id, viewer.accessToken, true);
  check("show: viewer → follower role", r.welcome?.role === "follower", r);
  check("show: viewer cmd rejected", r.cmdReply?.t === "cmd_error", r.cmdReply);
}
{
  const r = await showChannel(rdA.body.id, eventMgr.accessToken, true);
  check("show: eventMgr → caller role", r.welcome?.role === "caller", r.welcome);
  check("show: eventMgr can start show", r.cmdReply?.t === "show_state" && r.cmdReply?.state === "running", r.cmdReply);
  // stop the show again (confirm required)
  await new Promise<void>((done) => {
    const ws = new WebSocket(`${WS}/?rundown=${rdA.body.id}`);
    ws.addEventListener("open", () => ws.send(JSON.stringify({ v: 1, t: "hello", auth: { kind: "session", token: ADMIN }, device: "console" })));
    ws.addEventListener("message", (e) => {
      const msg = JSON.parse(String(e.data));
      if (msg.t === "welcome") ws.send(JSON.stringify({ v: 1, t: "cmd", id: "t-stop", action: "stop", confirm: true }));
      if (msg.t === "show_state") {
        ws.close();
        done();
      }
    });
    setTimeout(done, 3000);
  });
}
{
  const r = await showChannel(rdB.body.id, viewer.accessToken, false);
  check("show: viewer on ungranted rundown → rejected", !r.welcome && r.closed != null, r);
}
{
  const r = await showChannel(rdB.body.id, "DEV123", false);
  check("show: bad session token → rejected", !r.welcome, r.welcome);
}

// ── Doc channel ───────────────────────────────────────────────────────────────
const docConnect = (rundownId: string, token: string) => {
  const doc = new Y.Doc();
  const state = { authed: false, failed: false };
  const provider = new HocuspocusProvider({
    url: `${WS}/doc`,
    name: rundownId,
    document: doc,
    token,
    onAuthenticated: () => (state.authed = true),
    onAuthenticationFailed: () => (state.failed = true),
  });
  return { doc, provider, state };
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

{
  // Admin watches the doc; viewer connects read-only and attempts a write.
  const adminConn = docConnect(rdA.body.id, ADMIN);
  const viewerConn = docConnect(rdA.body.id, viewer.accessToken);
  await sleep(1500);
  check("doc: viewer authenticates (read allowed)", viewerConn.state.authed && !viewerConn.state.failed, viewerConn.state);
  const nameBefore = adminConn.doc.getMap("meta").get("name");
  viewerConn.doc.getMap("meta").set("name", "HACKED BY VIEWER");
  await sleep(1500);
  const nameAfter = adminConn.doc.getMap("meta").get("name");
  check("doc: viewer write NOT propagated (read-only)", nameAfter === nameBefore, { nameBefore, nameAfter });

  // Manager write DOES propagate.
  const mgrConn = docConnect(rdA.body.id, eventMgr.accessToken);
  await sleep(1200);
  mgrConn.doc.getMap("meta").set("versionLabel", "MGR-WRITE-OK");
  await sleep(1500);
  check("doc: manager write propagates", adminConn.doc.getMap("meta").get("versionLabel") === "MGR-WRITE-OK", adminConn.doc.getMap("meta").get("versionLabel"));

  adminConn.provider.destroy();
  viewerConn.provider.destroy();
  mgrConn.provider.destroy();
}
{
  const conn = docConnect(rdB.body.id, viewer.accessToken);
  await sleep(1500);
  check("doc: viewer on ungranted rundown → auth failed", conn.state.failed && !conn.state.authed, conn.state);
  conn.provider.destroy();
}

// ── Cleanup fixtures ──────────────────────────────────────────────────────────
for (const u of [viewer, eventMgr, companyMgr, superUser]) await req(`/users/${u.id}`, ADMIN, { method: "DELETE" });
await req(`/events/${eventB.body.id}`, ADMIN, { method: "DELETE" });
await req(`/companies/${company.body.id}`, ADMIN, { method: "DELETE" });

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
