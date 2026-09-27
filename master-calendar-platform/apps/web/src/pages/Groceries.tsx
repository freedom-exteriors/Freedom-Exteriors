import { useState, type FormEvent } from "react";
import { api } from "../lib/api";
import { useAction, useLoad } from "../lib/hooks";
import type { ShoppingItem, ShoppingList } from "../lib/types";
import { useWorkspace } from "../components/WorkspaceLayout";

interface Handoff { retailer: string; cartUrl: string | null; items: { name: string; url: string; kind: string }[] }

export function GroceriesPage() {
  const { base, can } = useWorkspace();
  const lists = useLoad(() => api.get<{ categories: string[]; lists: ShoppingList[] }>(`${base}/shopping-lists`), [base]);
  const [active, setActive] = useState<string | null>(null);
  const current = active ?? lists.data?.lists[0]?.id ?? null;
  const list = lists.data?.lists.find((l) => l.id === current);
  const items = useLoad(() => (current ? api.get<{ items: ShoppingItem[] }>(`${base}/shopping-lists/${current}/items`) : Promise.resolve({ items: [] })), [base, current]);
  const [name, setName] = useState("");
  const [category, setCategory] = useState("");
  const [handoff, setHandoff] = useState<Handoff | null>(null);
  const act = useAction();
  const canAdd = can.edit || list?.viewerCanAdd;
  const L = `${base}/shopping-lists/${current}`;

  const refresh = () => {
    void items.reload();
    void lists.reload();
  };
  const add = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    if (await act.run(() => api.post(`${L}/items`, { name, category: category || null }))) {
      setName("");
      refresh();
    }
  };
  const check = async (i: ShoppingItem) => {
    await act.run(() => api.patch(`${L}/items/${i.id}`, { checked: !i.checked }));
    refresh();
  };
  const staple = async (i: ShoppingItem) => {
    await act.run(() => api.patch(`${L}/items/${i.id}`, { isStaple: !i.isStaple }));
    refresh();
  };
  const bulk = async (path: string) => {
    await act.run(() => api.post(`${L}/${path}`));
    refresh();
  };
  const send = async (retailer: string) => {
    await act.run(async () => setHandoff(await api.get<Handoff>(`${L}/handoff?retailer=${retailer}`)));
  };

  const open = (items.data?.items ?? []).filter((i) => !i.checked);
  const got = (items.data?.items ?? []).filter((i) => i.checked);
  const groups = new Map<string, ShoppingItem[]>();
  for (const i of open) groups.set(i.category ?? "Other", [...(groups.get(i.category ?? "Other") ?? []), i]);

  return (
    <section>
      <div className="subtabs">
        {lists.data?.lists.map((l) => (
          <button key={l.id} className={l.id === current ? "on" : ""} onClick={() => { setActive(l.id); setHandoff(null); }}>
            {l.name} {l.openCount > 0 && <span className="count">{l.openCount}</span>}
          </button>
        ))}
      </div>
      {canAdd && (
        <form className="add-row" onSubmit={add}>
          <input aria-label="Item" placeholder="Add an item…" value={name} onChange={(e) => setName(e.target.value)} />
          <select aria-label="Aisle" value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="">Aisle</option>
            {lists.data?.categories.map((c) => <option key={c}>{c}</option>)}
          </select>
          <button className="primary" disabled={act.busy}>Add</button>
        </form>
      )}
      {act.error && <p className="error">{act.error}</p>}

      {[...groups].map(([cat, list]) => (
        <div key={cat} className="aisle">
          <h3>{cat}</h3>
          <ul className="items">
            {list.map((i) => (
              <li key={i.id} className="item">
                <input type="checkbox" checked={false} disabled={!canAdd} onChange={() => check(i)} aria-label={`Got ${i.name}`} />
                <div className="grow">{i.name}{i.quantity && <span className="muted"> · {i.quantity}</span>}{i.addedBy && <span className="muted small"> — {i.addedBy}</span>}</div>
                {can.edit && <button className={`ghost star ${i.isStaple ? "on" : ""}`} title="Staple: stays on the list after you buy it" aria-label="Staple" onClick={() => staple(i)}>★</button>}
              </li>
            ))}
          </ul>
        </div>
      ))}
      {open.length === 0 && !items.loading && <p className="muted empty">List is empty.</p>}

      {got.length > 0 && (
        <details className="done">
          <summary>In the cart ({got.length})</summary>
          <ul className="items">
            {got.map((i) => (
              <li key={i.id} className="item done">
                <input type="checkbox" checked disabled={!canAdd} onChange={() => check(i)} aria-label={`Put back ${i.name}`} />
                <div className="grow"><s>{i.name}</s>{i.isStaple && <span className="muted small"> ★ staple</span>}</div>
              </li>
            ))}
          </ul>
        </details>
      )}

      <div className="row wrap actions">
        {can.edit && <button onClick={() => bulk("clear-checked")}>Clear bought items</button>}
        {canAdd && <button onClick={() => bulk("restock-staples")}>Restock staples</button>}
        <span className="spacer" />
        <button onClick={() => send("amazon")}>Send to Amazon</button>
        <button onClick={() => send("target")}>Target</button>
        <button onClick={() => send("walmart")}>Walmart</button>
      </div>
      {handoff && (
        <div className="card handoff">
          <div className="row between"><b>Shop at {handoff.retailer[0]!.toUpperCase() + handoff.retailer.slice(1)}</b><button className="ghost" onClick={() => setHandoff(null)}>✕</button></div>
          {handoff.cartUrl && <p><a className="button primary" href={handoff.cartUrl} target="_blank" rel="noreferrer">Add matched items to Amazon cart</a></p>}
          <ul className="links">
            {handoff.items.map((i) => <li key={i.name}><a href={i.url} target="_blank" rel="noreferrer">{i.name}</a> <span className="muted small">{i.kind === "search" ? "search" : "product"}</span></li>)}
          </ul>
          {handoff.retailer === "target" && <p className="muted small">Add to your Target cart, then choose Order Pickup or Drive Up at checkout.</p>}
        </div>
      )}
    </section>
  );
}
