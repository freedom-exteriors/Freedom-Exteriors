// EagleView report import: Claude reads the PDF into a fixed JSON shape
// (EXTRACT_SCHEMA), then normalizeEagleView() turns that into the same
// measurement shape /api/hover returns, so everything that already reads
// job.hoverMeasurements (Good/Better/Best, supplier email) can use it too.
//
// Report types differ in what they carry. Bid Perfect has area, pitch, facets
// and suggested waste only; Premium Roof / QuickSquares add ridge/hip/valley/
// eave/rake/flashing lengths and a waste table. Anything a report doesn't
// show comes back null — never estimated.

const num = { type: ["number", "null"] };
const text = { type: ["string", "null"] };
const obj = (properties) => ({ type: "object", properties, required: Object.keys(properties), additionalProperties: false });

export const EXTRACT_SCHEMA = obj({
  reportType: text,         // as printed: "Bid Perfect", "Premium Roof", "QuickSquares", "Walls", ...
  reportNumber: text,
  reportDate: text,
  address: text,
  roofs: {
    type: "array",
    items: obj({
      label: text,          // "#1", "Main", ...
      squares: num,
      facets: num,
      suggestedWastePct: num,
      pitches: { type: "array", items: obj({ pitch: text, percent: num, squares: num }) },
    }),
  },
  totalSquares: num,        // whole report, no waste
  totalAreaSqFt: num,       // only if printed in square feet
  totalFacets: num,
  pitchBreakdown: { type: "array", items: obj({ pitch: text, percent: num, squares: num, areaSqFt: num }) },
  suggestedWastePct: num,   // single overall figure if the report gives one
  lengthsLF: obj({ ridges: num, hips: num, valleys: num, rakes: num, eaves: num, flashing: num, stepFlashing: num, dripEdge: num, parapets: num }),
  wasteTable: { type: "array", items: obj({ wastePct: num, areaSqFt: num, squares: num }) },
});

export const EXTRACT_SYSTEM = `You transcribe EagleView roof measurement reports into JSON for a roofing contractor's estimating software. These numbers drive material orders, so accuracy matters more than completeness.

Rules:
- Copy numbers exactly as printed. Do not compute, convert, round, or estimate anything the report does not print.
- If a value is not printed in the report, use null (or an empty array). Many report types (e.g. Bid Perfect) have no ridge/hip/valley/eave/rake lengths and no waste table — those must be null/empty, not guessed.
- "squares" = roofing squares (1 square = 100 sq ft). "areaSqFt" / "totalAreaSqFt" only when the report prints square feet.
- Areas in EagleView summary tables exclude waste; keep them that way. The suggested waste factor is a percentage (12% -> 12).
- Pitches as printed, e.g. "10/12". percent as a number (90% -> 90).
- When the report lists several structures/roofs, give one entry per roof in "roofs" and use the report's Total row for totalSquares/totalFacets/pitchBreakdown. If there is no Total row, leave those null/empty.
- Lengths are in linear feet. "dripEdge" only if the report prints a drip edge figure; "eaves"/"rakes" as printed (EagleView sometimes labels eaves "Eaves/Starter").`;

const n = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const round = (v, d = 2) => (v === null ? null : Math.round(v * 10 ** d) / 10 ** d);
const rise = (p) => Number(String(p || "").split("/")[0]);

/** Extraction JSON → the job.hoverMeasurements shape (+ EagleView-specific fields). */
export function normalizeEagleView(x, { now = new Date() } = {}) {
  const roofs = Array.isArray(x?.roofs) ? x.roofs : [];
  const warnings = [];

  const roofSquares = roofs.reduce((s, r) => s + (n(r.squares) || 0), 0);
  let squares = n(x?.totalSquares);
  if (squares === null && roofSquares) squares = round(roofSquares);
  else if (squares !== null && roofSquares && Math.abs(squares - roofSquares) > 0.15) {
    warnings.push(`Report total (${squares} SQ) doesn't match the sum of its roofs (${round(roofSquares)} SQ) — check the PDF.`);
  }
  const totalRoofArea = n(x?.totalAreaSqFt) ?? (squares !== null ? Math.round(squares * 100) : null);

  // Pitch table: the report's Total row, else merge the per-roof rows.
  let pitchRows = (Array.isArray(x?.pitchBreakdown) ? x.pitchBreakdown : []).filter((p) => p?.pitch);
  if (!pitchRows.length) {
    const merged = new Map();
    for (const r of roofs) for (const p of r.pitches || []) {
      if (!p?.pitch) continue;
      merged.set(p.pitch, (merged.get(p.pitch) || 0) + (n(p.squares) ?? ((n(p.percent) || 0) / 100) * (n(r.squares) || 0)));
    }
    pitchRows = [...merged].map(([pitch, sq]) => ({ pitch, squares: round(sq), percent: squares ? round((sq / squares) * 100, 1) : null }));
  }
  const pitches = pitchRows
    .map((p) => {
      const sq = n(p.squares);
      const area = n(p.areaSqFt) ?? (sq !== null ? Math.round(sq * 100) : null);
      return { pitch: p.pitch, area, percentage: n(p.percent) ?? (area !== null && totalRoofArea ? round((area / totalRoofArea) * 100, 1) : null) };
    })
    .sort((a, b) => (b.area || 0) - (a.area || 0));
  const lowSlopeArea = pitches.length ? pitches.filter((p) => rise(p.pitch) < 4).reduce((s, p) => s + (p.area || 0), 0) : null;

  const L = x?.lengthsLF || {};
  const ridges = n(L.ridges), hips = n(L.hips), eaves = n(L.eaves), rakes = n(L.rakes);
  const hasLengths = [ridges, hips, n(L.valleys), eaves, rakes].some((v) => v !== null);

  // Overall suggested waste: as printed, else area-weighted from the roofs.
  let suggestedWastePct = n(x?.suggestedWastePct);
  if (suggestedWastePct === null && roofSquares) {
    const weighted = roofs.reduce((s, r) => s + (n(r.suggestedWastePct) || 0) * (n(r.squares) || 0), 0);
    if (roofs.every((r) => n(r.suggestedWastePct) !== null)) suggestedWastePct = round(weighted / roofSquares, 1);
  }
  const wasteAt = (pct) => {
    const row = (x?.wasteTable || []).find((w) => n(w?.wastePct) === pct);
    if (row) return n(row.areaSqFt) ?? (n(row.squares) !== null ? Math.round(row.squares * 100) : null);
    return totalRoofArea !== null ? Math.round(totalRoofArea * (1 + pct / 100)) : null;
  };

  if (!totalRoofArea) warnings.push("No roof area found in this report.");
  if (!hasLengths) warnings.push("This report has no ridge/hip/valley/eave/rake lengths (e.g. Bid Perfect). Area and pitch are fine for pricing; order a Premium Roof report for a full material takeoff.");

  return {
    source: "eagleview",
    reportType: x?.reportType || null,
    reportNumber: x?.reportNumber || null,
    reportDate: x?.reportDate || null,
    address: x?.address || null,
    totalRoofArea,
    squares: squares !== null ? round(squares) : totalRoofArea !== null ? round(totalRoofArea / 100) : null,
    areaWithWaste: { plus5: wasteAt(5), plus10: wasteAt(10), plus15: wasteAt(15), plus20: wasteAt(20) },
    suggestedWastePct,
    facets: n(x?.totalFacets) ?? (roofs.length ? roofs.reduce((s, r) => s + (n(r.facets) || 0), 0) || null : null),
    predominantPitch: pitches[0]?.pitch ?? null,
    pitches,
    lowSlopeArea,
    roofs: roofs.map((r) => ({ label: r.label || null, squares: n(r.squares), facets: n(r.facets), suggestedWastePct: n(r.suggestedWastePct), pitches: (r.pitches || []).map((p) => ({ pitch: p.pitch, percent: n(p.percent), squares: n(p.squares) })) })),
    hasLengths,
    ridgeHipLength: ridges !== null || hips !== null ? (ridges || 0) + (hips || 0) : null,
    ridgeLength: ridges,
    hipLength: hips,
    valleyLength: n(L.valleys),
    eavesLength: eaves,
    rakeLength: rakes,
    dripEdgeLength: n(L.dripEdge) ?? (eaves !== null && rakes !== null ? eaves + rakes : null),
    flashingLength: n(L.flashing),
    stepFlashingLength: n(L.stepFlashing),
    parapetLength: n(L.parapets),
    warnings,
    fetchedAt: now.toISOString(),
  };
}

/** True when the report's street number + first street word appear in the job address. */
export function addressMatches(reportAddress, jobAddress) {
  const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
  const r = norm(reportAddress).split(" ");
  const j = norm(jobAddress);
  if (!r[0] || !j) return true; // nothing to compare
  return j.startsWith(r[0] + " ") && (!r[1] || j.includes(r[1]));
}
