import { NextResponse, type NextRequest } from "next/server";
import { loadEstimate, renderAndStoreEstimateDocx } from "@/lib/estimates.server";
import { signedDownloadUrl } from "@/lib/supabaseAdmin";
import { isUuid, jsonError, serverError } from "@/lib/http";

// Short-lived (2 minute) signed URL for the estimate's .docx. Builds it
// first if it isn't stored yet (e.g. the build failed when saving).
export async function GET(_req: NextRequest, ctx: RouteContext<"/api/estimates/[id]/download">) {
  const { id } = await ctx.params;
  if (!isUuid(id)) return jsonError("Not found", 404);
  try {
    const est = await loadEstimate(id);
    if (!est) return jsonError("Not found", 404);
    const path = est.generated_file_path ?? (await renderAndStoreEstimateDocx(est));
    const url = await signedDownloadUrl(path, `${est.estimate_number}.docx`);
    return NextResponse.json({ url, expiresInSeconds: 120 });
  } catch (e) {
    return serverError(e, "estimate download");
  }
}
