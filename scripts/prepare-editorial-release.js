import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { releaseSummary, selectEditorialRelease } from './editorial-release.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const working = path.join(root, '.ci');
const output = path.join(working, 'release');
fs.mkdirSync(output, { recursive: true });

// Distingue archivos ausentes de contenido inválido para validar cada respaldo.
const read = (filename) => {
  try {
    return JSON.parse(fs.readFileSync(filename, 'utf8'));
  } catch (error) {
    return error.code === 'ENOENT' ? null : {};
  }
};

try {
  const refresh = process.argv.includes('--refresh') || process.env.REFRESH_EDITORIAL === 'true';
  const release = await selectEditorialRelease({
    baseline: read(path.join(root, 'data/editorial-data.json')),
    cached: read(path.join(working, 'editorial-validated.json')),
    refresh: refresh ? async (baseline) => {
      const candidatePath = path.join(working, 'editorial-candidate.json');
      fs.writeFileSync(candidatePath, JSON.stringify(baseline));

      // Actualiza una copia sin modificar la base del repositorio ni el respaldo.
      const result = spawnSync(process.execPath, ['scripts/sync-editorial-data.js'], {
        cwd: root,
        env: { ...process.env, EDITORIAL_DATA_PATH: candidatePath },
        encoding: 'utf8',
        timeout: 10 * 60 * 1000,
        maxBuffer: 16 * 1024 * 1024,
      });

      // Registra los errores de las guías sin publicar sus respuestas completas.
      const lines = (result.stdout || '').split(/\r?\n/);
      console.log(lines.filter((line) => /^(Sincronizando|Wowhead:|Icy Veins:|ERROR )/.test(line)).join('\n'));

      if (result.error || result.status !== 0) {
        const errorLines = lines.filter((line) => line.startsWith('ERROR '));
        throw new Error(`Sync failed (exit ${result.status ?? 'none'}): ${errorLines.length} guide errors; ${errorLines[0] || result.error?.message || 'check sync process'}`);
      }

      return JSON.parse(fs.readFileSync(candidatePath, 'utf8'));
    } : undefined,
  });

  // Guarda los datos seleccionados y el reporte separado del sitio público.
  fs.writeFileSync(path.join(output, 'editorial-data.json'), JSON.stringify(release.data));
  fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(release.report, null, 2));
  const summary = releaseSummary(release.report);
  console.log(summary);

  if (release.report.degraded && process.env.GITHUB_ACTIONS === 'true') {
    console.log('::warning::Editorial data is retained or stale. See the release summary for capture dates and refresh errors.');
  }

  if (process.env.GITHUB_STEP_SUMMARY) {
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
  }

  if (process.env.GITHUB_OUTPUT) {
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `cache_save=${release.cacheSave}\n`);
  }
} catch (error) {
  console.error(error.message.split('\n')[0]);
  process.exitCode = 1;
}
