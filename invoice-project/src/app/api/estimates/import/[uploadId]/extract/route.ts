import { NextResponse, type NextRequest } from "next/server";
import { BUCKET, supabaseAdmin } from "@/lib/supabaseAdmin";
import { EXTRACTION_MODEL, ExtractionError } from "@/lib/extract";
import { extractEstimate } from "@/lib/extractEstimate.server";
import { draftFromEstimateExtraction } from "@/lib/estimateImport";
import { isUploadExt, MAX_UPLOAD_BYTES, sniffType, UPLOAD_TYPES, uploadPaths } from "@/lib/uploads.server";
import { isUuid, jsonError, readJson, serverError } from "@/lib/http";

export const maxDuration = 300;

// Old estimate, step 2 (after the file is uploaded): read it with Claude.
// Saves the raw response for auditing and returns a DRAFT for the review
// screen. Nothing is written to the estimates table here.
export async function POST(req: NextRequest, ctx: RouteContext<"/api/estimates/import/[uploadId]/extract">) {
  const { uploadId } = await ctx.params;
  const body = (await readJson(req)) as { ext?: unknown; fileName?: unknown } | null;
  if (!isUuid(uploadId) || !isUploadExt(body?.ext)) return jsonError("Not found", 404);
  const ext = body.ext;
  const paths = uploadPaths(uploadId, ext);
  const db = supabaseAdmin();

  try {
    const dl = await db.storage.from(BUCKET).download(paths.original);
    if (dl.error || !dl.data) return jsonError("The uploaded file wasn't found. Try uploading it again.", 404);
    const buf = Buffer.from(await dl.data.arrayBuffer());
    if (buf.length > MAX_UPLOAD_BYTES) return jsonError("The file is larger than 20 MB.");
    if (sniffType(buf) !== ext) return jsonError("This file isn't a real PDF, PNG, JPG or Word .docx file (its contents don't match its type).");

    const { fields, raw, text } = await extractEstimate(buf, UPLOAD_TYPES[ext]);
    const audit = {
      uploadId,
      fileName: typeof body.fileName === "string" ? body.fileName.slice(0, 200) : null,
      model: EXTRACTION_MODEL,
      extractedAt: new Date().toISOString(),
      fields,
      raw,
      documentText: text,
    };
    const up = await db.storage
      .from(BUCKET)
      .upload(paths.estimateExtraction, Buffer.from(JSON.stringify(audit)), { contentType: "application/json", upsert: true });
    if (up.error) throw new Error(`Saving the extraction record failed: ${up.error.message}`);

    return NextResponse.json({ draft: draftFromEstimateExtraction(fields), previewText: text });
  } catch (e) {
    if (e instanceof ExtractionError) return jsonError(e.message, 422);
    return serverError(e, "extract estimate");
  }
}
