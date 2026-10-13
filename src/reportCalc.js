// Pure number-crunching for the Reports tab. No React here so it can be tested.
import { calcCommission } from "./CommissionWorkbook";
import { roofMeasurements } from "./measurements";
import { measuredPitch } from "./gbbMeasured";
import { LEAD_SOURCES, NOT_RECORDED, leadSourceOf } from "./leadSources";

export const WON_FROM_STAGE = "approved"; // "closed" = reached Approved or later
const DAY = 86400000;

// When the job entered its current stage. Older jobs have no stageAt, so fall
// back to the date they were added.
export function stageEnteredMs(job) {
  const t = Date.parse(job.stageAt || job.added || "");
  return Number.isFinite(t) ? t : null;
}

export function daysInStage(job, now = Date.now()) {
  const t = stageEnteredMs(job);
  return t == null ? null : Math.max(0, Math.floor((now - t) / DAY));
}

const value = j => Number(j.estimate?.total) || 0;

export function buildReports(jobs, stages, now = Date.now()) {
  const order = stages.map(s => s.id);
  const wonIdx = order.indexOf(WON_FROM_STAGE);
  const open = jobs.filter(j => j.stage !== "collected");

  const byStage = stages.map(s => {
    const list = jobs.filter(j => j.stage === s.id);
    const days = list.map(j => daysInStage(j, now)).filter(d => d != null);
    return {
      id: s.id, label: s.label, color: s.color, icon: s.icon,
      count: list.length,
      value: list.reduce((n, j) => n + value(j), 0),
      avgDays: s.id === "collected" || !days.length ? null : Math.round(days.reduce((a, b) => a + b, 0) / days.length),
    };
  });

  const reps = {};
  for (const j of jobs) {
    const name = j.assigned || "Unassigned";
    const r = reps[name] || (reps[name] = { name, jobs: 0, won: 0, wonValue: 0 });
    r.jobs += 1;
    if (order.indexOf(j.stage) >= wonIdx) { r.won += 1; r.wonValue += value(j); }
  }
  const repRows = Object.values(reps)
    .map(r => ({ ...r, closePct: r.jobs ? Math.round((r.won / r.jobs) * 100) : 0, avgJob: r.won ? Math.round(r.wonValue / r.won) : 0 }))
    .sort((a, b) => b.wonValue - a.wonValue);

  const staleEstimates = jobs
    .filter(j => order.indexOf(j.stage) < wonIdx && value(j) > 0)
    .map(j => ({ job: j, days: daysInStage(j, now) }))
    .filter(x => x.days != null && x.days >= 7)
    .sort((a, b) => b.days - a.days);

  // Money still owed: installed but not marked Paid in Full.
  const receivables = jobs
    .filter(j => j.stage === "installed")
    .map(j => {
      const total = value(j);
      const paid = Number(j.depositAmountPaid) || Number(j.estimate?.downPayment) * (j.depositPaid ? 1 : 0) || 0;
      return { job: j, total, paid, owed: Math.max(0, total - paid), days: daysInStage(j, now) };
    })
    .sort((a, b) => b.owed - a.owed);

  const profit = jobs
    .filter(j => Number(j.commission?.grossRevenue) > 0)
    .map(j => {
      const r = calcCommission(j.commission, false);
      return { job: j, gross: r.gross, net: r.commNet, pct: r.gross ? Math.round((r.commNet / r.gross) * 100) : 0 };
    })
    .sort((a, b) => a.pct - b.pct);

  return {
    byStage, repRows, staleEstimates, receivables, profit,
    totals: {
      open: open.length,
      pipelineValue: open.reduce((n, j) => n + value(j), 0),
      owed: receivables.reduce((n, r) => n + r.owed, 0),
    },
  };
}

// How far Google Solar's roof area runs from a real measurement report (Hover/EagleView),
// on jobs that have both. Error % = (solar - measured) / measured; positive = Solar too big.
export function solarAccuracy(jobs) {
  const rows = [];
  for (const job of jobs) {
    const solar = Number(job.solarEstimate?.totalAreaSqFt);
    const m = roofMeasurements(job);
    const real = Number(m?.totalRoofArea);
    if (!(solar > 0) || !(real > 0)) continue;
    const pitchReal = parseFloat(measuredPitch(m));
    const pitchSolar = parseFloat(job.solarEstimate?.pitchRisePerTwelve);
    rows.push({
      job, solar, real,
      errPct: ((solar - real) / real) * 100,
      pitchDiff: Number.isFinite(pitchReal) && Number.isFinite(pitchSolar) ? pitchSolar - pitchReal : null,
      lowConfidence: !!job.solarEstimate?.lowConfidence,
    });
  }
  const n = rows.length;
  if (!n) return { n: 0, rows };
  const abs = rows.map(r => Math.abs(r.errPct)).sort((a, b) => a - b);
  const pick = q => abs[Math.min(n - 1, Math.floor(q * n))];
  return {
    n, rows: rows.sort((a, b) => Math.abs(b.errPct) - Math.abs(a.errPct)),
    bias: rows.reduce((t, r) => t + r.errPct, 0) / n,
    medianAbs: pick(0.5),
    p80Abs: pick(0.8),
    within10: Math.round((abs.filter(x => x <= 10).length / n) * 100),
  };
}

// Which lead sources actually produce sales. "Closed" uses the same rule as the rep table
// (reached Approved or later). Jobs with no source recorded are kept apart so old jobs
// don't drag any real source down; `coverage` says how much of the picture is filled in.
export function leadSourceReport(jobs, stages) {
  const order = stages.map(s => s.id);
  const wonIdx = order.indexOf(WON_FROM_STAGE);
  const isWon = j => order.indexOf(j.stage) >= wonIdx;
  const cost = j => Math.max(0, Number(j.leadCost) || 0);

  const build = (key, label, list) => {
    const won = list.filter(isWon);
    const wonValue = won.reduce((n, j) => n + value(j), 0);
    const spent = list.reduce((n, j) => n + cost(j), 0);
    return {
      key, label, jobs: list.length, won: won.length, wonValue,
      closePct: list.length ? Math.round((won.length / list.length) * 100) : 0,
      avgJob: won.length ? Math.round(wonValue / won.length) : 0,
      spent,
      costPerLead: spent && list.length ? Math.round(spent / list.length) : null,
      costPerSale: spent && won.length ? Math.round(spent / won.length) : null,
      // dollars of closed work per dollar spent; only meaningful when something was spent
      returnPerDollar: spent ? Math.round((wonValue / spent) * 10) / 10 : null,
      list,
    };
  };

  const groups = new Map();
  const unknown = [];
  for (const j of jobs) {
    const src = leadSourceOf(j.leadSource);
    // An id that isn't in the list (older or hand-typed value) still gets its own row.
    const key = src ? src.id : (j.leadSource ? String(j.leadSource) : null);
    if (!key) { unknown.push(j); continue; }
    if (!groups.has(key)) groups.set(key, { label: src ? src.label : String(j.leadSource), list: [] });
    groups.get(key).list.push(j);
  }
  const known = LEAD_SOURCES.map(s => s.id).concat([...groups.keys()].filter(k => !leadSourceOf(k)));
  const rows = [...new Set(known)].filter(k => groups.has(k)).map(k => build(k, groups.get(k).label, groups.get(k).list))
    .sort((a, b) => b.wonValue - a.wonValue || b.jobs - a.jobs);

  // Named people behind referrals / sphere / partners: who actually sends you work.
  const nameKey = t => String(t || "").trim().toLowerCase().replace(/\s+/g, " ");
  const people = new Map();
  for (const j of jobs) {
    const k = nameKey(j.leadSourceDetail);
    if (!k || !["customer_referral", "sphere", "partner", "word_of_mouth"].includes(j.leadSource)) continue;
    const p = people.get(k) || { name: String(j.leadSourceDetail).trim(), jobs: 0, won: 0, wonValue: 0 };
    p.jobs += 1;
    if (isWon(j)) { p.won += 1; p.wonValue += value(j); }
    people.set(k, p);
  }
  const topPeople = [...people.values()].sort((a, b) => b.wonValue - a.wonValue || b.jobs - a.jobs).slice(0, 10);

  return {
    rows, topPeople,
    notRecorded: unknown.length ? build("none", NOT_RECORDED, unknown) : null,
    recorded: jobs.length - unknown.length,
    total: jobs.length,
    coverage: jobs.length ? Math.round(((jobs.length - unknown.length) / jobs.length) * 100) : 0,
  };
}
