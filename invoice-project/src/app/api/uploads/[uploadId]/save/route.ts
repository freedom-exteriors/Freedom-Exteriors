import { NextResponse, type NextRequest } from "next/server";
import { BUCKET, supabaseAdmin } from "@/lib/supabaseAdmin";
import { validateInvoiceInput } from "@/lib/invoice";
import { createUploadedInvoice } from "@/lib/invoices.server";
import { isUploadExt, uploadPaths } from "@/lib/uploads.server";
import { isUuid, jsonError, readJson, serverError } from "@/lib/http";

// Step 3: save AFTER Nick has reviewed and corrected the draft.
// Body: { ext, form: InvoiceFormInput, documentInvoiceNumber: string, warnings: string[] }
export async function POST(req: NextRequest, ctx: RouteContext<"/api/uploads/[uploadId]/save">) {
  const { uploadId } = await ctx.params;
  const body = (await readJson(req)) as { ext?: unknown; form?: unknown; documentInvoiceNumber?: unknown; warnings?: unknown } | null;
  if (!isUuid(uploadId) || !isUploadExt(body?.ext)) return jsonError("Not found", 404);
  const parsed = validateInvoiceInput(body.form, "uploaded");
  if (!parsed.ok) return jsonError(parsed.errors.join(" "), 400, { errors: parsed.errors });

  const paths = uploadPaths(uploadId, body.ext);
  try {
    // The audit record was written by the server during extraction; read it
    // back from storage rather than trusting anything the browser sends.
    const dl = await supabaseAdmin().storage.from(BUCKET).download(paths.extraction);
    if (dl.error || !dl.data) return jsonError("Read this file with Claude before saving it.", 409);
    const audit = JSON.parse(await dl.data.text()) as { fields: unknown; raw: unknown };

    const warnings = Array.isArray(body.warnings)
      ? body.warnings.filter((w): w is string => typeof w === "string").slice(0, 20).map((w) => w.slice(0, 500))
      : [];
    const printed = typeof body.documentInvoiceNumber === "string" ? body.documentInvoiceNumber.trim().slice(0, 100) : "";

    const result = await createUploadedInvoice({
      clean: parsed.value,
      documentInvoiceNumber: printed,
      originalFilePath: paths.original,
      extractionJson: audit.fields,
      rawResponse: audit.raw,
      warnings,
    });
    return NextResponse.json(result, { status: 201 });
  } catch (e) {
    return serverError(e, "save upload");
  }
}
