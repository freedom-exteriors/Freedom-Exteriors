"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { EstimateBuilder, emptyEstimate } from "@/components/EstimateBuilder";
import type { EstimateFormInput, PriceBookItem } from "@/lib/estimate";
import { api } from "@/lib/clientApi";
import { crmJobFromUrl, customerFromCrm, type CrmJob } from "@/lib/crmClient";

export default function NewEstimatePage() {
  const router = useRouter();
  const [priceBook, setPriceBook] = useState<PriceBookItem[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [initial, setInitial] = useState<EstimateFormInput | null>(null);
  const [crmJob, setCrmJob] = useState<CrmJob | null>(null);

  useEffect(() => {
    api<{ items: PriceBookItem[] }>("/api/price-book").then((r) => setPriceBook(r.items)).catch((e) => setError(e.message));
    // Opened from a CRM job: fill in that customer.
    crmJobFromUrl()
      .then((job) => {
        setCrmJob(job);
        setInitial(job ? { ...emptyEstimate(), ...customerFromCrm(job) } : emptyEstimate());
      })
      .catch((e) => {
        setError(`Couldn't load the CRM job (${e.message}). Starting a blank estimate.`);
        setInitial(emptyEstimate());
      });
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
      {crmJob && <div className="alert ok">Filled in from the CRM job for <strong>{crmJob.name}</strong>.</div>}
      {!priceBook || !initial ? (
        <p className="muted">Loading the price book…</p>
      ) : (
        <>
          <EstimateBuilder initial={initial} priceBook={priceBook} submitLabel="Save estimate" busy={busy} onSubmit={save} />
          {error && <div className="alert error" style={{ marginTop: 12 }}>{error}</div>}
        </>
      )}
    </>
  );
}
