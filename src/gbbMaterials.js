// Good/Better/Best helpers that use a job's measured roof (Hover or EagleView,
// via roofMeasurements) and ABC Supply costs from the materials catalog.
//
// ABC costs are internal-only (ABC's terms): they feed the staff cost/margin
// panel and are never folded into tier prices or saved on the job.

const num = (v) => { const x = parseFloat(v); return Number.isFinite(x) ? x : null; };
const rise = (p) => num(String(p ?? "").split("/")[0]);

// What a "by length" accessory can be measured from. get() returns linear feet or null.
export const LENGTH_BASES = {
  ridgeHip: { label: "Ridges + hips (ridge cap)", get: (m) => m?.ridgeHipLength },
  eavesRakes: { label: "Eaves + rakes (drip edge)", get: (m) => m?.dripEdgeLength ?? sum(m?.eavesLength, m?.rakeLength) },
  eaves: { label: "Eaves (starter, ice & water)", get: (m) => m?.eavesLength },
  rakes: { label: "Rakes", get: (m) => m?.rakeLength },
  valleys: { label: "Valleys", get: (m) => m?.valleyLength },
  stepFlashing: { label: "Step flashing", get: (m) => m?.stepFlashingLength },
  flashing: { label: "Wall/headwall flashing", get: (m) => m?.flashingLength },
};
function sum(a, b) { return num(a) !== null && num(b) !== null ? num(a) + num(b) : null; }

export function measuredLength(basis, m) {
  const v = num(LENGTH_BASES[basis]?.get(m));
  return v !== null && v >= 0 ? v : null;
}

/** [{ rise, area }] from measurements with a per-pitch area table, else []. */
export function pitchMix(m) {
  return (m?.pitches || [])
    .map((p) => ({ rise: rise(p.pitch), area: num(p.area) }))
    .filter((p) => p.rise !== null && p.area > 0);
}

/** Predominant pitch (rise/12) from measurements, or "". */
export function measuredPitch(m) {
  const r = rise(m?.predominantPitch);
  return r === null ? "" : r;
}

/** Stories hint from measurements: 1, 2 (">1" means 2 or more), or null. */
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

/**
 * Accessory quantity + sell price.
 *   auto:   ceil(squares / coveragePerUnit)
 *   length: ceil(measured LF / coveragePerUnit) — needs measured lengths; without
 *           them the per-job quantity typed in is used instead (needsQty: true)
 *   manual: the per-job quantity typed in
 */
export function accessoryLine(item, squares, manualQty, measurements) {
  const cover = num(item.coveragePerUnit) || 1;
  let qty, lf = null, needsQty = false;
  if (item.calcMode === "length") {
    lf = measuredLength(item.lengthBasis, measurements);
    if (lf === null) { needsQty = true; qty = num(manualQty) || 0; }
    else qty = Math.ceil(lf / cover);
  } else if (item.calcMode === "manual") {
    qty = num(manualQty) || 0;
  } else {
    qty = Math.ceil((num(squares) || 0) / cover);
  }
  const price = num(item.pricePerUnit) || 0;
  return { qty, total: qty * price, lf, needsQty };
}

/** ABC cost per catalog unit, or null if the item isn't linked/priced. */
export function abcUnitCost(item) {
  const c = num(item?.abcCost);
  return c !== null && c > 0 ? c : null;
}

/**
 * Internal material cost for one tier from ABC costs: shingles at
 * squares × units-per-square × cost, plus each accessory line at qty × cost.
 * `missing` lists what had no ABC cost, so the total is never silently low.
 */
export function tierMaterialCost({ shingle, squares, accessoryLines }) {
  const missing = [];
  let cost = 0;
  if (shingle) {
    const c = abcUnitCost(shingle);
    if (c === null) missing.push(shingleName(shingle));
    else cost += (num(squares) || 0) * (num(shingle.abcUnitsPerSq) || 1) * c;
  } else {
    missing.push("shingle (default rate, no product picked)");
  }
  for (const l of accessoryLines) {
    const c = abcUnitCost(l.item);
    if (c === null) missing.push(l.item.manufacturer || "(unnamed accessory)");
    else cost += l.qty * c;
  }
  return { cost, missing };
}

export const shingleName = (i) => [i.manufacturer, i.style, i.color].filter(Boolean).join(" ") || "(unnamed shingle)";

/** Catalog items linked to ABC, as pricing request lines (one per item number). */
export function abcPricingLines(catalog) {
  const seen = new Set();
  return (catalog || [])
    .filter((i) => i.abcItemNumber && !seen.has(i.abcItemNumber + "|" + (i.abcUom || "")) && seen.add(i.abcItemNumber + "|" + (i.abcUom || "")))
    .map((i) => ({ itemNumber: String(i.abcItemNumber).trim(), quantity: 1, ...(i.abcUom ? { uom: i.abcUom } : {}) }));
}

/** Apply an ABC pricing response to the catalog (cost, status, timestamp). */
export function applyAbcPrices(catalog, prices, fetchedAt) {
  const byKey = new Map();
  for (const p of prices || []) {
    byKey.set(`${p.itemNumber}|${p.uom || ""}`, p);
    if (!byKey.has(`${p.itemNumber}|`)) byKey.set(`${p.itemNumber}|`, p);
  }
  return (catalog || []).map((i) => {
    if (!i.abcItemNumber) return i;
    const p = byKey.get(`${String(i.abcItemNumber).trim()}|${i.abcUom || ""}`) || byKey.get(`${String(i.abcItemNumber).trim()}|`);
    if (!p) return { ...i, abcStatus: "Not returned by ABC" };
    return {
      ...i,
      abcCost: p.unitPrice ?? null,
      abcUom: i.abcUom || p.uom || "",
      abcStatus: p.unitPrice != null ? "OK" : p.statusMessage || p.statusCode || "Not priced",
      abcCostAt: fetchedAt || new Date().toISOString(),
    };
  });
}
