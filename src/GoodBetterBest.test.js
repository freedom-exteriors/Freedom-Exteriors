import { calcGoodBetterBest, DEFAULT_PRICING } from "./GoodBetterBest";

jest.mock("./supabase", () => ({ supabase: {} }));

test("a missing or unpriced product falls back to the tier default", () => {
  const base = calcGoodBetterBest({ sqFt: 2000, pitch: 6, stories: 1, pricing: DEFAULT_PRICING });
  const withBad = calcGoodBetterBest({ sqFt: 2000, pitch: 6, stories: 1, pricing: DEFAULT_PRICING, baseOverrides: { good: NaN, better: 0, best: undefined } });
  expect(withBad.good.total).toBeCloseTo(base.good.total);
  expect(withBad.better.total).toBeCloseTo(base.better.total);
  expect(withBad.best.total).toBeCloseTo(base.best.total);
  expect(base.good.total).toBeGreaterThan(0);
});

test("a real product price overrides the default", () => {
  const r = calcGoodBetterBest({ sqFt: 1000, pitch: 0, stories: 1, pricing: { ...DEFAULT_PRICING, wasteFactorPct: 0 }, baseOverrides: { good: 400 } });
  expect(r.squares).toBeCloseTo(10);
  expect(r.good.perSquare).toBeCloseTo(400 * r.totalMultiplier);
});
