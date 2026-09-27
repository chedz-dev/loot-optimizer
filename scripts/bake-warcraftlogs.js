import fs from 'node:fs';
import path from 'node:path';
import { createWarcraftLogsStore } from '../server/warcraftlogs-store.js';
import { itemDetails } from '../server/warcraftlogs-data.js';
import { CURRENT_ITEM_SEASON } from '../server/item-seasons.js';
import { allSpecs } from '../server/spec-catalog.js';
import { publicWclDataset } from '../src/warcraftlogs-static.js';
import { validateWarcraftLogsStatic } from './validate-warcraftlogs-static.js';
import { selectReleaseSnapshots, validateReleaseCoverage } from './warcraftlogs-release.js';

// Lee el caché local sin consultar WCL ni cargar sus credenciales.
const store = createWarcraftLogsStore({ cacheDir: path.resolve('data/warcraftlogs') });
const snapshots = selectReleaseSnapshots(store.listSnapshotKeys().map(key => store.read(`${key}.json`)));

if (!snapshots.length) {
  throw new Error('No hay muestras locales de Warcraft Logs. Se conserva el baked anterior.');
}

const data = publicWclDataset({
  totalSpecs: allSpecs.length,
  currentItemSeason: CURRENT_ITEM_SEASON,
  snapshots: snapshots.map(snapshot => ({
    ...snapshot,
    items: snapshot.items.map(item => ({ ...item, ...itemDetails(item) })),
  })),
});

validateWarcraftLogsStatic(data);
validateReleaseCoverage(data);
const destination = path.resolve('public/data/warcraftlogs.json');
fs.mkdirSync(path.dirname(destination), { recursive: true });
fs.writeFileSync(`${destination}.tmp`, `${JSON.stringify(data)}\n`);
fs.renameSync(`${destination}.tmp`, destination);
console.log(`Baked WCL: ${data.snapshots.length} muestras agregadas. Sin consultas a la API ni datos de jugadores.`);
