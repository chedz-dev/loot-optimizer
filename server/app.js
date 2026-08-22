import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { demo } from './demo-data.js';
import { DEFAULT_WEIGHTS, optimizeAssignments } from './optimizer.js';
import { getRaiderIoCharacter, getSourceStatus } from './sources.js';
import { classSpecs, getItemRankings, getSpecRankings, rankingItems } from './rankings-data.js';
import { getWowheadTierlists } from './wowhead-tierlists.js';
import { getIcyVeinsTierlists } from './icyveins-tierlists.js';
import { getCanonicalItem, getEditorialDataStatus, getRankingSignalsForItem } from './editorial-store.js';

const withLocalizedName = (item) => {
  const canonical = getCanonicalItem(item.itemId);
  return canonical?.localizedNames ? { ...item, localizedNames: canonical.localizedNames } : item;
};

const app = express();

app.use(cors());
app.use(express.json({ limit: '1mb' }));

app.get('/api/health', (_req, res) => res.json({ ok: true, service: 'loot-council-optimizer' }));
app.get('/api/sources', (_req, res) => res.json({ sources: getSourceStatus() }));
app.get('/api/demo', (_req, res) => res.json({ ...demo, weights: DEFAULT_WEIGHTS }));
app.get('/api/rankings/catalog', (_req, res) => res.json({
  classes: classSpecs,
  items: rankingItems.map(({ profile, ...item }) => withLocalizedName(item)),
}));
app.get('/api/rankings', (req, res) => {
  try {
    return res.json(getSpecRankings(req.query.class, req.query.spec, req.query.content));
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
});
app.get('/api/rankings/item', async (req, res) => {
  try {
    const base = getItemRankings(req.query.item, req.query.content);
    await Promise.allSettled([getWowheadTierlists(), getIcyVeinsTierlists()]);
    const signals = getRankingSignalsForItem(base.item.itemId);
    const result = getItemRankings(req.query.item, req.query.content, signals);
    return res.json({ ...result, item: withLocalizedName(result.item) });
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
});
app.get('/api/wowhead/tierlists', async (_req, res) => {
  try {
    return res.json(await getWowheadTierlists());
  } catch (error) {
    return res.status(502).json({ error: `Wowhead: ${error.message}` });
  }
});
app.get('/api/icyveins/tierlists', async (_req, res) => {
  try {
    return res.json(await getIcyVeinsTierlists());
  } catch (error) {
    return res.status(502).json({ error: `Icy Veins: ${error.message}` });
  }
});
app.get('/api/editorial-data/status', (_req, res) => res.json(getEditorialDataStatus()));

app.get('/api/raiderio/character', async (req, res) => {
  const { region, realm, name } = req.query;
  if (!region || !realm || !name) return res.status(400).json({ error: 'region, realm y name son obligatorios' });
  try {
    const character = await getRaiderIoCharacter({ region, realm, name });
    return res.json(character);
  } catch (error) {
    return res.status(502).json({ error: `Raider.IO: ${error.message}` });
  }
});

app.post('/api/optimize', (req, res) => {
  try {
    return res.json(optimizeAssignments(req.body));
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
});

export default app;
