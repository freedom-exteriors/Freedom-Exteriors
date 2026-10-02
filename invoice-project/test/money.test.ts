import { describe, expect, it } from "vitest";
import { computeTotals, formatCents, parseDollarsToCents, centsToPlain } from "@/lib/money";

describe("parseDollarsToCents", () => {
  it.each([
    ["1234.56", 123456], ["$1,234.56", 123456], ["1234.5", 123450], ["1234", 123400], [".5", 50],
    ["0.1", 10], ["-20", -2000], ["(20.00)", -2000], ["  $ 7.07 ", 707], ["7.07", 707],
  ])("%s → %s", (input, expected) => expect(parseDollarsToCents(input)).toBe(expected));
  it.each(["", "abc", "1.234", "1e5", "12.3.4", "$", "--5"])("rejects %s", (s) => {
    expect(parseDollarsToCents(s)).toBe(null);
  });
  it("has no float drift (0.1 + 0.2)", () => {
    expect(parseDollarsToCents("0.10")! + parseDollarsToCents("0.20")!).toBe(30);
  });
});

describe("formatting", () => {
  it("formats", () => {
    expect(formatCents(123456789)).toBe("$1,234,567.89");
    expect(formatCents(-5)).toBe("-$0.05");
    expect(centsToPlain(-123405)).toBe("-1234.05");
  });
});

describe("computeTotals", () => {
  it("balance = contract + change orders − deposits", () => {
    const t = computeTotals({ contractTotalCents: 1845000, depositCents: [615000, 500000], changeOrderCents: [38000, 92500] });
    expect(t).toEqual({ contractTotalCents: 1845000, depositsTotalCents: 1115000, changeOrdersTotalCents: 130500, balanceDueCents: 860500 });
  });
});
