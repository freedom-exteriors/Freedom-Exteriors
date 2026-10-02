// A realistic invoice used by the docx test and `npm run sample-docx`.
// Goes through the real validator, so totals are computed exactly as the
// server computes them.
import { validateInvoiceInput, type InvoiceFormInput, type InvoiceRow } from "../../src/lib/invoice";
import { docxFromInvoice } from "../../src/lib/docx/fromInvoice";

export const SAMPLE_FORM: InvoiceFormInput = {
  customerName: "Mark & Lisa Pearson",
  customerPhone: "(651) 555-0142",
  customerAddress: "",
  jobAddress: "123 Oak Street, Stillwater, MN 55082",
  subtitle: "Full roof replacement: GAF Timberline HDZ, Charcoal",
  tag: "FINAL INVOICE",
  contractDate: "2026-08-14",
  invoiceDate: "2026-10-02",
  dueDate: "2026-11-01",
  scope: [
    "Tear off existing roof down to deck and dispose of all debris",
    "Install ice & water shield at eaves and valleys; synthetic underlayment elsewhere",
    "Install GAF Timberline HDZ architectural shingles with matching hip & ridge",
    "Replace pipe boots and box vents; install ridge vent",
    "Full magnetic sweep and site cleanup",
  ],
  costLines: [
    { description: "Tear-off & disposal", detail: "1 layer asphalt, 7/12 pitch", qty: "32", rate: "85.00", amount: "" },
    { description: "Architectural shingles", detail: "GAF Timberline HDZ, Charcoal, incl. starter & ridge cap", qty: "32.5", rate: "245.00", amount: "" },
    { description: "Ice & water shield", detail: "Eaves (2 courses) and valleys", qty: "6", rate: "115.00", amount: "" },
    { description: "Synthetic underlayment", detail: "", qty: "28", rate: "38.50", amount: "" },
    { description: "Ridge vent", detail: "Linear feet", qty: "44", rate: "9.75", amount: "" },
    { description: "Pipe boots", detail: "", qty: "3", rate: "45.00", amount: "" },
  ],
  overheadPercent: "10",
  profitPercent: "10",
  contractTotal: "",
  deposits: [
    { date: "2026-08-14", description: "Deposit at signing", amount: "4,000.00" },
    { date: "2026-09-20", description: "Material delivery payment", amount: "5,000.00" },
  ],
  changeOrders: [
    { description: "Replace 4 sheets rotted OSB decking", amount: "380.00" },
    { description: "Seamless gutters, front elevation", amount: "925.00" },
  ],
  paymentTerms: "",
};

export function sampleDocxInput(form: InvoiceFormInput = SAMPLE_FORM) {
  const r = validateInvoiceInput(form, "generated");
  if (!r.ok) throw new Error(r.errors.join(" "));
  const { items, reconcileWarning: _w, ...v } = r.value;
  const row = { ...v, invoice_number: "FE-INV-2026-001" } as unknown as InvoiceRow;
  return { clean: r.value, docx: docxFromInvoice(row, items) };
}
