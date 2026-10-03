// End-to-end check of /api/quickbooks?action=tool-invoice with QuickBooks and
// Supabase faked at the fetch level: right calls, in the right order, once.
import test from "node:test";
import assert from "node:assert/strict";

const KEY = "t".repeat(48);
process.env.SUPABASE_URL = "http://supabase.test";
process.env.SUPABASE_SERVICE_KEY = "service";
process.env.QB_CLIENT_ID = "id";
process.env.QB_CLIENT_SECRET = "secret";
process.env.INVOICE_TOOL_KEY = KEY;

let calls = [];
let qbInvoices = []; // invoices "in QuickBooks"
let job = { name: "Ilene Pearson", email: "ilene@example.com" };
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

globalThis.fetch = async (url, init = {}) => {
  const u = new URL(String(url));
  const method = (init.method || "GET").toUpperCase();
  const body = init.body ? JSON.parse(init.body) : null;
  calls.push(`${method} ${u.hostname}${u.pathname}${u.searchParams.get("query") ? " " + u.searchParams.get("query") : ""}`);
  if (u.hostname === "supabase.test") {
    if (u.pathname.endsWith("/integration_tokens")) return json({ data: { realmId: "123", access_token: "a", refresh_token: "r", expires_at: Date.now() + 3600e3 } });
    if (u.pathname.endsWith("/jobs") && method === "GET") return json({ data: job });
    if (u.pathname.endsWith("/jobs") && method === "PATCH") { job = body.data; return json([]); }
  }
  if (u.hostname === "quickbooks.api.intuit.com") {
    const q = u.searchParams.get("query") || "";
    if (q.startsWith("select * from Invoice")) {
      const found = qbInvoices.filter((i) => i.DocNumber === /DocNumber = '(.*)'/.exec(q)[1]);
      return json({ QueryResponse: found.length ? { Invoice: found } : {} });
    }
    if (q.startsWith("select * from Customer")) return json({ QueryResponse: {} });
    if (q.startsWith("select * from Item")) return json({ QueryResponse: { Item: [{ Id: "7", Name: "Exterior Services" }] } });
    if (u.pathname.endsWith("/customer")) return json({ Customer: { Id: "55" } });
    if (u.pathname.endsWith("/invoice")) {
      const total = body.Line.reduce((s, l) => s + (l.Amount || 0), 0);
      const inv = { ...body, Id: "99", TotalAmt: total, Balance: total };
      qbInvoices = [inv];
      return json({ Invoice: inv });
    }
    if (u.pathname.endsWith("/payment")) { qbInvoices[0].Balance -= body.TotalAmt; return json({ Payment: { Id: "p" } }); }
  }
  return json({ error: `unexpected ${method} ${url}` }, 500);
};

const { default: handler } = await import("../api/quickbooks.js");

function call(action, body, key = KEY) {
  return new Promise((resolve) => {
    const res = { statusCode: 200, status(c) { this.statusCode = c; return this; }, json(b) { resolve({ status: this.statusCode, body: b }); return this; }, redirect() {} };
    handler({ method: "POST", query: { action }, headers: key ? { "x-invoice-tool-key": key } : {}, body }, res);
  });
}

const PUSH = {
  docNumber: "FE-INV-2026-002", txnDate: "2026-10-03", dueDate: "2026-11-02",
  customer: { name: "Ilene Pearson", email: "ilene@example.com" },
  lines: [{ description: "Deck rebuild", qtyMilli: 1000, rateCents: 1000000, amountCents: 1000000 }],
  payments: [{ date: "2026-09-16", amountCents: 400000, note: "Deposit" }],
  crmJobId: 42,
};

test("wrong or missing key is refused before anything else", async () => {
  calls = [];
  assert.equal((await call("tool-invoice", PUSH, "x".repeat(48))).status, 401);
  assert.equal((await call("tool-invoice", PUSH, null)).status, 401);
  assert.deepEqual(calls, []);
});

test("creates customer, invoice and deposit payment, then marks the CRM job", async () => {
  calls = [];
  const r = await call("tool-invoice", PUSH);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.created, true);
  assert.equal(r.body.paymentsRecorded, 1);
  assert.equal(r.body.docNumber, "FE-INV-2026-002");
  assert.equal(qbInvoices[0].Balance, 6000);
  assert.equal(job.qbInvoiceId, "99");
  assert.equal(job.qbInvoiceDocNumber, "FE-INV-2026-002");
  assert.equal(calls.filter((c) => c.includes("/invoice")).length, 1);
});

test("sending again never duplicates the invoice or the deposit", async () => {
  calls = [];
  const r = await call("tool-invoice", PUSH);
  assert.equal(r.status, 200);
  assert.equal(r.body.created, false);
  assert.equal(r.body.paymentsRecorded, 0);
  assert.equal(r.body.paymentsSkipped, 1);
  assert.equal(calls.some((c) => c.startsWith("POST quickbooks.api.intuit.com") ), false);
  assert.equal(qbInvoices[0].Balance, 6000);
});

test("final payment is capped at the QuickBooks balance", async () => {
  const r = await call("tool-payment", { docNumber: "FE-INV-2026-002", date: "2026-10-20", amountCents: 999999 });
  assert.equal(r.status, 200);
  assert.equal(r.body.amountCents, 600000);
  assert.equal(qbInvoices[0].Balance, 0);
  const again = await call("tool-payment", { docNumber: "FE-INV-2026-002", date: "2026-10-21", amountCents: 100 });
  assert.equal(again.body.alreadyPaid, true);
});

test("status: live, then voided in QuickBooks, then deleted", async () => {
  let r = await call("tool-status", { docNumber: "FE-INV-2026-002" });
  assert.deepEqual([r.body.exists, r.body.voided], [true, false]);
  qbInvoices[0].TotalAmt = 0; qbInvoices[0].Balance = 0; qbInvoices[0].PrivateNote = "Voided";
  r = await call("tool-status", { docNumber: "FE-INV-2026-002" });
  assert.deepEqual([r.body.exists, r.body.voided], [true, true]);
  r = await call("tool-status", { docNumber: "FE-INV-2026-999" });
  assert.deepEqual([r.body.exists, r.body.voided], [false, false]);
});

test("job lookup returns the customer details", async () => {
  job = { name: "Zeke Lawson", email: "z@example.com", phone: "414", address: "231 Longfellow St NE", city: "Fridley", state: "MN" };
  const r = await call("tool-job", { jobId: 42 });
  assert.equal(r.status, 200);
  assert.equal(r.body.job.address, "231 Longfellow St NE, Fridley, MN");
});
