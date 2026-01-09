// Utility functions for seat calculations

/**
 * Get relative seat position
 * Returns the position relative to the current player (0 = bottom/self, 1 = left, 2 = top, 3 = right)
 */
export function getRelativeSeat(absoluteSeat: number, mySeat: number): number {
  return (absoluteSeat - mySeat + 4) % 4;
}

/**
 * Get absolute seat from relative position
 */
export function getAbsoluteSeat(relativeSeat: number, mySeat: number): number {
  return (mySeat + relativeSeat) % 4;
}

/**
 * Check if a player is my partner
 */
export function isMyPartner(
  seat: number,
  mySeat: number,
  teams: { team0: number[]; team1: number[] } | null | undefined
): boolean {
  if (!teams) return false;
  const myTeam = teams.team0.includes(mySeat) ? teams.team0 : teams.team1;
  return myTeam.includes(seat) && seat !== mySeat;
}
