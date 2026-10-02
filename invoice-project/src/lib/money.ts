// All money is integer cents. Never use floating point for money.

const MAX_CENTS = 100_000_000_000; // $1 billion: anything bigger is a typo

/**
 * Parse a user-typed dollar amount ("1,234.5", "$1234.56", "-20") into
 * integer cents using string arithmetic, never floats. Returns null when the
 * text is not a valid amount.
 */
export function parseDollarsToCents(input: string | number | null | undefined): number | null {
  if (input === null || input === undefined) return null;
  let s = String(input).trim();
  if (s === "") return null;
  let negative = false;
  if (s.startsWith("(") && s.endsWith(")")) {
    negative = true;
    s = s.slice(1, -1).trim();
  }
  if (s.startsWith("-")) {
    negative = !negative;
    s = s.slice(1).trim();
  }
  s = s.replace(/^\$/, "").replace(/,/g, "").trim();
  const m = /^(\d+)(?:\.(\d{0,2}))?$/.exec(s) ?? /^()\.(\d{1,2})$/.exec(s);
  if (!m) return null;
  const whole = m[1] === "" ? 0 : Number(m[1]);
  const frac = Number((m[2] ?? "").padEnd(2, "0") || "0");
  const cents = whole * 100 + frac;
  if (!Number.isSafeInteger(cents) || cents > MAX_CENTS) return null;
  return negative ? -cents : cents;
}

/** Format cents as "$1,234.56" (or "-$1,234.56"). */
export function formatCents(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return "";
  const neg = cents < 0;
  const abs = Math.abs(Math.trunc(cents));
  const dollars = Math.floor(abs / 100).toLocaleString("en-US");
  const rem = String(abs % 100).padStart(2, "0");
  return `${neg ? "-" : ""}$${dollars}.${rem}`;
}

/** Plain "1234.56" (no $ or commas): for inputs and CSV. */
export function centsToPlain(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return "";
  const neg = cents < 0;
  const abs = Math.abs(Math.trunc(cents));
  return `${neg ? "-" : ""}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

export function sumCents(values: Array<number | null | undefined>): number {
  let total = 0;
  for (const v of values) total += v ?? 0;
  if (!Number.isSafeInteger(total)) throw new Error("Total out of range");
  return total;
}

/** Balance due = contract total + change orders − deposits. */
export function computeTotals(input: {
  contractTotalCents: number;
  depositCents: Array<number | null | undefined>;
  changeOrderCents: Array<number | null | undefined>;
}) {
  const deposits = sumCents(input.depositCents);
  const changeOrders = sumCents(input.changeOrderCents);
  return {
    contractTotalCents: input.contractTotalCents,
    depositsTotalCents: deposits,
    changeOrdersTotalCents: changeOrders,
    balanceDueCents: input.contractTotalCents + changeOrders - deposits,
  };
}

/** Integer a / b rounded half away from zero, exact (BigInt). */
function divRound(a: bigint, b: bigint): number {
  const neg = a < 0n !== b < 0n;
  const absA = a < 0n ? -a : a;
  const absB = b < 0n ? -b : b;
  const q = (absA * 2n + absB) / (absB * 2n);
  const n = Number(neg ? -q : q);
  if (!Number.isSafeInteger(n)) throw new Error("Amount out of range");
  return n;
}

/**
 * Quantity text ("32.5", "1,000", "2.125") → thousandths (32500). Up to 3
 * decimals, not negative. null when invalid.
 */
export function parseQuantityMilli(input: string | number | null | undefined): number | null {
  if (input === null || input === undefined) return null;
  const s = String(input).trim().replace(/,/g, "");
  const m = /^(\d+)(?:\.(\d{0,3}))?$/.exec(s) ?? /^()\.(\d{1,3})$/.exec(s);
  if (!m) return null;
  const milli = (m[1] === "" ? 0 : Number(m[1])) * 1000 + Number((m[2] ?? "").padEnd(3, "0") || "0");
  return Number.isSafeInteger(milli) && milli <= 1_000_000_000_000 ? milli : null;
}

export function formatQuantity(milli: number): string {
  const whole = Math.floor(milli / 1000);
  const frac = String(milli % 1000).padStart(3, "0").replace(/0+$/, "");
  return frac ? `${whole.toLocaleString("en-US")}.${frac}` : whole.toLocaleString("en-US");
}

/** qty (thousandths) × rate (cents) → cents, rounded half-up. */
export function lineAmountCents(quantityMilli: number, rateCents: number): number {
  return divRound(BigInt(quantityMilli) * BigInt(rateCents), 1000n);
}

/** Percent text ("10", "12.5") → hundredths of a percent (1250). 0–100%. */
export function parsePercentHundredths(input: string | number | null | undefined): number | null {
  if (input === null || input === undefined) return null;
  const s = String(input).trim().replace(/%$/, "").trim();
  const m = /^(\d{1,3})(?:\.(\d{0,2}))?$/.exec(s) ?? /^()\.(\d{1,2})$/.exec(s);
  if (!m) return null;
  const h = (m[1] === "" ? 0 : Number(m[1])) * 100 + Number((m[2] ?? "").padEnd(2, "0") || "0");
  return h <= 10000 ? h : null;
}

/** cents × percent (hundredths) → cents, rounded half-up. */
export function percentOfCents(cents: number, hundredths: number): number {
  return divRound(BigInt(cents) * BigInt(hundredths), 10000n);
}

export function formatPercent(hundredths: number): string {
  const s = (hundredths / 100).toFixed(2).replace(/\.?0+$/, "");
  return `${s}%`;
}

/**
 * Cost-table totals: subtotal = Σ line amounts, overhead/profit are
 * optional percentages of the subtotal, contract total = sum of all three.
 */
export function computeCostTotals(input: {
  lineAmountsCents: number[];
  overheadHundredths: number | null;
  profitHundredths: number | null;
}) {
  const subtotal = sumCents(input.lineAmountsCents);
  const overhead = input.overheadHundredths ? percentOfCents(subtotal, input.overheadHundredths) : 0;
  const profit = input.profitHundredths ? percentOfCents(subtotal, input.profitHundredths) : 0;
  return { subtotalCents: subtotal, overheadCents: overhead, profitCents: profit, contractTotalCents: subtotal + overhead + profit };
}
