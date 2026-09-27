# Loot Council Optimizer

Una aplicación en React y Node.js para comparar trinkets de World of Warcraft. Selecciona un item y revisa qué clases y specs lo recomiendan, usando las guías de Wowhead e Icy Veins.

El ranking se puede consultar por fuente o con ambas combinadas. También hay una sección para ver la tierlist de cada guía, sus notas y el origen de los trinkets.

Warcraft Logs permite consultar los trinkets más usados por el top 100 de cada spec. En local podemos actualizar los datos; Pages muestra una copia publicada de los resultados. Esta popularidad se mantiene aparte del ranking de las guías.

## Ejecutar localmente

Usar Node.js 24 y pnpm 10, las mismas versiones que usa el deploy.

```powershell
pnpm install
pnpm dev
```

El frontend abre en `http://localhost:5173` y la API en `http://localhost:3001`.

Para servir la aplicación compilada y la API desde el mismo puerto:

```powershell
node node_modules/vite/bin/vite.js build
pnpm start
```

Abrir `http://localhost:3001` y dejar el proceso de Node en ejecución. Si se vuelve a compilar el frontend, hay que recargar la página para ver los cambios.

## Cómo funciona el ranking

Por ahora, el ranking unificado usa Wowhead e Icy Veins con el mismo peso. Si las dos fuentes tienen una recomendación para la spec, se combinan sus valoraciones. Si solo aparece en una, se usa esa recomendación sin penalizarla por faltar en la otra.

Por ejemplo, si un trinket es S para una spec en Wowhead y no aparece en Icy Veins, se mantiene en S. Si no hay una recomendación clara en ninguna fuente, la spec no se muestra.

Las recomendaciones duplicadas no suman peso. Si una misma guía asigna distintos tiers al mismo item y no se puede distinguir a qué variante corresponde cada uno, el motor lo marca como ambiguo.

La popularidad de Warcraft Logs no modifica este ranking. Que un trinket sea muy usado no significa que sea el mejor para todas las situaciones.

Los pesos, cálculos y casos especiales están en la [documentación del ranking](docs/ranking-methodology.md).

## Base de datos y actualización

La información se guarda en JSON. No hace falta instalar un gestor de base de datos.

- `data/editorial-data.json`: items, origen, tierlists y recomendaciones de Wowhead e Icy Veins.
- `data/warcraftlogs/`: capturas y resultados de Warcraft Logs. Esta carpeta es local y no se sube a Git.
- `public/data/`: archivos generados para la versión estática. No se editan directamente.

Para actualizar las guías:

```powershell
pnpm sync:data
```

Si falla el parseo de una guía, se conserva su última captura válida. Para regenerar los archivos públicos y compilar el frontend:

```powershell
pnpm build
```

Este comando no consulta las guías. Tampoco activa por sí solo el modo estático: sin `VITE_STATIC_DATA=true`, el frontend sigue usando la API local.

## Warcraft Logs

Las credenciales van en `.env`. El archivo `.env.example` solo sirve de plantilla y debe quedarse sin credenciales reales. El servidor gestiona la conexión con Warcraft Logs; el navegador no recibe las credenciales ni el token.

El módulo permite elegir zona, boss o dungeon, dificultad, partición y spec. Usa los primeros 100 puestos del ranking por encuentro: DPS para daño y tanks, HPS para healers y `playerscore` para Mythic+.

La popularidad se calcula sobre los personajes que tienen información válida de ambos trinkets. Se eliminan personajes duplicados y no se buscan puestos inferiores al 100 para completar datos ausentes. Como cada personaje lleva dos trinkets, los porcentajes de todos los items pueden sumar 200%.

Navegar y cambiar filtros solo lee la base local, sin hacer llamadas a la API. Las actualizaciones se solicitan desde el panel local o por comando. El caché dura una hora: durante una actualización se omiten las capturas que todavía están vigentes. Al vencer esa hora no se descarga nada automáticamente.

Por defecto se muestran trinkets de la temporada actual. También se pueden consultar temporadas anteriores y los items cuya temporada está pendiente de confirmar.

La [documentación de Warcraft Logs](docs/warcraftlogs-cache.md) incluye los comandos para revisar, actualizar y recuperar la base.

## Versión estática y GitHub Pages

La versión de GitHub Pages usa los rankings, tierlists y el baked de Warcraft Logs de `public/data`, sin un servidor Node.js. Conserva las notas, el origen de los items, el autor y la fecha de actualización de las guías. No muestra paneles de administración ni métricas internas.

Para renovar el baked de WCL, primero actualizamos el caché local y luego ejecutamos `pnpm bake:warcraftlogs`. El exportador no consulta la API: guarda solo los resultados agregados y sus fechas en `public/data/warcraftlogs.json`. Ese archivo se revisa y se sube con el resto de los cambios. El build de Pages lo conserva; no necesita las credenciales ni la base privada.

`pnpm sync:wcl:release --plan` permite revisar las consultas necesarias y `pnpm sync:wcl:release` actualiza VA y Nymrissa para heroico y mítico. El alcance se mantiene en `data/warcraftlogs-release.json`; Kith'ix queda fuera por ahora. Pages permite elegir el encuentro y la dificultad por separado.

El workflow de deploy se ejecuta al hacer push a `main`, de forma manual o mediante una tarea programada cada hora:

- Un push publica con los datos guardados, después de validarlos, sin consultar las guías.
- La tarea programada intenta actualizar las guías. En una ejecución manual se puede activar `refresh_data` para hacer lo mismo.
- Si falla la actualización, se descartan los cambios parciales y se usa la base completa de respaldo. El resumen de Actions muestra el error y la antigüedad de los datos.
- Si no hay una base válida, o fallan las pruebas o el build, no se publica.

Si todavía no existe un respaldo en caché, se usa el JSON del repositorio. Puede ser más antiguo que los datos publicados, así que conviene revisar las fechas antes del primer deploy. La tarea programada tampoco garantiza datos nuevos cada hora: depende de que las fuentes respondan y de que GitHub ejecute el trabajo.

En GitHub, seleccionar `Settings > Pages > Source > GitHub Actions`. El workflow configura `VITE_STATIC_DATA=true`, `VITE_SHOW_TECHNICAL_METADATA=false` y la ruta base del repositorio. Solo publica la carpeta `dist`.

Para preparar un build estático local o revisar qué archivos se pueden publicar, consultar la [guía de deploy](docs/deployment.md).

## Pruebas

```powershell
pnpm test
pnpm check:secrets
```

Después de generar un build estático, revisar también su contenido:

```powershell
node scripts/check-static-build.js
```

## Documentación

- [Arquitectura y modelo de datos](docs/architecture.md).
- [Decisiones de diseño](docs/design-decisions.md).
- [Algoritmo de ranking](docs/ranking-methodology.md).
- [Base local de Warcraft Logs](docs/warcraftlogs-cache.md).
- [Build estático y deploy](docs/deployment.md).
