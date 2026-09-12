# Loot Council Optimizer

Aplicación React y Node.js para comparar trinkets por clase y especialización usando señales normalizadas de Wowhead e Icy Veins, y consultar popularidad de Warcraft Logs en la versión local.

## Documentación técnica

Revisión de diseño y arquitectura: 2026-09-07, contrastada con el código local. No implica que estos cambios estén desplegados en GitHub Pages.

- [Arquitectura, flujos, modelo de datos y operación](docs/architecture.md).
- [Decisiones de diseño, invariantes y extensión a nuevas fuentes](docs/design-decisions.md).
- [Metodología del ranking y límites estadísticos](docs/ranking-methodology.md).
- [Base JSON de Warcraft Logs: API, actualización y recuperación](docs/warcraftlogs-cache.md).

## Modelo de datos

La fuente de verdad editorial es `data/editorial-data.json`. Warcraft Logs utiliza una base separada en `data/warcraftlogs/`, con un JSON por muestra y archivos de control. No se requiere SQLite ni otro gestor de base de datos. `public/data` es una salida regenerable para el build estático, no la base de captura.

El documento conserva:

- catálogo canónico de items y procedencia;
- último snapshot válido de cada guía;
- señales normalizadas por item, clase, spec, contenido y fuente;
- metadata de caché y versión del esquema.

Los snapshots se actualizan de forma atómica. Si un parser falla, se conserva el último snapshot válido para esa guía.

## Motor de ranking

Las fuentes editoriales activas son Wowhead e Icy Veins con peso configurado de 50% cada una. Los tiers se normalizan a una escala de producto de 0 a 100. El motor renormaliza los pesos entre fuentes observadas: una recomendación S en una sola guía sigue siendo S, con cobertura de 50% y la otra fuente como `NR`, sin imputarle una valoración negativa. Una spec sin recomendación inequívoca no aparece. El consenso D, F o G conserva su tier.

El motor distingue cobertura, desacuerdo y sensibilidad al retirar una fuente. Los tiers contradictorios de una misma fuente se muestran como evidencia ambigua hasta identificar su variante. Las señales duplicadas no aumentan su peso. El registro deja preparados Bloodmallet, Maxroll, Method.gg y Liquid Armory. Warcraft Logs está integrado como popularidad local, separado del tier editorial. Las decisiones, límites y referencias están en [la metodología del ranking](docs/ranking-methodology.md).

## Ejecutar localmente

Entorno recomendado y utilizado en CI: Node.js 24 y pnpm 10. `package.json` declara Node.js >=22.5.

```powershell
pnpm install
pnpm dev
```

Cliente: `http://localhost:5173`  
API local: `http://localhost:3001`

Para servir el frontend compilado y la API desde `http://localhost:3001`, sin reinicios automáticos durante una revisión:

```powershell
node node_modules/vite/bin/vite.js build
node server/index.js
```

Mantener el proceso Node abierto. Un build de Vite no levanta el servidor. Tras recompilar sin HMR, recargar la pestaña. Ver [diagnóstico de conexión](docs/architecture.md#operación-local-y-diagnóstico).

Actualizar las fuentes y regenerar las vistas estáticas:

```powershell
pnpm sync:data
pnpm build
```

## Archivos estáticos

`scripts/generate-static-data.js` genera en `public/data`:

- catálogo;
- tierlists de Wowhead e Icy Veins;
- ranking precalculado para cada trinket;
- manifest con versión del esquema y rutas de los archivos públicos.

React usa la API local normalmente. Con `VITE_STATIC_DATA=true` consume esos archivos directamente, sin Express.

Los JSON públicos excluyen puntuaciones internas, pesos, diagnósticos de ranking, estado de credenciales y snapshots. No se exportan demo, roster ni caché WCL. Se conservan tiers, orden, notas, procedencia, autor y actualización editorial. `node scripts/check-static-build.js` valida el artefacto antes de publicarlo.

## GitHub Pages

El workflow `.github/workflows/deploy-pages.yml` está configurado para ejecutarse al hacer push a `main`, manualmente o por cron `17 * * * *`. Ejecuta `pnpm sync:data`, genera los JSON editoriales, compila Vite y publica `dist`. El cron es una programación del workflow, no una garantía de actualización exacta ni un refresco del navegador.

En el repositorio de GitHub se debe seleccionar `Settings > Pages > Source > GitHub Actions`.

El workflow configura automáticamente:

- `VITE_STATIC_DATA=true`;
- `VITE_SHOW_TECHNICAL_METADATA=false`;
- la ruta base `/<nombre-del-repositorio>/`;
- caché de dependencias pnpm mediante `setup-node`, no de la base editorial.

Actualmente no hay un paso para restaurar/guardar `editorial-data.json` entre ejecuciones de CI. Se parte del archivo versionado en el checkout y la sincronización modifica la copia de trabajo del runner. El workflow no hace commit de esas capturas. Warcraft Logs no se sincroniza ni se publica en este build; una futura integración con CI requeriría un diseño adicional y secretos del entorno, nunca credenciales en JSON públicos.

## Warcraft Logs local

Las credenciales reales van exclusivamente en `.env`, que está ignorado por Git. `.env.example` es una plantilla con campos vacíos. El servidor obtiene un token OAuth de la API oficial y lo conserva solamente en memoria. React no recibe las credenciales ni el token. `pnpm check:secrets` revisa la plantilla, los archivos versionados, los cambios preparados y los assets públicos antes y después del build.

El módulo Warcraft Logs aparece solo en la versión local. Permite seleccionar zona activa, boss o dungeon, dificultad, partición y spec. Descubre los IDs y slugs en la API y usa los primeros 100 puestos del ranking mundial por encuentro. Para raid usa DPS en daño/tanks y HPS en healers; para Mythic+ usa `playerscore`. Es una medición de uso, no una estimación de mejora de DPS ni una recomendación BiS.

Popularidad = personajes que equipan el trinket / personajes del top con ambos slots de trinket válidos. Se eliminan personajes duplicados y se informa del equipo ausente. No se reemplazan los registros sin equipo por puestos inferiores al 100. Los dos slots se cuentan individualmente, por lo que los porcentajes de todos los items pueden sumar 200%. Se combinan niveles de objeto del mismo ID y se muestra su nivel medio.

La base JSON se guarda bajo `data/warcraftlogs/`, ignorada por Git. Navegar, filtrar o abrir una spec consulta exclusivamente los JSON, incluso si están caducados o no hay credenciales. La vigencia de una hora solo decide qué capturas omite una actualización explícita; no activa descargas automáticas. El panel Base JSON local muestra cobertura, antigüedad y un plan de consultas antes de actualizar. Conserva el top 100 original completo recibido de WCL y sus resultados derivados, con escrituras atómicas, respaldo, bloqueo entre procesos y trabajos reanudables. Las capturas anteriores a este cambio siguen siendo consultables, pero necesitan una actualización explícita para incorporar los datos originales. Consulta [operación de la base WCL](docs/warcraftlogs-cache.md) para los comandos y límites.

Las dos vistas WCL filtran por temporada: actual por defecto, anteriores, todos o sin clasificar. La selección se recuerda. Se consulta el catálogo activo y un registro JSON de evidencia, sin deducir la temporada por la antigüedad del ID ni por el nivel de objeto. Los trinkets antiguos que regresan pueden seguir siendo actuales; los casos sin confirmar quedan separados. Filtrar no cambia porcentajes ni borra capturas. Véase [clasificación de temporada](docs/warcraftlogs-cache.md#temporada-de-los-trinkets).

Las señales siguen el contrato común (`source`, `itemId`, clase, spec, contexto, muestra, fecha), con tipo `usage-rate`. Se mantienen separadas del peso editorial por defecto; la frecuencia de uso no demuestra que un item sea óptimo. El build estático no publica las capturas de Warcraft Logs.

Referencias: [API Warcraft Logs](https://www.warcraftlogs.com/api/docs), [consultas de rankings por encuentro](https://www.warcraftlogs.com/v2-api-docs/warcraft/encounter.doc.html), [rankings y parses](https://www.warcraftlogs.com/help/ranks/), [metodología de Archon](https://www.archon.gg/wow/articles/help/archon-disclaimers-and-faq). Archon usa una muestra distinta; esta aplicación identifica explícitamente su top 100 por encuentro.
