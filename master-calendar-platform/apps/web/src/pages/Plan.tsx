import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import { useAction, useLoad } from "../lib/hooks";
import type { Task } from "../lib/types";
import { useWorkspace } from "../components/WorkspaceLayout";
import { addDays, fmt, fromLocalInput, isoDate, time, toLocalInput, today } from "../lib/dates";

interface PlanResult {
  placements: { taskId: string; title: string; start: string; end: string; reason: string }[];
  unplaced: { taskId: string; title: string; reason: string }[];
  skippedParticipants: string[];
}
const REASON: Record<string, string> = {
  needs_estimate: "add how long it takes",
  no_one_eligible: "nobody who can do it (errands need a driver)",
  no_fitting_gap: "no free time that fits",
};

export function PlanPage() {
  const { ws, base, can } = useWorkspace();
  const tz = ws.timeZone;
  const start = today(tz);
  const end = addDays(start, 7, tz);
  const agenda = useLoad(() => api.get<Task[]>(`${base}/plan?start=${start.start.toISOString()}&end=${end.start.toISOString()}`), [base]);
  const [result, setResult] = useState<PlanResult | null>(null);
  const [moving, setMoving] = useState<string | null>(null);
  const [moveTo, setMoveTo] = useState("");
  const act = useAction();

  const plan = async (scope: "day" | "week") => {
    await act.run(async () => setResult(await api.post<PlanResult>(`${base}/plan`, { scope, date: isoDate(start) })));
    void agenda.reload();
  };
  const schedule = async (t: Task, body: object) => {
    await act.run(() => api.post(`${base}/tasks/${t.id}/schedule`, body));
    setMoving(null);
    void agenda.reload();
  };
  const days = useMemo(() => {
    const m = new Map<string, Task[]>();
    for (const t of agenda.data ?? []) {
      const k = fmt(t.scheduledStart!, tz, { weekday: "long", month: "short", day: "numeric" });
      m.set(k, [...(m.get(k) ?? []), t]);
    }
    return [...m];
  }, [agenda.data, tz]);

  return (
    <section>
      <div className="toolbar">
        <h2>Fit the to-dos around the calendar</h2>
        {can.edit && (
          <div className="row">
            <button className="primary" onClick={() => plan("day")} disabled={act.busy}>Plan today</button>
            <button onClick={() => plan("week")} disabled={act.busy}>Plan this week</button>
          </div>
        )}
      </div>
      <p className="muted">Suggestions go where they make sense: errands next to where you'll already be, home jobs when you're home, within each person's free hours and store hours. Accept the ones you like.</p>
      {act.error && <p className="error">{act.error} {act.error.includes("home address") && <Link to="../settings/people">Set it up →</Link>}</p>}

      {result && (result.unplaced.length > 0 || result.skippedParticipants.length > 0) && (
        <div className="card note">
          <b>Couldn't place {result.unplaced.length}:</b>
          <ul>{result.unplaced.map((u) => <li key={u.taskId}>{u.title} — {REASON[u.reason] ?? u.reason}</li>)}</ul>
          {result.skippedParticipants.length > 0 && <p className="muted small">No home address for: {result.skippedParticipants.join(", ")}.</p>}
        </div>
      )}

      {days.length === 0 && !agenda.loading && <p className="muted empty">Nothing planned yet. {can.edit ? "Add time estimates to to-dos, then press Plan." : ""}</p>}
      {days.map(([day, tasks]) => (
        <div key={day} className="plan-day">
          <h3>{day}</h3>
          {tasks.map((t) => (
            <div key={t.id} className={`plan-item card ${t.scheduleStatus}`}>
              <div className="plan-time">{time(t.scheduledStart!, tz)}<span className="muted">–{time(t.scheduledEnd!, tz)}</span></div>
              <div className="grow">
                <b>{t.title}</b>
                <div className="muted small">
                  {(t.assignedParticipant ?? t.scheduledParticipant)?.name ?? "Anyone"} · {t.scheduleStatus === "accepted" ? "✓ planned" : "suggested"}
                  {t.scheduleReason ? ` · ${t.scheduleReason}` : ""}
                </div>
                {moving === t.id && (
                  <div className="row">
                    <input type="datetime-local" value={moveTo} onChange={(e) => setMoveTo(e.target.value)} aria-label="New time" />
                    <button className="primary" onClick={() => schedule(t, { action: "move", start: fromLocalInput(moveTo, tz) })}>Save</button>
                    <button className="ghost" onClick={() => setMoving(null)}>Cancel</button>
                  </div>
                )}
              </div>
              {can.edit && moving !== t.id && (
                <div className="row">
                  {t.scheduleStatus === "suggested" && <button className="primary" onClick={() => schedule(t, { action: "accept" })}>Accept</button>}
                  <button onClick={() => { setMoving(t.id); setMoveTo(toLocalInput(t.scheduledStart!, tz)); }}>Move</button>
                  <button className="ghost" onClick={() => schedule(t, { action: "dismiss" })}>Dismiss</button>
                </div>
              )}
            </div>
          ))}
        </div>
      ))}
    </section>
  );
}
