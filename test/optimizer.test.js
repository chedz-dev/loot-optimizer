import test from 'node:test';
import assert from 'node:assert/strict';
import { optimizeAssignments, scoreCandidate } from '../server/optimizer.js';

test('scoreCandidate aplica los pesos configurados', () => {
  const result = scoreCandidate({ simulation: 100, logs: 80, editorial: 50, need: 40, progression: 20 });
  assert.equal(result.total, 74.8);
});

test('la optimización global evita asignar dos drops al mismo jugador', () => {
  const result = optimizeAssignments({
    drops: [{ id: 'd1', trinketId: 'a' }, { id: 'd2', trinketId: 'b' }],
    players: [{ id: 'p1' }, { id: 'p2' }],
    candidates: [
      { trinketId: 'a', playerId: 'p1', simulation: 100 },
      { trinketId: 'a', playerId: 'p2', simulation: 80 },
      { trinketId: 'b', playerId: 'p1', simulation: 99 },
      { trinketId: 'b', playerId: 'p2', simulation: 10 },
    ],
  });
  assert.deepEqual(result.assignments.map((item) => item.playerId), ['p2', 'p1']);
});
