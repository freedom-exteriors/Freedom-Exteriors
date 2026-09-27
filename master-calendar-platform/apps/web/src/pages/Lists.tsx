import { useState, type FormEvent } from "react";
import { api } from "../lib/api";
import { useAction, useLoad } from "../lib/hooks";
import type { Task, TaskList } from "../lib/types";
import { useWorkspace } from "../components/WorkspaceLayout";
import { fmt } from "../lib/dates";

const FROM_CALENDAR = "__calendar";

export function ListsPage() {
  const { ws, base, can } = useWorkspace();
  const lists = useLoad(() => api.get<TaskList[]>(`${base}/task-lists`), [base]);
  const [active, setActive] = useState<string | null>(null);
  const current = active ?? lists.data?.[0]?.id ?? null;
  const list = lists.data?.find((l) => l.id === current) ?? null;
  const tasks = useLoad(
    () => (current ? api.get<Task[]>(`${base}/tasks?status=all&${current === FROM_CALENDAR ? "unlisted=true" : `taskListId=${current}`}`) : Promise.resolve([])),
    [base, current],
  );
  const [title, setTitle] = useState("");
  const add = useAction();
  const canAdd = current !== FROM_CALENDAR && (can.edit || list?.viewerCanAdd);
  const me = ws.myParticipantId;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !current) return;
    if (await add.run(() => api.post(`${base}/tasks`, { title, taskListId: current }))) {
      setTitle("");
      void tasks.reload();
      void lists.reload();
    }
  };
  const toggle = async (t: Task) => {
    await api.patch(`${base}/tasks/${t.id}`, { completed: !t.completedAt }).catch((e) => alert(e.message));
    void tasks.reload();
    void lists.reload();
  };
  const patch = async (t: Task, body: object) => {
    await api.patch(`${base}/tasks/${t.id}`, body).catch((e) => alert(e.message));
    void tasks.reload();
  };
  const newList = async () => {
    const name = prompt("Name the new list");
    if (name) {
      const l = await api.post<TaskList>(`${base}/task-lists`, { name, viewerCanAdd: confirm("Let kids (view-only logins) add to this list?") });
      await lists.reload();
      setActive(l.id);
    }
  };
  const open = (tasks.data ?? []).filter((t) => !t.completedAt);
  const done = (tasks.data ?? []).filter((t) => t.completedAt);
  const tickable = (t: Task) => can.edit || list?.viewerCanAdd || (me !== null && t.assignedParticipant?.id === me);

  return (
    <section>
      <div className="subtabs">
        {lists.data?.map((l) => (
          <button key={l.id} className={l.id === current ? "on" : ""} onClick={() => setActive(l.id)}>
            {l.name} {l.openCount > 0 && <span className="count">{l.openCount}</span>}
          </button>
        ))}
        <button className={current === FROM_CALENDAR ? "on" : ""} onClick={() => setActive(FROM_CALENDAR)}>From the calendar</button>
        {can.edit && <button className="ghost" onClick={newList}>+ New list</button>}
      </div>

      {canAdd && (
        <form className="add-row" onSubmit={submit}>
          <input aria-label="New to-do" placeholder={`Add to ${list?.name ?? "list"}…`} value={title} onChange={(e) => setTitle(e.target.value)} />
          <button className="primary" disabled={add.busy}>Add</button>
        </form>
      )}
      {add.error && <p className="error">{add.error}</p>}
      {current === FROM_CALENDAR && <p className="muted">Created automatically from events (“Who's driving…?”, “Pack uniform…”) and seasonal reminders without a list.</p>}

      <ul className="items">
        {open.map((t) => (
          <li key={t.id} className={`item prio-${t.priority}`}>
            <input type="checkbox" aria-label={`Done: ${t.title}`} checked={false} disabled={!tickable(t)} onChange={() => toggle(t)} />
            <div className="grow">
              <div>{t.title}{t.priority === "high" && <span className="pill warn">soon</span>}</div>
              <div className="muted small">
                {t.assignedParticipant ? t.assignedParticipant.name : "Anyone"}
                {t.dueAt ? ` · due ${fmt(t.dueAt, ws.timeZone, { weekday: "short", month: "short", day: "numeric" })}` : ""}
                {t.estimatedMinutes ? ` · ~${t.estimatedMinutes} min` : ""}
                {t.scheduleStatus && t.scheduledStart ? ` · ${t.scheduleStatus === "accepted" ? "planned" : "suggested"} ${fmt(t.scheduledStart, ws.timeZone, { weekday: "short", hour: "numeric", minute: "2-digit" })}` : ""}
                {t.event ? ` · for “${t.event.title}”` : ""}
              </div>
            </div>
            {can.edit && (
              <div className="item-edit">
                <select aria-label="Who" value={t.assignedParticipant?.id ?? ""} onChange={(e) => patch(t, { assignedParticipantId: e.target.value || null })}>
                  <option value="">Anyone</option>
                  {ws.participants.filter((p) => !p.linkedWorkspaceId).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
                <select aria-label="How long" value={t.estimatedMinutes ?? ""} onChange={(e) => patch(t, { estimatedMinutes: e.target.value ? Number(e.target.value) : null })}>
                  <option value="">How long?</option>
                  {[10, 15, 20, 30, 45, 60, 90, 120, 180].map((m) => <option key={m} value={m}>{m < 60 ? `${m} min` : `${m / 60} h`}</option>)}
                </select>
              </div>
            )}
          </li>
        ))}
        {open.length === 0 && !tasks.loading && <li className="muted empty">Nothing to do here. 🎉</li>}
      </ul>
      {done.length > 0 && (
        <details className="done">
          <summary>Done ({done.length})</summary>
          <ul className="items">
            {done.slice(0, 30).map((t) => (
              <li key={t.id} className="item done">
                <input type="checkbox" checked disabled={!tickable(t)} onChange={() => toggle(t)} aria-label={`Not done: ${t.title}`} />
                <div className="grow"><s>{t.title}</s>{t.completedBy && <span className="muted small"> — {t.completedBy.split("@")[0]}</span>}</div>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
