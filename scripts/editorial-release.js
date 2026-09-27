import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { WOWHEAD_GUIDES, ICYVEINS_GUIDES } from '../server/guide-catalog.js';

const catalogs = { wowhead: WOWHEAD_GUIDES, icyveins: ICYVEINS_GUIDES };
const tiers = new Set(['S+', 'S', 'A+', 'A', 'B', 'C', 'D', 'F', 'G']);
const hour = 60 * 60 * 1000;
const fingerprint = (data) => createHash('sha256').update(JSON.stringify(data)).digest('hex');
const signalIdentity = (s) => JSON.stringify([
  s.source, s.classId, s.specId, s.snapshotKey, s.itemId,
  s.contentType, s.textValue, s.entryKey, s.fetchedAt,
]);

// Comprueba que las guías, los items y las señales pertenecen a la misma captura.
export function validateEditorialData(data, now = Date.now()) {
  assert.equal(data.schemaVersion, 1, 'Unsupported editorial schema');

  for (const key of ['items', 'signals', 'batches']) {
    assert.ok(Array.isArray(data[key]), `Missing ${key}`);
  }

  const itemIds = new Set(data.items.map((item) => item.itemId));
  assert.equal(itemIds.size, data.items.length, 'Duplicate canonical items');
  assert.ok([...itemIds].every((id) => Number.isSafeInteger(id) && id > 0), 'Invalid canonical item ID');
  const expectedSignals = [];
  const expectedBatches = [];
  const dates = {};
  const sources = [];

  for (const [source, catalog] of Object.entries(catalogs)) {
    const guides = data.guides?.[source];
    assert.ok(Array.isArray(guides), `Missing ${source} guides`);
    assert.equal(guides.length, catalog.length, `Incomplete ${source} coverage`);
    assert.equal(new Set(guides.map((g) => g.id)).size, catalog.length, `Duplicate ${source} guides`);
    const timestamps = [];

    for (const spec of catalog) {
      const guide = guides.find((g) => g.id === spec.id);
      assert.ok(guide, `Missing ${source}/${spec.id}`);
      const label = `${source}/${spec.id}`;
      assert.equal(guide.classId, spec.classId, `${label}: incorrect class`);
      assert.equal(guide.specId, spec.specId, `${label}: incorrect spec`);
      assert.equal(guide.url, spec.url, `${label}: incorrect source URL`);

      const timestamp = Date.parse(guide.fetchedAt);
      assert.ok(Number.isFinite(timestamp) && timestamp > 0 && timestamp <= now + 5 * 60 * 1000, `${label}: invalid capture date`);
      timestamps.push(timestamp);
      dates[label] = timestamp;

      assert.ok(Number.isSafeInteger(guide.snapshotId) && guide.snapshotId > 0, `${label}: invalid snapshot`);
      assert.ok(Array.isArray(guide.tiers) && guide.tiers.length > 0, `${label}: missing tiers`);
      assert.equal(guide.tierCount, guide.tiers.length, `${label}: inconsistent tier count`);
      assert.equal(new Set(guide.tiers.map((t) => t.label)).size, guide.tiers.length, `${label}: duplicate tiers`);
      let count = 0;

      guide.tiers.forEach((tier, tierIndex) => {
        assert.ok(tiers.has(tier.label) && Array.isArray(tier.items), `${label}: invalid tier`);

        for (const item of tier.items) {
          count++;
          assert.ok(itemIds.has(item.itemId), `${label}: item absent from canonical catalog`);
          assert.equal(item.tier, tier.label, `${label}: item tier mismatch`);
          assert.ok(Number.isInteger(item.displayOrder) && item.displayOrder > 0, `${label}: invalid item order`);
          assert.ok(Array.isArray(item.signalContentTypes), `${label}: missing signal contexts`);
          const contexts = item.signalContentTypes.length ? item.signalContentTypes : ['all'];

          for (const contentType of contexts) {
            expectedSignals.push(signalIdentity({
              source,
              classId: spec.classId,
              specId: spec.specId,
              snapshotKey: `guide:${guide.snapshotId}`,
              itemId: item.itemId,
              contentType,
              textValue: tier.label,
              entryKey: `${tierIndex + 1}:${item.displayOrder}`,
              fetchedAt: guide.fetchedAt,
            }));
          }
        }
      });

      assert.ok(count > 0, `${label}: empty recommendation`);
      assert.equal(guide.itemCount, count, `${label}: inconsistent item count`);
      expectedBatches.push(JSON.stringify([source, spec.classId, spec.specId, `guide:${guide.snapshotId}`, guide.fetchedAt, true]));
    }

    const oldest = Math.min(...timestamps);
    sources.push({
      source,
      guides: guides.length,
      oldestCaptureAt: new Date(oldest).toISOString(),
      newestCaptureAt: new Date(Math.max(...timestamps)).toISOString(),
      oldestAgeHours: Math.round(Math.max(0, now - oldest) / hour * 10) / 10,
      staleGuides: timestamps.filter((date) => now - date >= hour).length,
    });
  }

  // Compara el contenido completo para detectar señales faltantes o duplicadas.
  assert.ok(data.signals.every((s) => catalogs[s.source] && s.signalType === 'editorial-tier'), 'Unexpected non-editorial signals');
  assert.deepEqual(data.signals.map(signalIdentity).sort(), expectedSignals.sort(), 'Ranking signals differ from guide snapshots');
  assert.deepEqual(data.batches.map((b) => JSON.stringify([b.source, b.classId, b.specId, b.snapshotKey, b.fetchedAt, b.isComplete])).sort(),
    expectedBatches.sort(), 'Ranking batches differ from guide snapshots');

  return { sources, dates, sha256: fingerprint(data) };
}

// Impide sustituir una captura por otra más antigua.
function ensureNotOlder(candidate, baseline) {
  assert.ok(Object.entries(baseline.dates).every(([key, date]) => candidate.dates[key] >= date), 'Candidate regresses capture dates');
}

// Selecciona una base completa y conserva el respaldo si falla la actualización.
export async function selectEditorialRelease({ baseline, cached, refresh, now }) {
  const time = () => now ?? Date.now();
  const warnings = [];
  const candidates = [];

  for (const [origin, data] of [['repository', baseline], ['validated-cache', cached]]) {
    if (!data) {
      continue;
    }

    try {
      candidates.push({ origin, data, validation: validateEditorialData(data, time()) });
    } catch (error) {
      warnings.push(`${origin}: rejected (${error.message.split('\n')[0]})`);
    }
  }

  assert.ok(candidates.length > 0, 'No complete, coherent editorial base is available. Publication blocked.');
  let selected = candidates[0];

  if (candidates.length > 1) {
    try {
      ensureNotOlder(candidates[1].validation, candidates[0].validation);
      selected = candidates[1];
    } catch {
      warnings.push('validated-cache: older than repository; ignored');
    }
  }

  const baselineOrigin = selected.origin;
  let refreshStatus = 'not-requested';

  if (refresh) {
    try {
      const candidate = await refresh(structuredClone(selected.data));
      const validation = validateEditorialData(candidate, time());
      ensureNotOlder(validation, selected.validation);
      selected = { origin: 'refreshed', data: candidate, validation };
      refreshStatus = 'success';
    } catch (error) {
      refreshStatus = 'fallback';
      warnings.push(`Refresh rejected; keeping ${baselineOrigin}: ${error.message.split('\n')[0]}`);
    }
  }

  selected.validation = validateEditorialData(selected.data, time());
  const stale = selected.validation.sources.some((source) => source.staleGuides > 0);

  return {
    data: structuredClone(selected.data),
    cacheSave: selected.origin !== 'validated-cache',
    report: {
      checkedAt: new Date(time()).toISOString(),
      origin: selected.origin,
      baselineOrigin,
      refreshStatus,
      degraded: stale || warnings.length > 0,
      warnings,
      sha256: selected.validation.sha256,
      sources: selected.validation.sources,
    },
  };
}

// Resume las fechas y los errores del proceso en GitHub Actions.
export function releaseSummary(report) {
  const safe = (text) => String(text).replace(/[<>|\r\n]/g, ' ');

  return [
    '## Editorial data for this release', '',
    `Origin: **${report.origin}**. Refresh: **${report.refreshStatus}**. Checked at: ${report.checkedAt}.`,
    `Data SHA-256: \`${report.sha256}\`.`, '',
    '| Source | Guides | Oldest capture (UTC) | Newest capture (UTC) | Oldest age (hours) | Outside 1h TTL |',
    '| --- | --- | --- | --- | --- | --- |',
    ...report.sources.map((s) => `| ${s.source} | ${s.guides} | ${s.oldestCaptureAt} | ${s.newestCaptureAt} | ${s.oldestAgeHours} | ${s.staleGuides} |`), '',
    ...(report.degraded ? ['**Warning: retained or stale data. This release does not certify a fresh source sync.**', ''] : []),
    ...report.warnings.map((warning) => `- ${safe(warning)}`), '',
    'Capture dates are unchanged. Publisher update dates remain separate. No administration data is added to Pages.', '',
  ].join('\n');
}
