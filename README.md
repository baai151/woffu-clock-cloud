# Woffu Clock Cloud

Webapp de prueba para planificar y automatizar fichajes de una cuenta Woffu mediante Cloudflare Workers.

## Tutorial completo para principiantes

La guía se sigue solo con el navegador, sin instalar programas ni saber programar. Elige tu punto de partida:

| Qué necesitas | Enlace |
| --- | --- |
| Instalar por primera vez | [Guía desde cero](docs/SETUP_TESTING_ES.md) |
| Recibir las novedades en una copia existente | [Actualizar con Sync fork y comprobar Cloudflare](docs/SETUP_TESTING_ES.md#16-actualizar-la-webapp-en-el-futuro) |
| Aprender a configurar y usar la web | [Oficina, jornada, calendario y marcas manuales](docs/SETUP_TESTING_ES.md#11-cómo-se-usa-la-webapp) |
| Detener los fichajes o resolver un error | [Detener la automatización](docs/SETUP_TESTING_ES.md#15-detener-la-automatización) · [Solución de problemas](docs/SETUP_TESTING_ES.md#17-solución-de-problemas) |

**Cada persona necesita su propia copia.** Un fork copia los archivos del proyecto, no los datos ni las contraseñas de otra persona. Cada Worker conecta una cuenta Woffu y tiene una sola configuración de oficina y horario.

La guía indica dónde pulsar, qué escribir y qué resultado comprobar. Incluye la creación de cuentas, el despliegue, la conexión con Woffu sin fichar y una prueba real opcional, separada del recorrido de instalación.

> Utiliza únicamente una cuenta Woffu de prueba o una cuenta para la que tengas autorización expresa. Empieza siempre con `MODE=TEST`, `WOFFU_WRITE_ENABLED=false` y la automatización pausada.

## Estado actual

Interfaz renovada con una sorpresa de bienvenida. La bienvenida aparece al abrir, recargar o volver a la web, tanto en móvil como en ordenador. Se puede saltar y, con movimiento reducido, muestra una versión breve sin giros. Puede repetirse desde **Ajustes → Bienvenida**.

En **Ajustes → Horario base** puedes elegir una jornada de **6 u 8 horas**, ambas partidas, con **cuatro marcas y al menos una hora de descanso**. Ambas conservan los ajustes aleatorios y el equilibrio semanal; las vacaciones descuentan la duración de la jornada seleccionada. Las configuraciones existentes mantienen 8 horas por defecto.

En **Ajustes → Oficina y festivos** elige **Barcelona, Madrid o Sevilla**. El calendario incorpora los festivos nacionales, autonómicos y locales oficiales de **2026 y 2027**, en azul y separados de las vacaciones. Esos días no generan marcas ni cuentan en el objetivo semanal. La primera vez hay que seleccionar la oficina: no se asigna una ciudad automáticamente ni se permiten fichajes reales o automáticos sin ella.

El entrypoint activo está definido en `wrangler.jsonc`. La automatización continúa mientras sus controles estén activos y exista un calendario verificado para el año correspondiente. Los años sin calendario bloquean los fichajes y muestran un aviso. Consulta las [fuentes oficiales y el procedimiento de actualización anual](docs/OFFICE_HOLIDAYS.md).

El scheduler LIVE conserva la recuperación de hasta diez minutos, los reintentos de D1 y el bloqueo de reenvíos ambiguos. Su compensación semanal usa la jornada seleccionada, excluye festivos y vacaciones y mantiene el margen aleatorio de 0–60 segundos adicionales por día laborable. La actualización conserva los planes existentes mientras no se haya elegido una oficina.

Para verificar el generador, la configuración, las vacaciones, los festivos y el scheduler en local: `npm test` (Node.js 22 actualizado). Las pruebas usan SQLite en memoria y no contactan con Woffu.
