import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const moduleSource = fs.readFileSync(new URL('../src/modules/WarcraftLogsPopularity.jsx', import.meta.url), 'utf8');
const messages = fs.readFileSync(new URL('../src/i18n.jsx', import.meta.url), 'utf8');

test('WCL reserves distribution labels and capture timestamps for the local interface', () => {
  assert.doesNotMatch(moduleSource, /wcl\.(bakedNote|dataDates|baked)['"]/);
  assert.doesNotMatch(messages, /'wcl\.(bakedNote|dataDates|baked)'/);
  assert.match(moduleSource, /!isStaticBuild && <span className="wcl-local-badge"/);
  assert.match(moduleSource, /!isStaticBuild && <div className="wcl-freshness"/);
  assert.match(moduleSource, /!isStaticBuild && result\.stale &&/);
  assert.match(moduleSource, /!isStaticBuild && <section className="panel wcl-cache-panel"/);
});

test('WCL public empty states do not instruct visitors to update a local database', () => {
  assert.match(moduleSource, /isStaticBuild \? 'wcl.noItemsPublic' : 'wcl.noItems'/);
  assert.doesNotMatch(messages, /'wcl.loading': '(Leyendo la base local|Reading the local database)/);
  assert.match(moduleSource, /result\.status === 'incomplete'/);
  assert.match(moduleSource, /t\('wcl.interpretation'\)/);
});
