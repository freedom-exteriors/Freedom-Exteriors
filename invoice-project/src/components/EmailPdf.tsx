"use client";
import { useEffect, useState } from "react";
import type { EmailText } from "@/lib/emailText";

interface Props {
  /** Same-origin URL that returns the PDF. */
  pdfUrl: string;
  fileName: string;
  message: EmailText;
  /** Called after the share menu reports the PDF was sent somewhere. */
  onShared?: () => void;
}

function download(file: File) {
  const url = URL.createObjectURL(file);
  const a = document.createElement("a");
  a.href = url;
  a.download = file.name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/**
 * "Email PDF": hands the PDF to the phone's/computer's share menu so it goes
 * out from Nick's own email app (his Sent folder, replies come to him).
 * Where a browser can't share files, it downloads the PDF and opens a new
 * email with the subject and message filled in, to attach it by hand.
 *
 * The PDF is fetched when the page opens, because browsers (Safari
 * especially) only allow the share menu straight after a tap.
 */
export function EmailPdf({ pdfUrl, fileName, message, onShared }: Props) {
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");

  useEffect(() => {
    let cancelled = false;
    setFile(null);
    fetch(pdfUrl, { cache: "no-store" })
      .then(async (r) => {
        if (r.status === 401) {
          window.location.href = "/login";
          return;
        }
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? `PDF failed (${r.status})`);
        const blob = await r.blob();
        if (!cancelled) setFile(new File([blob], fileName, { type: "application/pdf" }));
      })
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      cancelled = true;
    };
  }, [pdfUrl, fileName]);

  async function email() {
    if (!file) return;
    setError("");
    setNote("");
    const data = { files: [file], title: message.subject, text: `${message.body}` };
    if (typeof navigator.canShare === "function" && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share(data);
        onShared?.();
        return;
      } catch (e) {
        if (e instanceof DOMException && e.name === "AbortError") return; // closed the menu
        if (e instanceof DOMException && e.name === "NotAllowedError") {
          setNote("Your browser blocked the share menu. Tap Email PDF once more.");
          return;
        }
        // Anything else: fall through to download + new email.
      }
    }
    download(file);
    window.location.href = `mailto:?subject=${encodeURIComponent(message.subject)}&body=${encodeURIComponent(message.body)}`;
    setNote(`The PDF (${file.name}) was downloaded and a new email opened. Attach the PDF from your Downloads folder (drag it into the email), add the customer's address, and send.`);
  }

  return (
    <>
      <button disabled={!file} onClick={email} title={file ? undefined : "Preparing the PDF…"}>
        {file ? "Email PDF" : error ? "Email PDF (unavailable)" : "Preparing PDF…"}
      </button>
      <button className="secondary" disabled={!file} onClick={() => file && download(file)}>Download PDF</button>
      {error && <div className="alert error small" style={{ flexBasis: "100%", marginBottom: 0 }}>{error}</div>}
      {note && <div className="alert ok small" style={{ flexBasis: "100%", marginBottom: 0 }}>{note}</div>}
    </>
  );
}
