import type { NextRequest } from "next/server";
import { loadInvoice } from "@/lib/invoices.server";
import { docxFromInvoice } from "@/lib/docx/fromInvoice";
import { buildInvoicePdf } from "@/lib/pdf/buildPdf";
import { pdfResponse } from "@/lib/pdf/response";
import { isUuid, jsonError, serverError } from "@/lib/http";

// The invoice as a PDF, built fresh from the saved data (same letterhead as
// the .docx). Uploaded invoices print their reviewed details the same way.
export async function GET(req: NextRequest, ctx: RouteContext<"/api/invoices/[id]/pdf">) {
  const { id } = await ctx.params;
  if (!isUuid(id)) return jsonError("Not found", 404);
  try {
    const found = await loadInvoice(id);
    if (!found) return jsonError("Not found", 404);
    const buf = await buildInvoicePdf(docxFromInvoice(found.invoice, found.items));
    return pdfResponse(buf, `${found.invoice.invoice_number}.pdf`, req.nextUrl.searchParams.get("download") === "1");
  } catch (e) {
    return serverError(e, "invoice pdf");
  }
}
