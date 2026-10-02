import { NextResponse, type NextRequest } from "next/server";
import { validateInvoiceInput } from "@/lib/invoice";
import { loadInvoice, updateInvoice } from "@/lib/invoices.server";
import { isUuid, jsonError, readJson, serverError } from "@/lib/http";

export async function GET(_req: NextRequest, ctx: RouteContext<"/api/invoices/[id]">) {
  const { id } = await ctx.params;
  if (!isUuid(id)) return jsonError("Not found", 404);
  try {
    const found = await loadInvoice(id);
    if (!found) return jsonError("Not found", 404);
    return NextResponse.json(found);
  } catch (e) {
    return serverError(e, "load invoice");
  }
}

export async function PATCH(req: NextRequest, ctx: RouteContext<"/api/invoices/[id]">) {
  const { id } = await ctx.params;
  if (!isUuid(id)) return jsonError("Not found", 404);
  try {
    const found = await loadInvoice(id);
    if (!found) return jsonError("Not found", 404);
    if (found.invoice.status === "void") return jsonError("This invoice is void. Restore it before editing.", 409);
    const parsed = validateInvoiceInput(await readJson(req), found.invoice.source);
    if (!parsed.ok) return jsonError(parsed.errors.join(" "), 400, { errors: parsed.errors });
    const result = await updateInvoice(id, parsed.value);
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    return serverError(e, "update invoice");
  }
}
