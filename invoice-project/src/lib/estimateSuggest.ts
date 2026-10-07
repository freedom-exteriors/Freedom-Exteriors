// What Claude suggests after reading the photos/files on an estimate, and how
// that suggestion is merged into the estimate form. Nothing here saves
// anything: the result fills the builder, and Nick reviews it before Save.

import { centsToPlain, formatQuantity, parseDollarsToCents, parseQuantityMilli } from "./money";
import type { EstimateFormInput, EstimateLineInput, PriceBookItem } from "./estimate";

export const SUGGEST_BASES = ["measured", "document", "photo", "note"] as const;
export type SuggestBasis = (typeof SUGGEST_BASES)[number];

export interface SuggestedLine {
  price_book_item_id: string | null;
  description: string;
  detail: string | null;
  quantity: string | null;
  unit: string | null;
  unit_price: string | null;
  basis: SuggestBasis;
  why: string | null;
}

export interface EstimateSuggestion {
  customer_name: string | null;
  customer_phone: string | null;
  customer_email: string | null;
  customer_address: string | null;
  job_address: string | null;
  subtitle: string | null;
  tag: string | null;
  lines: SuggestedLine[];
  scope: string[];
  notes: string | null;
}

const BASIS_LABEL: Record<SuggestBasis, string> = {
  measured: "measurement report",
  document: "document",
  photo: "photo — rough estimate, check it",
  note: "your notes",
};

/** Claude's tool input → a clean suggestion ("" means "not found" → null). */
export function normalizeSuggestion(input: unknown): EstimateSuggestion {
  const o = (v: unknown) => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});
  const s = (v: unknown, max = 2000) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);
  const b = o(input);
  const lines = (Array.isArray(b.lines) ? b.lines : []).slice(0, 60).flatMap((raw): SuggestedLine[] => {
    const l = o(raw);
    const description = s(l.description, 500);
    if (!description) return [];
    const basis = SUGGEST_BASES.includes(l.basis as SuggestBasis) ? (l.basis as SuggestBasis) : "document";
    return [{
      price_book_item_id: s(l.price_book_item_id, 64),
      description,
      detail: s(l.detail, 500),
      quantity: s(l.quantity, 30),
      unit: s(l.unit, 20),
      unit_price: s(l.unit_price, 30),
      basis,
      why: s(l.why, 300),
    }];
  });
  return {
    customer_name: s(b.customer_name, 300),
    customer_phone: s(b.customer_phone, 60),
    customer_email: s(b.customer_email, 200),
    customer_address: s(b.customer_address, 500),
    job_address: s(b.job_address, 500),
    subtitle: s(b.subtitle, 300),
    tag: s(b.tag, 60),
    lines,
    scope: (Array.isArray(b.scope) ? b.scope : []).map((x) => s(x, 300)).filter((x): x is string => !!x).slice(0, 40),
    notes: s(b.notes, 4000),
  };
}

const plainQty = (milli: number) => formatQuantity(milli).replace(/,/g, "");

export interface MergeResult {
  form: EstimateFormInput;
  /** Customer/job fields that were blank and got filled. */
  filled: string[];
  added: number;
  /** Price-book items Claude suggested that were already on the estimate. */
  alreadyOn: string[];
  /** Lines with no price yet (Nick has to type one before saving). */
  needPrice: number;
}

const FIELDS: Array<[keyof EstimateSuggestion, keyof EstimateFormInput, string]> = [
  ["customer_name", "customerName", "customer name"],
  ["customer_phone", "customerPhone", "phone"],
  ["customer_email", "customerEmail", "email"],
  ["customer_address", "customerAddress", "mailing address"],
  ["job_address", "jobAddress", "job site address"],
  ["subtitle", "subtitle", "subtitle"],
  ["tag", "tag", "tag"],
];

/**
 * Adds Claude's suggestion to the form without overwriting anything Nick
 * already typed: blank fields get filled, new lines are added, existing
 * lines are left alone. Price-book prices always win over document prices.
 */
export function mergeSuggestion(form: EstimateFormInput, sug: EstimateSuggestion, priceBook: PriceBookItem[]): MergeResult {
  const next: EstimateFormInput = { ...form, lines: [...form.lines] };
  const filled: string[] = [];
  for (const [from, to, label] of FIELDS) {
    const v = sug[from];
    if (typeof v === "string" && v && !String(next[to] ?? "").trim()) {
      (next as unknown as Record<string, unknown>)[to] = v;
      filled.push(label);
    }
  }

  const byId = new Map(priceBook.filter((p) => p.active).map((p) => [p.id, p]));
  const alreadyOn: string[] = [];
  let added = 0;
  for (const l of sug.lines) {
    const item = l.price_book_item_id ? byId.get(l.price_book_item_id) : undefined;
    const qtyMilli = l.quantity ? parseQuantityMilli(l.quantity) : null;
    const docCents = l.unit_price ? parseDollarsToCents(l.unit_price) : null;
    const docPrice = docCents !== null && docCents >= 0 ? centsToPlain(docCents) : "";
    const qtyNote = l.quantity && qtyMilli === null ? ` Quantity "${l.quantity}" couldn't be read; set it.` : !l.quantity ? " No quantity found; set it." : "";
    const note = `🤖 From ${BASIS_LABEL[l.basis]}${l.why ? `: ${l.why}` : ""}.${qtyNote}`;

    if (item) {
      if (next.lines.some((x) => x.priceBookItemId === item.id)) {
        alreadyOn.push(item.label + (l.quantity ? ` (Claude found ${l.quantity} ${item.unit})` : ""));
        continue;
      }
      next.lines.push({
        priceBookItemId: item.id,
        description: item.description,
        detail: item.detail ?? "",
        qty: plainQty(qtyMilli ?? (parseQuantityMilli(String(Number(item.default_quantity))) ?? 1000)),
        unit: item.unit,
        // Our price-book price wins; the document's price only fills a gap.
        rate: item.rate_cents !== null ? centsToPlain(item.rate_cents) : docPrice,
        note: item.rate_cents === null && docPrice ? `${note} No price-book price, so the document's price is used.` : note,
      });
    } else {
      next.lines.push({
        priceBookItemId: null,
        description: l.description,
        detail: l.detail ?? "",
        qty: qtyMilli === null ? "" : plainQty(qtyMilli),
        unit: l.unit ?? "",
        rate: docPrice,
        note: `${note} Not in the price book.`,
      } satisfies EstimateLineInput);
    }
    added++;
  }

  if (!next.scope.trim() && sug.scope.length) next.scope = sug.scope.join("\n");
  const needPrice = next.lines.filter((x) => x.description.trim() && !x.rate.trim()).length;
  return { form: next, filled, added, alreadyOn, needPrice };
}
