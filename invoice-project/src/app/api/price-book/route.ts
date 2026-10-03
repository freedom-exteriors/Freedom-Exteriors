import { NextResponse, type NextRequest } from "next/server";
import { createPriceBookItem, listPriceBook, validatePriceBookInput } from "@/lib/estimates.server";
import { jsonError, readJson, serverError } from "@/lib/http";

// ?all=1 includes retired items (for the Price book page).
export async function GET(req: NextRequest) {
  try {
    return NextResponse.json({ items: await listPriceBook(req.nextUrl.searchParams.get("all") === "1") });
  } catch (e) {
    return serverError(e, "list price book");
  }
}

export async function POST(req: NextRequest) {
  const parsed = validatePriceBookInput(await readJson(req), false);
  if (!parsed.ok) return jsonError(parsed.error);
  try {
    return NextResponse.json({ item: await createPriceBookItem(parsed.value) }, { status: 201 });
  } catch (e) {
    return serverError(e, "create price book item");
  }
}
