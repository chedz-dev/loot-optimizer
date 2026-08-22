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

test('parsea items expandibles con details sin capturar items mencionados en la explicación', () => {
  const unholyGuide = {
    ...guide,
    id: 'death-knight-unholy',
    classId: 'death-knight',
    className: 'Death Knight',
    specId: 'unholy',
    specName: 'Unholy',
  };
  const detailsFixture = `
  <title>Unholy Death Knight DPS Gear and Best in Slot - 12.1 - World of Warcraft - Icy Veins</title>
  <details class="trinket-dropdown"><summary>Click for Unholy Death Knight Trinket Rankings</summary>
  <table><tr><th>Ranking</th><th>Trinkets</th></tr><tr><td><strong>S Tier</strong></td><td><ul>
  <details class="list-item"><summary><span class="spell_icon_span"><img class="spell_icon" src="//static.icy-veins.com/images/wow/large_icons/inv_121_trinket_raid_ulatek_trolltablet.jpg"> <span data-wowhead="item=270173" class="q4">Zul'jin's Guillotine Technique</span></span> - <em>Click for Details</em></summary>
  <span>Best passive when combined with <span data-wowhead="item=268213" class="q4">Maze-roa, Warlord's Fury</span>.</span></details>
  </ul></td></tr></table></details>`;
  const result = parseIcyVeinsGuideHtml(detailsFixture, unholyGuide);
  assert.equal(result.itemCount, 1);
  assert.equal(result.tiers[0].label, 'S');
  assert.equal(result.tiers[0].items[0].itemId, 270173);
  assert.equal(result.tiers[0].items[0].name, "Zul'jin's Guillotine Technique");
  assert.match(result.tiers[0].items[0].guideNote, /Best passive/);
  assert.doesNotMatch(result.tiers[0].items[0].guideNote, /Click for Details/);
});

test('recupera todos los items cuando Icy Veins omite cierres de li', () => {
  const malformedFixture = fixture.replace(`<li><span class="spell_icon_span"><img class="spell_icon" src="//static.icy-veins.com/images/wow/large_icons/inv_alchemy_90_flask_red.jpg" alt="Freightrunner's Flask Icon" /> <span data-wowhead="item=250215" class="q3">Freightrunner's Flask</span></span> &mdash; Best on-use Trinket</li>`, `
  <li><details class="list-item"><summary><span data-wowhead="item=270602" class="q4">Venomous Gladiator's Badge of Ferocity</span></summary><span>Explanation</span></details>
  <li><span data-wowhead="item=273796" class="q4">Vile Vial of Volatile Venom</span></li>
  <li><span data-wowhead="item=250214" class="q3">Lightspire Core</span>`);
  const result = parseIcyVeinsGuideHtml(malformedFixture, guide);
  assert.deepEqual(result.tiers[0].items.map((item) => item.itemId), [270602, 273796, 250214]);
  assert.deepEqual(result.tiers[0].items.map((item) => item.displayOrder), [1, 2, 3]);
});

test('captura el comentario aunque el item no use spell_icon_span', () => {
  const compactFixture = fixture.replace(
    `<span class="spell_icon_span"><img class="spell_icon" src="//static.icy-veins.com/images/wow/large_icons/inv_alchemy_90_flask_red.jpg" alt="Freightrunner's Flask Icon" /> <span data-wowhead="item=250215" class="q3">Freightrunner's Flask</span></span> &mdash; Best on-use Trinket`,
    `<span data-wowhead="item=250215" class="q3">Freightrunner's Flask</span> &mdash; Best on-use Trinket`,
  );
  const result = parseIcyVeinsGuideHtml(compactFixture, guide);
  assert.equal(result.tiers[0].items[0].guideNote, 'Best on-use Trinket');
});

test('ignora Click for Details como comentario cuando no existe una descripción', () => {
  const placeholderFixture = fixture.replace('&mdash; Best on-use Trinket', '- Click for Details');
  const result = parseIcyVeinsGuideHtml(placeholderFixture, guide);
  assert.equal(result.tiers[0].items[0].guideNote, '');
});

test('rechaza una tier con items en un contenedor desconocido en lugar de guardar datos parciales', () => {
  const unsupportedFixture = fixture.replace(
    /<li><span class="spell_icon_span">[\s\S]*?<\/li>/,
    '<div class="new-item-layout"><span data-wowhead="item=250215" class="q3">Freightrunner\'s Flask</span></div>',
  );
  assert.throws(() => parseIcyVeinsGuideHtml(unsupportedFixture, guide), /tier S contiene items que el parser no reconoció/);
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
  assert.deepEqual(stored.tiers[0].items[0].drop, {
    encounter: 'Zaen Bladesorrow',
    instance: 'Murder Row',
    sourceType: 'Mythic+',
  });
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
      items: tier.items.map((item) => ({ ...item, contentTypes: ['dungeon', 'raid'] })),
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

test('clasifica alternativas editoriales fuera del catálogo principal', () => {
  const store = createEditorialStore();
  const parsed = parseIcyVeinsGuideHtml(fixture.replaceAll('250215', '245752').replaceAll("Freightrunner's Flask", "Thalassian Competitor's Insignia of Alacrity"), guide);
  saveGuideSnapshot('icyveins', parsed, store);
  assert.deepEqual(loadLatestGuide('icyveins', guide.id, store).tiers[0].items[0].contentTypes, ['pvp']);
});

test('una etiqueta editorial incorrecta no convierte Gaze of the Alnseer en un item de Delves', () => {
  const store = createEditorialStore();
  const parsed = parseIcyVeinsGuideHtml(
    fixture.replaceAll('250215', '249343').replaceAll("Freightrunner's Flask", 'Gaze of the Alnseer'),
    guide,
  );
  parsed.tiers[0].items[0].contentTypes = ['delves', 'raid'];
  saveGuideSnapshot('wowhead', parsed, store);
  const item = loadLatestGuide('wowhead', guide.id, store).tiers[0].items[0];
  assert.deepEqual(item.contentTypes, ['raid']);
  assert.deepEqual(item.originTypes, ['raid']);
  assert.deepEqual(item.drop, {
    encounter: 'Chimaerus',
    instance: 'The Dreamrift',
    sourceType: 'Raid',
  });
  assert.deepEqual(item.season, { id: 'midnight-s1', label: 'S1' });
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
