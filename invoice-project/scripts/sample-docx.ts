// Writes test-output/sample-invoice.docx with realistic sample data, so the
// letterhead can be checked against the reference estimate.
import { mkdirSync, writeFileSync } from "node:fs";
import { buildInvoiceDocx } from "../src/lib/docx/buildInvoiceDocx";
import { sampleDocxInput } from "../test/fixtures/sampleInvoice";

const buf = await buildInvoiceDocx(sampleDocxInput().docx);
mkdirSync("test-output", { recursive: true });
writeFileSync("test-output/sample-invoice.docx", buf);
console.log(`wrote test-output/sample-invoice.docx (${buf.length} bytes)`);
