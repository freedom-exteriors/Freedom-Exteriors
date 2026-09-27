import { useState, type FormEvent } from "react";
import { api } from "../lib/api";
import { useAction, useLoad } from "../lib/hooks";
import type { Goal } from "../lib/types";
import { useWorkspace } from "../components/WorkspaceLayout";
import { fmt } from "../lib/dates";

export function GoalsPage() {
  const { ws, base, can } = useWorkspace();
  const goals = useLoad(() => api.get<Goal[]>(`${base}/goals`), [base]);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ title: "", horizon: "short_term", participantId: "", targetDate: "", milestones: "" });
  const act = useAction();

  const create = async (e: FormEvent) => {
    e.preventDefault();
    const ok = await act.run(() =>
      api.post(`${base}/goals`, {
        title: form.title,
        horizon: form.horizon,
        participantId: form.participantId || null,
        targetDate: form.targetDate || null,
        milestones: form.milestones.split("\n").map((s) => s.trim()).filter(Boolean),
      }),
    );
    if (ok) {
      setAdding(false);
      setForm({ title: "", horizon: "short_term", participantId: "", targetDate: "", milestones: "" });
      void goals.reload();
    }
  };
  const toggle = async (id: string, done: boolean) => {
    await act.run(() => api.patch(`${base}/tasks/${id}`, { completed: !done }));
    void goals.reload();
  };
  const setStatus = async (g: Goal, status: string) => {
    await act.run(() => api.patch(`${base}/goals/${g.id}`, { status }));
    void goals.reload();
  };
  const section = (horizon: Goal["horizon"], title: string) => {
    const list = (goals.data ?? []).filter((g) => g.horizon === horizon);
    return (
      <div>
        <h2>{title}</h2>
        {list.length === 0 && <p className="muted">None yet.</p>}
        <div className="goals">
          {list.map((g) => (
            <div key={g.id} className={`card goal ${g.status}`}>
              <div className="row between">
                <b>{g.title}</b>
                {g.status === "achieved" ? <span className="pill ok">achieved</span> : g.participant ? <span className="pill" style={{ borderColor: g.participant.color }}>{g.participant.name}</span> : <span className="pill">everyone</span>}
              </div>
              {g.targetDate && <div className="muted small">by {fmt(g.targetDate, "UTC", { month: "short", day: "numeric", year: "numeric" })}</div>}
              <div className="progress" aria-label={`${g.progress.percent}% done`}><i style={{ width: `${g.progress.percent}%` }} /></div>
              <div className="muted small">{g.progress.done} of {g.progress.total} steps</div>
              <ul className="items">
                {g.milestones.map((m) => (
                  <li key={m.id} className="item">
                    <input type="checkbox" checked={!!m.completedAt} disabled={!can.edit} onChange={() => toggle(m.id, !!m.completedAt)} aria-label={m.title} />
                    <div className="grow">{m.completedAt ? <s>{m.title}</s> : m.title}</div>
                  </li>
                ))}
              </ul>
              {can.edit && g.status === "active" && <button className="ghost small" onClick={() => setStatus(g, "achieved")}>Mark achieved 🎉</button>}
            </div>
          ))}
        </div>
      </div>
    );
  };
  return (
    <section>
      <div className="toolbar">
        <h2>Goals</h2>
        {can.edit && <button className="primary" onClick={() => setAdding(!adding)}>{adding ? "Cancel" : "+ New goal"}</button>}
      </div>
      {adding && (
        <form className="card stack" onSubmit={create}>
          <label>Goal<input required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Clean out the garage" /></label>
          <div className="row wrap">
            <label>Timeframe
              <select value={form.horizon} onChange={(e) => setForm({ ...form, horizon: e.target.value })}>
                <option value="short_term">Short term</option>
                <option value="long_term">Long term</option>
              </select>
            </label>
            <label>For
              <select value={form.participantId} onChange={(e) => setForm({ ...form, participantId: e.target.value })}>
                <option value="">Everyone</option>
                {ws.participants.filter((p) => !p.linkedWorkspaceId).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </label>
            <label>By<input type="date" value={form.targetDate} onChange={(e) => setForm({ ...form, targetDate: e.target.value })} /></label>
          </div>
          <label>Steps <span className="muted">(one per line)</span><textarea rows={4} value={form.milestones} onChange={(e) => setForm({ ...form, milestones: e.target.value })} /></label>
          <button className="primary" disabled={act.busy}>Create</button>
        </form>
      )}
      {act.error && <p className="error">{act.error}</p>}
      {section("short_term", "Short term")}
      {section("long_term", "Long term")}
    </section>
  );
}
