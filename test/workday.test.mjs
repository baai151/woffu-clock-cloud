import assert from "node:assert/strict";
import { after, beforeEach, mock, test } from "node:test";
import app from "../src/index-v11.js";
import { createD1 } from "./helpers/d1.mjs";

const { DB, sqlite } = createD1();
const env = { DB, ADMIN_PASSWORD: "local-test", MODE: "TEST", WOFFU_WRITE_ENABLED: "false" };
const liveEnv = { ...env, MODE: "LIVE", WOFFU_WRITE_ENABLED: "true", WOFFU_EMAIL: "test@example.invalid", WOFFU_PASSWORD: "test" };
const weekStart = "2026-11-02";
const weekdays = [2, 3, 4, 5, 6].map((day) => `2026-11-0${day}`);
const split = { daily_hours: 8, entry_am: "09:00", lunch_out: "13:00", lunch_in: "14:00", exit_pm: "18:00" };
const sixHours = { daily_hours: 6, entry_am: "09:00", lunch_out: "13:00", lunch_in: "14:00", exit_pm: "16:00" };
const events = ["ENTRY_AM", "LUNCH_OUT", "LUNCH_IN", "EXIT_PM"];

// Start with the schema and a customised schedule from an existing installation.
sqlite.exec(`
  CREATE TABLE config (
    id INTEGER PRIMARY KEY, active INTEGER NOT NULL,
    entry_am TEXT NOT NULL, lunch_out TEXT NOT NULL,
    lunch_in TEXT NOT NULL, exit_pm TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  INSERT INTO config (id, active, entry_am, lunch_out, lunch_in, exit_pm)
  VALUES (1, 0, '08:00', '12:00', '13:00', '17:00');
  CREATE TABLE vacations (date TEXT PRIMARY KEY);
  INSERT INTO vacations (date) VALUES ('2026-11-03');
`);

async function request(path, body, worker = app, environment = env) {
  return worker.fetch(new Request(`https://clock.test${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      Authorization: `Basic ${btoa("admin:local-test")}`,
      Origin: "https://clock.test",
      "Content-Type": "application/json",
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }), environment, {});
}

async function ok(path, body, worker, environment) {
  const response = await request(path, body, worker, environment);
  const data = await response.json();
  assert.equal(response.status, 200, JSON.stringify(data));
  assert.equal(data.ok, true);
  return data;
}

mock.timers.enable({ apis: ["Date"], now: new Date("2026-11-02T07:00:00Z") });
const migrated = await ok(`/api/bootstrap?manual_day=${weekStart}`);
mock.timers.reset();
after(() => sqlite.close());

beforeEach((t) => {
  t.mock.timers.enable({ apis: ["Date"], now: new Date("2026-11-02T07:00:00Z") });
  t.mock.method(globalThis, "fetch", async () => {
    throw new Error("Tests must not contact Woffu or any external service");
  });
  sqlite.exec(`
    UPDATE config SET active = 0, office = 'barcelona', daily_hours = 8, entry_am = '09:00',
      lunch_out = '13:00', lunch_in = '14:00', exit_pm = '18:00';
    DELETE FROM vacations;
    DELETE FROM manual_events;
    DELETE FROM day_pauses;
    DELETE FROM punch_log;
    DELETE FROM test_plan;
    DELETE FROM test_day_summary;
    DELETE FROM test_week_meta;
  `);
  for (const name of ["live_week_control", "live_event_actuals"]) {
    if (sqlite.prepare("SELECT 1 FROM sqlite_master WHERE name = ?").get(name)) {
      sqlite.exec(`DELETE FROM ${name}`);
    }
  }

});

const seconds = (time) => time.split(":").reduce((total, part) => total * 60 + Number(part), 0);
const rows = (table) => sqlite.prepare(`SELECT * FROM ${table} ORDER BY 1, 2`).all();
const planFor = (day) => sqlite.prepare("SELECT * FROM test_plan WHERE day = ? ORDER BY planned_time").all(day);

async function generate(config = sixHours, vacations = []) {
  await ok("/api/config", config);
  await ok("/api/vacations", { dates: vacations });
  await ok("/api/regenerate", { day: weekStart });
}

async function tick(t, day, time, environment = env) {
  // These fixtures are in November, when Madrid is at UTC+01:00.
  const now = new Date(`${day}T${time}+01:00`);
  t.mock.timers.setTime(now.getTime());
  const pending = [];
  await app.scheduled({ scheduledTime: now.getTime() }, environment, {
    waitUntil(promise) { pending.push(promise); },
  });
  await Promise.all(pending);
}

test("existing installations retain their eight-hour schedule and vacations", () => {
  assert.equal(migrated.config.daily_hours, 8);
  assert.equal(migrated.config.entry_am, "08:00");
  assert.equal(migrated.config.exit_pm, "17:00");
  assert.equal(migrated.config.active, false);
  assert.equal(migrated.config.office, null);
  assert.equal(migrated.automation.ready, false);
  assert.deepEqual(migrated.vacations, ["2026-11-03"]);
  assert.equal(migrated.manualDay.complete, true);
  assert.equal(Object.keys(migrated.manualDay.plan).length, 4);
});

test("a new database starts with an eight-hour schedule", async () => {
  const fresh = createD1();
  try {
    const worker = (await import("../src/index-v5.js?fresh-database")).default;
    const data = await ok("/api/bootstrap", undefined, worker, { ...env, DB: fresh.DB });
    assert.equal(data.config.daily_hours, 8);
    assert.equal(data.week.targetSeconds, 40 * 3600);
    assert.equal(data.week.complete, true);
    assert.equal(fresh.sqlite.prepare("SELECT COUNT(*) AS count FROM test_plan").get().count, 20);
  } finally {
    fresh.sqlite.close();
  }
});

for (const config of [sixHours, split]) {
  test(`${config.daily_hours}h: random marks stay within limits and balance with 0–5 vacation days`, async () => {
    for (let vacationCount = 0; vacationCount <= 5; vacationCount++) {
      const vacations = weekdays.slice(0, vacationCount);
      await generate(config, vacations);

      for (let sample = 0; sample < 12; sample++) {
        if (sample) await ok("/api/regenerate", { day: weekStart });
        const plans = rows("test_plan");
        const summaries = rows("test_day_summary");
        const meta = rows("test_week_meta")[0];
        const expectedTarget = (5 - vacationCount) * config.daily_hours * 3600;
        assert.equal(meta.workdays, 5 - vacationCount);
        assert.equal(meta.target_seconds, expectedTarget);
        assert.equal(plans.length, (5 - vacationCount) * events.length);
        assert.equal(summaries.reduce((total, row) => total + row.worked_seconds, 0), expectedTarget);
        assert.equal(summaries.reduce((total, row) => total + row.deviation_seconds, 0), 0);

        for (const day of weekdays) {
          const dayPlans = planFor(day);
          if (vacations.includes(day)) {
            assert.equal(dayPlans.length, 0);
            continue;
          }
          assert.deepEqual(dayPlans.map((row) => row.event), events);
          const planned = Object.fromEntries(dayPlans.map((row) => [row.event, seconds(row.planned_time)]));
          for (const row of dayPlans) {
            assert.ok(row.offset_seconds >= 0 && row.offset_seconds <= 299);
            assert.equal(seconds(row.planned_time) - seconds(row.base_time + ":00"), row.offset_seconds);
          }
          const worked = planned.LUNCH_OUT - planned.ENTRY_AM + planned.EXIT_PM - planned.LUNCH_IN;
          const summary = summaries.find((row) => row.day === day);
          assert.equal(worked, summary.worked_seconds);
          assert.equal(worked - config.daily_hours * 3600, summary.deviation_seconds);
          assert.ok(Math.abs(summary.deviation_seconds) <= 180);
          assert.ok(planned.LUNCH_IN - planned.LUNCH_OUT >= 3600);
        }
      }

      const data = await ok(`/api/bootstrap?manual_day=${weekStart}`);
      assert.equal(data.week.effectiveTotal, data.week.targetSeconds);
      assert.equal(data.week.adjustmentSeconds, 0);
      assert.equal(data.week.complete, true);
    }
  });
}

test("switching 8h → 6h → 8h rebuilds the plan and retains vacations and lunch settings", async () => {
  await generate(split, [weekdays[1]]);
  assert.equal(rows("test_plan").length, 16);
  await ok("/api/config", sixHours);
  assert.equal(rows("test_plan").length, 0);
  let data = await ok("/api/bootstrap");
  assert.equal(data.config.daily_hours, 6);
  assert.equal(data.config.lunch_out, "13:00");
  assert.equal(data.config.lunch_in, "14:00");
  assert.equal(data.week.targetSeconds, 24 * 3600);
  assert.equal(rows("test_plan").length, 16);
  assert.deepEqual(data.vacations, [weekdays[1]]);

  await ok("/api/config", split);
  data = await ok("/api/bootstrap");
  assert.equal(data.week.targetSeconds, 32 * 3600);
  assert.equal(rows("test_plan").length, 16);
  assert.deepEqual(data.vacations, [weekdays[1]]);
});

test("both schedules keep chronological marks even with a short morning or afternoon", async () => {
  for (const config of [
    { ...split, entry_am: "09:00", lunch_out: "09:01", lunch_in: "10:01", exit_pm: "18:00" },
    { ...split, entry_am: "00:00", lunch_out: "07:59", lunch_in: "08:59", exit_pm: "09:00" },
    { ...sixHours, entry_am: "09:00", lunch_out: "09:01", lunch_in: "10:01", exit_pm: "16:00" },
    { ...sixHours, entry_am: "00:00", lunch_out: "05:59", lunch_in: "06:59", exit_pm: "07:00" },
  ]) {
    await generate(config);
    for (let sample = 0; sample < 12; sample++) {
      await ok("/api/regenerate", { day: weekStart });
      for (const day of weekdays) {
        const marks = planFor(day);
        assert.deepEqual(marks.map((row) => row.event), events);
        assert.ok(seconds(marks[1].planned_time) > seconds(marks[0].planned_time));
        assert.ok(seconds(marks[3].planned_time) > seconds(marks[2].planned_time));
      }
    }
  }
});

test("manual totals use six worked hours and include all four manual marks", async () => {
  await generate();
  const day = weekStart;
  const plan = planFor(day);
  const manualTimes = ["09:00:00", "13:00:00", "14:00:00", "16:02:00"];
  for (const [index, event] of events.entries()) {
    await ok("/api/manual", { day, event, manual_time: manualTimes[index] });
  }
  const data = await ok(`/api/bootstrap?manual_day=${day}`);
  assert.equal(data.manualDay.workedSeconds, 6 * 3600 + 120);
  assert.equal(data.manualDay.adjustmentSeconds, 120);
  assert.equal(Object.keys(data.manualDay.manual).length, 4);
  assert.equal(data.week.complete, true);
  const plannedWorked = seconds(plan[1].planned_time) - seconds(plan[0].planned_time) + seconds(plan[3].planned_time) - seconds(plan[2].planned_time);
  assert.equal(data.week.adjustmentSeconds, 120 - (plannedWorked - 6 * 3600));
});

test("a six-hour pause from lunch requires all three remaining manual marks", async () => {
  await generate();
  await ok("/api/pause", { day: weekStart, from_event: "LUNCH_OUT" });
  let data = await ok("/api/bootstrap");
  assert.equal(data.week.complete, false);
  assert.equal(data.manualDay.complete, false);
  assert.equal(data.manualDay.workedSeconds, null);
  for (const row of planFor(weekStart).slice(1)) {
    await ok("/api/manual", { day: weekStart, event: row.event, manual_time: row.planned_time });
    data = await ok("/api/bootstrap");
    assert.equal(data.week.complete, row.event === "EXIT_PM");
    assert.equal(data.manualDay.complete, data.week.complete);
  }
  assert.equal(data.week.adjustmentSeconds, 0);
});

test("invalid totals, missing marks and short breaks return 400 without replacing the plan", async (t) => {
  t.mock.method(console, "error", () => {});
  await generate();
  const previousPlan = rows("test_plan");
  for (const config of [
    { ...sixHours, daily_hours: 7 },
    { ...sixHours, daily_hours: "invalid" },
    { ...sixHours, exit_pm: "17:00" },
    { ...sixHours, entry_am: "15:00", exit_pm: "09:00" },
    { ...sixHours, entry_am: "18:00", exit_pm: "00:00" },
    { ...sixHours, entry_am: "17:59", exit_pm: "23:59" },
    { ...sixHours, entry_am: "25:00" },
    { ...sixHours, lunch_out: undefined },
    { ...sixHours, lunch_in: null },
    { ...sixHours, lunch_in: "13:30", exit_pm: "15:30" },
    { ...sixHours, lunch_out: "14:30", lunch_in: "13:30" },
    { ...split, lunch_in: "13:30", exit_pm: "17:30" },
  ]) {
    const response = await request("/api/config", config);
    assert.equal(response.status, 400);
    assert.equal((await response.json()).ok, false);
    assert.deepEqual(rows("test_plan"), previousPlan);
    assert.equal(rows("config")[0].daily_hours, 6);
  }
  assert.equal((await request("/api/manual", { day: weekStart, event: "LUNCH_IN", manual_time: "13:59" })).status, 400);
  assert.equal((await request("/api/manual", { day: weekStart, event: "EXIT_PM", manual_time: "08:00" })).status, 400);
});

test("saving vacations removes marks and excludes both automatic and manual events", async (t) => {
  t.mock.method(console, "error", () => {});
  await generate();
  const entry = planFor(weekStart)[0].planned_time;
  await ok("/api/active", { active: true });
  await ok("/api/vacations", { dates: [weekStart] });
  await tick(t, weekStart, entry);
  assert.equal(rows("punch_log").length, 0);
  assert.equal((await request("/api/manual", { day: weekStart, event: "ENTRY_AM", manual_time: "09:00" })).status, 400);
  const data = await ok("/api/bootstrap");
  assert.equal(data.week.targetSeconds, 24 * 3600);
  assert.equal(data.week.days[0].vacation, true);
  assert.deepEqual(data.week.days[0].plan, {});
  assert.equal(planFor(weekStart).length, 0);
});

for (const config of [sixHours, split]) {
  test(`${config.daily_hours}h scheduler consumes the generated marks once in TEST mode`, async (t) => {
    t.mock.method(console, "log", () => {});
    await generate(config);
    await ok("/api/active", { active: true });
    for (const row of planFor(weekStart)) {
      await tick(t, weekStart, row.planned_time);
      await tick(t, weekStart, row.planned_time);
    }
    const logs = rows("punch_log");
    assert.equal(logs.length, 4);
    assert.ok(logs.every((row) => row.status === "TEST" && row.attempts === 1));
    assert.equal(globalThis.fetch.mock.callCount(), 0);
  });
}

test("six-hour scheduler honours manual entry and a pause from lunch", async (t) => {
  await generate();
  await ok("/api/active", { active: true });
  const plan = planFor(weekStart);
  await ok("/api/manual", { day: weekStart, event: "ENTRY_AM", manual_time: plan[0].planned_time });
  await ok("/api/pause", { day: weekStart, from_event: "LUNCH_OUT" });
  for (const row of plan) await tick(t, weekStart, row.planned_time);
  assert.equal(rows("punch_log").length, 0);
  assert.equal(globalThis.fetch.mock.callCount(), 0);
});

test("the LIVE adapter uses all four six-hour marks with Woffu fully mocked", async (t) => {
  t.mock.method(console, "log", () => {});
  const sent = [];
  t.mock.method(globalThis, "fetch", async (url, options) => {
    const path = new URL(url).pathname;
    if (path === "/token") return Response.json({ access_token: "test-token" });
    if (path === "/api/users") return Response.json([{ UserId: 1, CompanyId: 2 }]);
    if (path === "/api/companies/2") return Response.json({ Domain: "clock-test.woffu.com" });
    assert.equal(path, "/api/svc/signs/signs");
    assert.equal(options.method, "POST");
    sent.push(JSON.parse(options.body));
    return Response.json({});
  });
  await generate();
  await ok("/api/active", { active: true });
  await tick(t, weekStart, "08:00:00", liveEnv);
  const plan = planFor(weekStart);
  for (const row of plan) {
    await tick(t, weekStart, row.planned_time, liveEnv);
    await tick(t, weekStart, row.planned_time, liveEnv);
  }
  assert.equal(sent.length, 4);
  assert.deepEqual(sent.map((punch) => punch.StartDate), plan.map((row) => `${weekStart}T${row.planned_time}+01:00`));
  assert.ok(rows("punch_log").every((row) => row.status === "SUCCESS"));

  await ok("/api/vacations", { dates: [weekStart] });
  await tick(t, weekStart, plan[0].planned_time, liveEnv);
  assert.equal(sent.length, 4);
});

test("malformed JSON objects and vacation lists are rejected without deleting saved data", async (t) => {
  t.mock.method(console, "error", () => {});
  await generate(sixHours, [weekStart]);
  for (const body of [null, [], {}, { dates: null }, { dates: "2026-11-02" }, { dates: ["not-a-date"] }, { dates: ["2026-11-07"] }]) {
    const response = await request("/api/vacations", body);
    assert.equal(response.status, 400);
    assert.equal((await response.json()).ok, false);
    assert.equal(sqlite.prepare("SELECT date FROM vacations").get().date, weekStart);
  }
  assert.equal((await request("/api/active", { active: "false" })).status, 400);
  assert.equal(rows("config")[0].active, 0);
});

test("manual state is unavailable on vacations and weekends", async () => {
  await generate(sixHours, [weekStart]);
  const vacation = await ok(`/api/bootstrap?manual_day=${weekStart}`);
  assert.equal(vacation.manualDay.vacation, true);
  assert.equal(vacation.manualDay.complete, false);
  const weekend = await ok("/api/bootstrap?manual_day=2026-11-07");
  assert.equal(weekend.manualDay.workday, false);
  assert.equal(weekend.manualDay.complete, false);
});

test("the real manual-punch API returns an explicit origin error without contacting Woffu", async (t) => {
  t.mock.method(console, "error", () => {});
  const response = await app.fetch(new Request("https://clock.test/api/woffu/punch-now", {
    method: "POST",
    headers: { Authorization: `Basic ${btoa("admin:local-test")}`, Origin: "https://different.test", "Content-Type": "application/json" },
    body: JSON.stringify({ confirm: "PUNCH_NOW" }),
  }), liveEnv, {});
  assert.equal(response.status, 403);
  assert.equal((await response.json()).error, "Origen no permitido.");
  assert.equal(globalThis.fetch.mock.callCount(), 0);
});

for (const status of ["SUCCESS", "PENDING", "FAILED", "POSTING", "UNKNOWN"]) {
  test(`LIVE does not resend an existing ${status} event after its planned time changes`, async (t) => {
    await generate();
    await ok("/api/active", { active: true });
    sqlite.prepare("INSERT INTO punch_log (day, event, scheduled_time, status, attempts) VALUES (?, 'ENTRY_AM', '01:00:00', ?, 1)")
      .run(weekStart, status);
    await tick(t, weekStart, planFor(weekStart)[0].planned_time, liveEnv);
    assert.equal(globalThis.fetch.mock.callCount(), 0);
    assert.equal(rows("punch_log")[0].status, ["PENDING", "POSTING"].includes(status) ? "UNKNOWN" : status);
    assert.equal(rows("punch_log")[0].attempts, 1);
  });

  test(`TEST preserves an existing ${status} attempt when real writes are disabled`, async (t) => {
    await generate();
    await ok("/api/active", { active: true });
    sqlite.prepare("INSERT INTO punch_log (day, event, scheduled_time, status, attempts) VALUES (?, 'ENTRY_AM', '01:00:00', ?, 1)")
      .run(weekStart, status);
    await tick(t, weekStart, planFor(weekStart)[0].planned_time, { ...liveEnv, WOFFU_WRITE_ENABLED: "false" });
    assert.equal(rows("punch_log")[0].status, status);
    assert.equal(rows("punch_log")[0].attempts, 1);
    assert.equal(globalThis.fetch.mock.callCount(), 0);
  });
}

test("concurrent LIVE invocations atomically claim a previous TEST event once", async (t) => {
  t.mock.method(console, "log", () => {});
  let signs = 0;
  t.mock.method(globalThis, "fetch", async (url) => {
    const path = new URL(url).pathname;
    if (path === "/token") return Response.json({ access_token: "test-token" });
    if (path === "/api/users") return Response.json([{ UserId: 1, CompanyId: 2 }]);
    if (path === "/api/companies/2") return Response.json({ Domain: "clock-test.woffu.com" });
    assert.equal(path, "/api/svc/signs/signs");
    signs++;
    return Response.json({});
  });
  await generate();
  await ok("/api/active", { active: true });
  const entry = planFor(weekStart)[0];
  sqlite.prepare("INSERT INTO punch_log (day, event, scheduled_time, status, attempts) VALUES (?, 'ENTRY_AM', ?, 'TEST', 1)")
    .run(weekStart, entry.planned_time);
  await Promise.all([tick(t, weekStart, entry.planned_time, liveEnv), tick(t, weekStart, entry.planned_time, liveEnv)]);
  assert.equal(signs, 1);
  assert.equal(rows("punch_log")[0].status, "SUCCESS");
  assert.equal(rows("punch_log")[0].attempts, 2);
});

test("LIVE with writes disabled runs a TEST event instead of logging an adapter failure", async (t) => {
  t.mock.method(console, "log", () => {});
  await generate();
  await ok("/api/active", { active: true });
  await tick(t, weekStart, planFor(weekStart)[0].planned_time, { ...liveEnv, WOFFU_WRITE_ENABLED: "false" });
  assert.equal(rows("punch_log")[0].status, "TEST");
  assert.equal(globalThis.fetch.mock.callCount(), 0);
});

test("LIVE ignores events beyond the existing ten-minute recovery window", async (t) => {
  await generate();
  await ok("/api/active", { active: true });
  const entry = planFor(weekStart)[0];
  const scheduledTime = new Date(`${weekStart}T${entry.planned_time}+01:00`).getTime();
  t.mock.timers.setTime(scheduledTime + 11 * 60 * 1000);
  const pending = [];
  await app.scheduled({ scheduledTime }, liveEnv, { waitUntil(promise) { pending.push(promise); } });
  await Promise.all(pending);
  assert.equal(globalThis.fetch.mock.callCount(), 0);
  assert.equal(rows("punch_log").length, 0);
});

test("upgrading an intact legacy week does not randomize existing production marks", async () => {
  await generate(split);
  sqlite.exec("UPDATE config SET office = NULL; UPDATE test_week_meta SET calendar_key = '', target_seconds = target_seconds + 224");
  const previous = rows("test_plan");
  const data = await ok("/api/bootstrap");
  assert.deepEqual(rows("test_plan"), previous);
  assert.equal(data.week.targetSeconds, 40 * 3600 + 224);
  assert.equal(data.config.office, null);
  assert.equal(data.automation.ready, false);
});

test("production compensation uses the selected hours and excludes holidays and vacations", async (t) => {
  t.mock.method(console, "log", () => {});
  await generate(sixHours, ["2026-11-03"]);
  await ok("/api/office", { office: "madrid" });
  await ok("/api/active", { active: true });
  for (const schedule of [sixHours, split]) {
    await ok("/api/config", schedule);
    await tick(t, "2026-11-04", "08:00:00", liveEnv);
    const control = rows("live_week_control")[0];
    assert.equal(control.workdays, 3);
    assert.equal(control.base_target_seconds, 3 * schedule.daily_hours * 3600);
    assert.ok(control.target_extra_seconds >= 0 && control.target_extra_seconds <= 180);
    assert.equal(control.target_seconds, control.base_target_seconds + control.target_extra_seconds);
    assert.equal(rows("test_day_summary").reduce((sum, row) => sum + row.worked_seconds, 0), control.target_seconds);
    assert.equal(rows("test_plan").some((row) => ["2026-11-02", "2026-11-03"].includes(row.day)), false);
    assert.ok(rows("test_day_summary").every((row) => row.deviation_seconds === row.worked_seconds - schedule.daily_hours * 3600));
  }
  assert.equal(globalThis.fetch.mock.callCount(), 0);
});

for (const change of ["vacation", "holiday office", "pause", "manual mark", "new plan", "deactivated"]) {
  test(`LIVE rechecks ${change} after authentication and before posting`, async (t) => {
    t.mock.method(console, "log", () => {});
    await generate();
    await ok("/api/active", { active: true });
    await tick(t, weekStart, "08:00:00", liveEnv);
    const entry = planFor(weekStart)[0];
    let signs = 0;
    t.mock.method(globalThis, "fetch", async (url) => {
      const path = new URL(url).pathname;
      if (path === "/token") return Response.json({ access_token: "test-token" });
      if (path === "/api/users") return Response.json([{ UserId: 1, CompanyId: 2 }]);
      if (path === "/api/companies/2") {
        if (change === "vacation") sqlite.prepare("INSERT INTO vacations (date) VALUES (?)").run(weekStart);
        if (change === "holiday office") sqlite.exec("UPDATE config SET office = 'madrid'");
        if (change === "pause") sqlite.prepare("INSERT INTO day_pauses (day, paused_from_order) VALUES (?, 1)").run(weekStart);
        if (change === "manual mark") sqlite.prepare("INSERT INTO manual_events (day, event, manual_time) VALUES (?, 'ENTRY_AM', '09:00:00')").run(weekStart);
        if (change === "new plan") sqlite.prepare("UPDATE test_plan SET planned_time = '09:10:00' WHERE day = ? AND event = 'ENTRY_AM'").run(weekStart);
        if (change === "deactivated") sqlite.exec("UPDATE config SET active = 0");
        return Response.json({ Domain: "clock-test.woffu.com" });
      }
      signs++;
      return Response.json({});
    });
    await tick(t, weekStart, entry.planned_time, liveEnv);
    assert.equal(signs, 0);
    assert.equal(rows("punch_log")[0].status, "PENDING_SAFE");
  });
}
