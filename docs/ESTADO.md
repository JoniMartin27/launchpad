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

### Las 10 mejoras más potentes pendientes (orden de ataque)

1. **`killTree` está roto en POSIX.** `process.kill(-pid)` sin `detached: true`
   en el `spawn`: no hay grupo de procesos, así que en macOS/Linux se mata el
   shell y los nietos (el dev server de verdad) quedan huérfanos reteniendo el
   puerto. Es *el* bloqueante para que el repo sirva fuera de Windows.
2. **Distribución por `npx launchpad`.** Hoy hay que clonar, instalar y
   construir. Publicar el paquete con `bin` + `dist` prebuild es la palanca de
   adopción más grande que le queda (claudescope ya va por ahí).
3. **Salud de comunidad 42 % → 100 %.** CONTRIBUTING.md, SECURITY.md,
   CODE_OF_CONDUCT.md, plantillas de issue (con una específica de "proyecto no
   detectado", que es el reporte más útil que puede llegar) y de PR.
4. **Escaneo a profundidad configurable.** Solo se miran los hijos directos: un
   workspace `code/work/*` + `code/personal/*` muestra el panel **vacío** —
   fallo silencioso y de primera impresión. `settings.scanDepth` (por defecto 1).
5. **Caché de descubrimiento por mtime.** Cada rescan relee de forma síncrona
   todos los `package.json` y ficheros de entrada Python; el watcher lo dispara
   con 750 ms de debounce. Con 100 proyectos bloquea el bucle de eventos.
6. **Arrancar y parar en lote / perfiles.** No hay "levanta mi stack": el caso
   real (front + API + DB) exige N clics y N esperas. Un `profiles` en config
   con arranque en orden y parada en bloque.
7. **`portInUse` se queda pegado tras el stop** hasta que caduca la caché de
   métricas (60 s): la tarjeta dice "puerto ocupado" cuando ya está libre.
   Invalidar la sonda al cambiar de estado.
8. **Abrir en editor / terminal / carpeta.** El panel ya sabe la ruta de cada
   proyecto; falta el gesto que ahorra el `cd`, que es literalmente la promesa
   del README.
9. **Releases + CHANGELOG + `homepage`.** Sin `v1.0.0` etiquetada no hay nada
   que enlazar ni de lo que hablar, y la ficha del repo no apunta a fervon.dev.
10. **Reinicio automático al caer y persistencia de lo que estaba corriendo.**
    Si el panel se reinicia, pierde el rastro de los procesos; si un dev server
    se cae solo, la tarjeta se queda en rojo sin reintento.
