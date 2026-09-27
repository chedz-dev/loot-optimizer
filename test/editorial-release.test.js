import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { validateEditorialData, selectEditorialRelease, releaseSummary } from '../scripts/editorial-release.js';

const baseline = JSON.parse(fs.readFileSync(new URL('../data/editorial-data.json', import.meta.url)));
const latest = Math.max(...Object.values(baseline.guides).flat().map((g) => Date.parse(g.fetchedAt)));
const now = latest + 48 * 60 * 60 * 1000;

// Avanza las fechas de la muestra sin modificar la base original.
function advanced(input, by = 60 * 60 * 1000) {
  const copy = structuredClone(input);

  for (const row of [...Object.values(copy.guides).flat(), ...copy.signals, ...copy.batches]) {
    row.fetchedAt = new Date(Date.parse(row.fetchedAt) + by).toISOString();
  }

  return copy;
}

test('validates all source guides against ranking signals and reports real capture age', () => {
  const result = validateEditorialData(baseline, now);
  assert.equal(result.sources.length, 2);
  assert.ok(result.sources.every((s) => s.guides === 40 && s.staleGuides === 40 && s.oldestAgeHours >= 48));
});

test('rejects missing, duplicate, empty and inconsistent guide/signal/batch data', () => {
  const corruptions = [
    (d) => {
      d.guides.wowhead.pop();
    },
    (d) => {
      d.guides.wowhead[1] = structuredClone(d.guides.wowhead[0]);
    },
    (d) => {
      d.guides.icyveins[0].tiers = [];
    },
    (d) => {
      d.guides.icyveins[0].fetchedAt = 'not a date';
    },
    (d) => {
      d.guides.icyveins[0].fetchedAt = new Date(now + 3600000).toISOString();
    },
    (d) => {
      d.guides.icyveins[0].specId = 'wrong';
    },
    (d) => {
      d.guides.icyveins[0].itemCount++;
    },
    (d) => {
      d.signals.pop();
    },
    (d) => {
      d.signals[0].textValue = 'Z';
    },
    (d) => {
      d.signals[0].snapshotKey = 'guide:0';
    },
    (d) => {
      d.batches[0].isComplete = false;
    },
    (d) => {
      d.items.pop();
    },
  ];

  for (const corrupt of corruptions) {
    const data = structuredClone(baseline);
    corrupt(data);
    assert.throws(() => validateEditorialData(data, now));
  }
});

test('offline publication uses newer validated cache without calling any source', async () => {
  const cached = advanced(baseline);
  const result = await selectEditorialRelease({ baseline, cached, now });
  assert.deepEqual(result.data, cached);
  assert.equal(result.report.origin, 'validated-cache');
  assert.equal(result.report.refreshStatus, 'not-requested');
  assert.equal(result.cacheSave, false);
  assert.equal(result.report.degraded, true);
});

test('403 failure discards partial refresh and preserves last validated data and dates', async () => {
  const cached = advanced(baseline);
  const saved = structuredClone(cached);
  const result = await selectEditorialRelease({
    baseline,
    cached,
    now,
    refresh: async (copy) => {
      copy.guides.wowhead[0].fetchedAt = new Date(now).toISOString();
      copy.signals = [];
      throw new Error('Icy Veins HTTP 403');
    },
  });
  assert.deepEqual(result.data, saved);
  assert.deepEqual(cached, saved);
  assert.equal(result.report.refreshStatus, 'fallback');
  assert.equal(result.cacheSave, false);
  assert.match(releaseSummary(result.report), /403/);
  assert.match(releaseSummary(result.report), /stale data/);
  assert.match(releaseSummary(result.report), /Oldest capture/);
});

test('a successful HTTP sync with incoherent candidate data still falls back', async () => {
  const result = await selectEditorialRelease({
    baseline,
    now,
    refresh: async (copy) => {
      copy.signals.pop();
      return copy;
    },
  });
  assert.equal(result.report.refreshStatus, 'fallback');
  assert.deepEqual(result.data, baseline);
});

test('publishing blocks if neither cache nor repository has a valid base', async () => {
  await assert.rejects(selectEditorialRelease({ baseline: {}, cached: {}, now }), /Publication blocked/);
  await assert.rejects(selectEditorialRelease({ now }), /Publication blocked/);
});

test('invalid or older cache falls back to repository and records a warning', async () => {
  for (const cached of [{}, advanced(baseline, -3600000)]) {
    const result = await selectEditorialRelease({ baseline, cached, now });
    assert.equal(result.report.origin, 'repository');
    assert.ok(result.report.warnings.length > 0);
    assert.deepEqual(result.data, baseline);
  }
});

test('valid cache can recover an invalid repository seed', async () => {
  const result = await selectEditorialRelease({ baseline: {}, cached: baseline, now });
  assert.equal(result.report.origin, 'validated-cache');
  assert.match(result.report.warnings[0], /repository: rejected/);
});

test('complete valid refresh is selected; regressing capture dates are rejected', async () => {
  const updated = advanced(baseline);
  const result = await selectEditorialRelease({ baseline, now, refresh: async () => updated });
  assert.equal(result.report.origin, 'refreshed');
  assert.equal(result.report.refreshStatus, 'success');
  assert.equal(result.cacheSave, true);
  assert.deepEqual(result.data, updated);
  const regressed = await selectEditorialRelease({ baseline: updated, now, refresh: async () => baseline });
  assert.equal(regressed.report.refreshStatus, 'fallback');
  assert.deepEqual(regressed.data, updated);
});

test('the generator reads the selected release, never the stale repository singleton', () => {
  // Comprueba la lectura de la base seleccionada en un proceso independiente.
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'editorial-release-test-'));
  const filename = path.join(folder, 'data.json');
  try {
    const data = advanced(baseline);
    fs.writeFileSync(filename, JSON.stringify(data));
    const code = "import { getEditorialStore } from './server/editorial-store.js'; console.log(getEditorialStore().data.guides.wowhead[0].fetchedAt);";
    const output = execFileSync(process.execPath, ['--input-type=module', '-e', code], {
      cwd: new URL('..', import.meta.url),
      env: { ...process.env, EDITORIAL_DATA_PATH: filename },
      encoding: 'utf8',
    });
    assert.equal(output.trim(), data.guides.wowhead[0].fetchedAt);
  } finally {
    fs.unlinkSync(filename);
    fs.rmdirSync(folder);
  }
});
