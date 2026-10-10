import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import { buildInvoiceDocx, docxPlainText } from "@/lib/docx/buildInvoiceDocx";
import { COMPANY, MN_LICENSE, WI_LICENSE } from "@/lib/company";
import { sampleDocxInput, SAMPLE_FORM } from "./fixtures/sampleInvoice";
import { docxFromInvoice } from "@/lib/docx/fromInvoice";
import { buildInvoicePdf } from "@/lib/pdf/buildPdf";
import { validateInvoiceInput, type InvoiceRow } from "@/lib/invoice";

async function documentXml(buf: Buffer) {
  const zip = await JSZip.loadAsync(buf);
  return zip.file("word/document.xml")!.async("string");
}

describe("generated invoice .docx", () => {
  it("prints BOTH license numbers on every invoice", async () => {
    // Minimal invoice too: the numbers must not depend on optional fields.
    const minimal = sampleDocxInput({ ...SAMPLE_FORM, subtitle: "", tag: "", scope: [], deposits: [], changeOrders: [], customerAddress: "", jobAddress: "" });
    for (const input of [sampleDocxInput().docx, minimal.docx]) {
      const text = docxPlainText(await documentXml(await buildInvoiceDocx(input)));
      expect(MN_LICENSE).toBe("BC-810020");
      expect(WI_LICENSE).toBe("4811-DCFR");
      expect(text).toContain(`MN License # ${MN_LICENSE}`);
      expect(text).toContain(`WI Dwelling Contractor License # ${WI_LICENSE}`);
    }
  });

  it("matches the measurements of reference/Freedom_Exteriors_Estimate_Pearson.docx", async () => {
    const buf = await buildInvoiceDocx(sampleDocxInput().docx);
    const xml = await documentXml(buf);
    const zip = await JSZip.loadAsync(buf);
    const styles = await zip.file("word/styles.xml")!.async("string");
    const text = docxPlainText(xml);
    // Page: US Letter, 900 twips all round, header/footer 708.
    expect(xml).toMatch(/<w:pgSz w:w="12240" w:h="15840"/);
    expect(xml).toMatch(/<w:pgMar w:top="900" w:right="900" w:bottom="900" w:left="900" w:header="708" w:footer="708"/);
    // Logo: the reference's image, at the reference's EMU size.
    expect(xml).toContain('<wp:extent cx="2476500" cy="1647825"/>');
    expect(Object.keys(zip.files).filter((f) => f.startsWith("word/media/") && f.endsWith(".png"))).toHaveLength(1);
    // Gold rule: its own paragraph, bottom border F5B301 sz 16 space 1, after 200.
    expect(xml).toMatch(/<w:pBdr><w:bottom w:val="single" w:color="F5B301" w:sz="16" w:space="1"\/><\/w:pBdr><w:spacing w:after="200"\/>/);
    // Title / parties rows: two 5220 columns.
    expect(xml.match(/<w:gridCol w:w="5220"\/><w:gridCol w:w="5220"\/>/g)).toHaveLength(2);
    // Cost table + account summary: reference widths, empty 5th column folded in.
    expect(xml.match(/<w:gridCol w:w="6264"\/><w:gridCol w:w="835"\/><w:gridCol w:w="1670"\/><w:gridCol w:w="1670"\/>/g)).toHaveLength(2);
    expect(xml).toContain('<w:tcMar><w:top w:type="dxa" w:w="80"/><w:left w:type="dxa" w:w="100"/><w:bottom w:type="dxa" w:w="80"/><w:right w:type="dxa" w:w="100"/></w:tcMar>');
    expect(xml).toContain('w:fill="0E8A96"'); // header row + BALANCE DUE
    expect(xml).toContain('w:fill="F2F2F2"'); // banding
    expect(xml).toContain('w:fill="222222"'); // total row
    // Heading 2 is defined exactly as in the reference's styles.xml.
    expect(styles).toMatch(/w:styleId="Heading2".*?<w:color w:val="2E74B5"\/>.*?<w:sz w:val="26"\/>/s);
    expect(styles).toContain('w:ascii="Times New Roman"');
    for (const s of ["INVOICE", "PREPARED FOR", "JOB SITE", "SCOPE OF WORK", "Subtotal (Labor & Materials)", "CONTRACT TOTAL", "ACCOUNT SUMMARY", "BALANCE DUE", "PAYMENT TERMS"]) expect(text).toContain(s);
    expect(text).not.toContain("ACCEPTANCE");
    expect(text).not.toContain("Signature");
  });

  it("prints server-computed amounts", async () => {
    const { clean, docx } = sampleDocxInput();
    const text = docxPlainText(await documentXml(await buildInvoiceDocx(docx)));
    expect(text).toContain("$7,962.50"); // 32.5 × $245.00
    expect(text).toContain("Overhead (10%)");
    expect(clean.balance_due_cents).toBe(clean.contract_total_cents + 38000 + 92500 - 900000);
    expect(text).toContain(`$${(clean.balance_due_cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2 })}`);
    expect(text).toContain("Deposit Received - 08/14/2026 - Deposit at signing");
    expect(text).toContain("Change Order / Add-On - Replace 4 sheets rotted OSB decking");
  });

  it("a PAID invoice prints the final payment, $0.00 balance and PAID IN FULL", async () => {
    const r = validateInvoiceInput(SAMPLE_FORM, "generated");
    if (!r.ok) throw new Error(r.errors.join(" "));
    const { items, reconcileWarning: _w, ...v } = r.value;
    const balance = v.balance_due_cents;
    expect(balance).toBeGreaterThan(0);
    const paid = { ...v, invoice_number: "FE-INV-2026-001", status: "paid", paid_date: "2026-10-09" } as unknown as InvoiceRow;
    const docx = docxFromInvoice(paid, items);
    expect(docx.balanceDueCents).toBe(0);
    expect(docx.finalPayment).toEqual({ date: "2026-10-09", amountCents: balance });
    const text = docxPlainText(await documentXml(await buildInvoiceDocx(docx)));
    expect(text).toContain("PAID IN FULL");
    expect(text).toContain("Payment Received - 10/09/2026 - Final payment");
    expect(text).toContain(`($${(balance / 100).toLocaleString("en-US", { minimumFractionDigits: 2 })})`);
    expect(text).toMatch(/BALANCE DUE\s*\$0\.00/);
    expect(text).toContain("October 9, 2026");
    // The PDF (what Email PDF sends) is built from the same data.
    expect((await buildInvoicePdf(docx)).subarray(0, 5).toString()).toBe("%PDF-");

    // Outstanding: unchanged.
    const open = docxFromInvoice({ ...paid, status: "outstanding", paid_date: null }, items);
    expect(open.balanceDueCents).toBe(balance);
    expect(open.finalPayment).toBeNull();
    expect(open.tag).not.toContain("PAID");
  });
});
