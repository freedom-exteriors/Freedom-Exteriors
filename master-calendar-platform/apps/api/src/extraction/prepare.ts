// Validate an upload by its actual bytes (never the claimed type) and normalize images:
// apply the EXIF rotation (phone photos are often stored sideways), downscale to the
// resolution vision models actually use, re-encode as JPEG. This also strips EXIF,
// including GPS location, before anything is stored.
import sharp from "sharp";
import type { ExtractionInput } from "./extractor.js";

export class UploadError extends Error {}

const MAX_EDGE = 1568;

function sniff(b: Buffer): "jpeg" | "png" | "gif" | "webp" | "pdf" | "heic" | null {
  if (b.length < 12) return null;
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "jpeg";
  if (b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "png";
  if (b.subarray(0, 4).toString("latin1") === "GIF8") return "gif";
  if (b.subarray(0, 4).toString("latin1") === "RIFF" && b.subarray(8, 12).toString("latin1") === "WEBP") return "webp";
  if (b.subarray(0, 5).toString("latin1") === "%PDF-") return "pdf";
  const brand = b.subarray(4, 12).toString("latin1");
  if (/^ftyp(heic|heix|hevc|mif1|msf1)/.test(brand)) return "heic";
  return null;
}

export async function prepareUpload(raw: Buffer): Promise<{ bytes: Buffer; mediaType: ExtractionInput["mediaType"]; ext: string }> {
  const kind = sniff(raw);
  if (kind === null) throw new UploadError("That file isn't a photo or PDF we can read (use JPG, PNG, WebP, HEIC or PDF)");
  if (kind === "pdf") return { bytes: raw, mediaType: "application/pdf", ext: "pdf" };
  try {
    const bytes = await sharp(raw, { limitInputPixels: 80_000_000 })
      .rotate()
      .resize({ width: MAX_EDGE, height: MAX_EDGE, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 85 })
      .toBuffer();
    return { bytes, mediaType: "image/jpeg", ext: "jpg" };
  } catch {
    if (kind === "heic") {
      throw new UploadError("This iPhone photo format (HEIC) couldn't be opened — take a screenshot of it, or set Camera → Formats → Most Compatible");
    }
    throw new UploadError("That image looks damaged and couldn't be opened");
  }
}
