import { NextResponse, type NextRequest } from "next/server";
import { updatePriceBookItem, validatePriceBookInput } from "@/lib/estimates.server";
import { isUuid, jsonError, readJson, serverError } from "@/lib/http";

// Items are never deleted (old estimates may point at them); retire them
// with { active: false } instead.
export async function PATCH(req: NextRequest, ctx: RouteContext<"/api/price-book/[id]">) {
  const { id } = await ctx.params;
  if (!isUuid(id)) return jsonError("Not found", 404);
  const parsed = validatePriceBookInput(await readJson(req), true);
  if (!parsed.ok) return jsonError(parsed.error);
  try {
    const item = await updatePriceBookItem(id, parsed.value);
    if (!item) return jsonError("Not found", 404);
    return NextResponse.json({ item });
  } catch (e) {
    return serverError(e, "update price book item");
  }
}
