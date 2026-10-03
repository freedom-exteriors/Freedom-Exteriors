import { NextResponse, type NextRequest } from "next/server";
import { signedDownloadUrl } from "@/lib/supabaseAdmin";
import { isUploadExt, uploadPaths } from "@/lib/uploads.server";
import { isUuid, jsonError, serverError } from "@/lib/http";

// Short-lived link to show the original next to the review form.
export async function GET(req: NextRequest, ctx: RouteContext<"/api/uploads/[uploadId]/view">) {
  const { uploadId } = await ctx.params;
  const ext = req.nextUrl.searchParams.get("ext");
  if (!isUuid(uploadId) || !isUploadExt(ext)) return jsonError("Not found", 404);
  try {
    const url = await signedDownloadUrl(uploadPaths(uploadId, ext).original, undefined, 600);
    return NextResponse.json({ url });
  } catch (e) {
    return serverError(e, "view upload");
  }
}
