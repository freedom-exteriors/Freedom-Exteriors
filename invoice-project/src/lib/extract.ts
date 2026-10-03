import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { docxToText, DocxError } from "./docxText";

// Reads an uploaded invoice (PDF or image) with Claude and returns the fields
// as structured JSON. The output is NEVER saved automatically: it only fills
// the review screen, where Nick checks and corrects it first.

export const EXTRACTION_MODEL = "claude-sonnet-5-5";

const FIELD_NAMES = [
  "customer_name",
  "customer_phone",
  "customer_address",
  "job_address",
  "subtitle",
  "invoice_number",
  "invoice_date",
  "due_date",
  "contract_date",
  "line_items",
  "contract_total",
  "deposits",
  "change_orders",
  "balance_due",
] as const;

// Strict tool schemas allow at most 16 nullable/union-typed parameters, so
// every field is a plain string and "" means "not on the document".
// normalizeFields() turns "" back into null before anything else sees it.
const nullableString = { type: "string" };
const money = {
  type: "string",
  description: "Plain number as printed, no $ or commas, e.g. \"12450.00\". Negative for credits. Empty string if not on the document.",
};
const date = { type: "string", description: "YYYY-MM-DD, or empty string if not on the document." };

export const TOOL: Anthropic.Beta.BetaTool = {
  name: "record_invoice",
  description: "Record the fields read from the invoice document.",
  strict: true,
  input_schema: {
    type: "object",
    additionalProperties: false,
    required: [...FIELD_NAMES, "low_confidence_fields", "notes"],
    properties: {
      customer_name: { ...nullableString, description: "The customer billed (Bill To). Not Freedom Exteriors." },
      customer_phone: nullableString,
      customer_address: { ...nullableString, description: "Customer mailing / billing address if printed separately from the job site, one line." },
      job_address: { ...nullableString, description: "Job site / property address, one line." },
      subtitle: { ...nullableString, description: "Short job description printed under the title, if any." },
      invoice_number: {
        ...nullableString,
        description: "The invoice number EXACTLY as printed (same characters, dashes, prefixes). Empty string if the document shows no invoice number. Never invent one.",
      },
      invoice_date: date,
      due_date: date,
      contract_date: date,
      line_items: {
        type: "array",
        description: "Billable line items / scope lines, in document order. Do not include deposits or the balance line here.",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["description", "detail", "quantity", "rate", "amount"],
          properties: {
            description: { type: "string" },
            detail: { ...nullableString, description: "Smaller secondary text under the description, if any." },
            quantity: { type: "string", description: "Quantity as printed, e.g. \"32.5\". Empty string if not shown." },
            rate: { ...money, description: "Unit price as printed, no $ or commas. Empty string if not shown." },
            amount: money,
          },
        },
      },
      contract_total: { ...money, description: "Contract / invoice total BEFORE deposits are subtracted." },
      deposits: {
        type: "array",
        description: "Each deposit or payment already received, as its own entry.",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["date", "description", "amount"],
          properties: { date, description: { type: "string" }, amount: money },
        },
      },
      change_orders: {
        type: "array",
        description: "Change orders / add-ons listed separately from the contract total.",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["description", "amount"],
          properties: { description: { type: "string" }, amount: money },
        },
      },
      balance_due: money,
      low_confidence_fields: {
        type: "array",
        description: "Fields you are unsure about (hard to read, ambiguous, or inferred).",
        items: { type: "string", enum: [...FIELD_NAMES] },
      },
      notes: { ...nullableString, description: "Anything the reviewer should know, e.g. handwritten edits or a page that was unreadable." },
    },
  },
};

const PROMPT = `This is a past invoice from Freedom Exteriors LLC, a roofing/siding/windows/doors contractor. Read every page and call the record_invoice tool once with what the document says.

Rules:
- Copy values exactly as printed. Do not calculate or guess values that are not on the document; use an empty string instead.
- The customer is who is being billed, never Freedom Exteriors itself.
- If the document prints an invoice number, copy it character-for-character. If it doesn't, use an empty string.
- List any field you are not sure about in low_confidence_fields.
- You must respond by calling record_invoice.`;

export interface ExtractedInvoice {
  customer_name: string | null;
  customer_phone: string | null;
  customer_address: string | null;
  job_address: string | null;
  subtitle: string | null;
  invoice_number: string | null;
  invoice_date: string | null;
  due_date: string | null;
  contract_date: string | null;
  line_items: Array<{ description: string; detail: string | null; quantity: string | null; rate: string | null; amount: string | null }>;
  contract_total: string | null;
  deposits: Array<{ date: string | null; description: string; amount: string | null }>;
  change_orders: Array<{ description: string; amount: string | null }>;
  balance_due: string | null;
  low_confidence_fields: string[];
  notes: string | null;
}

export const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
export type SupportedMime = "application/pdf" | "image/png" | "image/jpeg" | typeof DOCX_MIME;

/** Images above this size are shrunk (a copy, for reading only) before sending. */
const IMAGE_SEND_LIMIT = 3_500_000;

async function prepareImage(data: Buffer, mime: "image/png" | "image/jpeg") {
  if (data.length <= IMAGE_SEND_LIMIT) return { data, mime };
  const sharp = (await import("sharp")).default;
  const out = await sharp(data).rotate().resize({ width: 2400, height: 2400, fit: "inside", withoutEnlargement: true }).jpeg({ quality: 85 }).toBuffer();
  return { data: out, mime: "image/jpeg" as const };
}

export class ExtractionError extends Error {}

export async function extractInvoice(file: Buffer, mime: SupportedMime) {
  if (!process.env.ANTHROPIC_API_KEY) throw new ExtractionError("ANTHROPIC_API_KEY is not configured on the server.");
  const client = new Anthropic({ maxRetries: 2, timeout: 240_000 });

  let block: Anthropic.Beta.BetaContentBlockParam;
  // Word files: Claude reads their text (tables kept as "cell | cell" rows).
  let text: string | null = null;
  if (mime === DOCX_MIME) {
    try {
      text = await docxToText(file);
    } catch (e) {
      if (e instanceof DocxError) throw new ExtractionError(e.message);
      throw e;
    }
    block = {
      type: "document",
      title: "Uploaded Word document (text; table cells separated by |)",
      source: { type: "text", media_type: "text/plain", data: text },
    };
  } else if (mime === "application/pdf") {
    block = { type: "document", source: { type: "base64", media_type: "application/pdf", data: file.toString("base64") } };
  } else {
    const img = await prepareImage(file, mime);
    block = { type: "image", source: { type: "base64", media_type: img.mime, data: img.data.toString("base64") } };
  }

  let response: Anthropic.Beta.BetaMessage;
  try {
    response = await client.beta.messages.create({
      model: EXTRACTION_MODEL,
      max_tokens: 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "medium" },
      tools: [TOOL],
      // This model doesn't accept a forced tool_choice; the strict schema
      // plus the instruction gets a schema-valid call, and we check for it.
      tool_choice: { type: "auto" },
      messages: [{ role: "user", content: [block, { type: "text", text: PROMPT }] }],
    });
  } catch (err) {
    if (err instanceof Anthropic.BadRequestError) {
      throw new ExtractionError(`Claude could not read this file (${err.message}).`);
    }
    if (err instanceof Anthropic.AuthenticationError) throw new ExtractionError("The Anthropic API key was rejected. Check ANTHROPIC_API_KEY.");
    if (err instanceof Anthropic.RateLimitError) throw new ExtractionError("Anthropic rate limit hit. Wait a minute and try again.");
    if (err instanceof Anthropic.APIError) throw new ExtractionError(`Anthropic API error ${err.status ?? ""}: ${err.message}`);
    throw err;
  }

  if (response.stop_reason === "refusal") throw new ExtractionError("Claude declined to read this document.");
  const call = response.content.find((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use" && b.name === TOOL.name);
  if (!call) {
    throw new ExtractionError(
      response.stop_reason === "max_tokens" ? "The document was too long to read in one pass." : "Claude did not return structured data for this file.",
    );
  }
  return { fields: normalizeFields(call.input), raw: response, text };
}

/** "" (the schema's "not on the document") → null, recursively. */
export function normalizeFields(input: unknown): ExtractedInvoice {
  const walk = (v: unknown): unknown => {
    if (typeof v === "string") return v.trim() === "" ? null : v;
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]));
    return v;
  };
  const out = walk(input) as ExtractedInvoice;
  // Arrays and line descriptions must stay present for the review screen.
  out.line_items = (out.line_items ?? []).map((l) => ({ ...l, description: l.description ?? "" }));
  out.deposits = (out.deposits ?? []).map((d) => ({ ...d, description: d.description ?? "" }));
  out.change_orders = (out.change_orders ?? []).map((c) => ({ ...c, description: c.description ?? "" }));
  out.low_confidence_fields = out.low_confidence_fields ?? [];
  return out;
}
