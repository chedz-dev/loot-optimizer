import { rankingItems } from './trinkets-s2.js';
import { classSpecs } from './spec-catalog.js';
import { rankItemFromSignals } from './ranking-engine.js';

export { rankingItems, classSpecs };

const hashOffset = (text) => [...text].reduce((sum, char) => sum + char.charCodeAt(0), 0) % 7 - 3;

const profileFor = (item) => {
  const profile = { intellect: 84, agility: 84, strength: 84, healer: 80, tank: 80 };
  if (['intellect', 'agility', 'strength'].includes(item.focus)) profile[item.focus] = 95;
  if (item.focus === 'healer') Object.assign(profile, { intellect: 92, healer: 97, tank: 65 });
  if (item.focus === 'tank') Object.assign(profile, { tank: 97, healer: 62, agility: 88, strength: 88 });
  return profile;
};

export function getSpecRankings(classId = 'priest', specId = 'shadow', content = 'raid') {
  const wowClass = classSpecs.find((entry) => entry.id === classId);
  const spec = wowClass?.specs.find((entry) => entry.id === specId);
  if (!wowClass || !spec) throw new Error('Clase o especialización no válida');
  const stat = spec.stat || wowClass.stat;

  const rankings = rankingItems.map((item) => {
    const score = scoreItemForSpec(item, wowClass, spec, content);
    return { ...item, score, tier: score >= 93 ? 'S' : score >= 86 ? 'A' : score >= 78 ? 'B' : 'C' };
  }).sort((a, b) => b.score - a.score);

  return {
    wowClass: { id: wowClass.id, name: wowClass.name },
    spec: { id: spec.id, name: spec.name, role: spec.role, stat },
    content,
    rankings,
    metadata: { mode: 'demo', note: 'Scores demostrativos para validar el módulo y su contrato de datos.' },
  };
}

function scoreItemForSpec(item, wowClass, spec, content) {
  const stat = spec.stat || wowClass.stat;
  const profile = profileFor(item);
  const roleBase = profile[spec.role] ?? profile[stat] ?? 70;
  const statBase = profile[stat] ?? roleBase;
  const contentBonus = content === 'mythic-plus'
    ? (item.type === 'passive' ? 2 : -1)
    : (item.type === 'on-use' ? 2 : 0);
  return Math.max(50, Math.min(100, Math.round((roleBase * 0.2) + (statBase * 0.8) + contentBonus + hashOffset(`${spec.id}-${item.id}`))));
}

export function getItemRankings(itemId = 'gebbo', content = 'raid', normalizedSignals = []) {
  const item = rankingItems.find((entry) => entry.id === itemId);
  if (!item) throw new Error('Trinket no válido');
  const engine = rankItemFromSignals({ classSpecs, signals: normalizedSignals, content });

  return {
    item: { id: item.id, itemId: item.itemId, name: item.name, category: item.category, origin: item.origin, drop: item.drop, icon: item.icon, type: item.type, sources: item.sources },
    content,
    rankings: engine.rankings,
    metadata: { ...engine.metadata, normalizedSignals: normalizedSignals.length },
  };
}
