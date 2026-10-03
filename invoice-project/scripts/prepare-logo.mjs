// Takes the logo out of the reference estimate (word/media) and writes it to
// src/lib/docx/logo.ts as base64, so the letterhead needs no file at runtime.
//
// The reference places the image at 2476500 x 1647825 EMU (2.71" x 1.80"),
// INCLUDING its transparent margin, so we keep the margin (cropping it would
// make the artwork bigger than on the reference) and only scale the pixels
// to ~300 dpi at that print size.
//
// Usage: npm run logo [-- path/to/reference.docx]
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import JSZip from "jszip";
import sharp from "sharp";

const ref = process.argv[2] ?? path.resolve("..", "reference", "Freedom_Exteriors_Estimate_Pearson.docx");
const zip = await JSZip.loadAsync(readFileSync(ref));
const media = Object.keys(zip.files).filter((f) => /^word\/media\/.+\.png$/i.test(f));
if (media.length !== 1) throw new Error(`Expected exactly one PNG in ${ref} word/media, found ${media.length}`);
const original = await zip.file(media[0]).async("nodebuffer");
const meta = await sharp(original).metadata();

const WIDTH_IN = 2476500 / 914400; // 2.708"
const width = Math.round(WIDTH_IN * 300 / 10) * 10; // ~300 dpi
const height = Math.round((width * meta.height) / meta.width);
const out = await sharp(original).resize({ width, height }).png({ compressionLevel: 9, palette: false }).toBuffer();

writeFileSync(
  "src/lib/docx/logo.ts",
  `// Letterhead logo, taken from ${path.basename(ref)} (${media[0]}) by
// \`npm run logo\`. ${meta.width}x${meta.height} scaled to ${width}x${height} (~300 dpi at the
// reference's 2.71" x 1.80" placement). Do not edit by hand.
export const LOGO: { base64: string; width: number; height: number } | null = {
  width: ${width},
  height: ${height},
  base64: "${out.toString("base64")}",
};
`,
);
console.log(`${media[0]}: ${meta.width}x${meta.height}, ${original.length} bytes → ${width}x${height}, ${out.length} bytes`);
