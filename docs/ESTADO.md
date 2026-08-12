# Estado de la plataforma — bitácora del loop de mejora

Documento vivo. Cada iteración del loop lo actualiza: qué se midió, qué se
cambió, qué queda. Lo que está aquí está **medido**, no supuesto.

---

## Iteración 1 — 2026-08-12

### Estado medido al empezar

| Cosa | Medida |
|---|---|
| `main` | `336d6da` (30 jun 2026), sin tocar en 6 semanas |
| Tests | 67 verdes (`node:test`) |
| CI | verde, node 20 + 22, ~25 s |
| PRs | 7 abiertas históricas → **todas mergeadas**, 0 abiertas |
| Issues | 0 |
| Estrellas / forks / watchers | 1 / 0 / 0 |
| Tráfico (14 d) | 10 visitas, 6 únicos; 2 clones |
| Salud de comunidad GitHub | **42 %** — falta CONTRIBUTING, SECURITY, CoC, plantillas de issue y PR |
| Releases / CHANGELOG / homepage | ninguno |
| Distribución | solo `git clone` + `npm install` + `npm run build` (sin `npx`) |
| LOC | ~7.300 (server 2.400 · web 3.000 · CSS 850) |

### Qué se cambió — [PR #7](https://github.com/JoniMartin27/launchpad/pull/7) (mergeada)

Detección: auto-exclusión por ruta (el panel se listaba a sí mismo si la carpeta
se llamaba `launchpad`, que es justo lo que manda el README), Django/Flask/Go/
Rust/Deno/Docker Compose, gestor de paquetes por lockfile, Python con
`package.json` de tooling, CLIs sin puerto fantasma, `MISSION_CONTROL_PORT`.
67 → **77 tests**. Detalle completo en la descripción de la PR.

Verificado en vivo: escaneo del workspace real (21 carpetas, 0 warnings),
arranque y parada de `dynafeet-web` con HTTP 200 en :4009 y puerto liberado,
UI cargada sin errores de consola.

### Las 10 mejoras que quedaron para la iteración 2

1. `killTree` roto en POSIX · 2. `npx launchpad` · 3. salud de comunidad 42 % ·
4. `scanDepth` · 5. caché por mtime · 6. arranque en lote / perfiles ·
7. `portInUse` pegado tras el stop · 8. abrir en editor/terminal ·
9. releases + CHANGELOG + homepage · 10. autoreinicio y persistencia.

**Cerradas en la iteración 2:** #1, #3, #7 y la mitad de #9.

---

## Iteración 2 — 2026-08-12

### Estado medido al empezar

| Cosa | Medida |
|---|---|
| `main` | `08d9e9d` |
| Tests | 77 verdes |
| CI | verde pero **solo ubuntu** — la rama de Windows del control de procesos no se probaba nunca |
| PRs abiertas / issues | 0 / 0 |
| Estrellas / forks / watchers | 1 / 0 / 0 |
| Salud de comunidad | 42 % |
| Releases / CHANGELOG / homepage | ninguno |

### Qué se cambió

**[PR #8](https://github.com/JoniMartin27/launchpad/pull/8) — control de procesos (mejoras #1 y #7).**
El fallo de fondo: con `shell: true` el hijo directo es `/bin/sh` y el dev
server es su **nieto**. La rama POSIX de `killTree` señalaba a `-pid` para
alcanzar al grupo entero, pero `spawn` nunca pasaba `detached: true`, así que el
hijo no tenía grupo propio: el `-pid` lanzaba `ESRCH` y el `catch` mataba solo el
shell. En macOS/Linux, **Stop no paraba nada** y el puerto seguía cogido — lo
contrario exacto de lo que promete el README. Ahora el hijo encabeza su grupo,
se manda SIGTERM al grupo con ventana de gracia y se escala a SIGKILL, y el
handler de `exit` también mata el grupo (antes solo tenía rama de Windows, así
que una salida dura dejaba todos los dev servers huérfanos).

También: `portInUse` ignora las sondas anteriores al último cambio de estado
(la caché de métricas dura 60 s y la tarjeta seguía diciendo "puerto ocupado"
hasta un minuto después de parar), y **el CI pasa a `{ubuntu, windows} × node
{20,22}`**.

**[PR #9](https://github.com/JoniMartin27/launchpad/pull/9) — salud de comunidad (mejora #3 y media #9).**
CONTRIBUTING, SECURITY (con modelo de amenazas explícito, no plantilla), CoC,
plantilla de issue **"proyecto no detectado"** —el reporte que más vale en este
repo, porque la detección solo puede ser tan buena como los layouts que ha
visto—, plantilla de PR con la casilla de matar al mutante, CHANGELOG,
dependabot, y `actions/*@v5` (la v4 avisaba de deprecación en cada run).

### Estado al terminar (medido)

| Cosa | Medida |
|---|---|
| `main` | PRs #8 y #9 mergeadas |
| Tests | **81 verdes** (eran 77) |
| CI | verde en **4 jobs**: ubuntu + windows × node 20/22 |
| Salud de comunidad | **100 %** (era 42 %) |
| Homepage del repo | `https://fervon.dev` (antes vacía) |
| Verificación en vivo | `dynafeet-web` start → HTTP 200 en :4009 → stop → `portInUse:false` **inmediato** (antes tardaba ~60 s) y puerto realmente libre |
| Mutantes | los 2 tests nuevos se ponen rojos al revertir su arreglo (quitar `/T` del taskkill; volver a la sonda rancia) |

### Las 10 mejoras más potentes pendientes (orden de ataque)

1. **Distribución por `npx launchpad`.** Sigue exigiendo clonar, instalar y
   construir. Es la palanca de adopción más grande que le queda: `bin`,
   `files`, `dist` prebuild y `prepublishOnly`. Va emparejada con la release
   etiquetada (abajo), porque la versión solo significa algo si se puede instalar.
2. **`settings.scanDepth`.** Solo se escanean los hijos directos: un workspace
   `code/work/*` + `code/personal/*` enseña el panel **vacío**. Fallo silencioso
   y de primera impresión, justo para quien acaba de clonarlo.
3. **Caché de descubrimiento por mtime.** Cada rescan relee de forma síncrona
   todos los `package.json` y entrypoints Python, y el watcher lo dispara cada
   750 ms. Con 100 proyectos bloquea el bucle de eventos.
4. **Arrancar y parar en lote / perfiles.** No hay "levanta mi stack": el caso
   real (front + API + DB) son N clics y N esperas.
5. **Abrir en editor / terminal / carpeta** desde la tarjeta. El panel ya sabe
   la ruta; falta el gesto que ahorra el `cd`, que es la promesa del README.
6. **Release `v1.1.0` etiquetada** con el CHANGELOG ya escrito, más notas de
   release. Sin tag no hay nada que enlazar ni de lo que hablar.
7. **Autoreinicio al caer y persistencia entre reinicios del panel.** Si el
   panel se reinicia pierde el rastro de los procesos; si un dev server se cae
   solo, la tarjeta se queda roja sin reintento.
8. **La `stop` bloquea hasta 2 s en POSIX** esperando al SIGTERM antes de
   responder. Debería responder `202` al instante y resolver la muerte en
   segundo plano (el estado ya viaja por WebSocket).
9. **`registryTarget` tiene nombres cableados** (`lookspan`, `inferbench`) en
   `metrics.js`: para cualquier otra persona el badge de versión publicada es
   ruido o silencio. Debería leer el `name` del `package.json` y comprobar si
   está publicado, o desactivarse.
10. **Sin captura ni demo actualizadas** desde el rediseño: el GIF del README
    es de junio y no enseña ni el tema Fervon ni las tarjetas nuevas.

---

## Publicación — 2026-08-12

`npx @fervon/launchpad`. [PR #14](https://github.com/JoniMartin27/launchpad/pull/14)
(mejora #1) y [release v1.1.0](https://github.com/JoniMartin27/launchpad/releases/tag/v1.1.0).

Nombres ocupados en npm: `launchpad` (0.8.1) y `mission-control` (1.2.7). Se
publica bajo la org de la marca, que ya existía con `lookspan` de owner.

Lo que no era obvio: publicar no era quitar `private: true`. Dos valores por
defecto correctos en un checkout son absurdos instalados — escanear el padre de
la propia carpeta (sería `node_modules`) y escribir la config al lado del código
(sería la caché desechable de npx). Instalado escanea el **CWD** y guarda
`.launchpad.json` **ahí**, que además es la semántica correcta: los puertos
pertenecen al workspace, no a la instalación.

Verificado con el tarball real, no con el checkout: `npm pack` → instalar el
`.tgz` en un workspace de mentira en `%TEMP%` con tres proyectos → detecta los 3
(Go, vite+pnpm, estático), 0 warnings, escribe la config en el sitio, la UI
responde 200, arranca y para un proyecto liberando el puerto.

**Pendiente humano:** `npm publish` lo tiene que lanzar Jonathan — la cuenta
exige 2FA y el código de un solo uso es una credencial que el agente no debe
introducir. Un token de automatización en npm evitaría el corte en el futuro.

**85 tests.** Dependabot ya funciona: abrió 4 PRs ([#10](https://github.com/JoniMartin27/launchpad/pull/10)–[#13](https://github.com/JoniMartin27/launchpad/pull/13))
en su primera pasada, pendientes de revisar en la siguiente iteración.

---

## Iteración 3 — 2026-08-12

### Estado medido al empezar

| Cosa | Medida |
|---|---|
| `main` | `bf619bf` — v1.1.0 etiquetada |
| Tests | 94 verdes · CI verde en 4 jobs |
| PRs abiertas | **4**, todas de dependabot en su primera pasada |
| **Vulnerabilidades** | **2 de severidad alta** (`npm audit`) |
| Issues / estrellas / tráfico | 0 / 1 / 10 visitas, 6 únicos, 2 clones |

### Qué se cambió

**[PR #15](https://github.com/JoniMartin27/launchpad/pull/15) — dependencias.**
Los dos lotes de dependabot **chocaban entre sí** en `web/package.json`, así que
se unificaron a mano: React 19, Vite 8, TS 7, `@fastify/static` 10, fastify 5.11,
concurrently 10. Y lo que ninguno de los dos traía: `npm audit fix` → **2 altas a
0** (DoS por HTTP/2 en find-my-way, confusión de host en fast-uri; ambas de
fastify). #10 y #11 (actions) mergeadas aparte; #12 y #13 cerradas como superadas.

Aviso aprendido: **el CI no ejecuta el frontend, solo lo compila**. Un salto de
major de React pasa el listón sin despeinarse. Verificado a mano que el WS sigue
vivo: la tarjeta pasa sola a `Running · :4009` sin recargar.

**[PR #16](https://github.com/JoniMartin27/launchpad/pull/16) — subcarpetas y avisos (mejora #2).**
Un workspace `code/trabajo/*` + `code/personal/*` enseñaba el panel **vacío y sin
explicación**. Ahora `settings.scanDepth` (1-3), ids con la ruta para que dos
`api` no colisionen, y ampliación automática de la búsqueda **con la profundidad
persistida** — sin persistir, bastaba un proyecto suelto arriba para que los
anidados desaparecieran (fallo que solo salió al probarlo en vivo, y que tiene
test propio).

De paso: **`catalog.warnings` se rellenaba desde el primer día y no lo leía
nadie** — ni ruta, ni WS, ni UI. Choques de puerto, entradas de config apuntando
a carpetas que ya no existen, proyectos que desaparecen con el proceso vivo:
todo perdido en silencio. Ahora viajan por la API y se pintan en una banda.

### Estado al terminar (medido)

| Cosa | Medida |
|---|---|
| Tests | **96 verdes** (eran 94) · CI verde en 4 jobs |
| PRs abiertas / issues | 0 / 0 |
| `npm audit` | **0 vulnerabilidades** (eran 2 altas) |
| Mutantes | 3 muertos en scanDepth (sin descenso, ids sin prefijo, sin aviso) |
| En vivo | workspace anidado: 3 tarjetas, banda visible, `scanDepth:2` persistido, y los 4 conviven al añadir uno suelto · workspace real: start → HTTP 200 → stop → puerto libre |

### Las 10 mejoras más potentes pendientes (orden de ataque)

1. **`npm publish` sigue pendiente** del 2FA humano. Mientras no esté, el badge
   de npm del README apunta a un paquete que no resuelve y el `npx` del Quick
   start no funciona: hoy el README promete algo que no se puede hacer.
2. **Caché de descubrimiento por mtime.** Cada rescan relee de forma síncrona
   todos los manifiestos, y ahora además puede recorrer 3 niveles. El watcher lo
   dispara cada 750 ms.
3. **Arrancar y parar en lote / perfiles.** Levantar front+API+DB son N clics.
4. **Abrir en editor / terminal / carpeta** desde la tarjeta.
5. **Autoreinicio al caer y persistencia entre reinicios del panel.**
6. **`stop` bloquea hasta 2 s en POSIX** esperando al SIGTERM; debería devolver
   `202` al instante y resolver la muerte en segundo plano.
7. **`registryTarget` tiene nombres cableados** (`lookspan`, `inferbench`) en
   `metrics.js`: para cualquier otra persona el badge de versión es ruido.
8. **Captura y GIF del README** son de junio: no enseñan ni el tema Fervon, ni
   las tarjetas nuevas, ni la banda de avisos.
9. **El frontend no tiene ni un test.** Toda la batería es de servidor, y esta
   iteración ha demostrado el agujero: un major de React pasa el CI sin que
   nada compruebe que la aplicación arranca. Un smoke test de render bastaría.
10. **Descubrimiento y arranque no cubren Docker Compose** (detectado pero no
    lanzable, a propósito). Un `up`/`down` de verdad, con parada honesta, es la
    pieza que falta para no tener una tarjeta muerta en pantalla.

---

## Iteración 4 — 2026-08-12

### Estado medido al empezar

| Cosa | Medida |
|---|---|
| `main` | `9d371f9` · 96 tests de servidor, **0 de frontend** |
| npm | publicado por Jonathan; el registro tardó **~2 min** en propagar (el 404 inicial era caché, no un fallo) |
| CI / PRs / issues | verde en 4 jobs · 0 · 0 · 1 estrella · salud 100% |

### Qué se cerró

**Publicación (mejora #1, fuera de PR).** `@fervon/launchpad@1.1.0` verificado de
extremo a extremo desde el registro público: instala, el binario responde,
escanea el CWD, detecta (`demo-go` → go-http, `demo-web` → html5-static) y sirve
la UI. Anunciado con Pregón:
[Bluesky](https://bsky.app/profile/jonimartin.bsky.social/post/3msuxfydeu322) ·
[Mastodon](https://mastodon.social/@jonimartin/117082146495842128).

**[PR #17](https://github.com/JoniMartin27/launchpad/pull/17) — el frontend tiene tests (mejora #9).**
Siete pruebas de humo montan el `<App/>` real contra una API simulada. El arnés
aísla de verdad (`fetch` y `WebSocket` simulados): no puede arrancar, parar ni
instalar un proyecto del usuario. `npm test` corre las dos mitades, así que el
CI las cubre y `prepublishOnly` no deja publicar sin ellas.

Tropiezo aprendido: **jsdom 30 no arranca en el Node 20 del runner** (su undici
pide `webidl.util.markAsUncloneable`). Cambiado a `happy-dom`, que además es más
rápido. Lo pilló el CI, no yo.

**[PR #18](https://github.com/JoniMartin27/launchpad/pull/18) — el badge de versión (mejora #7).**
`registryTarget` tenía cableados los proyectos del autor y adivinaba
`pypi/<carpeta>` para cualquier proyecto Python: en un paquete que ya instala
gente, eso enseña **el paquete de otro**. Ahora manda el manifiesto, y si no
declara nada no hay badge. El caso que el manifiesto no puede expresar (raíz de
workspace privada con el paquete publicado dentro, que es lo que le pasa a
lookspan) se cubre con un override `registry` por proyecto.

### Estado al terminar (medido)

| Cosa | Medida |
|---|---|
| Tests | **104 de servidor + 7 de frontend** (eran 96 + 0) |
| CI | verde en 4 jobs · `npm audit` 0 |
| npm | 1.1.0 instalable y verificado · difundido |
| PRs abiertas / issues | 0 / 0 |
| Mutantes | 3 muertos (banda de avisos, carga de proyectos, tabla cableada) |

### Las 10 mejoras más potentes pendientes (orden de ataque)

1. **Caché de descubrimiento por mtime.** Cada rescan relee de forma síncrona
   todos los manifiestos y puede recorrer 3 niveles; el watcher lo dispara cada
   750 ms. Es el techo de escalabilidad que queda.
2. **Arrancar y parar en lote / perfiles.** Levantar front+API+DB son N clics y
   N esperas; es el caso de uso real de quien tiene un stack.
3. **Abrir en editor / terminal / carpeta** desde la tarjeta.
4. **Autoreinicio al caer y persistencia entre reinicios del panel.**
5. **`stop` bloquea hasta 2 s en POSIX** esperando al SIGTERM; debería devolver
   `202` al instante y resolver la muerte en segundo plano.
6. **Captura y GIF del README** son de junio: sin tema Fervon, sin las tarjetas
   nuevas, sin la banda de avisos. Es lo primero que ve quien llega desde npm.
7. **Docker Compose sigue sin lanzarse** (a propósito). Un `up`/`down` honesto
   quitaría la tarjeta muerta.
8. **La cobertura de frontend es un humo mínimo**: 7 tests sobre el render. No
   hay ninguno de interacción (pulsar Start llama al endpoint correcto, el
   drawer abre, el filtro filtra).
9. **`registryTarget` no mira los workspaces**: podría proponer el override solo
   cuando detecte una raíz privada con miembros publicables, en vez de callar.
10. **Sin telemetría de adopción**: no hay forma de saber si alguien usa el
    paquete más allá de las descargas de npm, y eso condiciona qué priorizar.

---

## Iteración 5 — 2026-08-12

### Estado medido al empezar

| Cosa | Medida |
|---|---|
| `main` | `c468e02` · 104 tests de servidor + 7 de frontend |
| npm | 1.1.0 publicado (la API de descargas aún sin datos: se publicó hoy) |
| CI / PRs / issues | verde en 4 jobs · 0 · 0 · 1 estrella · salud 100% · audit 0 |

### Qué se cambió — [PR #19](https://github.com/JoniMartin27/launchpad/pull/19) (mejora #1)

**Medido antes de tocar nada**, con un workspace sintético: 25 proyectos 48 ms,
100 → 197 ms, **300 → 780 ms** (peor caso 2,2 s) por escaneo, todo **síncrono
sobre el bucle de eventos** y disparado por el watcher 750 ms después de
cualquier cambio. En un workspace grande, guardar un fichero congelaba el
servidor entero.

Clasificación cacheada por proyecto, validada con una firma de solo `stat()`.
**Medido después: 300 → 164 ms (4,8×)**, 100 → 94 ms, 25 → 24 ms, workspace real
32 → 15 ms.

Lo importante no es el número sino que la caché no mienta: 7 tests fijan cada
forma de cambiar un proyecto, incluido **dos proyectos con firma idéntica** que
solo la ruta distingue. Tres mutantes muertos — y el de la clave **sobrevivió al
primer intento**, porque mi test de colisión no probaba nada; reescrito hasta
matarlo.

**Un byte NUL literal** se me coló en la clave de caché por un round-trip de
ediciones: funcionaba, pero `grep` pasó a tratar el fichero como binario y
habría viajado al paquete publicado. Lo pilló el repaso adversarial del diff.

### Estado al terminar (medido)

| Cosa | Medida |
|---|---|
| Tests | **111 de servidor + 7 de frontend** |
| Escaneo | 300 proyectos en 164 ms (eran 780) |
| CI / PRs / issues | verde en 4 jobs · 0 · 0 |

### Las 10 mejoras más potentes pendientes (orden de ataque)

1. **Editar un manifiesto no dispara rescan.** El watcher es deliberadamente
   superficial (vigilar dentro de cada proyecto lo inundaría de escrituras de
   `node_modules`), así que añadir un `package.json` a un proyecto existente no
   se ve hasta pulsar Rescan. Medido en vivo esta iteración. Un watcher que
   mire solo los manifiestos conocidos de cada proyecto lo arreglaría.
2. **Arrancar y parar en lote / perfiles.** Levantar front+API+DB son N clics.
3. **Abrir en editor / terminal / carpeta** desde la tarjeta.
4. **Autoreinicio al caer y persistencia entre reinicios del panel.**
5. **`stop` bloquea hasta 2 s en POSIX** esperando al SIGTERM; debería devolver
   `202` al instante y resolver la muerte en segundo plano.
6. **Captura y GIF del README** son de junio: es lo primero que ve quien llega
   desde npm, y ya no se parece al producto.
7. **Docker Compose sigue sin lanzarse** (a propósito). Un `up`/`down` honesto.
8. **Frontend: solo 7 tests de render.** Falta interacción — que pulsar Start
   llame al endpoint correcto, que el drawer abra, que el filtro filtre.
9. **El escaneo sigue siendo síncrono.** La caché baja el coste 5× pero un
   workspace enorme aún bloquea; pasarlo a `fs.promises` con concurrencia
   acotada quitaría el bloqueo del todo.
10. **Sin telemetría de adopción** más allá de las descargas de npm.

---

## Iteración 6 — 2026-08-12

### Estado medido al empezar

| Cosa | Medida |
|---|---|
| `main` | `8142645` · 111 tests de servidor + 7 de frontend |
| Novedad ajena | el CI ahora corre **Veredicto** (detector de test-gaming) en modo aviso sobre cada PR — dos commits que no vienen de este loop |
| npm | 1.1.0 · la API de descargas aún sin datos |
| CI / PRs / issues | verde · 0 · 0 · 1 estrella · salud 100% · audit 0 |

### Qué se cambió — [PR #20](https://github.com/JoniMartin27/launchpad/pull/20) (mejora #1)

Cada carpeta de proyecto se vigila ahora de forma superficial, **filtrando a los
manifiestos** que pueden cambiar la clasificación, con tope
`settings.maxProjectWatchers` (64) porque un watcher es una instancia de inotify
en Linux y el máximo del sistema son 128 para toda la máquina.

**Hallazgo del test de ruido:** en Windows el watcher de la **raíz** ya disparaba
por cualquier escritura dentro de cualquier proyecto (el sistema reporta la
carpeta padre como modificada), así que un `npm install` provocaba una tanda de
escaneos completos. Llevaba ahí desde el principio, tapado por el *debounce*.
Arreglado comparando la lista real de subcarpetas.

**Fallo de arranque que solo pilló la verificación en vivo:** el primer
`rediscover()` tocaba `fsWatcher` en su zona muerta temporal, y eso lanza
**incluso detrás de `?.`** — el servidor moría al arrancar y ningún test lo vio,
porque ninguno levanta `index.js`.

### Estado al terminar (medido)

| Cosa | Medida |
|---|---|
| Tests | **116 de servidor + 7 de frontend** |
| Mutantes | 4 muertos (sin filtro, sin comparar listado, sin tope, sin liberar) |
| Veredicto | ✅ sin señales de test-gaming en el diff |
| En vivo | crear carpeta → `html5-static`; añadir `package.json` → `vite-react`; añadir `pnpm-lock.yaml` → `pnpm dev`. Todo **sin pulsar Rescan** |

### Las 10 mejoras más potentes pendientes (orden de ataque)

1. **Arrancar y parar en lote / perfiles.** Levantar front+API+DB son N clics y
   N esperas; es el caso de uso real de quien tiene un stack.
2. **Abrir en editor / terminal / carpeta** desde la tarjeta.
3. **Autoreinicio al caer y persistencia entre reinicios del panel.**
4. **`stop` bloquea hasta 2 s en POSIX** esperando al SIGTERM; debería devolver
   `202` al instante y resolver la muerte en segundo plano.
5. **Captura y GIF del README** son de junio: es lo primero que ve quien llega
   desde npm y ya no se parece al producto.
6. **Frontend: solo 7 tests de render.** Falta interacción — que pulsar Start
   llame al endpoint correcto, que el drawer abra, que el filtro filtre.
7. **El escaneo sigue siendo síncrono**; pasarlo a `fs.promises` con
   concurrencia acotada quitaría el bloqueo del todo.
8. **Docker Compose sigue sin lanzarse** (a propósito). Un `up`/`down` honesto.
9. **Nadie ha probado el paquete de npm en macOS o Linux.** El CI corre los
   tests en Linux, pero el flujo `npx` completo solo se ha verificado en Windows.
10. **Sin telemetría de adopción** más allá de las descargas de npm.

---

## Iteración 7 — 2026-08-12

### Estado medido al empezar

| Cosa | Medida |
|---|---|
| `main` | `4c864b9` · 116 tests de servidor + 7 de frontend |
| Cambios ajenos | Veredicto en CI (it.6) y un test de `--` en binarios directos (PR #21) |
| CI / PRs / issues | verde · 0 · 0 · 1 estrella · salud 100% · audit 0 |

### Qué se cambió — [PR #22](https://github.com/JoniMartin27/launchpad/pull/22) (mejoras #1 y buena parte de #6)

`POST /api/batch/start` y `/api/batch/stop` con `{ids}` o `{profile}`, perfiles
con nombre en el config, `GET /api/profiles`, y dos botones en la barra:
**▶ Start N** (lo arrancable que se ve ahora, respetando filtros) y
**⏻ Stop all**.

El contrato es por proyecto: uno que no arranca **nunca aborta el resto**, y un
lote parcial responde **207**, no 200. El frontend deja de tener solo tests de
render: 5 nuevos **pulsan los botones y comprueban qué sale del navegador**.

**Fallo de portabilidad que solo vio el CI:** el proceso de mentira de los tests
era `node -e "setTimeout(()=>{},60000)"`; con `shell: true` las comillas se
pierden y `/bin/sh` se atraganta con los paréntesis, así que el hijo moría al
instante **solo en Linux** y el segundo arranque devolvía `started` en vez de
`already-running`. Windows se lo tragaba. Era además el origen de dos ficheros
vacíos llamados `{}` que se colaron en el repo.

### Estado al terminar (medido)

| Cosa | Medida |
|---|---|
| Tests | **125 de servidor + 12 de frontend** |
| Mutantes | 5 muertos (abortar al fallar, siempre 200, perfil fantasma, «arrancable» incluye lo que corre, «Stop all» manda todos) |
| Veredicto | ✅ limpio |
| En vivo | perfil de 2 proyectos arrancado de una vez → **:4009 y :4010 sirviendo 200**; **Stop all pulsado en el navegador** → nada arriba, ambos puertos liberados |

### Las 10 mejoras más potentes pendientes (orden de ataque)

1. **Abrir en editor / terminal / carpeta** desde la tarjeta.
2. **Autoreinicio al caer y persistencia entre reinicios del panel.**
3. **`stop` bloquea hasta 2 s en POSIX**; debería devolver `202` al instante.
4. **Captura y GIF del README** son de junio: es lo primero que ve quien llega
   desde npm y ya no se parece al producto (faltan la banda de avisos y los
   botones de lote).
5. **Publicar la 1.2.0**: hay mucho sin publicar desde la 1.1.0 (scanDepth,
   avisos, caché, watcher de manifiestos, lotes y perfiles).
6. **Los perfiles no se pueden crear desde la UI**, solo editando el config a
   mano; y no hay selector de perfil en la barra.
7. **El escaneo sigue siendo síncrono**; `fs.promises` con concurrencia acotada
   quitaría el bloqueo del todo.
8. **Docker Compose sigue sin lanzarse** (a propósito). Un `up`/`down` honesto.
9. **Nadie ha probado el paquete de npm en macOS o Linux**: un job de CI que
   empaquete e invoque el CLI cerraría el hueco.
10. **Sin telemetría de adopción** más allá de las descargas de npm.

---

## Iteración 8 — 2026-08-12

### Estado medido al empezar

| Cosa | Medida |
|---|---|
| `main` | `dc76b8b` · 125 tests de servidor + 12 de frontend |
| npm | 1.1.0 — **cinco iteraciones de mejoras sin publicar** |
| CI / PRs / issues | verde en 4 jobs + Veredicto · 0 · 0 · 1 estrella · audit 0 |

### Qué se cambió — [PR #23](https://github.com/JoniMartin27/launchpad/pull/23) (mejoras #3, #9 y #5)

**`stop` contesta 202 al instante** en vez de esperar la ventana de gracia de
POSIX; una parada en lote de cinco proyectos retenía la respuesta diez segundos
para nada, porque el resultado real viaja por WebSocket. Queda
`stop(id,{wait:true})` para `restart`.

**Humo del paquete en Linux, macOS y Windows**: se empaqueta el tarball de
verdad, se instala en un workspace desechable y se le pregunta al servidor qué
encontró. **En su primera ejecución pilló un fallo real: `npm pack` producía un
tarball SIN interfaz** (`files` incluye `web/dist` pero nada lo construía;
`prepublishOnly` cubre el publish, no el pack). Arreglado con `prepack`.

**v1.2.0** etiquetada y [publicada en GitHub](https://github.com/JoniMartin27/launchpad/releases/tag/v1.2.0).

**Mutante que sobrevivía:** el test que cronometraba `stop` pasaba en Windows
aunque se repusiera el `await`, porque ahí `taskkill` es instantáneo. El
launcher recibe ahora **el matador por inyección** para que la pregunta se pueda
responder en los dos sistemas. Y ese test colgó el runner tres minutos la
primera vez: el doble mataba el shell y dejaba huérfano al nieto, fuera del
alcance de `taskkill /T`, manteniendo abierta la salida.

### Estado al terminar (medido)

| Cosa | Medida |
|---|---|
| Tests | **129 de servidor + 12 de frontend** |
| CI | **8 checks verdes**: 4 de build/test + 3 de humo del paquete + Veredicto |
| macOS | probado por primera vez: detecta los 3 proyectos de prueba |
| En vivo | stop → **HTTP 202 en 120 ms**, puerto liberado, `portInUse:false` |
| Versión | 1.2.0 en `main` y etiquetada · **pendiente humano: `npm publish`** |

### Las 10 mejoras más potentes pendientes (orden de ataque)

1. **Publicar la 1.2.0 en npm** (`npm publish`, necesita el 2FA de Jonathan) y
   difundir con Pregón. Hasta entonces el README promete cosas que el paquete
   instalado no tiene.
2. **Abrir en editor / terminal / carpeta** desde la tarjeta.
3. **Autoreinicio al caer y persistencia entre reinicios del panel.**
4. **Captura y GIF del README** son de junio: sin banda de avisos ni botones de
   lote. Es lo primero que ve quien llega desde npm.
5. **Los perfiles no se pueden crear desde la UI**, ni hay selector en la barra.
6. **El escaneo sigue siendo síncrono**; `fs.promises` con concurrencia acotada.
7. **Docker Compose sigue sin lanzarse** (a propósito). Un `up`/`down` honesto.
8. **`restart` sigue bloqueando** hasta 8 s esperando que el puerto se libere;
   podría seguir el mismo patrón de 202 que `stop`.
9. **El humo del paquete no prueba arrancar un proyecto**, solo detectarlo:
   levantar el estático y comprobar que sirve cerraría el círculo en macOS.
10. **Sin telemetría de adopción** más allá de las descargas de npm.

---

## Iteración 9 — 2026-08-12

### Estado medido al empezar

| Cosa | Medida |
|---|---|
| `main` | `a5f93f1` · 129 tests de servidor + 12 de frontend |
| npm | **1.1.0** — la 1.2.0 etiquetada pero sin publicar (pendiente del 2FA) |
| CI / PRs / issues | 8 checks verdes · 0 · 0 · 1 estrella · audit 0 |

### Qué se cambió — [PR #24](https://github.com/JoniMartin27/launchpad/pull/24) (mejora #2)

Abrir un proyecto en **el editor, la carpeta o una terminal** desde el drawer.
El endpoint existía desde el principio y **la interfaz no lo llamaba nunca**;
además solo sabía de VS Code. Ahora el editor es `settings.editorCommand` y cada
sistema recibe su herramienta.

**Fallo de seguridad que había debajo:** la ruta usaba
`execFile(cmd, [ruta], { shell: true })`, que concatena los argumentos en una
cadena de shell **sin escaparlos** (Node lo avisa: DEP0190). Una carpeta llamada
`demo & whoami` **ejecutaba `whoami`** al abrirla, y basta clonar un repositorio
para elegir el nombre. Comprobado en local antes de tocar nada. Arreglo
estructural: `shell: false` y la ruta como argumento propio, nunca concatenada.
La decisión vive en `opener.js` como función pura, así que la matriz de tres
sistemas se prueba desde una sola máquina.

**Y lo que solo sale probando:** `explorer.exe` devuelve código 1 aunque haya
abierto la ventana, así que el panel decía «explorer no está instalado» siempre.
Ahora solo cuenta como fallo no poder **lanzar** la herramienta.

### Estado al terminar (medido)

| Cosa | Medida |
|---|---|
| Tests | **135 de servidor + 14 de frontend** |
| Mutantes | 5 muertos (volver a `shell:true`, target libre, herramienta única, target fijo en la UI, exención de explorer) |
| CI | 8 checks verdes · Veredicto limpio |
| En vivo | target inválido → 400 con la lista; `folder` → abre el explorador y `{"ok":true}`; start → 200 en :4009 → stop → puerto liberado |

### Las 10 mejoras más potentes pendientes (orden de ataque)

1. **Publicar la 1.2.0 en npm** (`npm publish`, 2FA de Jonathan) y difundir.
   Hasta entonces el paquete instalado no tiene nada de las últimas 6
   iteraciones. Ahora además habría que etiquetar una 1.3.0 con esto.
2. **Autoreinicio al caer y persistencia entre reinicios del panel.**
3. **Captura y GIF del README** son de junio: sin banda de avisos, sin botones
   de lote, sin los de abrir. Es lo primero que ve quien llega desde npm.
4. **Los perfiles no se pueden crear desde la UI**, ni hay selector en la barra.
5. **El escaneo sigue siendo síncrono**; `fs.promises` con concurrencia acotada.
6. **`restart` sigue bloqueando** hasta 8 s esperando que el puerto se libere.
7. **Docker Compose sigue sin lanzarse** (a propósito). Un `up`/`down` honesto.
8. **El humo del paquete solo prueba que detecta**, no que arranque: levantar el
   estático y comprobar que sirve cerraría el círculo en macOS.
9. **`shell: true` sigue en el launcher** para los comandos de arranque. Ahí es
   deliberado (los comandos vienen de la configuración y llevan pipes y flags),
   pero merece una nota explícita en SECURITY.md ahora que la otra vía se cerró.
10. **Sin telemetría de adopción** más allá de las descargas de npm.

---

## Iteración 10 — 2026-08-12

### Estado medido al empezar

| Cosa | Medida |
|---|---|
| `main` | `73691cd` · 135 tests de servidor + 14 de frontend |
| npm | **1.1.0** — la 1.2.0 lleva un día etiquetada sin publicar |
| CI / PRs / issues | 8 checks verdes · 0 · 0 · 1 estrella · audit 0 |

### Qué se cambió — [PR #25](https://github.com/JoniMartin27/launchpad/pull/25) (mejoras #8 y #9)

**El humo del paquete ahora arranca un proyecto de verdad.** Detectar es media
función; la otra media —arrancar, servir, parar y recuperar el puerto— **no se
había ejecutado nunca fuera de Windows**. El tree-kill de POSIX tenía tests
unitarios, pero el camino completo (shell → servidor → puerto atado → matar el
árbol) no lo había recorrido nadie en Linux ni macOS. Verificado en los tres:
`npx serve . -l 4001` sirve el contenido y el puerto vuelve tras el stop.

**La regla del shell deja de ser un comentario.** `SECURITY.md` dice dónde se
usa (el comando de arranque, que viene de la configuración y lleva `&&` y pipes)
y dónde no (cualquier valor derivado del sistema de ficheros — el fallo de la
#24), y **un test recorre `server/src` y falla si aparece un `shell: true`
nuevo**. Un comentario no habría evitado el fallo original.

**v1.3.0** etiquetada y [publicada en GitHub](https://github.com/JoniMartin27/launchpad/releases/tag/v1.3.0).

### Estado al terminar (medido)

| Cosa | Medida |
|---|---|
| Tests | **137 de servidor + 14 de frontend** |
| CI | 8 checks verdes · Veredicto limpio |
| Ciclo completo en macOS/Linux | **arranca, sirve, para y libera el puerto** (primera vez) |
| Mutantes | 2 muertos (shell en el opener, shell en la ruta) |
| Versiones | 1.2.0 y 1.3.0 etiquetadas · **npm sigue en 1.1.0** |

### Las 10 mejoras más potentes pendientes (orden de ataque)

1. **npm sigue en 1.1.0 con DOS versiones etiquetadas sin publicar.** Todo lo de
   nueve iteraciones está solo en GitHub. Es el cuello de botella del proyecto.
2. **Autoreinicio al caer y persistencia entre reinicios del panel.**
3. **Captura y GIF del README** son de junio: sin banda de avisos, sin botones
   de lote, sin los de abrir. Es lo primero que ve quien llega desde npm.
4. **Los perfiles no se pueden crear desde la UI**, ni hay selector en la barra.
5. **El escaneo sigue siendo síncrono**; `fs.promises` con concurrencia acotada.
6. **`restart` sigue bloqueando** hasta 8 s esperando que el puerto se libere.
7. **Docker Compose sigue sin lanzarse** (a propósito). Un `up`/`down` honesto.
8. **El drawer no ofrece «abrir» para subproyectos**, solo para el proyecto
   raíz; y la tarjeta no tiene ninguno de los tres gestos (hay que abrir el
   drawer).
9. **`installState` asume npm/uv**: un proyecto Go o Rust sin dependencias
   instaladas no ofrece nada equivalente a Install.
10. **Sin telemetría de adopción** más allá de las descargas de npm.

---

## Iteración 11 — 2026-08-12

### Estado medido al empezar

| Cosa | Medida |
|---|---|
| `main` | `1eb7edb` · 137 tests de servidor + 14 de frontend |
| npm | **1.1.0** — 1.2.0 y 1.3.0 etiquetadas, ninguna publicada |
| CI / PRs / issues | 8 checks verdes · 0 · 0 · 1 estrella · audit 0 |

### Qué se cambió — [PR #26](https://github.com/JoniMartin27/launchpad/pull/26) (mitad grande de la mejora #2)

**Adopción de procesos huérfanos.** Un apagado ordenado mata a los hijos; el
feo (administrador de tareas, `kill -9`, cuelgue) no — y en POSIX menos, porque
se lanzan con `detached`. El siguiente arranque no sabía nada de ellos: tarjeta
en «parado», Start contestando `PORT_IN_USE`, y **ningún botón para parar algo
que el panel no sabía que era suyo**. Ahora cada arranque se anota y al arrancar
se adopta lo que siga vivo.

**La condición es doble a propósito:** estar vivo no basta, porque los pids se
reciclan; hace falta que **siga atado el puerto registrado**. Los proyectos sin
puerto no se adoptan nunca — no hay prueba posible de identidad, y olvidarlos es
más honesto que reclamarlos y arriesgarse a matar el proceso de un tercero.

Consecuencias atendidas: un adoptado no tiene evento de salida, así que `stop`
confirma él mismo la muerte; y sus logs no existen, así que el panel lo explica
en vez de parecer vacío.

### Estado al terminar (medido)

| Cosa | Medida |
|---|---|
| Tests | **146 de servidor + 14 de frontend** |
| Mutantes | 4 muertos (adoptar solo por pid vivo, adoptar sin puerto, fichero corrupto que revienta, sin validar entradas) |
| CI | 8 checks verdes · Veredicto limpio |
| En vivo | huérfano real en :4009 → `adopted … from a previous run` → Stop desde la API → **puerto liberado** y estado a cero |

**Nota de proceso:** los huérfanos de la simulación colgaron la suite (10 min de
timeout) hasta que los maté. Limpiar los procesos simulados antes de correr los
tests.

### Las 10 mejoras más potentes pendientes (orden de ataque)

1. **npm sigue en 1.1.0 con dos versiones etiquetadas sin publicar.** Once
   iteraciones viven solo en GitHub.
2. **Autoreinicio al caer** (la otra mitad de la #2): si un dev server se muere
   solo, la tarjeta se queda roja sin reintento. Opt-in por proyecto y con
   tope de intentos, que reiniciar en bucle algo que revienta es peor.
3. **Captura y GIF del README** son de junio: sin banda de avisos, sin botones
   de lote, sin los de abrir.
4. **Los perfiles no se pueden crear desde la UI**, ni hay selector en la barra.
5. **El escaneo sigue siendo síncrono**; `fs.promises` con concurrencia acotada.
6. **`restart` sigue bloqueando** hasta 8 s esperando que el puerto se libere.
7. **Docker Compose sigue sin lanzarse** (a propósito). Un `up`/`down` honesto.
8. **La tarjeta no ofrece abrir en editor/terminal/carpeta**: hay que abrir el
   drawer. Y los subproyectos no lo ofrecen en absoluto.
9. **`installState` asume npm/uv**: Go o Rust sin dependencias no ofrecen nada.
10. **Sin telemetría de adopción** más allá de las descargas de npm.

---

## Iteración 12 — 2026-08-12

### Estado medido al empezar

| Cosa | Medida |
|---|---|
| `main` | `0e2636e` · 146 tests de servidor + 14 de frontend |
| npm | **1.1.0** — 1.2.0 y 1.3.0 etiquetadas sin publicar |
| CI / PRs / issues | 8 checks verdes · 0 · 0 · 1 estrella · audit 0 |

### Qué se cambió — [PR #27](https://github.com/JoniMartin27/launchpad/pull/27) (otra mitad de la #2)

**Autoreinicio al caer**, opt-in por proyecto. La política vive aparte como
función pura y es deliberadamente tímida: solo tras salida distinta de cero,
nunca tras un stop tuyo ni tras un arranque que no llegó a levantar, con tope de
intentos y espera creciente, y perdonando el contador si el proyecto aguantó un
minuto en pie.

**El test en vivo encontró un fallo real de la implementación:** `setRuntime`
reemplaza el registro entero al arrancar, así que **el contador de intentos se
perdía** y el tope no se alcanzaba nunca — había implementado justo el bucle
infinito que la política existe para evitar. Ahora se arrastra explícitamente y
un arranque manual lo resetea.

**Segundo hallazgo:** con la ventana de arranque cableada a 2,5 s, toda caída de
un proyecto sin puerto llegaba en estado `starting`, la rama que no se reinicia.
Ahora es `settings.portlessGraceMs`.

### Estado al terminar (medido)

| Cosa | Medida |
|---|---|
| Tests | **157 de servidor + 14 de frontend** |
| Mutantes | 5 muertos (sin tope, reiniciar salida limpia, ignorar opt-in, ignorar stop, contador perdido) |
| CI | 8 checks verdes · Veredicto limpio |
| En vivo | servidor que muere a los 6 s → **4 arranques** (original + 3 reintentos = el tope) → se rinde, puerto libre, y 10 s después sigue parado |

### Las 10 mejoras más potentes pendientes (orden de ataque)

1. **npm sigue en 1.1.0 con dos versiones etiquetadas sin publicar.** Doce
   iteraciones viven solo en GitHub.
2. **El autoreinicio no se puede activar desde la UI**, solo editando el config;
   y la tarjeta no dice que un proyecto lo tenga puesto.
3. **Captura y GIF del README** son de junio: sin banda de avisos, sin botones
   de lote, sin los de abrir.
4. **Los perfiles no se pueden crear desde la UI**, ni hay selector en la barra.
5. **El escaneo sigue siendo síncrono**; `fs.promises` con concurrencia acotada.
6. **`restart` sigue bloqueando** hasta 8 s esperando que el puerto se libere.
7. **Docker Compose sigue sin lanzarse** (a propósito). Un `up`/`down` honesto.
8. **La tarjeta no ofrece abrir en editor/terminal/carpeta**: hay que abrir el
   drawer, y los subproyectos no lo ofrecen en absoluto.
9. **`installState` asume npm/uv**: Go o Rust sin dependencias no ofrecen nada.
10. **Sin telemetría de adopción** más allá de las descargas de npm.

---

## Iteración 13 — 2026-08-13

### Estado medido al empezar

| Cosa | Medida |
|---|---|
| `main` | `0c5cacd` · 157 tests de servidor + 14 de frontend |
| npm | **1.1.0** — 1.2.0 y 1.3.0 etiquetadas sin publicar |
| CI / PRs / issues | 8 checks verdes · 0 · 0 · 1 estrella · audit 0 |

### Qué se cambió — [PR #28](https://github.com/JoniMartin27/launchpad/pull/28) (mejora #2, la parte de interfaz)

El autoreinicio de la iteración anterior funcionaba pero **solo se podía activar
editando un JSON a mano**, así que en la práctica no existía. Y es una opción
que cambia lo que un proyecto hace *sin ti*: no tiene por qué estar escondida.

Ahora hay un interruptor en el panel de detalle (con la letra pequeña al lado) y
una marca en la tarjeta cuando está armado. Solo se ofrece en proyectos
lanzables — una casilla que no hace nada sería peor que ninguna. Tras el cambio
se recarga el proyecto **con la respuesta del servidor**, que es quien acaba de
validar, guardar y re-descubrir.

### Estado al terminar (medido)

| Cosa | Medida |
|---|---|
| Tests | **157 de servidor + 18 de frontend** (eran 14) |
| Mutantes | 3 muertos (marcar todas las tarjetas, que apagar mande `true`, ofrecerlo en no lanzables) |
| CI | 8 checks verdes · Veredicto limpio |
| En vivo | marca solo en el proyecto armado · **interruptor pulsado en el navegador** → se desmarca, desaparece la marca y el fichero pasa a `autoRestart:false` · start → 200 → stop → puerto libre |

**Nota de proceso:** tras el merge la suite dio 2 fallos en `main`. No era una
regresión: eran **mis propios procesos de simulación** vivos (la trampa (h) que
yo mismo documenté). Matados, 157 + 18 en verde. Conviene comprobar los procesos
sueltos *antes* de creerse un rojo.

### Las 10 mejoras más potentes pendientes (orden de ataque)

1. **npm sigue en 1.1.0 con dos versiones etiquetadas sin publicar.** Trece
   iteraciones viven solo en GitHub.
2. **Captura y GIF del README** son de junio: sin banda de avisos, sin botones
   de lote, sin los de abrir, sin la marca de autoreinicio.
3. **Los perfiles no se pueden crear desde la UI**, ni hay selector en la barra.
4. **El escaneo sigue siendo síncrono**; `fs.promises` con concurrencia acotada.
5. **`restart` sigue bloqueando** hasta 8 s esperando que el puerto se libere.
6. **Docker Compose sigue sin lanzarse** (a propósito). Un `up`/`down` honesto.
7. **La tarjeta no ofrece abrir en editor/terminal/carpeta**: hay que abrir el
   drawer, y los subproyectos no lo ofrecen en absoluto.
8. **`installState` asume npm/uv**: Go o Rust sin dependencias no ofrecen nada.
9. **Los avisos de autoreinicio no se ven en la UI**: viajan como `warning` por
   WebSocket pero la banda solo pinta avisos de descubrimiento, así que
   «reintentando en 2 s» y «me rindo» se pierden.
10. **Sin telemetría de adopción** más allá de las descargas de npm.
