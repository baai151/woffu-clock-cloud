import assert from "node:assert/strict";
import { after, test } from "node:test";
import app from "../src/index-v11.js";
import { createD1 } from "./helpers/d1.mjs";

const { DB, sqlite } = createD1();
const env = { DB, ADMIN_PASSWORD: "local-auth-test", MODE: "TEST", WOFFU_WRITE_ENABLED: "false" };
const basic = { Authorization: `Basic ${btoa("admin:local-auth-test")}` };
after(() => sqlite.close());
const request = (path, headers = {}, options = {}, environment = env) => app.fetch(
  new Request("https://clock.test" + path, { ...options, headers }), environment, {});
async function login() {
  const response = await request("/", basic);
  assert.equal(response.status, 200);
  return response.headers.get("Set-Cookie");
}
const cookieHeaders = (cookie) => ({ Cookie: cookie.split(";")[0] });

test("only a protected entry page can open a password dialog", async () => {
  for (const path of ["/", "/woffu/punch"]) {
    const response = await request(path);
    assert.equal(response.status, 401);
    assert.match(response.headers.get("WWW-Authenticate"), /Basic realm="Woffu Clock"/);
    assert.equal(response.headers.get("Set-Cookie"), null);
  }
  for (const path of ["/api/bootstrap", "/api/session", "/api/woffu/test", "/api/active", "/api/woffu/punch-now"]) {
    const response = await request(path, {}, path.endsWith("active") || path.endsWith("punch-now") ? { method: "POST" } : {});
    assert.equal(response.status, 401, path);
    assert.equal(response.headers.get("WWW-Authenticate"), null, path);
    assert.equal((await response.json()).code, "AUTH_REQUIRED");
  }
});

test("Safari icon probes and missing assets never open a password dialog", async () => {
  for (const path of ["/favicon.ico", "/apple-touch-icon.png", "/apple-touch-icon-precomposed.png", "/assets/missing.svg"]) {
    const response = await request(path);
    assert.equal(response.status, 404, path);
    assert.equal(response.headers.get("WWW-Authenticate"), null);
  }
  for (const path of ["/manifest.webmanifest", "/icon.svg", "/assets/capgemini-white.svg"]) {
    const response = await request(path);
    assert.equal(response.status, 200, path);
    assert.equal(response.headers.get("Set-Cookie"), null);
  }
});

test("one successful login sets a protected cookie for the page and API", async () => {
  const cookie = await login();
  assert.match(cookie, /^__Host-woffu-session=v1\./);
  for (const flag of ["Path=/", "Max-Age=43200", "Secure", "HttpOnly", "SameSite=Strict"]) assert.ok(cookie.includes(flag), flag);
  assert.ok(!cookie.includes(env.ADMIN_PASSWORD));
  assert.ok(!cookie.includes("Domain="));
  // Safari may omit its Basic header on subrequests: the cookie must suffice.
  for (const path of ["/", "/api/session", "/api/bootstrap", "/woffu/punch"]) {
    const response = await request(path, cookieHeaders(cookie));
    assert.equal(response.status, 200, path);
    assert.equal(response.headers.get("WWW-Authenticate"), null);
    assert.match(response.headers.get("Cache-Control"), /no-store/);
  }
  const gated = await request("/api/woffu/punch-now", { ...cookieHeaders(cookie), Origin: "https://clock.test" }, { method: "POST" });
  assert.equal(gated.status, 409, "authenticated, but TEST still blocks a real punch");
  sqlite.exec("UPDATE config SET active = 1");
  const saved = await request("/api/active", { ...cookieHeaders(cookie), Origin: "https://clock.test", "Content-Type": "application/json" }, {
    method: "POST", body: JSON.stringify({ active: false }),
  });
  assert.equal(saved.status, 200);
  assert.equal(sqlite.prepare("SELECT active FROM config WHERE id=1").get().active, 0);
});

test("invalid credentials and unsigned or altered cookies do not authenticate", async () => {
  const cookie = await login();
  const pair = cookie.split(";")[0];
  const invalid = [
    { Authorization: `Basic ${btoa("admin:wrong")}` },
    { Authorization: "Basic invalid" },
    { Cookie: "__Host-woffu-session=admin" },
    { Cookie: pair.replace("v1.", "v2.") },
    { Cookie: pair.slice(0, -4) + "AAAA" },
    { Cookie: pair + "; " + pair },
  ];
  for (const headers of invalid) {
    const response = await request("/api/session", headers);
    assert.equal(response.status, 401);
    assert.equal(response.headers.get("Set-Cookie"), null);
  }
});

test("session expires after twelve hours without issuing a background challenge", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: new Date("2026-11-06T08:00:00Z") });
  const cookie = await login();
  t.mock.timers.tick(12 * 60 * 60 * 1000);
  const response = await request("/api/session", cookieHeaders(cookie));
  assert.equal(response.status, 401);
  assert.equal(response.headers.get("WWW-Authenticate"), null);
});

test("password rotation and a different fork invalidate an existing session", async () => {
  const cookie = await login();
  const rotated = await request("/api/session", cookieHeaders(cookie), {}, { ...env, ADMIN_PASSWORD: "new-password" });
  assert.equal(rotated.status, 401);
  const otherFork = await app.fetch(new Request("https://another-clock.test/api/session", { headers: cookieHeaders(cookie) }), env, {});
  assert.equal(otherFork.status, 401);
  const unconfigured = await request("/api/session", cookieHeaders(cookie), {}, { ...env, ADMIN_PASSWORD: "" });
  assert.equal(unconfigured.status, 401);
});

test("cookie authentication preserves the origin guard for writes", async () => {
  const cookie = await login();
  const response = await request("/api/active", { ...cookieHeaders(cookie), Origin: "https://other.test", "Content-Type": "application/json" }, {
    method: "POST", body: JSON.stringify({ active: true }),
  });
  assert.equal(response.status, 403);
  assert.equal((await response.json()).error, "Origen no permitido.");
});
