import { render, screen, fireEvent } from "@testing-library/react";
import GoodBetterBest, { calcGoodBetterBest, DEFAULT_PRICING } from "./GoodBetterBest";
import {
  accessoryLine, pitchMix, measuredStories, weightedPitchPct, tierMaterialCost, abcPricingLines, applyAbcPrices,
} from "./gbbMaterials";

jest.mock("./apiFetch", () => ({ apiFetch: jest.fn() }));
jest.mock("./abcSupply", () => ({ abcSupplyGetPricing: jest.fn(), abcSupplySearchItems: jest.fn() }));

// EagleView Roof sample 68789287, as imported onto a job.
const EV = {
  source: "eagleview", reportType: "Roof", totalRoofArea: 4786.9, predominantPitch: "5/12", stories: ">1",
  pitches: [{ pitch: "5/12", area: 4016.2, percentage: 83.9 }, { pitch: "2/12", area: 438.4, percentage: 9.2 }, { pitch: "1/12", area: 332.2, percentage: 6.9 }],
  hasLengths: true, ridgeHipLength: 146.5, eavesLength: 343.3, rakeLength: 245.2, dripEdgeLength: 588.5, valleyLength: 0, stepFlashingLength: 108.4,
};
const SHINGLE = { id: 1, itemType: "shingle", manufacturer: "GAF", style: "Timberline HDZ", color: "Charcoal", ratePerSq: "", abcItemNumber: "02GASTZ3CH", abcUom: "BD", abcUnitsPerSq: "3", abcCost: 40, abcStatus: "OK" };
const RIDGE = { id: 2, itemType: "accessory", manufacturer: "Seal-A-Ridge", unit: "bundle", pricePerUnit: "90", calcMode: "length", lengthBasis: "ridgeHip", coveragePerUnit: "25", abcItemNumber: "02GASAR", abcCost: 60 };
const DRIP = { id: 3, itemType: "accessory", manufacturer: "Drip edge", unit: "piece", pricePerUnit: "15", calcMode: "length", lengthBasis: "eavesRakes", coveragePerUnit: "10" };

test("by-length accessories use measured feet, and ask for a quantity without them", () => {
  expect(accessoryLine(RIDGE, 50, "", EV)).toMatchObject({ qty: 6, lf: 146.5, needsQty: false, total: 540 }); // 146.5 / 25 → 6
  expect(accessoryLine(DRIP, 50, "", EV)).toMatchObject({ qty: 59, lf: 588.5 });
  const bidPerfect = { totalRoofArea: 1640, hasLengths: false, ridgeHipLength: null };
  expect(accessoryLine(RIDGE, 18, "4", bidPerfect)).toMatchObject({ qty: 4, needsQty: true, lf: null });
  expect(accessoryLine({ ...RIDGE, calcMode: "auto", coveragePerUnit: "4" }, 50.2, "", EV).qty).toBe(13); // per-square mode unchanged
});

test("pitch surcharge is weighted by measured area", () => {
  const mix = pitchMix(EV);
  // 83.9% at 5/12 (0%) + 16.1% at ≤2/12 (20%) → 3.2%
  expect(weightedPitchPct(mix, DEFAULT_PRICING.pitchBands)).toBe(3.2);
  const r = calcGoodBetterBest({ sqFt: 4786.9, pitch: 5, stories: 1, pricing: DEFAULT_PRICING, wastePct: 0, pitchMix: mix });
  expect(r.pitchPct).toBe(3.2);
  expect(r.pitchWeighted).toBe(true);
  expect(r.good.total).toBeCloseTo(47.869 * 650 * 1.032, 2);
  // Without a mix it's the old single-pitch behavior.
  expect(calcGoodBetterBest({ sqFt: 1000, pitch: 10, stories: 1, pricing: DEFAULT_PRICING }).pitchPct).toBe(15);
  expect(measuredStories(EV)).toBe(2);
  expect(measuredStories({ stories: "1" })).toBe(1);
});

test("material cost uses ABC costs and says what's missing", () => {
  const lines = [{ item: RIDGE, qty: 6 }, { item: DRIP, qty: 59 }];
  const { cost, missing } = tierMaterialCost({ shingle: SHINGLE, squares: 52.66, accessoryLines: lines });
  expect(cost).toBeCloseTo(52.66 * 3 * 40 + 6 * 60, 2);
  expect(missing).toEqual(["Drip edge"]);
  expect(tierMaterialCost({ shingle: null, squares: 10, accessoryLines: [] }).missing[0]).toMatch(/default rate/);
});

test("ABC refresh lines and results map back onto the catalog", () => {
  const catalog = [SHINGLE, RIDGE, DRIP, { ...SHINGLE, id: 9 }];
  expect(abcPricingLines(catalog)).toEqual([
    { itemNumber: "02GASTZ3CH", quantity: 1, uom: "BD" },
    { itemNumber: "02GASAR", quantity: 1 },
  ]);
  const next = applyAbcPrices(catalog, [
    { itemNumber: "02GASTZ3CH", uom: "BD", unitPrice: 41.5, statusCode: "OK" },
    { itemNumber: "02GASAR", uom: "BD", unitPrice: null, statusCode: "OK", statusMessage: "Branch hasn't entered pricing for this item yet" },
  ], "2026-10-02T18:00:00Z");
  expect(next[0]).toMatchObject({ abcCost: 41.5, abcStatus: "OK", abcCostAt: "2026-10-02T18:00:00Z" });
  expect(next[1]).toMatchObject({ abcCost: null, abcUom: "BD", abcStatus: "Branch hasn't entered pricing for this item yet" });
  expect(next[2]).toBe(DRIP); // not linked: untouched
});

test("calculator pre-fills from EagleView and shows staff-only ABC cost", () => {
  const onSave = jest.fn();
  const job = { id: 5, name: "Test", address: "1 Main", city: "Stillwater", state: "MN", eagleviewMeasurements: EV };
  render(<GoodBetterBest job={job} pricing={DEFAULT_PRICING} catalog={[SHINGLE, RIDGE, DRIP]} onSave={onSave} onClose={() => {}} />);
  expect(screen.getByDisplayValue("4786.9")).toBeInTheDocument();
  expect(screen.getByDisplayValue("5")).toBeInTheDocument(); // predominant pitch
  expect(screen.getByDisplayValue("2 Story")).toBeInTheDocument(); // ">1" stories → 2
  expect(screen.getByText(/area-weighted/)).toBeInTheDocument();
  fireEvent.click(screen.getAllByRole("checkbox")[0]); // ridge cap
  expect(screen.getByText(/147 LF → 6 bundles/)).toBeInTheDocument();
  expect(screen.getByText(/Internal — ABC material cost/)).toBeInTheDocument();

  fireEvent.click(screen.getAllByText(/Save/)[0]);
  const saved = onSave.mock.calls[0][0].gbb;
  expect(saved).toMatchObject({ pitchMode: "measured", wastePct: 10, stories: 2 });
  expect(JSON.stringify(saved)).not.toMatch(/abc/i); // ABC costs never saved on the job
});

test("catalog: Refresh ABC costs prices linked items at the shop's branch and saves", async () => {
  const { abcSupplyGetPricing } = require("./abcSupply");
  const { MaterialsCatalogSettings } = require("./GoodBetterBest");
  abcSupplyGetPricing.mockResolvedValue({ env: "production", fetchedAt: "2026-10-02T18:00:00Z", prices: [{ itemNumber: "02GASTZ3CH", uom: "BD", unitPrice: 42, statusCode: "OK" }] });
  const onSave = jest.fn();
  render(<MaterialsCatalogSettings catalog={[{ ...SHINGLE, abcCost: null }, DRIP]} pricing={DEFAULT_PRICING} onSave={onSave} onClose={() => {}} />);
  fireEvent.click(screen.getByText(/Refresh ABC costs/));
  expect(await screen.findByText(/Updated 1 of 1 linked items from ABC branch 354/)).toBeInTheDocument();
  expect(abcSupplyGetPricing).toHaveBeenCalledWith("2263174-2", "354", [{ itemNumber: "02GASTZ3CH", quantity: 1, uom: "BD" }]);
  expect(onSave.mock.calls[0][0][0]).toMatchObject({ abcCost: 42, abcStatus: "OK" });
  expect(screen.getByText(/\$42\.00\/BD/)).toBeInTheDocument();
});
