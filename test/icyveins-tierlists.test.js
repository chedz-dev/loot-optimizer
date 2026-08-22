import test from 'node:test';
import assert from 'node:assert/strict';
import { parseIcyVeinsGuideHtml } from '../server/icyveins-tierlists.js';
import {
  getEditorialSignalsForItem,
  getRankingSignalsForItem,
  hasFreshSnapshot,
  loadLatestGuide,
  createEditorialStore,
  saveGuideSnapshot,
  saveRankingSignals,
} from '../server/editorial-store.js';

const guide = {
  id: 'mage-arcane',
  classId: 'mage',
  className: 'Mage',
  specId: 'arcane',
  specName: 'Arcane',
  url: 'https://www.icy-veins.com/wow/arcane-mage-pve-dps-gear-best-in-slot',
};

const fixture = `
<title>Arcane Mage DPS Gear and Best in Slot - 12.1 - World of Warcraft - Icy Veins</title>
<script type="application/ld+json">{"author":{"name":"Dutchmagoz"},"dateModified":"2026-08-15T09:28:00+00:00"}</script>
<details class="trinket-dropdown"><summary>Click for Arcane Mage Trinket Rankings</summary>
<table><tr><th width=18%>Ranking</th><th>Trinkets</th></tr>
<tr><td><strong>S Tier</strong></td><td><ul>
<li><span class="spell_icon_span"><img class="spell_icon" src="//static.icy-veins.com/images/wow/large_icons/inv_alchemy_90_flask_red.jpg" alt="Freightrunner's Flask Icon" /> <span data-wowhead="item=250215" class="q3">Freightrunner's Flask</span></span> &mdash; Best on-use Trinket</li>
</ul></td></tr></table></details>`;

test('parsea tier, item, icon y comentario desde la tabla HTML de Icy Veins', () => {
  const result = parseIcyVeinsGuideHtml(fixture, guide);
  assert.equal(result.author, 'Dutchmagoz');
  assert.equal(result.patch, '12.1');
  assert.equal(result.itemCount, 1);
  assert.deepEqual(result.tiers[0].items[0], {
    itemId: 250215,
    name: "Freightrunner's Flask",
    icon: 'inv_alchemy_90_flask_red',
    tier: 'S',
    displayOrder: 1,
    quality: 3,
    contentTypes: [],
    guideNote: 'Best on-use Trinket',
    noteKey: '',
    wowheadUrl: 'https://www.wowhead.com/item=250215',
  });
});

test('persiste y reconstruye snapshots editoriales en JSON', () => {
  const store = createEditorialStore();
  const parsed = parseIcyVeinsGuideHtml(fixture, guide);
  const snapshotId = saveGuideSnapshot('icyveins', parsed, store);
  assert.equal(snapshotId, 1);
  assert.equal(hasFreshSnapshot('icyveins', guide.id, Date.now(), 3_600_000, store), true);
  const stored = loadLatestGuide('icyveins', guide.id, store);
  assert.equal(stored.snapshotId, 1);
  assert.equal(stored.tiers[0].items[0].guideNote, 'Best on-use Trinket');
  const signals = getEditorialSignalsForItem(250215, store);
  assert.equal(signals[0].tier, 'S');
  assert.equal(signals[0].spec_id, 'arcane');
});

test('acepta el encabezado estacional y tablas con details anidados', () => {
  const seasonalGuide = { ...guide, id: 'mage-fire', specId: 'fire', specName: 'Fire' };
  const seasonalFixture = fixture
    .replaceAll('Arcane', 'Fire')
    .replace('Click for Fire Mage Trinket Rankings', 'Click for Fire Season 2 Trinket Rankings')
    .replace('</table></details>', '<details><summary>Nota</summary></details></table></details>');
  const result = parseIcyVeinsGuideHtml(seasonalFixture, seasonalGuide);
  assert.equal(result.itemCount, 1);
  assert.equal(result.tiers[0].label, 'S');
});

test('JSON conserva un item repetido en contextos editoriales distintos', () => {
  const store = createEditorialStore();
  const parsed = parseIcyVeinsGuideHtml(fixture, guide);
  parsed.tiers.push({ label: 'A', items: [{ ...parsed.tiers[0].items[0], tier: 'A', displayOrder: 1, guideNote: 'Segundo contexto' }] });
  parsed.itemCount = 2;
  parsed.tierCount = 2;
  saveGuideSnapshot('icyveins', parsed, store);
  const stored = loadLatestGuide('icyveins', guide.id, store);
  assert.equal(stored.tiers.length, 2);
  assert.equal(getEditorialSignalsForItem(250215, store).length, 1);
});

test('Icy Veins hereda la procedencia canónica sin alterar el contexto de su señal', () => {
  const store = createEditorialStore();
  const icyParsed = parseIcyVeinsGuideHtml(fixture, guide);
  const wowheadParsed = {
    ...icyParsed,
    id: 'mage-fire',
    specId: 'fire',
    specName: 'Fire',
    tiers: icyParsed.tiers.map((tier) => ({
      ...tier,
      items: tier.items.map((item) => ({ ...item, contentTypes: ['dungeon'] })),
    })),
  };
  saveGuideSnapshot('wowhead', wowheadParsed, store);
  saveGuideSnapshot('icyveins', icyParsed, store);
  const stored = loadLatestGuide('icyveins', guide.id, store);
  assert.deepEqual(stored.tiers[0].items[0].contentTypes, ['dungeon']);
  assert.deepEqual(stored.tiers[0].items[0].originTypes, ['dungeon']);
  assert.deepEqual(stored.tiers[0].items[0].signalContentTypes, []);
  const signal = getRankingSignalsForItem(250215, store).find((entry) => entry.source === 'icyveins');
  assert.equal(signal.contentType, 'all');
  assert.equal(signal.signalType, 'editorial-tier');
});

test('el modelo normalizado admite una señal empírica con muestra y confianza', () => {
  const store = createEditorialStore();
  saveRankingSignals({
    sourceId: 'warcraftlogs',
    sourceName: 'Warcraft Logs',
    sourceKind: 'empirical',
    snapshotKey: 'raid:test-report:mythic',
    fetchedAt: '2026-08-22T09:00:00.000Z',
    signals: [{
      itemId: 250215,
      classId: 'mage',
      specId: 'arcane',
      contentType: 'raid',
      signalType: 'usage-rate',
      numericValue: 0.42,
      sampleSize: 1250,
      confidence: 0.96,
      metadata: { difficulty: 'mythic' },
    }],
  }, store);
  const signal = getRankingSignalsForItem(250215, store)[0];
  assert.equal(signal.source, 'warcraftlogs');
  assert.equal(signal.signalType, 'usage-rate');
  assert.equal(signal.numericValue, 0.42);
  assert.equal(signal.sampleSize, 1250);
  assert.equal(signal.confidence, 0.96);
  assert.deepEqual(signal.metadata, { difficulty: 'mythic' });
});

test('un snapshot completo nuevo invalida una señal antigua cuando el item desaparece', () => {
  const store = createEditorialStore();
  const parsed = parseIcyVeinsGuideHtml(fixture, guide);
  parsed.fetchedAt = '2026-08-21T09:00:00.000Z';
  saveGuideSnapshot('icyveins', parsed, store);
  saveGuideSnapshot('icyveins', {
    ...parsed,
    fetchedAt: '2026-08-22T09:00:00.000Z',
    tiers: [],
    itemCount: 0,
    tierCount: 0,
  }, store);
  assert.equal(getRankingSignalsForItem(250215, store).length, 0);
});
