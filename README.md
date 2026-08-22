# Loot Council Optimizer

Aplicación React y Node.js para comparar trinkets por clase y especialización usando señales normalizadas de Wowhead e Icy Veins.

## Modelo de datos

La fuente de verdad es `data/editorial-data.json`. No se requiere SQLite ni otro gestor de base de datos.

El documento conserva:

- catálogo canónico de items y procedencia;
- último snapshot válido de cada guía;
- señales normalizadas por item, clase, spec, contenido y fuente;
- metadata de caché y versión del esquema.

Los snapshots se actualizan de forma atómica. Si un parser falla, se conserva el último snapshot válido para esa guía.

## Motor de ranking

Las fuentes activas son Wowhead e Icy Veins con peso inicial de 50% cada una. Los tiers se normalizan a una escala de 0 a 100. Una spec sin evidencia en ambas fuentes no aparece; si solo una fuente tiene evidencia, la spec permanece con cobertura de 50% y la otra fuente queda como `NR`.

El registro de fuentes deja preparados, pero desactivados, Warcraft Logs, Bloodmallet, Maxroll, Method.gg y Liquid Armory.

## Ejecutar localmente

Requisitos: Node.js 24 y pnpm.

```powershell
pnpm install
pnpm dev
```

Cliente: `http://localhost:5173`  
API local: `http://localhost:3001`

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
- manifest con versión, fecha, cobertura y tamaños.

React usa la API local normalmente. Con `VITE_STATIC_DATA=true` consume esos archivos directamente, sin Express.

## GitHub Pages

El workflow `.github/workflows/deploy-pages.yml` sincroniza las fuentes cada hora, genera los JSON, compila Vite y publica `dist` en GitHub Pages.

En el repositorio de GitHub se debe seleccionar `Settings > Pages > Source > GitHub Actions`.

El workflow configura automáticamente:

- `VITE_STATIC_DATA=true`;
- la ruta base `/<nombre-del-repositorio>/`;
- caché del último `editorial-data.json` entre ejecuciones.

Las futuras credenciales de Warcraft Logs deben almacenarse como GitHub Actions Secrets. Nunca deben publicarse dentro de los JSON.
