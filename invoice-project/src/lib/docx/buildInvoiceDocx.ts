import {
  AlignmentType,
  BorderStyle,
  Document,
  ImageRun,
  LevelFormat,
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
} from "docx";
import { COMPANY } from "../company";
import { formatCents } from "../money";
import { toLongDate, toUsDate } from "../dates";
import { LOGO } from "./logo";

// ---------------------------------------------------------------------------
// LAYOUT: every measurement in one place. Units: twips (1/1440 inch) for
// page/table geometry, half-points for font sizes, eighths of a point for
// rule thickness.
//
// TODO(reference): these values are a first pass. They must be replaced with
// the measurements reverse-engineered from reference/*.docx once it is
// uploaded to the repo.
// ---------------------------------------------------------------------------
export const LAYOUT = {
  font: "Calibri",
  page: { width: 12240, height: 15840, margin: 1080 }, // US Letter, 0.75" margins
  size: { body: 21, small: 18, companyName: 30, label: 18, heading: 22, balance: 24 },
  logo: { widthPx: 150 }, // height follows the image's aspect ratio
  header: { leftPct: 55 },
  rules: { goldSize: 24, tealSize: 8, gap: 40 },
  billTo: { leftPct: 55, spaceBefore: 240 },
  scope: { spaceBefore: 280, bulletIndent: 360 },
  summary: { spaceBefore: 280, amountPct: 28, cellPad: 80, borderSize: 4, borderColor: "BFBFBF" },
} as const;

const TEAL = COMPANY.colors.teal;
const GOLD = COMPANY.colors.gold;
const TEXT = COMPANY.colors.text;
const CONTENT_WIDTH = LAYOUT.page.width - 2 * LAYOUT.page.margin;

export interface DocxInvoice {
  invoiceNumber: string;
  invoiceDate: string;
  dueDate: string | null;
  contractDate: string | null;
  terms: string | null;
  customerName: string;
  customerPhone: string | null;
  jobAddress: string | null;
  scope: string[];
  contractTotalCents: number;
  deposits: Array<{ date: string | null; description: string; amountCents: number }>;
  changeOrders: Array<{ description: string; amountCents: number }>;
  balanceDueCents: number;
}

const NONE: IBorderOptions = { style: BorderStyle.NONE, size: 0, color: "FFFFFF" };
const NO_BORDERS = { top: NONE, bottom: NONE, left: NONE, right: NONE };
const NO_TABLE_BORDERS = { ...NO_BORDERS, insideHorizontal: NONE, insideVertical: NONE };

function run(text: string, opts: { bold?: boolean; size?: number; color?: string; allCaps?: boolean } = {}) {
  return new TextRun({
    text,
    font: LAYOUT.font,
    size: opts.size ?? LAYOUT.size.body,
    bold: opts.bold,
    color: opts.color ?? TEXT,
    allCaps: opts.allCaps,
  });
}

function para(
  children: TextRun[] | ImageRun[],
  opts: { align?: (typeof AlignmentType)[keyof typeof AlignmentType]; before?: number; after?: number } = {},
) {
  return new Paragraph({
    children,
    alignment: opts.align,
    spacing: { before: opts.before ?? 0, after: opts.after ?? 0, line: 252 },
  });
}

function cell(children: Paragraph[], widthTwips: number, extra: Partial<ConstructorParameters<typeof TableCell>[0]> = {}) {
  return new TableCell({
    children,
    width: { size: widthTwips, type: WidthType.DXA },
    borders: NO_BORDERS,
    verticalAlign: VerticalAlign.TOP,
    ...extra,
  });
}

function twoColumnTable(left: Paragraph[], right: Paragraph[], leftPct: number) {
  const lw = Math.round((CONTENT_WIDTH * leftPct) / 100);
  const rw = CONTENT_WIDTH - lw;
  return new Table({
    width: { size: CONTENT_WIDTH, type: WidthType.DXA },
    columnWidths: [lw, rw],
    layout: TableLayoutType.FIXED,
    borders: NO_TABLE_BORDERS,
    rows: [new TableRow({ children: [cell(left, lw), cell(right, rw)] })],
  });
}

function letterhead(): Array<Paragraph | Table> {
  const left: Paragraph[] = [];
  if (LOGO) {
    const w = LAYOUT.logo.widthPx;
    const h = Math.round((w * LOGO.height) / LOGO.width);
    left.push(
      para([
        new ImageRun({
          type: "png",
          data: Buffer.from(LOGO.base64, "base64"),
          transformation: { width: w, height: h },
          altText: { name: "Logo", title: COMPANY.legalName, description: `${COMPANY.legalName} logo` },
        }),
      ], { after: 60 }),
    );
  }
  left.push(para([run(COMPANY.legalName.toUpperCase(), { bold: true, size: LAYOUT.size.companyName, color: TEAL })]));
  left.push(para([run(COMPANY.tagline, { size: LAYOUT.size.small, bold: true })]));
  left.push(para([run(COMPANY.services, { size: LAYOUT.size.small })]));

  const right = [
    para([run(COMPANY.addressLine1, { size: LAYOUT.size.small })], { align: AlignmentType.RIGHT }),
    para([run(COMPANY.addressLine2, { size: LAYOUT.size.small })], { align: AlignmentType.RIGHT }),
    para([run(COMPANY.phone, { size: LAYOUT.size.small })], { align: AlignmentType.RIGHT }),
    ...COMPANY.licenses.map((l) => para([run(l, { size: LAYOUT.size.small })], { align: AlignmentType.RIGHT })),
  ];

  return [
    twoColumnTable(left, right, LAYOUT.header.leftPct),
    // Gold rule, then teal rule directly under it.
    new Paragraph({
      spacing: { before: 120, after: LAYOUT.rules.gap },
      border: { bottom: { style: BorderStyle.SINGLE, size: LAYOUT.rules.goldSize, color: GOLD, space: 1 } },
      children: [],
    }),
    new Paragraph({
      spacing: { before: 0, after: 0 },
      border: { top: { style: BorderStyle.SINGLE, size: LAYOUT.rules.tealSize, color: TEAL, space: 1 } },
      children: [],
    }),
  ];
}

function label(text: string) {
  return run(text, { bold: true, size: LAYOUT.size.label, color: TEAL, allCaps: true });
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

function billToBlock(inv: DocxInvoice): Table {
  const left = [para([label("Bill To")], { before: LAYOUT.billTo.spaceBefore, after: 40 })];
  left.push(para([run(inv.customerName, { bold: true })]));
  for (const line of addressLines(inv.jobAddress)) {
    left.push(para([run(line)]));
  }
  if (inv.customerPhone) left.push(para([run(inv.customerPhone)]));

  const pair = (k: string, v: string, first = false) =>
    para([label(`${k}  `), run(v, { bold: k === "Invoice No." })], {
      align: AlignmentType.RIGHT,
      before: first ? LAYOUT.billTo.spaceBefore : 0,
      after: 20,
    });
  const right = [pair("Invoice No.", inv.invoiceNumber, true), pair("Invoice Date", toLongDate(inv.invoiceDate))];
  if (inv.contractDate) right.push(pair("Contract Date", toLongDate(inv.contractDate)));
  if (inv.dueDate) right.push(pair("Due Date", toLongDate(inv.dueDate)));
  if (inv.terms) right.push(pair("Terms", inv.terms));

  return twoColumnTable(left, right, LAYOUT.billTo.leftPct);
}

function scopeBlock(inv: DocxInvoice): Paragraph[] {
  if (!inv.scope.length) return [];
  return [
    para([label("Scope of Work")], { before: LAYOUT.scope.spaceBefore, after: 80 }),
    ...inv.scope.map(
      (line) =>
        new Paragraph({
          numbering: { reference: "scope-bullets", level: 0 },
          spacing: { after: 40, line: 252 },
          children: [run(line)],
        }),
    ),
  ];
}

function summaryTable(inv: DocxInvoice): Array<Paragraph | Table> {
  const aw = Math.round((CONTENT_WIDTH * LAYOUT.summary.amountPct) / 100);
  const dw = CONTENT_WIDTH - aw;
  const line: IBorderOptions = { style: BorderStyle.SINGLE, size: LAYOUT.summary.borderSize, color: LAYOUT.summary.borderColor };
  const pad = LAYOUT.summary.cellPad;
  const margins = { top: pad, bottom: pad, left: pad * 1.5, right: pad * 1.5 };

  const row = (desc: string, amount: string, opts: { shade?: boolean; bold?: boolean } = {}) => {
    const color = opts.shade ? "FFFFFF" : TEXT;
    const size = opts.shade ? LAYOUT.size.balance : LAYOUT.size.body;
    const shading = opts.shade ? { type: ShadingType.CLEAR, color: "auto", fill: TEAL } : undefined;
    const borders = { top: line, bottom: line, left: line, right: line };
    return new TableRow({
      children: [
        new TableCell({
          width: { size: dw, type: WidthType.DXA },
          borders,
          shading,
          margins,
          children: [para([run(desc, { bold: opts.bold || opts.shade, color, size })])],
        }),
        new TableCell({
          width: { size: aw, type: WidthType.DXA },
          borders,
          shading,
          margins,
          children: [para([run(amount, { bold: opts.bold || opts.shade, color, size })], { align: AlignmentType.RIGHT })],
        }),
      ],
    });
  };

  const rows = [
    row(inv.contractDate ? `Contract total (agreement dated ${toUsDate(inv.contractDate)})` : "Contract total", formatCents(inv.contractTotalCents), { bold: true }),
  ];
  for (const d of inv.deposits) {
    const when = d.date ? ` (${toUsDate(d.date)})` : "";
    rows.push(row(`Deposit received${when}${d.description && d.description !== "Deposit" ? `: ${d.description}` : ""}`, `(${formatCents(d.amountCents)})`));
  }
  for (const co of inv.changeOrders) rows.push(row(`Change order / add-on: ${co.description}`, formatCents(co.amountCents)));
  rows.push(row("BALANCE DUE", formatCents(inv.balanceDueCents), { shade: true }));

  return [
    para([label("Account Summary")], { before: LAYOUT.summary.spaceBefore, after: 80 }),
    new Table({
      width: { size: CONTENT_WIDTH, type: WidthType.DXA },
      columnWidths: [dw, aw],
      layout: TableLayoutType.FIXED,
      rows,
    }),
  ];
}

export async function buildInvoiceDocx(inv: DocxInvoice): Promise<Buffer> {
  const doc = new Document({
    creator: COMPANY.legalName,
    title: `Invoice ${inv.invoiceNumber}`,
    styles: { default: { document: { run: { font: LAYOUT.font, size: LAYOUT.size.body, color: TEXT } } } },
    numbering: {
      config: [
        {
          reference: "scope-bullets",
          levels: [
            {
              level: 0,
              format: LevelFormat.BULLET,
              text: "•",
              alignment: AlignmentType.LEFT,
              style: { paragraph: { indent: { left: LAYOUT.scope.bulletIndent, hanging: 240 } } },
            },
          ],
        },
      ],
    },
    sections: [
      {
        properties: {
          page: {
            size: { width: LAYOUT.page.width, height: LAYOUT.page.height },
            margin: { top: LAYOUT.page.margin, bottom: LAYOUT.page.margin, left: LAYOUT.page.margin, right: LAYOUT.page.margin },
          },
        },
        children: [...letterhead(), billToBlock(inv), ...scopeBlock(inv), ...summaryTable(inv)],
      },
    ],
  });
  return Packer.toBuffer(doc);
}
