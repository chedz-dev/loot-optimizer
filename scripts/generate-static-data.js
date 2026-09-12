import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { classSpecs, getItemRankings, rankingItems } from '../server/rankings-data.js';
import {
  getEditorialDataStatus,
  getCanonicalItem,
  getRankingSignalsForItem,
  loadLatestGuides,
} from '../server/editorial-store.js';
import { ICYVEINS_GUIDES, WOWHEAD_GUIDES } from '../server/guide-catalog.js';
import { publicGuide, publicRankings } from './static-projections.js';

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
  items: rankingItems.map(({ profile, ...item }) => {
    const canonical = getCanonicalItem(item.itemId);
    return canonical?.localizedNames ? { ...item, localizedNames: canonical.localizedNames } : item;
  }),
}));

const tierlistPayload = (source, name, catalog) => {
  const guides = loadLatestGuides(source, catalog.map((guide) => guide.id));
  return { source: name, guides: guides.map(publicGuide) };
};
files.push(writeJson('tierlists/wowhead.json', tierlistPayload('wowhead', 'Wowhead', WOWHEAD_GUIDES)));
files.push(writeJson('tierlists/icyveins.json', tierlistPayload('icyveins', 'Icy Veins', ICYVEINS_GUIDES)));

rankingItems.forEach((item) => {
  const content = item.category === 'mythic-plus' ? 'mythic-plus' : 'raid';
  const result = getItemRankings(item.id, content, getRankingSignalsForItem(item.itemId));
  const canonical = getCanonicalItem(item.itemId);
  files.push(writeJson(`rankings/${item.id}.json`, publicRankings({
    ...result,
    item: canonical?.localizedNames ? { ...result.item, localizedNames: canonical.localizedNames } : result.item,
  })));
});

const manifest = { schemaVersion: 1, files: files.map(({ path }) => ({ path })) };
writeJson('manifest.json', manifest);
process.stdout.write(`${JSON.stringify({ output: 'public/data', files: files.length + 1, bytes: files.reduce((sum, file) => sum + file.bytes, 0), status }, null, 2)}\n`);
