# Deploy de la edición estática

Contrato de publicación y guía operativa. Revisado contra el código local el 2026-09-27. Los cambios documentados requieren commit/push autorizado para entrar en vigor en GitHub; este documento no confirma un deploy.

Destino configurado: [GitHub Pages](https://chedz-dev.github.io/loot-optimizer/). Workflow: [deploy-pages.yml](../.github/workflows/deploy-pages.yml). Este documento describe cómo publicar; modificarlo o ejecutar un build no autoriza por sí mismo un commit, push o deploy.

## Regla principal

La edición pública permite consultar recomendaciones. La administración y las métricas internas permanecen en local. Esto se aplica en dos capas: componentes que no se renderizan y archivos JSON que no contienen los campos técnicos. Ocultar una sección con CSS no protege los datos descargados.

Warcraft Logs publica un baked de popularidad por spec e item, con fecha y cobertura visibles. Las capturas originales, los datos individuales, las credenciales y la administración del caché permanecen en local. Pages no consulta la API de WCL.

## Qué pasa a Pages

| Información o función | Edición estática | Local con Node.js |
| --- | --- | --- |
| Rankings por item: Unificado, Wowhead e Icy Veins | Sí; tiers precalculados, vistas lista/tierlist y filtros | Sí; respuesta calculada por la API |
| Tierlists de las guías WH/IV | Sí; tiers, orden y notas originales | Sí |
| Autor y actualización editorial | Sí, siempre; fallback explícito si falta información | Sí |
| Nombres ES/EN, iconos, tooltips y enlaces externos | Sí | Sí |
| Procedencia, temporada disponible y detalles de drop | Sí, según los datos de cada item | Sí |
| Tiers de cada fuente y avisos de ambigüedad | Sí; explican la recomendación o su ausencia | Sí |
| Cantidad de items/specs y distribución por tier | Sí; son ayudas de navegación, no métricas del motor | Sí |
| Score numérico, pesos configurados/efectivos y cobertura ponderada | No | Disponibles en API; pesos y cobertura en la UI por defecto |
| Diagnósticos del ranking y panel de evidencia técnica | No | Diagnósticos en API y evidencia resumida en la UI por defecto |
| IDs/fechas de snapshot, hashes, caducidad y contadores del parser | No | Disponibles en API; snapshot y contadores visibles en WH/IV por defecto |
| Etiqueta «Actualización cada 1 h» y explicación técnica del parser IV | No | Visibles por defecto |
| Estado/configuración de conexiones y credenciales | No | Backend y administración local según el módulo |
| Warcraft Logs: popularidad agregada, tamaño de muestra y enlaces al top por spec | Sí, con fecha de captura y solo contextos exportados | Sí |
| Warcraft Logs: capturas individuales y actualización del caché | No | Sí |
| Optimización, roster e historial | Botones deshabilitados; sin datos demo exportados | Botones deshabilitados; existen endpoints de demostración |
| Idioma y selecciones recordadas | Sí, en el almacenamiento del navegador para ese origen | Sí, independientes de Pages |

No confundir `pageUpdatedAt`, fecha editorial de la guía, con `fetchedAt`, fecha de captura local. No sustituir una por otra. Las notas originales no se traducen automáticamente al cambiar ES/EN.

## Artefacto público y archivos excluidos

Solo se carga `dist` como artefacto de Pages. El árbol de datos esperado es:

```text
dist/
  index.html
  assets/                        React, estilos y recursos compilados
  data/
    catalog.json                 Clases/specs y catálogo de trinkets
    tierlists/wowhead.json        Guías públicas Wowhead
    tierlists/icyveins.json       Guías públicas Icy Veins
    rankings/<item-id>.json       Un resultado público por item del catálogo
    warcraftlogs.json             Popularidad agregada y contextos disponibles
    manifest.json                schemaVersion y lista de rutas
```

El manifest no contiene fecha de captura, cobertura, estado de la base ni tamaños. El número de rankings depende del catálogo vigente; no añadir una cantidad fija al contrato.

No se exportan `demo.json`, `sources.json`, `data/editorial-data.json`, `data/warcraftlogs/`, `.env`, tokens, filas crudas de jugadores, archivos SQLite ni un servidor Express. `public/data` es una salida regenerable: corregir la base o el código fuente, no editar a mano el resultado generado.

### Pages no es lo mismo que el repositorio Git

`server/`, `docs/`, scripts y `data/editorial-data.json` están versionados y pueden ser visibles en el repositorio, aunque no formen parte del sitio publicado. «Solo local» describe dónde se ejecuta la función o se conserva su información privada, no una promesa de ocultar el código fuente.

`.env`, variantes privadas, `data/warcraftlogs/`, `dist/` y `.local-build-check/` están ignorados por Git. Las excepciones versionadas `.env.example` y `.env.github` deben permanecer sin credenciales. `.gitignore` no elimina archivos ya versionados ni borra el historial.

Todo archivo colocado en `public/` puede acabar en `dist/`. No depositar ahí copias de seguridad, diagnósticos ni exportaciones privadas. El generador no limpia automáticamente archivos sobrantes; el validador del artefacto rechaza archivos inesperados bajo `data/`. Revisar el destino exacto antes de retirar un sobrante, sin borrar la base canónica.

## Dónde se define la separación

### Renovar el baked WCL

Después de actualizar la base local, ejecutar `pnpm bake:warcraftlogs` y revisar `public/data/warcraftlogs.json`. La exportación es explícita y no consume API. Conserva las fechas reales, valida conteos y permite solo campos públicos; si falla, no reemplaza el baked anterior. Revisar cobertura y antigüedad antes de incluirlo en el commit. El build habitual valida ese archivo, lo añade al manifest y lo copia a `dist`; no necesita `data/warcraftlogs/` ni credenciales. El cron editorial no actualiza WCL.

Para VA/Lair S2 usar `pnpm sync:wcl:release --plan` y luego `pnpm sync:wcl:release`. La lista aprobada de `data/warcraftlogs-release.json` incluye ocho bosses de VA y Nymrissa, con heroico y mítico. Kith'ix está excluido. La exportación y `check-static-build.js` exigen las 720 capturas objetivo antes de publicar; pueden contener menos de 100 parses si WCL no ofrece una muestra completa. Una entrada nueva del catálogo no se incorpora automáticamente al alcance.

WCL publica porcentajes, conteos y denominadores porque son el resultado que consulta el usuario, no métricas administrativas. `capturedAt` identifica la antigüedad de esos resultados; no sustituye la fecha editorial de WH/IV. Los datos individuales, diagnósticos de descarte, cuota de API, trabajos y caducidad del caché no se exportan.

| Archivo | Responsabilidad |
| --- | --- |
| [src/build-mode.js](../src/build-mode.js) | `VITE_STATIC_DATA=true` fuerza `showTechnicalMetadata=false`, incluso si se configura la bandera técnica en `true` |
| [src/App.jsx](../src/App.jsx) | Admite Rankings, Wowhead, Icy Veins y WCL en static; no carga demo/estado de fuentes |
| [src/data-client.js](../src/data-client.js) | Traduce las lecturas editoriales a JSON; las cuatro lecturas WCL usan un único baked compartido. Rechaza escrituras y rutas administrativas |
| [scripts/bake-warcraftlogs.js](../scripts/bake-warcraftlogs.js) | Exportación local explícita de agregados WCL, sin consultas a la API |
| [src/warcraftlogs-static.js](../src/warcraftlogs-static.js) | Lista de campos permitidos y consultas por spec/item sobre el baked |
| [scripts/generate-static-data.js](../scripts/generate-static-data.js) | Lee la base editorial y calcula las vistas públicas. No descarga guías ni consulta la API WCL |
| [scripts/static-projections.js](../scripts/static-projections.js) | Selecciona campos públicos del ranking y elimina diagnósticos de captura de las guías |
| [scripts/editorial-release.js](../scripts/editorial-release.js) y [prepare-editorial-release.js](../scripts/prepare-editorial-release.js) | Validan base y señales, seleccionan respaldo/candidata y registran antigüedad sin modificar las capturas originales |
| [src/modules/SpecRankings.jsx](../src/modules/SpecRankings.jsx) | Oculta pesos, cobertura, panel del motor y detalles técnicos; conserva tiers, avisos e interpretación para el lector |
| [GuideMetadata](../src/components/GuideMetadata.jsx) y módulos WH/IV | Mantienen autor/fecha; ocultan auditoría y frecuencia del caché en static |
| [scripts/check-static-build.js](../scripts/check-static-build.js) | Comprueba archivos y campos del artefacto antes de publicarlo |

La exportación de `public/data` siempre es pública, incluso si se genera durante un build local. La versión Node obtiene sus detalles técnicos de la API, no de esos archivos.

### Campos que necesita Rankings

`publicRankings` conserva `item`, `content`, `rankings` y `metadata`. Cada entrada permite identidad de clase/spec, `role`, `stat`, `tier`, `sourceTiers` y `sourceScores`. A pesar de su nombre, el `sourceScores` público solo contiene `source`, `name`, `status`, `rawValue` y `rawValues`: no contiene un score numérico ni pesos. La metadata conserva nombres/IDs de fuentes y avisos de ambigüedad.

La proyección no recalcula tiers ni reordena entradas. Las pruebas comparan todos los items en Unificado, Wowhead e Icy Veins antes y después de exportar.

Límite importante: la lista permitida se aplica a las entradas y metadata del ranking. El objeto `item` se conserva, y `publicGuide` elimina una lista concreta de campos técnicos, no aplica una lista exhaustiva de todos los campos públicos posibles. Al ampliar esos modelos hay que revisar explícitamente los campos nuevos y sus objetos anidados.

## Banderas y tipos de build

| Configuración | Resultado |
| --- | --- |
| Build normal sin `VITE_STATIC_DATA=true` | Frontend para la API Node; no asumir que sirve para Pages |
| `VITE_STATIC_DATA=true` | Lectura de JSON editorial y WCL agregado, sin administración pública |
| `VITE_SHOW_TECHNICAL_METADATA=false` | Oculta el detalle técnico editorial/de ranking también en un frontend local; no convierte el backend en público ni elimina sus rutas |
| `VITE_BASE_PATH=/loot-optimizer/` o `--base /loot-optimizer/` | Rutas correctas de assets y datos para este repositorio en Pages |
| `--mode github` | Vite carga [.env.github](../.env.github), con static activado y detalle técnico desactivado |

Son opciones de compilación, no permisos de usuario ni interruptores del navegador. No utilizar variables `VITE_*` para secretos. Revisar variables heredadas del proceso y overrides locales antes de construir: no asumir que el archivo de modo es la única configuración efectiva.

## Flujo de GitHub Actions

El workflow se dispara con push a `main`, ejecución manual o programación `17 * * * *`. El push y la ejecución manual con `refresh_data=false` no consultan guías; el cron o `refresh_data=true` intentan renovarlas. Esa programación no garantiza una actualización exacta cada hora. No aparece como promesa de actualización en el sitio.

1. `prepare-data` obtiene el checkout, instala pnpm 10/Node 24 y dependencias frozen, y restaura el caché editorial compatible con `actions/cache/restore`.
2. `prepare-editorial-release.js` valida la base del repositorio y la del caché. Prefiere el caché si es válido y no retrocede fechas respecto de la base versionada. Si ninguna base es válida, falla y bloquea los jobs siguientes.
3. Si se pidió actualizar, ejecuta `sync-editorial-data.js` sobre `.ci/editorial-candidate.json` mediante `EDITORIAL_DATA_PATH`, con timeout de diez minutos. El script estricto original sigue devolviendo error ante fallos. Si falla o la candidata no supera la validación, se descarta toda la candidata y se selecciona el respaldo sin modificar sus fechas. No se ignoran errores de build/tests.
4. Genera `.ci/release/editorial-data.json` y `report.json`, muestra fechas y advertencias en el resumen de Actions, comprueba secretos y sube únicamente esa carpeta como artefacto `editorial-release` con retención de siete días. Este artefacto contiene datos editoriales técnicos, no WCL ni credenciales; no es el artefacto de Pages.
5. `build` obtiene el artefacto del mismo run y fija `EDITORIAL_DATA_PATH=.ci/release/editorial-data.json`. No vuelve a sincronizar. Ejecuta comprobación explícita de secretos, `pnpm test`, build con las banderas públicas, validación estática y otra comprobación de secretos.
6. Si la base es nueva para el caché, la guarda con `actions/cache/save` solo tras pasar esas comprobaciones. Reutilizar el respaldo por fallo no renueva sus fechas ni lo guarda otra vez como si fuera nuevo. Una base validada puede guardarse aunque luego falle la publicación: el caché significa datos/build validados, no confirmación de deploy.
7. Configura Pages y carga únicamente `dist` mediante `upload-pages-artifact`.
8. `deploy`, dependiente de `build`, publica mediante `deploy-pages`.

La concurrencia usa el grupo `pages` y `cancel-in-progress: false`. Comprobar el SHA de la ejecución que termina, no solo la primera ejecución verde visible.

Los controles de secretos y `check-static-build.js` son pasos explícitos. No se depende exclusivamente de los hooks `prebuild`/`postbuild` del gestor. Un fallback válido permite completar el workflow con una advertencia; un estado verde no implica que las guías hayan sido renovadas. Consultar siempre el resumen de datos.

### Qué ocurre con la base durante el deploy

CI conserva `.ci/editorial-validated.json` en un caché inmutable por ejecución/intento. El prefijo `editorial-v1` incluye el hash de la base versionada, código del servidor, validador y lockfile; un cambio incompatible parte de otro conjunto de respaldos. Se restaura la coincidencia compatible más reciente y se vuelve a validar. No se hace commit de capturas ni se modifica la base canónica del checkout. No se sincroniza WCL ni se requieren sus credenciales.

La validación exige las 40 guías esperadas de cada fuente, sin IDs duplicados, identidad y URL correctas, tiers reconocidos y no totalmente vacíos, items presentes en el catálogo, fechas de captura válidas y conteos coherentes. Comprueba que señales y lotes corresponden exactamente a esos snapshots. No sustituye una inspección visual de las fuentes. No hay caducidad máxima que borre un respaldo válido: sobrepasar una hora genera aviso de antigüedad, no una fecha inventada.

`report.json` contiene origen (`repository`, `validated-cache` o `refreshed`), resultado de actualización (`not-requested`, `success` o `fallback`), SHA-256 de los datos, advertencias y, por fuente, fecha más antigua/reciente, antigüedad máxima en horas y número de guías fuera del TTL. Solo llega al artefacto y a los resúmenes de Actions, nunca a `public`/`dist`.

**Primera ejecución y pérdida de caché:** el workflow anterior no conservaba la base del último deploy. Si no hay respaldo compatible, se usa la base versionada después de validarla. Revisar sus fechas antes de publicar: ese archivo puede ser anterior al sitio. El caché de Actions no es un almacenamiento permanente garantizado.

El 27 de septiembre se recuperaron las 40 guías de cada fuente. Wowhead respondió al lector HTTP. Para Icy Veins se leyeron las tablas y la atribución desde el navegador, porque el lector HTTP seguía recibiendo 403. Se compararon tiers, IDs y orden de las 40 tablas contra el parser y la base guardada. También se corrigió la pérdida del segundo trinket cuando varios desplegables comparten un mismo `li`, como ocurre en Frost DK. Las capturas y el respaldo anterior quedan en `.ci/browser-recovery/`, fuera de Git.

Esta recuperación no resuelve el bloqueo HTTP para futuras actualizaciones. Si vuelve a fallar, el workflow debe conservar la base validada con sus fechas reales. No reemplazarla por una captura parcial ni cambiar sus fechas para hacerla pasar por nueva.

Los errores de localización de nombres se registran aparte y actualmente no provocan por sí solos el fallo de `sync:data`; un job exitoso no demuestra traducción completa. Si un paso falla antes de publicar, esa ejecución no sustituye el sitio anterior.

Los logs de CI contienen salida técnica del generador y las validaciones. Que no aparezca administración en la web no significa que desaparezcan los logs del workflow o el código del repositorio.

## Comprobación local antes de publicar

Ejecutar desde la raíz del repositorio. Estos comandos no hacen commit, push ni sincronizan guías. La instalación puede consultar el registro de dependencias. Detenerse si cualquiera falla; corregir la causa antes de continuar.

```powershell
git status --short
pnpm install --frozen-lockfile
node scripts/check-secrets.js
node --test
node scripts/generate-static-data.js
node node_modules/vite/bin/vite.js build --mode github --base /loot-optimizer/ --outDir .local-build-check/public-release
node scripts/check-static-build.js .local-build-check/public-release
node scripts/check-secrets.js
git diff --check
```

La salida separada evita sustituir `dist` y cambiar accidentalmente lo que sirve el Node local en el puerto 3001. El generador sí modifica `public/data`; revisar sus cambios. Ejecutar Vite directamente no ejecuta los hooks del paquete, por eso se incluyen comprobaciones explícitas. `check-secrets.js` inspecciona `public` y `dist`, no cualquier `outDir` alternativo: el preview adicional requiere también revisar sus assets, especialmente si se añadieron variables o integraciones.

Para revisar ese build sin depender del backend:

```powershell
node node_modules/vite/bin/vite.js preview --mode github --base /loot-optimizer/ --outDir .local-build-check/public-release --host 127.0.0.1 --port 4173 --strictPort
```

Abrir `http://127.0.0.1:4173/loot-optimizer/`. Mantener la terminal abierta y detener solo ese preview al terminar. No cerrar el servidor Node del usuario ni matar procesos para liberar el puerto sin identificar su propietario.

Una actualización de datos es otra operación: ejecutar `pnpm sync:data` solo si procede, antes de generar las vistas. Cambia la base local y consulta las guías. No ejecutarla para validar únicamente documentación o presentación.

Para probar la selección de respaldo sin red ni modificar la base canónica:

```powershell
node scripts/prepare-editorial-release.js
node --test test/editorial-release.test.js
```

Para reproducir el build sobre esa selección, establecer `EDITORIAL_DATA_PATH=.ci/release/editorial-data.json` únicamente en el proceso de prueba y regenerar/buildar con los comandos anteriores. No dejar esa variable activa en el servidor local. `node scripts/prepare-editorial-release.js --refresh` sí descarga guías, pero solo escribe la candidata y la salida bajo `.ci/`.

## Lista de comprobación de publicación

Antes del push, y solo con autorización para publicar:

- Revisar el diff y preparar exclusivamente los archivos correspondientes. No usar `git add .` sin revisar qué incluye.
- Verificar `git diff --cached --name-only` y `git diff --cached --check`.
- Ejecutar de nuevo `node scripts/check-secrets.js` después del staging: así se incluyen archivos que antes no estaban versionados.
- Confirmar que no entran `.env`, caché WCL, snapshots crudos de jugadores ni artefactos locales. Las plantillas deben estar vacías de credenciales.
- Crear el commit y hacer push a `origin main` únicamente como parte del deploy solicitado. Un push documental a `main` también dispara el workflow actual.

Después del push:

- Identificar en [Actions](https://github.com/chedz-dev/loot-optimizer/actions) la ejecución con el SHA esperado. Esperar `success` tanto en `build` como en `deploy`; push exitoso no equivale a despliegue terminado.
- Abrir Pages y comprobar Rankings en los tres modos y en lista/tierlist. Revisar filtros, cambio de idioma, iconos/enlaces y «Mostrar más» en guías.
- Confirmar autor y actualización en WH/IV, sin snapshot, frecuencia horaria, pesos, cobertura ponderada ni panel de evidencia técnica.
- Confirmar que WCL muestra solo los contextos publicados, su fecha y sus agregados. No debe mostrar administración ni hacer peticiones al backend local, OAuth o GraphQL.
- Revisar los JSON servidos: catálogo, las dos tierlists, cada ranking y manifest; ausencia de campos técnicos. `data/demo.json` y `data/sources.json` deben responder 404.
- Registrar SHA, enlace al workflow y resultado de las comprobaciones. No afirmar una auditoría visual de todas las guías si solo se revisaron muestras.

## Garantías y límites de los controles

- `test/static-public-data.test.js` verifica conservación de specs, tiers y orden en los tres modos, campos permitidos, ambigüedades y ausencia de mutación del resultado original.
- `test/guide-metadata.test.js` verifica atribución, fechas y eliminación de metadata de captura. No exige inventar autor/fecha cuando la fuente no los proporciona.
- `check-static-build.js` valida el inventario bajo `dist/data`, las proyecciones de ranking, guías no vacías, campos de atribución y claves/archivos prohibidos conocidos. No arranca un navegador, no demuestra por sí solo el modo efectivo del bundle ni es un auditor universal de archivos privados.
- `test/editorial-release.test.js` cubre HTTP 403, descarte de actualizaciones parciales, fechas preservadas, candidata inválida, caché corrupto/antiguo, falta de respaldo y lectura de la base seleccionada. Los fallos de red se simulan; no se intenta sortear el rechazo de Icy Veins.
- `check-secrets.js` compara credenciales WCL conocidas en `.env`/`.env.local` contra archivos versionados, staging, assets de `public`/`dist` y la salida `.ci/release`; exige además placeholders vacíos en `.env.example`. `.env.github` participa en la comparación como archivo versionado, no tiene una validación específica de plantilla. No detecta universalmente otros secretos, no revisa todo el historial Git y, si CI no dispone de las credenciales locales, no puede comparar sus valores. La revisión local después del staging sigue siendo necesaria.
- Los tests y el build no garantizan que un parser siga interpretando visualmente todas las páginas vivas. Si se modifica un parser, añadir regresiones y comparar con las fuentes originales antes de dar la extracción por validada.

## Diagnóstico y futuras ampliaciones

Si Pages pide `/api/...`, comprobar primero que se publicó un build static y la ruta base correcta. Si aparecen métricas, revisar las condiciones de render y el JSON descargado, no solo el CSS. Si faltan cambios, comprobar workflow/SHA, recargar y revisar qué assets y JSON está sirviendo el navegador.

`vite.config.js` usa `GITHUB_SHA-GITHUB_RUN_ID-GITHUB_RUN_ATTEMPT` como `__DATA_VERSION__` en Actions. Las peticiones JSON llevan `?v=` con ese valor, distinto incluso al renovar datos del mismo commit o reintentar una ejecución. Fuera de Actions usa el SHA disponible o un timestamp. No actualiza automáticamente una pestaña ya abierta.

Si falla la sincronización, revisar la advertencia y antigüedad en el resumen. El error se tolera únicamente cuando existe una base completa validada. No desactivar tests ni controles de publicación para conseguir un deploy verde. Ante una regresión publicada, acordar la corrección o reversión y volver a validar; revertir a una versión anterior puede reintroducir información técnica pública.

Para publicar un módulo o dato nuevo, revisar conjuntamente esta matriz, el modelo y las proyecciones públicas, `data-client.js`, navegación/render, generador, validación del artefacto, tests y workflow. Añadir una ruta Express o quitar el bloqueo visual de WCL no crea una exportación estática segura. No copiar la base local completa a `public`.

Referencias del proyecto: [arquitectura](architecture.md), [decisiones de diseño](design-decisions.md), [base WCL local](warcraftlogs-cache.md).

Referencias del proveedor usadas para el flujo de respaldo: [restauración de caché](https://github.com/actions/cache/blob/main/restore/README.md), [guardado explícito de caché](https://github.com/actions/cache/blob/main/save/README.md) y [sintaxis de workflows](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax).
