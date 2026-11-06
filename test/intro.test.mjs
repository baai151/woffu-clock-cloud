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

function setup({ seen = false, reduced = false, storageBlocked = false, hidden = false } = {}) {
  const backdrop = { dataset: { src: "/assets/intro-glass-v1.webp" } };
  const intro = { ...eventTarget(), classList: classList(), hidden: true, querySelector: () => backdrop };
  let document;
  const focusable = () => ({
    focus() { document.activeElement = this; },
    blur() { document.activeElement = document.body; },
    getClientRects() { return [{}]; },
  });
  const skip = { ...eventTarget(), ...focusable() };
  const nav = focusable();
  const app = { inert: false, querySelector: () => nav };
  const body = { classList: classList() };
  document = {
    ...eventTarget(),
    body,
    visibilityState: hidden ? "hidden" : "visible",
    activeElement: body,
    getElementById: (id) => id === "brandIntro" ? intro : skip,
    querySelector: () => app,
  };
  const motion = { ...eventTarget(), matches: reduced };
  const window = { ...eventTarget(), matchMedia: () => motion };
  const storage = new Map(seen ? [["woffu-capgemini-welcome-v2", "seen"]] : []);
  const timers = new Map();
  let timerId = 0;
  const context = vm.createContext({
    document, window,
    sessionStorage: {
      getItem(key) { if (storageBlocked) throw Error("Storage unavailable"); return storage.get(key); },
      setItem(key, value) { if (storageBlocked) throw Error("Storage unavailable"); storage.set(key, value); },
    },
    setTimeout(fn, ms) { timers.set(++timerId, { fn, ms }); return timerId; },
    clearTimeout(id) { timers.delete(id); },
  });
  vm.runInContext(introCode, context);
  return {
    intro, skip, app, backdrop, motion, window, document, timers,
    play: context.createBrandIntro(),
    finish: () => intro.emit("animationend", { target: intro, animationName: "introAway" }),
    visibility(value) { document.visibilityState = value; document.emit("visibilitychange"); },
  };
}

function assertReleased(page) {
  assert.equal(page.intro.hidden, true);
  assert.equal(page.app.inert, false);
  assert.equal(page.document.body.classList.values.size, 0);
  assert.equal(page.window.listeners.has("keydown"), false);
  assert.equal(page.motion.listeners.size + page.intro.listeners.size + page.skip.listeners.size + page.timers.size, 0);
}

test("every opening plays even with an old session flag or unavailable storage", () => {
  for (const options of [{}, { seen: true }, { storageBlocked: true }]) {
    const page = setup(options);
    page.play();
    assert.equal(page.intro.hidden, false);
    assert.equal(page.app.inert, true);
    assert.equal(page.backdrop.src, page.backdrop.dataset.src);
    assert.equal(page.document.activeElement, page.skip);
    page.finish();
    assertReleased(page);
    page.play();
    assert.equal(page.intro.hidden, false);
    page.finish();
    assertReleased(page);
  }
});

test("duplicate opening events do not restart the intro or leak timers", () => {
  const page = setup();
  page.play();
  const firstTimer = [...page.timers.keys()][0];
  page.play();
  page.visibility("visible");
  page.window.emit("pageshow", { persisted: true });
  assert.deepEqual([...page.timers.keys()], [firstTimer]);
  page.finish();
  page.window.emit("pageshow", { persisted: false });
  assertReleased(page);
});

test("a background load waits until visible and returning replays from the start", () => {
  const page = setup({ hidden: true });
  page.play();
  assertReleased(page);
  assert.equal(page.backdrop.src, undefined);
  page.visibility("visible");
  assert.equal(page.intro.hidden, false);
  page.visibility("hidden");
  assertReleased(page);
  page.visibility("visible");
  assert.equal(page.intro.hidden, false);
  page.finish();
  page.visibility("hidden");
  page.visibility("visible");
  assert.equal(page.intro.hidden, false);
  assert.equal(page.timers.size, 1);
});

test("back-forward cache restoration replays, including when visibility arrives later", () => {
  for (const hiddenOnRestore of [false, true]) {
    const page = setup();
    page.play();
    page.window.emit("pagehide");
    assertReleased(page);
    page.document.visibilityState = hiddenOnRestore ? "hidden" : "visible";
    page.window.emit("pageshow", { persisted: true });
    assert.equal(page.intro.hidden, hiddenOnRestore);
    page.visibility("visible");
    assert.equal(page.intro.hidden, false);
    assert.equal(page.timers.size, 1);
    page.finish();
    assertReleased(page);
  }
});

test("reduced motion shows a brief static welcome and releases the application", () => {
  const page = setup({ reduced: true });
  page.play();
  assert.equal(page.intro.hidden, false);
  assert.equal(page.intro.classList.values.has("introReduced"), true);
  const timer = [...page.timers.values()][0];
  assert.equal(timer.ms, 1200);
  timer.fn();
  assertReleased(page);
  page.motion.matches = false;
  page.play({ replay: true });
  assert.equal(page.intro.classList.values.has("introReduced"), false);
  assert.equal([...page.timers.values()][0].ms, 3800);
});

test("escape, skip button, motion change and timeout release the modal", () => {
  for (const reason of ["escape", "button", "motion", "timeout"]) {
    const page = setup();
    page.play();
    if (reason === "escape") page.window.emit("keydown", { key: "Escape", preventDefault() {}, stopPropagation() {} });
    if (reason === "button") page.skip.emit("click");
    if (reason === "motion") page.motion.emit("change");
    if (reason === "timeout") {
      const timer = [...page.timers.values()][0];
      assert.equal(timer.ms, 3800);
      timer.fn();
    }
    assertReleased(page);
  }
});

test("explicit replay traps Tab, ignores child animations and restores focus", () => {
  const page = setup({ seen: true });
  const trigger = { focus() { page.document.activeElement = this; }, getClientRects() { return [{}]; } };
  page.document.activeElement = trigger;
  page.play({ replay: true });
  let prevented = false;
  page.window.emit("keydown", { key: "Tab", preventDefault() { prevented = true; } });
  assert.equal(prevented, true);
  assert.equal(page.document.activeElement, page.skip);
  page.intro.emit("animationend", { target: {}, animationName: "introAway" });
  assert.equal(page.intro.hidden, false);
  page.finish();
  assert.equal(page.document.activeElement, trigger);
  page.play({ replay: true });
  assert.equal(page.intro.hidden, false);
  assert.equal(page.timers.size, 1);
});
