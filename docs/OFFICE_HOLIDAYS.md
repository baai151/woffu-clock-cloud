# Festivos por oficina

Calendarios contrastados el **6 de noviembre de 2026**, para los municipios de Barcelona, Madrid y Sevilla (no para toda la provincia). Cada calendario contiene los doce festivos generales aplicables y los dos locales, incluidos los que caen en sábado. Los fines de semana se excluyen además por su día de la semana.

## Fuentes oficiales

| Oficina | Año | Fuentes |
| --- | --- | --- |
| Barcelona | 2026 | [Ajuntament: calendario completo](https://guia.barcelona.cat/ca/detall/festes-estatals-i-autonomiques-a-catalunya-i-locals-a-barcelona-al-2026_99400735671.html) |
| Barcelona | 2027 | [Ajuntament: calendario completo](https://guia.barcelona.cat/ca/detall/festes-estatals-i-autonomiques-a-catalunya-i-locals-a-barcelona-al-2027_99400777767.html) |
| Madrid | 2026 | [Comunidad de Madrid: calendario general y fiestas locales](https://www.comunidad.madrid/empleo/calendario-laboral-comunidad-madrid-municipios) |
| Madrid | 2027 | [Ayuntamiento: calendario completo](https://diario.madrid.es/blog/2026/10/10/calendario-laboral-2027-todos-los-dias-festivos-en-la-ciudad-de-madrid/) |
| Sevilla | 2026 | [Junta: calendario general](https://www.juntadeandalucia.es/organismos/empleoempresaytrabajoautonomo/areas/relaciones-laborales/calendario-fiestas.html), [BOJA: fiestas locales](https://www.juntadeandalucia.es/boja/2025/197/28) |
| Sevilla | 2027 | [Junta: calendario general](https://www.juntadeandalucia.es/organismos/empleoempresaytrabajoautonomo/areas/relaciones-laborales/calendario-fiestas.html), [BOJA: fiestas locales](https://www.juntadeandalucia.es/boja/2026/210/25) |

Las fechas son explícitas por año: no se deducen por repetición ni se trasladan los domingos al lunes de forma genérica. Por ejemplo, el 2 de noviembre de 2026 es festivo en Madrid y Sevilla, pero no en Barcelona; el 3 de mayo de 2027 no se añade como festivo de Madrid.

## Comportamiento

- La columna `config.office` empieza vacía al migrar, conservando el horario y el estado de activación anteriores. El scheduler y el envío real esperan a que se seleccione una oficina válida.
- Los datos se incluyen en `src/holidays.js`: seleccionar una oficina carga sus festivos automáticamente, sin depender de una petición externa en el momento de fichar.
- Los festivos se mantienen separados de la tabla `vacations`. Un solapamiento se descuenta una sola vez; las vacaciones originales se conservan para que un cambio de oficina no pierda selecciones del usuario.
- El plan excluye festivos y vacaciones al equilibrar las jornadas de 6 u 8 horas. Los días sin calendario conocido quedan pendientes, sin un objetivo semanal ficticio de cero horas.
- El scheduler comprueba el festivo al preparar el día y al reservar cada evento. La reserva verifica que la oficina no haya cambiado desde la comprobación. Un plan anterior no permite eludir la exclusión.
- El envío real desde `/api/woffu/punch-now` tampoco permite fichar en festivos, vacaciones o fines de semana. La pantalla Manual rechaza registros y pausas en festivos.
- Un año sin calendario verificado muestra un aviso y bloquea los fichajes de ese año. Esta versión no descarga ni verifica futuros calendarios automáticamente.

## Actualización anual

1. Contrastar los calendarios completos del nuevo año y las dos fiestas locales de cada ayuntamiento, incluyendo posibles correcciones oficiales.
2. Añadir el año, fechas, nombres y fuentes a `src/holidays.js`. No sustituir fechas desconocidas por un calendario estimado.
3. Cambiar `HOLIDAY_CALENDAR_VERSION`. Los planes que tengan una versión anterior se regenerarán al consultarlos o ejecutarlos; no se borran vacaciones ni registros de fichajes.
4. Ampliar las pruebas del nuevo año en `test/holidays.test.mjs`, comprobar las diferencias entre ciudades y ejecutar `npm test` y `npx wrangler deploy --dry-run`.
5. Publicar la versión actualizada mediante el flujo habitual del proyecto. Hasta entonces los años no incluidos permanecen bloqueados.
