import { NextResponse, type NextRequest } from "next/server";
import { CrmError, InvoiceLockedError, sendInvoiceToQuickBooks } from "@/lib/invoices.server";
import { isUuid, jsonError, serverError } from "@/lib/http";

// "Send to QuickBooks": the CRM creates the invoice (same number, same lines)
// and records the deposits as payments. Safe to repeat: the CRM reuses an
// invoice with this number instead of making a second one.
export async function POST(_req: NextRequest, ctx: RouteContext<"/api/invoices/[id]/quickbooks">) {
  const { id } = await ctx.params;
  if (!isUuid(id)) return jsonError("Not found", 404);
  try {
    return NextResponse.json(await sendInvoiceToQuickBooks(id));
  } catch (e) {
    if (e instanceof InvoiceLockedError) return jsonError(e.message, 409);
    if (e instanceof CrmError) return jsonError(e.message, e.status >= 500 ? 502 : e.status === 401 ? 502 : e.status);
    return serverError(e, "send to QuickBooks");
  }
}
