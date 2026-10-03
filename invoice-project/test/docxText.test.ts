import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import { Document, Packer, Paragraph } from "docx";
import { docxToText, DocxError } from "@/lib/docxText";
import { buildInvoiceDocx } from "@/lib/docx/buildInvoiceDocx";
import { sniffType } from "@/lib/uploads.server";
import { sampleDocxInput } from "./fixtures/sampleInvoice";
import { PEARSON_FORM } from "./fixtures/pearsonInvoice";

describe("Word (.docx) uploads", () => {
  it("keeps each table row on one line with its amounts", async () => {
    const buf = await buildInvoiceDocx(sampleDocxInput(PEARSON_FORM).docx);
    expect(sniffType(buf)).toBe("docx");
    const text = await docxToText(buf);
    expect(text).toContain("Description | Qty | Rate | Amount");
    expect(text).toMatch(/Sliding Patio Door — White on White \(76"W x 81"H\) \/ Remove & dispose[^\n]* \| 1 \| \$3,500\.00 \| \$3,500\.00/);
    expect(text).toContain("BALANCE DUE | $14,522.20");
    expect(text).toContain("PREPARED FOR / Ilene Pearson / 2887 Bartelmy Ln / Maplewood, MN 55109 | JOB SITE / Same as above");
    expect(text).not.toMatch(/&amp;|<w:/);
  });

  it("rejects a zip that isn't a Word document, and a Word file with no text", async () => {
    const zip = new JSZip();
    zip.file("hello.txt", "not word");
    const notWord = await zip.generateAsync({ type: "nodebuffer" });
    expect(sniffType(notWord)).toBe("docx"); // looks like a zip…
    await expect(docxToText(notWord)).rejects.toBeInstanceOf(DocxError); // …but isn't Word

    const empty = await Packer.toBuffer(new Document({ sections: [{ children: [new Paragraph("")] }] }));
    await expect(docxToText(empty)).rejects.toThrow(/almost no text/);
    await expect(docxToText(Buffer.from("garbage"))).rejects.toBeInstanceOf(DocxError);
  });
});
