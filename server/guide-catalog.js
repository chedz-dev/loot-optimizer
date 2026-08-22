import { allSpecs } from './spec-catalog.js';

const icyVeinsRoleSlug = (role) => role === 'tank' ? 'tank' : role === 'healer' ? 'healing' : 'dps';

export const WOWHEAD_GUIDES = allSpecs.map((spec) => ({
  ...spec,
  url: `https://www.wowhead.com/guide/classes/${spec.classId}/${spec.specId}/bis-gear`,
}));

export const ICYVEINS_GUIDES = allSpecs.map((spec) => ({
  ...spec,
  url: `https://www.icy-veins.com/wow/${spec.specId}-${spec.classId}-pve-${icyVeinsRoleSlug(spec.role)}-gear-best-in-slot`,
}));

