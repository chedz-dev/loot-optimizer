import { rankingItems } from './trinkets-s2.js';

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
  250144: ['dungeon'],
  250226: ['dungeon'],
  250256: ['dungeon'],
  268292: ['raid'],
};

const editorialDropOverrides = {
  249343: {
    encounter: 'Chimaerus',
    instance: 'The Dreamrift',
    sourceType: 'Raid',
  },
};

export const canonicalItemOrigins = new Map([
  ...rankingItems.map((item) => [item.itemId, [item.category === 'mythic-plus' ? 'dungeon' : 'raid']]),
  ...Object.entries(editorialOriginOverrides).map(([itemId, origins]) => [Number(itemId), origins]),
]);

export const canonicalItemDropDetails = new Map([
  ...rankingItems.map((item) => [item.itemId, item.drop]),
  ...Object.entries(editorialDropOverrides).map(([itemId, drop]) => [Number(itemId), drop]),
]);

export const canonicalItemSeasons = new Map([
  [249343, { id: 'midnight-s1', label: 'S1' }],
]);
