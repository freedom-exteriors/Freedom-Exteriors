import "server-only";
import { isUuid } from "./http";

export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

export const UPLOAD_TYPES = {
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
} as const;
export type UploadExt = keyof typeof UPLOAD_TYPES;

export function isUploadExt(s: unknown): s is UploadExt {
  return typeof s === "string" && Object.hasOwn(UPLOAD_TYPES, s);
}

/** Storage paths are built on the server from a UUID, never from user text. */
export function uploadPaths(uploadId: string, ext: UploadExt) {
  if (!isUuid(uploadId)) throw new Error("Bad upload id");
  return {
    original: `originals/${uploadId}/original.${ext}`,
    extraction: `extractions/${uploadId}.json`,
  };
}

/** Check the first bytes really are a PDF / PNG / JPEG. */
export function sniffType(buf: Buffer): UploadExt | null {
  if (buf.subarray(0, 5).toString("latin1") === "%PDF-") return "pdf";
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "png";
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "jpg";
  return null;
}
