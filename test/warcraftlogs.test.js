import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { allSpecs, classSpecs } from '../server/spec-catalog.js';
import { WarcraftLogsError } from '../server/warcraftlogs-client.js';
import { createWarcraftLogsStore } from '../server/warcraftlogs-store.js';
import {
  WCL_TTL_MS, WCL_SAMPLE_SIZE, extractTrinkets, aggregateTrinketPopularity,
  metricForSpec, popularitySignals, createWarcraftLogsService,
} from '../server/warcraftlogs-popularity.js';

const timestamp = '2026-09-07T00:00:00.000Z';
const spec = { ...allSpecs.find((entry) => entry.classId === 'mage' && entry.specId === 'arcane'), wclClassSlug: 'Mage', wclSpecSlug: 'Arcane' };
const context = { zoneId: 42, encounterId: 4201, difficulty: 5, partition: 1, contentType: 'raid', region: 'world' };
const input = { zoneId: 42, encounterId: 4201, difficulty: 5, partition: 1, classId: 'mage', specId: 'arcane' };
const enrichItem = (item) => ({ itemId: Number(item.id), name: item.name, icon: item.icon });

function row(index, overrides = {}) {
  const gear = Array.from({ length: 18 }, (_, slot) => ({ id: 900000 + slot, name: `Other slot ${slot}`, itemLevel: 285 }));
  gear[12] = { id: 990001, name: 'Test trinket one', icon: 'test_one.jpg', itemLevel: 290 };
  gear[13] = { id: 990002, name: 'Test trinket two', icon: 'test_two.png', itemLevel: 300 };
  return {
    name: `Player${index}`, characterID: index + 1, class: 'Mage', spec: 'Arcane',
    server: { id: 10, name: 'Test Realm', region: 'US' },
    report: { code: 'TESTREPORT', fightID: 3 }, gear, ...overrides,
  };
}
const fullRows = () => Array.from({ length: 100 }, (_, index) => row(index));
const aggregate = (rows, overrides = {}) => aggregateTrinketPopularity(rows, { spec, context, fetchedAt: timestamp, enrichItem, ...overrides });

function apiCatalog() {
  const raid = {
    id: 42, name: 'Test Raid', frozen: false, expansion: { id: 10, name: 'Current Expansion' },
    difficulties: [{ id: 4, name: 'Heroic' }, { id: 5, name: 'Mythic' }],
    encounters: [{ id: 4201, name: 'Boss One' }, { id: 4202, name: 'Boss Two' }],
    partitions: [{ id: 1, name: 'Current Patch', default: true }, { id: 2, name: 'Other Patch', default: false }],
  };
  return {
    worldData: { zones: [
      raid,
      { ...raid, id: 43, name: 'Mythic+ Test Season', encounters: [{ id: 4301, name: 'Test Dungeon' }], difficulties: [{ id: 10, name: 'Mythic Keystone' }] },
      { ...raid, id: 40, name: 'Old Raid', expansion: { id: 9, name: 'Previous Expansion' } },
      { ...raid, id: 44, name: 'Frozen Raid', frozen: true },
      { ...raid, id: 45, name: 'PTR Test Raid' },
    ] },
    gameData: { classes: classSpecs.map((entry, index) => ({
      id: index + 1, name: entry.name, slug: entry.name.replaceAll(' ', ''),
      specs: entry.specs.map((entrySpec, specIndex) => ({ id: specIndex + 1, name: entrySpec.name, slug: entrySpec.name.replaceAll(' ', '') })),
    })) },
  };
}

function apiRankings(rows, hasMorePages = false) {
  return { worldData: { encounter: { characterRankings: { rankings: rows, hasMorePages } } } };
}

function setup({ cacheDir = null, rankings, catalogResponse = apiCatalog, configured = true, store } = {}) {
  let clock = Date.parse(timestamp);
  const calls = [];
  let handler = rankings || ((variables) => apiRankings(fullRows().map((entry) => ({ ...entry, class: variables.className, spec: variables.specName }))));
  const client = {
    configured: () => configured,
    query: async (query, variables) => {
      calls.push({ query, variables });
      return variables ? handler(variables) : catalogResponse();
    },
  };
  const options = { client, cacheDir, now: () => clock, ...(store ? { store } : {}) };
  return {
    service: createWarcraftLogsService(options), options, calls,
    setTime: (value) => { clock = value; },
    advance: (delta) => { clock += delta; },
    setHandler: (value) => { handler = value; },
    rankingCalls: () => calls.filter((call) => call.variables),
  };
}

function temporaryCache(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'loot-wcl-test-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}

async function syncSpec(fixture, overrides = {}) {
  const job = await fixture.service.startSync({ ...input, scope: 'spec', ...overrides });
  return fixture.service.waitForJob(job.id);
}

function diskSnapshots(cacheDir) {
  return fs.readdirSync(cacheDir).filter((name) => name.endsWith('.json')).flatMap((name) => {
    const filename = path.join(cacheDir, name);
    const snapshot = JSON.parse(fs.readFileSync(filename, 'utf8'));
    return snapshot.context && snapshot.spec && Array.isArray(snapshot.items) ? [{ filename, snapshot }] : [];
  });
}

test('WCL season enrichment is local across both views and retains observed items and denominators', async () => {
  const player = row(0);
  player.gear[12].id = 270167;
  player.gear[13].id = 249343;
  const fixture = setup({ rankings: () => apiRankings([player]) });
  await fixture.service.refreshCatalog();
  await syncSpec(fixture);
  const requestsBefore = fixture.calls.length;
  const snapshot = await fixture.service.getPopularity(input);
  assert.equal(snapshot.validCharacters, 1);
  assert.equal(snapshot.items.length, 2);
  const current = snapshot.items.find((item) => item.itemId === 270167);
  const old = snapshot.items.find((item) => item.itemId === 249343);
  assert.equal(current.seasonClassification.status, 'current');
  assert.equal(current.drop.sourceType, 'Lair');
  assert.equal(current.drop.encounter, 'Nymrissa Wavecaller');
  assert.equal(old.seasonClassification.status, 'past');
  assert.equal(current.popularity, 100);
  assert.equal(old.popularity, 100);
  const catalog = await fixture.service.getItems(input);
  assert.equal(catalog.items.find((item) => item.itemId === 270167).drop.sourceType, 'Lair');
  assert.equal(catalog.items.find((item) => item.itemId === 249343).seasonClassification.status, 'past');
  const comparison = await fixture.service.getItemPopularity({ ...input, itemId: 249343 });
  assert.equal(comparison.item.seasonClassification.status, 'past');
  assert.equal(comparison.item.drop.sourceType, 'Raid');
  assert.equal(comparison.item.drop.encounter, 'Chimaerus');
  assert.equal(comparison.rankings[0].validCharacters, 1);
  assert.equal(comparison.rankings[0].popularity, 100);
  assert.equal((await fixture.service.getCatalog()).currentItemSeason.id, 'midnight-s2');
  assert.equal(fixture.calls.length, requestsBefore);
});

test('WCL item picker sorts by pooled observed use, with stable ties and cache-only reads', async () => {
  const fixture = setup({ rankings: (variables) => {
    if (variables.specName === 'Frost') return apiRankings([]);
    const length = variables.specName === 'Fire' ? 10 : 100;
    return apiRankings(Array.from({ length }, (_, index) => {
      const player = row(index, { class: variables.className, spec: variables.specName });
      const [id, name] = variables.encounter === 4202 ? [990010, 'Other encounter']
        : variables.specName === 'Fire' || index < 10 ? [990001, 'Alpha']
          : index < 70 ? [990002, 'Zulu'] : index < 85 ? [990003, 'Beta'] : [990004, 'Delta'];
      player.gear[12] = { id, name, itemLevel: 300 };
      player.gear[13] = { id: 990009, name: 'Shared trinket', itemLevel: 300 };
      return player;
    }));
  } });
  await fixture.service.refreshCatalog();
  for (const specId of ['arcane', 'fire', 'frost']) await syncSpec(fixture, { specId });
  await syncSpec(fixture, { encounterId: 4202 });
  const requestsBefore = fixture.calls.length;
  const before = await fixture.service.getPopularity(input);
  const catalog = await fixture.service.getItems(input);
  assert.deepEqual(catalog.items.map((item) => [item.itemId, item.count]), [
    [990009, 110], [990002, 60], [990001, 20], [990003, 15], [990004, 15],
  ]);
  assert.equal(catalog.snapshots, 3);
  assert.equal(catalog.totalSpecs, allSpecs.length);
  for (const item of catalog.items) {
    assert.equal(item.validCharacters, 110);
    assert.equal(item.popularity, item.count / 110 * 100);
  }
  // Alpha has 100% in Fire but fewer total users than Zulu. Other encounters do not contribute.
  assert.equal(catalog.items.some((item) => item.itemId === 990010), false);
  assert.deepEqual((await fixture.service.getItems(input)).items, catalog.items);
  assert.deepEqual(await fixture.service.getPopularity(input), before);
  assert.equal(fixture.calls.length, requestsBefore);
});

test('WCL item picker returns an empty ordered catalog when there are no cached samples', async () => {
  const fixture = setup();
  await fixture.service.refreshCatalog();
  const requestsBefore = fixture.calls.length;
  assert.deepEqual((await fixture.service.getItems(input)).items, []);
  assert.equal(fixture.calls.length, requestsBefore);
});

test('WCL original ranking links preserve boss, difficulty, partition and spec across raid and M+', () => {
  for (const selectedContext of [
    { ...context, zoneId: 53, encounterId: 3470, difficulty: 5 },
    { ...context, zoneId: 53, encounterId: 3470, difficulty: 4, partition: 2 },
    { ...context, zoneId: 55, encounterId: 12993, difficulty: 10, contentType: 'mythic-plus' },
  ]) {
    for (const selectedSpec of allSpecs) {
      const expectedClass = selectedSpec.className.replaceAll(' ', '');
      const expectedSpec = selectedSpec.specName.replaceAll(' ', '');
      const result = aggregate([row(0)], { spec: { ...selectedSpec, wclClassSlug: expectedClass, wclSpecSlug: expectedSpec }, context: selectedContext });
      const url = new URL(result.sourceUrl);
      assert.equal(url.origin, 'https://www.warcraftlogs.com');
      assert.equal(url.pathname, `/zone/rankings/${selectedContext.zoneId}`);
      assert.deepEqual(Object.fromEntries(url.searchParams), {
        boss: String(selectedContext.encounterId), difficulty: String(selectedContext.difficulty), partition: String(selectedContext.partition),
        class: expectedClass, spec: expectedSpec, metric: metricForSpec(selectedSpec, selectedContext.contentType),
      });
    }
  }
});

test('WCL per-item spec links reuse the cached source URL without additional API calls', async () => {
  const fixture = setup();
  await fixture.service.refreshCatalog();
  for (const specId of ['arcane', 'fire']) await syncSpec(fixture, { specId });
  const requestsBefore = fixture.calls.length;
  const comparison = await fixture.service.getItemPopularity({ ...input, itemId: 990001 });
  assert.equal(comparison.rankings.length, 2);
  for (const entry of comparison.rankings) {
    const snapshot = await fixture.service.getPopularity({ ...input, specId: entry.specId });
    assert.equal(entry.sourceUrl, snapshot.sourceUrl);
    assert.equal(new URL(entry.sourceUrl).searchParams.get('spec'), entry.specName);
  }
  assert.equal(fixture.calls.length, requestsBefore);
});

test('WCL extracts only trinket slots 12 and 13 of the verified 18-slot gear shape', () => {
  const player = row(0);
  assert.deepEqual(extractTrinkets(player), player.gear.slice(12, 14));
  assert.equal(extractTrinkets({ gear: player.gear.slice(0, 17) }), null);
  assert.equal(extractTrinkets({ gear: player.gear.slice(12, 14) }), null);
  assert.equal(extractTrinkets({ gear: [...player.gear, { id: 123 }] }), null);
  assert.equal(extractTrinkets({}), null);
});

test('WCL rejects empty, invalid or duplicate trinket slots, including differently typed IDs', () => {
  for (const id of [0, -1, null, undefined, 'invalid', 1.5]) {
    const player = row(0);
    player.gear[13].id = id;
    assert.equal(extractTrinkets(player), null, `invalid id ${id}`);
  }
  const duplicate = row(0);
  duplicate.gear[13].id = duplicate.gear[12].id;
  assert.equal(extractTrinkets(duplicate), null);
  duplicate.gear[13].id = String(duplicate.gear[12].id);
  assert.equal(extractTrinkets(duplicate), null);
});

test('WCL keeps exactly the first 100 positions and never backfills missing gear with rank 101', () => {
  const rows = Array.from({ length: 102 }, (_, index) => row(index));
  rows[99].gear = [];
  rows[100].gear[12].id = 999999;
  const result = aggregate(rows);
  assert.equal(result.targetSampleSize, 100);
  assert.equal(result.rankingRows, 100);
  assert.equal(result.sampledCharacters, 100);
  assert.equal(result.validCharacters, 99);
  assert.equal(result.missingGear, 1);
  assert.equal(result.status, 'incomplete');
  assert.equal(result.items.some((item) => item.itemId === 999999), false);
  assert.deepEqual(result.items.map((item) => [item.count, item.popularity]), [[99, 100], [99, 100]]);
  assert.equal(result.cohort.at(-1).rank, 100);
});

test('WCL excludes duplicate identities and invalid gear from the measured denominator', () => {
  const rows = [row(0), row(1, { characterID: 1 }), row(2, { gear: null }), row(3, { characterID: null, server: null })];
  const result = aggregate(rows);
  assert.equal(result.rankingRows, 4);
  assert.equal(result.sampledCharacters, 2);
  assert.equal(result.duplicateCharacters, 1);
  assert.equal(result.invalidIdentity, 1);
  assert.equal(result.missingGear, 1);
  assert.equal(result.validCharacters, 1);
  assert.equal(result.items.every((item) => item.count === 1 && item.popularity === 100), true);

  const fallback = aggregate([
    row(0, { characterID: null }),
    row(1, { characterID: null, name: 'player0', server: { id: 10, name: 'Another realm display name', region: 'us' } }),
    row(2, { characterID: null, name: 'player0', server: { id: 11, name: 'Other Realm', region: 'US' } }),
  ]);
  assert.equal(fallback.validCharacters, 2);
  assert.equal(fallback.duplicateCharacters, 1);
});

test('WCL popularity counts wearers, totals about 200 percent and calculates item level from observed gear', () => {
  const rows = [row(0), row(1), row(2)];
  rows[1].gear[12].itemLevel = 300;
  rows[2].gear[12] = { id: 990003, name: 'Third trinket', itemLevel: 310 };
  const result = aggregate(rows);
  assert.deepEqual(result.items.map((item) => [item.itemId, item.count, item.popularity]), [
    [990002, 3, 100], [990001, 2, 66.67], [990003, 1, 33.33],
  ]);
  assert.equal(result.items.reduce((sum, item) => sum + item.popularity, 0), 200);
  assert.equal(result.items.find((item) => item.itemId === 990001).averageItemLevel, 295);
  assert.equal(result.items.length, 3);
  assert.equal(result.items.some((item) => item.itemId >= 900000 && item.itemId < 990000), false);
});

test('WCL distinguishes empty, incomplete and fully measured snapshots', () => {
  assert.equal(aggregate([]).status, 'empty');
  assert.deepEqual(aggregate([]).items, []);
  assert.equal(aggregate([row(0)]).status, 'incomplete');
  assert.equal(aggregate(fullRows()).status, 'ready');
});

test('WCL uses role-specific raid metrics and Mythic+ score for every role', () => {
  for (const role of ['dps', 'tank', 'support', 'healer']) {
    assert.equal(metricForSpec({ role }, 'raid'), role === 'healer' ? 'hps' : 'dps');
    assert.equal(metricForSpec({ role }, 'mythic-plus'), 'playerscore');
  }
});

test('WCL normalized signals preserve usage, sampling and encounter metadata without inventing tiers', () => {
  const snapshot = aggregate([row(0), row(1, { gear: null })]);
  const signals = popularitySignals(snapshot);
  assert.equal(signals.length, 2);
  assert.equal(signals[0].source, 'warcraftlogs');
  assert.equal(signals[0].signalType, 'usage-rate');
  assert.equal(signals[0].numericValue, 100);
  assert.equal(signals[0].textValue, null);
  assert.equal(signals[0].sampleSize, 1);
  assert.equal(signals[0].confidence, 0.01);
  assert.equal(signals[0].contentType, 'raid');
  assert.equal(signals[0].metadata.encounterId, context.encounterId);
  assert.equal(signals[0].metadata.partition, context.partition);
  assert.equal(signals[0].metadata.metric, 'dps');
  assert.equal(signals[0].metadata.sampledCharacters, 2);
  assert.equal(signals[0].metadata.targetSampleSize, WCL_SAMPLE_SIZE);
  assert.equal(signals[0].metadata.sourceUrl, snapshot.sourceUrl);
  assert.equal('tier' in signals[0], false);
  const dungeon = aggregate([row(0)], { context: { ...context, contentType: 'mythic-plus' } });
  assert.equal(popularitySignals(dungeon)[0].contentType, 'dungeon');
  assert.equal(popularitySignals(dungeon)[0].metadata.metric, 'playerscore');
});

test('WCL cold reads never contact the API and clearly require a local catalog', async () => {
  const fixture = setup();
  const catalog = await fixture.service.getCatalog();
  assert.deepEqual(catalog.zones, []);
  assert.equal(catalog.configured, true);
  await assert.rejects(fixture.service.getPopularity(input), { code: 'CATALOG_REQUIRED', status: 409 });
  await fixture.service.getCacheStatus();
  assert.equal(fixture.calls.length, 0);
});

test('WCL explicit catalog refresh excludes obsolete zones and respects the one-hour freshness boundary', async () => {
  const fixture = setup();
  const result = await fixture.service.refreshCatalog();
  assert.deepEqual(result.zones.map((zone) => [zone.id, zone.contentType]), [[42, 'raid'], [43, 'mythic-plus']]);
  assert.deepEqual(result.defaultContext, { zoneId: 42, encounterId: 4201, difficulty: 5, partition: 1 });
  assert.equal(result.cacheHours, 1);
  fixture.advance(WCL_TTL_MS - 1);
  await fixture.service.refreshCatalog();
  assert.equal(fixture.calls.length, 1);
  fixture.advance(1);
  const stale = await fixture.service.getCatalog();
  assert.equal(stale.stale, true);
  assert.equal(fixture.calls.length, 1);
  const renewed = await fixture.service.refreshCatalog();
  assert.equal(renewed.stale, false);
  assert.equal(fixture.calls.length, 2);
  await fixture.service.refreshCatalog({ force: true });
  assert.equal(fixture.calls.length, 3);
});

test('WCL uses the published default context for an explicit spec sync and later local reads', async () => {
  const fixture = setup();
  const catalog = await fixture.service.refreshCatalog();
  const job = await fixture.service.startSync({ scope: 'spec', classId: 'mage', specId: 'arcane' });
  assert.equal((await fixture.service.waitForJob(job.id)).status, 'complete');
  const result = await fixture.service.getPopularity({ classId: 'mage', specId: 'arcane' });
  assert.equal(result.context.difficulty, catalog.defaultContext.difficulty);
  assert.equal(fixture.rankingCalls()[0].variables.difficulty, catalog.defaultContext.difficulty);
});

test('WCL expired snapshots remain readable with zero API calls until explicitly synchronized', async () => {
  const fixture = setup();
  await fixture.service.refreshCatalog();
  await syncSpec(fixture);
  const first = await fixture.service.getPopularity(input);
  assert.equal(first.expiresAt, '2026-09-07T01:00:00.000Z');
  fixture.advance(WCL_TTL_MS - 1);
  await syncSpec(fixture);
  assert.equal(fixture.rankingCalls().length, 1);
  fixture.advance(1);
  const usageBeforeReads = (await fixture.service.getCacheStatus()).apiUsage;
  const stale = await fixture.service.getPopularity(input);
  assert.equal(stale.stale, true);
  assert.equal(stale.fetchedAt, first.fetchedAt);
  await fixture.service.getCatalog();
  await fixture.service.getItems(input);
  await fixture.service.getItemPopularity({ ...input, itemId: 990001 });
  await fixture.service.getCacheStatus();
  await fixture.service.getSyncPlan({ ...input, scope: 'spec' });
  assert.equal(fixture.calls.length, 2);
  assert.deepEqual((await fixture.service.getCacheStatus()).apiUsage, usageBeforeReads);
  await syncSpec(fixture);
  const renewed = await fixture.service.getPopularity(input);
  assert.equal(renewed.fetchedAt, first.expiresAt);
  assert.equal(renewed.stale, false);
  assert.equal(fixture.rankingCalls().length, 2);
  assert.equal(fixture.calls.filter((call) => !call.variables).length, 1);
});

test('WCL cached JSON is browsable without credentials after restart and retains replayable source data', async (t) => {
  const cacheDir = temporaryCache(t);
  const fixture = setup({ cacheDir });
  await fixture.service.refreshCatalog();
  await syncSpec(fixture);
  const first = await fixture.service.getPopularity(input);
  const [{ snapshot }] = diskSnapshots(cacheDir);
  assert.equal(snapshot.cohort.length, 100);
  assert.equal(snapshot.signals.length, 2);
  assert.equal(snapshot.rawRankings.length, 100);
  assert.equal(snapshot.rawRankings[0].gear.length, 18);
  assert.equal('cohort' in first, false);
  assert.equal('signals' in first, false);
  assert.equal('rawRankings' in first, false);
  assert.equal(fs.readdirSync(cacheDir).some((file) => file.endsWith('.tmp')), false);

  const restarted = createWarcraftLogsService({ ...fixture.options, client: {
    configured: () => false,
    query: async () => { assert.fail('Offline browsing must never contact Warcraft Logs'); },
  } });
  assert.equal((await restarted.getCatalog()).configured, false);
  assert.deepEqual(await restarted.getPopularity(input), first);
  assert.equal((await restarted.getItems(input)).items.length, 2);
  assert.equal((await restarted.getItemPopularity({ ...input, itemId: 990001 })).rankings.length, 1);
  await restarted.getCacheStatus();
  await restarted.getSyncPlan({ ...input, scope: 'spec' });
});

test('WCL missing snapshot and item reads use only the local catalog', async () => {
  const fixture = setup();
  await fixture.service.refreshCatalog();
  const count = fixture.calls.length;
  await assert.rejects(fixture.service.getPopularity(input), { code: 'CACHE_MISS', status: 404 });
  assert.equal((await fixture.service.getItems(input)).snapshots, 0);
  assert.equal((await fixture.service.getItemPopularity({ ...input, itemId: 990001 })).rankings.length, 0);
  await fixture.service.getSyncPlan({ ...input, scope: 'context' });
  assert.equal(fixture.calls.length, count);
});

test('WCL explicit refresh failures preserve the last good snapshot, including its original capture time', async (t) => {
  const cacheDir = temporaryCache(t);
  const fixture = setup({ cacheDir });
  await fixture.service.refreshCatalog();
  await syncSpec(fixture);
  const first = await fixture.service.getPopularity(input);
  const [{ filename }] = diskSnapshots(cacheDir);
  const stored = fs.readFileSync(filename, 'utf8');
  fixture.advance(WCL_TTL_MS);
  fixture.setHandler(() => { throw new WarcraftLogsError('Provider unavailable', 'NETWORK_ERROR'); });
  const failed = await syncSpec(fixture);
  assert.equal(failed.status, 'failed');
  assert.ok(JSON.stringify(failed).includes('NETWORK_ERROR'));
  const stale = await fixture.service.getPopularity(input);
  assert.equal(stale.stale, true);
  assert.equal(stale.fetchedAt, first.fetchedAt);
  assert.deepEqual(stale.items, first.items);
  assert.equal(fs.readFileSync(filename, 'utf8'), stored);
  const queryCount = fixture.rankingCalls().length;
  await fixture.service.getPopularity(input);
  assert.equal(fixture.rankingCalls().length, queryCount);
});

test('WCL a malformed catalog refresh preserves the last usable local catalog', async (t) => {
  let response = apiCatalog();
  const fixture = setup({ cacheDir: temporaryCache(t), catalogResponse: () => response });
  const first = await fixture.service.refreshCatalog();
  fixture.advance(WCL_TTL_MS);
  response = { worldData: { zones: [] }, gameData: { classes: [] } };
  await Promise.allSettled([fixture.service.refreshCatalog({ force: true })]);
  const saved = await fixture.service.getCatalog();
  assert.deepEqual(saved.zones, first.zones);
  assert.deepEqual(saved.defaultContext, first.defaultContext);
  assert.equal(saved.fetchedAt, first.fetchedAt);
  assert.equal(saved.stale, true);
  assert.equal(fixture.calls.length, 2);
});

test('WCL valid empty rankings are cached so repeated explicit sync does not waste API queries', async () => {
  const fixture = setup({ rankings: () => apiRankings([]) });
  await fixture.service.refreshCatalog();
  assert.equal((await syncSpec(fixture)).status, 'complete');
  const empty = await fixture.service.getPopularity(input);
  assert.equal(empty.status, 'empty');
  assert.deepEqual(empty.items, []);
  assert.equal(empty.rankingRows, 0);
  await syncSpec(fixture);
  assert.equal(fixture.rankingCalls().length, 1);
});

test('WCL missing-only sync preserves expired snapshots and force explicitly refreshes fresh ones', async () => {
  const fixture = setup();
  await fixture.service.refreshCatalog();
  await syncSpec(fixture);
  fixture.advance(WCL_TTL_MS);
  await syncSpec(fixture, { mode: 'missing' });
  assert.equal(fixture.rankingCalls().length, 1);
  assert.equal((await fixture.service.getPopularity(input)).stale, true);
  await syncSpec(fixture, { mode: 'force' });
  await syncSpec(fixture, { mode: 'force' });
  assert.equal(fixture.rankingCalls().length, 3);
});

test('WCL local plans count scopes and minimum API calls without loading any missing data', async () => {
  const fixture = setup();
  await fixture.service.refreshCatalog();
  for (const [scope, expected] of [
    ['spec', 1], ['context', allSpecs.length], ['zone', allSpecs.length * 2], ['all', allSpecs.length * 5], ['cached', 0],
  ]) {
    const plan = await fixture.service.getSyncPlan({ ...input, scope });
    assert.equal(plan.total, expected, `${scope} total`);
    assert.equal(plan.missing, expected, `${scope} missing`);
    assert.equal(plan.fresh, 0, `${scope} fresh`);
    assert.equal(plan.stale, 0, `${scope} stale`);
    assert.equal(plan.willFetch, expected, `${scope} fetches`);
    assert.equal(plan.minimumApiQueries, expected, `${scope} API minimum`);
    assert.equal(plan.catalogRefreshRequired, false);
  }
  assert.equal(fixture.calls.length, 1);
  await syncSpec(fixture);
  const fresh = await fixture.service.getSyncPlan({ ...input, scope: 'context' });
  assert.equal(fresh.fresh, 1);
  assert.equal(fresh.missing, allSpecs.length - 1);
  assert.equal(fresh.willFetch, allSpecs.length - 1);
  const cached = await fixture.service.getSyncPlan({ scope: 'cached' });
  assert.equal(cached.total, 1);
  assert.equal(cached.willFetch, 0);
  assert.equal(fixture.calls.length, 2);
});

test('WCL plan modes distinguish expired data from missing snapshots and force', async () => {
  const fixture = setup();
  await fixture.service.refreshCatalog();
  await syncSpec(fixture);
  fixture.advance(WCL_TTL_MS);
  for (const [mode, expected] of [['stale', allSpecs.length], ['missing', allSpecs.length - 1], ['force', allSpecs.length]]) {
    const plan = await fixture.service.getSyncPlan({ ...input, scope: 'context', mode });
    assert.equal(plan.total, allSpecs.length);
    assert.equal(plan.fresh, 0);
    assert.equal(plan.stale, 1);
    assert.equal(plan.missing, allSpecs.length - 1);
    assert.equal(plan.willFetch, expected);
    assert.equal(plan.minimumApiQueries, expected);
  }
  assert.equal(fixture.calls.length, 2);
});

test('WCL context jobs query each spec once and limit upstream concurrency to three', async () => {
  let active = 0;
  let peak = 0;
  const fixture = setup({ rankings: async (variables) => {
    active += 1;
    peak = Math.max(peak, active);
    await new Promise((resolve) => setImmediate(resolve));
    active -= 1;
    return apiRankings([row(0, { class: variables.className, spec: variables.specName })]);
  } });
  await fixture.service.refreshCatalog();
  const job = await fixture.service.startSync(input);
  assert.equal((await fixture.service.waitForJob(job.id)).status, 'complete');
  assert.equal(peak, 3);
  assert.equal(active, 0);
  assert.equal(fixture.rankingCalls().length, allSpecs.length);
  assert.equal(new Set(fixture.rankingCalls().map((call) => `${call.variables.className}:${call.variables.specName}`)).size, allSpecs.length);
  assert.equal((await fixture.service.getItems(input)).snapshots, allSpecs.length);
});

test('WCL isolates cached snapshots and item popularity by boss, difficulty and partition', async () => {
  const fixture = setup({ rankings: (variables) => {
    const player = row(0);
    player.gear[12].id = 990000 + variables.encounter + variables.difficulty * 10000 + variables.partition * 100000;
    return apiRankings([player]);
  } });
  await fixture.service.refreshCatalog();
  const contexts = [input, { ...input, encounterId: 4202 }, { ...input, difficulty: 4 }, { ...input, partition: 2 }];
  const captures = [];
  for (const value of contexts) {
    await syncSpec(fixture, value);
    captures.push(await fixture.service.getPopularity(value));
  }
  const uniqueItems = captures.map((capture) => capture.items.find((item) => item.itemId !== 990002).itemId);
  assert.equal(new Set(uniqueItems).size, 4);
  for (const [index, value] of contexts.entries()) {
    const items = await fixture.service.getItems(value);
    assert.equal(items.snapshots, 1);
    assert.equal(items.items.some((item) => item.itemId === uniqueItems[index]), true);
    assert.equal(items.items.some((item) => item.itemId === uniqueItems[(index + 1) % 4]), false);
    const detail = await fixture.service.getItemPopularity({ ...value, itemId: uniqueItems[index] });
    assert.equal(detail.rankings.length, 1);
    assert.equal(detail.rankings[0].popularity, 100);
  }
  assert.equal(fixture.rankingCalls().length, 4);
});

test('WCL explicit sync sends discovered slugs and role-specific metrics upstream', async () => {
  const fixture = setup();
  await fixture.service.refreshCatalog();
  await syncSpec(fixture, { classId: 'druid', specId: 'restoration' });
  await syncSpec(fixture, { zoneId: 43, encounterId: 4301, difficulty: 10, classId: 'hunter', specId: 'beast-mastery' });
  assert.equal(fixture.rankingCalls()[0].variables.metric, 'hps');
  assert.equal(fixture.rankingCalls()[1].variables.metric, 'playerscore');
  assert.equal(fixture.rankingCalls()[1].variables.className, 'Hunter');
  assert.equal(fixture.rankingCalls()[1].variables.specName, 'BeastMastery');
});

test('WCL fetches only enough pages for 100 positions and keeps the replayable top-100 boundary', async (t) => {
  const cacheDir = temporaryCache(t);
  const fixture = setup({ cacheDir, rankings: (variables) => apiRankings(
    Array.from({ length: 60 }, (_, index) => row((variables.page - 1) * 60 + index)), true,
  ) });
  await fixture.service.refreshCatalog();
  await syncSpec(fixture);
  const result = await fixture.service.getPopularity(input);
  assert.deepEqual(fixture.rankingCalls().map((call) => call.variables.page), [1, 2]);
  assert.equal(result.rankingRows, 100);
  assert.equal(result.validCharacters, 100);
  assert.equal(diskSnapshots(cacheDir)[0].snapshot.rawRankings.length, 100);
});

test('WCL malformed upstream data never overwrites a previously valid snapshot', async (t) => {
  const cases = [
    ['wrong spec', () => apiRankings([row(0, { spec: 'Fire' })]), 'SPEC_MISMATCH'],
    ['wrong class', () => apiRankings([row(0, { class: 'Priest' })]), 'SPEC_MISMATCH'],
    ['missing page flag', () => ({ worldData: { encounter: { characterRankings: { rankings: [row(0)] } } } }), 'INVALID_RESPONSE'],
    ['empty page with more pages', () => apiRankings([], true), 'INCOMPLETE_PAGINATION'],
    ['too many short pages', (variables) => apiRankings([row(variables.page)], true), 'INCOMPLETE_PAGINATION'],
    ['gear schema changed', () => apiRankings([row(0, { gear: [] })]), 'GEAR_UNAVAILABLE'],
  ];
  for (const [name, rankings, code] of cases) await t.test(name, async (caseTest) => {
    const cacheDir = temporaryCache(caseTest);
    const fixture = setup({ cacheDir });
    await fixture.service.refreshCatalog();
    await syncSpec(fixture);
    const [{ filename }] = diskSnapshots(cacheDir);
    const before = fs.readFileSync(filename, 'utf8');
    fixture.setHandler(rankings);
    const failed = await syncSpec(fixture, { mode: 'force' });
    assert.equal(failed.status, 'failed');
    assert.ok(JSON.stringify(failed).includes(code));
    assert.equal(fs.readFileSync(filename, 'utf8'), before);
    assert.equal((await fixture.service.getPopularity(input)).validCharacters, 100);
  });
});

test('WCL rejects invalid read and sync contexts before contacting the API', async () => {
  const fixture = setup();
  await fixture.service.refreshCatalog();
  const count = fixture.calls.length;
  for (const value of [
    { ...input, zoneId: 999 }, { ...input, encounterId: 4301 }, { ...input, partition: 999 },
    { ...input, specId: 'holy' }, { ...input, difficulty: 100 },
  ]) {
    await assert.rejects(fixture.service.getPopularity(value), { code: 'INVALID_CONTEXT', status: 400 });
    await assert.rejects(fixture.service.startSync({ ...value, scope: 'spec' }), { code: 'INVALID_CONTEXT', status: 400 });
  }
  await assert.rejects(fixture.service.startSync({ ...input, scope: 'invalid' }), { code: 'INVALID_CONTEXT' });
  await assert.rejects(fixture.service.startSync({ ...input, mode: 'invalid' }), { code: 'INVALID_CONTEXT' });
  assert.equal(fixture.calls.length, count);
});

test('WCL another service instance sees refreshed files without restarting or contacting the API', async (t) => {
  const fixture = setup({ cacheDir: temporaryCache(t) });
  await fixture.service.refreshCatalog();
  await syncSpec(fixture);
  const reader = createWarcraftLogsService({ ...fixture.options, client: {
    configured: () => false, query: async () => assert.fail('Local reader contacted the API'),
  } });
  assert.equal((await reader.getPopularity(input)).items.some((item) => item.itemId === 990003), false);
  fixture.setHandler(() => {
    const player = row(0);
    player.gear[12].id = 990003;
    return apiRankings([player]);
  });
  await syncSpec(fixture, { mode: 'force' });
  assert.equal((await reader.getPopularity(input)).items.some((item) => item.itemId === 990003), true);
  assert.equal((await reader.getItems(input)).items.some((item) => item.itemId === 990003), true);
});

test('WCL a shared-disk lease blocks competing sync and catalog writes before any API call', async (t) => {
  let release;
  let started;
  const entered = new Promise((resolve) => { started = resolve; });
  const gate = new Promise((resolve) => { release = resolve; });
  t.after(() => release());
  const fixture = setup({ cacheDir: temporaryCache(t), rankings: async () => {
    started();
    await gate;
    return apiRankings(fullRows());
  } });
  await fixture.service.refreshCatalog();
  const competingCalls = [];
  const competitor = createWarcraftLogsService({ ...fixture.options, client: {
    configured: () => true, query: async (...args) => { competingCalls.push(args); return apiCatalog(); },
  } });
  const active = await fixture.service.startSync({ ...input, scope: 'spec' });
  await entered;
  try {
    await assert.rejects(competitor.startSync({ ...input, scope: 'spec' }), { code: 'SYNC_RUNNING', status: 409 });
    await assert.rejects(competitor.refreshCatalog({ force: true }), { code: 'SYNC_RUNNING', status: 409 });
    assert.equal(competingCalls.length, 0);
  } finally {
    release();
    assert.equal((await fixture.service.waitForJob(active.id)).status, 'complete');
  }
});

test('WCL a failed checkpoint keeps the writer lease until all pending requests settle', { timeout: 5000 }, async (t) => {
  const deferred = () => {
    let resolve;
    const promise = new Promise((done) => { resolve = done; });
    return { promise, resolve };
  };
  const entered = deferred();
  const failedWrite = deferred();
  const gates = Array.from({ length: 3 }, deferred);
  t.after(() => gates.forEach((gate) => gate.resolve()));
  const backingStore = createWarcraftLogsStore({ cacheDir: null, now: () => Date.parse(timestamp) });
  let injected = false;
  const store = {
    ...backingStore,
    write(name, value) {
      if (!injected && name === 'state.json' && value.jobs?.some((job) => job.status === 'running' && job.completed >= 1)) {
        injected = true;
        failedWrite.resolve();
        throw new WarcraftLogsError('Simulated checkpoint write failure', 'STORAGE_ERROR', 500);
      }
      return backingStore.write(name, value);
    },
  };
  let started = 0;
  const fixture = setup({ store, rankings: async (variables) => {
    const index = started++;
    assert.ok(index < 3, 'No new upstream request may start after the checkpoint failure');
    if (started === 3) entered.resolve();
    await gates[index].promise;
    return apiRankings([row(0, { class: variables.className, spec: variables.specName })]);
  } });
  const competitor = createWarcraftLogsService({ ...fixture.options, client: {
    configured: () => true, query: async () => assert.fail('A competing writer contacted the API while requests were pending'),
  } });
  await fixture.service.refreshCatalog();
  const active = await fixture.service.startSync({ ...input, scope: 'context' });
  await entered.promise;
  try {
    gates[0].resolve();
    await failedWrite.promise;
    await new Promise((resolve) => setImmediate(resolve));
    assert.ok(backingStore.getLease(), 'The failed worker must not release the shared lease while other requests are pending');
    await assert.rejects(competitor.startSync({ ...input, scope: 'spec' }), { code: 'SYNC_RUNNING', status: 409 });
    assert.equal(fixture.rankingCalls().length, 3);
  } finally {
    gates.forEach((gate) => gate.resolve());
    await fixture.service.waitForJob(active.id);
  }
  const interrupted = fixture.service.getJob(active.id);
  assert.equal(interrupted.status, 'interrupted');
  assert.equal(interrupted.resumable, true);
  assert.equal(fixture.rankingCalls().length, 3);
  assert.equal(backingStore.getLease(), null);
});

test('WCL persisted jobs and counters survive restart and resume failed work after its saved cooldown', async (t) => {
  const fixture = setup({ cacheDir: temporaryCache(t), rankings: (variables) => {
    if (variables.className === 'Mage' && variables.specName === 'Arcane') throw new WarcraftLogsError('Try again later', 'NETWORK_ERROR');
    return apiRankings([row(0, { class: variables.className, spec: variables.specName })]);
  } });
  await fixture.service.refreshCatalog();
  const job = await fixture.service.startSync(input);
  const failed = await fixture.service.waitForJob(job.id);
  assert.equal(failed.status, 'failed');
  assert.equal(fixture.rankingCalls().length, allSpecs.length);
  assert.equal(failed.fetched, allSpecs.length - 1);
  assert.equal(failed.apiQueries, allSpecs.length);
  const usage = (await fixture.service.getCacheStatus()).apiUsage;
  assert.equal(usage.queries, 1 + allSpecs.length);
  assert.equal(usage.lastRequestAt, timestamp);
  const retryCalls = [];
  const restarted = createWarcraftLogsService({ ...fixture.options, client: {
    configured: () => true,
    query: async (query, variables) => { retryCalls.push({ query, variables }); return apiRankings(fullRows()); },
  } });
  assert.equal((await restarted.getJob(job.id)).status, 'failed');
  assert.equal((await restarted.getJob()).id, job.id);
  assert.deepEqual((await restarted.getCacheStatus()).apiUsage, usage);
  await restarted.resumeSync(job.id);
  assert.equal((await restarted.waitForJob(job.id)).status, 'failed');
  assert.equal(retryCalls.length, 0);
  fixture.advance(60_000);
  await restarted.resumeSync(job.id);
  const complete = await restarted.waitForJob(job.id);
  assert.equal(complete.status, 'complete');
  assert.equal(complete.fetched, allSpecs.length);
  assert.equal(complete.apiQueries, allSpecs.length + 1);
  assert.equal(retryCalls.length, 1);
  assert.equal(retryCalls[0].variables.specName, 'Arcane');
  assert.equal((await restarted.getItems(input)).snapshots, allSpecs.length);
  assert.equal((await restarted.getCacheStatus()).apiUsage.queries, allSpecs.length + 2);
});

test('WCL provider Retry-After survives restart and prevents retries beyond the minimum cooldown', async (t) => {
  const retryAt = Date.parse(timestamp) + 15 * 60_000;
  const fixture = setup({ cacheDir: temporaryCache(t), rankings: () => {
    const error = new WarcraftLogsError('Rate limit reached', 'RATE_LIMITED', 429);
    error.retryAt = retryAt;
    throw error;
  } });
  await fixture.service.refreshCatalog();
  const failed = await syncSpec(fixture);
  assert.equal(failed.status, 'failed');
  assert.equal(fixture.calls.length, 2);
  assert.equal((await fixture.service.getCacheStatus()).providerBackoff.until, retryAt);
  const retryCalls = [];
  const restarted = createWarcraftLogsService({ ...fixture.options, client: {
    configured: () => true,
    query: async (query, variables) => { retryCalls.push({ query, variables }); return apiRankings(fullRows()); },
  } });
  fixture.advance(6 * 60_000);
  assert.equal((await restarted.getCacheStatus()).providerBackoff.until, retryAt);
  await restarted.resumeSync(failed.id);
  const paused = await restarted.waitForJob(failed.id);
  assert.equal(paused.status, 'failed');
  assert.ok(paused.errors.some((error) => error.code === 'API_BACKOFF'));
  assert.equal(retryCalls.length, 0);
  assert.equal((await restarted.getCacheStatus()).apiUsage.queries, 2);
  fixture.setTime(retryAt);
  await restarted.resumeSync(failed.id);
  assert.equal((await restarted.waitForJob(failed.id)).status, 'complete');
  assert.equal(retryCalls.length, 1);
  assert.equal((await restarted.getCacheStatus()).apiUsage.queries, 3);
});

test('WCL offline rebuild restores derived popularity from raw rankings without changing snapshot age', async (t) => {
  const fixture = setup({ cacheDir: temporaryCache(t) });
  await fixture.service.refreshCatalog();
  await syncSpec(fixture);
  const [{ filename, snapshot }] = diskSnapshots(fixture.options.cacheDir);
  const expectedItems = structuredClone(snapshot.items);
  snapshot.items = [];
  snapshot.signals = [];
  fs.writeFileSync(filename, JSON.stringify(snapshot));
  fixture.advance(WCL_TTL_MS);
  const offline = createWarcraftLogsService({ ...fixture.options, client: {
    configured: () => false, query: async () => assert.fail('Offline rebuild contacted the API'),
  } });
  const job = await offline.rebuild();
  assert.equal((await offline.waitForJob(job.id)).status, 'complete');
  const rebuilt = diskSnapshots(fixture.options.cacheDir)[0].snapshot;
  assert.deepEqual(rebuilt.items, expectedItems);
  assert.equal(rebuilt.signals.length, 2);
  assert.equal(rebuilt.fetchedAt, timestamp);
  assert.equal(rebuilt.expiresAt, snapshot.expiresAt);
  assert.equal((await offline.getPopularity(input)).stale, true);
});

test('WCL offline rebuild preserves legacy snapshots lacking raw rankings without querying the API', async (t) => {
  const fixture = setup({ cacheDir: temporaryCache(t) });
  await fixture.service.refreshCatalog();
  await syncSpec(fixture);
  const [{ filename, snapshot }] = diskSnapshots(fixture.options.cacheDir);
  delete snapshot.rawRankings;
  fs.writeFileSync(filename, JSON.stringify(snapshot));
  const before = fs.readFileSync(filename, 'utf8');
  const offline = createWarcraftLogsService({ ...fixture.options, client: {
    configured: () => false, query: async () => assert.fail('Legacy rebuild contacted the API'),
  } });
  const job = await offline.rebuild();
  assert.equal((await offline.waitForJob(job.id)).status, 'complete');
  assert.equal(fs.readFileSync(filename, 'utf8'), before);
  assert.equal((await offline.getPopularity(input)).validCharacters, 100);
});
