export const classSpecs = [
  { id: 'death-knight', name: 'Death Knight', stat: 'strength', specs: [{ id: 'blood', name: 'Blood', role: 'tank' }, { id: 'frost', name: 'Frost', role: 'dps' }, { id: 'unholy', name: 'Unholy', role: 'dps' }] },
  { id: 'demon-hunter', name: 'Demon Hunter', stat: 'hybrid', specs: [{ id: 'havoc', name: 'Havoc', role: 'dps', stat: 'agility' }, { id: 'vengeance', name: 'Vengeance', role: 'tank', stat: 'agility' }, { id: 'devourer', name: 'Devourer', role: 'dps', stat: 'intellect' }] },
  { id: 'druid', name: 'Druid', stat: 'hybrid', specs: [{ id: 'balance', name: 'Balance', role: 'dps', stat: 'intellect' }, { id: 'feral', name: 'Feral', role: 'dps', stat: 'agility' }, { id: 'guardian', name: 'Guardian', role: 'tank', stat: 'agility' }, { id: 'restoration', name: 'Restoration', role: 'healer', stat: 'intellect' }] },
  { id: 'evoker', name: 'Evoker', stat: 'intellect', specs: [{ id: 'augmentation', name: 'Augmentation', role: 'support' }, { id: 'devastation', name: 'Devastation', role: 'dps' }, { id: 'preservation', name: 'Preservation', role: 'healer' }] },
  { id: 'hunter', name: 'Hunter', stat: 'agility', specs: [{ id: 'beast-mastery', name: 'Beast Mastery', role: 'dps' }, { id: 'marksmanship', name: 'Marksmanship', role: 'dps' }, { id: 'survival', name: 'Survival', role: 'dps' }] },
  { id: 'mage', name: 'Mage', stat: 'intellect', specs: [{ id: 'arcane', name: 'Arcane', role: 'dps' }, { id: 'fire', name: 'Fire', role: 'dps' }, { id: 'frost', name: 'Frost', role: 'dps' }] },
  { id: 'monk', name: 'Monk', stat: 'hybrid', specs: [{ id: 'brewmaster', name: 'Brewmaster', role: 'tank', stat: 'agility' }, { id: 'mistweaver', name: 'Mistweaver', role: 'healer', stat: 'intellect' }, { id: 'windwalker', name: 'Windwalker', role: 'dps', stat: 'agility' }] },
  { id: 'paladin', name: 'Paladin', stat: 'hybrid', specs: [{ id: 'holy', name: 'Holy', role: 'healer', stat: 'intellect' }, { id: 'protection', name: 'Protection', role: 'tank', stat: 'strength' }, { id: 'retribution', name: 'Retribution', role: 'dps', stat: 'strength' }] },
  { id: 'priest', name: 'Priest', stat: 'intellect', specs: [{ id: 'discipline', name: 'Discipline', role: 'healer' }, { id: 'holy', name: 'Holy', role: 'healer' }, { id: 'shadow', name: 'Shadow', role: 'dps' }] },
  { id: 'rogue', name: 'Rogue', stat: 'agility', specs: [{ id: 'assassination', name: 'Assassination', role: 'dps' }, { id: 'outlaw', name: 'Outlaw', role: 'dps' }, { id: 'subtlety', name: 'Subtlety', role: 'dps' }] },
  { id: 'shaman', name: 'Shaman', stat: 'hybrid', specs: [{ id: 'elemental', name: 'Elemental', role: 'dps', stat: 'intellect' }, { id: 'enhancement', name: 'Enhancement', role: 'dps', stat: 'agility' }, { id: 'restoration', name: 'Restoration', role: 'healer', stat: 'intellect' }] },
  { id: 'warlock', name: 'Warlock', stat: 'intellect', specs: [{ id: 'affliction', name: 'Affliction', role: 'dps' }, { id: 'demonology', name: 'Demonology', role: 'dps' }, { id: 'destruction', name: 'Destruction', role: 'dps' }] },
  { id: 'warrior', name: 'Warrior', stat: 'strength', specs: [{ id: 'arms', name: 'Arms', role: 'dps' }, { id: 'fury', name: 'Fury', role: 'dps' }, { id: 'protection', name: 'Protection', role: 'tank' }] },
];

export const allSpecs = classSpecs.flatMap((wowClass) => wowClass.specs.map((spec) => ({
  id: `${wowClass.id}-${spec.id}`,
  classId: wowClass.id,
  className: wowClass.name,
  specId: spec.id,
  specName: spec.name,
  role: spec.role,
  stat: spec.stat || wowClass.stat,
})));

