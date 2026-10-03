"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { EstimateBuilder, emptyEstimate } from "@/components/EstimateBuilder";
import type { EstimateFormInput, PriceBookItem } from "@/lib/estimate";
import { api } from "@/lib/clientApi";

export default function NewEstimatePage() {
  const router = useRouter();
  const [priceBook, setPriceBook] = useState<PriceBookItem[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    api<{ items: PriceBookItem[] }>("/api/price-book").then((r) => setPriceBook(r.items)).catch((e) => setError(e.message));
  }, []);

  async function save(form: EstimateFormInput) {
    setBusy(true);
    setError("");
    try {
      const r = await api<{ id: string; estimateNumber: string; docxError: string | null }>("/api/estimates", { method: "POST", json: form });
      router.push(`/estimates/${r.id}?created=1`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      window.scrollTo(0, document.body.scrollHeight);
      setBusy(false);
    }
  }

  return (
    <>
      <div className="backbar"><Link className="btn secondary" href="/estimates">← Back to estimates</Link></div>
      <h1>New estimate</h1>
      <p className="muted small">The estimate number (FE-EST-YYYY-###) is assigned when you save. You can still edit it afterward.</p>
      {error && <div className="alert error">{error}</div>}
      {!priceBook ? (
        <p className="muted">Loading the price book…</p>
      ) : (
        <>
          <EstimateBuilder initial={emptyEstimate()} priceBook={priceBook} submitLabel="Save estimate" busy={busy} onSubmit={save} />
          {error && <div className="alert error" style={{ marginTop: 12 }}>{error}</div>}
        </>
      )}
    </>
  );
}
