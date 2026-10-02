import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import EagleViewOrder from "./EagleViewOrder";
import { apiFetch } from "./apiFetch";
import { supabase } from "./supabase";

jest.mock("./apiFetch", () => ({ apiFetch: jest.fn() }));
jest.mock("./supabase", () => ({ supabase: { from: jest.fn() } }));

const JOB = { id: 7, address: "2113 Alameda St", city: "Saint Paul", state: "MN" };
const ORDER = { report_id: 52191405, order_id: 50424267, job_id: 7, env: "sandbox", product_name: "Roof (full measurements)", status: "Ordered", placed_at: "2026-10-02T17:00:00Z" };
const MEASUREMENTS = { source: "eagleview", totalRoofArea: 1522.4 };
let rows, jobData;

// Chainable stand-in for supabase.from(table).select().eq().order()/maybeSingle().
function table(name) {
  const result = name === "eagleview_orders" ? { data: rows } : { data: { data: jobData } };
  const q = { select: () => q, eq: () => q, order: () => Promise.resolve(result), maybeSingle: () => Promise.resolve(result) };
  return q;
}
const reply = (body, ok = true) => Promise.resolve({ ok, status: ok ? 200 : 400, json: async () => body });
const sent = (i) => [apiFetch.mock.calls[i][0], JSON.parse(apiFetch.mock.calls[i][1].body)];

beforeEach(() => {
  rows = [];
  jobData = {};
  supabase.from.mockImplementation(table);
  window.confirm = jest.fn(() => true);
});

test("quotes, confirms and places an order, saving the ZIP on the job", async () => {
  apiFetch
    .mockReturnValueOnce(reply({ env: "sandbox", price: 18, product: "Bid Perfect (area + pitch only)", address: "4800 Floral Park Rd, Brandywine, Maryland, 20613" }))
    .mockReturnValueOnce(reply({ order: { ...ORDER, product_name: "Bid Perfect (area + pitch only)" } }));
  const onPatch = jest.fn();
  render(<EagleViewOrder job={JOB} onPatch={onPatch} />);

  fireEvent.click(screen.getByText(/Order EagleView report/));
  fireEvent.change(screen.getByLabelText("Report type"), { target: { value: "110" } });
  fireEvent.change(screen.getByLabelText("ZIP code"), { target: { value: "55113" } });
  fireEvent.click(screen.getByText("Get price"));
  expect(await screen.findByText(/Sandbox: orders go to EagleView's test address/)).toBeInTheDocument();
  expect(sent(0)).toEqual(["/api/eagleview?action=quote", { jobId: 7, productId: 110, zip: "55113" }]);

  fireEvent.click(screen.getByText("Place order · $18.00"));
  await waitFor(() => expect(onPatch).toHaveBeenCalledWith({ zip: "55113" }));
  expect(window.confirm.mock.calls[0][0]).toMatch(/SANDBOX test order/);
  expect(sent(1)).toEqual(["/api/eagleview?action=order", { jobId: 7, productId: 110, zip: "55113", confirm: true }]);
  expect(screen.getByText(/report #52191405/)).toBeInTheDocument();
  // An order is in progress, so a second one can't be started.
  expect(screen.getByText(/Order EagleView report/).closest("button")).toBeDisabled();
});

test("nothing is ordered when the confirmation is declined", async () => {
  window.confirm = jest.fn(() => false);
  apiFetch.mockReturnValueOnce(reply({ env: "production", price: null, product: "Roof (full measurements)", address: "2113 Alameda St, Saint Paul, Minnesota, 55113" }));
  render(<EagleViewOrder job={{ ...JOB, zip: "55113" }} onPatch={jest.fn()} />);
  fireEvent.click(screen.getByText(/Order EagleView report/));
  fireEvent.click(screen.getByText("Get price"));
  fireEvent.click(await screen.findByText("Place order"));
  await waitFor(() => expect(screen.getByText("Place order")).toBeEnabled());
  expect(window.confirm.mock.calls[0][0]).toMatch(/REAL EagleView order[\s\S]*not quoted/);
  expect(apiFetch).toHaveBeenCalledTimes(1);
});

test("Check status pulls finished measurements onto the job", async () => {
  rows = [ORDER];
  jobData = { eagleviewMeasurements: MEASUREMENTS };
  apiFetch.mockReturnValueOnce(reply({ order: { ...ORDER, status_id: 5, status: "Completed", imported_at: "2026-10-02T17:05:00Z" }, imported: true }));
  const onPatch = jest.fn();
  render(<EagleViewOrder job={JOB} onPatch={onPatch} />);
  fireEvent.click(await screen.findByText("Check status"));
  await waitFor(() => expect(onPatch).toHaveBeenCalledWith({ eagleviewMeasurements: MEASUREMENTS }));
  expect(sent(0)).toEqual(["/api/eagleview?action=refresh", { reportId: 52191405, reimport: false }]);
  expect(screen.getByText(/Measurements imported/)).toBeInTheDocument();
});

test("shows the server's error", async () => {
  apiFetch.mockReturnValueOnce(reply({ error: "Enter the property's ZIP code." }, false));
  render(<EagleViewOrder job={JOB} onPatch={jest.fn()} />);
  fireEvent.click(screen.getByText(/Order EagleView report/));
  fireEvent.click(screen.getByText("Get price"));
  expect(await screen.findByText("Enter the property's ZIP code.")).toBeInTheDocument();
});
