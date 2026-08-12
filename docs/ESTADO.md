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
