// Verified against the official sources below on 2026-11-06.
// Keep explicit annual calendars: local holidays and substitutions can change.
export const HOLIDAY_CALENDAR_VERSION = "2026-11-06";
export const OFFICES = [
  { id: "barcelona", label: "Barcelona" },
  { id: "madrid", label: "Madrid" },
  { id: "sevilla", label: "Sevilla" },
];

const CALENDARS = {
  barcelona: {
    2026: {
      sources: ["https://guia.barcelona.cat/ca/detall/festes-estatals-i-autonomiques-a-catalunya-i-locals-a-barcelona-al-2026_99400735671.html"],
      days: [
        ["01-01", "Año Nuevo"], ["01-06", "Reyes"],
        ["04-03", "Viernes Santo"], ["04-06", "Lunes de Pascua"],
        ["05-01", "Fiesta del Trabajo"], ["05-25", "Segunda Pascua", "local"],
        ["06-24", "Sant Joan"], ["08-15", "Asunción"],
        ["09-11", "Diada de Catalunya"], ["09-24", "La Mercè", "local"],
        ["10-12", "Fiesta Nacional de España"], ["12-08", "Inmaculada Concepción"],
        ["12-25", "Navidad"], ["12-26", "Sant Esteve"],
      ],
    },
    2027: {
      sources: ["https://guia.barcelona.cat/ca/detall/festes-estatals-i-autonomiques-a-catalunya-i-locals-a-barcelona-al-2027_99400777767.html"],
      days: [
        ["01-01", "Año Nuevo"], ["01-06", "Reyes"],
        ["03-26", "Viernes Santo"], ["03-29", "Lunes de Pascua"],
        ["05-01", "Fiesta del Trabajo"], ["05-17", "Segunda Pascua", "local"],
        ["06-24", "Sant Joan"], ["09-11", "Diada de Catalunya"],
        ["09-24", "La Mercè", "local"], ["10-12", "Fiesta Nacional de España"],
        ["11-01", "Todos los Santos"], ["12-06", "Día de la Constitución"],
        ["12-08", "Inmaculada Concepción"], ["12-25", "Navidad"],
      ],
    },
  },
  madrid: {
    2026: {
      sources: ["https://www.comunidad.madrid/empleo/calendario-laboral-comunidad-madrid-municipios"],
      days: [
        ["01-01", "Año Nuevo"], ["01-06", "Reyes"],
        ["04-02", "Jueves Santo"], ["04-03", "Viernes Santo"],
        ["05-01", "Fiesta del Trabajo"], ["05-02", "Día de la Comunidad de Madrid"],
        ["05-15", "San Isidro", "local"], ["08-15", "Asunción"],
        ["10-12", "Fiesta Nacional de España"], ["11-02", "Todos los Santos (traslado)"],
        ["11-09", "La Almudena", "local"], ["12-07", "Día de la Constitución (traslado)"],
        ["12-08", "Inmaculada Concepción"], ["12-25", "Navidad"],
      ],
    },
    2027: {
      sources: ["https://diario.madrid.es/blog/2026/10/10/calendario-laboral-2027-todos-los-dias-festivos-en-la-ciudad-de-madrid/"],
      days: [
        ["01-01", "Año Nuevo"], ["01-06", "Reyes"], ["03-19", "San José"],
        ["03-25", "Jueves Santo"], ["03-26", "Viernes Santo"],
        ["05-01", "Fiesta del Trabajo"], ["05-15", "San Isidro", "local"],
        ["08-16", "Asunción (traslado)"], ["10-12", "Fiesta Nacional de España"],
        ["11-01", "Todos los Santos"], ["11-09", "La Almudena", "local"],
        ["12-06", "Día de la Constitución"], ["12-08", "Inmaculada Concepción"],
        ["12-25", "Navidad"],
      ],
    },
  },
  sevilla: {
    2026: {
      sources: [
        "https://www.juntadeandalucia.es/organismos/empleoempresaytrabajoautonomo/areas/relaciones-laborales/calendario-fiestas.html",
        "https://www.juntadeandalucia.es/boja/2025/197/28",
      ],
      days: [
        ["01-01", "Año Nuevo"], ["01-06", "Reyes"], ["02-28", "Día de Andalucía"],
        ["04-02", "Jueves Santo"], ["04-03", "Viernes Santo"],
        ["04-22", "Feria de Abril", "local"], ["05-01", "Fiesta del Trabajo"],
        ["06-04", "Corpus Christi", "local"], ["08-15", "Asunción"],
        ["10-12", "Fiesta Nacional de España"], ["11-02", "Todos los Santos (traslado)"],
        ["12-07", "Día de la Constitución (traslado)"], ["12-08", "Inmaculada Concepción"],
        ["12-25", "Navidad"],
      ],
    },
    2027: {
      sources: [
        "https://www.juntadeandalucia.es/organismos/empleoempresaytrabajoautonomo/areas/relaciones-laborales/calendario-fiestas.html",
        "https://www.juntadeandalucia.es/boja/2026/210/25",
      ],
      days: [
        ["01-01", "Año Nuevo"], ["01-06", "Reyes"], ["03-01", "Día de Andalucía (traslado)"],
        ["03-25", "Jueves Santo"], ["03-26", "Viernes Santo"],
        ["04-14", "Feria de Abril", "local"], ["05-01", "Fiesta del Trabajo"],
        ["05-27", "Corpus Christi", "local"], ["08-16", "Asunción (traslado)"],
        ["10-12", "Fiesta Nacional de España"], ["11-01", "Todos los Santos"],
        ["12-06", "Día de la Constitución"], ["12-08", "Inmaculada Concepción"],
        ["12-25", "Navidad"],
      ],
    },
  },
};

export function isOffice(office) {
  return OFFICES.some(({ id }) => id === office);
}

export function hasHolidayCalendar(office, year) {
  return isOffice(office) && Object.hasOwn(CALENDARS[office], String(year));
}

export function getHoliday(office, date) {
  if (!hasHolidayCalendar(office, date.slice(0, 4))) return null;
  const entry = CALENDARS[office][date.slice(0, 4)].days.find(([day]) => day === date.slice(5));
  return entry ? { date, name: entry[1], local: entry[2] === "local" } : null;
}

export function getOfficeCalendar(office) {
  const definition = OFFICES.find(({ id }) => id === office);
  const calendars = definition ? CALENDARS[office] : {};
  return {
    office: definition?.id || null,
    label: definition?.label || null,
    version: HOLIDAY_CALENDAR_VERSION,
    years: Object.keys(calendars).map(Number),
    holidays: Object.entries(calendars).flatMap(([year, calendar]) =>
      calendar.days.map(([date, name, scope]) => ({ date: `${year}-${date}`, name, local: scope === "local" }))
    ),
    sources: Object.entries(calendars).map(([year, calendar]) => ({ year: Number(year), urls: calendar.sources })),
  };
}
