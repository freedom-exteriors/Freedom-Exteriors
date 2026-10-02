import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import EagleViewImport from "./EagleViewImport";
import EmailSupplier from "./EmailSupplier";
import { roofMeasurements } from "./measurements";
import { apiFetch } from "./apiFetch";
import { supabase } from "./supabase";

jest.mock("./apiFetch", () => ({ apiFetch: jest.fn() }));
jest.mock("./supabase", () => ({ supabase: { storage: { from: jest.fn() } } }));
// CRA resets mock implementations before each test, so the bucket is rebuilt here.
let bucket;

// What /api/eagleview returns for the sample Bid Perfect report (73600100).
const BID_PERFECT = {
  source: "eagleview", reportType: "Bid Perfect", reportNumber: "73600100", address: "2113 Alameda St, Saint Paul, MN 55113",
  totalRoofArea: 1640, squares: 16.4, facets: 6, suggestedWastePct: 11.7, predominantPitch: "10/12",
  pitches: [{ pitch: "10/12", area: 990, percentage: 60.4 }, { pitch: "4/12", area: 540, percentage: 32.9 }, { pitch: "7/12", area: 110, percentage: 6.7 }],
  hasLengths: false, ridgeHipLength: null, valleyLength: null, eavesLength: null, rakeLength: null, dripEdgeLength: null,
  warnings: ["This report has no ridge/hip/valley/eave/rake lengths (e.g. Bid Perfect). Area and pitch are fine for pricing; order a Premium Roof report for a full material takeoff."],
  pdfPath: "7/eagleview-1.pdf",
};
const JOB = { id: 7, address: "2113 Alameda St", city: "Saint Paul", state: "MN", type: "Roofing", materials: [] };

beforeEach(() => {
  bucket = { upload: jest.fn(), remove: jest.fn(() => Promise.resolve({})), createSignedUrl: jest.fn() };
  supabase.storage.from.mockReturnValue(bucket);
});

test("uploads the PDF under the job, reads it, and hands back the measurements", async () => {
  bucket.upload.mockResolvedValue({ error: null });
  apiFetch.mockResolvedValue({ ok: true, json: async () => ({ measurements: BID_PERFECT }) });
  const onImported = jest.fn();
  const { container } = render(<EagleViewImport job={JOB} onImported={onImported} />);
  const file = new File(["%PDF-1.4"], "73600100.PDF", { type: "application/pdf" });
  fireEvent.change(container.querySelector('input[type="file"]'), { target: { files: [file] } });

  await waitFor(() => expect(onImported).toHaveBeenCalled());
  const [path] = bucket.upload.mock.calls[0];
  expect(path).toMatch(/^7\/eagleview-\d+\.pdf$/);
  expect(JSON.parse(apiFetch.mock.calls[0][1].body)).toEqual({ jobId: 7, pdfPath: path });
  expect(onImported.mock.calls[0][0]).toMatchObject({ totalRoofArea: 1640, fileName: "73600100.PDF" });
});

test("shows area, pitch and the missing-lengths warning; no invented lengths", () => {
  render(<EagleViewImport job={{ ...JOB, eagleviewMeasurements: BID_PERFECT }} onImported={() => {}} />);
  expect(screen.getByText(/EagleView Bid Perfect #73600100/)).toBeInTheDocument();
  expect(screen.getByText("1,640 sq ft (16.4 SQ)")).toBeInTheDocument();
  expect(screen.getByText("10/12 60%, 4/12 33%, 7/12 7%")).toBeInTheDocument();
  expect(screen.getByText(/order a Premium Roof report/)).toBeInTheDocument();
  expect(screen.queryByText(/Ridges \+ hips/)).not.toBeInTheDocument();
});

test("a failed read removes the uploaded PDF and says why", async () => {
  bucket.upload.mockResolvedValue({ error: null });
  apiFetch.mockResolvedValue({ ok: false, status: 500, json: async () => ({ error: "Couldn't read measurements from this PDF. Is it an EagleView report?" }) });
  const { container } = render(<EagleViewImport job={JOB} onImported={() => {}} />);
  fireEvent.change(container.querySelector('input[type="file"]'), { target: { files: [new File(["x"], "r.pdf", { type: "application/pdf" })] } });
  expect(await screen.findByText(/Is it an EagleView report/)).toBeInTheDocument();
  expect(bucket.remove).toHaveBeenCalled();
});

test("Hover wins when both exist; EagleView fills in when Hover is missing", () => {
  const hover = { totalRoofArea: 2000 };
  expect(roofMeasurements({ hoverMeasurements: hover, eagleviewMeasurements: BID_PERFECT })).toBe(hover);
  expect(roofMeasurements({ eagleviewMeasurements: BID_PERFECT })).toBe(BID_PERFECT);
  expect(roofMeasurements({})).toBeNull();
});

test("supplier email can include EagleView measurements", async () => {
  apiFetch.mockResolvedValue({ ok: true, json: async () => ({ success: true, sent: { sentAt: "2026-10-02T12:00:00Z", to: ["mark.little@abcsupply.com"], items: 0, measurements: true } }) });
  render(<EmailSupplier job={{ ...JOB, eagleviewMeasurements: BID_PERFECT }} onSent={() => {}} />);
  fireEvent.click(screen.getByText(/Email list to supplier rep/));
  expect(screen.getByLabelText(/Include roof measurements \(EagleView\)/)).toBeChecked();
  fireEvent.click(screen.getByText("Send"));
  await waitFor(() => expect(apiFetch).toHaveBeenCalled());
  expect(JSON.parse(apiFetch.mock.calls[0][1].body).measurements.reportNumber).toBe("73600100");
});
