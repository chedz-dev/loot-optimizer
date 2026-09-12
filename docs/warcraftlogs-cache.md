# Base JSON local de Warcraft Logs

Revisión: 2026-09-07. Implementación: `server/warcraftlogs-service.js`, `server/warcraftlogs-store.js` y `server/warcraftlogs-routes.js`. Contexto: [arquitectura](architecture.md) y [decisiones de diseño](design-decisions.md).

## Lectura y actualización separadas

Todos los GET de `/api/warcraftlogs` son locales. No llaman a Warcraft Logs, no renuevan OAuth y no escriben JSON. Una captura ausente responde `CACHE_MISS`; un catálogo ausente responde `CATALOG_REQUIRED`. Una captura caducada sigue visible con su fecha. La UI no ejecuta descargas en segundo plano al navegar.

La vigencia es de **una hora por contexto y spec**. Actualizar omite capturas vigentes por defecto. El usuario puede limitarse a ausentes, o forzar la actualización. Forzar solo ignora la antigüedad: no omite límites de cuota, bloqueos ni pausas por errores.

El catálogo también se actualiza explícitamente. Tener un catálogo antiguo no impide consultar datos ni lo vuelve a descargar al arrancar. Después de un cambio de temporada conviene actualizarlo antes de planificar nuevas capturas.

## Archivos

- `catalog.json`: zonas, encuentros, dificultades, particiones y slugs de specs.
- `<sha256>.json`: muestra por zona, encuentro, dificultad, partición, spec y métrica. Contiene contexto, fechas, filas originales `rawRankings`, metadatos de paginación `sourcePages`, equipo completo que devolvió WCL, cohorte, trinkets agregados y señales `usage-rate`.
- `manifest.json`: índice reconstruible de cobertura. Las capturas son la fuente de verdad; el estado público se verifica contra ellas.
- `state.json`: trabajos y tareas, progreso, errores sanitizados, pausas por captura/proveedor y contador de consultas GraphQL lógicas.
- `.bak`: respaldo JSON legible anterior. Los lectores pueden recuperarlo si el primario está corrupto.
- `.sync.lock`: escritor exclusivo con PID, identidad y heartbeat. Servidor y CLI comparten este bloqueo. Un proceso vivo no pierde el bloqueo simplemente por superar el tiempo nominal. Un PID confirmado muerto permite recuperación.

No se guardan tokens ni credenciales. Toda esta carpeta está excluida de Git y del build estático. Las referencias a jugadores y logs permanecen locales, no se exponen en las respuestas de navegación. No se conserva información que WCL no haya devuelto: perfiles privados, equipo ausente o campos no incluidos en la consulta no se pueden reconstruir.

Las capturas antiguas sin `rawRankings` se conservan. El panel distingue cuántas pueden recalcularse sin red y cuántas necesitan una próxima descarga para incorporar el original. Recalcular actualiza `processedAt`, pero conserva `fetchedAt` y la caducidad de la observación.

## Temporada de los trinkets

Cada spec de la comparación por item ofrece «Ver top en Warcraft Logs», también disponible en la cabecera de la vista por spec. Abre una pestaña nueva usando `sourceUrl` de la captura: conserva zona, boss/mazmorra, dificultad, partición, slugs originales de clase/spec y métrica. No reconstruye el enlace con nombres traducidos ni consulta la API para generarlo.

El filtro se aplica a las dos vistas: spec hacia trinkets e item hacia specs. Por defecto muestra la temporada actual, y recuerda la selección entre `current`, `past`, `all` y `unknown`. Si el item guardado queda fuera del filtro, la vista usa el primer item permitido sin sobrescribir la preferencia guardada ni mostrar la comparación anterior.

La clasificación se calcula por ID en `server/item-seasons.js`, al leer la captura. `GET /catalog` publica `currentItemSeason`; los detalles de cada item incluyen `seasonClassification` con `status`, `seasonId`, `label`, `basis`, `sourceUrl` y `referenceSeasonId`.

1. El catálogo activo de `server/trinkets-s2.js` confirma los trinkets actuales de raid y M+, incluidos los IDs antiguos que regresan en la rotación.
2. `data/item-season-classification.json` mantiene evidencia adicional por item, con fuente, motivo y fecha de revisión. Permite confirmar tanto temporadas anteriores como items renovados de crafting, delves, renombre o PvP.
3. Si no hay evidencia suficiente, el estado es `unknown`. Estar ausente del catálogo de rankings, tener un ID antiguo o un nivel de objeto bajo no demuestra que pertenezca a una temporada anterior.

La temporada describe la disponibilidad del item en el catálogo estacional, no la versión equipada por cada personaje ni todos los lugares donde todavía se puede obtener. Un mismo ID puede tener versiones de temporadas diferentes. El filtro no determina el track ni la temporada de cada copia a partir de sus bonus IDs. Los items sin confirmar quedan fuera de «Actual», pero se pueden consultar en «Sin clasificar» o «Todos».

El filtro de React (`src/item-season-filter.js`) solo cambia la visibilidad. No elimina observaciones, no renormaliza porcentajes y no cambia el denominador de personajes con equipo válido. Las respuestas locales conservan todos los items para permitir cambiar de filtro sin recapturar. Un cambio de selección puede consultar otra comparación en la API local, pero no llama a Warcraft Logs.

El selector de items se ordena por uso total descendente en las capturas del contexto elegido. `GET /items` suma `count` de cada item entre las specs con equipo válido y publica `validCharacters` como denominador común, junto con `popularity = count / validCharacters * 100`. No promedia porcentajes de muestras de distinto tamaño ni incluye otros encuentros. Son observaciones por spec, no personajes únicos deduplicados entre specs. Los empates se resuelven por nombre y luego ID. Temporada y búsqueda conservan este orden; el item guardado no se cambia solo porque otro tenga más uso.

Para corregir una clasificación, verificar la disponibilidad estacional en una fuente original, actualizar el catálogo o el registro de evidencia, ejecutar las pruebas y reiniciar Node. Las capturas existentes reciben la corrección al leerse: no necesitan descarga ni reconstrucción. Un cambio de temporada requiere revisar ambos catálogos y `currentSeason`; no basta con cambiar la etiqueta S2 por S3. Este registro no se actualiza automáticamente desde el catálogo de zonas de WCL.

## Procedencia de los items

El selector, las filas por spec y los detalles de comparación muestran una sola categoría de adquisición: Raid, Mythic+, Delves, Lair, World, Crafting o PvP. Si no está confirmada, muestran origen desconocido. `drop.sourceType` tiene prioridad sobre la categoría amplia: Nymrissa se presenta como Lair aunque su filtro general siga agrupado con raid. El encuentro donde WCL observó el uso se identifica aparte, no como lugar de drop.

La información viene de `server/item-origins.js`: catálogo de rankings, overrides existentes y `data/item-origin-overrides.json`, que conserva fuente y motivo por corrección. Las procedencias verificadas prevalecen sobre etiquetas antiguas de las capturas. No se deduce el origen a partir del contexto WCL, de la temporada ni de que una guía recomiende el item en raid o M+. Conocer el origen tampoco confirma automáticamente la temporada.

El selector muestra la mazmorra para M+ y el boss, cuando se conoce, para raid/Lair; los detalles incluyen instancia y boss sin duplicarlos. Para otras categorías se muestra la ubicación o profesión confirmada. Las correcciones se aplican al leer los JSON, sin recapturar WCL ni modificar sus muestras.

## Alcances y consumo

| Alcance | Capturas objetivo |
| --- | --- |
| `spec` | Una spec del encuentro/dificultad/partición elegidos |
| `context` | Las 40 specs del mismo contexto |
| `zone` | Las 40 specs de todos los encuentros de la zona, manteniendo dificultad y partición elegidas |
| `cached` | Solo las combinaciones que ya tienen una captura guardada |
| `all` | Todas las zonas activas, encuentros y dificultades, usando la partición predeterminada de cada zona |

El plan se calcula sin API y muestra el **mínimo** de consultas GraphQL: una por captura que necesita descarga. Puede aumentar por paginación. No incluye solicitudes OAuth ni reintentos de transporte/autenticación. El contador empieza con esta versión, no reconstruye consumo histórico. Una consulta puede fallar antes de llegar al proveedor, por lo que no equivale a su facturación o cuota. El presupuesto real del proveedor se conserva por separado cuando la respuesta incluye `rateLimitData`.

Solo hay un escritor y como máximo tres consultas simultáneas por trabajo. Las cuotas/autenticación detienen nuevas tareas; tres fallos sistémicos consecutivos también detienen nuevas tareas. Las peticiones ya en vuelo pueden terminar. Cada captura fallida tiene espera exponencial de 1 minuto hasta 1 hora, persistente entre reinicios. Los GET nunca reintentan esos fallos.

El cliente expone el plazo de `Retry-After`, tanto en segundos como en fecha HTTP, y el servicio persiste el mayor entre ese plazo, una pausa de cinco minutos y cualquier pausa de proveedor más larga ya registrada. Los errores de autenticación tienen una pausa mínima de un minuto. Si una escritura/checkpoint falla, se detiene el despacho y se espera a que se resuelvan todos los workers antes de liberar el lease; un fallo temprano no habilita otro escritor mientras el primero siga trabajando.

## API local

Prefijo: `/api/warcraftlogs`. Respuestas JSON con `Cache-Control: no-store`. El router requiere cliente loopback y valida `Origin` loopback cuando viene presente. No es una API pública autenticada.

| Método y ruta | Comportamiento |
| --- | --- |
| `GET /catalog` | Catálogo guardado, `configured`, `cacheAvailable`, `readPolicy`, defaults y vigencia. Sin catálogo devuelve estructura vacía, no lo descarga. |
| `POST /catalog/refresh` | Descarga explícita del catálogo si caducó; body opcional `{ "force": true }` ignora solo su edad. HTTP 200. |
| `GET /cache` | Cobertura, conteo de capturas vigentes/caducadas/originales/legacy, contextos, último job, job activo, consumo lógico, pausa y tamaño de almacenamiento. |
| `GET /popularity` | Trinkets de una spec guardada: contexto + `classId` y `specId`. |
| `GET /items` | Unión de items observados en las capturas del contexto, sin descargar specs faltantes. |
| `GET /item` | Specs con muestras válidas para `itemId` y contexto. Una muestra válida sin ese item aporta 0%; una spec sin muestra no. |
| `GET /sync/plan` | Objetivos y mínimo de consultas según `scope`, `mode` y selección. No escribe ni consulta la API. |
| `POST /sync` | Body con opciones del plan. Inicia job persistente y devuelve HTTP 202. |
| `GET /sync?id=...` | Estado del job; sin ID devuelve el último o `null`. |
| `POST /sync/:id/resume` | Reanuda tareas pendientes/fallidas; HTTP 202. También existe `POST /sync/resume` con body `{ "id": "ID_DEL_TRABAJO" }`. |
| `POST /rebuild` | Job offline sobre capturas existentes con originales, sin credenciales ni API; HTTP 202. |

Selección de contexto: `zoneId`, `encounterId`, `difficulty`, `partition`. Los omitidos se resuelven contra el catálogo local, no contra constantes de una temporada. Los IDs de clase/spec son los slugs internos de la aplicación, por ejemplo `mage` / `arcane`, no IDs numéricos de WCL. `itemId` es el ID numérico de WoW. La métrica se decide por contenido/rol: raid DPS o HPS para healers; M+ `playerscore`.

Modos de actualización: `stale` por defecto, `missing` solo ausentes y `force` incluye vigentes. El UI ofrece renovación normal y forzada; el modo `missing` está disponible en API/CLI.

Campos del plan: `total`, `willFetch`, `fresh`, `stale`, `missing`, `minimumApiQueries`, `catalogRefreshRequired`, `scope`, `mode`. Sin catálogo, los alcances que lo necesitan indican `catalogRefreshRequired=true` con conteos cero; eso no confirma que haya cero datos posibles. `cached` y `rebuild` pueden operar desde capturas existentes aunque no haya catálogo.

Campos públicos del job: `id`, `kind` (`sync` o `rebuild`), `scope`, `mode`, `status`, `completed`, `total`, `fetched`, `skipped`, `rebuilt`, `errors`, `apiQueries`, fechas y `resumable`. Se añade `context` cuando solo hay uno. `completed` cuenta tareas procesadas, incluidas las fallidas; no equivale a descargas exitosas. Las tareas y el dueño interno del lease no se envían a la UI.

Estados: `running`, `complete`, `failed`, `interrupted`. La lectura deriva `interrupted` si el job decía estar en curso pero ya no tiene un lease activo correspondiente; consultar ese estado no reinicia trabajo. Reanudar requiere otro POST y respeta pausas persistidas. No hay scheduler WCL, cancelación pública ni reanudación automática al arrancar Node. Se conservan los diez jobs completos más recientes y los no completos.

| Código | Interpretación |
| --- | --- |
| `CACHE_MISS` (404) | Falta la captura solicitada; inicializarla con una actualización explícita. |
| `CATALOG_REQUIRED` (409) | La operación necesita inicializar el catálogo local. |
| `SYNC_RUNNING` (409) | Otro escritor posee el lease; no lanzar un segundo proceso para eludirlo. |
| `RETRY_COOLDOWN`, `API_BACKOFF`, `RATE_LIMITED` | Pausa de captura/proveedor/cuota. En tareas aparecen dentro de `job.errors`; el POST que inició el job pudo responder 202. |
| `CREDENTIALS_REQUIRED`, `AUTH_FAILED` | Configuración/autorización de backend, no un problema del JSON disponible. |
| `INVALID_RESPONSE`, `SPEC_MISMATCH`, `GEAR_UNAVAILABLE` | La captura recibida no se puede aceptar; se conserva la anterior. |
| `STORAGE_ERROR` | Falló el almacenamiento; revisar disco/permisos antes de otra actualización. |

`getCacheStatus`, `getSyncPlan` y demás métodos de la factoría pueden utilizarse por CLI. `waitForJob(id)` espera una promesa del servicio en ese proceso; los otros procesos consultan el estado persistente, no comparten esa promesa.

## Comandos

```powershell
# Diagnóstico y planificación: cero consultas externas
pnpm cache:wcl:status
node scripts/sync-warcraftlogs.js --plan --scope=cached
node scripts/sync-warcraftlogs.js --plan --scope=spec --classId=mage --specId=arcane

# Primera inicialización o renovación explícita del catálogo
node scripts/sync-warcraftlogs.js --catalog

# Renovar únicamente los JSON existentes que ya caducaron
node scripts/sync-warcraftlogs.js --scope=cached

# Capturar solo una spec, omitiendo un JSON todavía vigente
node scripts/sync-warcraftlogs.js --scope=spec --classId=mage --specId=arcane --zoneId=53 --encounterId=3470 --difficulty=5 --partition=1

# Variantes: --mode=missing o --mode=force
# Reanudar pendientes/fallidos sin repetir tareas ya completadas
node scripts/sync-warcraftlogs.js --resume=ID_DEL_TRABAJO

# Reprocesar originales locales sin API, sin rejuvenecer su fecha
pnpm cache:wcl:rebuild
```

Sin `--scope`, la actualización conserva la opción de las 40 specs del contexto predeterminado. No se descarga toda la temporada automáticamente. Antes de `--scope=all`, revisar `--plan --scope=all`: puede implicar cientos o miles de consultas. Las particiones no predeterminadas se capturan explícitamente con `spec`, `context` o `zone`.

## Recuperación y límites

Cada JSON se escribe primero en un temporal con `fsync` y luego se publica mediante renombrado. Las capturas se guardan antes de marcar la tarea como terminada. El progreso sobrevive al cierre de Node; las tareas no finalizadas se ofrecen para reanudar. En el pequeño intervalo entre guardar una captura y guardar su progreso, una reanudación normal reconoce su vigencia y evita repetir la descarga; una reanudación forzada puede volver a descargar esa captura. Un fallo antes de guardar una respuesta siempre puede requerir repetir esa consulta.

Un fallo de API, formato, spec incorrecta o ausencia total de equipo interpretable no reemplaza la captura anterior. El respaldo protege frente a una escritura fallida/corrupción aislada; no sustituye un respaldo externo frente a pérdida de disco. La base JSON está diseñada para un servidor local y sus herramientas CLI, no para escritores distribuidos en varias máquinas o almacenamiento sincronizado simultáneamente por varios equipos.
