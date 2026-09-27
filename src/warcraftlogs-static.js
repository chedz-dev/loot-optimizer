const pick = (value, keys) => Object.fromEntries(keys
  .filter(key => value != null && Object.hasOwn(value, key))
  .map(key => [key, value[key]]));

export const publicWclRoutes = ['catalog', 'popularity', 'items', 'item'];
export const wclContextKey = context => ['zoneId', 'encounterId', 'difficulty', 'partition']
  .map(key => String(context[key] ?? 0)).join(':');

// Conserva cada elección solo cuando existe una muestra para esa combinación.
export function selectStaticWclContext(contexts = [], selection = {}) {
  let available = contexts;

  for (const key of ['zoneId', 'encounterId', 'difficulty', 'partition']) {
    const matching = available.filter(context => String(context[key]) === String(selection?.[key]));

    if (matching.length) {
      available = matching;
    } else if (available.length) {
      available = available.filter(context => context[key] === available[0][key]);
    }
  }

  return available[0] || null;
}

// Solo copia campos de presentación, incluidos los objetos anidados.
export function publicWclItem(item) {
  return {
    ...pick(item, ['itemId', 'name', 'icon', 'count', 'popularity', 'averageItemLevel']),
    localizedNames: pick(item.localizedNames, ['en', 'es']),
    wowheadUrl: `https://www.wowhead.com/item=${item.itemId}`,
    originTypes: (item.originTypes || []).filter(value => ['raid', 'dungeon', 'delves', 'lair', 'world', 'crafting', 'pvp'].includes(value)),
    drop: item.drop ? pick(item.drop, ['encounter', 'instance', 'sourceType']) : null,
    season: item.season ? pick(item.season, ['id', 'label']) : null,
    seasonClassification: pick(item.seasonClassification, ['status', 'seasonId', 'label', 'referenceSeasonId']),
  };
}

export function publicWclSnapshot(snapshot) {
  const context = pick(snapshot.context, ['zoneId', 'zoneName', 'encounterId', 'encounterName',
    'difficulty', 'difficultyName', 'partition', 'partitionName', 'contentType', 'region']);
  const spec = pick(snapshot.spec, ['classId', 'className', 'specId', 'specName', 'role']);
  const params = new URLSearchParams({
    boss: context.encounterId,
    difficulty: context.difficulty,
    partition: context.partition,
    class: spec.className.replaceAll(' ', ''),
    spec: spec.specName.replaceAll(' ', ''),
    metric: snapshot.metric,
  });

  return {
    context,
    spec,
    ...pick(snapshot, ['metric', 'targetSampleSize', 'rankingRows', 'validCharacters', 'status']),
    capturedAt: snapshot.capturedAt || snapshot.fetchedAt,
    sourceUrl: `https://www.warcraftlogs.com/zone/rankings/${context.zoneId}?${params}`,
    items: snapshot.items.map(publicWclItem),
  };
}

export function publicWclDataset(data) {
  return {
    schemaVersion: 1,
    totalSpecs: data.totalSpecs,
    currentItemSeason: pick(data.currentItemSeason, ['id', 'name', 'label']),
    snapshots: data.snapshots.map(publicWclSnapshot),
  };
}

// Construye los selectores únicamente con encuentros presentes en el baked.
export function staticWclCatalog(data) {
  const contexts = [...new Map(data.snapshots.map(snapshot => [wclContextKey(snapshot.context), snapshot.context])).values()];
  const zones = [];
  const classes = [];

  for (const context of contexts) {
    let zone = zones.find(entry => entry.id === context.zoneId);

    if (!zone) {
      zone = { id: context.zoneId, name: context.zoneName, encounters: [], difficulties: [], partitions: [] };
      zones.push(zone);
    }

    for (const [list, id, name] of [['encounters', context.encounterId, context.encounterName],
      ['difficulties', context.difficulty, context.difficultyName], ['partitions', context.partition, context.partitionName]]) {
      if (!zone[list].some(entry => entry.id === id)) {
        zone[list].push({ id, name });
      }
    }
  }

  for (const { spec } of data.snapshots) {
    let wowClass = classes.find(entry => entry.id === spec.classId);

    if (!wowClass) {
      wowClass = { id: spec.classId, name: spec.className, specs: [] };
      classes.push(wowClass);
    }

    if (!wowClass.specs.some(entry => entry.id === spec.specId)) {
      wowClass.specs.push({ id: spec.specId, name: spec.specName, role: spec.role });
    }
  }

  const dates = data.snapshots.map(snapshot => snapshot.capturedAt).sort();

  return {
    zones,
    classes: classes.sort((a, b) => a.name.localeCompare(b.name)),
    contexts,
    defaultContext: contexts[0] || null,
    currentItemSeason: data.currentItemSeason,
    oldestCaptureAt: dates[0] || null,
    newestCaptureAt: dates.at(-1) || null,
  };
}

// Responde las mismas consultas de lectura que el módulo local sin usar la API.
export function staticWclResponse(data, url) {
  const route = url.pathname.split('/').at(-1);

  if (!publicWclRoutes.includes(route)) {
    return { status: 404, payload: { code: 'STATIC_UNAVAILABLE' } };
  }

  const catalog = staticWclCatalog(data);

  if (route === 'catalog') {
    return { status: 200, payload: catalog };
  }

  const input = Object.fromEntries(url.searchParams);
  const context = catalog.contexts.find(entry => wclContextKey(entry) === wclContextKey(input));
  const missing = { status: 404, payload: { code: 'CACHE_MISS' } };

  if (!context) {
    return missing;
  }

  const values = data.snapshots.filter(snapshot => wclContextKey(snapshot.context) === wclContextKey(context));
  const totalSpecs = data.totalSpecs;

  if (route === 'popularity') {
    const snapshot = values.find(entry => entry.spec.classId === input.classId && entry.spec.specId === input.specId);
    return snapshot ? { status: 200, payload: snapshot } : missing;
  }

  const validCharacters = values.reduce((total, snapshot) => total + snapshot.validCharacters, 0);
  const items = new Map();

  for (const snapshot of values) {
    for (const item of snapshot.items) {
      const entry = items.get(item.itemId) || { ...item, count: 0, validCharacters };
      entry.count += snapshot.validCharacters > 0 ? item.count : 0;
      items.set(item.itemId, entry);
    }
  }

  if (route === 'items') {
    const sorted = [...items.values()].map(item => ({
      ...item,
      popularity: validCharacters ? item.count / validCharacters * 100 : 0,
    })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name) || a.itemId - b.itemId);

    return { status: 200, payload: { context, items: sorted, snapshots: values.length, totalSpecs } };
  }

  const item = items.get(Number(input.itemId));

  if (!item) {
    return missing;
  }

  const rankings = values.filter(snapshot => snapshot.validCharacters > 0).map(snapshot => {
    const observed = snapshot.items.find(entry => entry.itemId === item.itemId);

    return {
      ...snapshot.spec,
      count: observed?.count || 0,
      popularity: observed?.popularity || 0,
      validCharacters: snapshot.validCharacters,
      metric: snapshot.metric,
      capturedAt: snapshot.capturedAt,
      sourceUrl: snapshot.sourceUrl,
    };
  }).sort((a, b) => b.popularity - a.popularity || b.validCharacters - a.validCharacters || a.className.localeCompare(b.className));

  return { status: 200, payload: {
    item,
    context,
    rankings,
    coverage: { availableSpecs: values.length, totalSpecs, measuredSpecs: rankings.length },
  } };
}
