import { rankingItems } from './trinkets-s2.js';
import verifiedOrigins from '../data/item-origin-overrides.json' with { type: 'json' };

const editorialOriginOverrides = {
  193718: ['dungeon'],
  231424: ['raid'],
  231476: ['raid'],
  241291: ['crafting'],
  245752: ['pvp'],
  249341: ['raid'],
  249343: ['raid'],
  249809: ['raid'],
  249811: ['raid'],
  250462: ['world'],
  250144: ['dungeon'],
  250226: ['dungeon'],
  250256: ['dungeon'],
  251783: ['delves'],
  251785: ['delves'],
  268292: ['raid'],
};

const editorialDropOverrides = {
  249343: {
    encounter: 'Chimaerus',
    instance: 'The Dreamrift',
    sourceType: 'Raid',
  },
  250462: {
    encounter: "Cragpine, Lu'ashal, Predaxas or Thorm'belan",
    instance: 'Midnight World Bosses',
    sourceType: 'World',
  },
  251783: {
    encounter: '',
    instance: 'Tier 11 Delves',
    sourceType: 'Delves',
  },
  251785: {
    encounter: '',
    instance: 'Tier 11 Delves',
    sourceType: 'Delves',
  },
};

export const canonicalItemOrigins = new Map([
  ...rankingItems.map((item) => [item.itemId, [item.category === 'mythic-plus' ? 'dungeon' : 'raid']]),
  ...Object.entries(editorialOriginOverrides).map(([itemId, origins]) => [Number(itemId), origins]),
  ...verifiedOrigins.items.map((item) => [item.itemId, item.originTypes]),
]);

export const canonicalItemDropDetails = new Map([
  ...rankingItems.map((item) => [item.itemId, item.drop]),
  ...Object.entries(editorialDropOverrides).map(([itemId, drop]) => [Number(itemId), drop]),
  ...verifiedOrigins.items.map((item) => [item.itemId, item.drop]),
]);

export const canonicalItemSeasons = new Map([
  [249343, { id: 'midnight-s1', label: 'S1' }],
]);
