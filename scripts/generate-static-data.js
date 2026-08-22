import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { demo } from '../server/demo-data.js';
import { DEFAULT_WEIGHTS } from '../server/optimizer.js';
import { classSpecs, getItemRankings, rankingItems } from '../server/rankings-data.js';
import { getSourceStatus } from '../server/sources.js';
import {
  getEditorialDataStatus,
  getCanonicalItem,
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
const includeTechnicalMetadata = process.env.VITE_SHOW_TECHNICAL_METADATA !== 'false';
const files = [];
files.push(writeJson('catalog.json', {
  classes: classSpecs,
  items: rankingItems.map(({ profile, ...item }) => {
    const canonical = getCanonicalItem(item.itemId);
    return canonical?.localizedNames ? { ...item, localizedNames: canonical.localizedNames } : item;
  }),
}));
files.push(writeJson('sources.json', { sources: getSourceStatus() }));
files.push(writeJson('demo.json', { ...demo, weights: DEFAULT_WEIGHTS }));

const publicGuide = (guide) => {
  const {
    snapshotId,
    cacheExpiresAt,
    contentHash,
    fetchedAt,
    itemCount,
    tierCount,
    ...content
  } = guide;
  return content;
};

const tierlistPayload = (source, name, catalog) => {
  const guides = loadLatestGuides(source, catalog.map((guide) => guide.id));
  if (!includeTechnicalMetadata) return { source: name, guides: guides.map(publicGuide) };
  return {
    source: name,
    mode: 'static-json-snapshot',
    storage: 'JSON estático',
    cacheHours: status.cacheHours,
    guideCount: catalog.length,
    syncErrors: [],
    guides,
  };
};
files.push(writeJson('tierlists/wowhead.json', tierlistPayload('wowhead', 'Wowhead', WOWHEAD_GUIDES)));
files.push(writeJson('tierlists/icyveins.json', tierlistPayload('icyveins', 'Icy Veins', ICYVEINS_GUIDES)));

rankingItems.forEach((item) => {
  const content = item.category === 'mythic-plus' ? 'mythic-plus' : 'raid';
  const result = getItemRankings(item.id, content, getRankingSignalsForItem(item.itemId));
  const canonical = getCanonicalItem(item.itemId);
  files.push(writeJson(`rankings/${item.id}.json`, {
    ...result,
    item: canonical?.localizedNames ? { ...result.item, localizedNames: canonical.localizedNames } : result.item,
  }));
});

const manifest = includeTechnicalMetadata
  ? {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      status,
      files,
    }
  : {
      schemaVersion: 1,
      files,
    };
writeJson('manifest.json', manifest);
process.stdout.write(`${JSON.stringify({ output: 'public/data', files: files.length + 1, bytes: files.reduce((sum, file) => sum + file.bytes, 0), status }, null, 2)}\n`);
