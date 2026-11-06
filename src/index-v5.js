import { isAuthorized, unauthorizedResponse } from "./browser-auth.js";
import { OFFICES, HOLIDAY_CALENDAR_VERSION, isOffice, hasHolidayCalendar, getHoliday, getOfficeCalendar } from "./holidays.js";
import appStyles from "./ui-styles.js";
import { uiAssetResponse } from "./ui-assets.js";

const APP_VERSION = "3.6.4-capgemini";
const TIMEZONE = "Europe/Madrid";
const MAX_OFFSET_SECONDS = 299;
const MAX_DAILY_DEVIATION_SECONDS = 180;
const DEFAULT_DAILY_HOURS = 8;
const MIN_BREAK_SECONDS = 60 * 60;

const EVENTS = [
  { event: "ENTRY_AM", field: "entry_am", label: "Entrada mañana", shortLabel: "Entrada", order: 1 },
  { event: "LUNCH_OUT", field: "lunch_out", label: "Salida mediodía", shortLabel: "Pausa", order: 2 },
  { event: "LUNCH_IN", field: "lunch_in", label: "Entrada mediodía", shortLabel: "Vuelta", order: 3 },
  { event: "EXIT_PM", field: "exit_pm", label: "Salida tarde", shortLabel: "Salida", order: 4 },
];

let schemaPromise;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname.startsWith("/assets/")) {
      const asset = uiAssetResponse(url.pathname);
      return asset || textResponse("Not found", 404);
    }

    if (request.method === "GET" && url.pathname === "/health") {
      return jsonResponse({
        ok: true,
        app: "woffu-clock-cloud",
        version: APP_VERSION,
        mode: String(env.MODE || "TEST").toUpperCase(),
      });
    }

    if (request.method === "GET" && url.pathname === "/manifest.webmanifest") {
      return manifestResponse();
    }

    if (request.method === "GET" && url.pathname === "/icon.svg") {
      return iconResponse();
    }

    // Safari probes these optional icons in the background; missing icons must
    // never trigger a second authentication dialog.
    if (["/favicon.ico", "/apple-touch-icon.png", "/apple-touch-icon-precomposed.png"].includes(url.pathname)) {
      return textResponse("Not found", 404);
    }

    if (!await isAuthorized(request, env)) return unauthorizedResponse(request);

    try {
      if (request.method === "GET" && url.pathname === "/") {
        return htmlResponse(appShell());
      }

      if (request.method === "GET" && url.pathname === "/api/session") {
        return jsonResponse({ ok: true });
      }

      if (url.pathname.startsWith("/api/")) {
        await ensureSchemaOnce(env);
      }

      if (request.method === "GET" && url.pathname === "/api/bootstrap") {
        return await bootstrapResponse(request, env);
      }

      if (request.method === "POST") {
        assertSameOrigin(request, url);

        if (url.pathname === "/api/active") return await updateActive(request, env);
        if (url.pathname === "/api/config") return await updateConfig(request, env);
        if (url.pathname === "/api/office") return await updateOffice(request, env);
        if (url.pathname === "/api/vacations") return await updateVacations(request, env);
        if (url.pathname === "/api/manual") return await upsertManualEvent(request, env);
        if (url.pathname === "/api/manual/delete") return await removeManualEvent(request, env);
        if (url.pathname === "/api/pause") return await upsertDayPause(request, env);
        if (url.pathname === "/api/pause/clear") return await clearDayPause(request, env);
        if (url.pathname === "/api/regenerate") return await regenerateWeek(request, env);
      }

      return textResponse("Not found", 404);
    } catch (error) {
      console.error(error);
      return jsonResponse(
        {
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        },
        error instanceof HttpError ? error.status : 500
      );
    }
  },

  async scheduled(controller, env, ctx) {
    const scheduledAt = new Date(controller.scheduledTime);
    const actualNow = new Date();
    ctx.waitUntil(runScheduler(env, scheduledAt, actualNow));
  },
};

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// ==================================================
// SCHEMA
// ==================================================

function ensureSchemaOnce(env) {
  if (!schemaPromise) {
    schemaPromise = ensureSchema(env).catch((error) => {
      schemaPromise = undefined;
      throw error;
    });
  }
  return schemaPromise;
}

async function ensureSchema(env) {
  await env.DB.batch([
    env.DB.prepare(`
      CREATE TABLE IF NOT EXISTS config (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        active INTEGER NOT NULL DEFAULT 0,
        daily_hours INTEGER NOT NULL DEFAULT 8 CHECK (daily_hours IN (6, 8)),
        office TEXT CHECK (office IN ('barcelona', 'madrid', 'sevilla')),
        entry_am TEXT NOT NULL DEFAULT '09:00',
        lunch_out TEXT NOT NULL DEFAULT '13:00',
        lunch_in TEXT NOT NULL DEFAULT '14:00',
        exit_pm TEXT NOT NULL DEFAULT '18:00',
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `),
    env.DB.prepare(`
      INSERT OR IGNORE INTO config (
        id, active, entry_am, lunch_out, lunch_in, exit_pm
      ) VALUES (1, 0, '09:00', '13:00', '14:00', '18:00')
    `),
    env.DB.prepare(`
      CREATE TABLE IF NOT EXISTS punch_log (
        day TEXT NOT NULL,
        event TEXT NOT NULL,
        scheduled_time TEXT NOT NULL,
        status TEXT NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0,
        executed_at TEXT,
        error TEXT,
        PRIMARY KEY (day, event)
      )
    `),
    env.DB.prepare(`
      CREATE TABLE IF NOT EXISTS vacations (
        date TEXT PRIMARY KEY,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `),
    env.DB.prepare(`
      CREATE TABLE IF NOT EXISTS test_plan (
        week_start TEXT NOT NULL,
        day TEXT NOT NULL,
        event TEXT NOT NULL,
        base_time TEXT NOT NULL,
        planned_time TEXT NOT NULL,
        offset_seconds INTEGER NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (week_start, day, event)
      )
    `),
    env.DB.prepare(`
      CREATE TABLE IF NOT EXISTS test_day_summary (
        week_start TEXT NOT NULL,
        day TEXT NOT NULL,
        worked_seconds INTEGER NOT NULL,
        deviation_seconds INTEGER NOT NULL,
        PRIMARY KEY (week_start, day)
      )
    `),
    env.DB.prepare(`
      CREATE TABLE IF NOT EXISTS test_week_meta (
        week_start TEXT PRIMARY KEY,
        workdays INTEGER NOT NULL,
        target_seconds INTEGER NOT NULL,
        calendar_key TEXT NOT NULL DEFAULT '',
        generated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `),
    env.DB.prepare(`
      CREATE TABLE IF NOT EXISTS manual_events (
        day TEXT NOT NULL,
        event TEXT NOT NULL,
        manual_time TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (day, event)
      )
    `),
    env.DB.prepare(`
      CREATE TABLE IF NOT EXISTS day_pauses (
        day TEXT PRIMARY KEY,
        paused_from_order INTEGER NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `),
    env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_plan_day ON test_plan(day)`),
    env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_manual_day ON manual_events(day)`),
    env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_logs_day ON punch_log(day)`),
  ]);

  // Existing installations keep their eight-hour schedule and saved data.
  await ensureColumn(env, "config", "daily_hours", "INTEGER NOT NULL DEFAULT 8 CHECK (daily_hours IN (6, 8))");
  await ensureColumn(env, "config", "office", "TEXT CHECK (office IN ('barcelona', 'madrid', 'sevilla'))");
  await ensureColumn(env, "test_week_meta", "calendar_key", "TEXT NOT NULL DEFAULT ''");
}

async function ensureColumn(env, table, name, definition) {
  const columns = await env.DB.prepare(`PRAGMA table_info(${table})`).all();
  if (!columns.results.some((column) => column.name === name)) {
    try {
      await env.DB.prepare(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`).run();
    } catch (error) {
      // Another Worker may have applied the same migration concurrently.
      const currentColumns = await env.DB.prepare(`PRAGMA table_info(${table})`).all();
      if (!currentColumns.results.some((column) => column.name === name)) {
        throw error;
      }
    }
  }
}

async function getConfig(env) {
  return env.DB.prepare(`
    SELECT active, daily_hours, office, entry_am, lunch_out, lunch_in, exit_pm, updated_at
    FROM config
    WHERE id = 1
  `).first();
}

// ==================================================
// API
// ==================================================

async function bootstrapResponse(request, env) {
  const url = new URL(request.url);
  const now = new Date();
  const today = getMadridParts(now).date;
  const currentWeekStart = getWeekStart(today);
  const requestedManualDay = url.searchParams.get("manual_day");
  const manualDay = isDateString(requestedManualDay) ? requestedManualDay : today;
  const manualWeekStart = getWeekStart(manualDay);

  const config = await getConfig(env);
  if (!config) throw new HttpError(500, "No se ha encontrado la configuración.");

  await Promise.all([
    ensureWeekPlan(env, currentWeekStart, config),
    manualWeekStart === currentWeekStart
      ? Promise.resolve()
      : ensureWeekPlan(env, manualWeekStart, config),
  ]);

  const weekEnd = addDays(currentWeekStart, 4);

  const [
    meta,
    summaries,
    plans,
    weekVacations,
    weekManual,
    weekPauses,
    allVacations,
    logs,
    manualPlans,
    manualOverrides,
    manualPause,
  ] = await Promise.all([
    env.DB.prepare(`
      SELECT workdays, target_seconds, generated_at
      FROM test_week_meta
      WHERE week_start = ?1
    `).bind(currentWeekStart).first(),
    env.DB.prepare(`
      SELECT day, worked_seconds, deviation_seconds
      FROM test_day_summary
      WHERE week_start = ?1
      ORDER BY day
    `).bind(currentWeekStart).all(),
    env.DB.prepare(`
      SELECT day, event, planned_time, offset_seconds
      FROM test_plan
      WHERE week_start = ?1
      ORDER BY day,
        CASE event
          WHEN 'ENTRY_AM' THEN 1
          WHEN 'LUNCH_OUT' THEN 2
          WHEN 'LUNCH_IN' THEN 3
          WHEN 'EXIT_PM' THEN 4
          ELSE 9
        END
    `).bind(currentWeekStart).all(),
    env.DB.prepare(`
      SELECT date FROM vacations
      WHERE date >= ?1 AND date <= ?2
    `).bind(currentWeekStart, weekEnd).all(),
    env.DB.prepare(`
      SELECT day, event, manual_time
      FROM manual_events
      WHERE day >= ?1 AND day <= ?2
    `).bind(currentWeekStart, weekEnd).all(),
    env.DB.prepare(`
      SELECT day, paused_from_order
      FROM day_pauses
      WHERE day >= ?1 AND day <= ?2
    `).bind(currentWeekStart, weekEnd).all(),
    env.DB.prepare(`SELECT date FROM vacations ORDER BY date`).all(),
    env.DB.prepare(`
      SELECT day, event, scheduled_time, status, executed_at, error
      FROM punch_log
      ORDER BY day DESC, executed_at DESC
      LIMIT 20
    `).all(),
    env.DB.prepare(`
      SELECT event, planned_time
      FROM test_plan
      WHERE week_start = ?1 AND day = ?2
    `).bind(manualWeekStart, manualDay).all(),
    env.DB.prepare(`
      SELECT event, manual_time
      FROM manual_events
      WHERE day = ?1
    `).bind(manualDay).all(),
    env.DB.prepare(`
      SELECT paused_from_order
      FROM day_pauses
      WHERE day = ?1
    `).bind(manualDay).first(),
  ]);

  const week = buildWeekState({
    config,
    weekStart: currentWeekStart,
    meta,
    summaries: summaries.results || [],
    plans: plans.results || [],
    vacations: weekVacations.results || [],
    manualRows: weekManual.results || [],
    pauses: weekPauses.results || [],
  });

  const manualState = buildManualDayState({
    config,
    day: manualDay,
    planRows: manualPlans.results || [],
    manualRows: manualOverrides.results || [],
    pause: manualPause,
    vacationDates: new Set((allVacations.results || []).map((row) => row.date)),
  });

  return jsonResponse({
    ok: true,
    version: APP_VERSION,
    mode: String(env.MODE || "TEST").toUpperCase(),
    generatedAt: now.toISOString(),
    today,
    offices: OFFICES,
    holidayCalendar: getOfficeCalendar(config.office),
    automation: { ready: !calendarSetupMessage(config, today), reason: calendarSetupMessage(config, today) },
    config: {
      active: Boolean(config.active),
      daily_hours: getDailyHours(config),
      office: config.office || null,
      entry_am: config.entry_am,
      lunch_out: config.lunch_out,
      lunch_in: config.lunch_in,
      exit_pm: config.exit_pm,
    },
    vacations: (allVacations.results || []).map((row) => row.date),
    week,
    manualDay: manualState,
    logs: (logs.results || []).map((row) => ({
      day: row.day,
      event: row.event,
      label: eventLabel(row.event),
      scheduledTime: row.scheduled_time,
      status: row.status,
      executedAt: row.executed_at,
      error: row.error,
    })),
  });
}

async function updateActive(request, env) {
  const body = await readJson(request);
  if (typeof body.active !== "boolean") throw new HttpError(400, "El estado debe ser verdadero o falso.");
  const active = body.active;
  if (active) {
    const reason = calendarSetupMessage(await getConfig(env), getMadridParts(new Date()).date);
    if (reason) throw new HttpError(409, reason);
  }

  await env.DB.prepare(`
    UPDATE config
    SET active = ?1, updated_at = CURRENT_TIMESTAMP
    WHERE id = 1
  `).bind(active ? 1 : 0).run();

  return jsonResponse({ ok: true, active });
}

async function updateConfig(request, env) {
  const body = await readJson(request);
  const current = await getConfig(env);
  const dailyHours = getDailyHours({ daily_hours: body.daily_hours ?? current.daily_hours });
  const config = {
    daily_hours: dailyHours,
    entry_am: normalizeTime(body.entry_am),
    lunch_out: normalizeTime(body.lunch_out),
    lunch_in: normalizeTime(body.lunch_in),
    exit_pm: normalizeTime(body.exit_pm),
  };

  if (Object.values(config).some((value) => !value)) {
    throw new HttpError(400, "Formato horario incorrecto.");
  }

  validateBaseSchedule(config);

  await env.DB.batch([
    env.DB.prepare(`
      UPDATE config
      SET entry_am = ?1,
          lunch_out = ?2,
          lunch_in = ?3,
          exit_pm = ?4,
          daily_hours = ?5,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = 1
    `).bind(config.entry_am, config.lunch_out, config.lunch_in, config.exit_pm, config.daily_hours),
    env.DB.prepare(`DELETE FROM test_plan`),
    env.DB.prepare(`DELETE FROM test_day_summary`),
    env.DB.prepare(`DELETE FROM test_week_meta`),
  ]);

  return jsonResponse({ ok: true });
}

async function updateOffice(request, env) {
  const { office } = await readJson(request);
  if (!isOffice(office)) throw new HttpError(400, "Selecciona Barcelona, Madrid o Sevilla.");
  const current = await getConfig(env);
  if (current.office !== office) {
    await env.DB.batch([
      env.DB.prepare(`UPDATE config SET office = ?1, updated_at = CURRENT_TIMESTAMP WHERE id = 1`).bind(office),
      env.DB.prepare(`DELETE FROM test_plan`),
      env.DB.prepare(`DELETE FROM test_day_summary`),
      env.DB.prepare(`DELETE FROM test_week_meta`),
    ]);
  }
  return jsonResponse({ ok: true, office });
}

async function updateVacations(request, env) {
  const body = await readJson(request);
  if (!Array.isArray(body.dates) || body.dates.some((date) => !isDateString(date) || !isWeekdayDate(date))) {
    throw new HttpError(400, "Las vacaciones deben contener fechas laborables válidas.");
  }
  const selectedDates = Array.from(new Set(body.dates)).sort();

  const existingRows = await env.DB.prepare(`SELECT date FROM vacations`).all();
  const existingDates = (existingRows.results || []).map((row) => row.date);
  const affectedWeeks = new Set(
    [...existingDates, ...selectedDates].map((date) => getWeekStart(date))
  );

  const statements = [env.DB.prepare(`DELETE FROM vacations`)];

  for (const date of selectedDates) {
    statements.push(
      env.DB.prepare(`INSERT INTO vacations (date) VALUES (?1)`).bind(date)
    );
  }

  for (const weekStart of affectedWeeks) {
    statements.push(
      env.DB.prepare(`DELETE FROM test_plan WHERE week_start = ?1`).bind(weekStart),
      env.DB.prepare(`DELETE FROM test_day_summary WHERE week_start = ?1`).bind(weekStart),
      env.DB.prepare(`DELETE FROM test_week_meta WHERE week_start = ?1`).bind(weekStart)
    );
  }

  await env.DB.batch(statements);
  return jsonResponse({ ok: true, dates: selectedDates });
}

async function upsertManualEvent(request, env) {
  const body = await readJson(request);
  const day = String(body.day || "");
  const event = String(body.event || "");
  const manualTime = normalizeTimeWithSeconds(body.manual_time);
  const config = await getConfig(env);
  const definition = EVENTS.find((item) => item.event === event);

  if (!isDateString(day)) throw new HttpError(400, "Fecha inválida.");
  if (!isWeekdayDate(day)) throw new HttpError(400, "Solo se admiten días laborables.");
  if (!definition) throw new HttpError(400, "Evento inválido.");
  if (!manualTime) throw new HttpError(400, "Hora manual inválida.");
  const calendarReason = configuredDayBlockReason(config, day);
  if (calendarReason) throw new HttpError(400, calendarReason);
  if (await isVacation(env, day)) {
    throw new HttpError(400, "El día está marcado como vacaciones.");
  }

  const weekStart = getWeekStart(day);
  await ensureWeekPlan(env, weekStart, config);

  const effective = await getEffectiveDayTimes(env, weekStart, day, {
    [event]: manualTime,
  });
  const validationError = validateEffectiveTimes(effective);
  if (validationError) throw new HttpError(400, validationError);

  await env.DB.prepare(`
    INSERT INTO manual_events (day, event, manual_time)
    VALUES (?1, ?2, ?3)
    ON CONFLICT(day, event) DO UPDATE SET
      manual_time = excluded.manual_time,
      updated_at = CURRENT_TIMESTAMP
  `).bind(day, event, manualTime).run();

  return jsonResponse({ ok: true });
}

async function removeManualEvent(request, env) {
  const body = await readJson(request);
  const day = String(body.day || "");
  const event = String(body.event || "");
  if (!isDateString(day) || !EVENTS.some((item) => item.event === event)) {
    throw new HttpError(400, "Datos manuales inválidos.");
  }

  await env.DB.prepare(`
    DELETE FROM manual_events
    WHERE day = ?1 AND event = ?2
  `).bind(day, event).run();

  return jsonResponse({ ok: true });
}

async function upsertDayPause(request, env) {
  const body = await readJson(request);
  const day = String(body.day || "");
  const fromEvent = String(body.from_event || "");
  const definition = EVENTS.find((item) => item.event === fromEvent);

  if (!isDateString(day) || !definition) {
    throw new HttpError(400, "Datos de pausa inválidos.");
  }
  if (!isWeekdayDate(day)) throw new HttpError(400, "Solo se admiten días laborables.");
  const calendarReason = configuredDayBlockReason(await getConfig(env), day);
  if (calendarReason) throw new HttpError(400, calendarReason);
  if (await isVacation(env, day)) {
    throw new HttpError(400, "El día está marcado como vacaciones.");
  }

  await env.DB.prepare(`
    INSERT INTO day_pauses (day, paused_from_order)
    VALUES (?1, ?2)
    ON CONFLICT(day) DO UPDATE SET
      paused_from_order = excluded.paused_from_order,
      updated_at = CURRENT_TIMESTAMP
  `).bind(day, definition.order).run();

  return jsonResponse({ ok: true });
}

async function clearDayPause(request, env) {
  const body = await readJson(request);
  const day = String(body.day || "");
  if (!isDateString(day)) throw new HttpError(400, "Fecha inválida.");

  await env.DB.prepare(`DELETE FROM day_pauses WHERE day = ?1`).bind(day).run();
  return jsonResponse({ ok: true });
}

async function regenerateWeek(request, env) {
  const body = await readJson(request);
  const day = isDateString(body.day) ? body.day : getMadridParts(new Date()).date;
  const weekStart = getWeekStart(day);
  const config = await getConfig(env);
  await generateWeekPlan(env, weekStart, config);
  return jsonResponse({ ok: true, weekStart });
}

// ==================================================
// WEEK PLAN
// ==================================================

async function ensureWeekPlan(env, weekStart, config = null) {
  config ||= await getConfig(env);
  const existing = await env.DB.prepare(`
    SELECT calendar_key, workdays FROM test_week_meta WHERE week_start = ?1
  `).bind(weekStart).first();

  if (existing && !existing.calendar_key && !config.office) {
    const count = await env.DB.prepare("SELECT COUNT(*) AS total FROM test_plan WHERE week_start = ?1")
      .bind(weekStart).first();
    if (Number(count.total) === Number(existing.workdays) * EVENTS.length) {
      // Adopt an intact legacy plan without randomizing recorded production days.
      await env.DB.prepare("UPDATE test_week_meta SET calendar_key = ?2 WHERE week_start = ?1 AND calendar_key = ''")
        .bind(weekStart, calendarKey(config)).run();
      return;
    }
  }

  if (!existing || existing.calendar_key !== calendarKey(config)) {
    await generateWeekPlan(env, weekStart, config);
  }
}

function calendarKey(config) {
  return JSON.stringify([HOLIDAY_CALENDAR_VERSION, config.office || null, getDailyHours(config),
    ...EVENTS.map(({ field }) => config[field])]);
}

async function generateWeekPlan(env, weekStart, config) {
  if (!config) throw new HttpError(500, "No se ha encontrado la configuración.");
  validateBaseSchedule(config);
  const dailyTargetSeconds = getDailyHours(config) * 3600;

  const weekdays = Array.from({ length: 5 }, (_, index) =>
    addDays(weekStart, index)
  );

  const vacationRows = await env.DB.prepare(`
    SELECT date FROM vacations
    WHERE date >= ?1 AND date <= ?2
  `).bind(weekdays[0], weekdays[4]).all();

  const vacationSet = new Set(
    (vacationRows.results || []).map((row) => row.date)
  );
  const workDates = weekdays.filter((date) => !vacationSet.has(date) && !configuredDayBlockReason(config, date));
  const deviations = generateDailyDeviations(workDates.length);

  const base = {
    ENTRY_AM: config.entry_am,
    LUNCH_OUT: config.lunch_out,
    LUNCH_IN: config.lunch_in,
    EXIT_PM: config.exit_pm,
  };

  const statements = [
    env.DB.prepare(`DELETE FROM test_plan WHERE week_start = ?1`).bind(weekStart),
    env.DB.prepare(`DELETE FROM test_day_summary WHERE week_start = ?1`).bind(weekStart),
    env.DB.prepare(`DELETE FROM test_week_meta WHERE week_start = ?1`).bind(weekStart),
  ];

  let weeklySeconds = 0;

  for (let index = 0; index < workDates.length; index++) {
    const day = workDates[index];
    const deviation = deviations[index];
    const offsets = generateOffsetsForDeviation(base, deviation);
    const planned = Object.fromEntries(EVENTS.map(({ event }) => [
      event, addSecondsToTime(base[event], offsets[event]),
    ]));

    const validationError = validateEffectiveTimes(planned);
    if (validationError) throw new Error(validationError);
    const workedSeconds = calculateWorkedSeconds(planned);

    if (workedSeconds !== dailyTargetSeconds + deviation) {
      throw new Error("El total diario generado no coincide con su desviación.");
    }

    weeklySeconds += workedSeconds;

    for (const definition of EVENTS) {
      statements.push(
        env.DB.prepare(`
          INSERT INTO test_plan (
            week_start, day, event, base_time, planned_time, offset_seconds
          ) VALUES (?1, ?2, ?3, ?4, ?5, ?6)
        `).bind(
          weekStart,
          day,
          definition.event,
          base[definition.event],
          planned[definition.event],
          offsets[definition.event]
        )
      );
    }

    statements.push(
      env.DB.prepare(`
        INSERT INTO test_day_summary (
          week_start, day, worked_seconds, deviation_seconds
        ) VALUES (?1, ?2, ?3, ?4)
      `).bind(weekStart, day, workedSeconds, deviation)
    );
  }

  const targetSeconds = workDates.length * dailyTargetSeconds;
  if (weeklySeconds !== targetSeconds) {
    throw new Error(
      `El total semanal generado (${weeklySeconds}) no coincide con el objetivo (${targetSeconds}).`
    );
  }

  statements.push(
    env.DB.prepare(`
      INSERT INTO test_week_meta (
        week_start, workdays, target_seconds, calendar_key
      ) VALUES (?1, ?2, ?3, ?4)
    `).bind(weekStart, workDates.length, targetSeconds, calendarKey(config))
  );

  await env.DB.batch(statements);
}

function generateDailyDeviations(workdays) {
  if (workdays === 0) return [];
  if (workdays === 1) return [0];

  for (let attempt = 0; attempt < 10000; attempt++) {
    const deviations = [];

    for (let index = 0; index < workdays - 1; index++) {
      deviations.push(
        randomInt(
          -MAX_DAILY_DEVIATION_SECONDS,
          MAX_DAILY_DEVIATION_SECONDS
        )
      );
    }

    const finalDeviation = -deviations.reduce(
      (sum, value) => sum + value,
      0
    );

    if (
      finalDeviation >= -MAX_DAILY_DEVIATION_SECONDS &&
      finalDeviation <= MAX_DAILY_DEVIATION_SECONDS
    ) {
      deviations.push(finalDeviation);
      shuffle(deviations);
      return deviations;
    }
  }

  throw new Error("No se ha podido generar una semana equilibrada.");
}

function generateOffsetsForDeviation(base, targetDeviation) {
  const baseEntry = timeToSeconds(base.ENTRY_AM);
  const baseExit = timeToSeconds(base.EXIT_PM);
  const baseLunchOut = timeToSeconds(base.LUNCH_OUT);
  const baseLunchIn = timeToSeconds(base.LUNCH_IN);

  for (let attempt = 0; attempt < 20000; attempt++) {
    const entryAM = randomInt(0, MAX_OFFSET_SECONDS);
    const lunchIn = randomInt(0, MAX_OFFSET_SECONDS);
    const exitPM = randomInt(0, MAX_OFFSET_SECONDS);
    const lunchOut = targetDeviation - exitPM + lunchIn + entryAM;

    if (lunchOut < 0 || lunchOut > MAX_OFFSET_SECONDS) continue;

    const actualBreak =
      baseLunchIn + lunchIn - (baseLunchOut + lunchOut);
    if (actualBreak < MIN_BREAK_SECONDS) continue;
    if (baseEntry + entryAM >= baseLunchOut + lunchOut) continue;
    if (baseLunchIn + lunchIn >= baseExit + exitPM) continue;

    return {
      ENTRY_AM: entryAM,
      LUNCH_OUT: lunchOut,
      LUNCH_IN: lunchIn,
      EXIT_PM: exitPM,
    };
  }

  throw new Error(
    `No se han podido generar offsets válidos para ${targetDeviation} segundos.`
  );
}

// ==================================================
// STATE BUILDERS
// ==================================================

function buildWeekState({
  config,
  weekStart,
  meta,
  summaries,
  plans,
  vacations,
  manualRows,
  pauses,
}) {
  const vacationSet = new Set(vacations.map((row) => row.date));
  const summaryMap = new Map(summaries.map((row) => [row.day, row]));
  const pauseMap = new Map(
    pauses.map((row) => [row.day, Number(row.paused_from_order)])
  );

  const planMap = new Map();
  for (const row of plans) {
    if (!planMap.has(row.day)) planMap.set(row.day, {});
    planMap.get(row.day)[row.event] = row.planned_time;
  }

  const manualMap = new Map();
  for (const row of manualRows) {
    if (!manualMap.has(row.day)) manualMap.set(row.day, {});
    manualMap.get(row.day)[row.event] = row.manual_time;
  }

  let effectiveTotal = 0;
  let complete = true;

  const days = Array.from({ length: 5 }, (_, index) => {
    const date = addDays(weekStart, index);
    const vacation = vacationSet.has(date);
    const holiday = getHoliday(config.office, date);
    const calendarMissing = Boolean(config.office) && !hasHolidayCalendar(config.office, date.slice(0, 4));

    if (vacation || holiday || calendarMissing) {
      if (calendarMissing) complete = false;
      return {
        date,
        label: weekdayName(date),
        vacation: vacation && !holiday,
        holiday,
        calendarMissing,
        plan: {},
        manual: {},
        pauseFromOrder: null,
        baseSeconds: 0,
        deviationSeconds: 0,
        effectiveSeconds: 0,
        effectiveComplete: !calendarMissing,
      };
    }

    const plan = planMap.get(date) || {};
    const manual = manualMap.get(date) || {};
    const pauseFromOrder = pauseMap.get(date) || null;
    const summary = summaryMap.get(date);
    const effectiveTimes = { ...plan, ...manual };
    let effectiveComplete = true;

    if (pauseFromOrder) {
      for (const definition of EVENTS) {
        if (
          definition.order >= pauseFromOrder &&
          !Object.prototype.hasOwnProperty.call(manual, definition.event)
        ) {
          effectiveComplete = false;
        }
      }
    }

    const validationError = validateEffectiveTimes(effectiveTimes);
    if (validationError || !hasAllEvents(effectiveTimes)) {
      effectiveComplete = false;
    }

    let effectiveSeconds = null;
    if (effectiveComplete) {
      effectiveSeconds = calculateWorkedSeconds(effectiveTimes);
      effectiveTotal += effectiveSeconds;
    } else {
      complete = false;
    }

    return {
      date,
      label: weekdayName(date),
      vacation: false,
      holiday: null,
      calendarMissing: false,
      plan,
      manual,
      pauseFromOrder,
      baseSeconds: Number(summary?.worked_seconds || 0),
      deviationSeconds: Number(summary?.deviation_seconds || 0),
      effectiveSeconds,
      effectiveComplete,
    };
  });

  const targetSeconds = days.some((day) => day.calendarMissing) ? null : Number(meta?.target_seconds || 0);

  return {
    start: weekStart,
    end: addDays(weekStart, 4),
    workdays: Number(meta?.workdays || 0),
    targetSeconds,
    effectiveTotal: complete ? effectiveTotal : null,
    adjustmentSeconds: complete ? effectiveTotal - targetSeconds : null,
    complete,
    days,
  };
}

function buildManualDayState({
  config,
  day,
  planRows,
  manualRows,
  pause,
  vacationDates,
}) {
  const plan = Object.fromEntries(
    planRows.map((row) => [row.event, row.planned_time])
  );
  const manual = Object.fromEntries(
    manualRows.map((row) => [row.event, row.manual_time])
  );
  const effective = { ...plan, ...manual };
  const validationError = validateEffectiveTimes(effective);
  const vacation = vacationDates.has(day);
  const holiday = getHoliday(config.office, day);
  const calendarMissing = Boolean(config.office) && !hasHolidayCalendar(config.office, day.slice(0, 4));
  const workday = isWeekdayDate(day);
  const pauseFromOrder = pause ? Number(pause.paused_from_order) : null;
  const missingManual = EVENTS.some(({ event, order }) =>
    pauseFromOrder && order >= pauseFromOrder && !manual[event]
  );
  const complete = workday && !vacation && !holiday && !calendarMissing && !missingManual && !validationError && hasAllEvents(effective);

  return {
    date: day,
    vacation,
    holiday,
    calendarMissing,
    workday,
    plan,
    manual,
    effective,
    pauseFromOrder,
    complete,
    error: validationError,
    workedSeconds: complete ? calculateWorkedSeconds(effective) : null,
    adjustmentSeconds: complete
      ? calculateWorkedSeconds(effective) - getDailyHours(config) * 3600
      : null,
  };
}

async function getEffectiveDayTimes(env, weekStart, day, overrides = {}) {
  const [planRows, manualRows] = await Promise.all([
    env.DB.prepare(`
      SELECT event, planned_time FROM test_plan
      WHERE week_start = ?1 AND day = ?2
    `).bind(weekStart, day).all(),
    env.DB.prepare(`
      SELECT event, manual_time FROM manual_events
      WHERE day = ?1
    `).bind(day).all(),
  ]);

  const result = {};
  for (const row of planRows.results || []) result[row.event] = row.planned_time;
  for (const row of manualRows.results || []) result[row.event] = row.manual_time;
  for (const [event, time] of Object.entries(overrides)) result[event] = time;
  return result;
}

function getDailyHours(config) {
  const hours = Number(config.daily_hours ?? DEFAULT_DAILY_HOURS);
  if (hours !== 6 && hours !== 8) {
    throw new HttpError(400, "La jornada debe ser de 6 u 8 horas.");
  }
  return hours;
}

function validateBaseSchedule(config) {
  const targetSeconds = getDailyHours(config) * 3600;
  const times = Object.fromEntries(EVENTS.map(({ event, field }) => [event, config[field]]));
  const validationError = validateEffectiveTimes(times);
  if (validationError) throw new HttpError(400, validationError);

  // Leave room for every allowed random delay without crossing midnight.
  if (timeToSeconds(config.exit_pm) + MAX_OFFSET_SECONDS >= 24 * 3600) {
    throw new HttpError(400, "La salida debe ser como máximo a las 23:55 para permitir los ajustes aleatorios.");
  }

  const workedSeconds = calculateWorkedSeconds(times);
  if (workedSeconds !== targetSeconds) {
    throw new HttpError(
      400,
      `El horario base suma ${formatDuration(workedSeconds)}; debe sumar ${formatDuration(targetSeconds)}.`
    );
  }
}

function validateEffectiveTimes(times) {
  if (!hasAllEvents(times)) return null;

  const entry = timeToSeconds(times.ENTRY_AM);
  const exit = timeToSeconds(times.EXIT_PM);
  const lunchOut = timeToSeconds(times.LUNCH_OUT);
  const lunchIn = timeToSeconds(times.LUNCH_IN);

  if (!(entry < lunchOut && lunchOut < lunchIn && lunchIn < exit)) {
    return "Las marcas deben mantener el orden cronológico del día.";
  }

  if (lunchIn - lunchOut < MIN_BREAK_SECONDS) {
    return "El descanso real debe seguir siendo de al menos una hora.";
  }

  return null;
}

function calculateWorkedSeconds(times) {
  return (
    timeToSeconds(times.LUNCH_OUT) - timeToSeconds(times.ENTRY_AM) +
    timeToSeconds(times.EXIT_PM) - timeToSeconds(times.LUNCH_IN)
  );
}

function hasAllEvents(times) {
  return EVENTS.every((definition) => Boolean(times[definition.event]));
}

// ==================================================
// SCHEDULER
// ==================================================

export async function prepareScheduledDay(env, scheduledAt) {
  await ensureSchemaOnce(env);
  const config = await getConfig(env);
  if (!config || !config.active) return;

  const scheduledLocal = getMadridParts(scheduledAt);
  if (calendarSetupMessage(config, scheduledLocal.date) || getHoliday(config.office, scheduledLocal.date)) return;
  if (scheduledLocal.weekday === 0 || scheduledLocal.weekday === 6) return;
  if (await isVacation(env, scheduledLocal.date)) return;

  const weekStart = getWeekStart(scheduledLocal.date);
  await ensureWeekPlan(env, weekStart, config);
  return { scheduledLocal, weekStart };
}

async function runScheduler(env, scheduledAt, actualNow) {
  const prepared = await prepareScheduledDay(env, scheduledAt);
  if (!prepared) return;
  const { scheduledLocal, weekStart } = prepared;

  const [plan, pause, manualRows] = await Promise.all([
    env.DB.prepare(`
      SELECT event, planned_time
      FROM test_plan
      WHERE week_start = ?1 AND day = ?2
    `).bind(weekStart, scheduledLocal.date).all(),
    env.DB.prepare(`
      SELECT paused_from_order
      FROM day_pauses
      WHERE day = ?1
    `).bind(scheduledLocal.date).first(),
    env.DB.prepare(`
      SELECT event FROM manual_events WHERE day = ?1
    `).bind(scheduledLocal.date).all(),
  ]);

  const manualEvents = new Set(
    (manualRows.results || []).map((row) => row.event)
  );
  const scheduledMinute = scheduledLocal.hour * 60 + scheduledLocal.minute;
  const actualLocal = getMadridParts(actualNow);

  for (const row of plan.results || []) {
    const definition = EVENTS.find((item) => item.event === row.event);
    if (!definition) continue;
    if (pause && definition.order >= Number(pause.paused_from_order)) continue;
    if (manualEvents.has(row.event)) continue;

    const plannedSeconds = timeToSeconds(row.planned_time);
    const plannedMinute = Math.floor(plannedSeconds / 60);
    if (plannedMinute !== scheduledMinute) continue;
    if (actualLocal.date !== scheduledLocal.date) continue;

    const actualSeconds =
      actualLocal.hour * 3600 + actualLocal.minute * 60 + actualLocal.second;
    const waitSeconds = plannedSeconds - actualSeconds;
    const latenessSeconds = actualSeconds - plannedSeconds;

    if (latenessSeconds > 240) continue;
    if (waitSeconds > 0) {
      await sleep(Math.min(waitSeconds, 59) * 1000);
    }

    await processEvent(
      env,
      scheduledLocal.date,
      row.event,
      row.planned_time,
      new Date()
    );
  }
}

async function processEvent(env, day, event, scheduledTime, now) {
  const mode = String(env.MODE || "TEST").toUpperCase();
  if (!await claimScheduledEvent(env, day, event, scheduledTime, mode)) return;

  try {
    await clockWoffu(env, event, now);
    const finalStatus = mode === "LIVE" ? "SUCCESS" : "TEST";

    await env.DB.prepare(`
      UPDATE punch_log
      SET status = ?3,
          executed_at = CURRENT_TIMESTAMP,
          error = NULL
      WHERE day = ?1 AND event = ?2
    `).bind(day, event, finalStatus).run();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await env.DB.prepare(`
      UPDATE punch_log
      SET status = 'FAILED',
          executed_at = CURRENT_TIMESTAMP,
          error = ?3
      WHERE day = ?1 AND event = ?2
    `).bind(day, event, message.substring(0, 500)).run();
  }
}

export async function claimScheduledEvent(env, day, event, scheduledTime, mode) {
  const config = await getConfig(env);
  if (!config?.active || calendarSetupMessage(config, day) || getHoliday(config.office, day) || !isWeekdayDate(day)) return false;
  // Recheck after waiting. A real attempt, including an uncertain failure, must
  // not be repeated or overwritten by TEST mode after changing the schedule.
  const claim = await env.DB.prepare(`
    INSERT INTO punch_log (day, event, scheduled_time, status, attempts)
    SELECT ?1, ?2, ?3, 'PENDING', 1
    WHERE EXISTS (SELECT 1 FROM config WHERE id = 1 AND active = 1 AND office = ?6)
      AND EXISTS (SELECT 1 FROM test_plan WHERE day = ?1 AND event = ?2 AND planned_time = ?3)
      AND NOT EXISTS (SELECT 1 FROM vacations WHERE date = ?1)
      AND NOT EXISTS (SELECT 1 FROM manual_events WHERE day = ?1 AND event = ?2)
      AND NOT EXISTS (SELECT 1 FROM day_pauses WHERE day = ?1 AND paused_from_order <= ?4)
    ON CONFLICT(day, event) DO UPDATE SET
      status = 'PENDING', scheduled_time = excluded.scheduled_time,
      attempts = punch_log.attempts + 1, error = NULL
    WHERE punch_log.status = 'TEST'
      AND (?5 = 1 OR punch_log.scheduled_time != excluded.scheduled_time)
  `).bind(day, event, scheduledTime, EVENTS.find((item) => item.event === event).order, mode === "LIVE" ? 1 : 0, config.office).run();
  return Number(claim.meta?.changes) > 0;
}

async function clockWoffu(env, event, now) {
  const mode = String(env.MODE || "TEST").toUpperCase();

  if (mode !== "LIVE") {
    console.log(`[TEST] ${event} - ${now.toISOString()}`);
    return;
  }

  throw new Error("WOFFU_ADAPTER_NOT_CONFIGURED");
}

async function isVacation(env, date) {
  const row = await env.DB.prepare(`
    SELECT date FROM vacations WHERE date = ?1
  `).bind(date).first();
  return Boolean(row);
}

function calendarSetupMessage(config, day) {
  if (!isOffice(config?.office)) return "Selecciona tu oficina en Ajustes para activar los festivos y la automatización.";
  const year = day.slice(0, 4);
  if (!hasHolidayCalendar(config.office, year)) {
    return "Falta el calendario de festivos de " + year + ". Actualízalo antes de activar los fichajes.";
  }
  return null;
}

function configuredDayBlockReason(config, day) {
  // Preserve existing planning and manual records until an office is selected.
  // Automatic/real punches additionally require calendarSetupMessage() to pass.
  if (!config.office) return null;
  const missing = calendarSetupMessage(config, day);
  if (missing) return missing;
  const holiday = getHoliday(config.office, day);
  return holiday ? "Festivo: " + holiday.name + ". No se ficha este día." : null;
}

export async function getPunchBlockReason(env, day = getMadridParts(new Date()).date) {
  await ensureSchemaOnce(env);
  const config = await getConfig(env);
  const calendarReason = calendarSetupMessage(config, day) || configuredDayBlockReason(config, day);
  if (calendarReason) return calendarReason;
  if (!isWeekdayDate(day)) return "No se ficha en fin de semana.";
  if (await isVacation(env, day)) return "El día está marcado como vacaciones.";
  return null;
}

// ==================================================
// STATIC APP SHELL
// ==================================================

function appShell() {
  return `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
  <meta name="theme-color" content="#061c43">
  <meta name="apple-mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
  <meta name="apple-mobile-web-app-title" content="Woffu Clock">
  <link rel="manifest" href="/manifest.webmanifest">
  <link rel="icon" href="/icon.svg" type="image/svg+xml">
  <title>Woffu Clock</title>
  <style>${appStyles}</style>
</head>
<body class="entryPending">
<div id="entryCover" class="entryCover" role="status" aria-live="polite">
  <img src="/assets/capgemini-white.svg" alt="Capgemini" width="400" height="91">
  <p>Preparando tu espacio…</p>
  <noscript>Activa JavaScript para abrir Woffu Clock.</noscript>
</div>
<div id="brandIntro" class="brandIntro" role="dialog" aria-modal="true" aria-label="Bienvenida a Woffu Clock" hidden>
  <div class="introVisual" aria-hidden="true">
    <img class="introBackdrop" data-src="/assets/intro-glass-v1.webp" alt="" width="1600" height="900" decoding="async">
    <div class="introStage">
      <div class="introEmblemFlight">
        <div class="introEmblemRotor">
          ${Array.from({ length: 18 }, (_, index) => `<img class="introEmblemLayer" src="/assets/capgemini-emblem-blue.svg" alt="" width="204" height="192" style="--depth:${-36 + index * 2}px">`).join("")}
          <img class="introEmblemFace" src="/assets/capgemini-emblem.svg" alt="" width="204" height="192">
        </div>
      </div>
      <div class="introIdentity">
        <img class="introWordmark" src="/assets/capgemini-white.svg" alt="" width="400" height="91">
        <p class="introAppName">Woffu Clock</p>
      </div>
    </div>
  </div>
  <button type="button" id="skipBrandIntro" class="brandIntroSkip">Saltar intro <span aria-hidden="true">Esc</span></button>
</div>
<div class="app" inert>
  <header class="topbar">
    <div class="topbarInner">
      <div class="mobileBrand"><img src="/assets/capgemini-white.svg" alt="Capgemini" width="145" height="34"><span>Woffu Clock</span></div>
      <p class="viewTitle" id="viewTitle">Resumen</p>
      <div class="headerControls">
        <button type="button" class="headerControl" data-action="go-settings" data-focus="officeInput" aria-label="Cambiar oficina">${uiIcon("map-pin")}<span id="headerOffice">Oficina</span>${uiIcon("chevron-down")}</button>
        <button type="button" class="headerControl" data-action="go-settings" data-focus="dailyHoursInput" aria-label="Cambiar jornada">${uiIcon("clock")}<span id="headerHours">Jornada</span>${uiIcon("chevron-down")}</button>
        <button id="quickToggle" class="statusPill off" type="button" aria-label="Cambiar estado">
          <span class="statusDot"></span><span id="statusText">Cargando</span>
        </button>
      </div>
    </div>
  </header>

  <aside class="desktopNav" aria-label="Navegación principal">
    <div class="sidebarBrand"><img class="brandLogo" src="/assets/capgemini-white.svg" alt="Capgemini" width="285" height="65"><p>Woffu Clock</p></div>
    <div class="desktopLinks">${navButtons("desktop")}</div>
    <div class="sidebarFooter"><span class="modeLabel">${uiIcon("info")}<span id="sidebarMode">Planificación de jornada</span></span><p id="versionText"></p></div>
  </aside>

  <main class="layout">
    <div id="feedback" class="notice pending feedback" role="alert" hidden><div id="feedbackText"></div><button id="retryLoad" type="button" class="button secondary">Actualizar datos</button></div>
    <section id="view-home" class="view active">
      <div id="homeContent" class="loadingScreen">
        <div class="loadingBlock skeleton"></div>
        <div class="metrics"><div class="metric skeleton">.</div><div class="metric skeleton">.</div><div class="metric skeleton">.</div></div>
        <div class="loadingBlock skeleton"></div>
      </div>
    </section>

    <section id="view-calendar" class="view">
      <h1 class="sectionTitle">Calendario laboral</h1>
      <p class="sectionLead">Tus vacaciones y los festivos de tu oficina. En ambos casos, no se realizan fichajes.</p>
      <div class="card">
        <div class="calendarToolbar">
          <button id="calendarPrev" class="iconButton" type="button" aria-label="Mes anterior">${uiIcon("chevron-left")}</button>
          <div id="calendarTitle" class="calendarTitle" aria-live="polite"></div>
          <button id="calendarNext" class="iconButton" type="button" aria-label="Mes siguiente">${uiIcon("chevron-right")}</button>
        </div>
        <p id="calendarInfo" class="calendarMeta"></p>
        <div class="calendarLegend" aria-label="Leyenda del calendario"><span><i class="legendDot" aria-hidden="true"></i>Vacaciones</span><span><i class="legendDot holiday" aria-hidden="true"></i>Festivo de oficina</span></div>
        <div id="calendarGrid" class="calendarGrid"></div>
        <div class="calendarSave">
          <span id="calendarStatus">Sin cambios pendientes</span>
          <button id="saveVacations" class="button primary" type="button" disabled>Guardar</button>
        </div>
        <ul id="holidayList" class="holidayList" aria-label="Festivos de este mes"></ul>
      </div>
    </section>

    <section id="view-manual" class="view">
      <h1 class="sectionTitle">Control manual</h1>
      <p class="sectionLead">Pausa una parte del día, registra una marca manual y conserva el resto del plan.</p>
      <div id="manualContent"></div>
    </section>

    <section id="view-settings" class="view">
      <h1 class="sectionTitle">Configuración</h1>
      <p class="sectionLead">Horario base, estado global y diagnóstico de la automatización.</p>
      <div id="settingsContent"></div>
    </section>
  </main>

  <nav class="bottomNav" aria-label="Navegación principal">
    ${navButtons("mobile")}
  </nav>
</div>
<div id="toast" class="toast" role="status" aria-live="polite"></div>
<script>
${clientScript()}
</script>
</body>
</html>`;
}

function navButtons(scope) {
  return [
    ["home", "home", "Resumen"],
    ["calendar", "calendar", "Calendario"],
    ["manual", "clock", "Manual"],
    ["settings", "settings", "Ajustes"],
  ].map(([view, icon, label], index) => `
    <button type="button" class="navButton ${index === 0 ? "active" : ""}" ${index === 0 ? 'aria-current="page"' : ""} data-view="${view}" data-scope="${scope}">
      ${uiIcon(icon)}<span>${label}</span>
    </button>
  `).join("");
}

function uiIcon(name) {
  return `<img class="icon" src="/assets/icons/${name}.svg" alt="" aria-hidden="true" width="22" height="22">`;
}

function clientScript() {
  return `(${clientApp.toString()})();`;
}

function clientApp() {
  "use strict";

  const EVENTS = [
    { event: "ENTRY_AM", label: "Entrada mañana", shortLabel: "Entrada", order: 1 },
    { event: "LUNCH_OUT", label: "Salida mediodía", shortLabel: "Pausa", order: 2 },
    { event: "LUNCH_IN", label: "Entrada mediodía", shortLabel: "Vuelta", order: 3 },
    { event: "EXIT_PM", label: "Salida tarde", shortLabel: "Salida", order: 4 },
  ];

  const CACHE_KEY = "woffu-clock-dashboard-v3.5-holidays";
  const state = {
    data: null,
    currentView: "home",
    calendarMonth: null,
    vacationSelected: new Set(),
    vacationBaseline: new Set(),
    manualDay: null,
    busy: false,
    loading: false,
    fresh: false,
    authExpired: false,
    requestId: 0,
    controller: null,
    configDraft: null,
    officeDraft: null,
  };

  const els = {
    toast: document.getElementById("toast"),
    statusText: document.getElementById("statusText"),
    quickToggle: document.getElementById("quickToggle"),
    home: document.getElementById("homeContent"),
    manual: document.getElementById("manualContent"),
    settings: document.getElementById("settingsContent"),
    calendarGrid: document.getElementById("calendarGrid"),
    calendarTitle: document.getElementById("calendarTitle"),
    calendarStatus: document.getElementById("calendarStatus"),
    saveVacations: document.getElementById("saveVacations"),
  };

  const brandIntro = createBrandIntro();
  bindNavigation();
  bindGlobalActions();
  restoreCache();
  loadData({ silent: Boolean(state.data) });

  function createBrandIntro() {
    let activeDismiss = null;
    let authenticated = false;
    let pending = true;
    let opening = null;
    let generation = 0;

    function holdEntry() {
      document.getElementById("entryCover").hidden = false;
      document.body.classList.add("entryPending");
      document.querySelector(".app").inert = true;
    }
    function releaseEntry() {
      document.getElementById("entryCover").hidden = true;
      document.body.classList.remove("entryPending");
      document.querySelector(".app").inert = Boolean(activeDismiss);
    }
    function suspend() {
      generation++;
      opening = null;
      pending = true;
      activeDismiss?.(false);
      if (authenticated) holdEntry();
    }
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") suspend();
      else open();
    });
    window.addEventListener("pagehide", suspend);
    // pageshow also covers initial Safari loads that become visible late.
    window.addEventListener("pageshow", () => open());
    window.addEventListener("focus", () => open());
    return {
      ready() {
        authenticated = true;
        return open({ verified: true });
      },
      replay: () => open({ replay: true }),
      block() { authenticated = false; suspend(); releaseEntry(); },
    };

    async function open({ replay = false, verified = false } = {}) {
      const intro = document.getElementById("brandIntro");
      if (!authenticated || document.visibilityState === "hidden" ||
          (!pending && !replay) || !intro.hidden || opening) return;
      const current = generation;
      const attempt = {};
      opening = attempt;
      holdEntry();
      try {
        // Startup is verified by bootstrap; restored pages and explicit replays
        // check the session without loading data or opening a password dialog.
        if (!verified) await api("/api/session");
        if (current !== generation) return;
        const backdrop = intro.querySelector(".introBackdrop");
        backdrop.src = backdrop.dataset.src;
        let assetTimer;
        try {
          await Promise.race([
            Promise.allSettled(Array.from(intro.querySelectorAll(".introWordmark, .introEmblemFace, .introEmblemLayer:first-child, .introBackdrop"),
              (image) => image.decode?.())),
            new Promise((resolve) => { assetTimer = setTimeout(resolve, 1500); }),
          ]);
        } finally { clearTimeout(assetTimer); }
        if (current !== generation || !authenticated || document.visibilityState === "hidden") return;
        pending = false;
        show({ replay });
        // The animated overlay is already covering the app before revealing any
        // cached or freshly rendered summary underneath it.
        releaseEntry();
      } catch (error) {
        if (current === generation) {
          releaseEntry();
          toast(error.message || "No se ha podido comprobar la sesión.", true);
        }
      } finally {
        if (opening === attempt) opening = null;
      }
    }

    function show({ replay = false } = {}) {
      const intro = document.getElementById("brandIntro");
      if (document.visibilityState === "hidden" || !intro.hidden) return;
      const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
      intro.classList.toggle("introReduced", reducedMotion.matches);

      const app = document.querySelector(".app");
      const skip = document.getElementById("skipBrandIntro");
      const backdrop = intro.querySelector(".introBackdrop");
      const previousFocus = document.activeElement;
      let fallback;
      let frame;
      const dismiss = (restoreFocus = replay) => {
        if (intro.hidden) return;
        intro.hidden = true;
        intro.classList.remove("introPlaying");
        cancelAnimationFrame(frame);
        activeDismiss = null;
        app.inert = false;
        document.body.classList.remove("introActive");
        clearTimeout(fallback);
        window.removeEventListener("keydown", onKeyDown, true);
        reducedMotion.removeEventListener("change", onMotionChange);
        intro.removeEventListener("animationend", onAnimationEnd);
        skip.removeEventListener("click", onSkip);
        if (restoreFocus) {
          const target = previousFocus && previousFocus !== document.body
            ? previousFocus : app.querySelector(".desktopLinks [data-view='home'], .bottomNav [data-view='home']");
          // The first navigation can be hidden at a mobile breakpoint.
          const visibleTarget = target?.getClientRects().length ? target
            : app.querySelector(".headerControl");
          visibleTarget?.focus({ preventScroll: true });
        } else {
          skip.blur();
        }
      };
      const onSkip = () => dismiss(true);
      const onMotionChange = () => dismiss();
      const onAnimationEnd = (event) => {
        if (event.target === intro && event.animationName === "introAway") dismiss();
      };
      const onKeyDown = (event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          dismiss(true);
        } else if (event.key === "Tab") {
          event.preventDefault();
          skip.focus({ preventScroll: true });
        }
      };

      activeDismiss = dismiss;
      // Defer the backdrop until the page is visible; subsequent openings use its cache.
      backdrop.src = backdrop.dataset.src;
      app.inert = true;
      document.body.classList.add("introActive");
      // Commit the hidden state so a fast page restore restarts the CSS sequence.
      intro.classList.remove("introPlaying");
      void intro.offsetWidth;
      intro.hidden = false;
      skip.focus({ preventScroll: true });
      skip.addEventListener("click", onSkip);
      intro.addEventListener("animationend", onAnimationEnd);
      window.addEventListener("keydown", onKeyDown, true);
      reducedMotion.addEventListener("change", onMotionChange, { once: true });
      // Release the interface even if an animation event or an asset fails.
      fallback = setTimeout(() => dismiss(), 10000);
      frame = requestAnimationFrame(() => {
        frame = requestAnimationFrame(() => {
          if (intro.hidden || document.visibilityState === "hidden") return;
          intro.classList.add("introPlaying");
          clearTimeout(fallback);
          fallback = setTimeout(() => dismiss(), reducedMotion.matches ? 3000 : 7600);
        });
      });
    }
  }

  function bindNavigation() {
    document.querySelectorAll("[data-view]").forEach((button) => {
      button.addEventListener("click", () => setView(button.dataset.view));
    });

    document.getElementById("calendarPrev").addEventListener("click", () => {
      if (!state.calendarMonth) return;
      state.calendarMonth = shiftMonth(state.calendarMonth, -1);
      renderCalendar();
    });

    document.getElementById("calendarNext").addEventListener("click", () => {
      if (!state.calendarMonth) return;
      state.calendarMonth = shiftMonth(state.calendarMonth, 1);
      renderCalendar();
    });

    els.saveVacations.addEventListener("click", saveVacations);
    els.quickToggle.addEventListener("click", () => toggleActive());
    document.getElementById("retryLoad").addEventListener("click", () => {
      if (state.authExpired) location.reload();
      else loadData();
    });
  }

  function bindGlobalActions() {
    document.addEventListener("pointerdown", () => { document.documentElement.dataset.input = "pointer"; });
    document.addEventListener("keydown", () => { document.documentElement.dataset.input = "keyboard"; });
    document.addEventListener("input", (event) => {
      if (event.target.form?.id === "configForm") {
        state.configDraft = Object.fromEntries(new FormData(event.target.form).entries());
      }
      if (event.target.form?.id === "officeForm") state.officeDraft = event.target.value;
    });
    document.addEventListener("click", async (event) => {
      const button = event.target.closest("[data-action]");
      if (!button) return;

      const action = button.dataset.action;
      if (action === "replay-intro") return brandIntro.replay();
      if (action === "go-settings") {
        setView("settings");
        document.getElementById(button.dataset.focus || "officeInput")?.focus();
        return;
      }
      if (action === "go-calendar") {
        renderCalendar();
        setView("calendar");
        return;
      }
      if (action === "home-month-prev" || action === "home-month-next") {
        state.calendarMonth = shiftMonth(state.calendarMonth, action === "home-month-prev" ? -1 : 1);
        renderHome();
        renderCalendar();
        updatePendingControls();
        els.home.querySelector('[data-action="' + action + '"]')?.focus({ preventScroll: true });
        return;
      }
      if (action === "toggle-active") return toggleActive(button);
      if (action === "regenerate") return regenerateWeek(button);
      if (action === "remove-manual") return removeManual(button);
      if (action === "clear-pause") return clearPause(button);
      if (action === "go-manual") {
        state.manualDay = button.dataset.day;
        setView("manual");
        return loadData({ manualDay: state.manualDay });
      }
    });

    document.addEventListener("submit", async (event) => {
      if (event.target.id === "officeForm") {
        event.preventDefault();
        return saveOffice(event.target);
      }
      if (event.target.id === "configForm") {
        event.preventDefault();
        return saveConfig(event.target);
      }

      if (event.target.id === "manualForm") {
        event.preventDefault();
        return saveManual(event.target);
      }

      if (event.target.id === "pauseForm") {
        event.preventDefault();
        return savePause(event.target);
      }

      if (event.target.id === "manualDateForm") {
        event.preventDefault();
        const form = new FormData(event.target);
        state.manualDay = String(form.get("manual_day") || "");
        return loadData({ manualDay: state.manualDay });
      }
    });

    document.addEventListener("change", (event) => {
      if (event.target.id === "dailyHoursInput") {
        updateScheduleFields(event.target.form);
        state.configDraft = Object.fromEntries(new FormData(event.target.form).entries());
      }
      if (event.target.id === "manualDayInput") {
        state.manualDay = event.target.value;
        loadData({ manualDay: state.manualDay, silent: true });
      }
    });
  }

  function setView(view) {
    state.currentView = view;
    document.querySelectorAll(".view").forEach((section) => {
      section.classList.toggle("active", section.id === "view-" + view);
    });
    document.getElementById("viewTitle").textContent = { home: "Resumen", calendar: "Calendario", manual: "Manual", settings: "Ajustes" }[view] || "Woffu Clock";
    document.querySelectorAll("[data-view]").forEach((button) => {
      button.classList.toggle("active", button.dataset.view === view);
      if (button.dataset.view === view) button.setAttribute("aria-current", "page");
      else button.removeAttribute("aria-current");
    });
    window.scrollTo({ top: 0, behavior: "instant" });
  }

  function restoreCache() {
    try {
      const cached = JSON.parse(localStorage.getItem(CACHE_KEY) || "null");
      if (!cached || !cached.version || !cached.week) return;
      state.data = cached;
      state.manualDay = cached.manualDay?.date || cached.today;
      state.calendarMonth = String(cached.today || "").slice(0, 7);
      resetVacations(cached.vacations || []);
      renderAll(true);
    } catch {
      try { localStorage.removeItem(CACHE_KEY); } catch { /* Storage is optional. */ }
    }
  }

  async function loadData(options = {}) {
    const requestId = ++state.requestId;
    state.controller?.abort();
    state.controller = new AbortController();
    state.loading = true;
    state.fresh = false;
    updatePendingControls();
    const manualDay = options.manualDay || state.manualDay || "";
    const params = new URLSearchParams();
    if (manualDay) params.set("manual_day", manualDay);
    params.set("_", String(Date.now()));

    try {
      if (!options.silent && !state.data) showLoading();
      const data = await api("/api/bootstrap?" + params.toString(), { signal: state.controller.signal });
      if (requestId !== state.requestId) return false;
      state.data = data;
      state.fresh = true;
      state.authExpired = false;
      document.getElementById("retryLoad").textContent = "Actualizar datos";
      state.manualDay = data.manualDay?.date || data.today;
      if (!state.calendarMonth) state.calendarMonth = String(data.today).slice(0, 7);

      const vacationDirty = vacationDifferenceCount() > 0;
      if (!vacationDirty) resetVacations(data.vacations || []);

      cacheState();
      document.getElementById("feedback").hidden = true;
      renderAll(false);
      brandIntro.ready();
      return true;
    } catch (error) {
      if (requestId !== state.requestId || error.name === "AbortError") return false;
      brandIntro.block();
      if (options.throwOnError) throw error;
      toast(error.message || "No se han podido cargar los datos.", true);
      if (!state.data) showFatal(error.message);
      return false;
    } finally {
      if (requestId === state.requestId) {
        state.loading = false;
        updatePendingControls();
      }
    }
  }

  function cacheState() {
    try { localStorage.setItem(CACHE_KEY, JSON.stringify(state.data)); } catch { /* The live app works without storage. */ }
  }

  function updatePendingControls() {
    document.querySelectorAll('form button, [data-action], #quickToggle, #saveVacations').forEach((button) => {
      button.disabled = state.busy || state.loading || !state.fresh ||
        button.dataset.unavailable === "true" ||
        (button === els.saveVacations && vacationDifferenceCount() === 0);
    });
    document.querySelectorAll('form input, form select').forEach((input) => { input.disabled = state.busy; });
    els.manual.setAttribute("aria-busy", String(state.loading));
  }

  async function api(path, options = {}) {
    const init = {
      method: options.method || "GET",
      headers: { Accept: "application/json" },
      cache: "no-store",
      credentials: "same-origin",
      signal: options.signal,
    };

    if (options.body !== undefined) {
      init.headers["Content-Type"] = "application/json";
      init.body = JSON.stringify(options.body);
    }

    const response = await fetch(path, init);
    const contentType = response.headers.get("Content-Type") || "";
    const payload = contentType.includes("application/json")
      ? await response.json()
      : { error: await response.text() };

    if (response.status === 401 && payload.code === "AUTH_REQUIRED") {
      state.authExpired = true;
      state.fresh = false;
      brandIntro.block();
      document.getElementById("retryLoad").textContent = "Volver a entrar";
      updatePendingControls();
      toast(payload.error, true);
    }
    if (!response.ok || payload.ok === false) {
      throw new Error(payload.error || "La operación no ha podido completarse.");
    }

    return payload;
  }

  function renderAll(fromCache) {
    if (!state.data) return;
    renderHeader(fromCache);
    renderHome();
    renderCalendar();
    renderManual();
    renderSettings();
    updatePendingControls();
  }

  function renderHeader(fromCache) {
    const active = Boolean(state.data.config?.active);
    const ready = state.data.automation.ready;
    els.quickToggle.classList.toggle("on", active && ready);
    els.quickToggle.classList.toggle("off", !active || !ready);
    els.statusText.textContent = !ready ? (active ? "Pendiente" : "Configurar") : active ? "Activa" : "Pausada";
    els.quickToggle.title = active ? "Pausar automatización" : ready ? "Activar automatización" : "Configurar oficina y festivos";
    els.quickToggle.setAttribute("aria-label", els.quickToggle.title);
    els.quickToggle.setAttribute("aria-pressed", String(active));
    document.getElementById("versionText").textContent =
      (state.data.holidayCalendar.label || "Jornada partida") + " · " + state.data.config.daily_hours + " h" + (fromCache ? " · actualizando" : "");
    document.getElementById("headerOffice").textContent = state.data.holidayCalendar.label || "Elegir oficina";
    document.getElementById("headerHours").textContent = "Jornada " + state.data.config.daily_hours + " h";
    document.getElementById("sidebarMode").textContent = state.data.mode === "LIVE" ? "Modo LIVE" : "Modo TEST";
  }

  function icon(name) {
    return '<img class="icon" src="/assets/icons/' + name + '.svg" alt="" aria-hidden="true" width="22" height="22">';
  }

  function dateLabel(date, options) {
    return new Intl.DateTimeFormat("es-ES", Object.assign({ timeZone: "UTC" }, options))
      .format(new Date(date + "T12:00:00Z"));
  }

  function plannedEvents(day, today = false) {
    const effective = Object.assign({}, day.plan || {}, day.manual || {});
    const icons = ["log-in", "coffee", "arrow-right", "log-out"];
    return EVENTS.map((definition, index) => {
      const manual = Object.prototype.hasOwnProperty.call(day.manual || {}, definition.event);
      const paused = day.pauseFromOrder && definition.order >= day.pauseFromOrder && !manual;
      return '<div class="' + (today ? 'todayEvent' : 'eventChip') + (manual ? ' manual' : '') + '">' +
        (today ? icon('brand-' + icons[index]) : '') + '<span>' + escapeHtml(definition.shortLabel) + '</span>' +
        '<strong>' + escapeHtml(paused ? 'Pendiente' : effective[definition.event] || '—') + '</strong></div>';
    }).join("");
  }

  function dayReason(day) {
    if (!day) return "Hoy es fin de semana. No hay fichajes programados.";
    if (day.holiday) return "Festivo: " + day.holiday.name + ". No se ficha este día.";
    if (day.vacation) return "Día de vacaciones. No hay fichajes programados.";
    if (day.calendarMissing) return "Falta el calendario de festivos de este año. Revisa los ajustes.";
    return "";
  }

  function renderHome() {
    els.home.classList.remove("loadingScreen");
    const data = state.data;
    const week = data.week;
    const today = week.days.find((day) => day.date === data.today);
    const todayReason = dayReason(today);
    const todayTitle = dateLabel(data.today, { weekday: "long", day: "numeric", month: "long" });
    const total = week.complete ? formatDuration(week.effectiveTotal) : "Pendiente";
    const target = week.targetSeconds === null ? "pendiente"
      : week.targetSeconds % 3600 === 0 ? (week.targetSeconds / 3600) + " h"
      : formatDuration(week.targetSeconds);
    const weekDates = dateLabel(week.start, { day: "numeric", month: "short" }) + " – " +
      dateLabel(week.end, { day: "numeric", month: "long", year: "numeric" });
    const days = week.days.map((day) => {
      const reason = dayReason(day);
      const badge = day.holiday ? '<span class="dayBadge holiday">Festivo</span>' :
        day.vacation ? '<span class="dayBadge vacation">Vacaciones</span>' :
        day.calendarMissing ? '<span class="dayBadge">Pendiente</span>' : '';
      const shortDate = dateLabel(day.date, { weekday: "short" }).replace('.', '') + " " + Number(day.date.slice(8));
      const dayTotal = !reason ? '<span class="dayTotal">' +
        (day.effectiveComplete ? formatDuration(day.effectiveSeconds) : 'Pendiente') + '</span>' : '';
      return '<details class="weekDay dayCard' + (day.date === data.today ? ' today' : '') +
        (day.holiday ? ' holiday' : day.vacation ? ' vacation' : '') + '">' +
        '<summary aria-label="Ver detalle del ' + escapeHtml(day.label.toLowerCase()) + ' ' + formatDate(day.date) + '">' +
        '<span class="dayName">' + escapeHtml(shortDate.charAt(0).toUpperCase() + shortDate.slice(1)) + '</span>' + badge + dayTotal + icon('chevron-down') + '</summary>' +
        '<div class="dayDetail"><p>' + formatDate(day.date) + (reason ? ' · ' + escapeHtml(reason) : '') + '</p>' +
        (!reason ? '<div class="eventGrid">' + plannedEvents(day) + '</div>' +
          (day.pauseFromOrder ? '<p class="notice pending">Automatización pausada desde ' +
            escapeHtml(eventByOrder(day.pauseFromOrder)?.shortLabel || 'una marca') + '.</p>' : '') +
          '<button class="button secondary" data-action="go-manual" data-day="' + day.date + '">Gestionar este día</button>' : '') +
        '</div></details>';
    }).join("");

    els.home.innerHTML =
      '<div class="homeHeading"><h1>Tu semana, en orden.</h1><p>' + escapeHtml(weekDates) + '</p></div>' +
      (!data.automation.ready ? '<div class="notice test setupNotice">' + escapeHtml(data.automation.reason) +
        '<div><button type="button" class="button secondary" data-action="go-settings">Revisar ajustes</button></div></div>' : '') +
      '<div class="homeGrid"><div class="homeMain"><section class="hero" aria-label="Resumen semanal">' +
        '<div><div class="eyebrow">Total semanal previsto</div><div class="heroValue">' + total + '</div>' +
        '<div class="heroSub"><span>' + week.workdays + (week.workdays === 1 ? ' día laborable' : ' días laborables') +
        '</span><span>· Objetivo ' + target + '</span></div></div>' +
        '<div class="heroActions"><button class="button primary" data-action="toggle-active">' +
        (data.config.active ? 'Pausar automatización' : data.automation.ready ? 'Activar automatización' : 'Configurar oficina') + '</button>' +
        '<button class="button text" data-action="regenerate">Regenerar semana</button></div></section>' +
      '<section class="todaySection"><div class="todayHeading"><div><h2>Plan de hoy</h2><p>' +
        escapeHtml(todayTitle.charAt(0).toUpperCase() + todayTitle.slice(1)) + '</p></div>' +
        (!todayReason ? '<button class="button text" data-action="go-manual" data-day="' + data.today + '">Gestionar día</button>' : '') + '</div>' +
        (todayReason ? '<div class="notice ' + (today?.holiday ? 'holiday' : 'test') + '" style="margin-top:16px">' + escapeHtml(todayReason) + '</div>' :
          '<div class="todayEvents">' + plannedEvents(today, true) + '</div>' +
          '<p class="todayNote">Jornada partida · ' + (today.effectiveComplete ? formatDuration(today.effectiveSeconds) + ' previstas' : 'Hay marcas pendientes') + '</p>') +
      '</section><div class="weekList" aria-label="Plan de esta semana">' + days + '</div>' +
      '<div class="summaryAdjustment"><span>Las horas azules son marcas manuales.</span><span>Ajuste: ' +
        (week.complete ? formatSignedDuration(week.adjustmentSeconds) : 'pendiente') + '</span></div>' +
      (data.mode !== 'LIVE' ? '<p class="modeNotice">' + icon('info') + '<span>Modo TEST: no se envía ningún fichaje a Woffu.</span></p>' : '') +
      '</div>' + homeCalendarHtml() + '</div>';
  }

  function homeCalendarHtml() {
    const data = state.data;
    const monthValue = state.calendarMonth || data.today.slice(0, 7);
    const [year, month] = monthValue.split('-').map(Number);
    const calendar = data.holidayCalendar;
    const title = dateLabel(monthValue + '-01', { month: 'long', year: 'numeric' });
    const firstIndex = (new Date(Date.UTC(year, month - 1, 1)).getUTCDay() + 6) % 7;
    const dayCount = new Date(Date.UTC(year, month, 0)).getUTCDate();
    let grid = ['Lu', 'Ma', 'Mi', 'Ju', 'Vi', 'Sá', 'Do'].map((label) => '<span class="weekday">' + label + '</span>').join('');
    grid += '<span class="calBlank"></span>'.repeat(firstIndex);
    for (let day = 1; day <= dayCount; day++) {
      const date = monthValue + '-' + String(day).padStart(2, '0');
      const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
      const holiday = holidayFor(date);
      const vacation = !holiday && data.vacations.includes(date);
      const isToday = data.today === date;
      const label = formatDate(date) + (holiday ? ', festivo: ' + holiday.name : vacation ? ', vacaciones' : '') + (isToday ? ', hoy' : '');
      grid += '<span class="calDay' + (holiday ? ' holiday' : vacation ? ' selected' : '') +
        (weekday === 0 || weekday === 6 ? ' weekend' : '') + (isToday ? ' today' : '') +
        '" role="img" aria-label="' + escapeHtml(label) + '" title="' + escapeHtml(label) + '">' + day + '</span>';
    }
    const holidays = calendar.holidays.filter((day) => day.date.startsWith(monthValue + '-'));
    const notice = !calendar.office ? 'Elige tu oficina para cargar sus festivos.' :
      !calendar.years.includes(year) ? 'Festivos de ' + year + ' pendientes de actualizar.' : 'No se ficha en estos días.';
    return '<section class="summaryCalendar" aria-label="Calendario de la oficina"><div class="calendarToolbar">' +
      '<button class="iconButton" data-action="home-month-prev" aria-label="Mes anterior del resumen">' + icon('chevron-left') + '</button>' +
      '<div><div class="calendarTitle" aria-live="polite">' + escapeHtml(title.charAt(0).toUpperCase() + title.slice(1)) + '</div><p class="calendarOffice">' +
      escapeHtml(calendar.label || 'Oficina pendiente') + '</p></div>' +
      '<button class="iconButton" data-action="home-month-next" aria-label="Mes siguiente del resumen">' + icon('chevron-right') + '</button></div>' +
      '<div class="calendarGrid">' + grid + '</div>' +
      '<div class="calendarLegend"><span><i class="legendDot holiday" aria-hidden="true"></i>Festivo</span><span><i class="legendDot" aria-hidden="true"></i>Vacaciones</span></div>' +
      '<p class="calendarNoPunch">' + escapeHtml(notice) + '</p>' +
      (holidays.length ? '<ul class="holidayList">' + holidays.map((day) => '<li><time datetime="' + day.date + '">' +
        escapeHtml(dateLabel(day.date, { day: 'numeric', month: 'short' })) + '</time><span>' + escapeHtml(day.name) + '</span></li>').join('') + '</ul>' : '') +
      '<button class="button text calendarLink" data-action="go-calendar">Gestionar calendario ' + icon('arrow-right') + '</button></section>';
  }


  function renderCalendar(focusDate = null) {
    if (!state.data || !state.calendarMonth) return;
    const parts = state.calendarMonth.split("-").map(Number);
    const year = parts[0];
    const month = parts[1];
    const calendar = state.data.holidayCalendar;
    const available = calendar.years.includes(year);
    const calendarInfo = document.getElementById("calendarInfo");
    calendarInfo.textContent = !calendar.office
      ? "Elige tu oficina en Ajustes para cargar sus festivos y activar los fichajes."
      : !available
        ? calendar.label + ": faltan los festivos de " + year + ". No se realizarán fichajes en ese año hasta actualizar el calendario."
        : calendar.label + " · Festivos nacionales, autonómicos y locales. No consumen vacaciones.";
    calendarInfo.className = available ? "calendarMeta" : "calendarMeta notice test";
    const names = [
      "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
      "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"
    ];
    els.calendarTitle.textContent = names[month - 1] + " " + year;
    els.calendarGrid.replaceChildren();

    ["Lu", "Ma", "Mi", "Ju", "Vi", "Sá", "Do"].forEach((label) => {
      const element = document.createElement("div");
      element.className = "weekday";
      element.textContent = label;
      els.calendarGrid.appendChild(element);
    });

    const first = new Date(Date.UTC(year, month - 1, 1));
    const firstIndex = (first.getUTCDay() + 6) % 7;
    const days = new Date(Date.UTC(year, month, 0)).getUTCDate();

    for (let index = 0; index < firstIndex; index++) {
      const blank = document.createElement("div");
      blank.className = "calBlank";
      els.calendarGrid.appendChild(blank);
    }

    for (let day = 1; day <= days; day++) {
      const date = year + "-" + String(month).padStart(2, "0") + "-" + String(day).padStart(2, "0");
      const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
      const weekend = weekday === 0 || weekday === 6;
      const holiday = holidayFor(date);
      const button = document.createElement("button");
      button.type = "button";
      button.className = "calDay";
      button.textContent = String(day);
      button.disabled = weekend || Boolean(holiday);
      button.classList.toggle("weekend", weekend);
      button.classList.toggle("holiday", Boolean(holiday));
      button.classList.toggle("selected", !holiday && state.vacationSelected.has(date));
      button.classList.toggle("today", state.data.today === date);
      if (!holiday) button.setAttribute("aria-pressed", state.vacationSelected.has(date) ? "true" : "false");
      button.setAttribute("aria-label", formatDate(date) + (holiday ? ", festivo: " + holiday.name : weekend ? ", fin de semana" : ", vacaciones"));
      if (holiday) button.title = holiday.name + (holiday.local ? " · Festivo local" : " · Festivo");
      button.dataset.date = date;
      if (date === state.data.today) button.setAttribute("aria-current", "date");

      if (!weekend && !holiday) {
        button.addEventListener("click", () => {
          if (state.vacationSelected.has(date)) state.vacationSelected.delete(date);
          else state.vacationSelected.add(date);
          renderCalendar(date);
        });
      }

      els.calendarGrid.appendChild(button);
    }

    document.getElementById("holidayList").innerHTML = calendar.holidays
      .filter((holiday) => holiday.date.startsWith(state.calendarMonth + "-"))
      .map((holiday) => '<li><time datetime="' + holiday.date + '">' + formatDate(holiday.date).slice(0, 5) +
        '</time><div>' + escapeHtml(holiday.name) + (holiday.local ? '<small>Festivo local</small>' : '') + '</div></li>').join("");
    const vacationCount = [...state.vacationSelected].filter((date) => !holidayFor(date)).length;
    const changes = vacationDifferenceCount();
    els.saveVacations.disabled = changes === 0 || state.busy || state.loading || !state.fresh;
    els.calendarStatus.textContent = changes === 0
      ? vacationCount + (vacationCount === 1 ? " día de vacaciones" : " días de vacaciones")
      : changes + (changes === 1 ? " cambio pendiente" : " cambios pendientes");
    if (focusDate) els.calendarGrid.querySelector('[data-date="' + focusDate + '"]')?.focus({ preventScroll: true });
  }

  function holidayFor(date) {
    return state.data.holidayCalendar.holidays.find((holiday) => holiday.date === date) || null;
  }

  function renderManual() {
    const data = state.data;
    const manual = data.manualDay;
    if (!manual) return;
    const unavailable = Boolean(manual.vacation || manual.holiday || manual.calendarMissing || !manual.workday);

    const eventRows = EVENTS.map((definition) => {
      const manualValue = manual.manual?.[definition.event];
      const effective = manual.effective?.[definition.event] || "—";
      return '<div class="manualItem"><div class="manualMain"><strong>' +
        escapeHtml(definition.label) + '</strong><span>' +
        (manualValue ? "Manual · " : "Plan · ") + escapeHtml(effective) +
        '</span></div>' +
        (manualValue
          ? '<button type="button" class="smallButton" data-action="remove-manual" data-event="' +
            escapeHtml(definition.event) + '" aria-label="Quitar marca manual: ' + escapeHtml(definition.label) + '">Quitar</button>'
          : "") + '</div>';
    }).join("");

    const totalNotice = manual.holiday
      ? '<div class="notice holiday">Festivo: <strong>' + escapeHtml(manual.holiday.name) + '</strong>. No se ficha este día.</div>'
      : manual.calendarMissing
        ? '<div class="notice test">Falta el calendario de festivos de este año. No se realizarán fichajes hasta actualizarlo.</div>'
      : manual.vacation
      ? '<div class="notice test">Este día está marcado como vacaciones.</div>'
      : !manual.workday
        ? '<div class="notice test">Este día es fin de semana y no tiene jornada programada.</div>'
      : manual.error
        ? '<div class="notice pending">' + escapeHtml(manual.error) + '</div>'
      : manual.complete
        ? '<div class="notice ok">Total efectivo: <strong>' +
          formatDuration(manual.workedSeconds) + '</strong> · ajuste: <strong>' +
          formatSignedDuration(manual.adjustmentSeconds) + '</strong></div>'
        : '<div class="notice pending">Día pendiente: completa las marcas manuales que hayas pausado.</div>';

    const pauseInfo = manual.pauseFromOrder
      ? '<div class="notice pending" style="margin-top:10px">Pausada desde <strong>' +
        escapeHtml(eventByOrder(manual.pauseFromOrder)?.label || "una marca") +
        '</strong><button type="button" class="button secondary" style="width:100%;margin-top:9px" data-action="clear-pause">Reanudar este día</button></div>'
      : "";

    els.manual.innerHTML =
      '<section class="card"><div class="cardHeader"><div><h2 class="cardTitle">Día seleccionado</h2>' +
      '<p class="cardHint">Puedes cambiarlo sin recargar toda la app.</p></div></div>' +
      '<form id="manualDateForm"><div class="field"><label for="manualDayInput">Fecha</label>' +
      '<input id="manualDayInput" class="input" type="date" name="manual_day" value="' +
      escapeHtml(manual.date) + '"></div></form></section>' +

      '<section class="card"><h2 class="cardTitle">Pausar parcialmente</h2>' +
      '<p class="cardHint">Elige la primera marca que harás manualmente. Las anteriores continúan automáticas.</p>' +
      '<form id="pauseForm"><div class="field"><label for="pauseEvent">Desde</label><select id="pauseEvent" class="input" name="from_event">' +
      EVENTS.map((definition) => '<option value="' + definition.event + '">' + escapeHtml(definition.label) + '</option>').join("") +
      '</select></div><button class="button danger" data-unavailable="' + unavailable + '" style="width:100%;margin-top:12px">Pausar resto del día</button></form>' + pauseInfo + '</section>' +

      '<section class="card"><h2 class="cardTitle">Registrar marca manual</h2>' +
      '<p class="cardHint">Anota una marca que ya has realizado. Este registro no envía un fichaje a Woffu.</p>' +
      '<form id="manualForm" class="formGrid two"><div class="field"><label for="manualEvent">Evento</label><select id="manualEvent" class="input" name="event">' +
      EVENTS.map((definition) => '<option value="' + definition.event + '">' + escapeHtml(definition.label) + '</option>').join("") +
      '</select></div><div class="field"><label for="manualTime">Hora real</label><input id="manualTime" class="input" type="time" step="1" name="manual_time" required></div>' +
      '<button class="button primary" data-unavailable="' + unavailable + '" style="width:100%;grid-column:1/-1">Guardar marca manual</button></form>' +
      '<div class="manualList">' + eventRows + '</div><div style="margin-top:12px">' + totalNotice + '</div></section>';
  }

  function renderSettings() {
    const data = state.data;
    const config = Object.assign({}, data.config, state.configDraft || {});
    const dailyHours = Number(config.daily_hours || 8);
    const logs = data.logs || [];
    const office = state.officeDraft ?? data.config.office ?? "";
    const calendar = data.holidayCalendar;
    const sourceLinks = calendar.sources.flatMap((source) => source.urls.map((url, index) =>
      '<a href="' + escapeHtml(url) + '" target="_blank" rel="noreferrer">' + source.year + ' · Fuente oficial' +
      (source.urls.length > 1 ? ' ' + (index + 1) : '') + '</a>'
    )).join("");

    const logHtml = logs.length
      ? logs.map((log) => '<div class="log"><div><strong>' + escapeHtml(log.label) +
        ' · ' + escapeHtml(log.scheduledTime || "") + '</strong><span>' +
        formatDate(log.day) + (log.error ? " · " + escapeHtml(log.error) : "") +
        '</span></div><div class="logStatus">' + escapeHtml(log.status) + '</div></div>').join("")
      : '<div class="muted">Todavía no hay ejecuciones.</div>';

    els.settings.innerHTML =
      '<section class="card"><h2 class="cardTitle">Oficina y festivos</h2>' +
      '<p class="cardHint" id="officeHint">Elige la ciudad donde trabajas. Sus festivos se añaden al calendario y se excluyen de los fichajes y del objetivo semanal.</p>' +
      '<form id="officeForm" class="formGrid"><div class="field"><label for="officeInput">Oficina</label>' +
      '<select id="officeInput" class="input" name="office" required aria-describedby="officeHint">' +
      '<option value="" disabled' + (!office ? ' selected' : '') + '>Selecciona tu oficina</option>' +
      data.offices.map((item) => '<option value="' + item.id + '"' + (office === item.id ? ' selected' : '') + '>' + escapeHtml(item.label) + '</option>').join("") +
      '</select></div><button class="button primary">Guardar oficina</button></form>' +
      (calendar.office ? '<details class="calendarSources"><summary>Festivos verificados: ' + calendar.years.join(', ') + '</summary>' + sourceLinks + '</details>' : '') + '</section>' +
      '<section class="card"><h2 class="cardTitle">Horario base</h2><p class="cardHint" id="scheduleHint">' + scheduleHint(dailyHours) + '</p>' +
      '<form id="configForm" class="formGrid two">' +
      '<div class="field" style="grid-column:1/-1"><label for="dailyHoursInput">Jornada diaria</label>' +
      '<select id="dailyHoursInput" class="input" name="daily_hours" aria-describedby="scheduleHint">' +
      '<option value="8"' + (dailyHours === 8 ? ' selected' : '') + '>8 horas · con descanso</option>' +
      '<option value="6"' + (dailyHours === 6 ? ' selected' : '') + '>6 horas · con descanso</option></select></div>' +
      timeField("Entrada mañana", "entry_am", config.entry_am) +
      timeField("Salida mediodía", "lunch_out", config.lunch_out) +
      timeField("Entrada mediodía", "lunch_in", config.lunch_in) +
      timeField("Salida tarde", "exit_pm", config.exit_pm) +
      '<p class="cardHint" style="grid-column:1/-1;margin:0">Los minutos y segundos aleatorios se compensan durante la semana. Las vacaciones y los festivos se excluyen del objetivo. Al guardar se recalcula el plan con la jornada elegida.</p>' +
      '<button class="button primary" style="width:100%;grid-column:1/-1">Guardar horario</button></form></section>' +
      '<section class="card"><h2 class="cardTitle">Automatización</h2><p class="cardHint">Activa o pausa los fichajes programados.</p>' +
      '<button class="button ' + (config.active ? "danger" : "primary") + '" style="width:100%" data-action="toggle-active">' +
      (config.active ? "Pausar automatización" : data.automation.ready ? "Activar automatización" : "Configurar oficina") + '</button></section>' +
      '<section class="card"><h2 class="cardTitle">Bienvenida</h2><p class="cardHint">Tras iniciar sesión, verás primero la bienvenida y después el resumen. La animación dura unos 7 segundos y se repite al volver a la web, también en móvil. Con movimiento reducido se muestra una bienvenida de 3 segundos sin giros. Puedes saltarla o repetirla aquí.</p>' +
      '<button class="button secondary" type="button" data-action="replay-intro">Repetir animación</button></section>' +
      '<section class="card"><h2 class="cardTitle">Diagnóstico</h2>' +
      '<div class="manualList"><div class="manualItem"><div class="manualMain"><strong>Versión</strong><span>' +
      escapeHtml(data.version) + '</span></div></div><div class="manualItem"><div class="manualMain"><strong>Modo</strong><span>' +
      escapeHtml(data.mode) + '</span></div></div><div class="manualItem"><div class="manualMain"><strong>Actualizado</strong><span>' +
      escapeHtml(new Date(data.generatedAt).toLocaleString("es-ES")) + '</span></div></div></div></section>' +
      '<section class="card"><h2 class="cardTitle">Últimas ejecuciones</h2><div class="logs">' + logHtml + '</div></section>';
  }

  async function toggleActive(button = els.quickToggle) {
    if (!state.data || state.busy) return;
    const next = !state.data.config.active;
    if (next && !state.data.automation.ready) {
      setView("settings");
      document.getElementById("officeInput")?.focus();
      toast(state.data.automation.reason, true);
      return;
    }
    await runMutation(button, async () => {
      await api("/api/active", { method: "POST", body: { active: next } });
      state.data.config.active = next;
      cacheState();
      renderAll(false);
      toast(next ? "Automatización activada" : "Automatización pausada");
    });
  }

  async function regenerateWeek(button) {
    await runMutation(button, async () => {
      await api("/api/regenerate", { method: "POST", body: { day: state.data.today } });
      await loadData({ silent: true, throwOnError: true });
      toast("Plan semanal regenerado");
    });
  }

  async function saveVacations() {
    const dates = Array.from(state.vacationSelected).sort();
    await runMutation(els.saveVacations, async () => {
      await api("/api/vacations", {
        method: "POST",
        body: { dates },
      });
      state.vacationBaseline = new Set(dates);
      await loadData({ silent: true, throwOnError: true });
      toast("Vacaciones guardadas");
    });
  }

  async function saveConfig(form) {
    const values = Object.fromEntries(new FormData(form).entries());
    await runMutation(form.querySelector("button"), async () => {
      await api("/api/config", { method: "POST", body: values });
      state.configDraft = null;
      await loadData({ silent: true, throwOnError: true });
      toast("Horario actualizado");
    });
  }

  async function saveOffice(form) {
    const values = Object.fromEntries(new FormData(form).entries());
    await runMutation(form.querySelector("button"), async () => {
      await api("/api/office", { method: "POST", body: values });
      state.officeDraft = null;
      await loadData({ silent: true, throwOnError: true });
      toast("Oficina y festivos actualizados");
    });
  }

  async function saveManual(form) {
    const values = Object.fromEntries(new FormData(form).entries());
    values.day = state.data.manualDay.date;
    await runMutation(form.querySelector("button"), async () => {
      await api("/api/manual", { method: "POST", body: values });
      await loadData({ manualDay: state.manualDay, silent: true, throwOnError: true });
      toast("Marca manual guardada");
    });
  }

  async function removeManual(button) {
    await runMutation(button, async () => {
      await api("/api/manual/delete", {
        method: "POST",
        body: { day: state.data.manualDay.date, event: button.dataset.event },
      });
      await loadData({ manualDay: state.manualDay, silent: true, throwOnError: true });
      toast("Marca manual eliminada");
    });
  }

  async function savePause(form) {
    const values = Object.fromEntries(new FormData(form).entries());
    values.day = state.data.manualDay.date;
    await runMutation(form.querySelector("button"), async () => {
      await api("/api/pause", { method: "POST", body: values });
      await loadData({ manualDay: state.manualDay, silent: true, throwOnError: true });
      toast("Automatización parcial pausada");
    });
  }

  async function clearPause(button) {
    await runMutation(button, async () => {
      await api("/api/pause/clear", {
        method: "POST",
        body: { day: state.data.manualDay.date },
      });
      await loadData({ manualDay: state.manualDay, silent: true, throwOnError: true });
      toast("Automatización del día reanudada");
    });
  }

  async function runMutation(button, task) {
    if (state.busy || state.loading || !state.fresh) return;
    state.busy = true;
    try {
      button?.classList.add("loading");
      button?.setAttribute("aria-busy", "true");
      updatePendingControls();
      document.getElementById("feedback").hidden = true;
      await task();
    } catch (error) {
      toast(error.message || "La operación ha fallado.", true);
    } finally {
      state.busy = false;
      button?.classList.remove("loading");
      button?.removeAttribute("aria-busy");
      updatePendingControls();
    }
  }

  function resetVacations(dates) {
    state.vacationSelected = new Set(dates);
    state.vacationBaseline = new Set(dates);
  }

  function vacationDifferenceCount() {
    let count = 0;
    for (const date of state.vacationBaseline) {
      if (!state.vacationSelected.has(date)) count++;
    }
    for (const date of state.vacationSelected) {
      if (!state.vacationBaseline.has(date)) count++;
    }
    return count;
  }

  function showLoading() {
    els.home.classList.add("loadingScreen");
    els.home.innerHTML = '<div class="loadingScreen"><div class="loadingBlock skeleton"></div>' +
      '<div class="metrics"><div class="metric skeleton">.</div><div class="metric skeleton">.</div><div class="metric skeleton">.</div></div>' +
      '<div class="loadingBlock skeleton"></div></div>';
  }

  function showFatal(message) {
    els.home.innerHTML = '<div class="card"><h2 class="cardTitle">No se ha podido cargar</h2>' +
      '<p class="cardHint">' + escapeHtml(message || "Error desconocido") + '</p>' +
      '<button class="button primary" style="width:100%" onclick="location.reload()">Reintentar</button></div>';
  }

  function toast(message, error = false) {
    const feedback = document.getElementById("feedback");
    feedback.hidden = !error;
    if (error) document.getElementById("feedbackText").textContent = message;
    els.toast.textContent = message;
    els.toast.classList.toggle("error", error);
    els.toast.classList.add("show");
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => els.toast.classList.remove("show"), error ? 6000 : 3000);
  }

  function metricHtml(label, value, extraClass) {
    return '<div class="metric"><div class="metricLabel">' + escapeHtml(label) +
      '</div><div class="metricValue ' + extraClass + '">' + escapeHtml(value) + '</div></div>';
  }

  function scheduleHint(dailyHours) {
    return "Las cuatro marcas deben sumar " + dailyHours + " horas de trabajo y mantener al menos una hora de descanso.";
  }

  function updateScheduleFields(form) {
    const dailyHours = Number(form.elements.daily_hours.value);
    const dailyMinutes = dailyHours * 60;
    const entry = form.elements.entry_am;
    const exit = form.elements.exit_pm;
    const lunchOut = form.elements.lunch_out;
    const lunchIn = form.elements.lunch_in;
    document.getElementById("scheduleHint").textContent = scheduleHint(dailyHours);

    const minutes = (time) => {
      if (!time) return NaN;
      const parts = time.split(":").map(Number);
      return parts[0] * 60 + parts[1];
    };
    const time = (value) => value >= 0 && value < 24 * 60
      ? String(Math.floor(value / 60)).padStart(2, "0") + ":" + String(value % 60).padStart(2, "0")
      : "";
    const entryMinutes = minutes(entry.value);
    if (!Number.isFinite(entryMinutes)) return;

    if (!(minutes(lunchOut.value) > entryMinutes &&
          minutes(lunchOut.value) < entryMinutes + dailyMinutes &&
          minutes(lunchIn.value) - minutes(lunchOut.value) >= 60)) {
      lunchOut.value = time(entryMinutes + dailyMinutes / 2);
      lunchIn.value = time(entryMinutes + dailyMinutes / 2 + 60);
    }
    exit.value = time(entryMinutes + dailyMinutes + minutes(lunchIn.value) - minutes(lunchOut.value));
  }

  function timeField(label, name, value) {
    return '<div class="field"><label for="config-' + escapeHtml(name) + '">' +
      escapeHtml(label) + '</label><input id="config-' + escapeHtml(name) + '" class="input" type="time" name="' +
      escapeHtml(name) + '" value="' + escapeHtml(value) + '" required></div>';
  }

  function eventByOrder(order) {
    return EVENTS.find((event) => event.order === Number(order));
  }

  function formatDuration(totalSeconds) {
    const value = Number(totalSeconds || 0);
    const sign = value < 0 ? "-" : "";
    const absolute = Math.abs(value);
    return sign + Math.floor(absolute / 3600) + ":" +
      String(Math.floor((absolute % 3600) / 60)).padStart(2, "0") + ":" +
      String(absolute % 60).padStart(2, "0");
  }

  function formatSignedDuration(seconds) {
    const value = Number(seconds || 0);
    if (value === 0) return "±0:00:00";
    return (value > 0 ? "+" : "-") + formatDuration(Math.abs(value));
  }

  function formatDate(date) {
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return date || "";
    const parts = date.split("-");
    return parts[2] + "/" + parts[1] + "/" + parts[0];
  }

  function shiftMonth(value, delta) {
    const parts = String(value).split("-").map(Number);
    const date = new Date(Date.UTC(parts[0], parts[1] - 1 + delta, 1));
    return date.getUTCFullYear() + "-" + String(date.getUTCMonth() + 1).padStart(2, "0");
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }
}

// ==================================================
// SERVER UTILITIES
// ==================================================

function assertSameOrigin(request, url) {
  const origin = request.headers.get("Origin");
  if (origin && origin !== url.origin) {
    throw new HttpError(403, "Origen no permitido.");
  }
}

async function readJson(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    throw new HttpError(400, "El cuerpo de la petición no es JSON válido.");
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new HttpError(400, "Se esperaba un objeto JSON.");
  }
  return body;
}

function getMadridParts(date) {
  const formatter = new Intl.DateTimeFormat("en-GB", {
    timeZone: TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    weekday: "short",
    hourCycle: "h23",
  });

  const parts = Object.fromEntries(
    formatter.formatToParts(date).map((part) => [part.type, part.value])
  );
  const weekdays = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };

  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
    weekday: weekdays[parts.weekday],
  };
}

function normalizeTime(value) {
  if (typeof value !== "string" || !/^\d{2}:\d{2}$/.test(value)) return null;
  const [hour, minute] = value.split(":").map(Number);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return value;
}

function normalizeTimeWithSeconds(value) {
  if (
    typeof value !== "string" ||
    !/^\d{2}:\d{2}(?::\d{2})?$/.test(value)
  ) {
    return null;
  }

  const [hour, minute, second = 0] = value.split(":").map(Number);
  if (
    hour < 0 ||
    hour > 23 ||
    minute < 0 ||
    minute > 59 ||
    second < 0 ||
    second > 59
  ) {
    return null;
  }

  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:${String(second).padStart(2, "0")}`;
}

function timeToSeconds(value) {
  const parts = String(value).split(":").map(Number);
  return parts[0] * 3600 + parts[1] * 60 + (parts[2] || 0);
}

function addSecondsToTime(baseTime, offsetSeconds) {
  const total = timeToSeconds(baseTime) + offsetSeconds;
  const hour = Math.floor(total / 3600) % 24;
  const minute = Math.floor((total % 3600) / 60);
  const second = total % 60;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:${String(second).padStart(2, "0")}`;
}

function isDateString(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const date = parseDate(value);
  return toDateString(date) === value;
}

function isWeekdayDate(value) {
  if (!isDateString(value)) return false;
  const weekday = parseDate(value).getUTCDay();
  return weekday !== 0 && weekday !== 6;
}

function parseDate(value) {
  const [year, month, day] = String(value).split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function toDateString(date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

function getWeekStart(dateString) {
  const date = parseDate(dateString);
  const weekday = date.getUTCDay();
  date.setUTCDate(date.getUTCDate() + (weekday === 0 ? -6 : 1 - weekday));
  return toDateString(date);
}

function addDays(dateString, days) {
  const date = parseDate(dateString);
  date.setUTCDate(date.getUTCDate() + days);
  return toDateString(date);
}

function weekdayName(dateString) {
  return [
    "Domingo",
    "Lunes",
    "Martes",
    "Miércoles",
    "Jueves",
    "Viernes",
    "Sábado",
  ][parseDate(dateString).getUTCDay()];
}

function formatDuration(totalSeconds) {
  const value = Number(totalSeconds || 0);
  const sign = value < 0 ? "-" : "";
  const absolute = Math.abs(value);
  return `${sign}${Math.floor(absolute / 3600)}:${String(
    Math.floor((absolute % 3600) / 60)
  ).padStart(2, "0")}:${String(absolute % 60).padStart(2, "0")}`;
}

function eventLabel(event) {
  return EVENTS.find((item) => item.event === event)?.label || event;
}

function randomInt(min, max) {
  const buffer = new Uint32Array(1);
  crypto.getRandomValues(buffer);
  return min + (buffer[0] % (max - min + 1));
}

function shuffle(values) {
  for (let index = values.length - 1; index > 0; index--) {
    const target = randomInt(0, index);
    [values[index], values[target]] = [values[target], values[index]];
  }
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function responseHeaders(contentType) {
  return {
    "Content-Type": contentType,
    "Cache-Control": "no-store, no-cache, must-revalidate",
    Pragma: "no-cache",
    "X-Woffu-Clock-Version": APP_VERSION,
    "X-Content-Type-Options": "nosniff",
  };
}

function htmlResponse(html, status = 200) {
  return new Response(html, {
    status,
    headers: {
      ...responseHeaders("text/html; charset=utf-8"),
      "X-Frame-Options": "DENY",
    },
  });
}

function textResponse(text, status = 200) {
  return new Response(text, {
    status,
    headers: responseHeaders("text/plain; charset=utf-8"),
  });
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: responseHeaders("application/json; charset=utf-8"),
  });
}

function manifestResponse() {
  return new Response(
    JSON.stringify({
      name: "Woffu Clock Cloud",
      short_name: "Woffu Clock",
      start_url: "/",
      display: "standalone",
      background_color: "#ffffff",
      theme_color: "#061c43",
      icons: [
        {
          src: "/icon.svg",
          sizes: "any",
          type: "image/svg+xml",
          purpose: "any maskable",
        },
      ],
    }),
    {
      headers: {
        "Content-Type": "application/manifest+json; charset=utf-8",
        "Cache-Control": "public, max-age=3600",
      },
    }
  );
}

function iconResponse() {
  return new Response(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" rx="120" fill="#151922"/><path d="M106 136h72l42 214 42-164h64l42 164 42-214h72l-72 240h-72l-44-155-44 155h-72z" fill="white"/></svg>`,
    {
      headers: {
        "Content-Type": "image/svg+xml; charset=utf-8",
        "Cache-Control": "public, max-age=86400",
      },
    }
  );
}
