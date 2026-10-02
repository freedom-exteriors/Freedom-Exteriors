// Good/Better/Best defaults from a job's measured roof (Hover or EagleView,
// via roofMeasurements). The calculator looks the same; these just make its
// starting numbers match the report.

const num = (v) => { const x = parseFloat(v); return Number.isFinite(x) ? x : null; };
const rise = (p) => num(String(p ?? "").split("/")[0]);

/** [{ rise, area }] from the report's per-pitch area table, else []. */
export function pitchMix(m) {
  return (m?.pitches || [])
    .map((p) => ({ rise: rise(p.pitch), area: num(p.area) }))
    .filter((p) => p.rise !== null && p.area > 0);
}

/** Predominant pitch (rise/12), or "". */
export function measuredPitch(m) {
  const r = rise(m?.predominantPitch);
  return r === null ? "" : r;
}

/** Stories from the report: 1, 2 (EagleView's ">1"), up to 3; or null. */
export function measuredStories(m) {
  const s = String(m?.stories ?? "").trim();
  if (!s) return null;
  if (s.startsWith(">")) return 2;
  const n = parseInt(s, 10);
  return Number.isFinite(n) && n > 0 ? Math.min(n, 3) : null;
}

export function bandPct(pitchRise, bands) {
  const p = num(pitchRise) || 0;
  const band = bands.find((b) => p <= b.maxPitch) || bands[bands.length - 1];
  return band ? num(band.pct) || 0 : 0;
}

/** Pitch surcharge weighted by how much roof area is at each pitch. */
export function weightedPitchPct(mix, bands) {
  const total = mix.reduce((s, p) => s + p.area, 0);
  if (!total) return null;
  return Math.round((mix.reduce((s, p) => s + bandPct(p.rise, bands) * p.area, 0) / total) * 10) / 10;
}
