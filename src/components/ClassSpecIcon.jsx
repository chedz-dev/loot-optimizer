const WOWHEAD_ICON_ROOT = 'https://wow.zamimg.com/images/wow/icons/large';
const FALLBACK_ICON = `${WOWHEAD_ICON_ROOT}/inv_misc_questionmark.jpg`;

const classIcons = {
  'death-knight': 'classicon_deathknight',
  'demon-hunter': 'classicon_demonhunter',
  druid: 'classicon_druid',
  evoker: 'classicon_evoker',
  hunter: 'classicon_hunter',
  mage: 'classicon_mage',
  monk: 'classicon_monk',
  paladin: 'classicon_paladin',
  priest: 'classicon_priest',
  rogue: 'classicon_rogue',
  shaman: 'classicon_shaman',
  warlock: 'classicon_warlock',
  warrior: 'classicon_warrior',
};

const specIcons = {
  'death-knight': { blood: 'spell_deathknight_bloodpresence', frost: 'spell_deathknight_frostpresence', unholy: 'spell_deathknight_unholypresence' },
  'demon-hunter': { havoc: 'ability_demonhunter_specdps', vengeance: 'ability_demonhunter_spectank' },
  druid: { balance: 'spell_nature_starfall', feral: 'ability_druid_catform', guardian: 'ability_racial_bearform', restoration: 'spell_nature_healingtouch' },
  evoker: { devastation: 'classicon_evoker_devastation', preservation: 'classicon_evoker_preservation', augmentation: 'classicon_evoker_augmentation' },
  hunter: { 'beast-mastery': 'ability_hunter_bestialdiscipline', marksmanship: 'ability_hunter_focusedaim', survival: 'ability_hunter_camouflage' },
  mage: { arcane: 'spell_holy_magicalsentry', fire: 'spell_fire_firebolt02', frost: 'spell_frost_frostbolt02' },
  monk: { brewmaster: 'spell_monk_brewmaster_spec', mistweaver: 'spell_monk_mistweaver_spec', windwalker: 'spell_monk_windwalker_spec' },
  paladin: { holy: 'spell_holy_holybolt', protection: 'ability_paladin_shieldofthetemplar', retribution: 'spell_holy_auraoflight' },
  priest: { discipline: 'spell_holy_powerwordshield', holy: 'spell_holy_guardianspirit', shadow: 'spell_shadow_shadowwordpain' },
  rogue: { assassination: 'ability_rogue_deadlybrew', outlaw: 'inv_sword_30', subtlety: 'ability_stealth' },
  shaman: { elemental: 'spell_nature_lightning', enhancement: 'spell_shaman_improvedstormstrike', restoration: 'spell_nature_magicimmunity' },
  warlock: { affliction: 'spell_shadow_deathcoil', demonology: 'spell_shadow_metamorphosis', destruction: 'spell_shadow_rainoffire' },
  warrior: { arms: 'ability_warrior_savageblow', fury: 'ability_warrior_innerrage', protection: 'ability_warrior_defensivestance' },
};

const devourerIcon = 'https://render.worldofwarcraft.com/us/icons/56/7455385.jpg';

const iconUrl = (classId, specId) => {
  if (classId === 'demon-hunter' && specId === 'devourer') return devourerIcon;
  const icon = specId ? specIcons[classId]?.[specId] : classIcons[classId];
  return icon ? `${WOWHEAD_ICON_ROOT}/${icon}.jpg` : FALLBACK_ICON;
};

export default function ClassSpecIcon({ classId, specId, label, kind = 'class' }) {
  const isSpec = kind === 'spec';
  const fallback = isSpec ? iconUrl(classId) : FALLBACK_ICON;
  return (
    <span className={`wow-identity-icon ${isSpec ? 'spec-identity-icon' : 'class-identity-icon'}`} title={label}>
      <img src={iconUrl(classId, isSpec ? specId : undefined)} alt={`Ícono de ${label}`} onError={(event) => { event.currentTarget.src = fallback; }} />
    </span>
  );
}
