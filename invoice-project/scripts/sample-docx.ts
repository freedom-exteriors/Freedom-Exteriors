// Writes test-output/sample-invoice.docx with realistic sample data, so the
// letterhead can be checked against the reference invoice.
import { mkdirSync, writeFileSync } from "node:fs";
import { buildInvoiceDocx } from "../src/lib/docx/buildInvoiceDocx";

const buf = await buildInvoiceDocx({
  invoiceNumber: "FE-INV-2026-001",
  invoiceDate: "2026-10-02",
  dueDate: "2026-11-01",
  contractDate: "2026-08-14",
  terms: "Net 30",
  customerName: "Jane Sample",
  customerPhone: "(651) 555-0142",
  jobAddress: "123 Oak Street, Stillwater, MN 55082",
  scope: [
    "Tear off existing roof down to deck and dispose of debris",
    "Install ice & water shield at eaves and valleys",
    "Install GAF Timberline HDZ architectural shingles (Charcoal)",
    "Replace pipe boots and box vents; install ridge vent",
    "Full magnetic sweep and site cleanup",
  ],
  contractTotalCents: 1845000,
  deposits: [
    { date: "2026-08-14", description: "Deposit at signing", amountCents: 615000 },
    { date: "2026-09-20", description: "Material delivery payment", amountCents: 500000 },
  ],
  changeOrders: [
    { description: "Replace 4 sheets rotted OSB decking", amountCents: 38000 },
    { description: "Upgrade to seamless gutters (front elevation)", amountCents: 92500 },
  ],
  balanceDueCents: 1845000 + 38000 + 92500 - 615000 - 500000,
});
mkdirSync("test-output", { recursive: true });
writeFileSync("test-output/sample-invoice.docx", buf);
console.log(`wrote test-output/sample-invoice.docx (${buf.length} bytes)`);
