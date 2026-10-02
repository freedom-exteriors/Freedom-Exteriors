import { render, screen, fireEvent } from "@testing-library/react";
import GoodBetterBest, { calcGoodBetterBest, DEFAULT_PRICING } from "./GoodBetterBest";
import { pitchMix, measuredStories, weightedPitchPct } from "./gbbMeasured";

jest.mock("./apiFetch", () => ({ apiFetch: jest.fn() }));

// EagleView Roof sample 68789287, as imported onto a job.
const EV = {
  source: "eagleview", totalRoofArea: 4786.9, predominantPitch: "5/12", stories: ">1", suggestedWastePct: 12,
  pitches: [{ pitch: "5/12", area: 4016.2 }, { pitch: "2/12", area: 438.4 }, { pitch: "1/12", area: 332.2 }],
};
const JOB = { id: 5, name: "Test", address: "1 Main", city: "Stillwater", state: "MN", eagleviewMeasurements: EV };

test("pitch surcharge is weighted by measured area", () => {
  // 83.9% at 5/12 (0%) + 16.1% at 2/12 and under (20%) → 3.2%
  expect(weightedPitchPct(pitchMix(EV), DEFAULT_PRICING.pitchBands)).toBe(3.2);
  const r = calcGoodBetterBest({ sqFt: 4786.9, pitch: 5, stories: 1, pricing: DEFAULT_PRICING, wastePct: 12, pitchMix: pitchMix(EV) });
  expect(r.pitchPct).toBe(3.2);
  expect(r.squares).toBeCloseTo(47.869 * 1.12, 4);
  // No report: exactly the old math.
  const old = calcGoodBetterBest({ sqFt: 1000, pitch: 10, stories: 1, pricing: DEFAULT_PRICING });
  expect(old.pitchPct).toBe(15);
  expect(old.squares).toBeCloseTo(11, 6);
  expect(measuredStories(EV)).toBe(2);
});

test("same screen, filled in from the report", () => {
  render(<GoodBetterBest job={JOB} pricing={DEFAULT_PRICING} catalog={[]} onSave={() => {}} onClose={() => {}} />);
  expect(screen.getByDisplayValue("4786.9")).toBeInTheDocument();
  expect(screen.getByDisplayValue("5")).toBeInTheDocument();
  expect(screen.getByDisplayValue("2 Story")).toBeInTheDocument();
  expect(screen.getByText("53.61")).toBeInTheDocument(); // 4786.9 sq ft + 12% report waste
  expect(screen.getByText("+3.2%")).toBeInTheDocument();
  // Typing a different pitch goes back to the simple single-pitch math and the default waste.
  fireEvent.change(screen.getByDisplayValue("5"), { target: { value: "10" } });
  expect(screen.getByText("+15%")).toBeInTheDocument();
  expect(screen.getByText("52.66")).toBeInTheDocument();
});
