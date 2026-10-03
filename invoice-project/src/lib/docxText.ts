import JSZip from "jszip";

// Turns a Word .docx into plain text Claude can read: paragraphs on their
// own lines, table cells separated by " | " and rows on their own lines, so
// line items and amounts stay together. Headers and footers are included
// (company details and invoice numbers often live there).

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

/** One table cell's paragraphs on one line, joined with " / ". */
function flattenCells(xml: string): string {
  return xml.replace(/<w:tc\b[^>]*>([\s\S]*?)<\/w:tc>/g, (_, inner: string) => {
    const text = inner
      .replace(/<\/w:p>/g, " / ")
      .replace(/<w:(?:tab|br)[^>]*\/>/g, " ")
      .replace(/<[^>]+>/g, "")
      .replace(/\s+/g, " ")
      .replace(/(\s*\/\s*)+$/, "")
      .replace(/^(\s*\/\s*)+/, "")
      .trim();
    return `<w:t>${text}</w:t> | `;
  });
}

function xmlToText(xml: string): string {
  return flattenCells(xml)
    .replace(/<w:tab\/>/g, "\t")
    .replace(/<w:br[^>]*\/>/g, "\n")
    .replace(/<\/w:p>/g, "\n")
    .replace(/<\/w:tr>/g, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&(amp|lt|gt|quot|apos);/g, (_, e: string) => ENTITIES[e])
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n: string) => String.fromCodePoint(parseInt(n, 16)))
    .split("\n")
    .map((l) => l.replace(/[ \t]+\|\s*$/, "").replace(/[ \t]+/g, " ").trim())
    .filter((l, i, a) => l !== "" || (i > 0 && a[i - 1] !== ""))
    .join("\n")
    .trim();
}

export class DocxError extends Error {}

export async function docxToText(buf: Buffer): Promise<string> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(buf);
  } catch {
    throw new DocxError("This file isn't a readable Word (.docx) file.");
  }
  const body = zip.file("word/document.xml");
  if (!body) throw new DocxError("This file isn't a Word (.docx) document.");
  const parts: string[] = [];
  for (const name of Object.keys(zip.files).filter((f) => /^word\/header\d*\.xml$/.test(f)).sort()) {
    const t = xmlToText(await zip.file(name)!.async("string"));
    if (t) parts.push(`[Page header]\n${t}`);
  }
  parts.push(xmlToText(await body.async("string")));
  for (const name of Object.keys(zip.files).filter((f) => /^word\/footer\d*\.xml$/.test(f)).sort()) {
    const t = xmlToText(await zip.file(name)!.async("string"));
    if (t) parts.push(`[Page footer]\n${t}`);
  }
  const text = parts.join("\n\n").trim();
  if (text.replace(/\s|\|/g, "").length < 20) {
    throw new DocxError("This Word file has almost no text in it (it may be a scanned picture). Save it as a PDF and upload that instead.");
  }
  return text.slice(0, 200_000);
}
