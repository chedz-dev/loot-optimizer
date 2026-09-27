import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { publicGuide, publicRankings } from './static-projections.js';

const directory = path.resolve(process.argv[2] || 'dist');
const dataDirectory = path.join(directory, 'data');
const read = (name) => JSON.parse(fs.readFileSync(path.join(dataDirectory, name), 'utf8'));
const filesIn = (folder, prefix = '') => fs.readdirSync(folder, { withFileTypes: true }).flatMap((entry) => {
  const name = `${prefix}${entry.name}`;
  return entry.isDirectory() ? filesIn(path.join(folder, entry.name), `${name}/`) : [name];
});
const forbiddenKeys = new Set([
  'snapshotId', 'fetchedAt', 'cacheExpiresAt', 'contentHash', 'cacheHours', 'syncErrors',
  'score', 'scoreRange', 'confidence', 'evidenceCoverage', 'diagnostics', 'weights',
  'weight', 'effectiveWeight', 'configuredWeight', 'contribution', 'sampleSize',
  'rawRankings', 'accessToken', 'clientSecret', 'credentials', 'apiCalls', 'rateLimit',
]);
// Recorre los datos anidados para impedir que se publiquen campos privados.
function checkKeys(value, location) {
  if (!value || typeof value !== 'object') {
    return;
  }

  for (const [key, child] of Object.entries(value)) {
    assert.ok(!forbiddenKeys.has(key), `${location}.${key} is not public data`);
    checkKeys(child, `${location}.${key}`);
  }
}

const catalog = read('catalog.json');
assert.ok(catalog.items.length > 0, 'Empty item catalog');
const expected = ['catalog.json', 'manifest.json', 'tierlists/wowhead.json', 'tierlists/icyveins.json',
  ...catalog.items.map((item) => `rankings/${item.id}.json`)];
assert.deepEqual(filesIn(dataDirectory).sort(), expected.sort(), 'Unexpected or missing public data file');
for (const filename of expected) {
  checkKeys(read(filename), filename);
}

for (const item of catalog.items) {
  const result = read(`rankings/${item.id}.json`);
  assert.deepEqual(result, publicRankings(result), `Private ranking fields: ${item.id}`);
}

let guideCount = 0;

for (const source of ['wowhead', 'icyveins']) {
  const payload = read(`tierlists/${source}.json`);
  assert.deepEqual(Object.keys(payload).sort(), ['guides', 'source']);
  assert.ok(payload.guides.length > 0, `No guides for ${source}`);

  for (const guide of payload.guides) {
    assert.deepEqual(guide, publicGuide(guide), `Private guide fields: ${guide.id}`);
    assert.ok(Object.hasOwn(guide, 'author'), `Missing author field: ${guide.id}`);
    assert.ok(Object.hasOwn(guide, 'pageUpdatedAt'), `Missing editorial update field: ${guide.id}`);
    guideCount++;
  }
}

for (const filename of filesIn(directory)) {
  assert.ok(!/(^|\/)(?:\.ci\/|\.env(?:\.|$)|server\/|warcraftlogs\/)|\.(?:sqlite|map)$/i.test(filename),
    `Private file in public build: ${filename}`);
}

console.log(`Static build passed: ${catalog.items.length} rankings, ${guideCount} attributed guides, no admin payloads or internal metrics.`);
