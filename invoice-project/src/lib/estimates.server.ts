import "server-only";
import { BUCKET, nextEstimateNumber, supabaseAdmin } from "./supabaseAdmin";
import { buildEstimateDocx } from "./docx/buildInvoiceDocx";
import { docxFromEstimate } from "./docx/fromEstimate";
import { parseDollarsToCents, parseQuantityMilli } from "./money";
import { cleanSearch } from "./invoices.server";
import { parseOurEstimateNumber } from "./estimateImport";
import { yearOf } from "./invoice";
import type { CleanEstimate, EstimateRow, EstimateStatus, PriceBookItem } from "./estimate";

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

export async function loadEstimate(id: string): Promise<EstimateRow | null> {
  const { data, error } = await supabaseAdmin().from("estimates").select("*").eq("id", id).maybeSingle();
  if (error) throw new Error(error.message);
  return (data as EstimateRow) ?? null;
}

export async function renderAndStoreEstimateDocx(e: EstimateRow): Promise<string> {
  const buf = await buildEstimateDocx(docxFromEstimate(e));
  const path = `estimates/${e.estimate_number}.docx`;
  const db = supabaseAdmin();
  const up = await db.storage.from(BUCKET).upload(path, buf, { contentType: DOCX_MIME, upsert: true });
  if (up.error) throw new Error(`Saving the .docx failed: ${up.error.message}`);
  const { error } = await db.from("estimates").update({ generated_file_path: path }).eq("id", e.id);
  if (error) throw new Error(error.message);
  return path;
}

async function tryRender(id: string): Promise<string | null> {
  try {
    const fresh = await loadEstimate(id);
    if (fresh) await renderAndStoreEstimateDocx(fresh);
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

export async function createEstimate(clean: CleanEstimate): Promise<{ id: string; estimateNumber: string; docxError: string | null }> {
  const estimateNumber = await nextEstimateNumber(yearOf(clean.estimate_date));
  const { data, error } = await supabaseAdmin()
    .from("estimates")
    .insert({ ...clean, estimate_number: estimateNumber, status: "draft" })
    .select("id")
    .single();
  if (error || !data) throw new Error(error?.message ?? "Save failed");
  return { id: data.id, estimateNumber, docxError: await tryRender(data.id) };
}

export class EstimateLockedError extends Error {}

/**
 * Saves an OLD estimate after Nick reviewed it. Keeps the number printed on
 * the document when there is one (adding -DUP if it's already taken),
 * otherwise assigns the next FE-EST number.
 */
export async function createUploadedEstimate(u: {
  clean: CleanEstimate;
  documentEstimateNumber: string;
  status: Exclude<EstimateStatus, "void">;
  originalFilePath: string;
  extractionJson: unknown;
}): Promise<{ id: string; estimateNumber: string; duplicate: boolean; docxError: string | null }> {
  const db = supabaseAdmin();
  const printed = u.documentEstimateNumber.trim();

  const { data: already } = await db.from("estimates").select("estimate_number").eq("original_file_path", u.originalFilePath).maybeSingle();
  if (already) throw new EstimateLockedError(`This upload was already saved as ${already.estimate_number}.`);

  const ours = printed ? parseOurEstimateNumber(printed) : null;
  if (ours) {
    const { error } = await db.rpc("bump_estimate_counter", { p_year: ours.year, p_number: ours.number });
    if (error) throw new Error(error.message);
  }

  for (let attempt = 0; attempt < 20; attempt++) {
    const estimateNumber = printed
      ? attempt === 0 ? printed : `${printed}-DUP${attempt === 1 ? "" : attempt}`
      : await nextEstimateNumber(yearOf(u.clean.estimate_date));
    const { data, error } = await db
      .from("estimates")
      .insert({
        ...u.clean,
        estimate_number: estimateNumber,
        status: u.status,
        accepted_date: u.status === "accepted" ? u.clean.estimate_date : null,
        source: "uploaded",
        document_estimate_number: printed || null,
        original_file_path: u.originalFilePath,
        extraction_json: u.extractionJson,
      })
      .select("id")
      .single();
    if (error?.code === "23505" && /estimate_number/.test(error.message)) continue;
    if (error?.code === "23505") throw new EstimateLockedError("This upload was already saved.");
    if (error || !data) throw new Error(error?.message ?? "Save failed");
    return { id: data.id, estimateNumber, duplicate: printed !== "" && attempt > 0, docxError: await tryRender(data.id) };
  }
  throw new Error("Could not find a free estimate number for this document.");
}

export async function updateEstimate(id: string, clean: CleanEstimate): Promise<{ docxError: string | null }> {
  const existing = await loadEstimate(id);
  if (!existing) throw new EstimateLockedError("Estimate not found");
  if (existing.status === "void") throw new EstimateLockedError("This estimate is void. Set it back to Draft to edit it.");
  if (existing.invoice_id) throw new EstimateLockedError("An invoice was already made from this estimate, so it can't be changed. Edit the invoice instead.");
  const { error } = await supabaseAdmin().from("estimates").update(clean).eq("id", id);
  if (error) throw new Error(error.message);
  return { docxError: await tryRender(id) };
}

export async function setEstimateStatus(id: string, status: EstimateStatus, acceptedDate: string | null) {
  const existing = await loadEstimate(id);
  if (!existing) return null;
  if (existing.invoice_id && status !== "accepted") {
    throw new EstimateLockedError("An invoice was already made from this estimate, so it stays Accepted. Void the invoice instead if the job is off.");
  }
  const { data, error } = await supabaseAdmin()
    .from("estimates")
    .update({ status, accepted_date: status === "accepted" ? (existing.accepted_date ?? acceptedDate) : null })
    .eq("id", id)
    .select("id, status, accepted_date")
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

/**
 * Called after an invoice is created from an estimate: marks the estimate
 * Accepted and links the invoice. Only links an estimate that has no
 * invoice yet, so a double click can't re-link it.
 */
export async function linkInvoiceToEstimate(estimateId: string, invoiceId: string, today: string) {
  const existing = await loadEstimate(estimateId);
  if (!existing || existing.invoice_id) return;
  const { error } = await supabaseAdmin()
    .from("estimates")
    .update({ status: "accepted", invoice_id: invoiceId, accepted_date: existing.accepted_date ?? today })
    .eq("id", estimateId)
    .is("invoice_id", null);
  if (error) throw new Error(error.message);
}

export async function listEstimates(f: { q?: string; status?: string }): Promise<EstimateRow[]> {
  let query = supabaseAdmin()
    .from("estimates")
    .select("id, estimate_number, status, customer_name, job_address, subtitle, estimate_date, valid_days, total_cents, invoice_id, accepted_date, created_at, updated_at");
  const q = cleanSearch(f.q ?? "");
  if (q) query = query.or(`customer_name.ilike.*${q}*,job_address.ilike.*${q}*,estimate_number.ilike.*${q}*`);
  if (f.status && ["draft", "sent", "accepted", "declined", "void"].includes(f.status)) query = query.eq("status", f.status);
  else if (f.status !== "all") query = query.neq("status", "void");
  const { data, error } = await query.order("estimate_date", { ascending: false }).order("estimate_number", { ascending: false }).limit(1000);
  if (error) throw new Error(error.message);
  return (data ?? []) as EstimateRow[];
}

// ----------------------------------------------------------- price book

export async function listPriceBook(includeRetired: boolean): Promise<PriceBookItem[]> {
  let query = supabaseAdmin().from("price_book_items").select("id, trade, label, description, detail, unit, default_quantity, rate_cents, sort_order, active, source_note");
  if (!includeRetired) query = query.eq("active", true);
  const { data, error } = await query.order("trade").order("sort_order").order("label");
  if (error) throw new Error(error.message);
  return (data ?? []) as PriceBookItem[];
}

type PriceBookPatch = Partial<Omit<PriceBookItem, "id" | "source_note">>;

/** Validates price-book fields from the browser. `partial` = PATCH. */
export function validatePriceBookInput(body: unknown, partial: boolean): { ok: true; value: PriceBookPatch } | { ok: false; error: string } {
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const out: PriceBookPatch = {};
  const text = (k: string, max: number, required: boolean): string | null | undefined => {
    if (!(k in b)) {
      if (!partial && required) throw new Error(`${k} is required.`);
      return undefined;
    }
    const v = typeof b[k] === "string" ? (b[k] as string).trim().slice(0, max) : "";
    if (!v && required) throw new Error(`${k === "label" ? "Check-box label" : k === "description" ? "Description" : "Trade"} is required.`);
    return v || null;
  };
  try {
    const trade = text("trade", 80, true);
    if (trade !== undefined) out.trade = trade!;
    const label = text("label", 120, true);
    if (label !== undefined) out.label = label!;
    const description = text("description", 300, true);
    if (description !== undefined) out.description = description!;
    const detail = text("detail", 2000, false);
    if (detail !== undefined) out.detail = detail;
    const unit = text("unit", 20, false);
    if (unit !== undefined) out.unit = unit ?? "ea";
    if ("rate" in b) {
      const r = typeof b.rate === "string" ? b.rate.trim() : "";
      if (!r) out.rate_cents = null;
      else {
        const c = parseDollarsToCents(r);
        if (c === null || c < 0) throw new Error(`Price "${r}" is not a valid amount.`);
        out.rate_cents = c;
      }
    }
    if ("defaultQuantity" in b) {
      const q = typeof b.defaultQuantity === "string" ? b.defaultQuantity.trim() : "";
      const milli = q ? parseQuantityMilli(q) : 1000;
      if (milli === null || milli === 0) throw new Error(`Default quantity "${q}" is not a valid number.`);
      out.default_quantity = (milli / 1000).toFixed(3);
    }
    if ("sortOrder" in b) {
      const n = Number(b.sortOrder);
      if (!Number.isInteger(n) || Math.abs(n) > 100000) throw new Error("Sort order must be a whole number.");
      out.sort_order = n;
    }
    if ("active" in b) out.active = b.active === true;
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
  return { ok: true, value: out };
}

export async function createPriceBookItem(v: PriceBookPatch): Promise<PriceBookItem> {
  const { data, error } = await supabaseAdmin().from("price_book_items").insert(v).select("*").single();
  if (error) throw new Error(error.message);
  return data as PriceBookItem;
}

export async function updatePriceBookItem(id: string, v: PriceBookPatch): Promise<PriceBookItem | null> {
  const { data, error } = await supabaseAdmin().from("price_book_items").update(v).eq("id", id).select("*").maybeSingle();
  if (error) throw new Error(error.message);
  return (data as PriceBookItem) ?? null;
}
