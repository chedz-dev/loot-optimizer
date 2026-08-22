const icyVeinsRoleSlug = (role) => role === 'tank' ? 'tank' : role === 'healer' ? 'healing' : 'dps';

export function specGuideUrls({ classId, specId, role }) {
  return {
    wowhead: `https://www.wowhead.com/guide/classes/${classId}/${specId}/bis-gear`,
    icyveins: `https://www.icy-veins.com/wow/${specId}-${classId}-pve-${icyVeinsRoleSlug(role)}-gear-best-in-slot`,
  };
}
