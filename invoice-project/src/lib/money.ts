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
