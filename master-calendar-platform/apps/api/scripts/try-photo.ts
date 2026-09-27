// Try photo extraction on a real image, without the database:
//   ANTHROPIC_API_KEY=… npm run try:photo -w @mcp/api -- ./flyer.jpg [America/Chicago]
// Each run is one model call on your Anthropic account.
import { readFile } from "node:fs/promises";
import path from "node:path";
import { config as loadEnv } from "dotenv";
import { ClaudeScheduleExtractor } from "../src/extraction/extractor.js";
import { prepareUpload } from "../src/extraction/prepare.js";
import { toCandidates } from "../src/extraction/candidates.js";
import { isoDate, todayIn } from "../src/lib/recurrence.js";
import { formatClock } from "@mcp/planner";

loadEnv({ path: path.resolve(import.meta.dirname, "../../../.env") });
const [file, timeZone = "America/Chicago"] = process.argv.slice(2);
if (!file) {
  console.error("usage: npm run try:photo -w @mcp/api -- <image-or-pdf> [time zone]");
  process.exit(1);
}
const prepared = await prepareUpload(await readFile(file));
const today = isoDate(todayIn(timeZone));
const extractor = new ClaudeScheduleExtractor(process.env.EXTRACTION_MODEL || "claude-opus-5");
const out = await extractor.extract({ bytes: prepared.bytes, mediaType: prepared.mediaType, timeZone, today, people: [], tags: [] });
const cands = toCandidates(out, { timeZone, today, people: [], tags: [] });
const day = (iso: string) => new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short", month: "short", day: "numeric" }).format(new Date(iso));
console.log(`\n${cands.length} candidate(s) from ${path.basename(file)} (model ${extractor.model})`);
if (out.notes) console.log(`Notes: ${out.notes}`);
for (const c of cands) {
  const when = c.allDay ? `${day(c.start)} (all day)` : `${day(c.start)} ${formatClock(new Date(c.start), timeZone)}–${formatClock(new Date(c.end), timeZone)}`;
  console.log(`\n${c.lowConfidence ? "⚠" : "✓"} ${c.title}\n    ${when}${c.location ? ` @ ${c.location}` : ""}   confidence ${c.confidence.toFixed(2)}\n    read: "${c.sourceText}"${c.assumptions.length ? `\n    note: ${c.assumptions.join("; ")}` : ""}`);
}
