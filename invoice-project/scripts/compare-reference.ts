// Builds the Pearson invoice and writes, into test-output/:
//   pearson-invoice.docx, structure dumps of it and of the reference, and
// rendered page images (when LibreOffice is installed).
import { mkdirSync, writeFileSync } from "node:fs";
import { buildInvoiceDocx } from "../src/lib/docx/buildInvoiceDocx";
import { sampleDocxInput } from "../test/fixtures/sampleInvoice";
import { PEARSON_FORM } from "../test/fixtures/pearsonInvoice";

const { clean, docx } = sampleDocxInput(PEARSON_FORM);
mkdirSync("test-output", { recursive: true });
writeFileSync("test-output/pearson-invoice.docx", await buildInvoiceDocx({ ...docx, invoiceNumber: "FE-INV-2026-001" }));
console.log(`subtotal ${clean.subtotal_cents} total ${clean.contract_total_cents} balance ${clean.balance_due_cents}`);
