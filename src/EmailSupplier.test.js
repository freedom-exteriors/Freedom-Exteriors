import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import EmailSupplier, { DEFAULT_SUPPLIER_CONTACT } from "./EmailSupplier";
import { apiFetch } from "./apiFetch";

jest.mock("./apiFetch", () => ({ apiFetch: jest.fn() }));

const JOB = {
  id: 7, name: "Jane Homeowner", phone: "651-555-0100", email: "jane@example.com",
  address: "14 Elm St", city: "Mahtomedi", state: "MN", zip: "55115", type: "Roofing",
  materials: [{ id: "a1", name: "GAF Timberline HDZ", cat: "Shingles", unit: "sq", price: 110, qty: 32 }],
  hoverMeasurements: { totalRoofArea: 3012, squares: 30.12, predominantPitch: "6/12" },
};

beforeEach(() => apiFetch.mockReset());

test("sends quantities, address and measurements to the default rep — no prices or homeowner contact", async () => {
  apiFetch.mockResolvedValue({ ok: true, json: async () => ({ success: true, sent: { sentAt: "2026-10-02T12:00:00Z", to: [DEFAULT_SUPPLIER_CONTACT.email], items: 1, measurements: true } }) });
  const onSent = jest.fn();
  render(<EmailSupplier job={JOB} onSent={onSent} />);

  fireEvent.click(screen.getByText(/Email list to supplier rep/));
  expect(screen.getByDisplayValue(DEFAULT_SUPPLIER_CONTACT.email)).toBeInTheDocument();
  expect(screen.getByText(/Delivery: 14 Elm St, Mahtomedi, MN 55115/)).toBeInTheDocument();
  fireEvent.click(screen.getByText("Send"));

  await waitFor(() => expect(onSent).toHaveBeenCalled());
  const [url, opts] = apiFetch.mock.calls[0];
  expect(url).toBe("/api/send-supplier-email");
  const body = JSON.parse(opts.body);
  expect(body.to).toBe(DEFAULT_SUPPLIER_CONTACT.email);
  expect(body.job).toEqual({ address: "14 Elm St", city: "Mahtomedi", state: "MN", zip: "55115", type: "Roofing" });
  expect(body.materials).toEqual([{ name: "GAF Timberline HDZ", cat: "Shingles", unit: "sq", qty: 32 }]);
  expect(body.measurements.totalRoofArea).toBe(3012);
  const raw = opts.body;
  for (const leaked of ["110", "Jane", "651-555-0100", "jane@example.com"]) expect(raw).not.toContain(leaked);
  expect(await screen.findByText(/Sent to mark.little@abcsupply.com/)).toBeInTheDocument();
});

test("won't send without a street address", () => {
  render(<EmailSupplier job={{ ...JOB, address: "" }} />);
  fireEvent.click(screen.getByText(/Email list to supplier rep/));
  expect(screen.getByText(/no street address on this job/)).toBeInTheDocument();
  expect(screen.getByText("Send").closest("button")).toBeDisabled();
});

test("offers to save a different address as the default contact", async () => {
  apiFetch.mockResolvedValue({ ok: true, json: async () => ({ success: true, sent: { sentAt: "2026-10-02T12:00:00Z", to: ["other@abcsupply.com"], items: 1 } }) });
  const onSaveContact = jest.fn();
  render(<EmailSupplier job={JOB} onSaveContact={onSaveContact} onSent={() => {}} />);
  fireEvent.click(screen.getByText(/Email list to supplier rep/));
  fireEvent.change(screen.getByDisplayValue(DEFAULT_SUPPLIER_CONTACT.email), { target: { value: "other@abcsupply.com" } });
  fireEvent.click(screen.getByLabelText(/Make this the default supplier contact/));
  fireEvent.click(screen.getByText("Send"));
  await waitFor(() => expect(onSaveContact).toHaveBeenCalledWith({ name: "", email: "other@abcsupply.com" }));
});
