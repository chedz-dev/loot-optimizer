import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

const workflow = fs.readFileSync(new URL('../.github/workflows/deploy-pages.yml', import.meta.url), 'utf8');

test('Pages compiles selected data offline and promotes cache only after validation', () => {
  // Normaliza los saltos de línea de Windows sin modificar el workflow.
  const normalized = workflow.replaceAll('\r\n', '\n');
  const buildJob = normalized.split('\n  build:\n')[1]?.split('\n  deploy:\n')[0];

  assert.ok(buildJob);
  assert.match(buildJob, /needs: prepare-data/);
  assert.match(buildJob, /EDITORIAL_DATA_PATH: \.ci\/release\/editorial-data.json/);
  assert.doesNotMatch(buildJob, /sync:data|--refresh|continue-on-error/);

  const cacheSave = buildJob.indexOf('uses: actions/cache/save@v5');
  assert.ok(cacheSave > buildJob.indexOf('run: pnpm test') && buildJob.indexOf('run: pnpm test') > 0);
  assert.ok(cacheSave > buildJob.indexOf('run: node scripts/check-static-build.js'));
  assert.match(buildJob.slice(cacheSave), /if: needs.prepare-data.outputs.cache_save == 'true'/);
  assert.match(buildJob, /actions\/upload-pages-artifact@v4\s+with:\s+path: dist/);
  assert.match(normalized, /refresh_data:[\s\S]*?default: false/);
  assert.match(normalized, /REFRESH_EDITORIAL:.*github.event_name == 'schedule'.*inputs.refresh_data/);
});

test('static JSON cache version changes for every CI run and retry, even on the same commit', () => {
  const version = (runId, attempt) => execFileSync(process.execPath, ['--input-type=module', '-e',
    "import config from './vite.config.js'; console.log(config.define.__DATA_VERSION__);"], {
    cwd: new URL('..', import.meta.url),
    env: { ...process.env, GITHUB_SHA: 'same-sha', GITHUB_RUN_ID: runId, GITHUB_RUN_ATTEMPT: attempt },
    encoding: 'utf8',
  }).trim();

  assert.equal(version('100', '1'), '"same-sha-100-1"');
  assert.equal(version('101', '1'), '"same-sha-101-1"');
  assert.equal(version('100', '2'), '"same-sha-100-2"');
});
