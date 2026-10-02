import "server-only";
import { BUCKET, nextInvoiceNumber, supabaseAdmin } from "./supabaseAdmin";
import { buildInvoiceDocx } from "./docx/buildInvoiceDocx";
import { docxFromInvoice } from "./docx/fromInvoice";
import {
  invoiceColumns,
  parseOurNumber,
  yearOf,
  type CleanInvoice,
  type InvoiceRow,
  type InvoiceStatus,
  type LineItemRow,
} from "./invoice";

const UNIQUE_VIOLATION = "23505";
const LINE_ITEM_COLUMNS = "kind, description, detail, quantity, rate_cents, amount_cents, line_date, sort_order";
const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

function isDuplicateNumber(err: { code?: string; message?: string } | null): boolean {
  return !!err && err.code === UNIQUE_VIOLATION && /invoice_number/.test(err.message ?? "");
}

async function saveInvoiceRpc(id: string | null, invoice: Record<string, unknown>, items: LineItemRow[]) {
  return supabaseAdmin().rpc("save_invoice", { p_id: id, p_invoice: invoice, p_items: items });
}

export async function loadInvoice(id: string): Promise<{ invoice: InvoiceRow; items: LineItemRow[] } | null> {
  const db = supabaseAdmin();
  const { data: invoice, error } = await db.from("invoices").select("*").eq("id", id).maybeSingle();
  if (error) throw new Error(error.message);
  if (!invoice) return null;
  const { data: items, error: e2 } = await db
    .from("invoice_line_items")
    .select(LINE_ITEM_COLUMNS)
    .eq("invoice_id", id)
    .order("kind")
    .order("sort_order");
  if (e2) throw new Error(e2.message);
  return { invoice: invoice as InvoiceRow, items: (items ?? []) as LineItemRow[] };
}

// ------------------------------------------------------------ generated

export async function renderAndStoreDocx(invoice: InvoiceRow, items: LineItemRow[]): Promise<string> {
  const buf = await buildInvoiceDocx(docxFromInvoice(invoice, items));
  const path = `generated/${invoice.invoice_number}.docx`;
  const db = supabaseAdmin();
  const up = await db.storage.from(BUCKET).upload(path, buf, { contentType: DOCX_MIME, upsert: true });
  if (up.error) throw new Error(`Saving the .docx failed: ${up.error.message}`);
  const { error } = await db.from("invoices").update({ generated_file_path: path }).eq("id", invoice.id);
  if (error) throw new Error(error.message);
  return path;
}

/** Assigns the number, saves, builds the .docx and stores it. */
export async function createGeneratedInvoice(clean: CleanInvoice): Promise<{ id: string; invoiceNumber: string; docxError: string | null }> {
  const year = yearOf(clean.invoice_date);
  // A collision is only possible if an uploaded document already used one of
  // our numbers; the counter was bumped past it, so one retry is enough.
  for (let attempt = 0; attempt < 3; attempt++) {
    const invoiceNumber = await nextInvoiceNumber(year);
    const { data: id, error } = await saveInvoiceRpc(
      null,
      { ...invoiceColumns(clean), invoice_number: invoiceNumber, invoice_number_source: "assigned", source: "generated", status: "outstanding" },
      clean.items,
    );
    if (isDuplicateNumber(error)) continue;
    if (error || typeof id !== "string") throw new Error(error?.message ?? "Save failed");

    let docxError: string | null = null;
    try {
      const loaded = await loadInvoice(id);
      if (loaded) await renderAndStoreDocx(loaded.invoice, loaded.items);
    } catch (e) {
      // The invoice and its number are saved; the detail page offers
      // "Rebuild .docx" if this step failed.
      docxError = e instanceof Error ? e.message : String(e);
    }
    return { id, invoiceNumber, docxError };
  }
  throw new Error("Could not assign a unique invoice number. Try again.");
}

// ------------------------------------------------------------- uploaded

export interface UploadedSave {
  clean: CleanInvoice;
  documentInvoiceNumber: string; // as printed, "" when none
  originalFilePath: string;
  extractionJson: unknown;
  rawResponse: unknown;
  warnings: string[];
}

export async function createUploadedInvoice(u: UploadedSave): Promise<{ id: string; invoiceNumber: string; duplicate: boolean }> {
  const db = supabaseAdmin();
  const printed = u.documentInvoiceNumber.trim();

  const { data: already } = await db.from("invoices").select("id, invoice_number").eq("original_file_path", u.originalFilePath).maybeSingle();
  if (already) throw new Error(`This upload was already saved as ${already.invoice_number}.`);

  if (printed) {
    // If the document carries one of OUR numbers, move the counter past it.
    const ours = parseOurNumber(printed);
    if (ours) await db.rpc("bump_invoice_counter", { p_year: ours.year, p_number: ours.number });
  }

  for (let attempt = 0; attempt < 20; attempt++) {
    let invoiceNumber: string;
    let duplicate = false;
    if (printed) {
      duplicate = attempt > 0;
      invoiceNumber = attempt === 0 ? printed : `${printed}-DUP${attempt === 1 ? "" : attempt}`;
    } else {
      invoiceNumber = await nextInvoiceNumber(yearOf(u.clean.invoice_date));
    }
    const warnings = [...u.warnings];
    if (u.clean.reconcileWarning) warnings.push(u.clean.reconcileWarning);
    if (duplicate) warnings.push(`Invoice number "${printed}" was already in the catalog, so this one was saved as "${invoiceNumber}".`);

    const { data: id, error } = await saveInvoiceRpc(
      null,
      {
        ...invoiceColumns(u.clean),
        invoice_number: invoiceNumber,
        invoice_number_source: printed ? "from_document" : "assigned",
        document_invoice_number: printed || null,
        duplicate_number_flag: duplicate,
        source: "uploaded",
        status: "outstanding",
        original_file_path: u.originalFilePath,
        extraction_json: u.extractionJson,
        extraction_raw_response: u.rawResponse,
        extraction_warnings: warnings,
      },
      u.clean.items,
    );
    if (isDuplicateNumber(error)) continue;
    if (error || typeof id !== "string") throw new Error(error?.message ?? "Save failed");
    return { id, invoiceNumber, duplicate };
  }
  throw new Error("Could not find a free invoice number for this document.");
}

// ------------------------------------------------------------ edits

export async function updateInvoice(id: string, clean: CleanInvoice): Promise<{ docxError: string | null }> {
  const loaded = await loadInvoice(id);
  if (!loaded) throw new Error("Invoice not found");
  const { error } = await saveInvoiceRpc(id, invoiceColumns(clean), clean.items);
  if (error) throw new Error(error.message);
  if (loaded.invoice.source === "uploaded") {
    const prior = Array.isArray(loaded.invoice.extraction_warnings) ? (loaded.invoice.extraction_warnings as string[]) : [];
    const kept = prior.filter((w) => !w.startsWith("Totals don't reconcile"));
    if (clean.reconcileWarning) kept.push(clean.reconcileWarning);
    await supabaseAdmin().from("invoices").update({ extraction_warnings: kept }).eq("id", id);
    return { docxError: null };
  }
  try {
    const fresh = await loadInvoice(id);
    if (fresh) await renderAndStoreDocx(fresh.invoice, fresh.items);
    return { docxError: null };
  } catch (e) {
    return { docxError: e instanceof Error ? e.message : String(e) };
  }
}

export async function setStatus(id: string, status: InvoiceStatus, paidDate: string | null) {
  const { data, error } = await supabaseAdmin()
    .from("invoices")
    .update({ status, paid_date: status === "paid" ? paidDate : null })
    .eq("id", id)
    .select("id, status, paid_date")
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

// ----------------------------------------------------------- catalog

export interface CatalogFilters {
  q?: string;
  customer?: string;
  from?: string;
  to?: string;
  status?: string;
  sort?: string;
  dir?: string;
}

const SORTABLE = new Set([
  "invoice_number",
  "customer_name",
  "job_address",
  "invoice_date",
  "contract_total_cents",
  "balance_due_cents",
  "status",
  "source",
]);

/** Strip characters that have meaning in PostgREST filter syntax. */
export function cleanSearch(q: string): string {
  return q.replace(/[,()*%\\:"']/g, " ").replace(/\s+/g, " ").trim().slice(0, 100);
}

export function parseFilters(sp: URLSearchParams): CatalogFilters {
  return {
    q: sp.get("q") ?? undefined,
    customer: sp.get("customer") ?? undefined,
    from: sp.get("from") ?? undefined,
    to: sp.get("to") ?? undefined,
    status: sp.get("status") ?? undefined,
    sort: sp.get("sort") ?? undefined,
    dir: sp.get("dir") ?? undefined,
  };
}

export async function listInvoices(f: CatalogFilters, limit = 2000): Promise<InvoiceRow[]> {
  let query = supabaseAdmin()
    .from("invoices")
    .select(
      "id, invoice_number, invoice_number_source, duplicate_number_flag, customer_name, customer_phone, customer_address, job_address, subtitle, tag, payment_terms, contract_date, invoice_date, due_date, terms, subtotal_cents, overhead_percent, overhead_cents, profit_percent, profit_cents, contract_total_cents, deposits_total_cents, change_orders_total_cents, balance_due_cents, status, paid_date, source, original_file_path, generated_file_path, extraction_warnings, created_at, updated_at",
    );

  const q = cleanSearch(f.q ?? "");
  if (q) query = query.or(`customer_name.ilike.*${q}*,job_address.ilike.*${q}*,invoice_number.ilike.*${q}*`);
  const customer = cleanSearch(f.customer ?? "");
  if (customer) query = query.ilike("customer_name", `%${customer}%`);
  if (f.from && /^\d{4}-\d{2}-\d{2}$/.test(f.from)) query = query.gte("invoice_date", f.from);
  if (f.to && /^\d{4}-\d{2}-\d{2}$/.test(f.to)) query = query.lte("invoice_date", f.to);
  if (f.status && ["outstanding", "paid", "void"].includes(f.status)) query = query.eq("status", f.status);
  else if (f.status !== "all") query = query.neq("status", "void"); // void hidden unless asked for

  const sort = f.sort && SORTABLE.has(f.sort) ? f.sort : "invoice_date";
  query = query.order(sort, { ascending: f.dir === "asc" }).order("invoice_number", { ascending: false }).limit(limit);

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data ?? []) as InvoiceRow[];
}

export async function lineItemsFor(ids: string[]): Promise<Map<string, LineItemRow[]>> {
  const map = new Map<string, LineItemRow[]>();
  for (let i = 0; i < ids.length; i += 200) {
    const chunk = ids.slice(i, i + 200);
    const { data, error } = await supabaseAdmin()
      .from("invoice_line_items")
      .select(`invoice_id, ${LINE_ITEM_COLUMNS}`)
      .in("invoice_id", chunk);
    if (error) throw new Error(error.message);
    for (const row of data ?? []) {
      const list = map.get(row.invoice_id) ?? [];
      list.push(row as LineItemRow);
      map.set(row.invoice_id, list);
    }
  }
  return map;
}
