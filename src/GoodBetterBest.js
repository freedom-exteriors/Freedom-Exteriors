import { roofMeasurements } from "./measurements";
import { useState } from "react";
import { apiFetch } from "./apiFetch";
import { pitchMix, measuredPitch, measuredStories, bandPct, weightedPitchPct } from "./gbbMeasured";

const TEAL = "#1a9e99"; const GOLD = "#e8a820"; const DARK = "#080d14";
const PANEL = "#0f1923"; const PANEL2 = "#162030"; const BORDER = "#1e3048";
const TEXT = "#e2eaf4"; const MUTED = "#6b8099"; const GREEN = "#10b981";

const DEFAULT_PRICING = {
  // Base price per square (100 sq ft) for each tier
  baseGood: 650,
  baseBetter: 750,
  baseBest: 850,
  // Pitch surcharge bands — % added to base, keyed by max pitch in the band (12 = 12/12).
  // Sourced from E&R Roofing's 2026 price list, "Architectural Shingles"
  // (re-roof) column, not "New Construction" — pct is each pitch's $/SQ
  // rate vs. the $115/SQ baseline (3/12–7/12), e.g. 8/12 = $120/SQ = +4.35%.
  // E&R's list starts at 4/12; 3/12 is folded into the baseline band since
  // it isn't priced separately there and is generally walkable-equivalent.
  // Below 4/12 isn't in E&R's shingle list at all (that's TPO/EPDM/low-slope
  // territory) — that band's 20% is the prior unsourced placeholder, not
  // from this document.
  pitchBands: [
    { maxPitch: 2,  label: "0/12 – 2/12 (Low slope — different underlayment)",  pct: 20 },
    { maxPitch: 7,  label: "3/12 – 7/12 (Standard, walkable)",                  pct: 0 },
    { maxPitch: 8,  label: "8/12",                                              pct: 4.35 },
    { maxPitch: 9,  label: "9/12",                                              pct: 8.70 },
    { maxPitch: 10, label: "10/12 (Roof jacks required)",                       pct: 13.04 },
    { maxPitch: 11, label: "11/12",                                            pct: 21.74 },
    { maxPitch: 12, label: "12/12 (Harness required)",                         pct: 30.43 },
    { maxPitch: 14, label: "13/12 – 14/12",                                    pct: 39.13 },
    { maxPitch: 99, label: "15/12+ (Scaffolding required — E&R's 16/12 rate)", pct: 56.52 },
  ],
  // Story surcharge — % added to base for staging, ladder time, and harness
  // setup. E&R prices this as a flat +$10.00/SQ per additional story; as a %
  // of the $115/SQ baseline that's +8.70% per story above the first. This
  // 3-band model caps at "3+" (2 extra stories = +17.39%), so a literal
  // 4-story home would still price at the 3+ rate rather than continuing to
  // scale linearly — a known simplification of this band structure, not
  // something E&R's list itself caps.
  storyBands: [
    { stories: 1, label: "1 Story",  pct: 0 },
    { stories: 2, label: "2 Story",  pct: 8.70 },
    { stories: 3, label: "3+ Story", pct: 17.39 },
  ],
  wasteFactorPct: 10, // % added to measured area for cuts/waste
};

function Field({ label, value, onChange, prefix, suffix }) {
  return (
    <div>
      <label style={{ display: "block", fontSize: 10, fontWeight: 700, color: MUTED, textTransform: "uppercase", letterSpacing: 1, marginBottom: 5 }}>{label}</label>
      <div style={{ position: "relative" }}>
        {prefix && <span style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: MUTED, fontSize: 14 }}>{prefix}</span>}
        <input
          type="number" value={value} onChange={e => onChange(e.target.value)}
          style={{ width: "100%", background: PANEL2, border: `1px solid ${BORDER}`, borderRadius: 7, color: TEXT, padding: `10px ${suffix ? 26 : 10}px 10px ${prefix ? 22 : 10}px`, fontSize: 15, fontFamily: "monospace", boxSizing: "border-box" }}
        />
        {suffix && <span style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", color: MUTED, fontSize: 13 }}>{suffix}</span>}
      </div>
    </div>
  );
}

function fmt(n) {
  return "$" + Math.round(n).toLocaleString();
}

export function catalogItemLabel(item) {
  if (item.itemType === "accessory") {
    return (item.manufacturer || "(unnamed product)") + ` — $${(parseFloat(item.pricePerUnit) || 0).toLocaleString()}/${item.unit || "unit"}`;
  }
  const parts = [item.manufacturer, item.style, item.color].filter(Boolean);
  return (parts.join(" — ") || "(unnamed product)") + ` — $${(parseFloat(item.ratePerSq) || 0).toLocaleString()}/sq`;
}

// Accessory quantity + cost, given total squares and this job's selections.
// calcMode "auto": quantity = ceil(squares / coveragePerUnit). "manual": quantity is typed in per job.
export function calcAccessoryLine(item, squares, manualQty) {
  const qty = item.calcMode === "manual"
    ? (parseFloat(manualQty) || 0)
    : Math.ceil((parseFloat(squares) || 0) / (parseFloat(item.coveragePerUnit) || 1));
  const price = parseFloat(item.pricePerUnit) || 0;
  return { qty, total: qty * price };
}

// ─── Materials Catalog (admin configures once, feeds Good/Better/Best) ──────
export function MaterialsCatalogSettings({ catalog, onSave, onClose }) {
  const [local, setLocal] = useState(catalog && catalog.length ? catalog : []);
  const [savedFlash, setSavedFlash] = useState(false);

  const save = () => { onSave(local); setSavedFlash(true); setTimeout(() => setSavedFlash(false), 1800); };
  const addShingle = () => setLocal(items => [...items, { id: Date.now() + Math.random(), itemType: "shingle", manufacturer: "", style: "", color: "", ratePerSq: "" }]);
  const addAccessory = () => setLocal(items => [...items, { id: Date.now() + Math.random(), itemType: "accessory", manufacturer: "", unit: "", pricePerUnit: "", calcMode: "auto", coveragePerUnit: "" }]);
  const removeItem = (id) => setLocal(items => items.filter(i => i.id !== id));
  const updateItem = (id, key, val) => setLocal(items => items.map(i => i.id === id ? { ...i, [key]: val } : i));

  const shingles = local.filter(i => i.itemType !== "accessory");
  const accessories = local.filter(i => i.itemType === "accessory");

  return (
    <div style={{ position: "fixed", inset: 0, background: DARK, zIndex: 300, overflowY: "auto", WebkitOverflowScrolling: "touch" }}>
      <div style={{ position: "sticky", top: 0, background: PANEL2, borderBottom: `1px solid ${BORDER}`, padding: "14px 18px", display: "flex", alignItems: "center", justifyContent: "space-between", zIndex: 5 }}>
        <div style={{ fontFamily: "'Barlow Condensed',sans-serif", fontWeight: 800, fontSize: 17, letterSpacing: 1 }}>
          <span style={{ color: TEAL }}>FREEDOM </span><span style={{ color: GOLD }}>EXTERIORS</span>
          <span style={{ color: MUTED, fontWeight: 500, fontSize: 13, marginLeft: 10 }}>Materials Catalog</span>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          {savedFlash && <span style={{ color: TEAL, fontSize: 12, fontWeight: 700 }}>✓ Saved</span>}
          <button onClick={save} style={{ background: `${TEAL}22`, border: `1px solid ${TEAL}`, color: TEAL, borderRadius: 7, padding: "9px 16px", fontWeight: 700, fontSize: 13, cursor: "pointer", fontFamily: "inherit" }}>💾 Save</button>
          <button onClick={onClose} style={{ background: "none", border: `1px solid ${BORDER}`, color: MUTED, borderRadius: 7, padding: "9px 14px", fontSize: 13, cursor: "pointer", fontFamily: "inherit" }}>✕ Close</button>
        </div>
      </div>

      <div style={{ maxWidth: 720, margin: "0 auto", padding: 18 }}>
        <div style={{ fontSize: 12, color: MUTED, marginBottom: 16, lineHeight: 1.6 }}>
          Shingle products feed the Good/Better/Best tier dropdowns — pick one instead of the flat default rate, and the surcharge math (pitch, story, waste) still applies exactly like it does today. Accessories (tear-off materials) are calculated from the roof's squares and added equally to all three tiers.
        </div>

        <div style={{ fontFamily: "'Barlow Condensed',sans-serif", fontWeight: 800, fontSize: 13, color: GOLD, textTransform: "uppercase", letterSpacing: 1, marginBottom: 10 }}>Shingle Products (feed Good/Better/Best)</div>
        {shingles.map(item => (
          <div key={item.id} style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8, background: PANEL, border: `1px solid ${BORDER}`, borderRadius: 9, padding: 10 }}>
            <input type="text" placeholder="Manufacturer (e.g. GAF)" value={item.manufacturer}
              onChange={e => updateItem(item.id, "manufacturer", e.target.value)}
              style={{ flex: 1.2, background: PANEL2, border: `1px solid ${BORDER}`, borderRadius: 7, color: TEXT, padding: "9px 10px", fontSize: 13, fontFamily: "inherit", boxSizing: "border-box" }}/>
            <input type="text" placeholder="Style (e.g. Architectural)" value={item.style}
              onChange={e => updateItem(item.id, "style", e.target.value)}
              style={{ flex: 1.2, background: PANEL2, border: `1px solid ${BORDER}`, borderRadius: 7, color: TEXT, padding: "9px 10px", fontSize: 13, fontFamily: "inherit", boxSizing: "border-box" }}/>
            <input type="text" placeholder="Color" value={item.color}
              onChange={e => updateItem(item.id, "color", e.target.value)}
              style={{ flex: 1, background: PANEL2, border: `1px solid ${BORDER}`, borderRadius: 7, color: TEXT, padding: "9px 10px", fontSize: 13, fontFamily: "inherit", boxSizing: "border-box" }}/>
            <div style={{ position: "relative", flex: 0.8 }}>
              <span style={{ position: "absolute", left: 8, top: "50%", transform: "translateY(-50%)", color: MUTED, fontSize: 13 }}>$</span>
              <input type="number" min="0" step="0.01" placeholder="0" value={item.ratePerSq}
                onChange={e => updateItem(item.id, "ratePerSq", e.target.value)}
                style={{ width: "100%", background: PANEL2, border: `1px solid ${BORDER}`, borderRadius: 7, color: TEXT, padding: "9px 8px 9px 18px", fontSize: 13, fontFamily: "monospace", boxSizing: "border-box" }}/>
            </div>
            <span style={{ color: MUTED, fontSize: 11 }}>/sq</span>
            <button onClick={() => removeItem(item.id)} style={{ background: "none", border: "none", color: "#f87171", cursor: "pointer", fontSize: 16, padding: "0 4px" }}>✕</button>
          </div>
        ))}
        {shingles.length === 0 && <div style={{ textAlign: "center", color: MUTED, padding: "14px 0", fontSize: 12 }}>No shingle products yet.</div>}
        <button onClick={addShingle} style={{ width: "100%", background: "none", border: `1px dashed ${BORDER}`, color: MUTED, borderRadius: 9, padding: "10px", fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "inherit", marginTop: 4, marginBottom: 24 }}>+ Add Shingle Product</button>

        <div style={{ fontFamily: "'Barlow Condensed',sans-serif", fontWeight: 800, fontSize: 13, color: GOLD, textTransform: "uppercase", letterSpacing: 1, marginBottom: 4 }}>Accessories (ice & water, felt, vents, drip edge, nails, etc.)</div>
        <div style={{ fontSize: 11, color: MUTED, marginBottom: 10, lineHeight: 1.5 }}>
          "Auto" calculates quantity from roof squares using the coverage rate you enter (e.g. 1 roll covers 4 squares). "Manual" lets you type the quantity per job — use this for anything code-driven like vent counts.
        </div>
        {accessories.map(item => (
          <div key={item.id} style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8, background: PANEL, border: `1px solid ${BORDER}`, borderRadius: 9, padding: 10, flexWrap: "wrap" }}>
            <input type="text" placeholder="Product (e.g. GAF FeltBuster Synthetic)" value={item.manufacturer}
              onChange={e => updateItem(item.id, "manufacturer", e.target.value)}
              style={{ flex: 2, minWidth: 160, background: PANEL2, border: `1px solid ${BORDER}`, borderRadius: 7, color: TEXT, padding: "9px 10px", fontSize: 13, fontFamily: "inherit", boxSizing: "border-box" }}/>
            <input type="text" placeholder="Unit (roll, box, lb...)" value={item.unit}
              onChange={e => updateItem(item.id, "unit", e.target.value)}
              style={{ flex: 1, minWidth: 90, background: PANEL2, border: `1px solid ${BORDER}`, borderRadius: 7, color: TEXT, padding: "9px 10px", fontSize: 13, fontFamily: "inherit", boxSizing: "border-box" }}/>
            <div style={{ position: "relative", flex: 0.8, minWidth: 80 }}>
              <span style={{ position: "absolute", left: 8, top: "50%", transform: "translateY(-50%)", color: MUTED, fontSize: 13 }}>$</span>
              <input type="number" min="0" step="0.01" placeholder="0" value={item.pricePerUnit}
                onChange={e => updateItem(item.id, "pricePerUnit", e.target.value)}
                style={{ width: "100%", background: PANEL2, border: `1px solid ${BORDER}`, borderRadius: 7, color: TEXT, padding: "9px 8px 9px 18px", fontSize: 13, fontFamily: "monospace", boxSizing: "border-box" }}/>
            </div>
            <span style={{ color: MUTED, fontSize: 11 }}>/unit</span>
            <select value={item.calcMode} onChange={e => updateItem(item.id, "calcMode", e.target.value)}
              style={{ flex: 1, minWidth: 100, background: PANEL2, border: `1px solid ${BORDER}`, borderRadius: 7, color: TEXT, padding: "9px 6px", fontSize: 12, fontFamily: "inherit" }}>
              <option value="auto">Auto (per sq)</option>
              <option value="manual">Manual qty</option>
            </select>
            {item.calcMode === "auto" && (
              <>
                <div style={{ position: "relative", flex: 0.8, minWidth: 70 }}>
                  <input type="number" min="0" step="0.01" placeholder="0" value={item.coveragePerUnit}
                    onChange={e => updateItem(item.id, "coveragePerUnit", e.target.value)}
                    style={{ width: "100%", background: PANEL2, border: `1px solid ${BORDER}`, borderRadius: 7, color: TEXT, padding: "9px 10px", fontSize: 13, fontFamily: "monospace", boxSizing: "border-box" }}/>
                </div>
                <span style={{ color: MUTED, fontSize: 11 }}>sq/unit</span>
              </>
            )}
            <button onClick={() => removeItem(item.id)} style={{ background: "none", border: "none", color: "#f87171", cursor: "pointer", fontSize: 16, padding: "0 4px" }}>✕</button>
          </div>
        ))}
        {accessories.length === 0 && <div style={{ textAlign: "center", color: MUTED, padding: "14px 0", fontSize: 12 }}>No accessories yet.</div>}
        <button onClick={addAccessory} style={{ width: "100%", background: "none", border: `1px dashed ${BORDER}`, color: MUTED, borderRadius: 9, padding: "10px", fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "inherit", marginTop: 4 }}>+ Add Accessory</button>
      </div>
    </div>
  );
}

// ─── Pricing Settings Screen (admin configures once) ────────────────────────
export function PricingSettings({ pricing, onSave, onClose }) {
  const [local, setLocal] = useState(pricing || DEFAULT_PRICING);
  const [savedFlash, setSavedFlash] = useState(false);

  const save = () => { onSave(local); setSavedFlash(true); setTimeout(() => setSavedFlash(false), 1800); };
  const setPitchBand = (i, key) => (v) => setLocal(d => { const bands = [...d.pitchBands]; bands[i] = { ...bands[i], [key]: v }; return { ...d, pitchBands: bands }; });
  const setStoryBand = (i, key) => (v) => setLocal(d => { const bands = [...d.storyBands]; bands[i] = { ...bands[i], [key]: v }; return { ...d, storyBands: bands }; });

  return (
    <div style={{ position: "fixed", inset: 0, background: DARK, zIndex: 300, overflowY: "auto", WebkitOverflowScrolling: "touch" }}>
      <div style={{ position: "sticky", top: 0, background: PANEL2, borderBottom: `1px solid ${BORDER}`, padding: "14px 18px", display: "flex", alignItems: "center", justifyContent: "space-between", zIndex: 5 }}>
        <div style={{ fontFamily: "'Barlow Condensed',sans-serif", fontWeight: 800, fontSize: 17, letterSpacing: 1 }}>
          <span style={{ color: TEAL }}>FREEDOM </span><span style={{ color: GOLD }}>EXTERIORS</span>
          <span style={{ color: MUTED, fontWeight: 500, fontSize: 13, marginLeft: 10 }}>Pricing Settings</span>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          {savedFlash && <span style={{ color: TEAL, fontSize: 12, fontWeight: 700 }}>✓ Saved</span>}
          <button onClick={save} style={{ background: `${TEAL}22`, border: `1px solid ${TEAL}`, color: TEAL, borderRadius: 7, padding: "9px 16px", fontWeight: 700, fontSize: 13, cursor: "pointer", fontFamily: "inherit" }}>💾 Save</button>
          <button onClick={onClose} style={{ background: "none", border: `1px solid ${BORDER}`, color: MUTED, borderRadius: 7, padding: "9px 14px", fontSize: 13, cursor: "pointer", fontFamily: "inherit" }}>✕ Close</button>
        </div>
      </div>

      <div style={{ maxWidth: 680, margin: "0 auto", padding: 18 }}>
        <div style={{ background: PANEL, border: `1px solid ${BORDER}`, borderRadius: 10, padding: 18, marginBottom: 16 }}>
          <div style={{ fontFamily: "'Barlow Condensed',sans-serif", fontWeight: 800, fontSize: 14, color: GOLD, marginBottom: 4, textTransform: "uppercase", letterSpacing: 1 }}>Base Price Per Square</div>
          <div style={{ fontSize: 11, color: MUTED, marginBottom: 14 }}>One square = 100 sq ft. This is your standard-pitch, single-story rate for each tier.</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
            <Field label="Good" value={local.baseGood} onChange={v => setLocal(d => ({ ...d, baseGood: v }))} prefix="$" />
            <Field label="Better" value={local.baseBetter} onChange={v => setLocal(d => ({ ...d, baseBetter: v }))} prefix="$" />
            <Field label="Best" value={local.baseBest} onChange={v => setLocal(d => ({ ...d, baseBest: v }))} prefix="$" />
          </div>
        </div>

        <div style={{ background: PANEL, border: `1px solid ${BORDER}`, borderRadius: 10, padding: 18, marginBottom: 16 }}>
          <div style={{ fontFamily: "'Barlow Condensed',sans-serif", fontWeight: 800, fontSize: 14, color: GOLD, marginBottom: 4, textTransform: "uppercase", letterSpacing: 1 }}>Pitch Surcharge</div>
          <div style={{ fontSize: 11, color: MUTED, marginBottom: 14 }}>Percent added to the base price as pitch increases (steeper = more labor, more safety gear, slower work).</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {local.pitchBands.map((b, i) => (
              <div key={i} style={{ display: "grid", gridTemplateColumns: "1fr 90px", gap: 10, alignItems: "center" }}>
                <div style={{ fontSize: 13, color: TEXT }}>{b.label}</div>
                <Field value={b.pct} onChange={setPitchBand(i, "pct")} suffix="%" />
              </div>
            ))}
          </div>
        </div>

        <div style={{ background: PANEL, border: `1px solid ${BORDER}`, borderRadius: 10, padding: 18, marginBottom: 16 }}>
          <div style={{ fontFamily: "'Barlow Condensed',sans-serif", fontWeight: 800, fontSize: 14, color: GOLD, marginBottom: 4, textTransform: "uppercase", letterSpacing: 1 }}>Story Surcharge</div>
          <div style={{ fontSize: 11, color: MUTED, marginBottom: 14 }}>Percent added to the base price for taller homes (more staging, ladder work, access time).</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {local.storyBands.map((b, i) => (
              <div key={i} style={{ display: "grid", gridTemplateColumns: "1fr 90px", gap: 10, alignItems: "center" }}>
                <div style={{ fontSize: 13, color: TEXT }}>{b.label}</div>
                <Field value={b.pct} onChange={setStoryBand(i, "pct")} suffix="%" />
              </div>
            ))}
          </div>
        </div>

        <div style={{ background: PANEL, border: `1px solid ${BORDER}`, borderRadius: 10, padding: 18, marginBottom: 16 }}>
          <div style={{ fontFamily: "'Barlow Condensed',sans-serif", fontWeight: 800, fontSize: 14, color: GOLD, marginBottom: 4, textTransform: "uppercase", letterSpacing: 1 }}>Waste Factor</div>
          <div style={{ fontSize: 11, color: MUTED, marginBottom: 14 }}>Extra material added on top of measured roof area to cover cuts, hips, valleys, and overlap.</div>
          <div style={{ maxWidth: 150 }}>
            <Field value={local.wasteFactorPct} onChange={v => setLocal(d => ({ ...d, wasteFactorPct: v }))} suffix="%" />
          </div>
        </div>

        <div style={{ textAlign: "center", paddingBottom: 30 }}>
          <button onClick={save} style={{ background: `${TEAL}22`, border: `1px solid ${TEAL}`, color: TEAL, borderRadius: 8, padding: "14px 28px", fontWeight: 700, fontSize: 14, cursor: "pointer", fontFamily: "inherit" }}>💾 Save Pricing Settings</button>
        </div>
      </div>
    </div>
  );
}

// ─── Pricing calc ────────────────────────────────────────────────────────────
const pitchSurchargePct = bandPct;
function storySurchargePct(stories, bands) {
  const s = parseInt(stories) || 1;
  const exact = bands.find(b => b.stories === s);
  if (exact) return parseFloat(exact.pct) || 0;
  const capped = bands[bands.length - 1];
  return capped ? parseFloat(capped.pct) || 0 : 0;
}

// wastePct: the job's measured report's suggested waste, if it has one (else the setting).
// pitchMix: [{ rise, area }] from the report — the pitch surcharge is then weighted
// by how much of the roof is at each pitch instead of using one pitch for all of it.
export function calcGoodBetterBest({ sqFt, pitch, stories, pricing, baseOverrides, wastePct, pitchMix: mix }) {
  const p = pricing || DEFAULT_PRICING;
  const area = parseFloat(sqFt) || 0;
  const waste = Number.isFinite(parseFloat(wastePct)) ? parseFloat(wastePct) : (parseFloat(p.wasteFactorPct) || 0);
  const withWaste = area * (1 + waste / 100);
  const squares = withWaste / 100;
  const weighted = mix?.length ? weightedPitchPct(mix, p.pitchBands) : null;
  const pitchPct = weighted ?? pitchSurchargePct(pitch, p.pitchBands);
  const storyPct = storySurchargePct(stories, p.storyBands);
  const totalMultiplier = 1 + (pitchPct + storyPct) / 100;

  const tier = (base) => {
    const perSquare = (parseFloat(base) || 0) * totalMultiplier;
    return { perSquare, total: perSquare * squares };
  };

  // A product override only counts if it's a real price; otherwise use the tier default.
  const o = baseOverrides || {};
  const pick = (override, fallback) => (Number.isFinite(parseFloat(override)) && parseFloat(override) > 0 ? override : fallback);
  return {
    squares, pitchPct, storyPct, totalMultiplier,
    good: tier(pick(o.good, p.baseGood)),
    better: tier(pick(o.better, p.baseBetter)),
    best: tier(pick(o.best, p.baseBest)),
  };
}

// ─── Good/Better/Best Calculator (used on a job) ────────────────────────────
export default function GoodBetterBest({ job, pricing, catalog, onSave, onClose, onOpenSettings, isAdmin }) {
  // Start from the measured report (Hover/EagleView) when there is one.
  const measured = roofMeasurements(job);
  const [sqFt, setSqFt] = useState(job.gbb?.sqFt || measured?.totalRoofArea || "");
  const [pitch, setPitch] = useState(job.gbb?.pitch || measuredPitch(measured));
  const [stories, setStories] = useState(job.gbb?.stories || measuredStories(measured) || 1);
  // Accuracy defaults, only while the numbers still match the report: area-weighted
  // pitch surcharge, and the report's suggested waste. Typing over them turns them off.
  const matchesReport = measured && Number(sqFt) === Number(measured.totalRoofArea) && String(pitch) === String(measuredPitch(measured));
  const mix = matchesReport ? pitchMix(measured) : [];
  const reportWaste = matchesReport ? measured.suggestedWastePct : null;
  const [savedFlash, setSavedFlash] = useState(false);
  const [fetching, setFetching] = useState(false);
  const [fetchError, setFetchError] = useState(null);
  const [fetchInfo, setFetchInfo] = useState(null);
  const [lowConfidence, setLowConfidence] = useState(false);
  const [productIds, setProductIds] = useState(job.gbb?.productIds || { good: "", better: "", best: "" });
  const [accessorySelections, setAccessorySelections] = useState(job.gbb?.accessorySelections || {});

  const findProduct = (id) => (catalog || []).find(p => String(p.id) === String(id));
  // A product picked earlier may since have been removed from the catalog (or have
  // no rate): fall back to the default tier price instead of pricing at $0.
  const productRate = (id) => {
    if (!id) return null;
    const rate = parseFloat(findProduct(id)?.ratePerSq);
    return Number.isFinite(rate) && rate > 0 ? rate : null;
  };
  const baseOverrides = { good: productRate(productIds.good), better: productRate(productIds.better), best: productRate(productIds.best) };
  const missingProducts = ["good", "better", "best"].filter(t => productIds[t] && baseOverrides[t] == null);
  const result = calcGoodBetterBest({ sqFt, pitch, stories, pricing, baseOverrides, wastePct: reportWaste, pitchMix: mix });

  const accessories = (catalog || []).filter(i => i.itemType === "accessory");
  const accessoryLines = accessories
    .filter(item => accessorySelections[item.id]?.checked)
    .map(item => ({ item, ...calcAccessoryLine(item, result.squares, accessorySelections[item.id]?.qty) }));
  const accessoriesTotal = accessoryLines.reduce((sum, l) => sum + l.total, 0);

  const toggleAccessory = (id) => setAccessorySelections(s => ({ ...s, [id]: { ...s[id], checked: !s[id]?.checked } }));
  const setAccessoryQty = (id, qty) => setAccessorySelections(s => ({ ...s, [id]: { ...s[id], qty } }));

  const save = () => {
    onSave({ gbb: { sqFt, pitch, stories, productIds, accessorySelections, result, accessoriesTotal, calculatedAt: new Date().toISOString() } });
    setSavedFlash(true);
    setTimeout(() => setSavedFlash(false), 1800);
  };

  const autoFillFromGoogle = async () => {
    if (!job.address || !job.city || !job.state) { setFetchError("This job needs an address, city, and state first."); return; }
    setFetching(true);
    setFetchError(null);
    setFetchInfo(null);
    setLowConfidence(false);
    try {
      const res = await apiFetch(`/api/solar?address=${encodeURIComponent(job.address)}&city=${encodeURIComponent(job.city)}&state=${encodeURIComponent(job.state)}`);
      const data = await res.json();
      if (!res.ok || !data.success) { setFetchError(data.error || "Couldn't fetch roof data for this address."); setFetching(false); return; }
      setSqFt(data.totalAreaSqFt);
      setPitch(data.pitchRisePerTwelve);
      setLowConfidence(data.lowConfidence);
      const base = `Pulled ${data.totalAreaSqFt.toLocaleString()} sq ft across ${data.segmentCount} roof segment${data.segmentCount===1?"":"s"} · avg pitch ${data.pitchRisePerTwelve}/12${data.imageryDate ? ` · imagery from ${data.imageryDate.year}` : ""}.`;
      if (data.corrected) {
        setFetchInfo(`⚠️ Google's raw detection (${data.rawSegmentAreaSqFt.toLocaleString()} sq ft) was smaller than what's geometrically possible for a roof at this pitch on this footprint — bumped to ${data.totalAreaSqFt.toLocaleString()} sq ft as a mathematical floor. Real complexity is likely still higher. Verify with Hover.`);
      } else if (data.lowConfidence) {
        setFetchInfo(`${base} ⚠️ ${data.imageryQuality === "LOW" || data.imageryQuality === "BASE" ? `Imagery quality is ${data.imageryQuality}` : `Only ${data.segmentCount} facet${data.segmentCount===1?"":"s"} detected`} — treat this as low-confidence and verify with Hover before quoting.`);
      } else {
        setFetchInfo(`${base} Verify against the actual roof — this is a satellite estimate, not a measured takeoff.`);
      }
    } catch (e) {
      setFetchError("Network error reaching the roof data service.");
    }
    setFetching(false);
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: DARK, zIndex: 300, overflowY: "auto", WebkitOverflowScrolling: "touch" }}>
      <div style={{ position: "sticky", top: 0, background: PANEL2, borderBottom: `1px solid ${BORDER}`, padding: "14px 18px", display: "flex", alignItems: "center", justifyContent: "space-between", zIndex: 5 }}>
        <div style={{ fontFamily: "'Barlow Condensed',sans-serif", fontWeight: 800, fontSize: 17, letterSpacing: 1 }}>
          <span style={{ color: TEAL }}>FREEDOM </span><span style={{ color: GOLD }}>EXTERIORS</span>
          <span style={{ color: MUTED, fontWeight: 500, fontSize: 13, marginLeft: 10 }}>Good / Better / Best</span>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          {savedFlash && <span style={{ color: TEAL, fontSize: 12, fontWeight: 700 }}>✓ Saved</span>}
          {isAdmin && <button onClick={onOpenSettings} style={{ background: "none", border: `1px solid ${BORDER}`, color: MUTED, borderRadius: 7, padding: "9px 14px", fontSize: 13, cursor: "pointer", fontFamily: "inherit" }}>⚙️ Pricing Settings</button>}
          <button onClick={save} style={{ background: `${TEAL}22`, border: `1px solid ${TEAL}`, color: TEAL, borderRadius: 7, padding: "9px 16px", fontWeight: 700, fontSize: 13, cursor: "pointer", fontFamily: "inherit" }}>💾 Save</button>
          <button onClick={onClose} style={{ background: "none", border: `1px solid ${BORDER}`, color: MUTED, borderRadius: 7, padding: "9px 14px", fontSize: 13, cursor: "pointer", fontFamily: "inherit" }}>✕ Close</button>
        </div>
      </div>

      <div style={{ maxWidth: 720, margin: "0 auto", padding: 18 }}>
        <div style={{ textAlign: "center", marginBottom: 18 }}>
          <div style={{ fontFamily: "'Barlow Condensed',sans-serif", fontWeight: 800, fontSize: 22, letterSpacing: 1, color: TEXT }}>ROOF PRICING</div>
          <div style={{ color: MUTED, fontSize: 13, marginTop: 4 }}>{job.name} · {job.address}, {job.city}, {job.state}</div>
        </div>

        <div style={{ background: PANEL, border: `1px solid ${BORDER}`, borderRadius: 10, padding: 18, marginBottom: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
            <div style={{ fontFamily: "'Barlow Condensed',sans-serif", fontWeight: 800, fontSize: 14, color: GOLD, textTransform: "uppercase", letterSpacing: 1 }}>Roof Details</div>
            <button onClick={autoFillFromGoogle} disabled={fetching} style={{ background: fetching ? "#2a3a4a" : "#4285f422", border: `1px solid ${fetching ? BORDER : "#4285f4"}`, color: fetching ? MUTED : "#4285f4", borderRadius: 7, padding: "8px 14px", fontSize: 12, fontWeight: 700, cursor: fetching ? "default" : "pointer", fontFamily: "inherit", whiteSpace: "nowrap" }}>
              {fetching ? "⟳ Fetching…" : "🛰️ Auto-Fill from Google"}
            </button>
          </div>
          <div style={{ fontSize: 11, color: MUTED, marginBottom: 14 }}>Instant satellite estimate — good for a driveway quote. For a formal contract, verify with Hover.</div>
          {fetchError && <div style={{ background: "#7c2d1222", border: "1px solid #f8717166", borderRadius: 7, padding: "8px 12px", fontSize: 12, color: "#fca5a5", marginBottom: 12 }}>⚠️ {fetchError}</div>}
          {fetchInfo && (
            <div style={{
              background: lowConfidence ? "#e8a82018" : "#4285f411",
              border: `1px solid ${lowConfidence ? "#e8a82077" : "#4285f444"}`,
              borderRadius: 7, padding: "8px 12px", fontSize: 11.5,
              color: lowConfidence ? "#fbbf24" : "#93c5fd",
              marginBottom: 12, lineHeight: 1.5, fontWeight: lowConfidence ? 600 : 400
            }}>
              🛰️ {fetchInfo}
            </div>
          )}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
            <Field label="Roof Area" value={sqFt} onChange={setSqFt} suffix="sq ft" />
            <Field label="Pitch (rise/12)" value={pitch} onChange={setPitch} suffix="/12" />
            <div>
              <label style={{ display: "block", fontSize: 10, fontWeight: 700, color: MUTED, textTransform: "uppercase", letterSpacing: 1, marginBottom: 5 }}>Stories</label>
              <select value={stories} onChange={e => setStories(e.target.value)}
                style={{ width: "100%", background: PANEL2, border: `1px solid ${BORDER}`, borderRadius: 7, color: TEXT, padding: "10px", fontSize: 15, fontFamily: "inherit", boxSizing: "border-box" }}>
                <option value="1">1 Story</option>
                <option value="2">2 Story</option>
                <option value="3">3+ Story</option>
              </select>
            </div>
          </div>
          {job.hoverId && !sqFt && (
            <div style={{ fontSize: 11, color: GOLD, marginTop: 10 }}>💡 This job has a Hover ID linked — pull measurements from the Details tab first, or enter area manually.</div>
          )}
        </div>

        {sqFt > 0 && (
          <>
            <div style={{ background: PANEL2, borderRadius: 8, padding: "10px 14px", marginBottom: 16, fontSize: 12, color: MUTED, display: "flex", gap: 16, flexWrap: "wrap" }}>
              <span><strong style={{ color: TEXT }}>{result.squares.toFixed(2)}</strong> squares (incl. waste)</span>
              <span>Pitch surcharge: <strong style={{ color: result.pitchPct > 0 ? GOLD : TEXT }}>+{result.pitchPct}%</strong></span>
              <span>Story surcharge: <strong style={{ color: result.storyPct > 0 ? GOLD : TEXT }}>+{result.storyPct}%</strong></span>
            </div>
            {missingProducts.length > 0 && (
              <div style={{ color: "#f87171", fontSize: 12, marginTop: 8 }}>
                ⚠ The product picked for {missingProducts.join(", ")} is no longer in the materials catalog (or has no $/sq) — using the default {missingProducts.length === 1 ? "price" : "prices"} for that tier. Pick a product again.
              </div>
            )}

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginBottom: 16 }}>
              {[
                { key: "good", baseKey: "baseGood", label: "GOOD", color: "#38bdf8", data: result.good },
                { key: "better", baseKey: "baseBetter", label: "BETTER", color: GOLD, data: result.better },
                { key: "best", baseKey: "baseBest", label: "BEST", color: GREEN, data: result.best },
              ].map(t => {
                const selectedProduct = findProduct(productIds[t.key]);
                const shingleOptions = (catalog || []).filter(i => i.itemType !== "accessory");
                const grandTotal = t.data.total + accessoriesTotal;
                return (
                  <div key={t.key} style={{ background: PANEL, border: `2px solid ${t.color}66`, borderRadius: 10, padding: 16, textAlign: "center" }}>
                    <div style={{ fontFamily: "'Barlow Condensed',sans-serif", fontWeight: 800, fontSize: 14, color: t.color, letterSpacing: 1, marginBottom: 10 }}>{t.label}</div>
                    {shingleOptions.length > 0 && (
                      <select value={productIds[t.key]} onChange={e => setProductIds(p => ({ ...p, [t.key]: e.target.value }))}
                        style={{ width: "100%", background: PANEL2, border: `1px solid ${BORDER}`, borderRadius: 6, color: TEXT, padding: "6px 4px", fontSize: 10.5, fontFamily: "inherit", marginBottom: 10, boxSizing: "border-box" }}>
                        <option value="">Default rate (${(pricing || DEFAULT_PRICING)[t.baseKey]}/sq)</option>
                        {shingleOptions.map(item => <option key={item.id} value={item.id}>{catalogItemLabel(item)}</option>)}
                      </select>
                    )}
                    <div style={{ fontSize: 26, fontWeight: 800, color: TEXT, fontFamily: "monospace" }}>{fmt(grandTotal)}</div>
                    <div style={{ fontSize: 11, color: MUTED, marginTop: 6 }}>{fmt(t.data.perSquare)}/sq</div>
                    {selectedProduct && <div style={{ fontSize: 10, color: t.color, marginTop: 6 }}>{[selectedProduct.manufacturer, selectedProduct.style, selectedProduct.color].filter(Boolean).join(" · ")}</div>}
                    {accessoriesTotal > 0 && <div style={{ fontSize: 10, color: MUTED, marginTop: 4 }}>{fmt(t.data.total)} shingle + {fmt(accessoriesTotal)} materials</div>}
                  </div>
                );
              })}
            </div>

            {accessories.length > 0 && (
              <div style={{ background: PANEL, border: `1px solid ${BORDER}`, borderRadius: 10, padding: 16, marginBottom: 16 }}>
                <div style={{ fontFamily: "'Barlow Condensed',sans-serif", fontWeight: 800, fontSize: 13, color: GOLD, textTransform: "uppercase", letterSpacing: 1, marginBottom: 4 }}>Tear-Off Materials</div>
                <div style={{ fontSize: 11, color: MUTED, marginBottom: 12 }}>Added equally to all three tiers above. Based on {result.squares.toFixed(2)} squares.</div>
                {accessories.map(item => {
                  const sel = accessorySelections[item.id];
                  const line = calcAccessoryLine(item, result.squares, sel?.qty);
                  return (
                    <div key={item.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0", borderBottom: `1px solid ${BORDER}` }}>
                      <input type="checkbox" checked={!!sel?.checked} onChange={() => toggleAccessory(item.id)} style={{ width: 16, height: 16, cursor: "pointer" }}/>
                      <div style={{ flex: 1, fontSize: 13, color: TEXT }}>{item.manufacturer || "(unnamed)"} <span style={{ color: MUTED, fontSize: 11 }}>— ${(parseFloat(item.pricePerUnit)||0).toLocaleString()}/{item.unit || "unit"}</span></div>
                      {sel?.checked && item.calcMode === "manual" ? (
                        <input type="number" min="0" placeholder="qty" value={sel?.qty || ""} onChange={e => setAccessoryQty(item.id, e.target.value)}
                          style={{ width: 60, background: PANEL2, border: `1px solid ${BORDER}`, borderRadius: 6, color: TEXT, padding: "6px 8px", fontSize: 12, fontFamily: "monospace", boxSizing: "border-box" }}/>
                      ) : sel?.checked ? (
                        <span style={{ fontSize: 12, color: MUTED, fontFamily: "monospace" }}>{line.qty} {item.unit || "unit"}{line.qty === 1 ? "" : "s"}</span>
                      ) : null}
                      <span style={{ fontSize: 13, fontWeight: 700, color: sel?.checked ? GOLD : MUTED, fontFamily: "monospace", width: 70, textAlign: "right" }}>{sel?.checked ? fmt(line.total) : "—"}</span>
                    </div>
                  );
                })}
                <div style={{ display: "flex", justifyContent: "space-between", paddingTop: 10, fontWeight: 800, fontSize: 13 }}>
                  <span>Total</span><span style={{ color: GOLD, fontFamily: "monospace" }}>{fmt(accessoriesTotal)}</span>
                </div>
              </div>
            )}
          </>
        )}

        {!(sqFt > 0) && (
          <div style={{ background: PANEL, border: `1px solid ${BORDER}`, borderRadius: 10, padding: 40, textAlign: "center", color: MUTED }}>
            Enter roof area above to see Good / Better / Best pricing.
          </div>
        )}

        <div style={{ textAlign: "center", paddingBottom: 30 }}>
          <button onClick={save} style={{ background: `${TEAL}22`, border: `1px solid ${TEAL}`, color: TEAL, borderRadius: 8, padding: "14px 28px", fontWeight: 700, fontSize: 14, cursor: "pointer", fontFamily: "inherit" }}>💾 Save Pricing to Job</button>
        </div>
      </div>
    </div>
  );
}

export { DEFAULT_PRICING };