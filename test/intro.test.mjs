import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

// Run the actual inline client function: the Worker serializes clientApp.toString().
const source = await readFile(new URL("../src/index-v5.js", import.meta.url), "utf8");
const start = source.indexOf("  function showBrandIntro(");
const end = source.indexOf("  function bindNavigation()", start);
assert.ok(start > 0 && end > start);
const introCode = source.slice(start, end);

function eventTarget() {
  const listeners = new Map();
  return {
    listeners,
    addEventListener(name, listener) { listeners.set(name, listener); },
    removeEventListener(name) { listeners.delete(name); },
    emit(name, event = {}) { listeners.get(name)?.(event); },
  };
}

function setup({ seen = false, reduced = false, storageBlocked = false } = {}) {
  const backdrop = { dataset: { src: "/assets/intro-glass-v1.webp" } };
  const intro = { ...eventTarget(), hidden: true, querySelector: () => backdrop };
  let document;
  const focusable = () => ({
    focus() { document.activeElement = this; },
    blur() { document.activeElement = document.body; },
    getClientRects() { return [{}]; },
  });
  const skip = { ...eventTarget(), ...focusable() };
  const nav = focusable();
  const app = { inert: false, querySelector: () => nav };
  const bodyClasses = new Set();
  const body = { classList: { add: (name) => bodyClasses.add(name), remove: (name) => bodyClasses.delete(name) } };
  document = {
    body,
    activeElement: body,
    getElementById: (id) => id === "brandIntro" ? intro : skip,
    querySelector: () => app,
  };
  const motion = { ...eventTarget(), matches: reduced };
  const window = { ...eventTarget(), matchMedia: () => motion };
  const storage = new Map(seen ? [["woffu-capgemini-welcome-v2", "seen"]] : []);
  const timers = new Map();
  const messages = [];
  const context = vm.createContext({
    document, window,
    sessionStorage: {
      getItem(key) { if (storageBlocked) throw Error("Storage unavailable"); return storage.get(key); },
      setItem(key, value) { if (storageBlocked) throw Error("Storage unavailable"); storage.set(key, value); },
    },
    setTimeout(fn, ms) { timers.set(1, { fn, ms }); return 1; },
    clearTimeout(id) { timers.delete(id); },
    toast: (message) => messages.push(message),
  });
  vm.runInContext(introCode, context);
  return { intro, skip, app, backdrop, bodyClasses, motion, window, document, timers, messages,
    play: (options) => context.showBrandIntro(options) };
}

test("welcome plays once per session and only then requests its backdrop", () => {
  const first = setup();
  first.play();
  assert.equal(first.intro.hidden, false);
  assert.equal(first.app.inert, true);
  assert.equal(first.backdrop.src, first.backdrop.dataset.src);
  assert.equal(first.document.activeElement, first.skip);
  first.intro.emit("animationend", { target: first.intro, animationName: "introAway" });
  assert.equal(first.intro.hidden, true);
  assert.equal(first.app.inert, false);
  assert.equal(first.bodyClasses.size, 0);
  assert.equal(first.window.listeners.size + first.motion.listeners.size + first.timers.size, 0);
  first.play();
  assert.equal(first.intro.hidden, true);
  const repeat = setup({ seen: true });
  repeat.play();
  assert.equal(repeat.backdrop.src, undefined);
});

test("reduced motion and unavailable storage leave the application usable", () => {
  for (const options of [{ reduced: true }, { storageBlocked: true }]) {
    const page = setup(options);
    page.play();
    assert.equal(page.intro.hidden, true);
    assert.equal(page.app.inert, false);
    assert.equal(page.backdrop.src, undefined);
    assert.equal(page.timers.size, 0);
  }
  const reduced = setup({ reduced: true });
  reduced.play({ replay: true });
  assert.equal(reduced.messages.length, 1);
  assert.equal(reduced.intro.hidden, true);
});

test("escape, skip button, motion change and timeout release the modal", () => {
  for (const reason of ["escape", "button", "motion", "timeout"]) {
    const page = setup();
    page.play();
    if (reason === "escape") page.window.emit("keydown", { key: "Escape", preventDefault() {}, stopPropagation() {} });
    if (reason === "button") page.skip.emit("click");
    if (reason === "motion") page.motion.emit("change");
    if (reason === "timeout") {
      assert.equal(page.timers.get(1).ms, 3800);
      page.timers.get(1).fn();
    }
    assert.equal(page.intro.hidden, true, reason);
    assert.equal(page.app.inert, false, reason);
    assert.equal(page.bodyClasses.size, 0, reason);
    assert.equal(page.window.listeners.size + page.motion.listeners.size + page.timers.size, 0, reason);
  }
});

test("explicit replay works, traps Tab, ignores child animations and restores focus", () => {
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
  page.intro.emit("animationend", { target: page.intro, animationName: "introAway" });
  assert.equal(page.document.activeElement, trigger);
  page.play({ replay: true });
  assert.equal(page.intro.hidden, false);
  assert.equal(page.timers.size, 1);
});
