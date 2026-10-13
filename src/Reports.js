import { useMemo } from "react";
import { buildReports } from "./reportCalc";

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

export default function Reports({ jobs, stages, isAdmin, isMobile, onOpen }) {
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
