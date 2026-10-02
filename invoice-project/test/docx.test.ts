import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import { buildInvoiceDocx, docxPlainText } from "@/lib/docx/buildInvoiceDocx";
import { COMPANY, MN_LICENSE, WI_LICENSE } from "@/lib/company";
import { sampleDocxInput, SAMPLE_FORM } from "./fixtures/sampleInvoice";

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

  it("matches the spec'd page setup, colors and sections", async () => {
    const xml = await documentXml(await buildInvoiceDocx(sampleDocxInput().docx));
    const text = docxPlainText(xml);
    expect(xml).toMatch(/<w:pgSz w:w="12240" w:h="15840"/);
    for (const side of ["top", "right", "bottom", "left"]) expect(xml).toMatch(new RegExp(`w:${side}="900"`));
    expect(xml).toMatch(/<w:bottom w:val="single" w:color="F5B301" w:sz="16"/); // gold rule
    expect(xml).toContain('w:fill="0E8A96"'); // teal header / balance row
    expect(xml).toContain('w:fill="F2F2F2"'); // banding
    expect(xml).toContain('<w:gridCol w:w="5220"/><w:gridCol w:w="5220"/>'); // title row
    expect(text).toContain(COMPANY.addressLine);
    for (const s of ["INVOICE", "PREPARED FOR", "JOB SITE", "SCOPE OF WORK", "Subtotal", "ACCOUNT SUMMARY", "BALANCE DUE", "PAYMENT TERMS"]) expect(text).toContain(s);
    expect(text).not.toContain("ACCEPTANCE");
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
});
