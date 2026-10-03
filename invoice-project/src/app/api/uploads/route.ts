import { NextResponse, type NextRequest } from "next/server";
import { randomUUID } from "node:crypto";
import { BUCKET, supabaseAdmin } from "@/lib/supabaseAdmin";
import { isUploadExt, MAX_UPLOAD_BYTES, uploadPaths } from "@/lib/uploads.server";
import { jsonError, readJson, serverError } from "@/lib/http";

// Step 1 of an upload: hand the browser a one-time signed URL so the file
// goes straight to the private bucket (Vercel caps request bodies at 4.5 MB).
// Body: { ext: "pdf" | "png" | "jpg", size: number, fileName: string }
export async function POST(req: NextRequest) {
  const body = (await readJson(req)) as { ext?: unknown; size?: unknown } | null;
  if (!isUploadExt(body?.ext)) return jsonError("Only PDF, Word (.docx), PNG and JPG files are accepted.");
  const size = Number(body?.size);
  if (!Number.isFinite(size) || size <= 0) return jsonError("The file is empty.");
  if (size > MAX_UPLOAD_BYTES) return jsonError("The file is larger than 20 MB.");
  try {
    const uploadId = randomUUID();
    const { original } = uploadPaths(uploadId, body.ext);
    const { data, error } = await supabaseAdmin().storage.from(BUCKET).createSignedUploadUrl(original);
    if (error || !data) throw new Error(error?.message ?? "Could not create upload link");
    return NextResponse.json({ uploadId, signedUrl: data.signedUrl });
  } catch (e) {
    return serverError(e, "sign upload");
  }
}
