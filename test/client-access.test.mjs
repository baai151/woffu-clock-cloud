import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const source = await readFile(new URL("../src/index-v5.js", import.meta.url), "utf8");
const loadStart = source.indexOf("  async function loadData(");
const loadCode = source.slice(loadStart, source.indexOf("  function cacheState()", loadStart));
const apiStart = source.indexOf("  async function api(");
const apiCode = source.slice(apiStart, source.indexOf("  function renderAll(", apiStart));

function loader() {
  const waiting = [];
  const events = [];
  const state = { requestId: 0, data: null, controller: null, fresh: false };
  const context = vm.createContext({
    state, AbortController, URLSearchParams,
    document: { getElementById: () => ({}) },
    api: () => new Promise((resolve, reject) => waiting.push({ resolve, reject })),
    updatePendingControls() {}, showLoading() {}, cacheState() {}, resetVacations() {},
    vacationDifferenceCount: () => 0,
    renderAll: () => events.push("render"),
    brandIntro: { ready: () => events.push("welcome"), block: () => events.push("release-cover") },
    toast: () => events.push("error"), showFatal() {},
  });
  vm.runInContext(loadCode, context);
  return { state, events, waiting, load: context.loadData };
}

test("slow bootstrap cannot start the welcome before successful authentication and render", async () => {
  const page = loader();
  const loading = page.load();
  assert.deepEqual(page.events, []);
  assert.equal(page.state.fresh, false);
  page.waiting[0].resolve({ ok: true, today: "2026-11-06", vacations: [] });
  assert.equal(await loading, true);
  assert.deepEqual(page.events, ["render", "welcome"]);
  assert.equal(page.state.fresh, true);
});

test("rejected bootstrap never starts the welcome; a successful retry does", async () => {
  const page = loader();
  const failed = page.load();
  page.waiting[0].reject(Error("Session expired"));
  assert.equal(await failed, false);
  assert.deepEqual(page.events, ["release-cover", "error"]);
  const retried = page.load();
  page.waiting[1].resolve({ ok: true, today: "2026-11-06" });
  assert.equal(await retried, true);
  assert.deepEqual(page.events, ["release-cover", "error", "render", "welcome"]);
});

test("a superseded bootstrap cannot start another welcome", async () => {
  const page = loader();
  const first = page.load();
  const second = page.load();
  page.waiting[1].resolve({ ok: true, today: "2026-11-06" });
  await second;
  page.waiting[0].resolve({ ok: true, today: "2026-11-05" });
  assert.equal(await first, false);
  assert.deepEqual(page.events, ["render", "welcome"]);
});

test("an expired app session blocks the intro and offers a single explicit re-entry", async () => {
  for (const isAppSession of [true, false]) {
    const state = { fresh: true, authExpired: false };
    const retry = { textContent: "Actualizar datos" };
    const events = [];
    const context = vm.createContext({ state,
      document: { getElementById: () => retry },
      brandIntro: { block: () => events.push("blocked") },
      updatePendingControls: () => events.push("controls"),
      toast: () => events.push("message"),
      fetch: async (path, init) => {
        assert.equal(init.credentials, "same-origin");
        return new Response(JSON.stringify({ ok: false, ...(isAppSession ? { code: "AUTH_REQUIRED" } : {}), error: "Access failed" }), {
          status: 401, headers: { "Content-Type": "application/json" },
        });
      },
    });
    vm.runInContext(apiCode, context);
    await assert.rejects(context.api("/api/session"), /Access failed/);
    assert.equal(state.authExpired, isAppSession);
    assert.equal(state.fresh, !isAppSession);
    assert.equal(retry.textContent, isAppSession ? "Volver a entrar" : "Actualizar datos");
    assert.deepEqual(events, isAppSession ? ["blocked", "controls", "message"] : []);
  }
});
