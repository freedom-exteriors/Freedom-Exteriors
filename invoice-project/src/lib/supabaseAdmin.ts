import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Service-role client. SERVER ONLY: the "server-only" import above makes the
// build fail if any browser code imports this file.

export const BUCKET = "invoice-files";

let client: SupabaseClient | null = null;

export function supabaseAdmin(): SupabaseClient {
  if (client) return client;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is not configured");
  client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return client;
}

/** Take the next FE-INV-YYYY-### number from the atomic counter. */
export async function nextInvoiceNumber(year: number): Promise<string> {
  const { data, error } = await supabaseAdmin().rpc("next_invoice_number", { p_year: year });
  if (error || typeof data !== "string") throw new Error(`Could not assign an invoice number: ${error?.message ?? "no data"}`);
  return data;
}

/** Signed download URL that expires after `seconds`. */
export async function signedDownloadUrl(path: string, downloadName?: string, seconds = 120): Promise<string> {
  const { data, error } = await supabaseAdmin()
    .storage.from(BUCKET)
    .createSignedUrl(path, seconds, downloadName ? { download: downloadName } : undefined);
  if (error || !data) throw new Error(`Could not create download link: ${error?.message}`);
  return data.signedUrl;
}
