import {
  AlignmentType,
  BorderStyle,
  Document,
  HeadingLevel,
  ImageRun,
  LineRuleType,
  Packer,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  VerticalAlignTable as VerticalAlign,
  WidthType,
  type IBorderOptions,
  type ParagraphChild,
} from "docx";
import { COMPANY } from "../company";
import { formatCents, formatPercent, formatQuantity } from "../money";
import { toLongDate, toUsDate } from "../dates";
import { LOGO } from "./logo";

// ---------------------------------------------------------------------------
// LAYOUT: every measurement, taken from reference/Freedom_Exteriors_Estimate_
// Pearson.docx (word/document.xml + word/styles.xml). Units: twips/dxa for
// geometry and spacing, half-points for font sizes, eighths of a point for
// borders, EMU for the logo.
// Deviations from the reference are marked DEVIATION, with the reason.
// ---------------------------------------------------------------------------
export const LAYOUT = {
  // The reference names no font at all (empty docDefaults, no theme), so
  // Word falls back to Times New Roman 10pt. We name it explicitly so every
  // app renders the same thing.
  font: "Times New Roman",
  defaultSize: 20,
  page: { width: 12240, height: 15840, margin: 900, headerFooter: 708 },
  logo: { widthEmu: 2476500, heightEmu: 1647825, after: 80 },
  header: { addressAfter: 4, licenseAfter: 20, size: 16 },
  goldRule: { size: 16, space: 1, after: 200 }, // on its own empty paragraph
  titleTable: [5220, 5220],
  title: { size: 30, subtitleSize: 18, subtitleAfter: 40, tagSize: 18, metaSize: 18 },
  afterTitleSpacer: 150,
  partiesTable: [5220, 5220],
  parties: { labelSize: 16, labelAfter: 60, valueSize: 18 },
  // "Heading 2" in the reference's styles.xml: color 2E74B5, 13pt, not bold.
  heading: { color: "2E74B5", size: 26 },
  headingSpacing: {
    scope: { before: 200, after: 100 },
    cost: { before: 100, after: 100 },
    summary: { before: 300, after: 100 }, // DEVIATION: new section; uses the PAYMENT TERMS spacing
    payment: { before: 300, after: 100 },
    acceptance: { before: 100, after: 100 },
  },
  // ACCEPTANCE block (estimates only), measured from the reference.
  acceptance: {
    statement: "By signing below, both parties agree to the scope of work and pricing outlined above.",
    statementAfter: 100,
    table: [5120, 200, 5120],
    lineSize: 6,
    lineColor: "999999",
    firstLineBefore: 400,
    secondLineBefore: 200,
    captionBefore: 60,
    captionSize: 16,
  },
  body: { size: 18, after: 120 },
  bullet: { after: 60 }, // the reference's typed "• " lines (PAYMENT TERMS)
  // Cost table. The reference grid is 5220 / 835 / 1670 / 1670 / 1044, and the
  // last 1044 column is empty on every row (a blank bordered column).
  // DEVIATION: that empty column is folded into Description so the table still
  // spans the full 10440 width.
  costTable: [5220 + 1044, 835, 1670, 1670],
  cellMargin: { top: 80, bottom: 80, left: 100, right: 100 },
  tableBorder: { size: 4, color: "auto" },
  costText: { size: 18, detailSize: 15, detailBefore: 40 },
  totalRow: { fill: "222222", size: 22 },
  balanceRow: { fill: "0E8A96", size: 22 },
  paymentLastAfter: 200,
} as const;

const C = COMPANY.colors;
const CONTENT_WIDTH = LAYOUT.page.width - 2 * LAYOUT.page.margin; // 10440
const EMU_PER_PX = 9525;

export interface DocxCostLine {
  description: string;
  detail: string | null;
  quantityMilli: number | null;
  rateCents: number | null;
  /** null = no amount on the document (uploaded invoices); prints blank. */
  amountCents: number | null;
}

export interface DocxInvoice {
  invoiceNumber: string;
  invoiceDate: string;
  dueDate: string | null;
  terms: string | null;
  subtitle: string | null;
  tag: string | null;
  customerName: string;
  customerPhone: string | null;
  customerAddress: string | null;
  jobAddress: string | null;
  contractDate: string | null;
  scope: string[];
  costLines: DocxCostLine[];
  subtotalCents: number;
  overheadPercentHundredths: number | null;
  overheadCents: number;
  profitPercentHundredths: number | null;
  profitCents: number;
  contractTotalCents: number;
  deposits: Array<{ date: string | null; description: string; amountCents: number }>;
  changeOrders: Array<{ description: string; amountCents: number }>;
  balanceDueCents: number;
  paymentTerms: string | null;
}

const NONE: IBorderOptions = { style: BorderStyle.NONE, size: 0, color: "auto" };
const NO_TABLE_BORDERS = { top: NONE, left: NONE, bottom: NONE, right: NONE, insideHorizontal: NONE, insideVertical: NONE };
const LINE: IBorderOptions = { style: BorderStyle.SINGLE, size: LAYOUT.tableBorder.size, color: LAYOUT.tableBorder.color };
const GRID_TABLE_BORDERS = { top: LINE, left: LINE, bottom: LINE, right: LINE, insideHorizontal: LINE, insideVertical: LINE };

type Align = (typeof AlignmentType)[keyof typeof AlignmentType];

interface RunOpts {
  bold?: boolean;
  italics?: boolean;
  size?: number;
  /** undefined = no color (Word "auto"), as on the reference's number cells */
  color?: string;
}

function run(text: string, o: RunOpts = {}) {
  return new TextRun({ text, size: o.size, bold: o.bold, italics: o.italics, color: o.color });
}

function para(
  children: ParagraphChild[],
  o: { align?: Align; before?: number; after?: number; keepNext?: boolean; border?: IBorderOptions } = {},
) {
  return new Paragraph({
    children,
    alignment: o.align,
    keepNext: o.keepNext,
    spacing: o.before === undefined && o.after === undefined ? undefined : { before: o.before, after: o.after },
    border: o.border ? { bottom: o.border } : undefined,
  });
}

function cell(
  children: Paragraph[],
  width: number,
  o: { fill?: string; margins?: boolean; vAlign?: (typeof VerticalAlign)[keyof typeof VerticalAlign]; span?: number } = {},
) {
  return new TableCell({
    children: children.length ? children : [new Paragraph({})],
    width: { size: width, type: WidthType.DXA },
    columnSpan: o.span,
    verticalAlign: o.vAlign,
    shading: o.fill ? { type: ShadingType.CLEAR, color: "auto", fill: o.fill } : undefined,
    margins: o.margins ? { ...LAYOUT.cellMargin, marginUnitType: WidthType.DXA } : undefined,
  });
}

function table(widths: readonly number[], rows: TableRow[], borders: typeof NO_TABLE_BORDERS | typeof GRID_TABLE_BORDERS) {
  return new Table({
    width: { size: CONTENT_WIDTH, type: WidthType.DXA },
    columnWidths: [...widths],
    borders,
    rows,
  });
}

function heading(text: string, spacing: { before: number; after: number }) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_2,
    spacing,
    keepNext: true, // never leave a heading alone at the bottom of a page
    children: [new TextRun(text)],
  });
}

/** "12 Oak St, Stillwater, MN 55082" → ["12 Oak St", "Stillwater, MN 55082"]. */
export function addressLines(address: string | null): string[] {
  const a = (address ?? "").trim();
  if (!a) return [];
  if (a.includes("\n")) return a.split("\n").map((s) => s.trim()).filter(Boolean);
  const parts = a.split(",");
  if (parts.length >= 3) return [parts[0].trim(), parts.slice(1).join(",").trim()];
  return [a];
}

// --------------------------------------------------------------- header

function header(): Paragraph[] {
  const gray = { color: C.gray, size: LAYOUT.header.size };
  const logoPara = LOGO
    ? para(
        [
          new ImageRun({
            type: "png",
            data: Buffer.from(LOGO.base64, "base64"),
            transformation: {
              width: LAYOUT.logo.widthEmu / EMU_PER_PX,
              height: LAYOUT.logo.heightEmu / EMU_PER_PX,
            },
            altText: { name: "Logo", title: COMPANY.legalName, description: `${COMPANY.legalName} logo` },
          }),
        ],
        { align: AlignmentType.CENTER, after: LAYOUT.logo.after },
      )
    : para([run(COMPANY.legalName.toUpperCase(), { bold: true, size: 32, color: C.teal })], { align: AlignmentType.CENTER, after: LAYOUT.logo.after });
  return [
    logoPara,
    para([run(COMPANY.addressLine, gray)], { align: AlignmentType.CENTER, after: LAYOUT.header.addressAfter }),
    para([run(COMPANY.licenseLine, gray)], { align: AlignmentType.CENTER, after: LAYOUT.header.licenseAfter }),
    para([], {
      after: LAYOUT.goldRule.after,
      border: { style: BorderStyle.SINGLE, size: LAYOUT.goldRule.size, color: C.gold, space: LAYOUT.goldRule.space },
    }),
  ];
}

// ------------------------------------------------------------ title row

function titleRow(title: string, d: { subtitle: string | null; tag: string | null }, metaPairs: Array<[string, string]>): Table {
  const [lw, rw] = LAYOUT.titleTable;
  const t = LAYOUT.title;
  const left = [para([run(title, { bold: true, color: C.teal, size: t.size })])];
  if (d.subtitle) left.push(para([run(d.subtitle, { italics: true, color: C.gray, size: t.subtitleSize })], { after: t.subtitleAfter }));
  if (d.tag) left.push(para([run(d.tag, { bold: true, color: C.gold, size: t.tagSize })]));

  const meta = (label: string, value: string) =>
    para([run(`${label} `, { bold: true, color: C.text, size: t.metaSize }), run(value, { color: C.text, size: t.metaSize })], { align: AlignmentType.RIGHT });
  const right = metaPairs.map(([k, v]) => meta(k, v));

  return table(LAYOUT.titleTable, [new TableRow({ children: [cell(left, lw), cell(right, rw, { vAlign: VerticalAlign.TOP })] })], NO_TABLE_BORDERS);
}

// ---------------------------------------------- prepared for / job site

type PartyFields = Pick<DocxInvoice, "customerName" | "customerPhone" | "customerAddress" | "jobAddress">;

function parties(inv: PartyFields): Table {
  const [lw, rw] = LAYOUT.partiesTable;
  const p = LAYOUT.parties;
  const label = (t: string) => para([run(t, { bold: true, color: C.teal, size: p.labelSize })], { after: p.labelAfter });
  const value = (t: string) => para([run(t, { color: C.text, size: p.valueSize })]);

  const billing = addressLines(inv.customerAddress ?? inv.jobAddress);
  const left = [label("PREPARED FOR"), value(inv.customerName), ...billing.map(value)];
  // Not on the reference (an estimate has no phone line); kept because the
  // invoice form collects the customer's phone.
  if (inv.customerPhone) left.push(value(inv.customerPhone));

  const site = inv.customerAddress ? addressLines(inv.jobAddress) : [];
  const right = [label("JOB SITE"), ...(site.length ? site.map(value) : [value("Same as above")])];

  return table(LAYOUT.partiesTable, [new TableRow({ children: [cell(left, lw), cell(right, rw)] })], NO_TABLE_BORDERS);
}

// ---------------------------------------------------------------- scope

function scope(inv: { scope: string[] }): Paragraph[] {
  if (!inv.scope.length) return [];
  // One scope line prints as a plain paragraph, exactly like the reference.
  // Several print as typed "• " lines with after=60 (the reference's bullet
  // style, see PAYMENT TERMS); the last line gets the body after=120.
  const bullet = inv.scope.length > 1 ? "• " : "";
  return [
    heading("SCOPE OF WORK", LAYOUT.headingSpacing.scope),
    ...inv.scope.map((line, i) =>
      para([run(`${bullet}${line}`, { color: C.text, size: LAYOUT.body.size })], {
        after: i === inv.scope.length - 1 ? LAYOUT.body.after : LAYOUT.bullet.after,
      }),
    ),
  ];
}

// ------------------------------------------- cost table (+ totals rows)

type CostFields = Pick<
  DocxInvoice,
  "costLines" | "subtotalCents" | "overheadPercentHundredths" | "overheadCents" | "profitPercentHundredths" | "profitCents" | "contractTotalCents"
>;

/**
 * Subtotal / overhead / profit rows only when they add up to the total.
 * An uploaded invoice can keep its printed contract total while its lines
 * show no prices; "Subtotal $0.00" above the real total would be wrong.
 */
export function showsBreakdown(inv: Pick<DocxInvoice, "subtotalCents" | "overheadCents" | "profitCents" | "contractTotalCents">): boolean {
  return inv.subtotalCents + inv.overheadCents + inv.profitCents === inv.contractTotalCents;
}

function costTable(inv: CostFields, labels: { heading: string; total: string }): Array<Paragraph | Table> {
  const [dw, qw, rw, aw] = LAYOUT.costTable;
  const s = LAYOUT.costText.size;

  const head = (text: string, w: number, align: Align) =>
    cell([para([run(text, { bold: true, color: "FFFFFF", size: s })], { align })], w, { fill: C.teal, margins: true, vAlign: VerticalAlign.CENTER });

  const rows = [
    new TableRow({
      tableHeader: true,
      children: [
        head("Description", dw, AlignmentType.LEFT),
        head("Qty", qw, AlignmentType.CENTER),
        head("Rate", rw, AlignmentType.CENTER),
        head("Amount", aw, AlignmentType.CENTER),
      ],
    }),
  ];

  inv.costLines.forEach((l, i) => {
    const fill = i % 2 === 0 ? "FFFFFF" : C.lightFill; // banding, white first
    const desc = [para([run(l.description, { bold: true, color: C.text, size: s })])];
    if (l.detail) desc.push(para([run(l.detail, { italics: true, color: C.gray, size: LAYOUT.costText.detailSize })], { before: LAYOUT.costText.detailBefore }));
    const num = (text: string, w: number, bold = false) =>
      cell([para([run(text, { bold: bold || undefined, size: s })], { align: AlignmentType.CENTER })], w, { fill, vAlign: VerticalAlign.CENTER });
    rows.push(
      new TableRow({
        cantSplit: true,
        children: [
          cell(desc, dw, { fill, margins: true }),
          num(l.quantityMilli === null ? "" : formatQuantity(l.quantityMilli), qw),
          num(l.rateCents === null ? "" : formatCents(l.rateCents), rw),
          num(formatCents(l.amountCents), aw, true),
        ],
      }),
    );
  });

  // Totals rows live inside the same table: an empty cell spanning
  // Description + Qty, the label under Rate, the amount under Amount.
  const total = (label: string, cents: number, dark = false) => {
    const fill = dark ? LAYOUT.totalRow.fill : "FFFFFF";
    const o: RunOpts = dark ? { bold: true, color: "FFFFFF", size: LAYOUT.totalRow.size } : { bold: false, color: C.text, size: s };
    return new TableRow({
      cantSplit: true,
      children: [
        cell([], dw + qw, { fill, margins: true, span: 2 }),
        cell([para([run(label, o)], { align: AlignmentType.RIGHT, keepNext: !dark })], rw, { fill, margins: true, vAlign: VerticalAlign.CENTER }),
        cell([para([run(formatCents(cents), o)], { align: AlignmentType.CENTER, keepNext: !dark })], aw, { fill, margins: true, vAlign: VerticalAlign.CENTER }),
      ],
    });
  };
  if (showsBreakdown(inv)) {
    rows.push(total("Subtotal (Labor & Materials)", inv.subtotalCents));
    if (inv.overheadPercentHundredths) rows.push(total(`Overhead (${formatPercent(inv.overheadPercentHundredths)})`, inv.overheadCents));
    if (inv.profitPercentHundredths) rows.push(total(`Profit (${formatPercent(inv.profitPercentHundredths)})`, inv.profitCents));
  }
  rows.push(total(labels.total, inv.contractTotalCents, true));

  return [heading(labels.heading, LAYOUT.headingSpacing.cost), table(LAYOUT.costTable, rows, GRID_TABLE_BORDERS)];
}

// ------------------------------------------------------ account summary

function accountSummary(inv: DocxInvoice): Array<Paragraph | Table> {
  // Same grid and borders as the cost table: description spans
  // Description + Qty + Rate, amounts sit in the Amount column.
  const [dw, qw, rw, aw] = LAYOUT.costTable;
  const s = LAYOUT.costText.size;
  const row = (desc: string, amount: string, o: { balance?: boolean; bold?: boolean } = {}) => {
    const fill = o.balance ? LAYOUT.balanceRow.fill : "FFFFFF";
    const r: RunOpts = o.balance
      ? { bold: true, color: "FFFFFF", size: LAYOUT.balanceRow.size }
      : { bold: o.bold, color: C.text, size: s };
    const keepNext = !o.balance; // the whole summary stays on one page
    return new TableRow({
      cantSplit: true,
      children: [
        cell([para([run(desc, r)], { keepNext })], dw + qw + rw, { fill, margins: true, span: 3, vAlign: VerticalAlign.CENTER }),
        cell([para([run(amount, r)], { align: AlignmentType.CENTER, keepNext })], aw, { fill, margins: true, vAlign: VerticalAlign.CENTER }),
      ],
    });
  };

  const rows = [row(inv.contractDate ? `Contract Total (agreement dated ${toUsDate(inv.contractDate)})` : "Contract Total", formatCents(inv.contractTotalCents), { bold: true })];
  for (const d of inv.deposits) {
    const parts = ["Deposit Received", d.date ? toUsDate(d.date) : null, d.description && d.description !== "Deposit" ? d.description : null].filter(Boolean);
    rows.push(row(parts.join(" - "), `(${formatCents(d.amountCents)})`));
  }
  for (const c of inv.changeOrders) rows.push(row(`Change Order / Add-On - ${c.description}`, formatCents(c.amountCents)));
  rows.push(row("BALANCE DUE", formatCents(inv.balanceDueCents), { balance: true }));

  return [heading("ACCOUNT SUMMARY", LAYOUT.headingSpacing.summary), table(LAYOUT.costTable, rows, GRID_TABLE_BORDERS)];
}

// ------------------------------------------------------- payment terms

function paymentTerms(inv: { paymentTerms: string | null }): Paragraph[] {
  const lines = (inv.paymentTerms ?? "").split(/\n+/).map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return [];
  return [
    heading("PAYMENT TERMS", LAYOUT.headingSpacing.payment),
    ...lines.map((l, i) =>
      para([run(l, { color: C.text, size: LAYOUT.body.size })], {
        after: i === lines.length - 1 ? LAYOUT.paymentLastAfter : LAYOUT.bullet.after,
      }),
    ),
  ];
}

// ----------------------------------------------- acceptance (estimates)

function acceptance(clientName: string): Array<Paragraph | Table> {
  const a = LAYOUT.acceptance;
  const line = (before: number) =>
    para([run(" ", { size: LAYOUT.body.size })], { before, border: { style: BorderStyle.SINGLE, size: a.lineSize, color: a.lineColor, space: 1 } });
  const caption = (t: string) => para([run(t, { color: C.gray, size: a.captionSize })], { before: a.captionBefore });
  const side = (who: string) => [line(a.firstLineBefore), caption(who), line(a.secondLineBefore), caption("Date")];
  const [lw, gw, rw] = a.table;
  return [
    heading("ACCEPTANCE", LAYOUT.headingSpacing.acceptance),
    para([run(a.statement, { color: C.text, size: LAYOUT.body.size })], { after: a.statementAfter }),
    table(
      a.table,
      [
        new TableRow({
          cantSplit: true,
          children: [
            cell(side(`${COMPANY.shortName} — Authorized Signature`), lw),
            cell([], gw),
            cell(side(`Client — Acceptance Signature${clientName ? ` (${clientName})` : ""}`), rw),
          ],
        }),
      ],
      NO_TABLE_BORDERS,
    ),
  ];
}

export async function buildInvoiceDocx(inv: DocxInvoice): Promise<Buffer> {
  const meta: Array<[string, string]> = [["Invoice #:", inv.invoiceNumber], ["Date:", toLongDate(inv.invoiceDate)]];
  if (inv.dueDate) meta.push(["Due Date:", toLongDate(inv.dueDate)]);
  if (inv.terms) meta.push(["Terms:", inv.terms]);
  const children: Array<Paragraph | Table> = [
    ...header(),
    titleRow("INVOICE", inv, meta),
    para([], { after: LAYOUT.afterTitleSpacer }),
    parties(inv),
    ...scope(inv),
  ];
  if (inv.costLines.length) children.push(...costTable(inv, { heading: "COST DETAIL", total: "CONTRACT TOTAL" }));
  children.push(...accountSummary(inv), ...paymentTerms(inv));
  return packDocument(`Invoice ${inv.invoiceNumber}`, children);
}

export interface DocxEstimate extends PartyFields, CostFields {
  estimateNumber: string;
  estimateDate: string;
  validDays: number;
  subtitle: string | null;
  tag: string | null;
  scope: string[];
  paymentTerms: string | null;
}

/** Estimate: the reference document's own layout, ACCEPTANCE block included. */
export async function buildEstimateDocx(est: DocxEstimate): Promise<Buffer> {
  const children: Array<Paragraph | Table> = [
    ...header(),
    titleRow("ESTIMATE & SCOPE OF WORK", est, [
      ["Estimate #:", est.estimateNumber],
      ["Date:", toLongDate(est.estimateDate)],
      ["Valid For:", `${est.validDays} days`],
    ]),
    para([], { after: LAYOUT.afterTitleSpacer }),
    parties(est),
    ...scope(est),
  ];
  if (est.costLines.length) children.push(...costTable(est, { heading: "COST ESTIMATE", total: "TOTAL ESTIMATE" }));
  children.push(...paymentTerms(est), ...acceptance(est.customerName));
  return packDocument(`Estimate ${est.estimateNumber}`, children);
}

function packDocument(title: string, children: Array<Paragraph | Table>): Promise<Buffer> {
  const doc = new Document({
    creator: COMPANY.legalName,
    title,
    styles: {
      default: {
        document: { run: { font: LAYOUT.font, size: LAYOUT.defaultSize } },
        // Same definition as the reference's styles.xml "Heading 2".
        heading2: {
          run: { font: LAYOUT.font, color: LAYOUT.heading.color, size: LAYOUT.heading.size, bold: false },
          paragraph: { spacing: { line: 240, lineRule: LineRuleType.AUTO } },
        },
      },
    },
    sections: [
      {
        properties: {
          page: {
            size: { width: LAYOUT.page.width, height: LAYOUT.page.height },
            margin: {
              top: LAYOUT.page.margin,
              right: LAYOUT.page.margin,
              bottom: LAYOUT.page.margin,
              left: LAYOUT.page.margin,
              header: LAYOUT.page.headerFooter,
              footer: LAYOUT.page.headerFooter,
            },
          },
        },
        children,
      },
    ],
  });
  return Packer.toBuffer(doc);
}

/** All visible text in a generated .docx (used by tests). */
export function docxPlainText(documentXml: string): string {
  const entities: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
  return [...documentXml.matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g)]
    .map((m) => m[1].replace(/&(amp|lt|gt|quot|apos);/g, (_, e: string) => entities[e]))
    .join("");
}
