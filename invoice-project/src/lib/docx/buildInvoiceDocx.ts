import {
  AlignmentType,
  BorderStyle,
  Document,
  ImageRun,
  LineRuleType,
  Packer,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableLayoutType,
  TableRow,
  TextRun,
  VerticalAlign,
  WidthType,
  type IBorderOptions,
  type ParagraphChild,
} from "docx";
import { COMPANY } from "../company";
import { formatCents, formatPercent, formatQuantity } from "../money";
import { toLongDate, toUsDate } from "../dates";
import { LOGO } from "./logo";

// ---------------------------------------------------------------------------
// LAYOUT: every measurement in one place.
// Units: twips/dxa (1/1440 in) for geometry, half-points for font sizes,
// eighths of a point for border sizes, EMU for the logo.
//
// Values marked SPEC come from Nick's written spec of the reference estimate
// (Freedom_Exteriors_Estimate_Pearson.docx). Values marked UNMEASURED are
// placeholders until that file is in reference/ and can be measured from
// word/document.xml and word/styles.xml.
// ---------------------------------------------------------------------------
export const LAYOUT = {
  font: "Arial", // UNMEASURED: confirm from styles.xml docDefaults
  page: { width: 12240, height: 15840, margin: 900 }, // SPEC: US Letter, 900 twips all sides
  logo: { widthEmu: 2476500, heightEmu: 1647825 }, // SPEC
  size: {
    headerLine: 16, // SPEC 8pt
    title: 30, // SPEC 15pt "INVOICE"
    subtitle: 18, // SPEC 9pt italic gray
    tag: 18, // SPEC 9pt bold gold
    meta: 18, // SPEC 9pt (Invoice #, Date, Due Date, Terms)
    label: 16, // SPEC 8pt bold (PREPARED FOR / JOB SITE)
    value: 18, // SPEC 9pt
    body: 18, // UNMEASURED: cost-table and summary text, assumed 9pt
    detail: 15, // SPEC 7.5pt detail line under a cost description
    sectionHeading: 20, // UNMEASURED: SCOPE OF WORK / ACCOUNT SUMMARY / PAYMENT TERMS
    total: 22, // SPEC 11pt bold total
  },
  goldRule: { size: 16, space: 4 }, // SPEC sz 16 (space UNMEASURED)
  titleTable: [5220, 5220], // SPEC
  partiesTable: [5220, 5220], // UNMEASURED: assumed same split as the title row
  costTable: [5640, 1200, 1800, 1800], // UNMEASURED: Description, Qty, Rate, Amount (sum 10440)
  totalsTable: [8640, 1800], // UNMEASURED
  summaryTable: [8640, 1800], // UNMEASURED
  cellMargin: { top: 40, bottom: 40, left: 100, right: 100 }, // UNMEASURED
  gridBorder: { size: 4, color: "D9D9D9" }, // UNMEASURED
  spacing: { sectionBefore: 200, sectionAfter: 80, line: 240 }, // UNMEASURED
} as const;

const C = COMPANY.colors;
const CONTENT_WIDTH = LAYOUT.page.width - 2 * LAYOUT.page.margin; // 10440
const EMU_PER_PX = 9525;

export interface DocxCostLine {
  description: string;
  detail: string | null;
  quantityMilli: number | null;
  rateCents: number | null;
  amountCents: number;
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

const NONE: IBorderOptions = { style: BorderStyle.NONE, size: 0, color: "FFFFFF" };
const NO_BORDERS = { top: NONE, bottom: NONE, left: NONE, right: NONE };
const NO_TABLE_BORDERS = { ...NO_BORDERS, insideHorizontal: NONE, insideVertical: NONE };
const GRID: IBorderOptions = { style: BorderStyle.SINGLE, size: LAYOUT.gridBorder.size, color: LAYOUT.gridBorder.color };
const GRID_BORDERS = { top: GRID, bottom: GRID, left: GRID, right: GRID };

type Align = (typeof AlignmentType)[keyof typeof AlignmentType];

interface RunOpts {
  bold?: boolean;
  italics?: boolean;
  size?: number;
  color?: string;
}

function run(text: string, o: RunOpts = {}) {
  return new TextRun({
    text,
    font: LAYOUT.font,
    size: o.size ?? LAYOUT.size.body,
    bold: o.bold,
    italics: o.italics,
    color: o.color ?? C.text,
  });
}

function para(children: ParagraphChild[], o: { align?: Align; before?: number; after?: number; keepNext?: boolean } = {}) {
  return new Paragraph({
    children,
    alignment: o.align,
    keepNext: o.keepNext,
    keepLines: o.keepNext,
    spacing: { before: o.before ?? 0, after: o.after ?? 0, line: LAYOUT.spacing.line, lineRule: LineRuleType.AUTO },
  });
}

function cell(children: Paragraph[], width: number, o: { fill?: string; borders?: typeof GRID_BORDERS; margins?: boolean } = {}) {
  return new TableCell({
    children,
    width: { size: width, type: WidthType.DXA },
    borders: o.borders ?? NO_BORDERS,
    verticalAlign: VerticalAlign.TOP,
    shading: o.fill ? { type: ShadingType.CLEAR, color: "auto", fill: o.fill } : undefined,
    margins: o.margins === false ? undefined : LAYOUT.cellMargin,
  });
}

function table(widths: readonly number[], rows: TableRow[], borderless = true) {
  return new Table({
    width: { size: widths.reduce((a, b) => a + b, 0), type: WidthType.DXA },
    columnWidths: [...widths],
    layout: TableLayoutType.FIXED,
    borders: borderless ? NO_TABLE_BORDERS : undefined,
    rows,
  });
}

// keepNext: a heading never sits alone at the bottom of a page.
function sectionHeading(text: string) {
  return para([run(text, { bold: true, size: LAYOUT.size.sectionHeading, color: C.teal })], {
    before: LAYOUT.spacing.sectionBefore,
    after: LAYOUT.spacing.sectionAfter,
    keepNext: true,
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
  const out: Paragraph[] = [];
  if (LOGO) {
    out.push(
      para(
        [
          new ImageRun({
            type: "png",
            data: Buffer.from(LOGO.base64, "base64"),
            transformation: {
              width: Math.round(LAYOUT.logo.widthEmu / EMU_PER_PX),
              height: Math.round(LAYOUT.logo.heightEmu / EMU_PER_PX),
            },
            altText: { name: "Logo", title: COMPANY.legalName, description: `${COMPANY.legalName} logo` },
          }),
        ],
        { align: AlignmentType.CENTER },
      ),
    );
  } else {
    // Until the reference logo is in the repo: company name in its place.
    out.push(para([run(COMPANY.legalName.toUpperCase(), { bold: true, size: 32, color: C.teal })], { align: AlignmentType.CENTER, after: 60 }));
  }
  const gray = { size: LAYOUT.size.headerLine, color: C.gray };
  out.push(para([run(COMPANY.addressLine, gray)], { align: AlignmentType.CENTER }));
  out.push(
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 0, after: 120, line: LAYOUT.spacing.line, lineRule: LineRuleType.AUTO },
      border: { bottom: { style: BorderStyle.SINGLE, size: LAYOUT.goldRule.size, color: C.gold, space: LAYOUT.goldRule.space } },
      children: [run(COMPANY.licenseLine, gray)],
    }),
  );
  return out;
}

// ------------------------------------------------------------ title row

function titleRow(inv: DocxInvoice): Table {
  const [lw, rw] = LAYOUT.titleTable;
  const left = [para([run("INVOICE", { bold: true, size: LAYOUT.size.title, color: C.teal })])];
  if (inv.subtitle) left.push(para([run(inv.subtitle, { italics: true, size: LAYOUT.size.subtitle, color: C.gray })]));
  if (inv.tag) left.push(para([run(inv.tag, { bold: true, size: LAYOUT.size.tag, color: C.gold })]));

  const meta = (label: string, value: string) =>
    para([run(`${label} `, { bold: true, size: LAYOUT.size.meta }), run(value, { size: LAYOUT.size.meta })], { align: AlignmentType.RIGHT });
  const right = [meta("Invoice #:", inv.invoiceNumber), meta("Date:", toLongDate(inv.invoiceDate))];
  if (inv.dueDate) right.push(meta("Due Date:", toLongDate(inv.dueDate)));
  if (inv.terms) right.push(meta("Terms:", inv.terms));

  return table(LAYOUT.titleTable, [new TableRow({ children: [cell(left, lw, { margins: false }), cell(right, rw, { margins: false })] })]);
}

// ---------------------------------------------- prepared for / job site

function parties(inv: DocxInvoice): Table {
  const [lw, rw] = LAYOUT.partiesTable;
  const label = (t: string) => para([run(t, { bold: true, size: LAYOUT.size.label, color: C.gray })], { before: 200, after: 20 });
  const value = (t: string, bold = false) => para([run(t, { size: LAYOUT.size.value, bold })]);

  const billing = addressLines(inv.customerAddress ?? inv.jobAddress);
  const left = [label("PREPARED FOR"), value(inv.customerName, true), ...billing.map((l) => value(l))];
  if (inv.customerPhone) left.push(value(inv.customerPhone));

  const site = addressLines(inv.jobAddress);
  const right = [label("JOB SITE"), ...(site.length ? site.map((l) => value(l)) : [value("Same as above")])];

  return table(LAYOUT.partiesTable, [new TableRow({ children: [cell(left, lw, { margins: false }), cell(right, rw, { margins: false })] })]);
}

// ---------------------------------------------------------------- scope

function scope(inv: DocxInvoice): Paragraph[] {
  if (!inv.scope.length) return [];
  return [
    sectionHeading("SCOPE OF WORK"),
    ...inv.scope.map(
      (line) =>
        new Paragraph({
          bullet: { level: 0 },
          spacing: { after: 40, line: LAYOUT.spacing.line, lineRule: LineRuleType.AUTO },
          children: [run(line, { size: LAYOUT.size.value })],
        }),
    ),
  ];
}

// ----------------------------------------------------------- cost table

function costTable(inv: DocxInvoice): Table {
  const [dw, qw, rw, aw] = LAYOUT.costTable;
  const head = (t: string, w: number, align: Align) =>
    cell([para([run(t, { bold: true, color: "FFFFFF" })], { align })], w, { fill: C.teal, borders: GRID_BORDERS });

  const rows = [
    new TableRow({
      tableHeader: true,
      children: [
        head("DESCRIPTION", dw, AlignmentType.LEFT),
        head("QTY", qw, AlignmentType.CENTER),
        head("RATE", rw, AlignmentType.RIGHT),
        head("AMOUNT", aw, AlignmentType.RIGHT),
      ],
    }),
  ];

  inv.costLines.forEach((l, i) => {
    const fill = i % 2 === 1 ? C.lightFill : undefined; // banding
    const descParas = [para([run(l.description, { bold: true })])];
    if (l.detail) descParas.push(para([run(l.detail, { size: LAYOUT.size.detail, color: C.gray })]));
    rows.push(
      new TableRow({
        cantSplit: true,
        children: [
          cell(descParas, dw, { fill, borders: GRID_BORDERS }),
          cell([para([run(l.quantityMilli === null ? "" : formatQuantity(l.quantityMilli))], { align: AlignmentType.CENTER })], qw, { fill, borders: GRID_BORDERS }),
          cell([para([run(l.rateCents === null ? "" : formatCents(l.rateCents))], { align: AlignmentType.RIGHT })], rw, { fill, borders: GRID_BORDERS }),
          cell([para([run(formatCents(l.amountCents))], { align: AlignmentType.RIGHT })], aw, { fill, borders: GRID_BORDERS }),
        ],
      }),
    );
  });
  return table(LAYOUT.costTable, rows, false);
}

// --------------------------------------------------------------- totals

function totals(inv: DocxInvoice): Table {
  const [lw, vw] = LAYOUT.totalsTable;
  const line = (label: string, cents: number, big = false) =>
    new TableRow({
      children: [
        cell([para([run(label, { bold: big, size: big ? LAYOUT.size.total : LAYOUT.size.body })], { align: AlignmentType.RIGHT, keepNext: !big })], lw, { margins: false }),
        cell([para([run(formatCents(cents), { bold: big, size: big ? LAYOUT.size.total : LAYOUT.size.body })], { align: AlignmentType.RIGHT, keepNext: !big })], vw, { margins: false }),
      ],
    });
  const rows = [line("Subtotal", inv.subtotalCents)];
  if (inv.overheadPercentHundredths) rows.push(line(`Overhead (${formatPercent(inv.overheadPercentHundredths)})`, inv.overheadCents));
  if (inv.profitPercentHundredths) rows.push(line(`Profit (${formatPercent(inv.profitPercentHundredths)})`, inv.profitCents));
  rows.push(line("TOTAL", inv.contractTotalCents, true));
  return table(LAYOUT.totalsTable, rows);
}

// ------------------------------------------------------ account summary

function accountSummary(inv: DocxInvoice): Array<Paragraph | Table> {
  const [dw, aw] = LAYOUT.summaryTable;
  // Every row except BALANCE DUE keeps with the next, so the summary never
  // splits across pages.
  const row = (desc: string, amount: string, o: { balance?: boolean; bold?: boolean } = {}) => {
    const keepNext = !o.balance;
    const color = o.balance ? "FFFFFF" : C.text;
    const bold = o.balance || o.bold;
    const size = o.balance ? LAYOUT.size.total : LAYOUT.size.body;
    const fill = o.balance ? C.teal : undefined;
    return new TableRow({
      cantSplit: true,
      children: [
        cell([para([run(desc, { bold, color, size })], { keepNext })], dw, { fill, borders: GRID_BORDERS }),
        cell([para([run(amount, { bold, color, size })], { align: AlignmentType.RIGHT, keepNext })], aw, { fill, borders: GRID_BORDERS }),
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

  return [sectionHeading("ACCOUNT SUMMARY"), table(LAYOUT.summaryTable, rows, false)];
}

// ------------------------------------------------------- payment terms

function paymentTerms(inv: DocxInvoice): Paragraph[] {
  const text = (inv.paymentTerms ?? "").trim();
  if (!text) return [];
  return [sectionHeading("PAYMENT TERMS"), ...text.split(/\n+/).map((p) => para([run(p, { size: LAYOUT.size.value })], { after: 60 }))];
}

export async function buildInvoiceDocx(inv: DocxInvoice): Promise<Buffer> {
  const children: Array<Paragraph | Table> = [
    ...header(),
    titleRow(inv),
    parties(inv),
    ...scope(inv),
  ];
  if (inv.costLines.length) {
    children.push(sectionHeading("COST DETAIL"), costTable(inv), para([], { after: 60 }), totals(inv));
  }
  children.push(...accountSummary(inv), ...paymentTerms(inv));

  const doc = new Document({
    creator: COMPANY.legalName,
    title: `Invoice ${inv.invoiceNumber}`,
    styles: { default: { document: { run: { font: LAYOUT.font, size: LAYOUT.size.body, color: C.text } } } },
    sections: [
      {
        properties: {
          page: {
            size: { width: LAYOUT.page.width, height: LAYOUT.page.height },
            margin: { top: LAYOUT.page.margin, bottom: LAYOUT.page.margin, left: LAYOUT.page.margin, right: LAYOUT.page.margin },
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
  return [...documentXml.matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g)].map((m) => m[1]).join("");
}
