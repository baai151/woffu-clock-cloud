# Guía desde cero — configurar y usar Woffu Clock Cloud

Puedes seguir esta guía solo con el navegador. No necesitas programar, instalar aplicaciones, usar una terminal ni comprar un dominio.

## Empieza por tu caso

| Tu situación | Por dónde empezar |
| --- | --- |
| Nunca he instalado esta aplicación | Sigue los apartados **1 a 10**, en orden. Terminarás con tu propia web en modo de prueba. |
| Ya tengo mi copia funcionando y quiero las novedades | Ve directamente a [16. Actualizar mi copia](#16-actualizar-la-webapp-en-el-futuro). No crees otro Worker ni otra base de datos. |
| Ya puedo entrar, pero no sé usarla | Abre [11. Uso de las pantallas](#11-cómo-se-usa-la-webapp). |
| Quiero detener los fichajes | Ve a [15. Detener la automatización](#15-detener-la-automatización). Cerrar el navegador no los detiene. |
| Algo no coincide con la guía | Consulta [17. Solución de problemas](#17-solución-de-problemas). |

**Qué necesitas entender antes de empezar:** cada persona tendrá su propia copia, su propia dirección y su propia cuenta Woffu conectada. La web no tiene un registro de usuarios individuales: quien entra en una misma copia administra la misma cuenta y configuración.

Durante la instalación usaremos `TEST` y `false`: podrás preparar el horario sin enviar fichajes. Activa escrituras únicamente con una cuenta para la que tengas autorización. Guarda las contraseñas en Cloudflare como se explica abajo; nunca en GitHub ni en mensajes.

Los botones de GitHub y Cloudflare pueden aparecer en inglés. La guía conserva esos nombres y explica qué hacen. **`TU-USUARIO` y `TU_URL` son ejemplos para sustituir**, no textos que debas copiar literalmente.

## Índice

1. [Qué vas a crear](#1-qué-vas-a-crear-y-cómo-funciona)
2. [Qué necesitas](#2-qué-necesitas-antes-de-empezar)
3. [Crear cuenta en GitHub](#3-crear-una-cuenta-de-github)
4. [Crear tu copia o fork](#4-crear-tu-copia-del-proyecto-en-github)
5. [Crear cuenta en Cloudflare](#5-crear-una-cuenta-de-cloudflare)
6. [Publicar tu aplicación](#6-crear-el-worker-conectar-github-y-desplegar)
7. [Comprobar la base de datos](#7-comprobar-la-base-de-datos-d1)
8. [Entender los controles de prueba y escritura](#8-configurar-contraseñas-y-modo-seguro)
9. [Entrar y elegir tu oficina](#9-encontrar-y-abrir-la-dirección-de-la-webapp)
10. [Comprobar que funciona sin fichar](#10-hacer-las-primeras-comprobaciones-sin-fichar)
11. [Usar las pantallas](#11-cómo-se-usa-la-webapp)
12. [Probar una simulación automática](#12-probar-el-plan-automático-sin-escribir-en-woffu)
13. [Prueba real opcional](#13-probar-un-único-fichaje-real-de-forma-controlada)
14. [Activar los fichajes automáticos](#14-activar-la-automatización-real)
15. [Detenerlos](#15-detener-la-automatización)
16. [Actualizar mi copia](#16-actualizar-la-webapp-en-el-futuro)
17. [Resolver problemas](#17-solución-de-problemas)
18. [Preguntas frecuentes](#18-preguntas-frecuentes)
19. [Comprobación final](#19-checklist-final)

## 1. Qué vas a crear y cómo funciona

| Nombre que verás | Qué significa aquí |
| --- | --- |
| **GitHub** | La web donde se guardan los archivos del proyecto. |
| **Repositorio** | La carpeta del proyecto dentro de GitHub. |
| **Fork** | Tu copia de esa carpeta, dentro de tu cuenta. |
| **Cloudflare Worker** | La aplicación publicada en Internet. Funciona aunque apagues tu ordenador. |
| **Deploy / despliegue** | Publicar una versión de la aplicación. |
| **Build** | El proceso que prepara y publica los archivos de GitHub en Cloudflare. |
| **D1** | La base de datos que conserva tu horario, oficina, vacaciones y registros. |
| **Secret** | Un valor privado, como una contraseña, que Cloudflare oculta después de guardarlo. |
| **Cron / scheduler** | El proceso automático que comprueba el plan una vez por minuto. |

Harás este recorrido:

```text
Crear tu copia en GitHub
→ Conectarla a Cloudflare
→ Abrir tu propia web
→ Elegir oficina, jornada y vacaciones
→ Comprobarla en modo de prueba
→ Activar fichajes solo cuando quieras empezar
```

## 2. Qué necesitas antes de empezar

- Un correo electrónico al que puedas acceder.
- Tu cuenta Woffu y su contraseña, con permiso para utilizarla en esta aplicación.
- Una contraseña nueva para proteger tu web. Guárdala en tu gestor de contraseñas.

No confundas estas dos contraseñas:

| Contraseña | Para qué sirve |
| --- | --- |
| La de Woffu | Para que la aplicación se conecte a tu cuenta Woffu. |
| La nueva de administración | Para entrar en tu propia web. La guardarás con el nombre `ADMIN_PASSWORD`. |

**Organiza el navegador:** deja esta guía en una pestaña y abre GitHub y Cloudflare en otras. Así podrás volver al paso que estabas siguiendo.

## 3. Crear una cuenta de GitHub

Si ya tienes cuenta y puedes entrar, pasa al apartado 4.

1. Abre [el registro de GitHub](https://github.com/signup).
2. Sigue el formulario para crear una cuenta personal. Apunta tu nombre de usuario: lo usarás para reconocer tu copia.
3. Verifica el correo cuando GitHub lo pida.
4. Inicia sesión en [GitHub](https://github.com/).

**Comprueba antes de seguir:** puedes abrir tu perfil y ves tu nombre de usuario. Crear la cuenta no instala nada en el ordenador. [Ayuda oficial para crear una cuenta](https://docs.github.com/es/account-and-profile/how-tos/account-management/creating-an-account-on-github).

## 4. Crear tu copia del proyecto en GitHub

1. Abre el [repositorio original `paubaaay/woffu-clock-cloud`](https://github.com/paubaaay/woffu-clock-cloud).
2. Arriba a la derecha, pulsa **Fork**: significa crear tu copia.
3. En **Owner** (propietario), elige tu cuenta. Mantén el nombre `woffu-clock-cloud`.
4. Deja marcada **Copy the default branch only**, si aparece, y pulsa **Create fork**.

**Comprueba antes de seguir:** la dirección contiene **tu usuario**, así:

```text
https://github.com/TU-USUARIO/woffu-clock-cloud
```

También debe aparecer `forked from paubaaay/woffu-clock-cloud`. Guarda esta página en favoritos: es donde actualizarás tu copia más adelante. No necesitas descargar archivos ni pulsar **Code**. [Ayuda oficial sobre forks](https://docs.github.com/es/pull-requests/how-tos/work-with-forks/fork-a-repo).

Si aparece **404 / Not Found**, confirma que has iniciado sesión. Si el proyecto requiere invitación, pide acceso al propietario y acepta el correo de GitHub antes de continuar.

## 5. Crear una cuenta de Cloudflare

Si ya puedes entrar en Cloudflare, pasa al apartado 6.

1. Abre [el registro de Cloudflare](https://dash.cloudflare.com/sign-up).
2. Crea la cuenta y verifica el correo si te lo pide.
3. Entra en [el panel de Cloudflare](https://dash.cloudflare.com/) y selecciona tu cuenta.
4. Busca **Workers & Pages**. Si te propone añadir un dominio, omite ese paso: este proyecto no lo necesita.

Cloudflare ofrece niveles gratuitos con límites. Revisa las condiciones de [Workers](https://developers.cloudflare.com/workers/platform/pricing/) y [D1](https://developers.cloudflare.com/d1/platform/pricing/) al elegir el plan; no hace falta contratar un dominio para seguir la guía.

**Comprueba antes de seguir:** puedes abrir **Workers & Pages** dentro de tu cuenta.

## 6. Crear el Worker, conectar GitHub y desplegar

Primero crearemos una aplicación básica, guardaremos sus contraseñas y después conectaremos tu fork. Este orden evita que el primer despliegue falle por no tener todavía los secretos obligatorios.

### 6.1 Crear el Worker básico

En **Cloudflare**:

1. Abre **Workers & Pages → Create application**.
2. Elige **Start with Hello World! → Get started**, o la opción equivalente de Worker básico.
3. Pon exactamente este nombre: `woffu-clock-cloud`.
4. Pulsa **Deploy** (publicar). Cuando termine, abre el proyecto.

Ver **Hello World** en esta fase es normal: todavía no has publicado Woffu Clock. La [guía de Cloudflare](https://developers.cloudflare.com/d1/get-started/) muestra esta creación desde el panel.

El nombre debe coincidir con el que lleva el proyecto. No añadas tu usuario ni cambies `woffu-clock-cloud`: la dirección será distinta gracias al subdominio de tu cuenta.

### 6.2 Guardar las contraseñas y el modo de prueba

Dentro de ese Worker, abre **Settings → Variables and Secrets**. No uses **Build variables and secrets**: esa sección no configura los valores que necesita la aplicación al funcionar.

Pulsa **Add** y añade estas cinco filas. Copia los nombres exactamente, incluidas las mayúsculas:

| Nombre / Variable name | Tipo / Type | Valor / Value que debes introducir |
| --- | --- | --- |
| `ADMIN_PASSWORD` | **Secret** | La contraseña nueva que elegiste para entrar en tu web. |
| `WOFFU_EMAIL` | **Secret** | Tu email de Woffu. |
| `WOFFU_PASSWORD` | **Secret** | Tu contraseña de Woffu. |
| `MODE` | **Text** o **Plaintext** | `TEST` |
| `WOFFU_WRITE_ENABLED` | **Text** o **Plaintext** | `false` |

Para cada fila, elige el tipo, escribe el nombre y pega el valor. Usa **Add variable** para añadir otra si aparece. Finalmente pulsa **Deploy** o **Save and Deploy** y espera a que se aplique.

Escribe `TEST` y `false` sin comillas. En las tres primeras filas debes escribir **tus valores reales**, no el texto explicativo de la tabla. Los secretos quedan ocultos al guardarlos; es normal que ya no puedas leerlos. [Ayuda oficial sobre secretos](https://developers.cloudflare.com/workers/configuration/secrets/#via-the-dashboard).

**Comprueba antes de seguir:** aparecen los cinco nombres y los tres primeros tienen tipo **Secret**. El proyecto exige esos tres secretos antes de desplegar su código. [Validación de secretos obligatorios](https://developers.cloudflare.com/workers/wrangler/configuration/#secrets-configuration-property).

### 6.3 Conectar tu fork

En **Cloudflare**, dentro de `woffu-clock-cloud`:

1. Abre **Settings → Builds → Connect** y elige **GitHub**.
2. Si pide autorización, entra en GitHub. En **Only select repositories**, selecciona solo **tu** `woffu-clock-cloud` y confirma.
3. De vuelta en Cloudflare, elige tu fork. Revisa el propietario: debe ser **tu usuario**, no `paubaaay`.
4. Completa los campos con esta tabla:

| Campo | Qué poner |
| --- | --- |
| Rama / Git branch / Production branch | `main` |
| Directorio raíz / Root directory | Déjalo vacío o con `/`. |
| Build command | Déjalo vacío. |
| Deploy command | `npx wrangler deploy` |

`npx wrangler deploy` se pega **en ese campo de Cloudflare**. No tienes que abrir una terminal. Si aparece un campo de token de API, conserva la opción automática de Cloudflare. [Configuración oficial de Builds](https://developers.cloudflare.com/workers/ci-cd/builds/configuration/).

5. Guarda la conexión. Si ofrece **Save and Deploy** o **Trigger build**, úsalo para iniciar la publicación.

### 6.4 Solo si no empieza ningún build

Conectar un Worker existente puede requerir un cambio nuevo en GitHub para iniciar su primer build. [Conexión de un Worker existente](https://developers.cloudflare.com/workers/ci-cd/builds/#connect-an-existing-worker).

Si ya ves un build en marcha, **salta al paso 6.5**. En caso contrario, en **tu fork de GitHub**:

1. Confirma que estás en la rama `main`, en el selector situado sobre la lista de archivos.
2. Pulsa **Add file → Create new file**.
3. Como nombre, escribe `inicio-cloudflare.txt`.
4. En el contenido, escribe `Inicio del despliegue de mi copia.` No pongas datos personales ni contraseñas.
5. Pulsa **Commit changes** (guardar el cambio), elige guardarlo directamente en `main` y confirma.

Ese pequeño archivo solo sirve para iniciar el build. No cambia la aplicación ni obliga a modificar el código o este tutorial.

### 6.5 Esperar a que termine

En **Cloudflare → Workers & Pages → woffu-clock-cloud → Deployments**, abre **View build history** si aparece.

**Comprueba antes de seguir:** el build de `main` termina con **Success / Succeeded** y la versión queda publicada como despliegue activo. Si pone **Failed**, abre el detalle y consulta el [apartado 17](#17-solución-de-problemas); no sigas como si hubiera terminado bien.

## 7. Comprobar la base de datos D1

En **Cloudflare → Workers & Pages → woffu-clock-cloud → Bindings**, busca una conexión de tipo **D1 database** con nombre de variable **`DB`**.

`DB` es el nombre de la conexión; la base asociada puede tener otro nombre. El proyecto permite que Cloudflare la cree automáticamente al desplegar. [Cómo funciona la creación automática](https://developers.cloudflare.com/workers/wrangler/configuration/#automatic-provisioning).

**Si ya existe `DB` y tiene una base seleccionada, sigue al apartado 8.** No crees otra base.

Solo si falta:

1. Abre **D1 SQL database → Create database** en Cloudflare.
2. Escribe un nombre, por ejemplo `woffu-clock-db`, y pulsa **Create**.
3. Vuelve al Worker → **Bindings → Add binding → D1 database**.
4. En **Variable name**, escribe `DB`. Selecciona la base recién creada.
5. Guarda y aplica el despliegue si lo solicita. [Ayuda oficial sobre la conexión D1](https://developers.cloudflare.com/d1/get-started/#3-bind-your-worker-to-your-d1-database).

No copies una base ni un identificador de otra persona. La aplicación crea sus propias tablas: no necesitas usar **Console**, ejecutar SQL ni seguir los ejemplos de tablas de la documentación de Cloudflare.

## 8. Configurar contraseñas y modo seguro

Los cinco valores ya quedaron guardados en el paso 6.2. Este apartado explica qué hacen; no tienes que volver a crearlos.

| Situación | `MODE` en Cloudflare | `WOFFU_WRITE_ENABLED` en Cloudflare | Automatización en la web |
| --- | --- | --- | --- |
| Preparar y revisar la aplicación | `TEST` | `false` | Desactivada / Pausada |
| Simular el plan sin fichar | `TEST` | `false` | Activa |
| Permitir fichajes automáticos reales | `LIVE` | `true` | Activa |

Los valores se cambian en **Cloudflare → tu Worker → Settings → Variables and Secrets**. Después hay que pulsar **Deploy** para aplicarlos.

**Activa no significa necesariamente que esté fichando:** en `TEST` solo simula. Además, la oficina debe estar guardada y el día debe ser laborable, sin vacaciones ni festivo. Las pausas y marcas manuales también se respetan.

La página especial `/woffu/punch` puede enviar una marca con `LIVE` y `true` aunque la automatización esté pausada. Se explica por separado en el [apartado 13](#13-probar-un-único-fichaje-real-de-forma-controlada).

## 9. Encontrar y abrir la dirección de la webapp

### 9.1 Encontrar tu dirección

En **Cloudflare → Workers & Pages → woffu-clock-cloud**, busca **Visit**, **Domains & Routes** o la dirección terminada en **workers.dev**. Copia la del despliegue activo, no una vista previa de otra rama.

Tendrá una forma parecida a esta:

```text
https://woffu-clock-cloud.TU-SUBDOMINIO.workers.dev
```

Guárdala en favoritos. **Es tu web personal; no debes usar la dirección de otra persona del equipo.**

En el resto de la guía, `TU_URL` significa esa dirección completa. Por ejemplo, si tu dirección ficticia fuera `https://woffu-clock-cloud.ejemplo.workers.dev`, para consultar `TU_URL/health` añadirías `/health` al final:

```text
https://woffu-clock-cloud.ejemplo.workers.dev/health
```

El ejemplo no es una web para entrar: utiliza la dirección que acabas de copiar de Cloudflare.

### 9.2 Entrar

Abre tu dirección. En la ventana de identificación del navegador, escribe:

| Campo | Valor |
| --- | --- |
| Usuario | `admin` |
| Contraseña | La que guardaste como `ADMIN_PASSWORD`. |

No uses el email ni la contraseña de Woffu para entrar en esta ventana.

La primera carga prepara la base de datos. En una instalación nueva, la automatización empieza desactivada. Puedes ver **Configurar** o **Pendiente** mientras falte la oficina; una actualización conserva el estado que ya tenías.

### 9.3 Elegir tu oficina antes de continuar

En **tu web**:

1. Abre **Ajustes → Oficina y festivos**.
2. Selecciona **Barcelona**, **Madrid** o **Sevilla**.
3. Pulsa **Guardar oficina**.
4. Comprueba que aparece tu ciudad y desaparece el aviso de elegir oficina.

Se cargarán los festivos nacionales, autonómicos y locales de esa ciudad. **Sin oficina guardada no funciona ni la simulación automática ni el envío real.** En una copia nueva, guardar la oficina no activa la automatización por sí solo.

Si ves **Pausar automatización**, el interruptor está activado: púlsalo para preparar la configuración con calma. Déjala en **Pausada** para las comprobaciones siguientes.

## 10. Hacer las primeras comprobaciones sin fichar

Mantén `MODE = TEST`, `WOFFU_WRITE_ENABLED = false` y la automatización **Pausada**.

### 10.1 Ver que la web carga

En tu web deben aparecer **Resumen**, **Calendario**, **Manual** y **Ajustes**. Comprueba que la oficina es la tuya y que se ve **Modo TEST**.

### 10.2 Comprobar el estado técnico

En otra pestaña abre `TU_URL/health`. Verás texto con llaves y comillas: es normal, es una pantalla de diagnóstico. Busca estos valores; puede haber más líneas:

```json
{
  "ok": true,
  "mode": "TEST",
  "woffuCredentialsConfigured": true,
  "woffuWriteEnabled": false,
  "liveManualPunchReady": false,
  "scheduledWoffuWritesEnabled": false
}
```

- `ok: true`: la aplicación responde.
- `woffuCredentialsConfigured: true`: existen email y contraseña; todavía no comprueba si son correctos.
- Los tres valores de escritura en `false`: las escrituras están deshabilitadas.

Esta dirección es pública, no muestra contraseñas y **no comprueba por sí sola la base de datos, la oficina ni la conexión con Woffu**. Por eso también hacemos las comprobaciones 10.1 y 10.3. La línea `version`, si aparece, puede cambiar con las actualizaciones.

### 10.3 Comprobar la conexión con Woffu sin fichar

Abre `TU_URL/api/woffu/test`. Si pide identificación, usa `admin` y `ADMIN_PASSWORD`.

El resultado correcto incluye `"ok": true`, `"connection": "success"` y el mensaje **«Autenticación y lecturas verificadas. No se ha creado ningún fichaje.»**

Si falla, ve al [apartado 17](#17-solución-de-problemas). Esta comprobación inicia sesión y consulta datos en Woffu, pero no crea marcas.

**Hasta aquí ya tienes tu copia instalada y comprobada en modo de prueba.** Ahora configura el horario con el apartado 11. Puedes mantenerla en `TEST` todo el tiempo que necesites.

## 11. Cómo se usa la webapp

Las cuatro secciones están en el menú lateral del ordenador y en la navegación inferior del móvil.

### 11.1 Ajustes: jornada, oficina y estado

En **Horario base → Jornada diaria**, elige 6 u 8 horas. Ambas opciones tienen cuatro marcas y al menos una hora de descanso:

| Marca | Ejemplo de 6 h | Ejemplo de 8 h |
| --- | --- | --- |
| Entrada mañana | 09:00 | 09:00 |
| Salida mediodía | 13:00 | 13:00 |
| Entrada mediodía | 14:00 | 14:00 |
| Salida tarde | 16:00 | 18:00 |

El descanso no cuenta como trabajo. Al elegir 6 h, el formulario propone una salida más temprana. Revisa las cuatro horas y pulsa **Guardar horario**: cambiar el selector sin guardar no aplica el cambio.

Las horas deben estar ordenadas, sumar exactamente 6 u 8 horas efectivas y terminar como máximo a las 23:55. Las copias existentes conservan 8 h hasta que se guarde otra jornada.

Guardar el horario o cambiar de oficina recalcula los planes. Hazlo con la automatización pausada y revisa el resultado antes de reactivarla. Las vacaciones y marcas manuales guardadas se conservan.

También encontrarás **Automatización**, **Diagnóstico**, **Últimas ejecuciones** y **Bienvenida → Repetir animación**.

### 11.2 Resumen: entender el plan y los totales

Muestra las marcas de hoy y el total semanal. Pulsa sobre un día de la semana para desplegar sus cuatro horas. **Gestionar día** o **Gestionar este día** abre la pantalla Manual.

El plan inicial añade a cada hora base un retraso aleatorio de 0 a 4 minutos y 59 segundos. Por ejemplo, una entrada base de 09:00 podría convertirse en 09:03:27. Las diferencias entre días se compensan durante la semana.

| Días laborables de la semana | Objetivo base con 6 h | Objetivo base con 8 h |
| --- | --- | --- |
| 5 | 30 h | 40 h |
| 4, por un festivo o vacaciones | 24 h | 32 h |
| 0 | 0 h | 0 h |

En **LIVE**, el motor añade al objetivo semanal un margen aleatorio de **0 a 60 segundos por cada día laborable**. Con cinco días y jornada de 8 h, puede aparecer un objetivo entre **40:00:00 y 40:05:00**. Ver `40:03:44`, por ejemplo, significa 40 horas, 3 minutos y 44 segundos; no son horas decimales.

La compensación puede mover salidas pendientes para ajustar el total, también después de recuperar ciertos fallos. Revisa el plan actualizado: los límites del ajuste inicial no son una garantía para todas las horas tras esas compensaciones. Si faltan marcas o no quedan salidas disponibles para compensar, el total puede quedar pendiente o con una diferencia.

**Regenerar semana** crea otro plan aleatorio. No es necesario para actualizar la aplicación ni arregla un fichaje ya enviado a Woffu.

Todas las horas de la aplicación usan la zona **Europe/Madrid**, también si abres la web desde otro país.

### 11.3 Calendario: vacaciones y festivos

1. Abre **Calendario** y usa las flechas para cambiar de mes.
2. Pulsa los días laborables que quieras marcar como vacaciones. Vuelve a pulsar para desmarcarlos.
3. Pulsa **Guardar**.

La leyenda distingue **azul claro para festivos de oficina** y **azul oscuro para vacaciones**. Los festivos se cargan por la oficina elegida y tienen su nombre en la lista del mes. No tienes que añadirlos a mano.

Ni los festivos ni las vacaciones generan fichajes o cuentan en el objetivo semanal. Los fines de semana y festivos no se pueden seleccionar como nuevas vacaciones. Si unas vacaciones anteriores coinciden con un festivo, el día se descuenta una sola vez y se muestra como festivo.

El calendario incluido cubre **2026 y 2027**. Si un año todavía no tiene calendario verificado, la app lo indica y bloquea los fichajes de ese año. Consulta las [fuentes oficiales y la actualización anual](OFFICE_HOLIDAYS.md).

### 11.4 Manual: anotar lo que ya has fichado

**Guardar marca manual no ficha en Woffu.** Solo anota en esta web una marca que ya has realizado y evita que la automatización repita ese evento.

Ejemplo: hoy quieres gestionar tú la vuelta de comer y la salida.

1. Abre **Manual** y comprueba la fecha.
2. En **Pausar parcialmente**, elige **Entrada mediodía** y pulsa **Pausar resto del día**. Las marcas anteriores no se pausan.
3. Realiza el fichaje que corresponda directamente en Woffu.
4. En **Registrar marca manual**, selecciona el evento, introduce la hora real y pulsa **Guardar marca manual**.
5. Repite el registro cuando hayas hecho la salida. Las horas anotadas aparecen en azul en el resumen.

**Reanudar este día** elimina la pausa parcial. No borra los ajustes manuales ni reactiva el interruptor global si está pausado. Antes de reanudar, comprueba qué eventos quedan por hacer.

### 11.5 Entender «Últimas ejecuciones»

| Estado | Qué significa / qué hacer |
| --- | --- |
| `TEST` | Se simuló el evento. No se envió ningún fichaje. |
| `SUCCESS` | Woffu aceptó el fichaje. |
| `PENDING_SAFE` | La aplicación prepara el envío; todavía no ha llegado al paso de enviarlo. |
| `FAILED_RETRYABLE` | Falló antes del envío y puede reintentarlo dentro de la ventana de recuperación. |
| `POSTING` | Se ha iniciado la fase de envío. Espera y consulta el resultado antes de intervenir. |
| `UNKNOWN` | No se puede confirmar el resultado. Comprueba Woffu antes de repetir: podría haberse creado. |
| `FAILED` | El intento terminó con error. Lee el mensaje y comprueba Woffu antes de actuar. |
| `PENDING` | Estado de simulación o de una versión anterior; si persiste en LIVE, requiere revisión y no un reenvío manual a ciegas. |

Si un resultado queda sin confirmar, la app bloquea el reenvío automático de ese evento para evitar duplicados. Regenerar el plan no elimina esa protección.

## 12. Probar el plan automático sin escribir en Woffu

Esta prueba permite comprobar el reloj automático sin crear marcas reales.

1. En `TU_URL/health`, confirma `mode: TEST` y `woffuWriteEnabled: false`.
2. En tu web, guarda **oficina**, **jornada** y **horario**.
3. Elige para la prueba un día de lunes a viernes que no sea festivo ni vacaciones. No funcionará en un día bloqueado.
4. En **Resumen**, busca la siguiente marca que todavía no haya pasado. Puedes esperar a ese evento; no hace falta inventar un horario para probarla.
5. Pulsa **Activar automatización** y espera a que pase la hora indicada.
6. Recarga la web y abre **Ajustes → Últimas ejecuciones**: debe aparecer `TEST`.
7. Comprueba en Woffu que no se creó una marca y pulsa **Pausar automatización** al terminar.

Si acabas de configurar el cron, deja hasta 15 minutos para que se propague antes de esperar el evento. [Tiempo de propagación documentado por Cloudflare](https://developers.cloudflare.com/workers/configuration/cron-triggers/#2-update-configuration).

Si ya han pasado todas las marcas, espera al siguiente día laborable. En TEST no se reproducen todas las marcas pasadas por el mero hecho de activar el interruptor. Para una prueba cercana puedes desplazar **las cuatro horas base el mismo intervalo**, manteniendo el descanso y las 6/8 horas; después restaura y guarda tu horario habitual antes de pasar a LIVE.

## 13. Probar un único fichaje real de forma controlada

**Este apartado es opcional y crea una marca real. No hace falta completarlo para instalar o actualizar la aplicación.** Úsalo solo si tienes previsto y autorizado ese fichaje. Para comprobar la conexión sin fichar basta con el apartado 10.3.

1. Guarda la oficina y confirma que hoy no es fin de semana, festivo ni vacaciones.
2. Deja la automatización **Pausada** y verifica que `/api/woffu/test` funciona.
3. En **Cloudflare → tu Worker → Settings → Variables and Secrets**, cambia `MODE` a `LIVE` y `WOFFU_WRITE_ENABLED` a `true`. Pulsa **Deploy**.
4. En `TU_URL/health`, confirma `mode: LIVE`, `woffuWriteEnabled: true` y `liveManualPunchReady: true`. Este último valor indica permiso técnico, no que el calendario permita fichar hoy.
5. Abre `TU_URL/woffu/punch`, identifícate con `admin` y tu contraseña de administración y lee el estado.
6. Pulsa **Fichar ahora** una sola vez, confirma si la página lo solicita y comprueba la marca directamente en Woffu. Se utiliza la hora actual.
7. Si corresponde a una de las cuatro marcas del plan, anótala también en **Manual → Guardar marca manual** antes de activar la automatización. Esta página especial no anota por sí sola qué evento del plan has completado.
8. Al terminar la prueba, vuelve a `MODE = TEST` y `WOFFU_WRITE_ENABLED = false` en Cloudflare, pulsa **Deploy** y deja la web **Pausada**.

Si la petición falla o no devuelve confirmación, consulta Woffu antes de pulsar otra vez. El interruptor Pausada solo detiene el plan automático, no este botón de fichaje real.

## 14. Activar la automatización real

Hazlo cuando la conexión de lectura funcione y hayas revisado oficina, jornada, vacaciones y próximas marcas. No es obligatorio generar una marca adicional de prueba del apartado 13.

1. Mantén la web **Pausada**. Si cambiaste el horario para simular, restaura el habitual y pulsa **Guardar horario**.
2. Comprueba que la oficina está guardada y las cuatro marcas son correctas.
3. Si hoy ya has fichado alguna marca directamente en Woffu, regístrala en **Manual** antes de continuar.
4. En **Cloudflare → tu Worker → Settings → Variables and Secrets**, configura `MODE = LIVE` y `WOFFU_WRITE_ENABLED = true`. Pulsa **Deploy**.
5. En `TU_URL/health`, comprueba `mode: LIVE`, `woffuWriteEnabled: true` y `scheduledWoffuWritesEnabled: true`.
6. Vuelve a tu web, recarga y pulsa **Activar automatización** como último paso.
7. Después de la primera marca prevista, comprueba que aparece en Woffu y que el registro muestra `SUCCESS`.

El motor revisa el plan cada minuto y dispone de una ventana de recuperación de **hasta 10 minutos**. Si lo activas justo después de una hora planificada, todavía puede procesar ese evento; una simulación `TEST` anterior no cuenta como un fichaje real ni impide ese envío. Por eso es necesario anotar antes las marcas que ya hiciste tú.

Se excluyen los fines de semana, festivos, vacaciones, eventos pausados y marcas manuales. Algunos errores anteriores al envío se reintentan; los resultados ambiguos se bloquean para evitar duplicados. Cuando recupera un intento fallido antes de enviar, puede usar la hora actual y ajustar salidas pendientes para compensar.

La automatización continúa en las semanas siguientes hasta que la pauses, siempre que exista calendario verificado para el año. Si aparece `FAILED` o `UNKNOWN`, pausa y revisa Woffu antes de hacer una marca adicional.

## 15. Detener la automatización

**Cerrar la web o apagar el ordenador no detiene los fichajes.**

- Para parar el plan automático: abre tu web y pulsa **Pausar automatización**.
- Para bloquear también el botón de fichaje real: en **Cloudflare → tu Worker → Settings → Variables and Secrets**, cambia `WOFFU_WRITE_ENABLED` a `false` y pulsa **Deploy**.

Para dejar terminadas las pruebas, usa `MODE = TEST`, `WOFFU_WRITE_ENABLED = false` y la web **Pausada**. Comprueba el resultado en `/health` y en tu web. Detenerla no elimina una marca que ya se haya enviado.

Si no puedes entrar en la web porque olvidaste la contraseña, aún puedes bloquear la escritura desde Cloudflare. Allí también puedes reemplazar `ADMIN_PASSWORD` y volver a desplegar.

## 16. Actualizar la webapp en el futuro

**Si ya tienes tu copia funcionando, empieza aquí.** No necesitas repetir la instalación, crear otro fork ni tocar las contraseñas.

### 16.1 Traer las novedades a tu fork

1. Abre tu web y pulsa **Pausar automatización** si estaba activa. Haz la actualización en un momento en el que puedas revisar el resultado antes de la siguiente marca.
2. Entra en [GitHub](https://github.com/) con tu cuenta. En el menú de tu avatar, abre **Your repositories** y selecciona **tu** `woffu-clock-cloud`.
3. Comprueba que el propietario eres tú y que se ve `forked from paubaaay/woffu-clock-cloud`. El [repositorio original](https://github.com/paubaaay/woffu-clock-cloud) es la fuente de las novedades; **Sync fork se pulsa en tu copia**.
4. En el selector sobre la lista de archivos, elige `main`.
5. Pulsa **Sync fork** (sincronizar copia) y después **Update branch** (actualizar rama).

Si indica **up to date**, ya tienes los cambios en GitHub. Si informa de **conflictos**, pide ayuda con ese mensaje: no pulses una opción para descartar tus cambios ni borres el fork. [Instrucciones oficiales de sincronización](https://docs.github.com/es/pull-requests/how-tos/work-with-forks/syncing-a-fork).

### 16.2 Esperar a que se publique y revisar

1. Abre **Cloudflare → Workers & Pages → woffu-clock-cloud → Deployments → View build history**.
2. Espera a que el build del cambio recién sincronizado termine con éxito y quede como despliegue activo. Que GitHub esté actualizado no significa todavía que la web lo esté.
3. Abre tu dirección de siempre y recarga. En **Ajustes → Diagnóstico**, comprueba la versión; también aparece en `TU_URL/health`.
4. Si aparece **Elegir oficina**, abre **Ajustes → Oficina y festivos**, elige tu ciudad y pulsa **Guardar oficina**. Sin ella los fichajes quedan bloqueados.
5. Revisa jornada, horario, vacaciones y próximas marcas. No pulses **Regenerar semana** solo por haber actualizado.
6. Si antes la usabas en LIVE, confirma en `/health` que siguen `LIVE` y escritura `true`. Cuando quieras reanudar, pulsa **Activar automatización**. Si ya hiciste alguna marca a mano durante la pausa, anótala primero en **Manual**.

La sincronización actualiza archivos; no copia las contraseñas ni los datos de otra persona. En una actualización normal se mantienen los secretos, las variables y los datos de tu D1, siempre que conserves el mismo Worker y la misma base. La jornada previa no cambia a 6 h por actualizar: debes elegirla y guardarla si la necesitas.

**Comprobación final:** tu web muestra la nueva versión, tu oficina y tu horario, y has dejado la automatización en el estado que querías.

## 17. Solución de problemas

Empieza por la fila que coincide con lo que ves:

| Lo que ves | Qué revisar o hacer |
| --- | --- |
| GitHub muestra **404 / Not Found** | Inicia sesión con la cuenta correcta. Si requiere invitación, acepta el correo del propietario. |
| No encuentro **Sync fork** | Abre tu copia, no el original. Debe poner `forked from…`. Si no aparece, comprueba que realmente creaste un fork. |
| Mi fork no aparece en Cloudflare | En [GitHub → Aplicaciones instaladas](https://github.com/settings/installations), abre la integración de Cloudflare y permite el acceso a tu repositorio. |
| El build dice que faltan secretos | Añade los tres secretos del paso 6.2 en **Settings → Variables and Secrets** del Worker, guarda y reintenta el build. No basta con añadirlos como variables de build. |
| El build dice que el nombre no coincide | El Worker debe llamarse `woffu-clock-cloud`. Si ya tenías otro funcionando, pide ayuda antes de sustituirlo o borrar datos. |
| El build falla por el comando | Revisa rama `main`, raíz vacía o `/`, build vacío y deploy `npx wrangler deploy`. Después usa **Retry build**. |
| Sigo viendo **Hello World** | Solo está publicado el Worker básico. Comprueba el build del repositorio del paso 6.5 y que sea el despliegue activo. |
| Error relacionado con `DB` | Sigue el apartado 7: debe existir una conexión D1 llamada exactamente `DB` y tener tu base seleccionada. |
| La base existe, pero no veo tablas | Abre tu web e identifícate; la aplicación las prepara al cargar. No ejecutes SQL para inventarlas. |
| Me pide la contraseña una y otra vez | Usa `admin` y la contraseña guardada en `ADMIN_PASSWORD`. Si el navegador recuerda una incorrecta, prueba una ventana privada. |
| `/health` dice `woffuCredentialsConfigured: false` | Falta o está vacío `WOFFU_EMAIL` o `WOFFU_PASSWORD` en las variables del Worker. Corrige y despliega. |
| `/api/woffu/test` falla | Comprueba tus credenciales en Woffu. Si tu organización solo permite SSO o restringe este acceso, consulta a su administrador. No pases a LIVE para intentar arreglarlo. |
| La web muestra **Configurar**, **Pendiente** u **Oficina pendiente** | Elige y guarda la oficina. Si el aviso es de un año sin calendario verificado, hace falta una actualización del calendario. |
| Aparece `TEST` cuando esperaba un fichaje real | Comprueba los dos valores en `/health`: si no son `LIVE` y escritura `true`, el motor simula. |
| El botón de fichaje real rechaza el envío | Revisa `LIVE`, escritura `true`, oficina guardada y que hoy no sea fin de semana, festivo o vacaciones. |
| Veo `FAILED`, `UNKNOWN` o un envío sin confirmar | Pausa, consulta el mensaje en **Ajustes → Últimas ejecuciones** y comprueba Woffu antes de repetir. |
| GitHub está actualizado, pero mi web no | Revisa el último build en Cloudflare, su rama y repositorio. Si falla, abre su detalle; después de un éxito, recarga la web y revisa **Diagnóstico**. |

### No aparece el evento automático esperado

Comprueba, por este orden:

1. Oficina guardada, calendario disponible y automatización **Activa**.
2. Para un fichaje real: `LIVE` y escritura `true`. Para la simulación: `TEST` y `false`.
3. Día laborable sin festivo ni vacaciones; evento sin pausa ni marca manual.
4. Hora del plan actual: no basta con mirar la hora base de Ajustes. En LIVE, una marca de hace más de 10 minutos queda fuera de recuperación.
5. En Cloudflare, **Settings → Triggers → Cron Triggers** contiene `* * * * *`. Déjalo así: significa cada minuto. Si acabas de añadirlo, puede tardar hasta 15 minutos en propagarse.
6. Recarga la web para ver los registros recientes.

Si necesitas ayuda, indica **qué paso seguías, qué botón pulsaste y el texto del error**. No compartas contraseñas, secretos ni capturas donde se vean. Los detalles técnicos están en el build o en **Observability** del Worker; no tienes que entenderlos para pedir ayuda.

## 18. Preguntas frecuentes

**¿Necesito dejar el ordenador encendido o la pestaña abierta?** No. Cloudflare ejecuta la automatización en la nube.

**¿Necesito instalar Git, Node.js o un editor?** No para seguir esta guía. Las acciones se realizan en GitHub, Cloudflare y tu web.

**¿El fork incluye la cuenta Woffu de otra persona?** No. El fork copia el código. Tú configuras tus secretos en tu Worker y tus datos se guardan en tu D1.

**¿Puedo compartir mi web con un compañero para que configure su oficina?** Esta aplicación tiene una sola configuración por copia. Tu compañero debe crear su propio fork y Worker; cambiar la oficina dentro de tu web cambia la tuya.

**¿Elegir 6 horas es suficiente?** No: revisa las cuatro horas y pulsa **Guardar horario**. El descanso sigue siendo de al menos una hora.

**¿Un festivo consume un día de vacaciones?** No. Se distingue en el calendario y se excluye del objetivo semanal por separado.

**¿Guardar una marca manual ficha en Woffu?** No. Solo anota aquí una marca ya realizada y evita repetir ese evento automáticamente.

**¿Por qué veo unos minutos de más en el objetivo semanal?** El modo LIVE añade un margen de hasta 60 segundos por día laborable. El apartado 11.2 explica cómo leerlo.

**¿Borrar el fork detiene los fichajes?** No necesariamente: Cloudflare puede seguir ejecutando la versión publicada. Usa el apartado 15 para detenerla.

**¿Dónde se guardan mis datos?** Los archivos están en GitHub; horario, oficina, vacaciones y registros, en D1; las contraseñas, en los secretos de Cloudflare. El navegador puede conservar una vista temporal para cargar más rápido.

## 19. Checklist final

Marca solo el bloque que corresponda a lo que has hecho.

### Primera instalación en modo de prueba

- [ ] Mi fork pertenece a mi usuario y Cloudflare está conectado a esa copia.
- [ ] El build ha terminado bien y existe el binding `DB`.
- [ ] Puedo entrar en mi propia dirección con `admin` y `ADMIN_PASSWORD`.
- [ ] He guardado mi oficina, jornada, horario y vacaciones.
- [ ] `/health` muestra `TEST` y escritura `false`; la conexión de lectura con Woffu funciona.
- [ ] He dejado la automatización **Pausada**, salvo mientras realizo una simulación.

### Si he decidido activar fichajes reales

- [ ] He revisado las próximas marcas y anotado las que ya hice manualmente.
- [ ] `/health` muestra `LIVE` y escritura `true`; la web muestra **Activa**.
- [ ] Después del primer evento he comprobado Woffu y el resultado `SUCCESS`.
- [ ] Sé pausar la automatización y bloquear la escritura desde Cloudflare.

### Si solo he actualizado mi copia

- [ ] He usado **Sync fork → Update branch** en mi fork y he comprobado el despliegue en Cloudflare.
- [ ] Mi web muestra la versión nueva y conserva mi configuración.
- [ ] He guardado la oficina si estaba pendiente.
- [ ] He dejado la automatización pausada o activa según lo que quería.

Guía revisada el **6 de noviembre de 2026**, contrastada con el código del proyecto y los enlaces oficiales citados. Las etiquetas de los paneles externos pueden variar; no se ha repetido el alta completa con una cuenta nueva para esta revisión.
