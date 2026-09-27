import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import type { Notification } from "../lib/types";

export function Bell() {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<{ unreadCount: number; notifications: Notification[] }>({ unreadCount: 0, notifications: [] });
  const nav = useNavigate();
  const load = () => api.get<typeof data>("/me/notifications").then(setData).catch(() => {});
  useEffect(() => {
    void load();
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, []);
  const openItem = async (n: Notification) => {
    setOpen(false);
    if (!n.readAt) await api.post("/me/notifications/read", { ids: [n.id] }).catch(() => {});
    void load();
    if (n.url) nav(n.url);
  };
  return (
    <div className="bell">
      <button className="ghost" aria-label={`Notifications (${data.unreadCount} unread)`} onClick={() => setOpen(!open)}>
        🔔{data.unreadCount > 0 && <span className="badge">{data.unreadCount}</span>}
      </button>
      {open && (
        <div className="dropdown card">
          <div className="row between">
            <b>Notifications</b>
            {data.unreadCount > 0 && <button className="link" onClick={async () => { await api.post("/me/notifications/read", { all: true }); void load(); }}>Mark all read</button>}
          </div>
          {data.notifications.length === 0 && <p className="muted">Nothing yet.</p>}
          {data.notifications.slice(0, 15).map((n) => (
            <button key={n.id} className={`notif ${n.readAt ? "" : "unread"}`} onClick={() => openItem(n)}>
              <b>{n.title}</b>
              <span>{n.body}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
