// node --test test/   (the invoice tool <-> CRM <-> QuickBooks bridge)
import test from "node:test";
import assert from "node:assert/strict";
import { toolKeyOk, jobForTool, validatePush, qbLine, qbInvoiceBody, qbPaymentBody } from "../api/_lib/invoiceTool.js";

const KEY = "k".repeat(40);
const push = (over = {}) => ({
  docNumber: "FE-INV-2026-002",
  txnDate: "2026-10-03",
  dueDate: "2026-11-02",
  customer: { name: "Ilene Pearson", email: "ilene@example.com", phone: "651-555-0100", address: "2887 Bartelmy Ln, Maplewood, MN 55109" },
  lines: [
    { description: "Roof replacement", qtyMilli: 32500, rateCents: 65000, amountCents: 2112500 },
    { description: "Overhead (10%)", amountCents: 211250 },
    { description: "Scope: tear off to deck" },
  ],
  payments: [{ date: "2026-09-16", amountCents: 1000000, note: "Deposit at signing" }],
  crmJobId: 1779216991968,
  ...over,
});

test("tool key: required, at least 32 chars, exact match", () => {
  assert.equal(toolKeyOk({ headers: { "x-invoice-tool-key": KEY } }, KEY), true);
  assert.equal(toolKeyOk({ headers: { "x-invoice-tool-key": KEY + "x" } }, KEY), false);
  assert.equal(toolKeyOk({ headers: {} }, KEY), false);
  assert.equal(toolKeyOk({ headers: { "x-invoice-tool-key": "short" } }, "short"), false); // too short to trust
  assert.equal(toolKeyOk({ headers: { "x-invoice-tool-key": KEY } }, undefined), false); // not configured
});

test("job details for the invoice tool", () => {
  const j = jobForTool(5, { name: "Ilene Pearson", email: "i@x.com", phone: "1", address: "2887 Bartelmy Ln", city: "Maplewood", state: "MN", zip: "55109", type: "Roof", qbInvoiceDocNumber: "1001" });
  assert.equal(j.address, "2887 Bartelmy Ln, Maplewood, MN 55109");
  assert.equal(j.qbInvoiceDocNumber, "1001");
  assert.equal(jobForTool(6, { name: "A" }).address, "");
});

test("valid invoice: totals in cents, due date defaults to invoice date", () => {
  const r = validatePush(push({ dueDate: null }));
  assert.equal(r.ok, true);
  assert.equal(r.value.totalCents, 2323750);
  assert.equal(r.value.dueDate, "2026-10-03");
  assert.equal(r.value.crmJobId, 1779216991968);
});

test("rejects what QuickBooks would reject or that would be wrong", () => {
  const bad = (over) => validatePush(push(over));
  assert.equal(bad({ docNumber: "X".repeat(22) }).ok, false); // QB max 21 chars
  assert.equal(bad({ txnDate: "10/03/2026" }).ok, false);
  assert.equal(bad({ customer: { name: "" } }).ok, false);
  assert.equal(bad({ customer: { name: "A", email: "not-an-email" } }).ok, false);
  assert.equal(bad({ lines: [{ description: "Scope only" }] }).ok, false); // no amounts
  assert.equal(bad({ lines: [{ description: "Credit", amountCents: -500 }] }).ok, false); // total <= 0
  assert.equal(bad({ payments: [{ date: "2026-09-16", amountCents: 99999999 }] }).ok, false); // more than total
  assert.equal(bad({ payments: [{ date: "", amountCents: 100 }] }).ok, false);
});

test("QuickBooks lines: qty x rate only when exact; description-only lines", () => {
  const exact = qbLine({ description: "Roof", qtyMilli: 32500, rateCents: 65000, amountCents: 2112500 }, "7");
  assert.deepEqual(exact.SalesItemLineDetail, { ItemRef: { value: "7" }, Qty: 32.5, UnitPrice: 650 });
  assert.equal(exact.Amount, 21125);
  // 3 x $33.333 can't be shown exactly in cents -> 1 x amount
  const rounded = qbLine({ description: "Odd", qtyMilli: 3000, rateCents: 3333, amountCents: 10000 }, "7");
  assert.deepEqual(rounded.SalesItemLineDetail, { ItemRef: { value: "7" }, Qty: 1, UnitPrice: 100 });
  const text = qbLine({ description: "Tear off to deck", qtyMilli: null, rateCents: null, amountCents: null }, "7");
  assert.equal(text.DetailType, "DescriptionOnly");
  assert.equal(text.Amount, undefined);
});

test("invoice and payment bodies", () => {
  const v = validatePush(push()).value;
  const inv = qbInvoiceBody(v, "55", "7");
  assert.equal(inv.DocNumber, "FE-INV-2026-002");
  assert.equal(inv.CustomerRef.value, "55");
  assert.equal(inv.BillEmail.Address, "ilene@example.com");
  assert.equal(inv.Line.length, 3);
  const sum = inv.Line.reduce((s, l) => s + (l.Amount || 0), 0);
  assert.equal(Math.round(sum * 100), 2323750);
  const pay = qbPaymentBody({ Id: "99", CustomerRef: { value: "55" } }, v.payments[0]);
  assert.equal(pay.TotalAmt, 10000);
  assert.deepEqual(pay.Line[0].LinkedTxn, [{ TxnId: "99", TxnType: "Invoice" }]);
  assert.equal(pay.TxnDate, "2026-09-16");
});
