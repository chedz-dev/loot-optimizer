import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchWowheadSpanishName, localizeGuideItems } from '../server/wowhead-localization.js';

test('consulta el locale español de Wowhead', async (context) => {
  const originalFetch = globalThis.fetch;
  context.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async (url) => {
    assert.equal(url, 'https://nether.wowhead.com/tooltip/item/270164?dataEnv=1&locale=6');
    return new Response(JSON.stringify({ name: 'Bolsa sin fondo de Gebbo' }), { status: 200 });
  };
  assert.equal(await fetchWowheadSpanishName(270164), 'Bolsa sin fondo de Gebbo');
});

test('añade nombres localizados al modelo compartido de una guía', async (context) => {
  const originalFetch = globalThis.fetch;
  context.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async () => new Response(JSON.stringify({ name: 'Bolsa sin fondo de Gebbo' }), { status: 200 });
  const guides = [{ tiers: [{ items: [{ itemId: 270164, name: "Gebbo's Bottomless Bag" }] }] }];
  const result = await localizeGuideItems(guides);
  assert.equal(result.resolved, 1);
  assert.deepEqual(guides[0].tiers[0].items[0].localizedNames, {
    en: "Gebbo's Bottomless Bag",
    es: 'Bolsa sin fondo de Gebbo',
  });
});
