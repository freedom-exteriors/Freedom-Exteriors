import PDFDocument from "pdfkit";
import { COMPANY } from "../company";
import { formatCents, formatPercent, formatQuantity } from "../money";
import { toLongDate, toUsDate } from "../dates";
import { LOGO } from "../docx/logo";
import { addressLines, LAYOUT, type DocxEstimate, type DocxInvoice } from "../docx/buildInvoiceDocx";

// PDF version of the letterhead, for emailing. Same layout and the same
// LAYOUT measurements as the .docx (converted to points), drawn directly
// with pdfkit because converting .docx → PDF needs LibreOffice, which
// Vercel doesn't have. Times matches the .docx's Times New Roman.

const tw = (twips: number) => twips / 20; // twips → points
const hp = (halfPoints: number) => halfPoints / 2; // half-points → points
const hex = (c: string) => `#${c}`;

const PAGE = { w: tw(LAYOUT.page.width), h: tw(LAYOUT.page.height), m: tw(LAYOUT.page.margin) };
const LEFT = PAGE.m;
const WIDTH = PAGE.w - 2 * PAGE.m; // 522pt
const BOTTOM = PAGE.h - PAGE.m;
const C = COMPANY.colors;
const FONT = { regular: "Times-Roman", bold: "Times-Bold", italic: "Times-Italic", boldItalic: "Times-BoldItalic" };
const PAD = { x: tw(LAYOUT.cellMargin.left), y: tw(LAYOUT.cellMargin.top) };
const BORDER = LAYOUT.tableBorder.size / 8; // eighths of a point → points
const COLS = LAYOUT.costTable.map(tw); // description, qty, rate, amount

type Doc = PDFKit.PDFDocument;

interface Run {
  text: string;
  bold?: boolean;
  italic?: boolean;
  size: number;
  color?: string;
}

/**
 * The standard PDF fonts only cover the Windows-1252 character set. Swap the
 * few common characters outside it and drop anything else, so an odd
 * character typed into a form can't print as garbage.
 */
function clean(s: string): string {
  return s
    .replace(/[‐-‒]/g, "-")
    .replace(/[−]/g, "-")
    .replace(/[   ]/g, " ")
    .replace(/[^\x09\x0a\x0d\x20-\x7e -ÿ–—‘’‚“”„†‡•…‰‹›€™ŒœŠšŸŽžƒˆ˜]/g, "");
}

function fontOf(r: Pick<Run, "bold" | "italic">) {
  return r.bold && r.italic ? FONT.boldItalic : r.bold ? FONT.bold : r.italic ? FONT.italic : FONT.regular;
}

function setRun(doc: Doc, r: Run) {
  doc.font(fontOf(r)).fontSize(r.size).fillColor(hex(r.color ?? C.text));
}

/** Height of one wrapped run at a width. */
function measure(doc: Doc, r: Run, width: number): number {
  setRun(doc, r);
  return doc.heightOfString(clean(r.text) || " ", { width });
}

/** Draws one paragraph of runs (continued on one line/flow) at x,y. Returns its height. */
function drawRuns(doc: Doc, runs: Run[], x: number, y: number, width: number, align: "left" | "center" | "right" = "left"): number {
  // Measure with the first run's font; multi-run paragraphs here are short
  // single-line "Label value" pairs.
  if (runs.length === 1) {
    setRun(doc, runs[0]);
    const t = clean(runs[0].text) || " ";
    const h = doc.heightOfString(t, { width });
    doc.text(t, x, y, { width, align, lineGap: 0 });
    return h;
  }
  // Several runs ("Label: value"): one line, placed run by run.
  const widths = runs.map((r) => (setRun(doc, r), doc.widthOfString(clean(r.text))));
  const total = widths.reduce((a, b) => a + b, 0);
  let cx = align === "right" ? x + width - total : align === "center" ? x + (width - total) / 2 : x;
  let h = 0;
  runs.forEach((r, i) => {
    setRun(doc, r);
    doc.text(clean(r.text), cx, y, { lineBreak: false, lineGap: 0 });
    h = Math.max(h, doc.currentLineHeight());
    cx += widths[i];
  });
  return h;
}

class Flow {
  y = PAGE.m;
  constructor(public doc: Doc) {}
  newPage() {
    this.doc.addPage();
    this.y = PAGE.m;
  }
  /** Start a new page unless `h` more points fit. */
  ensure(h: number) {
    if (this.y + h > BOTTOM && this.y > PAGE.m + 1) this.newPage();
  }
  para(runs: Run[], o: { before?: number; after?: number; align?: "left" | "center" | "right" } = {}) {
    const before = tw(o.before ?? 0);
    const h = runs.length === 1 ? measure(this.doc, runs[0], WIDTH) : drawHeight(this.doc, runs);
    this.ensure(before + h);
    this.y += before;
    this.y += drawRuns(this.doc, runs, LEFT, this.y, WIDTH, o.align);
    this.y += tw(o.after ?? 0);
  }
  heading(text: string, spacing: { before: number; after: number }, keepWith = 40) {
    const r: Run = { text, size: hp(LAYOUT.heading.size), color: LAYOUT.heading.color };
    const h = measure(this.doc, r, WIDTH);
    // A heading never sits alone at the bottom of a page.
    this.ensure(tw(spacing.before) + h + tw(spacing.after) + keepWith);
    this.y += tw(spacing.before);
    this.y += drawRuns(this.doc, [r], LEFT, this.y, WIDTH);
    this.y += tw(spacing.after);
  }
}

function drawHeight(doc: Doc, runs: Run[]) {
  setRun(doc, { ...runs[0], bold: true });
  return doc.heightOfString(runs.map((r) => clean(r.text)).join("") || " ", { width: WIDTH });
}

// ---------------------------------------------------------------- header

function header(f: Flow) {
  const { doc } = f;
  if (LOGO) {
    const w = LAYOUT.logo.widthEmu / 12700;
    const h = LAYOUT.logo.heightEmu / 12700;
    doc.image(Buffer.from(LOGO.base64, "base64"), LEFT + (WIDTH - w) / 2, f.y, { width: w, height: h });
    f.y += h + tw(LAYOUT.logo.after);
  } else {
    f.para([{ text: COMPANY.legalName.toUpperCase(), bold: true, size: 16, color: C.teal }], { align: "center", after: LAYOUT.logo.after });
  }
  const gray = { size: hp(LAYOUT.header.size), color: C.gray };
  f.para([{ text: COMPANY.addressLine, ...gray }], { align: "center", after: LAYOUT.header.addressAfter });
  f.para([{ text: COMPANY.licenseLine, ...gray }], { align: "center", after: LAYOUT.header.licenseAfter });
  // Gold rule: bottom border of an empty paragraph.
  f.y += 4;
  const lw = LAYOUT.goldRule.size / 8;
  doc.save().moveTo(LEFT, f.y).lineTo(LEFT + WIDTH, f.y).lineWidth(lw).strokeColor(hex(C.gold)).stroke().restore();
  f.y += lw + tw(LAYOUT.goldRule.after);
}

// ------------------------------------------------------------- columns

type Block = { runs: Run[]; before?: number; after?: number; align?: "left" | "center" | "right" };

function blocksHeight(doc: Doc, blocks: Block[], width: number) {
  return blocks.reduce((sum, b) => {
    setRun(doc, { ...b.runs[0], bold: b.runs.length > 1 ? true : b.runs[0].bold });
    return sum + tw(b.before ?? 0) + doc.heightOfString(b.runs.map((r) => clean(r.text)).join("") || " ", { width }) + tw(b.after ?? 0);
  }, 0);
}

function drawBlocks(doc: Doc, blocks: Block[], x: number, y: number, width: number) {
  for (const b of blocks) {
    y += tw(b.before ?? 0);
    y += drawRuns(doc, b.runs, x, y, width, b.align);
    y += tw(b.after ?? 0);
  }
}

/** Two borderless columns, like the .docx title and parties tables. */
function twoColumns(f: Flow, left: Block[], right: Block[], widths: readonly number[]) {
  const [lw, rw] = widths.map(tw);
  const h = Math.max(blocksHeight(f.doc, left, lw), blocksHeight(f.doc, right, rw));
  f.ensure(h);
  drawBlocks(f.doc, left, LEFT, f.y, lw);
  drawBlocks(f.doc, right, LEFT + lw, f.y, rw);
  f.y += h;
}

function titleRow(f: Flow, title: string, d: { subtitle: string | null; tag: string | null }, meta: Array<[string, string]>) {
  const t = LAYOUT.title;
  const left: Block[] = [{ runs: [{ text: title, bold: true, size: hp(t.size), color: C.teal }] }];
  if (d.subtitle) left.push({ runs: [{ text: d.subtitle, italic: true, size: hp(t.subtitleSize), color: C.gray }], after: t.subtitleAfter });
  if (d.tag) left.push({ runs: [{ text: d.tag, bold: true, size: hp(t.tagSize), color: C.gold }] });
  const right: Block[] = meta.map(([k, v]) => ({
    runs: [
      { text: `${k} `, bold: true, size: hp(t.metaSize) },
      { text: v, size: hp(t.metaSize) },
    ],
    align: "right" as const,
  }));
  twoColumns(f, left, right, LAYOUT.titleTable);
  f.y += tw(LAYOUT.afterTitleSpacer);
}

function parties(f: Flow, d: { customerName: string; customerPhone: string | null; customerAddress: string | null; jobAddress: string | null }) {
  const p = LAYOUT.parties;
  const label = (text: string): Block => ({ runs: [{ text, bold: true, size: hp(p.labelSize), color: C.teal }], after: p.labelAfter });
  const value = (text: string): Block => ({ runs: [{ text, size: hp(p.valueSize) }] });
  const billing = addressLines(d.customerAddress ?? d.jobAddress);
  const left = [label("PREPARED FOR"), value(d.customerName), ...billing.map(value)];
  if (d.customerPhone) left.push(value(d.customerPhone));
  const site = d.customerAddress ? addressLines(d.jobAddress) : [];
  const right = [label("JOB SITE"), ...(site.length ? site.map(value) : [value("Same as above")])];
  twoColumns(f, left, right, LAYOUT.partiesTable);
}

function scope(f: Flow, lines: string[]) {
  if (!lines.length) return;
  f.heading("SCOPE OF WORK", LAYOUT.headingSpacing.scope);
  const bullet = lines.length > 1 ? "• " : "";
  lines.forEach((l, i) =>
    f.para([{ text: `${bullet}${l}`, size: hp(LAYOUT.body.size) }], { after: i === lines.length - 1 ? LAYOUT.body.after : LAYOUT.bullet.after }),
  );
}

// ---------------------------------------------------------------- tables

interface Cell {
  blocks: Block[];
  span?: number;
  fill?: string;
  vCenter?: boolean;
}

function rowHeight(doc: Doc, cells: Cell[]) {
  let col = 0;
  let h = 0;
  for (const c of cells) {
    const w = COLS.slice(col, col + (c.span ?? 1)).reduce((a, b) => a + b, 0);
    col += c.span ?? 1;
    h = Math.max(h, blocksHeight(doc, c.blocks, w - 2 * PAD.x));
  }
  return h + 2 * PAD.y;
}

function drawRow(f: Flow, cells: Cell[], h: number) {
  const { doc } = f;
  let x = LEFT;
  let col = 0;
  for (const c of cells) {
    const w = COLS.slice(col, col + (c.span ?? 1)).reduce((a, b) => a + b, 0);
    col += c.span ?? 1;
    if (c.fill && c.fill !== "FFFFFF") doc.save().rect(x, f.y, w, h).fill(hex(c.fill)).restore();
    doc.save().rect(x, f.y, w, h).lineWidth(BORDER).strokeColor("#000000").stroke().restore();
    const contentH = blocksHeight(doc, c.blocks, w - 2 * PAD.x);
    const top = c.vCenter ? f.y + (h - contentH) / 2 : f.y + PAD.y;
    drawBlocks(doc, c.blocks, x + PAD.x, top, w - 2 * PAD.x);
    x += w;
  }
  f.y += h;
}

/** Draws rows, repeating `headerRow` at the top of every new page. */
function gridTable(f: Flow, rows: Cell[][], headerRow: Cell[] | null, keepLast = 0) {
  const headH = headerRow ? rowHeight(f.doc, headerRow) : 0;
  const heights = rows.map((r) => rowHeight(f.doc, r));
  if (headerRow) {
    f.ensure(headH + (heights[0] ?? 0));
    drawRow(f, headerRow, headH);
  }
  rows.forEach((r, i) => {
    // The last `keepLast` rows (totals) move to the next page together.
    const need = i === rows.length - keepLast ? heights.slice(i).reduce((a, b) => a + b, 0) : heights[i];
    if (f.y + need > BOTTOM) {
      f.newPage();
      if (headerRow) drawRow(f, headerRow, headH);
    }
    drawRow(f, r, heights[i]);
  });
}

type CostFields = Pick<
  DocxInvoice,
  "costLines" | "subtotalCents" | "overheadPercentHundredths" | "overheadCents" | "profitPercentHundredths" | "profitCents" | "contractTotalCents"
>;

function costTable(f: Flow, inv: CostFields, labels: { heading: string; total: string }) {
  const s = hp(LAYOUT.costText.size);
  f.heading(labels.heading, LAYOUT.headingSpacing.cost, 60);
  const head = (text: string, align: "left" | "center"): Cell => ({ blocks: [{ runs: [{ text, bold: true, size: s, color: "FFFFFF" }], align }], fill: C.teal, vCenter: true });
  const headerRow = [head("Description", "left"), head("Qty", "center"), head("Rate", "center"), head("Amount", "center")];

  const rows: Cell[][] = inv.costLines.map((l, i) => {
    const fill = i % 2 === 0 ? "FFFFFF" : C.lightFill;
    const desc: Block[] = [{ runs: [{ text: l.description, bold: true, size: s }] }];
    if (l.detail) desc.push({ runs: [{ text: l.detail, italic: true, size: hp(LAYOUT.costText.detailSize), color: C.gray }], before: LAYOUT.costText.detailBefore });
    const num = (text: string, bold = false): Cell => ({ blocks: [{ runs: [{ text, bold, size: s }], align: "center" }], fill, vCenter: true });
    return [
      { blocks: desc, fill },
      num(l.quantityMilli === null ? "" : formatQuantity(l.quantityMilli)),
      num(l.rateCents === null ? "" : formatCents(l.rateCents)),
      num(formatCents(l.amountCents), true),
    ];
  });

  const total = (label: string, cents: number, dark = false): Cell[] => {
    const fill = dark ? LAYOUT.totalRow.fill : "FFFFFF";
    const r = dark ? { bold: true, size: hp(LAYOUT.totalRow.size), color: "FFFFFF" } : { size: s };
    return [
      { blocks: [], span: 2, fill },
      { blocks: [{ runs: [{ text: label, ...r }], align: "right" }], fill, vCenter: true },
      { blocks: [{ runs: [{ text: formatCents(cents), ...r }], align: "center" }], fill, vCenter: true },
    ];
  };
  const totals = [total("Subtotal (Labor & Materials)", inv.subtotalCents)];
  if (inv.overheadPercentHundredths) totals.push(total(`Overhead (${formatPercent(inv.overheadPercentHundredths)})`, inv.overheadCents));
  if (inv.profitPercentHundredths) totals.push(total(`Profit (${formatPercent(inv.profitPercentHundredths)})`, inv.profitCents));
  totals.push(total(labels.total, inv.contractTotalCents, true));
  gridTable(f, [...rows, ...totals], headerRow, totals.length);
}

function accountSummary(f: Flow, inv: DocxInvoice) {
  const s = hp(LAYOUT.costText.size);
  const row = (desc: string, amount: string, o: { balance?: boolean; bold?: boolean } = {}): Cell[] => {
    const fill = o.balance ? LAYOUT.balanceRow.fill : "FFFFFF";
    const r = o.balance ? { bold: true, size: hp(LAYOUT.balanceRow.size), color: "FFFFFF" } : { bold: o.bold, size: s };
    return [
      { blocks: [{ runs: [{ text: desc, ...r }] }], span: 3, fill, vCenter: true },
      { blocks: [{ runs: [{ text: amount, ...r }], align: "center" }], fill, vCenter: true },
    ];
  };
  const rows = [row(inv.contractDate ? `Contract Total (agreement dated ${toUsDate(inv.contractDate)})` : "Contract Total", formatCents(inv.contractTotalCents), { bold: true })];
  for (const d of inv.deposits) {
    const parts = ["Deposit Received", d.date ? toUsDate(d.date) : null, d.description && d.description !== "Deposit" ? d.description : null].filter(Boolean);
    rows.push(row(parts.join(" - "), `(${formatCents(d.amountCents)})`));
  }
  for (const c of inv.changeOrders) rows.push(row(`Change Order / Add-On - ${c.description}`, formatCents(c.amountCents)));
  rows.push(row("BALANCE DUE", formatCents(inv.balanceDueCents), { balance: true }));
  // The whole summary stays on one page (as in the .docx).
  const h = rows.reduce((sum, r) => sum + rowHeight(f.doc, r), 0);
  f.heading("ACCOUNT SUMMARY", LAYOUT.headingSpacing.summary, h);
  gridTable(f, rows, null, rows.length);
}

function paymentTerms(f: Flow, text: string | null) {
  const lines = (text ?? "").split(/\n+/).map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return;
  f.heading("PAYMENT TERMS", LAYOUT.headingSpacing.payment);
  lines.forEach((l, i) =>
    f.para([{ text: l, size: hp(LAYOUT.body.size) }], { after: i === lines.length - 1 ? LAYOUT.paymentLastAfter : LAYOUT.bullet.after }),
  );
}

function acceptance(f: Flow, clientName: string) {
  const a = LAYOUT.acceptance;
  const { doc } = f;
  const statement: Run = { text: a.statement, size: hp(LAYOUT.body.size) };
  const [lw, gw, rw] = a.table.map(tw);
  const captionSize = hp(a.captionSize);
  const lineGap = 12; // one empty 9pt line above each signature rule
  const sideH = tw(a.firstLineBefore) + lineGap + captionSize + 4 + tw(a.secondLineBefore) + lineGap + captionSize + 4;
  const total = measure(doc, statement, WIDTH) + tw(a.statementAfter) + sideH;
  f.heading("ACCEPTANCE", LAYOUT.headingSpacing.acceptance, total); // whole block on one page
  f.para([statement], { after: a.statementAfter });
  const side = (x: number, w: number, who: string) => {
    let y = f.y;
    for (const [before, caption] of [[a.firstLineBefore, who], [a.secondLineBefore, "Date"]] as const) {
      y += tw(before) + lineGap;
      doc.save().moveTo(x, y).lineTo(x + w, y).lineWidth(a.lineSize / 8).strokeColor(hex(a.lineColor)).stroke().restore();
      y += tw(a.captionBefore);
      drawRuns(doc, [{ text: caption, size: captionSize, color: C.gray }], x, y, w);
      y += captionSize + 4;
    }
  };
  side(LEFT, lw, `${COMPANY.shortName} — Authorized Signature`);
  side(LEFT + lw + gw, rw, `Client — Acceptance Signature${clientName ? ` (${clientName})` : ""}`);
  f.y += sideH;
}

// ------------------------------------------------------------- documents

function render(title: string, draw: (f: Flow) => void): Promise<Buffer> {
  const doc = new PDFDocument({
    size: [PAGE.w, PAGE.h],
    margins: { top: PAGE.m, bottom: 0, left: PAGE.m, right: PAGE.m }, // we place every line ourselves
    info: { Title: title, Author: COMPANY.legalName, Creator: COMPANY.legalName },
    autoFirstPage: true,
    bufferPages: false,
  });
  const chunks: Buffer[] = [];
  return new Promise((resolve, reject) => {
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    try {
      draw(new Flow(doc));
      doc.end();
    } catch (e) {
      reject(e);
    }
  });
}

export function buildInvoicePdf(inv: DocxInvoice): Promise<Buffer> {
  const meta: Array<[string, string]> = [["Invoice #:", inv.invoiceNumber], ["Date:", toLongDate(inv.invoiceDate)]];
  if (inv.dueDate) meta.push(["Due Date:", toLongDate(inv.dueDate)]);
  if (inv.terms) meta.push(["Terms:", inv.terms]);
  return render(`Invoice ${inv.invoiceNumber}`, (f) => {
    header(f);
    titleRow(f, "INVOICE", inv, meta);
    parties(f, inv);
    scope(f, inv.scope);
    if (inv.costLines.length) costTable(f, inv, { heading: "COST DETAIL", total: "CONTRACT TOTAL" });
    accountSummary(f, inv);
    paymentTerms(f, inv.paymentTerms);
  });
}

export function buildEstimatePdf(est: DocxEstimate): Promise<Buffer> {
  return render(`Estimate ${est.estimateNumber}`, (f) => {
    header(f);
    titleRow(f, "ESTIMATE & SCOPE OF WORK", est, [
      ["Estimate #:", est.estimateNumber],
      ["Date:", toLongDate(est.estimateDate)],
      ["Valid For:", `${est.validDays} days`],
    ]);
    parties(f, est);
    scope(f, est.scope);
    if (est.costLines.length) costTable(f, est, { heading: "COST ESTIMATE", total: "TOTAL ESTIMATE" });
    paymentTerms(f, est.paymentTerms);
    acceptance(f, est.customerName);
  });
}
