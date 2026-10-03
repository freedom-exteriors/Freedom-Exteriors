import { NextResponse, type NextRequest } from "next/server";
import { validateEstimateInput } from "@/lib/estimate";
import { EstimateLockedError, loadEstimate, updateEstimate } from "@/lib/estimates.server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { isUuid, jsonError, readJson, serverError } from "@/lib/http";

export async function GET(_req: NextRequest, ctx: RouteContext<"/api/estimates/[id]">) {
  const { id } = await ctx.params;
  if (!isUuid(id)) return jsonError("Not found", 404);
  try {
    const estimate = await loadEstimate(id);
    if (!estimate) return jsonError("Not found", 404);
    let invoiceNumber: string | null = null;
    if (estimate.invoice_id) {
      const { data } = await supabaseAdmin().from("invoices").select("invoice_number").eq("id", estimate.invoice_id).maybeSingle();
      invoiceNumber = data?.invoice_number ?? null;
    }
    return NextResponse.json({ estimate, invoiceNumber });
  } catch (e) {
    return serverError(e, "load estimate");
  }
}

export async function PATCH(req: NextRequest, ctx: RouteContext<"/api/estimates/[id]">) {
  const { id } = await ctx.params;
  if (!isUuid(id)) return jsonError("Not found", 404);
  const parsed = validateEstimateInput(await readJson(req));
  if (!parsed.ok) return jsonError(parsed.errors.join(" "), 400, { errors: parsed.errors });
  try {
    return NextResponse.json(await updateEstimate(id, parsed.value));
  } catch (e) {
    if (e instanceof EstimateLockedError) return jsonError(e.message, 409);
    return serverError(e, "update estimate");
  }
}
