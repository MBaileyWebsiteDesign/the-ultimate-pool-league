// Single-elimination bracket seeding.
//
// Returns an array of rounds. Round 0 is the first round: each entry is a
// pair `[entrantA, entrantB]` where either side may be `null` if there
// weren't enough entrants to fill the bracket evenly (a "bye" - the other
// side advances automatically, no match played). Rounds after the first are
// returned only as a *count* of matches (pairs of `null`), since who plays
// in them depends on results that don't exist yet - the caller links
// fixtures across rounds via nextFixtureId/nextFixtureSlot instead.
//
// No real seeding (e.g. by past performance) is implemented - entrants are
// paired in the order they're given, byes falling on the tail end of the
// list. That's a reasonable v1 default; proper seeding is a small, isolated
// improvement for later (sort `entrantIds` before calling this).
export function buildBracketRounds(entrantIds) {
  if (entrantIds.length < 2) return [];

  let bracketSize = 1;
  while (bracketSize < entrantIds.length) bracketSize *= 2;

  const pairsCount = bracketSize / 2;
  const byes = bracketSize - entrantIds.length;
  // `byes` is always < pairsCount (bracketSize is the *smallest* power of 2 that
  // fits the entrants, so more than half the bracket is always real entrants).
  // Spreading one bye per pair - rather than padding all the nulls onto the
  // tail and slicing into pairs of 2 - guarantees no pair ends up as
  // bye-vs-bye, which would be an unplayable fixture with no possible winner.
  const firstRoundPairs = [];
  let idx = 0;
  for (let p = 0; p < pairsCount; p++) {
    const isByePair = p >= pairsCount - byes;
    if (isByePair) {
      firstRoundPairs.push([entrantIds[idx], null]);
      idx += 1;
    } else {
      firstRoundPairs.push([entrantIds[idx], entrantIds[idx + 1]]);
      idx += 2;
    }
  }

  const rounds = [firstRoundPairs];
  let roundSize = pairsCount;
  while (roundSize >= 2) {
    roundSize = roundSize / 2;
    rounds.push(Array.from({ length: roundSize }, () => [null, null]));
  }
  return rounds;
}
