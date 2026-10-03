// Writes PDF samples into test-output/ (sample invoice, the Pearson content
// as an invoice and as an estimate), for checking against the .docx.
import { mkdirSync, writeFileSync } from "node:fs";
import { buildEstimatePdf, buildInvoicePdf } from "../src/lib/pdf/buildPdf";
import { estimatePaymentTerms } from "../src/lib/estimate";
import { sampleDocxInput } from "../test/fixtures/sampleInvoice";
import { PEARSON_FORM } from "../test/fixtures/pearsonInvoice";

mkdirSync("test-output", { recursive: true });
const write = (name: string, buf: Buffer) => {
  writeFileSync(`test-output/${name}`, buf);
  console.log(`wrote test-output/${name} (${buf.length} bytes)`);
};
write("sample-invoice.pdf", await buildInvoicePdf(sampleDocxInput().docx));
const pearson = sampleDocxInput(PEARSON_FORM).docx;
write("pearson-invoice.pdf", await buildInvoicePdf({ ...pearson, invoiceNumber: "FE-INV-2026-001" }));
write(
  "pearson-estimate.pdf",
  await buildEstimatePdf({ ...pearson, estimateNumber: "FE-EST-2026-001", estimateDate: pearson.invoiceDate, validDays: 30, paymentTerms: estimatePaymentTerms(30) }),
);
