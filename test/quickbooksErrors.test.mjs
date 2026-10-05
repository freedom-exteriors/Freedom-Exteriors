// QuickBooks API errors, in QuickBooks' own response format (Fault/Error with
// code, Message, Detail and the intuit_tid header): each one is caught, the
// reason and Intuit's reference reach the user and the logs, nothing is
// half-created, and nothing crashes.
import test from "node:test";
import assert from "node:assert/strict";

const KEY = "e".repeat(48);
process.env.SUPABASE_URL = "http://supabase.test";
process.env.SUPABASE_SERVICE_KEY = "service";
process.env.QB_CLIENT_ID = "id";
process.env.QB_CLIENT_SECRET = "secret";
process.env.INVOICE_TOOL_KEY = KEY;

let scenario = "validation";
let posts = [];
const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
const fault = (code, message, detail, type = "ValidationFault") => ({ Fault: { Error: [{ Message: message, Detail: detail, code }], type } });

globalThis.fetch = async (url, init = {}) => {
  const u = new URL(String(url));
  const method = (init.method || "GET").toUpperCase();
  if (u.hostname === "supabase.test") {
    if (u.pathname.endsWith("/integration_tokens")) return json({ data: { realmId: "123", access_token: "a", refresh_token: "r", expires_at: Date.now() + 3600e3 } });
    if (u.pathname.endsWith("/jobs")) return json({ data: { name: "Test Customer" } });
  }
  if (u.hostname === "quickbooks.api.intuit.com") {
    const q = u.searchParams.get("query") || "";
    const tid = { intuit_tid: `tid-${scenario}` };
    if (method === "POST") posts.push(u.pathname);
    if (scenario === "syntax" && q) return json(fault("4000", "Error parsing query", "QueryParserError: Encountered \" <INTEGER_LITERAL>", "QueryValidationError"), 400, tid);
    if (scenario === "auth") return json({ fault: { error: [{ message: "message=AuthenticationFailed" }] } }, 401, tid);
    if (q.startsWith("select * from Invoice")) return json({ QueryResponse: {} }, 200, tid);
    if (q.startsWith("select * from Customer")) return json({ QueryResponse: { Customer: [{ Id: "55" }] } }, 200, tid);
    if (q.startsWith("select * from Item")) return json({ QueryResponse: { Item: [{ Id: "7", Name: "Exterior Services" }] } }, 200, tid);
    if (u.pathname.endsWith("/invoice")) {
      if (scenario === "validation") return json(fault("6140", "Duplicate Document Number Error", "Duplicate Document Number Error : You must specify a different number. This number has already been used. DocNumber=FE-INV-2026-002"), 400, tid);
      if (scenario === "fault-200") return json(fault("6000", "A business validation error has occurred while processing your request", "Business Validation Error: Amount is not equal to UnitPrice * Qty"), 200, tid);
    }
  }
  return json({ error: `unexpected ${method} ${url}` }, 500);
};

const { default: handler } = await import("../api/quickbooks.js");
const logged = [];
console.error = (...args) => logged.push(args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" "));

function call(body) {
  return new Promise((resolve) => {
    const res = { statusCode: 200, status(c) { this.statusCode = c; return this; }, json(b) { resolve({ status: this.statusCode, body: b }); return this; }, redirect() {} };
    handler({ method: "POST", query: { action: "tool-invoice" }, headers: { "x-invoice-tool-key": KEY }, body }, res);
  });
}
const PUSH = {
  docNumber: "FE-INV-2026-002", txnDate: "2026-10-05", dueDate: "2026-11-04",
  customer: { name: "Test Customer" },
  lines: [{ description: "Test line", qtyMilli: 1000, rateCents: 100, amountCents: 100 }],
  payments: [{ date: "2026-10-05", amountCents: 50, note: "Deposit" }],
};

test("validation error: QuickBooks' reason and reference reach the user and the logs; no payment recorded", async () => {
  scenario = "validation"; posts = []; logged.length = 0;
  const r = await call(PUSH);
  assert.equal(r.status, 502);
  assert.match(r.body.error, /Duplicate Document Number Error/);
  assert.match(r.body.error, /QuickBooks ref tid-validation/);
  assert.ok(logged.some((l) => l.includes("tid-validation") && l.includes("6140")), logged.join("\n"));
  assert.deepEqual(posts.filter((p) => p.endsWith("/payment")), []);
});

test("syntax (query) error is caught and explained, nothing is created", async () => {
  scenario = "syntax"; posts = []; logged.length = 0;
  const r = await call(PUSH);
  assert.equal(r.status, 502);
  assert.match(r.body.error, /QueryParserError/);
  assert.match(r.body.error, /tid-syntax/);
  assert.deepEqual(posts, []);
});

test("a Fault inside an HTTP 200 response is still treated as an error", async () => {
  scenario = "fault-200"; posts = []; logged.length = 0;
  const r = await call(PUSH);
  assert.equal(r.status, 502);
  assert.match(r.body.error, /Amount is not equal to UnitPrice \* Qty/);
  assert.deepEqual(posts.filter((p) => p.endsWith("/payment")), []);
});

test("expired or revoked login asks to reconnect", async () => {
  scenario = "auth"; posts = []; logged.length = 0;
  const r = await call(PUSH);
  assert.equal(r.status, 409);
  assert.match(r.body.error, /reconnect/i);
});
