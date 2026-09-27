# Arquitectura de Loot Council Optimizer

Revisión: 2026-09-07. Estado descrito: implementación del workspace local, no confirmación de despliegue. Documento de entrada para mantener o extender la aplicación.

Documentos relacionados: [decisiones de diseño](design-decisions.md), [ranking](ranking-methodology.md), [operación WCL](warcraftlogs-cache.md), [deploy y contrato público](deployment.md).

## Alcance y límites del producto

La aplicación responde a dos preguntas distintas:

1. Rankings: seleccionado un trinket, qué clases/specs lo recomiendan según Wowhead, Icy Veins o su consenso editorial.
2. Warcraft Logs, solo local: qué trinkets utiliza el top 100 de una spec en un contexto, o qué specs de las ya capturadas utilizan un trinket.

Las tierlists originales reconstruyen tier, orden y comentarios de cada guía para poder contrastar el resultado. No son una simulación propia. Optimización de asignaciones, roster e historial permanecen deshabilitados en la navegación; existen código y endpoints de demostración, pero no constituyen un sistema completo de loot council.

## Topología y modos de ejecución

```text
Wowhead / Icy Veins
  -> parsers + localización -> data/editorial-data.json
       -> API editorial + motor de ranking -> React local
       -> generate-static-data.js -> public/data -> dist -> GitHub Pages

Warcraft Logs API
  -> OAuth/GraphQL, solo actualización explícita
  -> validación + agregación -> data/warcraftlogs/*.json
       -> API de lectura local -> módulo React Warcraft Logs
       -> recálculo offline desde rawRankings
```

No existe todavía una conexión operativa entre los JSON de WCL y el score editorial de `/api/rankings/item`. El contrato `usage-rate` está preparado, pero no se inyecta ni se pondera automáticamente.

| Aspecto | Local con Node.js | Estático, baked |
| --- | --- | --- |
| Interfaz | React 18 y Vite | El mismo frontend compilado |
| Datos | Express y JSON locales | `public/data` copiado a `dist/data` |
| Transporte frontend | `dataFetch` llama `/api/...` | `dataFetch` traduce rutas soportadas a archivos JSON |
| Ranking | Se calcula por item desde señales locales | Precalculado al generar archivos, no al abrir la página |
| WCL | Módulo visible; lectura, planificación, actualización y recálculo | Módulo y exportación WCL excluidos |
| Información técnica | Visible por defecto | Siempre oculta, independientemente de la bandera técnica |
| Autor y actualización de la guía | Visibles, con fallback si falta el dato | Visibles; son atribución editorial, no información técnica del caché |
| Renovación | Guías con caché; WCL explícito | Requiere generar y publicar otro build |
| Credenciales | Solo backend local | No debe contener credenciales |

`VITE_STATIC_DATA=true` selecciona el modo baked y fuerza la ocultación de administración y métricas técnicas. `VITE_SHOW_TECHNICAL_METADATA=false` también permite ocultarlas en local. `VITE_BASE_PATH` configura la ruta de Pages. Las banderas se fijan al compilar, no mediante un menú en ejecución.

La exportación a `public/data` siempre aplica proyecciones públicas, también al generar desde local: los rankings conservan tiers y orden, identidad de specs, tiers originales por fuente y advertencias de ambigüedad, sin scores, cobertura, pesos ni diagnósticos. No se exportan `demo.json` ni `sources.json`. La aplicación estática no consulta esas rutas y restringe las vistas persistidas a Rankings, Wowhead e Icy Veins. `check-static-build.js` comprueba los JSON y archivos del artefacto antes del deploy; no basta con ocultar componentes en CSS.

El modo estático no equivale a funcionamiento totalmente sin Internet: iconos, enlaces y tooltips pueden consultar recursos externos de Wowhead. No ejecuta Express ni utiliza su OAuth.

`GuideMetadata` presenta `author` y `pageUpdatedAt` en ambas tierlists y modos. La exportación pública conserva estos campos, pero elimina IDs/fechas del snapshot; nunca se sustituye la actualización editorial por `fetchedAt`. El día se muestra según el calendario publicado, sin desplazarlo por la zona horaria del navegador. El parser Wowhead extrae los metadatos de la página identificada, y muestra un fallback explícito si no puede identificarlos. El 2026-09-07 se completaron esos dos campos en las 40 guías Wowhead existentes tras comparar el hash de su tierlist con la fuente; tiers, señales y fechas de captura se conservaron.

## Responsabilidades por componente

| Componente | Responsabilidad |
| --- | --- |
| `src/App.jsx` | Navegación, modos de build y montaje de módulos |
| `src/data-client.js`, `src/build-mode.js` | Adaptación API/archivos y visibilidad técnica |
| `src/modules/SpecRankings.jsx`, `src/ranking-source-view.js` | Selección de item, unificado/WH/IV, lista/tierlist, filtros y presentación de evidencia |
| `src/modules/WowheadTierlists.jsx`, `src/modules/IcyVeinsTierlists.jsx` | Reconstrucciones editoriales por clase/spec |
| `src/modules/WarcraftLogsPopularity.jsx` | Popularidad en ambas direcciones y administración del caché local |
| `server/spec-catalog.js`, `server/guide-catalog.js` | Identificadores internos y URLs de las guías; catálogo actual de 40 specs |
| `server/wowhead-tierlists.js`, `server/icyveins-tierlists.js` | Captura HTTP, reconocimiento del bloque de trinkets, validación y sincronización |
| `server/editorial-store.js` | JSON editorial, snapshots vigentes, items, señales y lotes |
| `server/item-origins.js`, `server/trinkets-s2.js` | Procedencia canónica, detalles de drop, temporada y catálogo de trinkets de rankings |
| `data/item-origin-overrides.json` | Correcciones verificadas de procedencia compartidas, con fuente y motivo |
| `server/wowhead-localization.js` | Nombres ES obtenidos por ID, guardados junto al nombre EN |
| `server/ranking-engine.js` | Registro real de proveedores, normalización, consenso y diagnósticos |
| `server/rankings-data.js` | Catálogo y composición de respuestas de rankings; también conserva rutas demo |
| `server/warcraftlogs-client.js` | OAuth en memoria, GraphQL, timeouts y errores sanitizados |
| `server/warcraftlogs-data.js` | Extracción de slots, agregado de uso, enriquecimiento y señales |
| `server/item-seasons.js`, `data/item-season-classification.json` | Disponibilidad estacional por item ID, catálogo activo y evidencia explícita; desconocido si falta confirmación |
| `src/item-season-filter.js` | Filtro persistente de temporada en las dos vistas WCL, sin alterar muestras ni porcentajes |
| `server/warcraftlogs-store.js` | Lectura/escritura JSON, respaldo y exclusión de escritores |
| `server/warcraftlogs-service.js` | Catálogo, consultas locales, planificación, trabajos, TTL y pausas persistentes |
| `server/warcraftlogs-popularity.js` | Fachada de exports para compatibilidad, no un segundo motor |
| `server/warcraftlogs-routes.js` | API WCL y restricción de acceso local |
| `scripts/generate-static-data.js` | Proyecciones públicas editoriales y rankings baked |

`server/sources.js` contiene estado informativo e integración de personaje Raider.IO. Sus etiquetas heredadas no determinan qué fuentes participan del ranking. La autoridad para pesos y habilitación es el registro de `ranking-engine.js`.

El wrapper `queryWarcraftLogs` de `sources.js` llama al cliente directamente y no implementa la política de caché; no es la ruta del módulo actual. Nuevas consultas funcionales deben pasar por `warcraftlogs-service.js` y no abrir un acceso paralelo que eluda planificación, cuota o exclusión de escritores.

## Modelo de datos y autoridades

### Base editorial

`data/editorial-data.json`, esquema 1, contiene `generatedAt`, `cacheHours`, `snapshotSequence`, `sources`, `items`, `guides`, `signals` y `batches`.

- `items`: identidad por `itemId`, nombres localizados, icono, URL, calidad y procedencia.
- `guides[source]`: última captura válida de cada guía, con clase/spec, URL, fecha, hash del bloque parseado, tiers, orden y notas. El contador `snapshotId` identifica una revisión; no significa que se archive todo el historial de revisiones.
- `signals`: evidencia normalizada por fuente, item, clase/spec y contexto editorial.
- `batches`: descripción de lotes y su alcance para sustituir recomendaciones previas.

`itemId` numérico identifica el item de WoW. El catálogo de rankings también tiene un `id` interno de producto utilizado en rutas y nombres de archivos baked; no se deben intercambiar ambos IDs.

Separar tres conceptos es obligatorio:

| Campo/concepto | Significado |
| --- | --- |
| `source` | Proveedor de evidencia: `wowhead`, `icyveins`, `warcraftlogs`, etc. |
| `originTypes`, `drop`, `season` | Procedencia del loot: raid, dungeon, crafting, delves; instancia, boss, temporada |
| `signalContentTypes` y `signal.contentType` | Contexto para el que una guía recomienda el item; no dónde se obtiene |

Las vistas de guías resuelven detalles y procedencia con `item-origins.js` y el catálogo compartido. Sus `contentTypes` sirven a la presentación y no deben reutilizarse ciegamente como contexto de evidencia. Una recomendación útil en raid y M+ no implica dos fuentes de drop. La correspondencia de procedencia sigue requiriendo datos canónicos y validación, no es un descubrimiento universal automático.

### Contrato común de señales

| Grupo | Campos |
| --- | --- |
| Identidad | `source`, `snapshotKey`, `itemId`, `classId`, `specId` |
| Contexto | `contentType`, `metadata` con dimensiones específicas de la fuente |
| Valor | `signalType`, `textValue`, `numericValue` |
| Evidencia | `sampleSize`, `confidence`, `fetchedAt`; `entryKey` en persistencia editorial |

Las guías emiten `editorial-tier` con una letra en `textValue`. WCL emite `usage-rate` con porcentaje en `numericValue`, denominador en `sampleSize` y numerador en `metadata.count`. Compartir campos no hace comparables sus significados ni activa su combinación.

La versión del esquema es un número en los documentos, no un motor general de migraciones ni una validación JSON Schema exhaustiva. `saveRankingSignals` es un punto de entrada genérico con comprobaciones básicas; reemplaza señales por fuente y clase/spec del alcance recibido, no solo por `contentType`. `isComplete` queda registrado, pero no impide esa sustitución si se envía un lote parcial. Un futuro adaptador con varios bosses o variantes debe diseñar explícitamente esa granularidad antes de usarlo.

`rankItemFromSignals` presupone que ya se filtraron señales de un solo item. `getRankingSignalsForItem` realiza ese filtro en el flujo actual; no enviar toda la base al motor esperando que deduzca el item.

### Base WCL

La identidad de una muestra es el hash SHA-256 de `schemaVersion:zoneId:encounterId:difficulty:partition:spec.id:metric:targetSampleSize`. Se conserva la clave de la primera implementación para leer las capturas existentes. No se mezclan dificultades ni encuentros.

El snapshot conserva `context`, `spec`, `metric`, `targetSampleSize`, `rankingRows`, `sampledCharacters`, `validCharacters`, `missingGear`, `invalidIdentity`, `duplicateCharacters`, `items`, `cohort`, `signals`, `sourceUrl`, `fetchedAt` y `expiresAt`. Las capturas nuevas añaden `rawRankings`, `sourcePages`, `processedAt` y `processingVersion`.

`rawRankings` guarda las primeras 100 posiciones recibidas, con los campos que WCL devuelva, no toda la respuesta de todas las páginas ni información privada que WCL no haya expuesto. Se guardan metadatos de página por separado. No se hacen consultas suplementarias por personaje para completar equipo ausente.

La respuesta de navegación omite `cohort`, `signals`, `rawRankings` y `sourcePages`; entrega los agregados y su antigüedad. Reenriquece nombres/procedencia usando el catálogo local actual. Los lectores vuelven a consultar archivos para observar escrituras del CLI sin reiniciar el servicio.

La descripción completa de `catalog.json`, `manifest.json`, `state.json`, respaldos y trabajos está en [Base WCL](warcraftlogs-cache.md).

## Flujos de captura y lectura

### Guías editoriales

Las dos fuentes comparten un TTL de una hora, pero tienen parsers diferentes. Wowhead identifica su bloque de tierlist y notas; Icy Veins identifica la tabla de trinkets y contempla listas, descripciones y elementos expandibles. Una captura no reconocida se rechaza, no se convierte en una lista vacía válida.

`getWowheadTierlists` y `getIcyVeinsTierlists` esperan la carga inicial si faltan guías. Si ya hay cobertura y solo hay guías caducadas, pueden devolver la base anterior e iniciar una renovación en segundo plano. `waitForRefresh` permite esperar. `/api/rankings/item` también invoca ambas lecturas antes de obtener las señales.

Cada fuente comparte una promesa de sincronización dentro del proceso y descarga hasta tres guías simultáneamente por defecto. La localización de items es una fase adicional con su propia concurrencia, no está incluida en ese límite de tres. Las capturas parseadas correctamente se guardan por lote; los errores de otras guías no las borran.

El almacén editorial mantiene un documento en memoria y lo publica mediante archivo temporal y rename. No tiene el lease entre procesos, `fsync` y recuperación `.bak` del almacén WCL. No ejecutar simultáneamente un CLI editorial y un servidor que pueda escribir esa misma base. Tras una actualización editorial externa, reiniciar el proceso que ya la tenía cargada.

### Warcraft Logs

Todos sus GET son lectura local, incluso con caché caducado o credenciales ausentes. El catálogo debe inicializarse explícitamente. Planificar no descarga datos. La actualización explícita compara el TTL y omite vigentes salvo modo `force`.

Se utiliza un escritor exclusivo para catálogo, sync, reanudación y recálculo. Un trabajo procesa como máximo tres solicitudes simultáneas. Cada captura se valida y guarda antes de confirmar su tarea. Los trabajos sobreviven al reinicio y la reanudación evita repetir tareas terminadas.

El lector de equipo exige el array verificado de 18 slots, con trinkets en índices 12 y 13. Descarta identidad no verificable, duplicados y equipo inválido; no rellena esos huecos con posiciones superiores a 100. La popularidad usa personajes con ambos trinkets válidos como denominador. La suma de uso de todos los items puede alcanzar 200% porque cada personaje equipa dos.

## API y contratos públicos

| Ruta | Uso real |
| --- | --- |
| `GET /api/health` | Vida del servidor, no cobertura ni acceso a proveedores |
| `GET /api/rankings/catalog` | Clases y catálogo activo de trinkets |
| `GET /api/rankings/item?item=ID_INTERNO&content=raid` | Ranking editorial de specs para un item; puede disparar refresco editorial |
| `GET /api/wowhead/tierlists`, `GET /api/icyveins/tierlists` | Reconstrucciones de guías, con política editorial de caché |
| `GET /api/editorial-data/status` | Cobertura y estado del JSON editorial |
| `/api/warcraftlogs/*` | Lecturas locales y POSTs explícitos descritos en la [referencia WCL](warcraftlogs-cache.md#api-local) |
| `GET /api/demo`, `GET /api/rankings`, `POST /api/optimize` | Datos o cálculos heredados/demo; no confundir con el ranking editorial de la UI |
| `GET /api/sources`, `GET /api/raiderio/character` | Estado informativo y consulta puntual de personaje, no señales automáticas del score |

## Interfaz y continuidad visual

Rankings, Wowhead e Icy Veins se mantienen montados y se ocultan con `hidden` al cambiar de módulo. WCL se monta en la primera visita y recibe `active` para controlar sus lecturas y polling de progreso. Se evita desmontar y reconstruir toda la pantalla en cada cambio; eso no garantiza que no haya estados de carga cuando cambian los datos.

`usePersistentState` guarda selecciones bajo claves `loot-*` en `localStorage`; idioma, fuente de ranking, item, filtros y contexto WCL se conservan según las claves de cada módulo. No es persistencia multiusuario ni sincronización entre navegadores. La vista tierlist es el valor inicial del ranking, salvo una preferencia guardada.

El filtro Raid/M+ de Rankings selecciona procedencia de items. El contexto de recomendación solicitado se deduce de la categoría del item elegido; la UI todavía no ofrece un selector independiente de escenario raid/M+ para el mismo item.

Las cards editoriales comparten `EditorialItemCard`: descripción dentro del recuadro, expansión si supera 125 caracteres o hay datos de drop, y procedencia junto a la etiqueta. Solo el icono abre el item en Wowhead en otra pestaña; el cuerpo expande detalles cuando corresponde. Los iconos de spec ofrecen enlaces a ambas guías. Los nombres de items usan `localizedNames`; notas del autor, nombres de bosses y specs no se traducen automáticamente por esa selección.

## Publicación estática y seguridad

`generate-static-data.js` lee la base editorial, no consulta WCL y no descarga guías por sí mismo. Produce catálogo, ambas tierlists, un ranking público por item del catálogo y manifest. No produce `sources.json` ni `demo.json`. `data-client.js` soporta las rutas de lectura de catálogo, tierlists y ranking por item, y rechaza escrituras o rutas sin exportación. No basta con añadir un endpoint Node para que exista en Pages. El contrato de campos, banderas, límites de seguridad y procedimiento operativo se mantiene en [la guía de deploy](deployment.md), revisada el 2026-09-11.

El workflow `deploy-pages.yml` separa `prepare-data`, `build` y `deploy`. `prepare-data` valida una base del caché compatible o del repositorio; solo intenta sincronizar en cron o con `refresh_data`. La sincronización escribe una copia aislada y se descarta completa si falla o resulta incoherente. `build` consume el artefacto seleccionado con `EDITORIAL_DATA_PATH`, sin acceso a guías, y solo promueve el respaldo tras pasar tests y controles estáticos. Si no existe una base válida, se bloquea el proceso. La antigüedad y los fallos se registran en Actions, no en la web. Ver [deploy](deployment.md) para caché, primera ejecución y límites. Existe `vercel.json` y un adaptador `api/index.js`, pero la configuración presente no valida persistencia WCL ni trabajos largos en serverless: no es el objetivo operativo de esta revisión.

Las credenciales WCL se cargan desde `.env` en backend; `.env.example` permanece vacío. `.env`, variantes privadas y `data/warcraftlogs/` se ignoran; `.env.example` y `.env.github` son excepciones expresas y deben permanecer sin secretos. No usar variables `VITE_*` para credenciales, pues se destinan al cliente.

El router WCL exige conexión loopback y, si hay `Origin`, origen HTTP(S) loopback. Envía `Cache-Control: no-store` para evitar respuestas HTTP obsoletas; esto no desactiva la base JSON. No hay autenticación multiusuario ni autorización por rol. El servidor Express general no queda limitado a localhost por este middleware: solo las rutas WCL llevan esa restricción. No exponerlo mediante túneles o proxies como si fuera una frontera de seguridad para Internet.

`scripts/check-secrets.js` comprueba la plantilla, credenciales locales conocidas contra archivos versionados, cambios staged y assets públicos. Está declarado en prebuild/postbuild del paquete; verificar que el gestor ejecuta esos hooks y usar el comando explícito durante la revisión. Ejecutar Vite directamente no ejecuta esos hooks. La comprobación no es un escáner universal de secretos ni una auditoría completa del historial Git.

## Operación local y diagnóstico

Para desarrollo con HMR: `pnpm dev` levanta Node con watch y Vite; abrir el frontend en `http://localhost:5173`, con proxy de `/api` a 3001. Para revisión estable en 3001: compilar con `node node_modules/vite/bin/vite.js build` y ejecutar `node server/index.js` en una terminal que permanezca abierta. No ejecutar dos servidores sobre el mismo puerto.

Si todas las pestañas muestran `Failed to fetch`:

1. Comprobar `Invoke-RestMethod http://localhost:3001/api/health` y `Get-NetTCPConnection -LocalPort 3001 -State Listen`.
2. Si no hay listener, leer el error de inicio y levantar `node server/index.js`. Si el puerto está ocupado, identificar el proceso; no matar procesos a ciegas.
3. Si health responde, revisar la petición fallida: URL, status, modo de build, proxy y respuesta. Un 404 `CACHE_MISS` de WCL no es una caída del servidor.
4. Recargar el navegador tras un nuevo build sin HMR y comprobar los cuatro módulos habilitados. Un build terminado no prueba que Node continúe ejecutándose.

La incidencia local del 2026-09-07 fue un servidor que dejó de escuchar en 3001; reiniciarlo y recargar recuperó las vistas. No se estableció aquí una causa raíz más precisa de su detención. No borrar ni regenerar la base para resolver una caída de transporte.

## Validación y evolución

`node --test` cubre parsers, procedencia, normalización, ranking, UI de fuente, cliente WCL, rutas, persistencia, concurrencia, reanudación, TTL y recálculo offline. `node scripts/check-secrets.js` y `git diff --check` completan la revisión local. Los tests usan fixtures y clientes simulados; no son una auditoría visual permanente de las guías vivas.

No ejecutar una sincronización global solo para comprobar documentación o un cambio de UI. Para nuevas fuentes, seguir [los contratos y decisiones](design-decisions.md#integrar-una-nueva-fuente) y añadir regresiones antes de habilitar su peso o exportación pública.
