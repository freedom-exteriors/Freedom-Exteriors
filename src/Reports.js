import { useMemo, useState } from "react";
import { buildReports, solarAccuracy, leadSourceReport } from "./reportCalc";
import { roofMeasurements } from "./measurements";

const GOLD = "#e8a820"; const PANEL = "#0f1923"; const PANEL2 = "#162030";
const BORDER = "#1e3048"; const TEXT = "#e2eaf4"; const MUTED = "#6b8099"; const GREEN = "#10b981"; const RED = "#f87171";

const money = n => "$" + Math.round(Number(n) || 0).toLocaleString("en-US");

function Card({ title, hint, children }) {
  return (
    <div style={{ background:PANEL, border:`1px solid ${BORDER}`, borderRadius:10, padding:16, marginBottom:14 }}>
      <div style={{ fontFamily:"'Barlow Condensed',sans-serif", fontWeight:800, fontSize:15, letterSpacing:1, textTransform:"uppercase", color:GOLD }}>{title}</div>
      {hint && <div style={{ fontSize:11, color:MUTED, marginTop:2 }}>{hint}</div>}
      <div style={{ marginTop:12 }}>{children}</div>
    </div>
  );
}

function Tile({ label, value, color }) {
  return (
    <div style={{ background:PANEL2, border:`1px solid ${BORDER}`, borderRadius:8, padding:"12px 14px", flex:"1 1 140px" }}>
      <div style={{ fontSize:10, color:MUTED, textTransform:"uppercase", letterSpacing:1 }}>{label}</div>
      <div style={{ fontSize:22, fontWeight:800, color:color || TEXT, marginTop:4 }}>{value}</div>
    </div>
  );
}

function Empty({ children }) { return <div style={{ color:MUTED, fontSize:13 }}>{children}</div>; }

function JobRow({ job, right, sub, onOpen }) {
  return (
    <div onClick={() => onOpen(job)} style={{ display:"flex", justifyContent:"space-between", gap:10, padding:"9px 0", borderBottom:`1px solid ${BORDER}`, cursor:"pointer" }}>
      <div style={{ minWidth:0 }}>
        <div style={{ fontSize:13, fontWeight:600, color:TEXT, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{job.name || "(no name)"}</div>
        <div style={{ fontSize:11, color:MUTED }}>{sub}</div>
      </div>
      <div style={{ fontSize:13, fontWeight:700, textAlign:"right", flexShrink:0 }}>{right}</div>
    </div>
  );
}

const pct1 = n => `${n > 0 ? "+" : ""}${n.toFixed(1)}%`;

function SolarCard({ jobs, onOpen, onBackfill }) {
  const acc = useMemo(() => solarAccuracy(jobs), [jobs]);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const missing = jobs.filter(j => !j.solarEstimate && roofMeasurements(j) && j.address && j.city && j.state).length;

  const run = async () => {
    setBusy(true); setNote("");
    try {
      const { done, failed } = await onBackfill();
      setNote(`Checked ${done} job${done === 1 ? "" : "s"}${failed ? `, ${failed} couldn't be found by Google` : ""}.`);
    } catch (e) { setNote("Something went wrong — try again."); }
    setBusy(false);
  };

  return (
    <Card title="Google Solar vs real measurement" hint="How far the quick-quote roof size runs from a Hover/EagleView report, on jobs that have both. Positive = Solar measured too big.">
      {acc.n === 0 ? <Empty>No jobs have both a Solar reading and a measurement report yet.</Empty> : (
        <>
          <div style={{ display:"flex", gap:10, flexWrap:"wrap", marginBottom:12 }}>
            <Tile label="Jobs compared" value={acc.n} />
            <Tile label="Typical miss" value={`${acc.medianAbs.toFixed(1)}%`} color={acc.medianAbs <= 10 ? GREEN : GOLD} />
            <Tile label="Within 10%" value={`${acc.within10}%`} color={acc.within10 >= 70 ? GREEN : GOLD} />
            <Tile label="Runs high or low" value={pct1(acc.bias)} />
          </div>
          <div style={{ fontSize:12, color:MUTED, marginBottom:10 }}>
            {acc.n < 10 ? `Only ${acc.n} job${acc.n === 1 ? "" : "s"} so far — treat this as a hint, not a rule. ` : ""}
            Suggested quote range: about ±{Math.max(5, Math.ceil(acc.p80Abs))}% (covers 8 in 10 of these jobs).
          </div>
          {acc.rows.slice(0, 12).map(x => (
            <JobRow key={x.job.id} job={x.job} onOpen={onOpen}
              sub={`Solar ${Math.round(x.solar).toLocaleString()} vs measured ${Math.round(x.real).toLocaleString()} sq ft${x.pitchDiff != null ? ` · pitch ${x.pitchDiff > 0 ? "+" : ""}${x.pitchDiff.toFixed(0)}/12` : ""}${x.lowConfidence ? " · low-confidence imagery" : ""}`}
              right={<span style={{ color:Math.abs(x.errPct) <= 10 ? GREEN : Math.abs(x.errPct) <= 20 ? GOLD : RED }}>{pct1(x.errPct)}</span>} />
          ))}
        </>
      )}
      {missing > 0 && (
        <div style={{ marginTop:12 }}>
          <button onClick={run} disabled={busy} style={{ background:busy ? PANEL2 : "#1a9e9922", border:`1px solid ${busy ? BORDER : "#1a9e99"}`, color:busy ? MUTED : "#1a9e99", borderRadius:7, padding:"9px 14px", fontSize:13, fontWeight:700, cursor:busy ? "default" : "pointer", fontFamily:"inherit" }}>
            {busy ? "Checking… (this takes a moment)" : `Run Solar on ${missing} past job${missing === 1 ? "" : "s"} with a report`}
          </button>
          <div style={{ fontSize:11, color:MUTED, marginTop:6 }}>Costs a few cents per job on your Google account.</div>
        </div>
      )}
      {note && <div style={{ fontSize:12, color:TEXT, marginTop:8 }}>{note}</div>}
    </Card>
  );
}

function LeadSourceCard({ jobs, stages }) {
  const ls = useMemo(() => leadSourceReport(jobs, stages), [jobs, stages]);
  const all = ls.notRecorded ? [...ls.rows, ls.notRecorded] : ls.rows;
  const anyCost = ls.rows.some(x => x.spent > 0);
  const maxWon = Math.max(1, ...ls.rows.map(x => x.wonValue));
  const best = ls.rows.filter(x => x.jobs >= 3).sort((a, b) => b.closePct - a.closePct || b.wonValue - a.wonValue)[0];
  const th = { padding:"4px 8px", whiteSpace:"nowrap" };
  const td = { padding:"8px", whiteSpace:"nowrap" };
  return (
    <Card title="Lead sources — what works" hint="Closed = job reached Approved or later. Close % = closed ÷ all leads from that source. Biggest closed dollars first.">
      {ls.total === 0 ? <Empty>No jobs yet.</Empty> : (
        <>
          <div style={{ fontSize:12, color: ls.coverage >= 80 ? MUTED : GOLD, marginBottom:10 }}>
            {ls.recorded} of {ls.total} jobs have a lead source ({ls.coverage}%).
            {ls.coverage < 80 ? " Fill in the rest (open a job → Edit → Lead Source) before trusting the numbers." : ""}
            {best ? ` Best close rate so far: ${best.label} at ${best.closePct}% (${best.won} of ${best.jobs}).` : ""}
            {ls.rows.some(x => x.jobs < 5) ? " Sources with only a few jobs are a hint, not a rule." : ""}
          </div>
          {ls.rows.length === 0 ? <Empty>No job has a lead source yet. Pick one when you add or edit a job.</Empty> : (
            <div style={{ overflowX:"auto" }}>
              <table style={{ width:"100%", borderCollapse:"collapse", fontSize:13 }}>
                <thead><tr style={{ color:MUTED, fontSize:10, textTransform:"uppercase", letterSpacing:1, textAlign:"right" }}>
                  <th style={{ ...th, textAlign:"left" }}>Source</th><th style={th}>Leads</th><th style={th}>Closed</th><th style={th}>Close %</th>
                  <th style={th}>Closed $</th><th style={th}>Avg job</th>
                  {anyCost && <><th style={th}>Spent</th><th style={th}>Cost / sale</th><th style={th}>$ back per $1</th></>}
                </tr></thead>
                <tbody>{all.map(x => (
                  <tr key={x.key} style={{ textAlign:"right", borderTop:`1px solid ${BORDER}`, opacity: x.key === "none" ? 0.7 : 1 }}>
                    <td style={{ ...td, textAlign:"left", fontWeight:600 }}>
                      {x.label}
                      {x.key !== "none" && <div style={{ background:PANEL2, borderRadius:3, height:4, marginTop:4, width:120 }}><div style={{ background:GOLD, height:4, borderRadius:3, width:`${(x.wonValue / maxWon) * 100}%` }} /></div>}
                    </td>
                    <td style={td}>{x.jobs}</td><td style={td}>{x.won}</td>
                    <td style={{ ...td, fontWeight:700, color: x.key === "none" ? TEXT : x.closePct >= 40 ? GREEN : x.closePct >= 20 ? GOLD : RED }}>{x.closePct}%</td>
                    <td style={td}>{money(x.wonValue)}</td><td style={td}>{money(x.avgJob)}</td>
                    {anyCost && <>
                      <td style={td}>{x.spent ? money(x.spent) : "—"}</td>
                      <td style={td}>{x.costPerSale != null ? money(x.costPerSale) : "—"}</td>
                      <td style={{ ...td, fontWeight:700, color: x.returnPerDollar == null ? MUTED : x.returnPerDollar >= 10 ? GREEN : x.returnPerDollar >= 3 ? GOLD : RED }}>{x.returnPerDollar != null ? `$${x.returnPerDollar}` : "—"}</td>
                    </>}
                  </tr>
                ))}</tbody>
              </table>
            </div>
          )}
          {ls.topPeople.length > 0 && (
            <div style={{ marginTop:16 }}>
              <div style={{ fontSize:11, color:MUTED, textTransform:"uppercase", letterSpacing:1, marginBottom:4 }}>Who sends you work (referrals, sphere, partners, word of mouth)</div>
              {ls.topPeople.map(p => (
                <div key={p.name} style={{ display:"flex", justifyContent:"space-between", gap:10, padding:"7px 0", borderBottom:`1px solid ${BORDER}`, fontSize:13 }}>
                  <div style={{ fontWeight:600 }}>{p.name}</div>
                  <div style={{ color:MUTED }}>{p.jobs} lead{p.jobs === 1 ? "" : "s"} · {p.won} closed · <span style={{ color:TEXT, fontWeight:700 }}>{money(p.wonValue)}</span></div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </Card>
  );
}

export default function Reports({ jobs, stages, isAdmin, isMobile, onOpen, onBackfillSolar }) {
  const r = useMemo(() => buildReports(jobs, stages), [jobs, stages]);
  const maxCount = Math.max(1, ...r.byStage.map(s => s.count));

  return (
    <div style={{ padding:isMobile?8:16, maxWidth:900, margin:"0 auto" }}>
      <div style={{ fontFamily:"'Barlow Condensed',sans-serif", fontWeight:800, fontSize:22, letterSpacing:1, marginBottom:14 }}>📊 Reports</div>

      <div style={{ display:"flex", gap:10, flexWrap:"wrap", marginBottom:14 }}>
        <Tile label="Open jobs" value={r.totals.open} />
        <Tile label="Open pipeline value" value={money(r.totals.pipelineValue)} color={GOLD} />
        <Tile label="Installed, not yet paid" value={money(r.totals.owed)} color={r.totals.owed > 0 ? RED : GREEN} />
        <Tile label="Estimates waiting 7+ days" value={r.staleEstimates.length} color={r.staleEstimates.length ? RED : GREEN} />
      </div>

      <Card title="Jobs by stage" hint="Avg days = how long jobs currently in that stage have been sitting there.">
        {r.byStage.map(s => (
          <div key={s.id} style={{ display:"flex", alignItems:"center", gap:10, padding:"5px 0" }}>
            <div style={{ width:isMobile?110:170, fontSize:12, color:TEXT, flexShrink:0 }}>{s.icon} {s.label}</div>
            <div style={{ flex:1, background:PANEL2, borderRadius:4, height:14 }}>
              <div style={{ width:`${(s.count / maxCount) * 100}%`, background:s.color, height:14, borderRadius:4, minWidth:s.count ? 4 : 0 }} />
            </div>
            <div style={{ width:28, textAlign:"right", fontWeight:700, fontSize:13 }}>{s.count}</div>
            {!isMobile && <div style={{ width:90, textAlign:"right", fontSize:12, color:MUTED }}>{money(s.value)}</div>}
            <div style={{ width:isMobile?40:60, textAlign:"right", fontSize:12, color:s.avgDays > 14 ? RED : MUTED }}>{s.avgDays == null ? "" : `${s.avgDays}d`}</div>
          </div>
        ))}
      </Card>

      <Card title="Rep performance" hint="Closed = job reached Approved or later. Closing % = closed ÷ all jobs assigned.">
        {r.repRows.length === 0 ? <Empty>No jobs yet.</Empty> : (
          <div style={{ overflowX:"auto" }}>
            <table style={{ width:"100%", borderCollapse:"collapse", fontSize:13 }}>
              <thead><tr style={{ color:MUTED, fontSize:10, textTransform:"uppercase", letterSpacing:1, textAlign:"right" }}>
                <th style={{ textAlign:"left", padding:"4px 0" }}>Rep</th><th>Jobs</th><th>Closed</th><th>Close %</th><th>Closed $</th><th>Avg job</th>
              </tr></thead>
              <tbody>{r.repRows.map(x => (
                <tr key={x.name} style={{ textAlign:"right", borderTop:`1px solid ${BORDER}` }}>
                  <td style={{ textAlign:"left", padding:"8px 0", fontWeight:600 }}>{x.name}</td>
                  <td>{x.jobs}</td><td>{x.won}</td>
                  <td style={{ color:x.closePct >= 40 ? GREEN : x.closePct >= 20 ? GOLD : RED, fontWeight:700 }}>{x.closePct}%</td>
                  <td>{money(x.wonValue)}</td><td>{money(x.avgJob)}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </Card>

      <LeadSourceCard jobs={jobs} stages={stages} />

      {isAdmin && <SolarCard jobs={jobs} onOpen={onOpen} onBackfill={onBackfillSolar} />}

      <Card title="Estimates going stale" hint="Not yet approved, estimate entered, 7+ days in the same stage. Tap to open.">
        {r.staleEstimates.length === 0 ? <Empty>Nothing stale. 👍</Empty> :
          r.staleEstimates.map(({ job, days }) => (
            <JobRow key={job.id} job={job} onOpen={onOpen}
              sub={`${stages.find(s => s.id === job.stage)?.label || job.stage} · ${job.assigned || "Unassigned"}`}
              right={<><div style={{ color:days > 21 ? RED : GOLD }}>{days} days</div><div style={{ fontSize:11, color:MUTED, fontWeight:500 }}>{money(job.estimate?.total)}</div></>} />
          ))}
      </Card>

      <Card title="Money owed (A/R)" hint="Installed but not yet marked Paid in Full. Owed = job total minus deposit paid.">
        {r.receivables.length === 0 ? <Empty>Nothing waiting on payment.</Empty> :
          r.receivables.map(({ job, owed, days }) => (
            <JobRow key={job.id} job={job} onOpen={onOpen}
              sub={`${job.assigned || "Unassigned"}${days != null ? ` · installed ${days} days ago` : ""}`}
              right={<span style={{ color:days > 30 ? RED : TEXT }}>{money(owed)}</span>} />
          ))}
      </Card>

      {isAdmin && (
        <Card title="Job profitability" hint="Net after operating allocation and job costs, as a % of gross. Lowest margin first. From the Commission Workbook.">
          {r.profit.length === 0 ? <Empty>No jobs with a Commission Workbook yet.</Empty> :
            r.profit.slice(0, 15).map(({ job, gross, net, pct }) => (
              <JobRow key={job.id} job={job} onOpen={onOpen}
                sub={`Gross ${money(gross)} · net ${money(net)}`}
                right={<span style={{ color:pct >= 35 ? GREEN : pct >= 20 ? GOLD : RED }}>{pct}%</span>} />
            ))}
        </Card>
      )}
      <div style={{ height:30 }} />
    </div>
  );
}
