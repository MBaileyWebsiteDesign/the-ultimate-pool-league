// Circle-method round-robin scheduler.
// Pairs every player against every other player exactly once ("play each
// other once"). If there's an odd number of players a bye is inserted; the
// player paired against the bye in a given round simply has no fixture that
// round. Returns an array of rounds, each an array of [playerIdA, playerIdB].
export function generateRoundRobin(playerIds) {
  if (playerIds.length < 2) return [];

  const BYE = null;
  const players = [...playerIds];
  if (players.length % 2 !== 0) players.push(BYE);

  const n = players.length;
  const fixed = players[0];
  let rotating = players.slice(1);
  const rounds = [];

  for (let round = 0; round < n - 1; round++) {
    const lineup = [fixed, ...rotating];
    const pairs = [];
    for (let i = 0; i < n / 2; i++) {
      const a = lineup[i];
      const b = lineup[n - 1 - i];
      if (a !== BYE && b !== BYE) pairs.push([a, b]);
    }
    rounds.push(pairs);
    // rotate: move last element of `rotating` to the front
    rotating.unshift(rotating.pop());
  }

  return rounds;
}
