// Pure number-crunching for the Reports tab. No React here so it can be tested.
import { calcCommission } from "./CommissionWorkbook";
import { roofMeasurements } from "./measurements";
import { measuredPitch } from "./gbbMeasured";

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

export function buildReports(rawJobs, stages, now = Date.now()) {
  // A lead marked No Damage never had anything to close — it's excluded from every
  // report here (stage counts, pipeline value, rep close %) rather than counting
  // against a rep as an unclosed job forever.
  const jobs = rawJobs.filter(j => !j.noDamage);
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
