// pdfExport.js — Freedom Exteriors PDF Export Utility
// Opens a clean white print view in a new tab. On iPad/iPhone, Safari shows "Save to Files" → PDF.
// On desktop, browser print dialog → Save as PDF.

import { TRADES } from "./purchaseAgreementSchema";

const COMPANY = {
  name: "Freedom Exteriors LLC",
  address: "1145 Summit Ave, Mahtomedi, MN 55115",
  phone: "(651) 283-1689",
  license: "License #BC-810020",
  tagline: "Veteran Owned & Operated",
};

const css = `
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: Arial, Helvetica, sans-serif; font-size: 11pt; color: #111; background: #fff; padding: 20px; }
  .page { max-width: 750px; margin: 0 auto; }
  .header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #1a9e99; padding-bottom: 12px; margin-bottom: 18px; }
  .company-name { font-size: 20pt; font-weight: 900; letter-spacing: 1px; color: #111; }
  .company-name span { color: #e8a820; }
  .company-sub { font-size: 8pt; color: #555; margin-top: 2px; }
  .header-right { text-align: right; font-size: 9pt; color: #444; line-height: 1.6; }
  .doc-title { text-align: center; margin-bottom: 18px; }
  .doc-title h1 { font-size: 15pt; font-weight: 900; text-transform: uppercase; letter-spacing: 1px; }
  .doc-title h2 { font-size: 10pt; color: #555; font-weight: 400; margin-top: 4px; }
  .section { margin-bottom: 16px; border: 1px solid #ddd; border-radius: 4px; overflow: hidden; }
  .section-title { background: #f5f5f5; padding: 7px 12px; font-size: 9pt; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; color: #333; border-bottom: 1px solid #ddd; }
  .section-body { padding: 12px; }
  .grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
  .grid3 { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 12px; }
  .field { margin-bottom: 8px; }
  .field-label { font-size: 7.5pt; font-weight: 700; text-transform: uppercase; color: #666; letter-spacing: 0.5px; margin-bottom: 3px; }
  .field-value { font-size: 10.5pt; border-bottom: 1px solid #bbb; padding-bottom: 3px; min-height: 20px; }
  .notice-box { background: #fffbea; border: 1.5px solid #e8a820; border-radius: 4px; padding: 10px 12px; margin-bottom: 12px; font-size: 10pt; line-height: 1.6; }
  .notice-box.teal { background: #f0fafb; border-color: #1a9e99; }
  .notice-box.red { background: #fff5f5; border-color: #f87171; }
  .notice-box.green { background: #f0fdf4; border-color: #10b981; }
  .statutory { background: #f8f8f8; border: 1px solid #ccc; border-radius: 4px; padding: 10px 12px; margin-bottom: 12px; font-size: 10pt; font-weight: 700; line-height: 1.7; }
  .provision { margin-bottom: 8px; font-size: 9.5pt; line-height: 1.6; }
  .provision strong { color: #111; }
  .sig-block { display: grid; grid-template-columns: 1fr auto; gap: 12px; align-items: flex-end; margin-bottom: 16px; padding-bottom: 10px; border-bottom: 1px solid #eee; }
  .sig-block:last-child { border-bottom: none; }
  .sig-image { max-width: 260px; max-height: 80px; border: 1px solid #ddd; border-radius: 3px; display: block; }
  .sig-meta { font-size: 8pt; color: #555; margin-top: 4px; }
  .sig-line { border-bottom: 1px solid #999; min-height: 60px; margin-bottom: 4px; }
  .sig-label { font-size: 8pt; color: #555; }
  .initial-row { display: flex; align-items: flex-start; gap: 12px; padding: 10px 0; border-bottom: 1px solid #eee; }
  .initial-row:last-child { border-bottom: none; }
  .initial-box { width: 70px; flex-shrink: 0; }
  .initial-img { width: 65px; height: 40px; border: 1px solid #ddd; border-radius: 3px; object-fit: contain; background: #fafafa; }
  .initial-empty { width: 65px; height: 40px; border: 1px solid #999; border-radius: 3px; }
  .item-num { font-weight: 700; font-size: 10pt; }
  .item-text { font-size: 9.5pt; line-height: 1.6; }
  .item-title { font-weight: 700; margin-bottom: 2px; }
  .checklist-item { display: flex; align-items: flex-start; gap: 8px; padding: 5px 0; border-bottom: 1px solid #eee; font-size: 10pt; }
  .checklist-item:last-child { border-bottom: none; }
  .check { color: #1a9e99; font-weight: 700; font-size: 11pt; flex-shrink: 0; margin-top: 1px; }
  .copy-divider { border-top: 2px dashed #bbb; margin: 20px 0; padding-top: 14px; }
  .copy-label { background: #f0fafb; border: 1px solid #1a9e99; border-radius: 4px; padding: 6px 12px; font-size: 9pt; font-weight: 700; color: #1a9e99; margin-bottom: 14px; }
  .payment-row { display: grid; grid-template-columns: 30px 1fr 140px; gap: 8px; align-items: center; padding: 5px 0; border-bottom: 1px solid #eee; font-size: 10pt; }
  .payment-row:last-child { border-bottom: none; }
  .footer { margin-top: 24px; padding-top: 10px; border-top: 1px solid #ddd; font-size: 8pt; color: #888; text-align: center; }
  @media print {
    body { padding: 0; }
    .page { max-width: 100%; }
    .no-print { display: none; }
  }
`;

// Everything typed into the CRM is escaped before it goes into the printable
// page (which opens on our own origin), so names like "Smith & Sons" print
// correctly and no text can turn into markup or script.
function escHtml(v) {
  return String(v).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function escDeep(v) {
  if (typeof v === "string") return escHtml(v);
  if (Array.isArray(v)) return v.map(escDeep);
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, escDeep(x)]));
  return v;
}

function wrap(title, body) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>${title} — Freedom Exteriors LLC</title>
  <style>${css}</style>
</head>
<body>
<div class="page">
  <div class="header">
    <div>
      <div class="company-name">FREEDOM <span>EXTERIORS</span></div>
      <div class="company-sub">${COMPANY.tagline} · ${COMPANY.address}</div>
      <div class="company-sub">${COMPANY.phone} · ${COMPANY.license}</div>
    </div>
    <div class="header-right">
      <strong>${title}</strong><br/>
      ${new Date().toLocaleDateString("en-US", { year:"numeric", month:"long", day:"numeric" })}
    </div>
  </div>
  ${body}
  <div class="footer">${COMPANY.name} · ${COMPANY.address} · ${COMPANY.phone} · ${COMPANY.license}</div>
</div>
<script>window.onload = function() { window.print(); }</script>
</body>
</html>`;
}

function sigHtml(sig, label) {
  if (!sig) return `<div class="sig-line"></div><div class="sig-label">${label}</div>`;
  return `
    <div>
      <img src="${sig.image}" class="sig-image" alt="${label}"/>
      <div class="sig-meta">${label}: <strong>${sig.name}</strong> · ${new Date(sig.signedAt).toLocaleString()}</div>
    </div>`;
}

function field(label, value) {
  return `<div class="field"><div class="field-label">${label}</div><div class="field-value">${value || "&nbsp;"}</div></div>`;
}

function openPrint(title, html) {
  const win = window.open("", "_blank");
  if (!win) { alert("Please allow popups for this site to export PDFs."); return; }
  win.document.write(wrap(title, html));
  win.document.close();
}

// ─── Document Generators ────────────────────────────────────────────────────

export function exportContractorAgreement(data, job) {
  data = escDeep(data);
  job = escDeep(job);
  const html = `
    <div class="doc-title"><h1>Inspection / Contingency Agreement</h1></div>
    <div class="section"><div class="section-title">Property Information</div><div class="section-body">
      <div class="grid2">${field("Property Address", data.propertyAddress)}${field("Date of Loss", data.dateOfLoss)}</div>
    </div></div>
    <div class="section"><div class="section-title">Services Provided</div><div class="section-body">
      <div class="notice-box teal"><strong>Homeowner has hired Freedom Exteriors LLC to:</strong><ul style="margin:6px 0 0 16px;line-height:1.8">
        <li>Inspect the roof for signs of damage and provide an expert opinion on its serviceability</li>
        <li>Assist the homeowner in filing an insurance claim</li>
        <li>Provide a written inspection report of the roof condition</li>
        <li>Photograph all damaged areas and supply the insurance carrier with proper documentation</li>
      </ul></div>
      <p style="font-size:9.5pt;color:#555;line-height:1.6">Homeowner agrees that performance of all tasks may not be necessary, and failure to perform any task does not relieve Homeowner of obligations under this contract.</p>
    </div></div>
    <div class="section"><div class="section-title">Insurance Outcomes</div><div class="section-body">
      <div class="notice-box red"><strong>If the Adjuster Denies the Claim:</strong> This contract is immediately null and void. Homeowner shall have no further obligation to Contractor.</div>
      <div class="notice-box green"><strong>If the Adjuster Approves Replacement:</strong> Homeowner agrees Freedom Exteriors LLC shall be hired as the sole contractor for the full amount allowed by the insurance summary. Freedom Exteriors LLC shall not be subjected to competitive bidding.</div>
    </div></div>
    <div class="section"><div class="section-title">Terms</div><div class="section-body">
      <div class="provision"><strong>Deductible.</strong> Homeowner is responsible for paying their full insurance deductible.</div>
      <div class="provision"><strong>Non-Performance Fee.</strong> If Contractor obtains insurance approval and Homeowner elects not to hire Freedom Exteriors LLC, Homeowner shall pay $1,000.00 as consideration for inspection and claims-assistance services, plus all attorney fees and court costs.</div>
      <div class="provision"><strong>Right to Cancel.</strong> Buyer has three (3) business days from this contract date to cancel without penalty.</div>
    </div></div>
    <div class="section"><div class="section-title">Signatures</div><div class="section-body">
      <div class="sig-block">${sigHtml(data.homeownerSignature, "Homeowner Signature")}</div>
      ${data.homeowner2Signature ? `<div class="sig-block">${sigHtml(data.homeowner2Signature, "Co-Owner Signature")}</div>` : ""}
      <div class="sig-block">${sigHtml(data.repSignature, "Freedom Exteriors LLC Representative")}</div>
    </div></div>`;
  openPrint("Inspection / Contingency Agreement", html);
}

export function exportInsuranceContract(data, job) {
  data = escDeep(data);
  job = escDeep(job);
  const html = `
    <div class="doc-title"><h1>Residential Roofing Contract — Insurance</h1><h2>Contract No. ${data.contractNo || ""}</h2></div>
    <div class="section"><div class="section-title">Owner & Project Information</div><div class="section-body">
      <div class="grid2">${field("Owner Name(s)", data.ownerNames)}${field("Email", data.ownerEmail)}</div>
      <div class="grid2">${field("Address", data.ownerAddress)}${field("City, State, Zip", data.ownerCityStateZip)}</div>
      <div class="grid2">${field("Phone", data.ownerPhone)}${field("Alt. Phone", data.ownerAltPhone)}</div>
    </div></div>
    <div class="section"><div class="section-title">Scope of Work</div><div class="section-body">
      <div class="field"><div class="field-label">a. Description of work and materials</div><div class="field-value" style="min-height:60px;white-space:pre-wrap">${data.description || "&nbsp;"}</div></div>
      <div class="field"><div class="field-label">b. Areas NOT worked on</div><div class="field-value" style="min-height:30px">${data.exclusions || "&nbsp;"}</div></div>
      <div class="statutory">INSURANCE: THE ONLY COST TO THE PROPERTY OWNER IS THEIR DEDUCTIBLE, PLUS ANY UPGRADES CHOSEN OR ANY NON-COVERED ITEMS THAT MUST BE REPLACED TO COMPLETE THE REPAIRS. THE CONTRACT BALANCE IS PAID BY THE OWNER'S INSURANCE COMPANY PER FINAL LOSS INVOICE. THIS AGREEMENT IS NULL AND VOID AND DOES NOT OBLIGATE ANY PARTY TO IT SHOULD THE INSURANCE COMPANY REFUSE COVERAGE UNDER THIS CLAIM OR SHOULD THE COVERAGE OFFERED BE INSUFFICIENT FOR CONTRACTOR TO PROPERLY DO THE WORK. OWNER ACKNOWLEDGES CONTRACTOR IS A GENERAL CONTRACTOR AND AS SUCH IS ENTITLED TO OVERHEAD AND PROFIT AS RECOGNIZED UNDER INSURANCE INDUSTRY PRACTICE.</div>
    </div></div>
    <div class="section"><div class="section-title">Payment</div><div class="section-body">
      <div class="grid2">${field("Total Sum", data.totalSum ? "$" + Number(data.totalSum).toLocaleString() : "")}${field("Down Payment", data.downPayment ? "$" + Number(data.downPayment).toLocaleString() : "")}</div>
      <div class="grid2">${field("Approximate Start Date", data.startDate)}${field("Approximate Completion Date", data.completionDate)}</div>
    </div></div>
    <div class="section"><div class="section-title">Required Notices</div><div class="section-body">
      <div class="notice-box"><strong>Right to Cancel.</strong> You, the Buyer, may cancel this transaction at any time prior to midnight of the third business day after the date of this transaction. In addition, if your insurer denies your claim, you may cancel this contract within 72 hours after being notified of that denial.</div>
      <div class="notice-box"><strong>Insurance Deductible — Minn. Stat. § 325E.66.</strong> A residential contractor providing home repair services to be paid from insurance proceeds shall not advertise or promise to pay, directly or indirectly, all or part of any applicable insurance deductible.</div>
    </div></div>
    <div class="section"><div class="section-title">Signatures</div><div class="section-body">
      <div class="sig-block">${sigHtml(data.ownerSignature, "Owner Signature")}</div>
      <div class="sig-block">${sigHtml(data.contractorSignature, "Contractor — Freedom Exteriors LLC")}</div>
    </div></div>`;
  openPrint("Residential Roofing Contract (Insurance)", html);
}

export function exportRetailContract(data, job) {
  data = escDeep(data);
  job = escDeep(job);
  const payments = (data.payments || []).filter(p => p.when || p.amount);
  const html = `
    <div class="doc-title"><h1>Residential Roofing Contract — Retail</h1><h2>Contract No. ${data.contractNo || ""}</h2></div>
    <div class="section"><div class="section-title">Owner & Project Information</div><div class="section-body">
      <div class="grid2">${field("Owner Name(s)", data.ownerNames)}${field("Email", data.ownerEmail)}</div>
      <div class="grid2">${field("Address", data.ownerAddress)}${field("City, State, Zip", data.ownerCityStateZip)}</div>
      <div class="grid2">${field("Phone", data.ownerPhone)}${field("Alt. Phone", data.ownerAltPhone)}</div>
    </div></div>
    <div class="section"><div class="section-title">Scope of Work</div><div class="section-body">
      <p style="font-size:9.5pt;color:#444;line-height:1.6;margin-bottom:10px">I/WE, the Owner(s) of the premises described above, authorize Freedom Exteriors LLC to furnish all materials and labor necessary to roof and/or improve these premises in a good, workmanlike and substantial manner according to the following terms:</p>
      <div class="field"><div class="field-label">a. Description of work and materials</div><div class="field-value" style="min-height:60px;white-space:pre-wrap">${data.description || "&nbsp;"}</div></div>
      <div class="field"><div class="field-label">b. Areas NOT worked on</div><div class="field-value" style="min-height:30px">${data.exclusions || "&nbsp;"}</div></div>
    </div></div>
    <div class="section"><div class="section-title">Payment — c.</div><div class="section-body">
      <div class="grid2">${field("Total Sum", data.totalSum ? "$" + Number(data.totalSum).toLocaleString() : "")}${field("Down Payment", data.downPayment ? "$" + Number(data.downPayment).toLocaleString() : "")}</div>
      ${payments.length ? `<div style="margin-top:10px"><div class="field-label" style="margin-bottom:6px">Payment Schedule</div>
        ${payments.map((p,i) => `<div class="payment-row"><span>${i+1}.</span><span>${p.when||""}</span><span>${p.amount ? "$"+Number(p.amount).toLocaleString() : ""}</span></div>`).join("")}
      </div>` : ""}
      <div class="grid2" style="margin-top:10px">${field("Approximate Start Date", data.startDate)}${field("Approximate Completion Date", data.completionDate)}</div>
    </div></div>
    <div class="section"><div class="section-title">Required Notices</div><div class="section-body">
      <div class="notice-box"><strong>Right to Cancel.</strong> You, the Buyer, may cancel this transaction at any time prior to midnight of the third business day after the date of this transaction. See the attached Notice of Cancellation form.</div>
      <div class="notice-box"><strong>Minnesota Lien Notice — Minn. Stat. § 514.011.</strong> Any person or company supplying labor or materials for this improvement may file a lien against your property if not paid. Under Minnesota law, you have the right to pay such persons directly and deduct that amount from our contract price, or withhold amounts due until 120 days after completion unless we provide a lien waiver.</div>
    </div></div>
    <div class="section"><div class="section-title">Signatures</div><div class="section-body">
      <div class="sig-block">${sigHtml(data.ownerSignature, "Owner Signature")}</div>
      ${data.owner2Signature ? `<div class="sig-block">${sigHtml(data.owner2Signature, "Co-Owner Signature")}</div>` : ""}
      <div class="sig-block">${sigHtml(data.contractorSignature, "Contractor — Freedom Exteriors LLC")}</div>
    </div></div>`;
  openPrint("Residential Roofing Contract (Retail)", html);
}

export function exportPreBuildLetter(data, job) {
  data = escDeep(data);
  job = escDeep(job);
  const PRECAUTIONS = [
    { id:"p1", title:"Clear the Work Area", body:"Move anything not permanently attached away from the work zone — lawn furniture, hanging or potted plants, grills, hoses, and decorations." },
    { id:"p2", title:"Nails and Cleanup", body:"Construction produces thousands of nails. Mow lawn before construction. Check driveway after dumpster removal. Freedom Exteriors LLC is not liable for missed nails." },
    { id:"p3", title:"Protect Valuables Inside the Home", body:"Remove or secure fragile items, wall art, and light fixture covers. Vibrations from construction can cause items to loosen or fall." },
    { id:"p4", title:"Secure Gates and Fences", body:"Check that all gates and fences are closed at the end of each workday." },
    { id:"p5", title:"Satellite Dishes", body:"Freedom Exteriors LLC does not reinstall satellite dishes. Contact your satellite provider for reinstallation after the project." },
    { id:"p6", title:"Attic and Garage Items", body:"Dust and debris may fall through small gaps in decking. Cover or remove stored items and park vehicles outside the garage. Freedom Exteriors LLC is not liable for damage caused by dust or falling debris." },
    { id:"p7", title:"Electricity and Power Use", body:"Crews may need access to exterior outlets. Vibrations may trip breakers or GFI outlets. Freedom Exteriors LLC will not reimburse for electricity used and is not responsible for losses caused by power interruptions. Please unplug anything connected to exterior outlets before work begins." },
    { id:"p8", title:"Landscaping and Exterior Features", body:"While we take great care, construction areas can impact landscaping, lights, and retaining walls. Our crews need full perimeter access." },
  ];
  const html = `
    <div class="doc-title"><h1>Pre-Build Precaution Letter</h1></div>
    <div class="section"><div class="section-title">Homeowner Information</div><div class="section-body">
      <div class="grid2">${field("Name(s)", data.homeownerNames)}${field("Property Address", data.address)}</div>
    </div></div>
    <div class="section"><div class="section-body" style="font-size:9.5pt;color:#444;line-height:1.7">
      Thank you for choosing Freedom Exteriors LLC! Before work begins, please review the following precautions. These guidelines help protect your property and clarify responsibilities during construction.
    </div></div>
    <div class="section"><div class="section-title">Precautions — Homeowner Initials Required</div><div class="section-body">
      ${PRECAUTIONS.map((p,i) => `
        <div class="initial-row">
          <div class="initial-box">
            ${data.initials?.[p.id] ? `<img src="${data.initials[p.id]}" class="initial-img" alt="initials"/>` : `<div class="initial-empty"></div>`}
          </div>
          <div><div class="item-title">${i+1}. ${p.title}</div><div class="item-text">${p.body}</div></div>
        </div>`).join("")}
    </div></div>
    <div class="section"><div class="section-title">Acknowledgement & Signatures</div><div class="section-body">
      <p style="font-size:9.5pt;color:#444;line-height:1.6;margin-bottom:16px">By signing below, you acknowledge that you have read and understand these precautions. <strong>Freedom Exteriors LLC is not responsible for damages resulting from the situations or items listed above.</strong></p>
      <div class="sig-block">${sigHtml(data.homeownerSignature, "Homeowner Signature")}</div>
      ${data.homeowner2Signature ? `<div class="sig-block">${sigHtml(data.homeowner2Signature, "Co-Owner Signature")}</div>` : ""}
      <div class="sig-block">${sigHtml(data.repSignature, "Freedom Exteriors LLC Representative")}</div>
    </div></div>`;
  openPrint("Pre-Build Precaution Letter", html);
}

export function exportLienNotice(data, job) {
  data = escDeep(data);
  job = escDeep(job);
  const html = `
    <div class="doc-title"><h1>Minnesota Mandatory Notice</h1><h2>Per § 514.011 and Housing Statutory Warranty Per § 327A</h2></div>
    <div class="section"><div class="section-title">Project Information</div><div class="section-body">
      <div class="grid2">${field("Project Owner's Name", data.ownerName)}${field("Brief Description of Project", data.projectDescription)}</div>
      <div class="grid2">${field("Project Street Address, City, State, Zip", data.projectAddress)}${field("Contract Date", data.contractDate)}</div>
      <p style="font-size:9.5pt;color:#444;line-height:1.6;margin-top:8px">This is a continuation of that certain CONTRACT briefly described above between Freedom Exteriors LLC and the project owner named above. This is a mandatory notice given according to Minnesota Law (§ 514.011).</p>
    </div></div>
    <div class="section"><div class="section-title">Mandatory Lien Notice — § 514.011</div><div class="section-body">
      <div class="statutory">
        <p style="margin-bottom:10px">(A) ANY PERSON OR COMPANY SUPPLYING LABOR OR MATERIALS FOR THIS IMPROVEMENT TO YOUR PROPERTY MAY FILE A LIEN AGAINST YOUR PROPERTY IF THAT PERSON OR COMPANY IS NOT PAID FOR THE CONTRIBUTIONS.</p>
        <p>(B) UNDER MINNESOTA LAW, YOU HAVE THE RIGHT TO PAY PERSONS WHO SUPPLIED LABOR OR MATERIALS FOR THIS IMPROVEMENT DIRECTLY AND DEDUCT THIS AMOUNT FROM OUR CONTRACT PRICE, OR WITHHOLD THE AMOUNTS DUE THEM FROM US UNTIL 120 DAYS AFTER COMPLETION OF THE IMPROVEMENT UNLESS WE GIVE YOU A LIEN WAIVER SIGNED BY PERSONS WHO SUPPLIED ANY LABOR OR MATERIAL FOR THE IMPROVEMENT AND WHO GAVE YOU TIMELY NOTICE.</p>
      </div>
    </div></div>
    <div class="section"><div class="section-title">Housing Statutory Warranty — § 327A.01 to § 327A.08</div><div class="section-body">
      <div class="provision"><strong>(a)</strong> For home improvement work involving major structural changes or additions: (1) one-year warranty against defects from faulty workmanship or defective materials; and (2) ten-year warranty against major construction defects.</div>
      <div class="provision"><strong>(b)</strong> For installation of plumbing, electrical, heating, or cooling systems: two-year warranty against defects from faulty installation.</div>
      <div class="provision"><strong>(c)</strong> For all other home improvement work: one-year warranty against defects from faulty workmanship or defective materials.</div>
    </div></div>
    <div class="section"><div class="section-title">Acknowledgement</div><div class="section-body">
      <p style="font-size:9.5pt;color:#444;margin-bottom:14px">I acknowledge receipt of this Notice and Warranty by my signature below:</p>
      <div class="sig-block">${sigHtml(data.ownerSignature, "Owner Signature")}</div>
    </div></div>`;
  openPrint("MN Mandatory Lien Notice (§ 514.011)", html);
}

export function exportCancellationNotice(data, job) {
  data = escDeep(data);
  job = escDeep(job);
  const noticeText = `If your insurer denies your claim to pay for goods and services to be provided under this contract, you may cancel the contract by mailing or delivering a signed and dated copy of this cancellation notice or any other written notice to:<br/><br/>
    <strong>Freedom Exteriors LLC<br/>1145 Summit Ave<br/>Mahtomedi, MN 55115</strong><br/><br/>
    at any time within 72 hours after you have been notified that your claim has been denied. If you cancel, any payments made by you under the contract will be returned within ten business days following receipt by the contractor of your cancellation notice.`;

  const copyHtml = (label, sublabel, sig) => `
    <div class="copy-label">${label} — ${sublabel}</div>
    <div class="notice-box"><strong>NOTICE OF CANCELLATION PER MN STATUTES SECTION 326B.811</strong><br/><br/>
    <strong>NOTICE OF CANCELLATION</strong><br/><br/>${noticeText}<br/><br/>
    <strong>I hereby cancel this transaction.</strong></div>
    <div class="sig-block">${sigHtml(sig, "Insured's Signature")}</div>`;

  const html = `
    <div class="doc-title"><h1>Notice of Cancellation</h1><h2>Per MN Statutes Section 326B.811 — Three copies required</h2></div>
    <div class="section"><div class="section-title">Insured Information</div><div class="section-body">
      <div class="grid2">${field("Insured Name", data.insuredName)}${field("Property Address", data.propertyAddress)}</div>
    </div></div>
    ${copyHtml("Copy 1", "Give to Homeowner", data.copy1Signature)}
    <div class="copy-divider">${copyHtml("Copy 2", "Give to Homeowner", data.copy2Signature)}</div>
    <div class="copy-divider">${copyHtml("Copy 3", "Company Records — Keep on File", data.companySignature)}</div>
    <div class="section"><div class="section-body" style="font-size:9.5pt;color:#444;line-height:1.6">
      <strong>Buyer:</strong> Should you wish to exercise your right to cancel, date and sign the above Cancellation Notice not later than midnight of the date shown above and mail it to the contractor at the above address. Keep the bottom copy for your records.
    </div></div>`;
  openPrint("Cancellation Notice (§ 326B.811)", html);
}

export function exportDocsAcknowledgement(data, job) {
  data = escDeep(data);
  job = escDeep(job);
  const docs = [
    "MN Statute 325E.66 — Insurance Deductible Notice",
    "Good Faith Estimate",
    "MN Statute 325F.18 — Urea Formaldehyde Notice",
    "MN Statute 326B.809 — Written Contract and Performance Guidelines",
    "MN Statute 326B.811 — Right to Cancel for Denied Claim",
    "MN Statute 327A — Warranty",
    "General Contractor License #BC-810020",
    "General Liability and Workers Compensation Insurance",
    "Mold Notice",
    "Cancellation Form",
    "Denied Claim Cancellation Form",
  ];
  const html = `
    <div class="doc-title"><h1>Contractor Documents Acknowledgement</h1></div>
    <div class="section"><div class="section-title">Homeowner Information</div><div class="section-body">
      <div class="grid2">${field("Name(s)", data.homeownerName)}${field("Property Address", data.address)}</div>
    </div></div>
    <div class="section"><div class="section-title">Documents Received</div><div class="section-body">
      <p style="font-size:10pt;color:#333;line-height:1.6;margin-bottom:12px">I, <strong>${data.homeownerName || "_________________________"}</strong>, acknowledge and certify that I have received all documentation listed below from Freedom Exteriors LLC:</p>
      ${docs.map(d => `<div class="checklist-item"><span class="check">✓</span><span>${d}</span></div>`).join("")}
    </div></div>
    <div class="section"><div class="section-title">Signatures</div><div class="section-body">
      <div class="sig-block">${sigHtml(data.homeownerSignature, "Homeowner Signature")}</div>
      ${data.homeowner2Signature ? `<div class="sig-block">${sigHtml(data.homeowner2Signature, "Co-Owner Signature")}</div>` : ""}
      <div style="margin-bottom:8px">${field("Rep Printed Name", data.repPrintedName)}</div>
      <div class="sig-block">${sigHtml(data.repSignature, "Freedom Exteriors LLC Representative")}</div>
    </div></div>`;
  openPrint("Contractor Documents Acknowledgement", html);
}

export function exportPurchaseAgreement(data, job) {
  data = escDeep(data);
  job = escDeep(job);
  const trade = TRADES[data.trade] || TRADES.roofing;
  const money = v => (v === "" || v === null || v === undefined || isNaN(v)) ? "" : "$" + Number(v).toLocaleString();

  const rowHtml = (row) => {
    const v = (data.rows || {})[row.key];
    if (row.type === "text") {
      if (!v) return "";
      return `<div class="checklist-item"><span class="item-title" style="min-width:220px">${row.label}:</span><span>${v}</span></div>`;
    }
    if (row.type === "text2") {
      if (!v?.a && !v?.b) return "";
      return `<div class="checklist-item"><span class="item-title" style="min-width:220px">${row.label} / ${row.label2}:</span><span>${v?.a || ""}${v?.a && v?.b ? " / " : ""}${v?.b || ""}</span></div>`;
    }
    const selected = v?.selected || [];
    const details = v?.details || "";
    if (!selected.length && !details) return "";
    return `<div class="checklist-item"><span class="check">✓</span><span><strong>${row.label}:</strong> ${selected.join(", ")}${selected.length && details ? " — " : ""}${details}</span></div>`;
  };

  const sectionsHtml = trade.sections.map(sec => {
    const rows = sec.rows.map(rowHtml).filter(Boolean).join("");
    if (!rows) return "";
    return `<div class="section"><div class="section-title">${sec.title}</div><div class="section-body">${rows}</div></div>`;
  }).join("");

  const html = `
    <div class="doc-title"><h1>Purchase Agreement — ${trade.subtitle}</h1><h2>No. ${data.contractNo || ""} · MN License #BC-810020 · WI Dwelling Contractor License #4811-DCFR</h2></div>
    <div class="section"><div class="section-title">Contract Submitted To</div><div class="section-body">
      <div class="grid2">${field("Customer Name(s)", data.ownerNames)}${field("Email", data.ownerEmail)}</div>
      <div class="grid2">${field("Home Phone", data.ownerHomePhone)}${field("Cell Phone", data.ownerCellPhone)}</div>
      <div class="grid2">${field("Street", data.ownerAddress)}${field("City, State & Zip", data.ownerCityStateZip)}</div>
      ${field("Date", data.date)}
    </div></div>
    ${sectionsHtml}
    ${data.additionalDetails ? `<div class="section"><div class="section-title">Additional Details</div><div class="section-body"><div style="white-space:pre-wrap">${data.additionalDetails}</div></div></div>` : ""}
    <div class="section"><div class="section-title">Payment</div><div class="section-body">
      <div class="grid3">${field("Payment Terms", data.paymentTermsPct ? data.paymentTermsPct + "% down" : "")}${field("Total Price", money(data.totalPrice))}${field("Down Payment", money(data.downPayment))}</div>
      ${field("Down Payment Date", data.downPaymentDate)}
      <p style="font-size:9.5pt;color:#555;line-height:1.6;margin-top:8px">Remaining balance due upon substantial completion. Please make checks payable to Freedom Exteriors LLC. All sales tax included in Total Price.</p>
    </div></div>
    <div class="section"><div class="section-title">Acceptance of Contract</div><div class="section-body">
      <p style="font-size:9.5pt;color:#444;line-height:1.6">By signature below, the proposal prices, specifications and conditions above are hereby accepted. Contractor is authorized to perform the work specified. Payments will be made as outlined above. Terms on the additional pages of this Agreement also form a part of this Agreement and are hereby accepted. Verbal agreements will not be honored, no exceptions.</p>
      <div class="notice-box" style="margin-top:10px"><strong>Right to Cancel.</strong> In the event of a home solicitation sale, you, the buyer, may cancel this purchase at any time prior to midnight of the third business day after the date of this purchase. See the attached Notice of Cancellation form for an explanation of this right. In all other circumstances, this Agreement is binding when signed by you and us.</div>
      <div class="notice-box"><strong>Insurance Claim Denial.</strong> You may cancel this contract at any time within 72 hours after you have been notified that your insurer has denied your claim to pay for the goods and services to be provided under this contract. See the attached Notice of Cancellation per Minn. Stat. § 326B.811.</div>
    </div></div>
    <div class="section"><div class="section-title">Signatures</div><div class="section-body">
      <div class="sig-block">${sigHtml(data.ownerSignature, "Owner Signature")}</div>
      ${data.coOwnerSignature ? `<div class="sig-block">${sigHtml(data.coOwnerSignature, "Co-Owner Signature")}</div>` : ""}
      <div class="sig-block">${sigHtml(data.contractorSignature, "Company Representative")}</div>
    </div></div>
    <div class="section"><div class="section-title">Notice of Cancellation — Per MN Statutes Section 326B.811</div><div class="section-body">
      <p style="font-size:9pt;color:#666;margin-bottom:8px"><em>Give this entire section to the buyer. Keep a signed copy for company records.</em></p>
      <div class="notice-box">If your insurer denies your claim to pay for goods and services to be provided under this contract, you may cancel the contract by mailing or delivering a signed and dated copy of this cancellation notice or any other written notice to:<br/><br/>
      <strong>Freedom Exteriors LLC<br/>1145 Summit Ave<br/>Mahtomedi, MN 55115</strong><br/><br/>
      at any time within 72 hours after you have been notified that your claim has been denied. If you cancel, any payments made by you under the contract will be returned within ten business days following receipt by the contractor of your cancellation notice.<br/><br/>
      <strong>I hereby cancel this transaction.</strong></div>
      <div class="sig-block"><div class="sig-line"></div><div class="sig-label">Date</div></div>
      <div class="sig-block"><div class="sig-line"></div><div class="sig-label">Insured's Signature</div></div>
    </div></div>`;
  openPrint(`Purchase Agreement — ${trade.label}`, html);
}

export function exportCommissionWorkbook(data, job, isParLead) {
  data = escDeep(data);
  job = escDeep(job);
  const fmt = n => isNaN(n)||n===0 ? "$0.00" : (n<0?"-$":"$")+Math.abs(n).toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2});
  const gross = parseFloat(data.grossRevenue)||0;
  const opAlloc = gross*0.15;
  const netRev = gross-opAlloc;
  const costKeys = ["xactimate","permits","roofMaterials","roofLabor","sidingMaterials","sidingLabor","gutterMat","gutterLabor","windows","electrical","dumpster","hoverCost","chargeback","insNegFee","supplementFee","materialReturn","supplyRun","cleanUp","other"];
  const costLabels = ["Xactimate","Permits","Roofing Materials","Roofing Labor","Siding / Wrap Materials","Siding / Wrap Labor","Gutter Materials","Gutter Labor","Windows","Electrical","Dumpster Fees","Hover Cost","Chargeback","Insurance Negotiation Fee","Supplement Negotiation Fee","Material Return Credit (−)","Supply Run (Menards/Home Depot/etc.)","Clean Up","Other"];
  const costs = costKeys.reduce((sum,k,i) => { const v=parseFloat(data[k])||0; return k==="materialReturn"?sum-v:sum+v; },0);
  const commNet = netRev-costs;
  const tier = parseFloat(data.tier)||30;
  const commission = commNet*(tier/100);
  const parFee = isParLead ? commNet * 0.105 : 0;
  const repNet = commission - parFee;
  const finalCommission = isParLead ? repNet : commission;

  const costRows = costKeys.map((k,i) => {
    const v = parseFloat(data[k])||0;
    if (!v) return "";
    return `<tr><td style="padding:4px 8px;font-size:9.5pt;color:#555">${costLabels[i]}</td><td style="padding:4px 8px;font-size:9.5pt;text-align:right;font-family:monospace">${k==="materialReturn"?"−":""} ${fmt(v)}</td></tr>`;
  }).join("");

  const repSplitRows = (data.repSplitActive ? (data.repSplits || []) : []).filter(r => r.name || parseFloat(r.pct)).map(r => {
    const pct = parseFloat(r.pct) || 0;
    const amount = finalCommission * (pct / 100);
    return `<tr><td style="padding:4px 8px;font-size:9.5pt;color:#555">${r.name || "(unnamed)"} (${pct}%)</td><td style="padding:4px 8px;font-size:9.5pt;text-align:right;font-family:monospace">${fmt(amount)}</td></tr>`;
  }).join("");

  const pa = job?.purchaseAgreement;
  const paTrade = pa ? (TRADES[pa.trade] || TRADES.roofing) : null;
  const paSigned = pa && pa.ownerSignature && pa.contractorSignature;

  const html = `
    <div class="doc-title"><h1>Commission Workbook</h1><h2>${job?.name || ""} · ${job?.address || ""}</h2></div>
    ${pa ? `<div class="notice-box teal" style="margin-bottom:14px"><strong>Purchase Agreement on file — ${paTrade.label}.</strong> Total Price ${fmt(parseFloat(pa.totalPrice) || 0)} · ${paSigned ? "Signed" : "Not yet signed"}</div>` : ""}
    <div class="section"><div class="section-title">Step 1 — Job Revenue</div><div class="section-body">
      <table style="width:100%;border-collapse:collapse">
        <tr><td style="padding:4px 8px;font-size:10pt">A. Gross Job Revenue</td><td style="padding:4px 8px;font-size:10pt;text-align:right;font-family:monospace;font-weight:700">${fmt(gross)}</td></tr>
        <tr style="color:#e55"><td style="padding:4px 8px;font-size:10pt">B. Operating Allocation (15%)</td><td style="padding:4px 8px;font-size:10pt;text-align:right;font-family:monospace">− ${fmt(opAlloc)}</td></tr>
        <tr style="border-top:2px solid #ddd;font-weight:700"><td style="padding:6px 8px;font-size:10pt">C. Net Revenue (A − B)</td><td style="padding:6px 8px;font-size:10pt;text-align:right;font-family:monospace">${fmt(netRev)}</td></tr>
      </table>
    </div></div>
    <div class="section"><div class="section-title">Step 2 — Cost of Revenue</div><div class="section-body">
      <table style="width:100%;border-collapse:collapse">
        ${costRows || "<tr><td colspan='2' style='padding:6px 8px;font-size:9.5pt;color:#999'>No costs entered</td></tr>"}
        <tr style="border-top:2px solid #ddd;font-weight:700"><td style="padding:6px 8px;font-size:10pt">T. Total Cost of Revenue</td><td style="padding:6px 8px;font-size:10pt;text-align:right;font-family:monospace">${fmt(costs)}</td></tr>
      </table>
    </div></div>
    <div class="section"><div class="section-title">Step 3 — Commission Calculation</div><div class="section-body">
      <table style="width:100%;border-collapse:collapse;margin-bottom:12px">
        <tr style="font-weight:700"><td style="padding:6px 8px;font-size:10pt">U. Commissionable Net (C − T)</td><td style="padding:6px 8px;font-size:10pt;text-align:right;font-family:monospace">${fmt(commNet)}</td></tr>
        <tr><td style="padding:4px 8px;font-size:10pt">V. Commission Tier</td><td style="padding:4px 8px;font-size:10pt;text-align:right;font-weight:700">${tier}%</td></tr>
        <tr style="border-top:1px solid #eee"><td style="padding:4px 8px;font-size:10pt">W. Gross Commission (U × V)</td><td style="padding:4px 8px;font-size:10pt;text-align:right;font-family:monospace">${fmt(commission)}</td></tr>
        ${isParLead ? `<tr style="color:#c00"><td style="padding:4px 8px;font-size:10pt">− PAR Fee (10.5% of net)</td><td style="padding:4px 8px;font-size:10pt;text-align:right;font-family:monospace">− ${fmt(parFee)}</td></tr>` : ""}
      </table>
      <div style="background:#fffbea;border:2px solid #e8a820;border-radius:4px;padding:14px;text-align:center">
        <div style="font-size:8pt;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:#888;margin-bottom:6px">${isParLead ? "Rep Net Commission (after PAR fee)" : "Total Net Commission (U × V)"}</div>
        <div style="font-size:26pt;font-weight:900;font-family:monospace;color:${finalCommission>=0?"#e8a820":"#e55"}">${fmt(finalCommission)}</div>
        <div style="font-size:8.5pt;color:#666;margin-top:4px">${tier}% of ${fmt(commNet)} commissionable net${isParLead ? " less PAR fee" : ""}</div>
      </div>
    </div></div>
    ${repSplitRows ? `<div class="section"><div class="section-title">Step 4 — Sales Rep Split</div><div class="section-body">
      <table style="width:100%;border-collapse:collapse">
        ${repSplitRows}
      </table>
    </div></div>` : ""}`;
  openPrint("Commission Workbook", html);
}