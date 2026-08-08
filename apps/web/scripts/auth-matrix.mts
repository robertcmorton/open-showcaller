/**
 * Locked-server access-control matrix: 68 checks across the HTTP API (event
 * scoping per credential), the show channel (caller vs follower roles), and
 * the doc channel (read-only enforcement for view grants, and the refusal
 * REASON each rejection carries back). Run it before releases that touch auth.
 *
 * Usage (from repo root). PGLITE_DIR gives the test instance its own database,
 * so the dev server can keep running on the repo's .pglite:
 *   cd apps/sync && PGLITE_DIR=/tmp/matrix.pglite ADMIN_TOKEN=oc_test_admin \
 *     ALLOW_DEV_JOIN=0 SYNC_PORT=8899 npx tsx src/server.ts &
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
// Event B must sit in a DIFFERENT company — that is the whole point of the
// scoping checks. Naming its company explicitly matters: an event created with
// no teamId falls back to the first team in the table, which on an empty
// database is Matrix Test Co, and the scoping checks would then be testing
// nothing while appearing to pass.
const otherCompany = await req("/companies", ADMIN, { method: "POST", body: JSON.stringify({ name: "Matrix Other Co" }) });
const eventB = await req("/events", ADMIN, { method: "POST", body: JSON.stringify({ name: "Matrix Event B", teamId: otherCompany.body.id }) });
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
  // Company-level access creates events; narrower grants must not.
  const made = await req("/events", companyMgr.accessToken, {
    method: "POST",
    body: JSON.stringify({ name: "Matrix CompanyMgr Event", teamId: company.body.id, startDate: "2026-08-08", endDate: "2026-08-08" }),
  });
  check("companyMgr: creates an event in its company → 201", made.status === 201, made.body);
  const seen = (await req("/events", companyMgr.accessToken)).body as any[];
  check("companyMgr: the new event is visible to it", seen.some((e) => e.id === made.body?.id), seen.map((e: any) => e.name));
  const foreign = await req("/events", companyMgr.accessToken, {
    method: "POST",
    body: JSON.stringify({ name: "Matrix Elsewhere", teamId: eventB.body.teamId ?? "team-nope", startDate: "2026-08-08", endDate: "2026-08-08" }),
  });
  check("companyMgr: cannot create in another company → 403", foreign.status === 403, foreign.body);
  check(
    "eventMgr: event-only grant cannot create events → 401",
    (await req("/events", eventMgr.accessToken, { method: "POST", body: JSON.stringify({ name: "Matrix Nope", startDate: "2026-08-08", endDate: "2026-08-08" }) })).status === 401,
  );
  check(
    "viewer: view grant cannot create events → 401",
    (await req("/events", viewer.accessToken, { method: "POST", body: JSON.stringify({ name: "Matrix Nope 2", startDate: "2026-08-08", endDate: "2026-08-08" }) })).status === 401,
  );
  if (made.body?.id) await req(`/events/${made.body.id}`, ADMIN, { method: "DELETE" });
}
{
  const me = await req("/me", superUser.accessToken);
  check("admin-grant user: /me → admin", me.body?.role === "admin", me.body);
  check("admin-grant user: /me names the account", me.body?.name === "Matrix Super", me.body);
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
  // The REASON matters as much as the refusal: it is what a stranded phone
  // shows its holder, so a wrong or missing one is a real defect.
  const state = { authed: false, failed: false, reason: null as string | null };
  const provider = new HocuspocusProvider({
    url: `${WS}/doc`,
    name: rundownId,
    document: doc,
    token,
    onAuthenticated: () => (state.authed = true),
    onAuthenticationFailed: ({ reason }: { reason?: string }) => {
      state.failed = true;
      state.reason = reason ?? null;
    },
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
  check("doc: refusal names the cause (no access)", conn.state.reason === "no-access-for-this-account", conn.state.reason);
  conn.provider.destroy();
}
{
  // An account holding the admin grant must work on the LIVE CHANNELS, not
  // only over HTTP. Signing in as an admin account and being refused the sheet
  // (while /me cheerfully answered "admin") is exactly the failure that sent a
  // phone into an endless load; the raw ADMIN_TOKEN string had masked it.
  const conn = docConnect(rdB.body.id, superUser.accessToken);
  await sleep(1500);
  check("doc: admin-grant account authenticates", conn.state.authed && !conn.state.failed, conn.state);
  conn.provider.destroy();
  const r = await showChannel(rdB.body.id, superUser.accessToken, false);
  check("show: admin-grant account → admin role", r.welcome?.role === "admin", r.welcome);
  check("show: admin-grant account named on the channel", r.welcome?.userLabel === "Matrix Super", r.welcome);
}
{
  // Each refusal must arrive with a reason the client can put on screen —
  // a bare "permission-denied" leaves a stranded device with nothing to act on.
  const cases: [string, string, string, string][] = [
    ["unknown credential", rdA.body.id, "usr_not_a_real_token", "signin-not-recognised"],
    ["no credential at all", rdA.body.id, "dev", "not-signed-in"],
    ["missing rundown", "01ZZZZZZZZZZZZZZZZZZZZZZZZ", ADMIN, "no-such-rundown"],
    ["stale doc epoch", `${rdA.body.id}@9`, ADMIN, "sheet-restored-reload"],
  ];
  for (const [label, name, token, expected] of cases) {
    const conn = docConnect(name, token);
    await sleep(1200);
    check(`doc: ${label} → "${expected}"`, conn.state.failed && conn.state.reason === expected, conn.state);
    conn.provider.destroy();
  }
}

// ── Accounts: password login & sessions ───────────────────────────────────────
{
  const account = (await req("/users", ADMIN, {
    method: "POST",
    body: JSON.stringify({
      name: "Matrix Account",
      email: "matrix.account@example.com",
      password: "correct-horse-9",
      grants: [{ kind: "view", targetId: eventA.body.id }],
    }),
  })).body as { id: string; accessToken: string };

  check("login: wrong password → 401", (await req("/auth/login", null, { method: "POST", body: JSON.stringify({ email: "matrix.account@example.com", password: "wrong" }) })).status === 401);
  check("login: unknown email → 401", (await req("/auth/login", null, { method: "POST", body: JSON.stringify({ email: "nobody@example.com", password: "whatever1" }) })).status === 401);

  const login = await req("/auth/login", null, { method: "POST", body: JSON.stringify({ email: "Matrix.Account@Example.com", password: "correct-horse-9" }) });
  check("login: correct (case-insensitive email) → ses_ token", login.status === 200 && String(login.body.token).startsWith("ses_"), login.body);
  const session: string = login.body.token;

  const me = await req("/me", session);
  check("session: /me → user with view grant", me.body?.role === "user" && me.body?.canManage === false, me.body);
  const ev = await req("/events", session);
  check("session: events scoped like the grant", (ev.body as any[]).length === 1 && (ev.body as any[])[0].name === "Matrix Event A", ev.body);
  const show = await showChannel(rdA.body.id, session, true);
  check("session: show channel → follower, cmd rejected", show.welcome?.role === "follower" && show.cmdReply?.t === "cmd_error", show);

  const users = await req("/users", ADMIN);
  const row = (users.body as any[]).find((u) => u.id === account.id);
  check("users list: hasPassword true, hash never returned", row?.hasPassword === true && !JSON.stringify(users.body).includes("scrypt$"), row);

  // A second session dies when the admin resets the password; and logout kills the first.
  const second = (await req("/auth/login", null, { method: "POST", body: JSON.stringify({ email: "matrix.account@example.com", password: "correct-horse-9" }) })).body.token as string;
  await req(`/users/${account.id}/set-password`, ADMIN, { method: "POST", body: JSON.stringify({ password: "new-password-77" }) });
  check("admin reset: existing sessions revoked", (await req("/me", second)).body?.role === null);
  const relogin = await req("/auth/login", null, { method: "POST", body: JSON.stringify({ email: "matrix.account@example.com", password: "new-password-77" }) });
  check("admin reset: new password works", relogin.status === 200, relogin.body);
  const s3: string = relogin.body.token;

  // change-password keeps the current session but kills others.
  const s4 = (await req("/auth/login", null, { method: "POST", body: JSON.stringify({ email: "matrix.account@example.com", password: "new-password-77" }) })).body.token as string;
  const change = await req("/auth/change-password", s3, { method: "POST", body: JSON.stringify({ current: "new-password-77", next: "final-password-5" }) });
  check("change-password: accepted", change.status === 200, change.body);
  check("change-password: current session survives", (await req("/me", s3)).body?.role === "user");
  check("change-password: other session revoked", (await req("/me", s4)).body?.role === null);
  check("change-password: wrong current → 401", (await req("/auth/change-password", s3, { method: "POST", body: JSON.stringify({ current: "nope", next: "whatever-123" }) })).status === 401);

  await req("/auth/logout", s3, { method: "POST" });
  check("logout: session dead", (await req("/me", s3)).body?.role === null);

  await req(`/users/${account.id}`, ADMIN, { method: "DELETE" });
}

// ── View-only link (follower join code shared as a URL to camera ops) ─────────
{
  const created = await req(`/rundowns/${rdA.body.id}/join-codes`, ADMIN, { method: "POST", body: JSON.stringify({ role: "follower" }) });
  const code: string = created.body.code;
  const resolved = await req(`/codes/${encodeURIComponent(code)}`, null);
  check("view link: code resolves publicly → follower", resolved.status === 200 && resolved.body?.role === "follower" && resolved.body?.rundownId === rdA.body.id, resolved.body);
  const adminConn = docConnect(rdA.body.id, ADMIN);
  const opConn = docConnect(rdA.body.id, code);
  await sleep(1500);
  check("view link: doc opens with just the code", opConn.state.authed && !opConn.state.failed, opConn.state);
  const before = adminConn.doc.getMap("meta").get("versionLabel");
  opConn.doc.getMap("meta").set("versionLabel", "CAMERA-OP-WRITE");
  await sleep(1500);
  check("view link: code holder cannot write", adminConn.doc.getMap("meta").get("versionLabel") === before, adminConn.doc.getMap("meta").get("versionLabel"));
  adminConn.provider.destroy();
  opConn.provider.destroy();
}

// ── New surfaces: profile self-service, named/revocable codes, walk gate ──────
{
  check("profile: token sign-in PATCH /me → 400", (await req("/me", ADMIN, { method: "PATCH", body: JSON.stringify({ name: "x" }) })).status === 400);
  const acct = (await req("/users", ADMIN, {
    method: "POST",
    body: JSON.stringify({ name: "Matrix Profile", email: "matrix.profile@example.com", password: "profile-pass-1", grants: [{ kind: "view", targetId: eventA.body.id }] }),
  })).body as { id: string };
  const ses = (await req("/auth/login", null, { method: "POST", body: JSON.stringify({ email: "matrix.profile@example.com", password: "profile-pass-1" }) })).body
    .token as string;
  check("profile: user PATCH /me name → 200", (await req("/me", ses, { method: "PATCH", body: JSON.stringify({ name: "Matrix Renamed" }) })).status === 200);
  const meAfter = await req("/me", ses);
  check("profile: /me reflects name + email", meAfter.body?.name === "Matrix Renamed" && meAfter.body?.email === "matrix.profile@example.com", meAfter.body);
  await req(`/users/${acct.id}`, ADMIN, { method: "DELETE" });

  const named = await req(`/rundowns/${rdA.body.id}/join-codes`, ADMIN, { method: "POST", body: JSON.stringify({ role: "follower", label: "Matrix Cam 2" }) });
  check("codes: label stored on create", named.body?.label === "Matrix Cam 2", named.body);
  const list = await req(`/rundowns/${rdA.body.id}/join-codes`, ADMIN);
  const row = (list.body as any[]).find((c) => c.joinCode === named.body.code);
  check("codes: viewer cannot revoke → 401", (await req(`/rundowns/${rdA.body.id}/join-codes/${row.id}`, viewer.accessToken, { method: "DELETE" })).status === 401);
  check("codes: manager revoke → 200", (await req(`/rundowns/${rdA.body.id}/join-codes/${row.id}`, eventMgr.accessToken, { method: "DELETE" })).status === 200);
  check("codes: revoked code no longer resolves", (await req(`/codes/${encodeURIComponent(named.body.code)}`, null)).status !== 200);

  // The pre-show walkthrough shares the transport's caller gate.
  const walk = await new Promise<any>((resolve) => {
    const ws = new WebSocket(`${WS}/?rundown=${rdA.body.id}`);
    const timer = setTimeout(() => {
      ws.close();
      resolve(null);
    }, 4000);
    ws.addEventListener("open", () => ws.send(JSON.stringify({ v: 1, t: "hello", auth: { kind: "session", token: viewer.accessToken }, device: "console" })));
    ws.addEventListener("message", (e) => {
      const msg = JSON.parse(String(e.data));
      if (msg.t === "welcome") ws.send(JSON.stringify({ v: 1, t: "cmd", id: "t-walk", action: "walk" }));
      if (msg.t === "cmd_error" || msg.t === "show_state") {
        clearTimeout(timer);
        ws.close();
        resolve(msg);
      }
    });
  });
  check("walk: follower rejected", walk?.t === "cmd_error", walk);
}

// ── Cleanup fixtures ──────────────────────────────────────────────────────────
for (const u of [viewer, eventMgr, companyMgr, superUser]) await req(`/users/${u.id}`, ADMIN, { method: "DELETE" });
await req(`/events/${eventB.body.id}`, ADMIN, { method: "DELETE" });
await req(`/companies/${company.body.id}`, ADMIN, { method: "DELETE" });
await req(`/companies/${otherCompany.body.id}`, ADMIN, { method: "DELETE" });

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
