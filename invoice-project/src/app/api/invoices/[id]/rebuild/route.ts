import { NextResponse, type NextRequest } from "next/server";
import { loadInvoice, renderAndStoreDocx } from "@/lib/invoices.server";
import { isUuid, jsonError, serverError } from "@/lib/http";

// Rebuild the .docx for a generated invoice (e.g. after a storage hiccup).
export async function POST(_req: NextRequest, ctx: RouteContext<"/api/invoices/[id]/rebuild">) {
  const { id } = await ctx.params;
  if (!isUuid(id)) return jsonError("Not found", 404);
  try {
    const found = await loadInvoice(id);
    if (!found) return jsonError("Not found", 404);
    if (found.invoice.source !== "generated") return jsonError("Only generated invoices have a .docx to rebuild.");
    const path = await renderAndStoreDocx(found.invoice, found.items);
    return NextResponse.json({ ok: true, path });
  } catch (e) {
    return serverError(e, "rebuild docx");
  }
}
