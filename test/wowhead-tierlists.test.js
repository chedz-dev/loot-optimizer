import test from 'node:test';
import assert from 'node:assert/strict';
import { parseWowheadGuideHtml } from '../server/wowhead-tierlists.js';

const guide = {
  id: 'hunter-beast-mastery',
  classId: 'hunter',
  className: 'Hunter',
  specId: 'beast-mastery',
  specName: 'Beast Mastery',
  url: 'https://www.wowhead.com/guide/classes/hunter/beast-mastery/bis-gear',
};

const fixture = String.raw`<title>Beast Mastery Hunter Gear and Best in Slot - Midnight - Wowhead</title>
Patch 12.1.0 Updated: 2026/08/21
"270173":{"name_enus":"Zul'jin's Guillotine Technique","quality":4,"icon":"inv_axe_1h_amaniberserker_d_01","screenshot":{},"jsonequip":{}}
[h3]Trinket Tier List[\/h3]\r\n
[tier-list=rows grid]\r\n
[tier]\r\n
[tier-label bg=q5]S[\/tier-label]\r\n
[tier-content]\r\n
[icon-badge=270173 quality=4 display-options=raid tooltip=axe]\r\n
[\/tier-content]\r\n
[\/tier]\r\n
[\/tier-list]
[tooltip name=axe]Strong in [color=green]single-target[\/color].[\/tooltip]`;

test('parsea tier, item, categoría y nota editorial desde el markup de Wowhead', () => {
  const result = parseWowheadGuideHtml(fixture, guide);
  assert.equal(result.pageTitle, 'Beast Mastery Hunter Gear and Best in Slot - Midnight - Wowhead');
  assert.equal(result.patch, '12.1.0');
  assert.equal(result.pageUpdatedAt, '2026/08/21');
  assert.equal(result.itemCount, 1);
  assert.deepEqual(result.tiers[0].items[0], {
    itemId: 270173,
    name: "Zul'jin's Guillotine Technique",
    icon: 'inv_axe_1h_amaniberserker_d_01',
    tier: 'S',
    displayOrder: 1,
    quality: 4,
    contentTypes: ['raid'],
    guideNote: 'Strong in single-target.',
    noteKey: 'axe',
    wowheadUrl: 'https://www.wowhead.com/item=270173',
  });
});

test('rechaza una URL asignada a la spec equivocada', () => {
  assert.throws(() => parseWowheadGuideHtml(fixture, { ...guide, specName: 'Marksmanship' }), /no coincide/);
});

test('conserva autor y fecha de modificación de JSON-LD de la guía, no su captura', () => {
  const metadata = `<script type="application/ld+json">${JSON.stringify({
    '@context': 'https://schema.org', '@graph': [
      { '@type': 'Person', name: 'Unrelated Person' },
      { '@type': 'Article', url: guide.url, author: [{ '@type': 'Person', name: 'Guide Writer' }], dateModified: '2026-08-25T00:00:00Z' },
    ],
  })}</script>`;
  const result = parseWowheadGuideHtml(metadata + fixture, guide);
  assert.equal(result.author, 'Guide Writer');
  assert.equal(result.pageUpdatedAt, '2026-08-25T00:00:00Z');
  assert.notEqual(result.pageUpdatedAt, result.fetchedAt);
});

test('extrae meta author y una fecha Updated visible entre etiquetas HTML', () => {
  const page = '<meta content="Writer &amp; Editor" name="author">'
    + fixture.replace('Updated: 2026/08/21', '<span>Updated:</span> <time>2026/08/22</time>');
  const result = parseWowheadGuideHtml(page, guide);
  assert.equal(result.author, 'Writer & Editor');
  assert.equal(result.pageUpdatedAt, '2026/08/22');
});

test('no confunde publisher, Person independiente o datePublished con autor y última actualización', () => {
  const page = '<script type="application/ld+json">{"@type":"Article","publisher":{"name":"Wowhead"},"datePublished":"2026-01-01"}</script>'
    + '<script type="application/ld+json">{"@type":"Person","name":"Comment Writer"}</script>'
    + fixture.replace('Updated: 2026/08/21', '');
  const result = parseWowheadGuideHtml(page, guide);
  assert.equal(result.author, '');
  assert.equal(result.pageUpdatedAt, '');
});

test('selecciona el artículo de la URL de la guía y tolera JSON-LD inválido', () => {
  const page = `<script type="application/ld+json">${JSON.stringify([
    { '@type': 'Article', url: 'https://www.wowhead.com/news/unrelated', author: 'Other Writer' },
    { '@type': 'Article', mainEntityOfPage: { '@id': guide.url }, author: { name: 'Guide Writer' }, dateModified: '2026-08-26' },
  ])}</script><script type="application/ld+json">{broken</script>` + fixture;
  const result = parseWowheadGuideHtml(page, guide);
  assert.equal(result.author, 'Guide Writer');
  assert.equal(result.pageUpdatedAt, '2026-08-26');
});

test('ignora un artículo único cuya URL pertenece a otra página', () => {
  const page = '<script type="application/ld+json">{"@type":"Article","url":"https://example.com/other","author":"Wrong Writer","dateModified":"2026-01-01"}</script>' + fixture;
  const result = parseWowheadGuideHtml(page, guide);
  assert.equal(result.author, '');
  assert.equal(result.pageUpdatedAt, '2026/08/21');
});

test('admite fecha de actualización en meta y time semántico', () => {
  const withoutDate = fixture.replace('Updated: 2026/08/21', '');
  assert.equal(parseWowheadGuideHtml('<meta property="article:modified_time" content="2026-08-27T11:00:00Z">' + withoutDate, guide).pageUpdatedAt, '2026-08-27T11:00:00Z');
  assert.equal(parseWowheadGuideHtml('<time itemprop="dateModified" datetime="2026-08-28">Aug 28</time>' + withoutDate, guide).pageUpdatedAt, '2026-08-28');
});
