export const DEFAULT_WEIGHTS = Object.freeze({
  simulation: 0.4,
  logs: 0.25,
  editorial: 0.18,
  need: 0.12,
  progression: 0.05,
});

const clamp = (value) => Math.max(0, Math.min(100, Number(value) || 0));

export function scoreCandidate(candidate, weights = DEFAULT_WEIGHTS) {
  const signals = {
    simulation: clamp(candidate.simulation),
    logs: clamp(candidate.logs),
    editorial: clamp(candidate.editorial),
    need: clamp(candidate.need),
    progression: clamp(candidate.progression),
  };
  const total = Object.entries(signals).reduce(
    (sum, [key, value]) => sum + value * (weights[key] ?? 0),
    0,
  );
  return { total: Math.round(total * 10) / 10, signals };
}

export function optimizeAssignments({ drops, players, candidates, weights, onePerPlayer = true }) {
  if (!Array.isArray(drops) || !Array.isArray(players) || !Array.isArray(candidates)) {
    throw new Error('drops, players y candidates deben ser arreglos');
  }

  const playerMap = new Map(players.map((player) => [player.id, player]));
  const eligible = drops.map((drop) => candidates
    .filter((candidate) => candidate.trinketId === drop.trinketId && playerMap.has(candidate.playerId))
    .map((candidate) => ({ ...candidate, ...scoreCandidate(candidate, weights) }))
    .sort((a, b) => b.total - a.total));

  let best = { score: -1, picks: [] };
  const visit = (dropIndex, usedPlayers, score, picks) => {
    if (dropIndex === drops.length) {
      if (score > best.score) best = { score, picks: [...picks] };
      return;
    }

    const drop = drops[dropIndex];
    const options = eligible[dropIndex];
    if (!options.length) {
      visit(dropIndex + 1, usedPlayers, score, [...picks, { dropId: drop.id, unassigned: true }]);
      return;
    }

    for (const option of options) {
      if (onePerPlayer && usedPlayers.has(option.playerId)) continue;
      const nextUsed = new Set(usedPlayers);
      nextUsed.add(option.playerId);
      visit(dropIndex + 1, nextUsed, score + option.total, [
        ...picks,
        { dropId: drop.id, trinketId: drop.trinketId, ...option },
      ]);
    }
  };

  visit(0, new Set(), 0, []);
  return {
    totalScore: Math.round(Math.max(0, best.score) * 10) / 10,
    assignments: best.picks.map((pick) => ({
      ...pick,
      player: playerMap.get(pick.playerId) ?? null,
    })),
    evaluatedCandidates: eligible.reduce((sum, list) => sum + list.length, 0),
  };
}
