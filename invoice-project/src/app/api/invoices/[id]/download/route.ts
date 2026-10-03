import { NextResponse, type NextRequest } from "next/server";
import { loadInvoice } from "@/lib/invoices.server";
import { signedDownloadUrl } from "@/lib/supabaseAdmin";
import { isUuid, jsonError, serverError } from "@/lib/http";

// Returns a short-lived (2 minute) signed URL for the stored file: the
// generated .docx, or the uploaded original. ?inline=1 opens instead of
// downloading (for previews).
export async function GET(req: NextRequest, ctx: RouteContext<"/api/invoices/[id]/download">) {
  const { id } = await ctx.params;
  if (!isUuid(id)) return jsonError("Not found", 404);
  try {
    const found = await loadInvoice(id);
    if (!found) return jsonError("Not found", 404);
    const inv = found.invoice;
    const path = inv.source === "generated" ? inv.generated_file_path : inv.original_file_path;
    if (!path) return jsonError("No file is stored for this invoice yet.", 404);
    const ext = path.split(".").pop();
    const inline = req.nextUrl.searchParams.get("inline") === "1";
    const url = await signedDownloadUrl(path, inline ? undefined : `${inv.invoice_number}.${ext}`);
    return NextResponse.json({ url, expiresInSeconds: 120 });
  } catch (e) {
    return serverError(e, "download");
  }
}
