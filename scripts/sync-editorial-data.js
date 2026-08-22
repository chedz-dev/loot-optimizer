import { getEditorialDataStatus, loadLatestGuides } from '../server/editorial-store.js';
import { WOWHEAD_GUIDES, ICYVEINS_GUIDES } from '../server/guide-catalog.js';
import { syncWowheadTierlists } from '../server/wowhead-tierlists.js';
import { syncIcyVeinsTierlists } from '../server/icyveins-tierlists.js';

const args = new Set(process.argv.slice(2));
const force = args.has('--force');
const sourceArg = process.argv.find((arg) => arg.startsWith('--source='))?.split('=')[1] || 'all';

async function runSource(label, source, guides, sync) {
  process.stdout.write(`Sincronizando ${label}: ${guides.length} guías\n`);
  const result = await sync({ force, concurrency: 3 });
  const coverage = loadLatestGuides(source, guides.map((guide) => guide.id));
  process.stdout.write(`${label}: ${result.saved}/${result.attempted} snapshots nuevos, cobertura ${coverage.length}/${guides.length}\n`);
  result.errors.forEach((entry) => process.stdout.write(`ERROR ${entry.guideId}: ${entry.error}\n`));
  return { ...result, coverage: coverage.length, expected: guides.length };
}

const results = [];
if (sourceArg === 'all' || sourceArg === 'wowhead') results.push(await runSource('Wowhead', 'wowhead', WOWHEAD_GUIDES, syncWowheadTierlists));
if (sourceArg === 'all' || sourceArg === 'icyveins') results.push(await runSource('Icy Veins', 'icyveins', ICYVEINS_GUIDES, syncIcyVeinsTierlists));
if (!['all', 'wowhead', 'icyveins'].includes(sourceArg)) throw new Error(`Fuente no válida: ${sourceArg}`);

process.stdout.write(`${JSON.stringify({ results, data: getEditorialDataStatus() }, null, 2)}\n`);
if (results.some((result) => result.errors.length || result.coverage !== result.expected)) process.exitCode = 1;

