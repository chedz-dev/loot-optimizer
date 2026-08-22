import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { demo } from '../server/demo-data.js';
import { DEFAULT_WEIGHTS } from '../server/optimizer.js';
import { classSpecs, getItemRankings, rankingItems } from '../server/rankings-data.js';
import { getSourceStatus } from '../server/sources.js';
import {
  getEditorialDataStatus,
  getRankingSignalsForItem,
  loadLatestGuides,
} from '../server/editorial-store.js';
import { ICYVEINS_GUIDES, WOWHEAD_GUIDES } from '../server/guide-catalog.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, 'public', 'data');
fs.mkdirSync(path.join(output, 'rankings'), { recursive: true });

const writeJson = (relativePath, value) => {
  const filename = path.join(output, relativePath);
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  fs.writeFileSync(filename, `${JSON.stringify(value)}\n`, 'utf8');
  return { path: relativePath.replaceAll('\\', '/'), bytes: fs.statSync(filename).size };
};

const status = getEditorialDataStatus();
const files = [];
files.push(writeJson('catalog.json', {
  classes: classSpecs,
  items: rankingItems.map(({ profile, ...item }) => item),
}));
files.push(writeJson('sources.json', { sources: getSourceStatus() }));
files.push(writeJson('demo.json', { ...demo, weights: DEFAULT_WEIGHTS }));

const tierlistPayload = (source, name, catalog) => ({
  source: name,
  mode: 'static-json-snapshot',
  storage: 'JSON estático',
  cacheHours: status.cacheHours,
  guideCount: catalog.length,
  syncErrors: [],
  guides: loadLatestGuides(source, catalog.map((guide) => guide.id)),
});
files.push(writeJson('tierlists/wowhead.json', tierlistPayload('wowhead', 'Wowhead', WOWHEAD_GUIDES)));
files.push(writeJson('tierlists/icyveins.json', tierlistPayload('icyveins', 'Icy Veins', ICYVEINS_GUIDES)));

rankingItems.forEach((item) => {
  const content = item.category === 'mythic-plus' ? 'mythic-plus' : 'raid';
  files.push(writeJson(`rankings/${item.id}.json`, getItemRankings(item.id, content, getRankingSignalsForItem(item.itemId))));
});

const manifest = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  status,
  files,
};
writeJson('manifest.json', manifest);
process.stdout.write(`${JSON.stringify({ output: 'public/data', files: files.length + 1, bytes: files.reduce((sum, file) => sum + file.bytes, 0), status }, null, 2)}\n`);

