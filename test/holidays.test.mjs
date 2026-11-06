import assert from "node:assert/strict";
import { after, beforeEach, mock, test } from "node:test";
import app from "../src/index-v11.js";
import { claimScheduledEvent } from "../src/index-v5.js";
import { OFFICES, getOfficeCalendar, getHoliday, hasHolidayCalendar } from "../src/holidays.js";
import { createD1 } from "./helpers/d1.mjs";

const { DB, sqlite } = createD1();
const env = { DB, ADMIN_PASSWORD: "local-test", MODE: "TEST", WOFFU_WRITE_ENABLED: "false" };
const liveEnv = { ...env, MODE: "LIVE", WOFFU_WRITE_ENABLED: "true", WOFFU_EMAIL: "test@example.invalid", WOFFU_PASSWORD: "test" };
const schedule = { daily_hours: 6, entry_am: "09:00", lunch_out: "13:00", lunch_in: "14:00", exit_pm: "16:00" };

async function request(path, body, environment = env) {
  return app.fetch(new Request(`https://clock.test${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { Authorization: `Basic ${btoa("admin:local-test")}`, Origin: "https://clock.test", "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }), environment, {});
}

async function ok(path, body) {
  const response = await request(path, body);
  const data = await response.json();
  assert.equal(response.status, 200, JSON.stringify(data));
  return data;
}

// Migrate an existing v3.4 installation, including its cached weekly plan.
sqlite.exec(`
  CREATE TABLE config (id INTEGER PRIMARY KEY, active INTEGER NOT NULL, daily_hours INTEGER NOT NULL DEFAULT 8,
    entry_am TEXT NOT NULL, lunch_out TEXT NOT NULL, lunch_in TEXT NOT NULL, exit_pm TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
  INSERT INTO config VALUES (1, 1, 6, '09:00', '13:00', '14:00', '16:00', CURRENT_TIMESTAMP);
  CREATE TABLE test_week_meta (week_start TEXT PRIMARY KEY, workdays INTEGER NOT NULL,
    target_seconds INTEGER NOT NULL, generated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
  INSERT INTO test_week_meta (week_start, workdays, target_seconds) VALUES ('2026-11-02', 5, 108000);
`);
mock.timers.enable({ apis: ["Date"], now: new Date("2026-11-02T08:00:00Z") });
const migrated = await ok("/api/bootstrap");
mock.timers.reset();
after(() => sqlite.close());

beforeEach((t) => {
  t.mock.timers.enable({ apis: ["Date"], now: new Date("2026-11-02T08:00:00Z") });
  t.mock.method(globalThis, "fetch", async () => { throw new Error("External Woffu calls are forbidden in these tests"); });
  t.mock.method(console, "error", () => {});
  sqlite.exec(`
    UPDATE config SET active = 0, office = NULL, daily_hours = 6, entry_am = '09:00', lunch_out = '13:00', lunch_in = '14:00', exit_pm = '16:00';
    DELETE FROM vacations; DELETE FROM manual_events; DELETE FROM day_pauses;
    DELETE FROM punch_log; DELETE FROM test_plan; DELETE FROM test_day_summary; DELETE FROM test_week_meta;
  `);
  for (const name of ["live_week_control", "live_event_actuals"]) {
    if (sqlite.prepare("SELECT 1 FROM sqlite_master WHERE name = ?").get(name)) {
      sqlite.exec(`DELETE FROM ${name}`);
    }
  }

});

test("migration preserves schedule and active preference without guessing an office", () => {
  assert.equal(migrated.config.office, null);
  assert.equal(migrated.config.daily_hours, 6);
  assert.equal(migrated.config.active, true);
  assert.equal(migrated.automation.ready, false);
  assert.equal(migrated.week.targetSeconds, 30 * 3600);
  assert.equal(migrated.holidayCalendar.holidays.length, 0);
});

test("all three offices have fourteen distinct official holidays in 2026 and 2027", () => {
  for (const { id } of OFFICES) {
    const calendar = getOfficeCalendar(id);
    assert.deepEqual(calendar.years, [2026, 2027]);
    for (const year of calendar.years) {
      const holidays = calendar.holidays.filter(({ date }) => date.startsWith(String(year)));
      assert.equal(holidays.length, 14);
      assert.equal(new Set(holidays.map(({ date }) => date)).size, 14);
      assert.equal(holidays.filter(({ local }) => local).length, 2);
      assert.ok(holidays.every(({ date }) => new Date(date).toISOString().slice(0, 10) === date));
    }
  }
  // Explicit published local dates; these must not be guessed from last year.
  for (const [office, year, expected] of [
    ["barcelona", 2026, ["2026-05-25", "2026-09-24"]],
    ["barcelona", 2027, ["2027-05-17", "2027-09-24"]],
    ["madrid", 2026, ["2026-05-15", "2026-11-09"]],
    ["madrid", 2027, ["2027-05-15", "2027-11-09"]],
    ["sevilla", 2026, ["2026-04-22", "2026-06-04"]],
    ["sevilla", 2027, ["2027-04-14", "2027-05-27"]],
  ]) {
    assert.deepEqual(getOfficeCalendar(office).holidays.filter((day) => day.local && day.date.startsWith(String(year))).map(({ date }) => date), expected);
  }
  assert.ok(getHoliday("madrid", "2026-11-02"));
  assert.equal(getHoliday("barcelona", "2026-11-02"), null);
  assert.ok(getHoliday("madrid", "2027-03-19"));
  assert.equal(getHoliday("madrid", "2027-05-03"), null);
  assert.ok(getHoliday("sevilla", "2027-08-16"));
  assert.equal(getHoliday("barcelona", "2027-08-16"), null);
  assert.equal(hasHolidayCalendar("barcelona", 2028), false);
});

for (const hours of [6, 8]) {
  for (const [office, holiday, monday] of [
    ["barcelona", "2026-09-24", "2026-09-21"],
    ["madrid", "2026-11-09", "2026-11-09"],
    ["sevilla", "2026-04-22", "2026-04-20"],
  ]) {
    test(`${office} ${hours}h: holidays remove four marks, reduce the target and never double-count vacations`, async (t) => {
      t.mock.timers.setTime(new Date(`${monday}T07:00:00Z`).getTime());
      await ok("/api/office", { office });
      await ok("/api/config", { ...schedule, daily_hours: hours, exit_pm: hours === 8 ? "18:00" : "16:00" });
      let data = await ok(`/api/bootstrap?manual_day=${holiday}`);
      assert.equal(data.config.office, office);
      assert.equal(data.week.targetSeconds, 4 * hours * 3600);
      assert.equal(data.week.adjustmentSeconds, 0);
      assert.equal(data.week.complete, true);
      assert.ok(data.week.days.find(({ date }) => date === holiday).holiday);
      assert.deepEqual(data.manualDay.plan, {});
      assert.equal(data.manualDay.complete, false);
      assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM test_plan WHERE day = ?").get(holiday).n, 0);
      const vacation = data.week.days.find((day) => !day.holiday).date;
      await ok("/api/vacations", { dates: [holiday, vacation] });
      data = await ok("/api/bootstrap");
      assert.equal(data.week.targetSeconds, 3 * hours * 3600);
      assert.equal(data.week.workdays, 3);
      assert.equal(data.week.adjustmentSeconds, 0);
      assert.equal((await request("/api/manual", { day: holiday, event: "ENTRY_AM", manual_time: "09:00" })).status, 400);
      assert.equal((await request("/api/pause", { day: holiday, from_event: "ENTRY_AM" })).status, 400);
    });
  }
}

test("changing office replaces holidays immediately and preserves user vacations", async (t) => {
  t.mock.timers.setTime(new Date("2026-09-21T07:00:00Z").getTime());
  await ok("/api/office", { office: "madrid" });
  await ok("/api/vacations", { dates: ["2026-09-24"] });
  await ok("/api/office", { office: "barcelona" });
  let data = await ok("/api/bootstrap");
  assert.equal(data.week.workdays, 4);
  assert.equal(data.week.days[3].holiday.name, "La Mercè");
  assert.equal(data.week.days[3].vacation, false);
  assert.deepEqual(data.vacations, ["2026-09-24"]);
  await ok("/api/office", { office: "madrid" });
  data = await ok("/api/bootstrap");
  assert.equal(data.week.days[3].holiday, null);
  assert.equal(data.week.days[3].vacation, true);
  assert.equal(data.week.targetSeconds, 24 * 3600);
  for (const office of [null, "", "other", "__proto__", ["barcelona"]]) {
    assert.equal((await request("/api/office", { office })).status, 400);
  }
  assert.equal((await ok("/api/bootstrap")).config.office, "madrid");
});

test("calendar revisions invalidate cached plans even when the office stays the same", async () => {
  await ok("/api/office", { office: "madrid" });
  await ok("/api/bootstrap");
  sqlite.exec("UPDATE test_week_meta SET calendar_key = 'old-revision', target_seconds = 108000; DELETE FROM test_plan;");
  const data = await ok("/api/bootstrap");
  assert.equal(data.week.targetSeconds, 24 * 3600);
  assert.equal(data.week.complete, true);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM test_plan").get().n, 16);
});

test("TEST and LIVE skip official holidays even if an old plan still contains marks", async (t) => {
  await ok("/api/office", { office: "madrid" });
  await ok("/api/active", { active: true });
  await ok("/api/bootstrap");
  sqlite.exec(`INSERT INTO test_plan (week_start, day, event, base_time, planned_time, offset_seconds)
    VALUES ('2026-11-02', '2026-11-02', 'ENTRY_AM', '09:00', '09:00:00', 0);`);
  for (const environment of [env, liveEnv]) {
    const pending = [];
    await app.scheduled({ scheduledTime: Date.now() }, environment, { waitUntil(promise) { pending.push(promise); } });
    await Promise.all(pending);
    assert.equal(await claimScheduledEvent(environment, "2026-11-02", "ENTRY_AM", "09:00:00", environment.MODE), false);
  }
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM punch_log").get().n, 0);
  assert.equal(globalThis.fetch.mock.callCount(), 0);
  // This final check also protects a worker that started waiting before an office change.
  await ok("/api/office", { office: "barcelona" });
  await ok("/api/bootstrap");
  const entry = sqlite.prepare("SELECT planned_time FROM test_plan WHERE day = '2026-11-02' AND event = 'ENTRY_AM'").get();
  await ok("/api/office", { office: "madrid" });
  assert.equal(await claimScheduledEvent(liveEnv, "2026-11-02", "ENTRY_AM", entry.planned_time, "LIVE"), false);
});

test("real manual punches are rejected on a holiday before making any Woffu request", async () => {
  await ok("/api/office", { office: "madrid" });
  const response = await request("/api/woffu/punch-now", { confirm: "PUNCH_NOW" }, liveEnv);
  assert.equal(response.status, 409);
  assert.match((await response.json()).error, /Festivo/);
  assert.equal(globalThis.fetch.mock.callCount(), 0);
});

test("missing office or unknown year blocks automatic punches with an explicit setup message", async (t) => {
  assert.equal((await request("/api/active", { active: true })).status, 409);
  await ok("/api/office", { office: "sevilla" });
  await ok("/api/active", { active: true });
  t.mock.timers.setTime(new Date("2028-01-03T08:00:00Z").getTime());
  const data = await ok("/api/bootstrap");
  assert.equal(data.automation.ready, false);
  assert.match(data.automation.reason, /2028/);
  assert.equal(data.week.targetSeconds, null);
  assert.equal(data.week.complete, false);
  assert.ok(data.week.days.every((day) => day.calendarMissing));
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM test_plan").get().n, 0);
  const pending = [];
  await app.scheduled({ scheduledTime: Date.now() }, liveEnv, { waitUntil(promise) { pending.push(promise); } });
  await Promise.all(pending);
  assert.equal(globalThis.fetch.mock.callCount(), 0);
  assert.equal((await request("/api/active", { active: true })).status, 409);
  assert.equal((await request("/api/woffu/punch-now", { confirm: "PUNCH_NOW" }, liveEnv)).status, 409);
  await ok("/api/active", { active: false });
});
