// Distinguishable participant colors (calendar coding). Picks the first one not in use.
const PALETTE = ["#2563EB", "#16A34A", "#DB2777", "#EA580C", "#7C3AED", "#0891B2", "#CA8A04", "#DC2626", "#0D9488", "#9333EA"];

export function nextParticipantColor(inUse: string[]): string {
  const used = new Set(inUse.map((c) => c.toUpperCase()));
  return PALETTE.find((c) => !used.has(c)) ?? PALETTE[inUse.length % PALETTE.length]!;
}
