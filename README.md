# Woffu Clock Cloud

Webapp de prueba para planificar y automatizar fichajes de una cuenta Woffu mediante Cloudflare Workers.

## Tutorial completo para principiantes

Si empiezas sin cuenta de GitHub o Cloudflare y no tienes conocimientos técnicos, sigue la guía paso a paso:

### [Abrir la guía completa de configuración y uso](docs/SETUP_TESTING_ES.md)

La guía explica desde cero:

- Cómo crear las cuentas de GitHub y Cloudflare, con enlaces oficiales.
- Cómo hacer tu propia copia del repositorio sin instalar programas.
- Cómo desplegar el Worker y comprobar la base D1.
- Cómo guardar las credenciales correctamente como secretos.
- Cómo probar la conexión sin fichar.
- Qué hace cada pantalla de la webapp.
- Cómo probar un fichaje manual y el scheduler de forma controlada.
- Cómo detener, actualizar y diagnosticar la aplicación.

> Utiliza únicamente una cuenta Woffu de prueba o una cuenta para la que tengas autorización expresa. Empieza siempre con `MODE=TEST`, `WOFFU_WRITE_ENABLED=false` y la automatización pausada.

## Estado actual

Interfaz clara con identidad Capgemini y bienvenida 3D. La animación se muestra una vez por sesión, se puede saltar y respeta el movimiento reducido. Puede repetirse desde **Ajustes → Bienvenida**.

En **Ajustes → Horario base** puedes elegir una jornada de **6 u 8 horas**, ambas partidas, con **cuatro marcas y al menos una hora de descanso**. Ambas conservan los ajustes aleatorios y el equilibrio semanal; las vacaciones descuentan la duración de la jornada seleccionada. Las configuraciones existentes mantienen 8 horas por defecto.

En **Ajustes → Oficina y festivos** elige **Barcelona, Madrid o Sevilla**. El calendario incorpora los festivos nacionales, autonómicos y locales oficiales de **2026 y 2027**, en azul y separados de las vacaciones. Esos días no generan marcas ni cuentan en el objetivo semanal. La primera vez hay que seleccionar la oficina: no se asigna una ciudad automáticamente ni se permiten fichajes reales o automáticos sin ella.

El entrypoint activo está definido en `wrangler.jsonc`. La automatización continúa mientras sus controles estén activos y exista un calendario verificado para el año correspondiente. Los años sin calendario bloquean los fichajes y muestran un aviso. Consulta las [fuentes oficiales y el procedimiento de actualización anual](docs/OFFICE_HOLIDAYS.md).

El scheduler LIVE conserva la recuperación de hasta diez minutos, los reintentos de D1 y el bloqueo de reenvíos ambiguos. Su compensación semanal usa la jornada seleccionada, excluye festivos y vacaciones y mantiene el margen aleatorio de 0–60 segundos adicionales por día laborable. La actualización conserva los planes existentes mientras no se haya elegido una oficina.

Para verificar el generador, la configuración, las vacaciones, los festivos y el scheduler en local: `npm test` (Node.js 22 actualizado). Las pruebas usan SQLite en memoria y no contactan con Woffu.
