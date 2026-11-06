import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

// Run the actual inline client function: the Worker serializes clientApp.toString().
const source = await readFile(new URL("../src/index-v5.js", import.meta.url), "utf8");
const start = source.indexOf("  function createBrandIntro(");
const end = source.indexOf("  function bindNavigation()", start);
assert.ok(start > 0 && end > start);
const introCode = source.slice(start, end);

function eventTarget() {
  const listeners = new Map();
  return {
    listeners,
    addEventListener(name, listener) {
      if (!listeners.has(name)) listeners.set(name, new Set());
      listeners.get(name).add(listener);
    },
    removeEventListener(name, listener) {
      listeners.get(name)?.delete(listener);
      if (!listeners.get(name)?.size) listeners.delete(name);
    },
    emit(name, event = {}) { for (const listener of listeners.get(name) || []) listener(event); },
  };
}

function classList() {
  const values = new Set();
  return {
    values,
    add: (name) => values.add(name),
    remove: (name) => values.delete(name),
    toggle: (name, enabled) => enabled ? values.add(name) : values.delete(name),
  };
}

function setup({ reduced = false, hidden = false, access = async () => {}, decode = async () => {} } = {}) {
  const backdrop = { dataset: { src: "/assets/intro-glass-v1.webp" } };
  const cover = { hidden: false };
  const intro = { ...eventTarget(), classList: classList(), hidden: true,
    querySelector: () => backdrop, querySelectorAll: () => [{ decode }] };
  let document;
  const focusable = () => ({
    focus() { document.activeElement = this; },
    blur() { document.activeElement = document.body; },
    getClientRects() { return [{}]; },
  });
  const skip = { ...eventTarget(), ...focusable() };
  const nav = focusable();
  const app = { inert: true, querySelector: () => nav };
  const body = { classList: classList() };
  body.classList.add("entryPending");
  document = { ...eventTarget(), body, visibilityState: hidden ? "hidden" : "visible", activeElement: body,
    getElementById: (id) => id === "brandIntro" ? intro : id === "entryCover" ? cover : skip, querySelector: () => app };
  const motion = { ...eventTarget(), matches: reduced };
  const window = { ...eventTarget(), matchMedia: () => motion };
  const timers = new Map();
  const frames = new Map();
  const messages = [];
  const accessCalls = [];
  let timerId = 0;
  const context = vm.createContext({ document, window,
    sessionStorage: { getItem() { throw Error("Storage unavailable"); }, setItem() { throw Error("Storage unavailable"); } },
    setTimeout(fn, ms) { timers.set(++timerId, { fn, ms }); return timerId; },
    clearTimeout(id) { timers.delete(id); },
    requestAnimationFrame(fn) { frames.set(++timerId, fn); return timerId; },
    cancelAnimationFrame(id) { frames.delete(id); },
    api: async (path) => { accessCalls.push(path); return access(); },
    toast: (message) => messages.push(message),
  });
  vm.runInContext(introCode, context);
  const controller = context.createBrandIntro();
  return { intro, cover, skip, app, backdrop, motion, window, document, timers, frames, controller, messages, accessCalls,
    finish: () => intro.emit("animationend", { target: intro, animationName: "introAway" }),
    visibility(value) { document.visibilityState = value; document.emit("visibilitychange"); },
    paint() { const work = [...frames.values()]; frames.clear(); work.forEach((fn) => fn()); },
  };
}
async function settle() { for (let i = 0; i < 12; i++) await Promise.resolve(); }
async function ready(page) { await page.controller.ready(); page.paint(); page.paint(); }
function assertReleased(page) {
  assert.equal(page.intro.hidden, true);
  assert.equal(page.cover.hidden, true);
  assert.equal(page.app.inert, false);
  assert.equal(page.document.body.classList.values.size, 0);
  assert.equal(page.window.listeners.has("keydown"), false);
  assert.equal(page.motion.listeners.size + page.intro.listeners.size + page.skip.listeners.size + page.timers.size + page.frames.size, 0);
}
function assertWaiting(page) {
  assert.equal(page.intro.hidden, true);
  assert.equal(page.cover.hidden, false);
  assert.equal(page.app.inert, true);
  assert.equal(page.document.body.classList.values.has("entryPending"), true);
}

test("welcome waits for authenticated bootstrap, loaded logos and visible frames", async () => {
  let decode;
  const page = setup({ decode: () => new Promise((resolve) => { decode = resolve; }) });
  page.window.emit("pageshow", { persisted: false });
  page.window.emit("focus");
  await settle();
  assertWaiting(page);
  assert.equal(page.accessCalls.length, 0);
  const opening = page.controller.ready();
  await settle();
  assertWaiting(page);
  assert.equal(page.backdrop.src, page.backdrop.dataset.src);
  decode();
  await opening;
  assert.equal(page.intro.hidden, false);
  assert.equal(page.cover.hidden, true);
  assert.equal(page.app.inert, true, "summary stays inaccessible until the full animation ends");
  assert.equal(page.intro.classList.values.has("introPlaying"), false);
  page.paint();
  assert.equal(page.intro.classList.values.has("introPlaying"), false);
  page.paint();
  assert.equal(page.intro.classList.values.has("introPlaying"), true);
  assert.equal([...page.timers.values()][0].ms, 7600);
  page.finish();
  assertReleased(page);
});

test("later data loads and duplicate lifecycle events do not replay a completed welcome", async () => {
  const page = setup();
  await ready(page);
  const firstTimer = [...page.timers.keys()][0];
  await page.controller.ready();
  page.visibility("visible");
  page.window.emit("pageshow", { persisted: true });
  await settle();
  assert.deepEqual([...page.timers.keys()], [firstTimer]);
  page.finish();
  await page.controller.ready();
  page.window.emit("focus");
  page.window.emit("pageshow", { persisted: false });
  await settle();
  assertReleased(page);
});

test("a background load waits, then checks access and plays when it becomes visible", async () => {
  const page = setup({ hidden: true });
  await ready(page);
  assertWaiting(page);
  page.visibility("visible");
  await settle();
  assert.equal(page.intro.hidden, false);
  assert.deepEqual(page.accessCalls, ["/api/session"]);
  page.visibility("hidden");
  assertWaiting(page);
  page.visibility("visible");
  await settle();
  assert.equal(page.intro.hidden, false);
  page.paint(); page.paint();
  assert.equal(page.timers.size, 1);
});

test("back-forward restoration rechecks access before showing the welcome", async () => {
  let grant;
  const page = setup({ access: () => new Promise((resolve) => { grant = resolve; }) });
  await ready(page);
  page.window.emit("pagehide");
  assertWaiting(page);
  page.window.emit("pageshow", { persisted: true });
  await settle();
  assertWaiting(page);
  page.window.emit("focus");
  assert.equal(page.accessCalls.length, 1);
  grant();
  await settle();
  assert.equal(page.intro.hidden, false);
});

test("failed access and hidden or cancelled pending loads cannot start the intro", async () => {
  const denied = setup({ access: async () => { throw Error("Session expired"); } });
  await ready(denied);
  denied.window.emit("pagehide");
  denied.window.emit("pageshow");
  await settle();
  assertReleased(denied);
  assert.deepEqual(denied.messages, ["Session expired"]);
  for (const block of [false, true]) {
    let decode;
    const page = setup({ decode: () => new Promise((resolve) => { decode = resolve; }) });
    const opening = page.controller.ready();
    await settle();
    if (block) page.controller.block();
    else page.visibility("hidden");
    decode();
    await opening;
    if (block) assertReleased(page);
    else assertWaiting(page);
  }
});

test("slow or failed images never prevent entry", async () => {
  for (const fail of [true, false]) {
    const page = setup({ decode: () => fail ? Promise.reject(Error("Image failed")) : new Promise(() => {}) });
    const opening = page.controller.ready();
    await settle();
    if (!fail) [...page.timers.values()].find(timer => timer.ms === 1500).fn();
    await opening;
    page.paint(); page.paint();
    assert.equal(page.intro.hidden, false);
    [...page.timers.values()][0].fn();
    assertReleased(page);
  }
});

test("reduced motion keeps a three-second static welcome after authentication", async () => {
  const page = setup({ reduced: true });
  await ready(page);
  assert.equal(page.intro.hidden, false);
  assert.equal(page.intro.classList.values.has("introReduced"), true);
  const timer = [...page.timers.values()][0];
  assert.equal(timer.ms, 3000);
  timer.fn();
  assertReleased(page);
});

test("escape, skip, motion changes and stalled frames always release the interface", async () => {
  for (const reason of ["escape", "button", "motion", "timeout", "frames"]) {
    const page = setup();
    await page.controller.ready();
    if (reason !== "frames") { page.paint(); page.paint(); }
    if (reason === "escape") page.window.emit("keydown", { key: "Escape", preventDefault() {}, stopPropagation() {} });
    if (reason === "button") page.skip.emit("click");
    if (reason === "motion") page.motion.emit("change");
    if (["timeout", "frames"].includes(reason)) [...page.timers.values()][0].fn();
    assertReleased(page);
  }
});

test("explicit replay traps Tab, ignores child animations and restores focus", async () => {
  const page = setup();
  await ready(page); page.finish();
  const trigger = { focus() { page.document.activeElement = this; }, getClientRects() { return [{}]; } };
  page.document.activeElement = trigger;
  await page.controller.replay();
  assert.deepEqual(page.accessCalls, ["/api/session"]);
  let prevented = false;
  page.window.emit("keydown", { key: "Tab", preventDefault() { prevented = true; } });
  assert.equal(prevented, true);
  assert.equal(page.document.activeElement, page.skip);
  page.intro.emit("animationend", { target: {}, animationName: "introAway" });
  assert.equal(page.intro.hidden, false);
  page.finish();
  assert.equal(page.document.activeElement, trigger);
  assertReleased(page);
});
