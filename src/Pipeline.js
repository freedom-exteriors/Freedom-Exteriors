import { useState, useEffect, useCallback } from "react";
import { supabase } from "./supabase";
import { apiFetch } from "./apiFetch";
import ContractFill from "./ContractFill";
import CommissionWorkbook, { calcCommission } from "./CommissionWorkbook";
import ContractorAgreement from "./ContractorAgreement";
import RetailContract from "./RetailContract";
import PurchaseAgreement from "./PurchaseAgreement";
import PreBuildLetter from "./PreBuildLetter";
import LienNotice from "./LienNotice";
import CancellationNotice from "./CancellationNotice";
import DocsAcknowledgement from "./DocsAcknowledgement";
import GoodBetterBest, { PricingSettings, MaterialsCatalogSettings, DEFAULT_PRICING } from "./GoodBetterBest";
import QuickQuote from "./QuickQuote";
import ScopeReview from "./ScopeReview";
import { compressImage, uploadJobPhoto, usePhotoUrls, deleteJobPhotoFiles, movePhotosToStorage } from "./photos";
/* eslint-disable react-hooks/exhaustive-deps */
const TEAL = "#1a9e99"; const GOLD = "#e8a820"; const DARK = "#080d14";
const PANEL = "#0f1923"; const PANEL2 = "#162030"; const BORDER = "#1e3048";
const TEXT = "#e2eaf4"; const MUTED = "#6b8099"; const GREEN = "#10b981";

const STAGES = [
  { id: "lead",       label: "New Customer",    color: "#64748b", icon: "📥" },
  { id: "inspection", label: "Inspection",  color: "#0ea5e9", icon: "🔍" },
  { id: "claim",      label: "Claim Filed", color: "#8b5cf6", icon: "📋" },
  { id: "approved",   label: "Approved",    color: GOLD,      icon: "✅" },
  { id: "deposit",    label: "Initial Deposit Received", color: "#22c55e", icon: "💵" },
  { id: "scheduled",  label: "Scheduled",   color: "#f97316", icon: "📅" },
  { id: "installed",  label: "Installed",   color: TEAL,      icon: "🔨" },
  { id: "collected",  label: "Paid in Full",   color: "#10b981", icon: "💰" },
];
const REP_EMAILS = { Nick: "nick@freedom-exteriors.com", Victor: "victor@freedom-exteriors.com", Brett: "brett@freedom-exteriors.com" };

// Fields a rep fills in during an inspection/sales visit, mapped to job schema keys.
// Order here = order in the email template AND the paste-in preview.
const REP_FIELDS = [
  { label: "ADJUSTER NAME",   key: "adjuster" },
  { label: "ADJUSTER PHONE",  key: "adjPhone" },
  { label: "HOVER ID",        key: "hoverId" },
  { label: "ESTIMATE TOTAL",  key: "estimate.total",       numeric: true },
  { label: "DOWN PAYMENT",    key: "estimate.downPayment", numeric: true },
  { label: "DEDUCTIBLE",      key: "estimate.deductible",  numeric: true },
  { label: "NOTES",           key: "notes", multiline: true },
];

function buildRepEmail(job) {
  const to = REP_EMAILS[job.assigned] || "";
  const subject = `Job Info Needed — ${job.name} (${job.address}, ${job.city})`;
  const known = [
    ["CUSTOMER NAME", job.name], ["ADDRESS", job.address], ["CITY", job.city], ["STATE", job.state],
    ["PHONE", job.phone], ["EMAIL", job.email], ["JOB TYPE", job.type],
    ["CLAIM NUMBER", job.claimNum || "N/A"], ["INSURER", job.insurer],
  ].map(([l, v]) => `${l}: ${v || ""}`).join("\n");
  const blanks = REP_FIELDS.map(f => `${f.label}: `).join("\n");
  const body =
`FREEDOM EXTERIORS — JOB INFO REQUEST
====================================
Reply to this email with the fields below filled in. Don't remove or rename the labels — the office pastes this back into the CRM as-is.

--- FOR YOUR REFERENCE (already on file) ---
${known}

--- FILL IN AND REPLY ---
${blanks}
`;
  return { to, subject, body };
}

function parseRepEmail(text) {
  const result = {};
  const lines = text.split("\n");
  for (let i = 0; i < REP_FIELDS.length; i++) {
    const field = REP_FIELDS[i];
    const re = new RegExp(`^\\s*${field.label}\\s*:\\s*(.*)$`, "i");
    const lineIdx = lines.findIndex(l => re.test(l));
    if (lineIdx === -1) continue;
    let value = lines[lineIdx].match(re)[1].trim();
    if (field.multiline) {
      const rest = [];
      for (let j = lineIdx + 1; j < lines.length; j++) {
        const isNextLabel = REP_FIELDS.some(f => new RegExp(`^\\s*${f.label}\\s*:`, "i").test(lines[j]));
        if (isNextLabel) break;
        rest.push(lines[j]);
      }
      value = [value, ...rest].join("\n").trim();
    }
    if (value) result[field.key] = field.numeric ? (parseFloat(value.replace(/[^0-9.]/g, "")) || 0) : value;
  }
  return result;
}

const JOB_TYPES = [
  "Roof", "Siding", "Windows", "Doors", "Gutters", "Fascia", "Soffit",
  "Roof + Siding", "Roof + Gutters", "Siding + Windows", "Siding + Gutters",
  "Gutters + Fascia + Soffit", "Full Exterior",
  "Repair", "Exterior Misc",
  "Deck", "Outbuilding", "Other GC Work",
];
const INSURERS = ["State Farm","Allstate","Travelers","Farmers","Liberty Mutual","American Family","Auto-Owners","USAA","Other","None / OOP"];
const STATES = ["MN","WI"];
const STATE_COLORS = { MN: "#1a9e99", WI: "#e8a820" };
const stateColor = s => STATE_COLORS[s] || "#6b8099";

const PHOTO_CATS = ["Damage","Before","After","Adjuster Visit","Supplement","Deposit Check","Misc"];

const CHECKLIST_ITEMS = [
  { id:"c1",  label:"Schedule Product Meeting — review trades, selections, ACV/RCV basics" },
  { id:"c2",  label:"Color Form completed — manufacturer, product, color confirmed & signed" },
  { id:"c3",  label:"Collect Down Payment — 1st check (ACV), deductible, retail upgrades" },
  { id:"c4",  label:"Letter of Authorization (LOA) — verify lender, all parties signed" },
  { id:"c5",  label:"Skylight — measurements, photos inside/outside, exemption form if needed" },
  { id:"c6",  label:"Retail Agreement / Contract signed" },
  { id:"c7",  label:"Lead Form signed (if home built 1979 or prior)" },
  { id:"c8",  label:"Home Conditions Report (HCR) — photos of damage/deterioration, signed" },
  { id:"c9",  label:"Decking Photos / Attic Inspection — tape measure in each photo" },
  { id:"c10", label:"Pictures + Specs — attic, elevation, fascia, drip edge, sider's edge, heat tape" },
  { id:"c11", label:"Pre-Build Precaution Letter — all 8 items initialed by homeowner" },
  { id:"c12", label:"Contractor Documents Acknowledgement signed" },
  { id:"c13", label:"MN Mandatory Lien Notice delivered & signed" },
  { id:"c14", label:"Cancellation Notice (MN §326B.811) — 2 copies to homeowner" },
  { id:"c15", label:"Permit pulled" },
  { id:"c16", label:"Materials ordered (ABC Supply)" },
  { id:"c17", label:"Dumpster scheduled" },
  { id:"c18", label:"Crew scheduled & confirmed" },
  { id:"c19", label:"Final inspection complete" },
  { id:"c20", label:"Final invoice sent / collected" },
];

const ABC_CATALOG = [
  { id:"a1",  cat:"Shingles",        name:"GAF Timberline HDZ",          unit:"sq",  price:110 },
  { id:"a2",  cat:"Shingles",        name:"GAF Timberline CS",           unit:"sq",  price:98  },
  { id:"a3",  cat:"Shingles",        name:"Owens Corning Duration",      unit:"sq",  price:105 },
  { id:"a4",  cat:"Underlayment",    name:"GAF FeltBuster",              unit:"sq",  price:18  },
  { id:"a5",  cat:"Underlayment",    name:"Ice & Water Shield",          unit:"sq",  price:55  },
  { id:"a6",  cat:"Underlayment",    name:"Synthetic Underlayment",      unit:"sq",  price:22  },
  { id:"a7",  cat:"Ventilation",     name:"GAF Cobra Ridge Vent",        unit:"lf",  price:4.5 },
  { id:"a8",  cat:"Ventilation",     name:"Attic Vent (box)",            unit:"ea",  price:28  },
  { id:"a9",  cat:"Accessories",     name:"Drip Edge (10ft)",            unit:"ea",  price:8   },
  { id:"a10", cat:"Accessories",     name:"Starter Strip",               unit:"sq",  price:35  },
  { id:"a11", cat:"Accessories",     name:"Hip & Ridge Cap",             unit:"bdl", price:65  },
  { id:"a12", cat:"Accessories",     name:"Pipe Boot Flashing",          unit:"ea",  price:22  },
  { id:"a13", cat:"Nails / Fasteners",name:"Roofing Nails (1-3/4\")",   unit:"bx",  price:45  },
  { id:"a14", cat:"Siding",          name:"LP SmartSide 4\" Lap",       unit:"sq",  price:165 },
  { id:"a15", cat:"Siding",          name:"James Hardie HZ5 Plank",     unit:"sq",  price:185 },
  { id:"a16", cat:"Siding",          name:"Alside Mezzo Vinyl Siding",  unit:"sq",  price:125 },
  { id:"a17", cat:"Siding Acc.",     name:"House Wrap / WRB",           unit:"sq",  price:30  },
  { id:"a18", cat:"Siding Acc.",     name:"J-Channel (12ft)",           unit:"ea",  price:6   },
  { id:"a19", cat:"Gutters",         name:"5\" Aluminum Gutter (lf)",   unit:"lf",  price:5   },
  { id:"a20", cat:"Gutters",         name:"Downspout (10ft)",           unit:"ea",  price:12  },
];

const CONTRACT_TEMPLATES = {
  insurance_contingency: {
    label: "Insurance Contingency Contract",
    desc: "Pre-adjuster — null & void if claim denied",
    icon: "🛡️",
    color: "#8b5cf6",
    body: (job) => `RESIDENTIAL ROOFING CONTRACT — INSURANCE CONTINGENCY

Freedom Exteriors LLC · 1145 Summit Ave · Mahtomedi, MN 55115 · 651-283-1689

Property Address: ${job.address}, ${job.city}, ${job.state}
Date of Loss: ___________________
Homeowner(s): ${job.name}    Phone: ${job.phone}
Insurance Company: ${job.insurer}    Claim #: ${job.claimNum || "Pending"}
Adjuster: ${job.adjuster || "TBD"}    Adjuster Phone: ${job.adjPhone || "TBD"}

────────────────────────────────────────────────
HOMEOWNER has hired Freedom Exteriors LLC to perform the following:
• Inspect the roof for signs of damage and offer expert opinion as to serviceability
• Assist in filing the insurance claim
• Provide an inspection report of the roof
• Take photographs of damaged areas and provide insurance with proper documents

IF THE INSURANCE ADJUSTER DENIES THE COST OF REPLACEMENT:
This contract is immediately null and void.
Homeowners shall have no further obligation to contractor.

IF THE INSURANCE ADJUSTER AGREES TO REPLACE THE ROOF:
The homeowner agrees that Freedom Exteriors LLC shall be hired as the sole contractor
to perform the replacement for the entire amount allowed by the insurance summary.

HOMEOWNERS agree that the performance of all these tasks may not be necessary and
that failure to perform any or all the tasks does not relieve the homeowner from agreed
upon obligations.

HOMEOWNERS will be responsible for paying their deductible.
Freedom Exteriors LLC shall not be subjected to competitive bidding with other contractors.

If Contractor is successful in gaining insurance approval, and Homeowner elects not to
hire Contractor, Homeowner shall pay Contractor $1,000.00 in consideration for
Contractor's work. Homeowner will be responsible for all attorney and court costs arising
from Homeowner's non-performance of this contract. Buyer has 3 days from the written
contract to cancel.

────────────────────────────────────────────────
Homeowner Signature: ___________________________ Date: ____________
Printed Name: __________________________________ Date: ____________
Homeowner Signature: ___________________________ Date: ____________
Printed Name: __________________________________ Date: ____________

Freedom Exteriors LLC Representative: _____________ Date: ____________
Printed Name: __________________________________ Date: ____________

Phone: (651) 283-1689`
  },
  residential_roofing: {
    label: "Residential Roofing Contract",
    desc: "Full contract — insurance approved jobs",
    icon: "📋",
    color: TEAL,
    body: (job, est) => `RESIDENTIAL ROOFING CONTRACT NO. ___________

Freedom Exteriors LLC · 1145 Summit Ave · Mahtomedi, MN 55115 · 651-283-1689

Owner's Name: ${job.name}
Owner's Address: ${job.address}, ${job.city}, ${job.state} ${job.zip || ""}
Owner's Phone: ${job.phone}    Owner's Alt. Phone: _______________
Project Name & Address: ${job.address}, ${job.city}, ${job.state}
Email: _______________
Insurance Company: ${job.insurer}    Claim #: ${job.claimNum || "N/A"}

I/WE, the Owner(s) of the premises described above authorize Freedom Exteriors LLC,
hereinafter referred to as "Contractor", to furnish all materials and labor necessary to
roof and/or improve these premises in a good, workmanlike and substantial manner
according to the following terms, specifications and provisions:

a. Description of the work and the materials to be used:
${est?.scope || "[Scope of work to be completed here]"}

b. Description of any areas that will NOT be worked on:
_________________________________________________________________

INSURANCE: THE ONLY COST TO THE PROPERTY OWNER IS THEIR DEDUCTIBLE, PLUS
ANY UPGRADES CHOSEN OR ANY NON-COVERED ITEMS THAT MUST BE REPLACED TO
COMPLETE THE REPAIRS. THE CONTRACT BALANCE IS PAID BY YOUR INSURANCE
COMPANY PER FINAL LOSS INVOICE. THIS AGREEMENT IS NULL AND VOID AND DOES
NOT OBLIGATE ANY PARTY TO IT SHOULD THE INSURANCE COMPANY REFUSE
COVERAGE. OWNER ACKNOWLEDGES CONTRACTOR IS A GENERAL CONTRACTOR AND
AS SUCH IS ENTITLED TO 10% OVERHEAD AND 10% PROFIT AS ALLOWED BY
INSURANCE INDUSTRY STANDARDS.

c. Payment: Contractor proposes to perform the above work for the:
Total Sum of $${est?.total?.toFixed(2) || "____________"}
Down Payment (if any) $${est?.downPayment?.toFixed(2) || "____________"}

Payment Schedule:
1. ___________________________ Amount: $_____________
2. ___________________________ Amount: $_____________
3. ___________________________ Amount: $_____________

d. Approximate Start Date: ${job.installDate || "___________"}
   Approximate Completion Date: _______________

────────────────────────────────────────────────
Approved and accepted (owner): __________________ Date: ____________
Approved and accepted (owner): __________________
Approved (contractor): __________________________ Date: ____________

You, the Buyer, may cancel this transaction at any time prior to midnight of the
third business day after the date of this transaction. You may also cancel within
72 hours after being notified that your insurer has denied your claim.

NOTE: This contract may be withdrawn or renegotiated after _____ days if not
approved and signed by BOTH parties.

General Contractor License #BC-810020 | Phone: (651) 283-1689`
  },
  retail: {
    label: "Retail Contract (OOP)",
    desc: "Non-insurance / out-of-pocket jobs",
    icon: "🏠",
    color: "#f97316",
    body: (job, est) => `RESIDENTIAL ROOFING CONTRACT NO. ___________ (RETAIL)

Freedom Exteriors LLC · 1145 Summit Ave · Mahtomedi, MN 55115 · 651-283-1689

Owner's Name: ${job.name}
Owner's Address: ${job.address}, ${job.city}, ${job.state}
Owner's Phone: ${job.phone}
Project Address: ${job.address}, ${job.city}, ${job.state}
Email: _______________
Job Type: ${job.type}

I/WE, the Owner(s) authorize Freedom Exteriors LLC to furnish all materials and labor
necessary to complete the following work in a good, workmanlike and substantial manner:

a. Description of the work and materials:
${est?.scope || "[Scope of work and material specifications]"}

b. Areas NOT to be worked on:
_________________________________________________________________

c. Payment: Total Sum of $${est?.total?.toFixed(2) || "____________"}
Down Payment: $${est?.downPayment?.toFixed(2) || "____________"}

Payment Schedule:
1. ___________________________ Amount: $_____________
2. ___________________________ Amount: $_____________
3. ___________________________ Amount: $_____________

d. Approximate Start Date: ${job.installDate || "___________"}
   Approximate Completion Date: _______________

e. This contract is approved and accepted. No oral agreements or understandings
between the parties exist. Any changes require written change orders approved by both parties.

MINNESOTA MANDATORY LIEN NOTICE (§514.011):
ANY PERSON OR COMPANY SUPPLYING LABOR OR MATERIALS FOR THIS IMPROVEMENT
TO YOUR PROPERTY MAY FILE A LIEN AGAINST YOUR PROPERTY IF THAT PERSON OR
COMPANY IS NOT PAID FOR THE CONTRIBUTIONS.

HOUSING STATUTORY WARRANTY (§327A):
Workmanship: 1 year | Major structural: 10 years | Mechanical systems: 2 years

────────────────────────────────────────────────
Approved and accepted (owner): __________________ Date: ____________
Approved and accepted (owner): __________________
Approved (contractor): __________________________ Date: ____________

You, the Buyer, may cancel this transaction at any time prior to midnight of the
third business day after the date of this transaction.

General Contractor License #BC-810020 | Phone: (651) 283-1689`
  },
};

async function loadJobs() {
  // Throws on failure/timeout instead of swallowing — callers decide how to
  // handle that (retry, show an error) rather than silently rendering an
  // empty board that looks identical to "you have no jobs."
  const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 15000));
  const query = supabase.from("jobs").select("*").eq("user_email", "all");
  const { data, error } = await Promise.race([query, timeout]);
  if (error) throw error;
  return (data || []).map(r => r.data).filter(Boolean);
}

// Retries a couple times (cold Supabase compute / weak mobile signal can
// easily blow past one timeout) before giving up.
async function loadJobsWithRetry(attempts = 3) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try { return await loadJobs(); } catch (e) { lastErr = e; if (i < attempts - 1) await new Promise(r => setTimeout(r, 1000 * (i + 1))); }
  }
  throw lastErr;
}
async function persistJobs(jobs) {
  const list = Array.isArray(jobs) ? jobs : [jobs];
  if (!list.length) return;
  const rows = list.map(j => ({
    job_id: j.id,
    user_email: "all",
    data: j,
    portal_token: j.portal_token || null,
  }));
  const { error } = await supabase.from("jobs").upsert(rows, { onConflict: "job_id" });
  if (error) {
    console.error("Failed to save jobs:", error);
    throw error;
  }
}
async function deleteJobRow(id) {
  try {
    const { error } = await supabase.from("jobs").delete().eq("job_id", id);
    if (error) throw error;
  } catch (e) {
    console.error("Failed to delete job:", e);
  }
}

// Company-wide pricing config, stored under a reserved job_id (-1) so it survives
// and syncs across devices without needing a separate database table.
const PRICING_CONFIG_ID = -1;
// Company-wide materials catalog (manufacturer/style/color/$-per-sq), same reserved-row
// pattern under a second reserved job_id (-2) — keeps the single-JSONB-column architecture.
const MATERIALS_CATALOG_ID = -2;
// -3 holds the Scope Review reference library (read/written by ScopeReview.js).
const SCOPE_REFERENCES_ID = -3;
const RESERVED_IDS = [PRICING_CONFIG_ID, MATERIALS_CATALOG_ID, SCOPE_REFERENCES_ID];

async function loadPricingConfig() {
  try {
    const { data, error } = await supabase.from("jobs").select("data").eq("job_id", PRICING_CONFIG_ID).maybeSingle();
    if (error) throw error;
    return data?.data?.pricing || DEFAULT_PRICING;
  } catch (e) {
    console.error("Failed to load pricing config:", e);
    return DEFAULT_PRICING;
  }
}
async function savePricingConfig(pricing) {
  try {
    const { error } = await supabase.from("jobs").upsert(
      [{ job_id: PRICING_CONFIG_ID, user_email: "all", data: { id: PRICING_CONFIG_ID, pricing } }],
      { onConflict: "job_id" }
    );
    if (error) throw error;
  } catch (e) {
    console.error("Failed to save pricing config:", e);
    throw e;
  }
}

async function loadMaterialsCatalog() {
  try {
    const { data, error } = await supabase.from("jobs").select("data").eq("job_id", MATERIALS_CATALOG_ID).maybeSingle();
    if (error) throw error;
    return data?.data?.catalog || [];
  } catch (e) {
    console.error("Failed to load materials catalog:", e);
    return [];
  }
}
async function saveMaterialsCatalog(catalog) {
  try {
    const { error } = await supabase.from("jobs").upsert(
      [{ job_id: MATERIALS_CATALOG_ID, user_email: "all", data: { id: MATERIALS_CATALOG_ID, catalog } }],
      { onConflict: "job_id" }
    );
    if (error) throw error;
  } catch (e) {
    console.error("Failed to save materials catalog:", e);
    throw e;
  }
}

// Google review link for the "job complete" text (REACT_APP_GOOGLE_REVIEW_URL in Vercel).
const REVIEW_URL = (process.env.REACT_APP_GOOGLE_REVIEW_URL || "").trim();

// Portal links are the homeowner's only key to their job page, so make them unguessable.
function newPortalToken() {
  if (window.crypto?.randomUUID) return window.crypto.randomUUID().replace(/-/g, "");
  const bytes = new Uint8Array(16);
  window.crypto.getRandomValues(bytes);
  return Array.from(bytes, b => b.toString(16).padStart(2, "0")).join("");
}

// What the homeowner has done in their portal (signature, deposit).
function PortalActivity({ job }) {
  const signed = !!job.portalSignature;
  const paid = !!job.depositPaid;
  if (!signed && !paid && !job.portal_token) return null;
  const row = (ok, text) => (
    <div style={{ display:"flex", alignItems:"center", gap:8, fontSize:13, marginTop:4 }}>
      <span style={{ color: ok ? GREEN : MUTED, fontWeight:800 }}>{ok ? "✓" : "○"}</span><span style={{ color: ok ? TEXT : MUTED }}>{text}</span>
    </div>
  );
  const when = d => (d ? new Date(d).toLocaleString() : "");
  return (
    <div style={{ background:PANEL2, borderRadius:7, padding:"10px 12px", marginBottom:12 }}>
      <div style={{ color:MUTED, fontSize:9, fontWeight:700, textTransform:"uppercase", letterSpacing:1, marginBottom:2 }}>Homeowner Portal</div>
      {row(signed, signed ? `Signed by ${job.portalSignature}${job.portalSignedAt ? " · " + when(job.portalSignedAt) : ""}` : "Not signed in portal yet")}
      {row(paid, paid ? `Deposit paid${job.depositAmountPaid ? ` $${Number(job.depositAmountPaid).toLocaleString()}` : ""}${job.depositPaidAt ? " · " + when(job.depositPaidAt) : ""}` : "Deposit not paid yet")}
      {signed && job.portalSignatureImage && <img src={job.portalSignatureImage} alt="Homeowner signature" style={{ maxWidth:220, marginTop:8, background:"#fff", borderRadius:4, padding:4 }}/>}
    </div>
  );
}

const blank = () => ({
  id: Date.now(), name:"", address:"", city:"", state:"MN", phone:"", email:"",
  type:"Roof", stage:"lead", claimNum:"", insurer:"State Farm", adjuster:"", adjPhone:"",
  hoverId:"", notes:"", homeownerNote:"", followUp:false, assigned:"", parLead:false,
  added: new Date().toISOString().slice(0,10),
  photos:[], checklist:{}, materials:[], estimate:{total:0,downPayment:0,scope:"",deductible:0},
  contract:null, commission:{grossRevenue:0},
});

export default function Pipeline({ session }) {
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);
  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  const [jobs, setJobs] = useState([]);
  // Role + roster come from the `staff` table; RLS enforces what each role can load/save.
  const [staffProfile, setStaffProfile] = useState(undefined); // undefined = loading, null = no access
  const [staffNames, setStaffNames] = useState([]);
  useEffect(() => {
    const email = (session?.user?.email || "").toLowerCase();
    let cancelled = false;
    // A network hiccup or cold Supabase compute here must never be mistaken
    // for "you're not a team member" — retry before showing that screen.
    (async () => {
      let data, error;
      for (let i = 0; i < 3; i++) {
        ({ data, error } = await supabase.from("staff").select("email,name,role"));
        if (!error) break;
        if (i < 2) await new Promise(r => setTimeout(r, 1000 * (i + 1)));
      }
      if (cancelled) return;
      if (error) { console.error("Failed to load staff:", error); setStaffProfile(null); return; }
      setStaffProfile((data || []).find(r => r.email === email) || null);
      setStaffNames([...new Set((data || []).map(r => r.name))].sort());
    })();
    return () => { cancelled = true; };
  }, [session]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [saveStatus, setSaveStatus] = useState("saved");
  const [saveError, setSaveError] = useState(null);
  const [mainView, setMainView] = useState("board");
  const [filterStage, setFilterStage] = useState("all");
  const [filterState, setFilterState] = useState("all");
  const [selected, setSelected] = useState(null);
  const [jobTab, setJobTab] = useState("details");
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(blank());
  const [editing, setEditing] = useState(false);
  const [lightbox, setLightbox] = useState(null);
  const [contractPreview, setContractPreview] = useState(null);
  const [contractFillOpen, setContractFillOpen] = useState(false);
  const [commissionOpen, setCommissionOpen] = useState(false);
  const [contractorAgreementOpen, setContractorAgreementOpen] = useState(false);
  const [retailContractOpen, setRetailContractOpen] = useState(false);
  const [purchaseAgreementOpen, setPurchaseAgreementOpen] = useState(false);
  const [preBuildLetterOpen, setPreBuildLetterOpen] = useState(false);
  const [lienNoticeOpen, setLienNoticeOpen] = useState(false);
  const [cancellationNoticeOpen, setCancellationNoticeOpen] = useState(false);
  const [docsAckOpen, setDocsAckOpen] = useState(false);
  const [gbbOpen, setGbbOpen] = useState(false);
  const [scopeReviewOpen, setScopeReviewOpen] = useState(false);
  const [pricingSettingsOpen, setPricingSettingsOpen] = useState(false);
  const [materialsCatalogOpen, setMaterialsCatalogOpen] = useState(false);
  const [quickQuoteOpen, setQuickQuoteOpen] = useState(false);
  const [importModalOpen, setImportModalOpen] = useState(false);
  const [importText, setImportText] = useState("");
  const [importPreview, setImportPreview] = useState(null);
  const [photoUploadCat, setPhotoUploadCat] = useState("Damage");
  const [pendingPhotos, setPendingPhotos] = useState([]);
  useEffect(() => { setPendingPhotos([]); }, [selected?.id]);
  const photoUrls = usePhotoUrls(selected?.photos);
  const [pricing, setPricing] = useState(DEFAULT_PRICING);
  const [materialsCatalog, setMaterialsCatalog] = useState([]);
  const [abcFilter, setAbcFilter] = useState("All");

  useEffect(() => {
    loadJobsWithRetry()
      .then(d => { setJobs(d.filter(j => !RESERVED_IDS.includes(j.id))); setLoadError(false); })
      .catch(e => { console.error("Failed to load jobs:", e); setLoadError(true); })
      .finally(() => { setLoading(false); });
  }, []);
  useEffect(() => { loadPricingConfig().then(setPricing); }, []);
  useEffect(() => { loadMaterialsCatalog().then(setMaterialsCatalog); }, []);

  // Manual re-sync from Supabase (also used by the 60s polling fallback)
  const resync = useCallback(async () => {
    setSaveStatus("saving");
    try {
      const fresh = await loadJobs();
      const cleaned = fresh.filter(j => !RESERVED_IDS.includes(j.id));
      if (cleaned.length > 0 || jobs.length === 0) setJobs(cleaned);
      setSaveStatus("saved");
    } catch { setSaveStatus("error"); }
  }, [jobs.length]);

  // Polling fallback — every 60s, re-fetch in case realtime dropped (common on iPhone Safari)
  useEffect(() => {
    const t = setInterval(() => { loadJobs().then(fresh => { const cleaned = fresh.filter(j => !RESERVED_IDS.includes(j.id)); if (cleaned.length) setJobs(cleaned); }).catch(() => {}); }, 60000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    const channel = supabase
      .channel("jobs-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "jobs" }, (payload) => {
        if (payload.eventType === "DELETE") {
          const deletedId = payload.old?.job_id;
          if (deletedId == null || RESERVED_IDS.includes(deletedId)) return;
          setJobs(prev => prev.filter(j => j.id !== deletedId));
        } else {
          const incoming = payload.new?.data;
          if (!incoming || incoming.id == null) return;
          if (incoming.id === PRICING_CONFIG_ID) { if (incoming.pricing) setPricing(incoming.pricing); return; }
          if (incoming.id === MATERIALS_CATALOG_ID) { if (incoming.catalog) setMaterialsCatalog(incoming.catalog); return; }
          if (RESERVED_IDS.includes(incoming.id) || incoming.id < 0) return; // config rows are never jobs
          setJobs(prev => {
            const exists = prev.some(j => j.id === incoming.id);
            return exists
              ? prev.map(j => j.id === incoming.id ? incoming : j)
              : [...prev, incoming];
          });
        }
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, []);

  // Persist a single job (or a list) — targeted upsert, never touches other rows
  const persistOne = useCallback(async (jobOrJobs) => {
    setSaveStatus("saving");
    try {
      await persistJobs(jobOrJobs);
      setSaveStatus("saved");
      setSaveError(null);
    } catch (e) {
      setSaveStatus("error");
      setSaveError(e?.message || "Save failed — check your connection and try again.");
    }
  }, []);

  // Update local state, then persist only the changed job(s) — save runs OUTSIDE the state updater
  const updateJobs = useCallback((updater, changedIds) => {
    setJobs(prev => {
      const next = typeof updater === "function" ? updater(prev) : updater;
      const toSave = changedIds
        ? next.filter(j => changedIds.includes(j.id))
        : next.filter(j => { const old = prev.find(p => p.id === j.id); return !old || JSON.stringify(old) !== JSON.stringify(j); });
      if (toSave.length) queueMicrotask(() => persistOne(toSave));
      return next;
    });
  }, [persistOne]);

  const updateJob = useCallback((id, patch) => {
    updateJobs(prev => prev.map(j => j.id === id ? { ...j, ...patch } : j), [id]);
    setSelected(prev => prev?.id === id ? { ...prev, ...patch } : prev);
  }, [updateJobs]);

  // Realtime/polling refreshes land in `jobs`; keep the open job's panel current too
  // (e.g. a homeowner signs or pays while the rep is looking at the job).
  useEffect(() => {
    setSelected(prev => {
      if (!prev) return prev;
      const fresh = jobs.find(j => j.id === prev.id);
      return fresh && fresh !== prev ? fresh : prev;
    });
  }, [jobs]);

  const followUps = jobs.filter(j => j.followUp);
  const stageObj = id => STAGES.find(s => s.id === id) || STAGES[0];

  const userEmail = session?.user?.email;
  const isAdmin = staffProfile?.role === "admin";

  const filtered = jobs.filter(j => {
    if (filterStage !== "all" && j.stage !== filterStage) return false;
    if (filterState !== "all" && j.state !== filterState) return false;
    return true;
  });

  const openNew = () => { setForm({ ...blank(), assigned: staffProfile?.name || "" }); setEditing(false); setShowForm(true); setSelected(null); };
  const openEdit = (job) => { setForm({...job}); setEditing(true); setShowForm(true); setSelected(null); };

  const saveJob = () => {
    if (!form.name.trim()) return;
    const isNew = !editing;
    const token = newPortalToken();
    const jobWithToken = isNew ? { ...form, portal_token: token } : form;
    updateJobs(prev => editing ? prev.map(j => j.id === form.id ? jobWithToken : j) : [...prev, jobWithToken], [jobWithToken.id]);
    if (isNew) {
      const portalLink = window.location.origin + "/portal/" + token;
      if (form.phone) { apiFetch("/api/send-sms", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ to: form.phone, message: `Hi ${form.name}! Freedom Exteriors here. We have received your project info. Track your progress here: ${portalLink}` }) }).catch(e => console.warn("SMS failed:", e)); }
      if (form.email) { apiFetch("/api/send-email", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ to: form.email, homeownerName: form.name, jobType: form.type, portalLink }) }).catch(e => console.warn("Email failed:", e)); }
    }
    setShowForm(false);
  };

  const removeJob = id => {
    const job = jobs.find(j => j.id === id);
    if (!window.confirm(`Delete ${job?.name || "this job"} and all its photos? This can't be undone.`)) return;
    setJobs(prev => prev.filter(j => j.id !== id));
    deleteJobRow(id);
    deleteJobPhotoFiles(job).catch(e => console.warn("Couldn't delete photo files:", e));
    setSelected(null);
  };

  const savePricing = async (newPricing) => {
    setPricing(newPricing);
    try { await savePricingConfig(newPricing); } catch (e) { console.error(e); }
  };

  const saveCatalog = async (newCatalog) => {
    setMaterialsCatalog(newCatalog);
    try { await saveMaterialsCatalog(newCatalog); } catch (e) { console.error(e); }
  };

  const moveStage = (job, dir) => {
    const idx = STAGES.findIndex(s => s.id === job.stage);
    const next = STAGES[idx + dir];
    if (!next) return;
    updateJob(job.id, { stage: next.id });
    if (next && next.id === "collected" && job.phone) { apiFetch("/api/send-sms", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ to: job.phone, message: `Hi ${job.name}! Your project with Freedom Exteriors is complete. Thank you for choosing us!${REVIEW_URL ? ` Please leave us a review: ${REVIEW_URL}` : ""}` }) }).catch(e => console.warn("SMS failed:", e)); }
  };

  const toggleFollowUp = id => updateJob(id, { followUp: !jobs.find(j => j.id === id)?.followUp });

  const toggleCheck = (jobId, checkId) => {
    const job = jobs.find(j => j.id === jobId);
    const current = job?.checklist || {};
    updateJob(jobId, { checklist: { ...current, [checkId]: !current[checkId] } });
  };

  const stagePhotos = async (files, cat) => {
    const staged = [];
    for (const file of Array.from(files)) {
      try {
        const blob = await compressImage(file);
        staged.push({ id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now() + Math.random()), blob, preview: URL.createObjectURL(blob), name: file.name, cat: cat || "Damage" });
      } catch (e) {
        alert(`Couldn't read ${file.name}. Try a JPG or PNG.`);
      }
    }
    setPendingPhotos(p => [...p, ...staged]);
  };

  const [photoSaving, setPhotoSaving] = useState(false);
  const savePendingPhotos = async (jobId) => {
    setPhotoSaving(true);
    const saved = [];
    const failed = [];
    for (const p of pendingPhotos) {
      try { saved.push(await uploadJobPhoto(jobId, p.blob, { id: p.id, name: p.name, cat: p.cat })); }
      catch (e) { console.error("Photo upload failed:", e); failed.push(p); }
    }
    if (saved.length) {
      const job = jobs.find(j => j.id === jobId);
      updateJob(jobId, { photos: [...(job?.photos || []), ...saved] });
    }
    pendingPhotos.filter(p => !failed.includes(p)).forEach(p => URL.revokeObjectURL(p.preview));
    setPendingPhotos(failed);
    setPhotoSaving(false);
    if (failed.length) alert(`${failed.length} photo${failed.length === 1 ? "" : "s"} didn't upload — check your signal and tap Save again.`);
  };

  const [photoMove, setPhotoMove] = useState(null);
  const legacyPhotoCount = jobs.reduce((n, j) => n + (j.photos || []).filter(p => !p.path && typeof p.url === "string" && p.url.startsWith("data:")).length, 0);
  const runPhotoMove = async () => {
    setPhotoMove({ done: 0, total: 0 });
    const result = await movePhotosToStorage(jobs, async (jobId, photos) => {
      const job = { ...jobs.find(j => j.id === jobId), photos };
      setJobs(prev => prev.map(j => j.id === jobId ? { ...j, photos } : j));
      setSelected(prev => prev?.id === jobId ? { ...prev, photos } : prev);
      await persistJobs(job);
    }, (done, total) => setPhotoMove({ done, total }));
    setPhotoMove(null);
    alert(`Moved ${result.moved} photo${result.moved === 1 ? "" : "s"} to storage${result.failed ? ` — ${result.failed} couldn't be moved (they still show as before)` : ""}.`);
  };

  const addMaterial = (jobId, item) => {
    const job = jobs.find(j => j.id === jobId);
    const existing = job?.materials?.find(m => m.id === item.id);
    if (existing) { updateJob(jobId, { materials: job.materials.map(m => m.id === item.id ? { ...m, qty: m.qty + 1 } : m) }); }
    else { updateJob(jobId, { materials: [...(job?.materials || []), { ...item, qty: 1 }] }); }
  };

  const removeMaterial = (jobId, itemId) => {
    const job = jobs.find(j => j.id === jobId);
    updateJob(jobId, { materials: job.materials.filter(m => m.id !== itemId) });
  };

  const updateMaterialQty = (jobId, itemId, qty) => {
    const job = jobs.find(j => j.id === jobId);
    if (qty <= 0) { removeMaterial(jobId, itemId); return; }
    updateJob(jobId, { materials: job.materials.map(m => m.id === itemId ? { ...m, qty } : m) });
  };

  const materialsTotal = (mats) => (mats || []).reduce((s, m) => s + m.price * m.qty, 0);


  const openGoogleCalendar = (job) => {
    const start = job.installDate.replace(/-/g, "");
    const d = new Date(job.installDate);
    d.setDate(d.getDate() + 1);
    const end = d.toISOString().slice(0,10).replace(/-/g, "");
    const title = encodeURIComponent(`Freedom Exteriors — ${job.type} Installation`);
    const location = encodeURIComponent(`${job.address}, ${job.city}, ${job.state}`);
    const details = encodeURIComponent(`Freedom Exteriors LLC · (651) 283-1689\nJob: ${job.type}\nCustomer: ${job.name}`);
    window.open(`https://calendar.google.com/calendar/render?action=TEMPLATE&text=${title}&dates=${start}/${end}&details=${details}&location=${location}`, "_blank");
  };

  const fetchHoverMeasurements = async (job) => {
    if (!job.hoverId) return;
    try {
      const res = await apiFetch(`/api/hover?action=measurements&hoverId=${encodeURIComponent(job.hoverId)}`);
      const data = await res.json();
      if (data.success) { updateJob(job.id, { hoverMeasurements: data.measurements }); alert("Hover measurements loaded!"); }
      else if (res.status === 401) {
        if (!window.confirm("Hover isn't connected (or the connection expired). Log in to Hover now?")) return;
        const start = await apiFetch("/api/hover?action=start", { method: "POST" });
        const out = await start.json().catch(() => ({}));
        if (out.url) window.location.href = out.url; else alert(out.error || "Couldn't start the Hover login.");
      }
      else { alert("Error: " + data.error); }
    } catch (e) { alert("Failed to fetch Hover data."); }
  };

  // QuickBooks: tokens stay on the server; the app only asks for status / actions.
  const [qbStatus, setQbStatus] = useState(null);
  useEffect(() => {
    if (!isAdmin) return;
    apiFetch("/api/quickbooks?action=status").then(r => r.json()).then(setQbStatus).catch(() => setQbStatus(null));
  }, [isAdmin]);
  const connectQuickBooks = async () => {
    if (qbStatus?.connected && !window.confirm(`QuickBooks is connected${qbStatus.company ? ` to ${qbStatus.company}` : ""}. Reconnect (e.g. to switch companies)?`)) return;
    const res = await apiFetch("/api/quickbooks?action=start", { method: "POST" });
    const out = await res.json().catch(() => ({}));
    if (out.url) window.location.href = out.url; else alert(out.error || "Couldn't start the QuickBooks connection.");
  };
  const [qbInvoicing, setQbInvoicing] = useState(false);
  const createQbInvoice = async (job) => {
    if (!window.confirm(`Create a QuickBooks invoice for ${job.name} — $${Number(job.estimate?.total || 0).toLocaleString()}?`)) return;
    setQbInvoicing(true);
    try {
      const res = await apiFetch("/api/quickbooks?action=invoice", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jobId: job.id }) });
      const out = await res.json().catch(() => ({}));
      if (res.ok && out.success) {
        updateJob(job.id, { qbInvoiceId: out.invoiceId, qbInvoiceDocNumber: out.docNumber, qbInvoicedAt: new Date().toISOString() });
        alert(`Invoice ${out.docNumber || out.invoiceId} created in QuickBooks.`);
      } else if (res.status === 401) {
        if (window.confirm(`${out.error || "QuickBooks isn't connected."} Connect now?`)) connectQuickBooks();
      } else {
        alert(out.error || "QuickBooks invoice failed.");
      }
    } catch (e) {
      alert("Couldn't reach QuickBooks — check your connection.");
    } finally {
      setQbInvoicing(false);
    }
  };


  if (loading) return (
    <div style={{ minHeight:"100vh", background:DARK, display:"flex", alignItems:"center", justifyContent:"center", flexDirection:"column", gap:14, fontFamily:"'Barlow Condensed',sans-serif" }}>
      <div style={{ fontWeight:800, fontSize:28, letterSpacing:4 }}><span style={{ color:TEAL }}>FREEDOM </span><span style={{ color:GOLD }}>EXTERIORS</span></div>
      <div style={{ color:TEAL, fontWeight:700, letterSpacing:3, fontSize:11 }}>LOADING YOUR JOBS…</div>
      <div style={{ color:MUTED, fontSize:11, marginTop:4 }}>If this takes more than a few seconds, <span onClick={() => window.location.reload()} style={{ color:GOLD, cursor:"pointer", textDecoration:"underline" }}>tap here to reload</span>.</div>
    </div>
  );

  if (loadError) return (
    <div style={{ minHeight:"100vh", background:DARK, color:TEXT, fontFamily:"'Barlow','Segoe UI',sans-serif", display:"flex", alignItems:"center", justifyContent:"center", padding:16 }}>
      <div style={{ textAlign:"center", maxWidth:360 }}>
        <div style={{ fontWeight:800, fontSize:18, marginBottom:8, color:"#f87171" }}>Couldn't load your jobs</div>
        <div style={{ color:MUTED, fontSize:13, marginBottom:16 }}>The connection to the server timed out. This isn't "no jobs" — it's a connection problem. Check your signal/Wi-Fi and try again.</div>
        <button onClick={() => window.location.reload()} style={{ background:"#e8a820", color:"#000", border:"none", borderRadius:8, padding:"10px 18px", fontWeight:800, fontSize:13, cursor:"pointer", fontFamily:"inherit" }}>Retry</button>
      </div>
    </div>
  );

  if (staffProfile === null) return (
    <div style={{ minHeight:"100vh", background:DARK, color:TEXT, fontFamily:"'Barlow','Segoe UI',sans-serif", display:"flex", alignItems:"center", justifyContent:"center", padding:16 }}>
      <div style={{ textAlign:"center", maxWidth:360 }}>
        <div style={{ fontWeight:800, fontSize:18, marginBottom:8 }}>No CRM access</div>
        <div style={{ color:MUTED, fontSize:13, marginBottom:16 }}>{userEmail} isn't set up as a Freedom Exteriors team member. Ask Nick to add you.</div>
        <button onClick={() => supabase.auth.signOut()} style={{ background:"none", border:`1px solid ${BORDER}`, color:MUTED, borderRadius:8, padding:"8px 14px", fontWeight:700, fontSize:12, cursor:"pointer", fontFamily:"inherit" }}>Sign Out</button>
      </div>
    </div>
  );

  return (
    <div style={{ minHeight:"100vh", background:DARK, color:TEXT, fontFamily:"'Barlow','Segoe UI',sans-serif" }}>
      <link href="https://fonts.googleapis.com/css2?family=Barlow:wght@400;500;600;700;800&family=Barlow+Condensed:wght@700;800&display=swap" rel="stylesheet"/>

      {/* HEADER */}
      <header style={{ background:PANEL, borderBottom:`2px solid ${BORDER}`, padding:`0 ${isMobile?12:20}px`, display:"flex", alignItems:"center", justifyContent:"space-between", height:isMobile?52:60, position:"sticky", top:0, zIndex:100 }}>
        <div>
          <div style={{ fontFamily:"'Barlow Condensed',sans-serif", fontWeight:800, fontSize:isMobile?18:24, letterSpacing:3, lineHeight:1 }}>
            <span style={{ color:TEAL }}>FREEDOM </span><span style={{ color:GOLD }}>EXTERIORS</span>
          </div>
          {!isMobile && <div style={{ fontSize:9, letterSpacing:3, color:TEAL, fontWeight:700, textTransform:"uppercase", marginTop:2 }}>Veteran Owned &amp; Operated · MN · WI</div>}
        </div>
        <div style={{ display:"flex", alignItems:"center", gap:isMobile?6:8 }}>
          <button onClick={resync} title="Sync now" style={{ background:"none", border:`1px solid ${saveStatus==="error"?"#f87171":BORDER}`, color: saveStatus==="saved"?"#10b981":saveStatus==="saving"?GOLD:"#f87171", borderRadius:8, padding:isMobile?"6px 8px":"8px 12px", fontSize:12, fontWeight:700, cursor:"pointer", fontFamily:"inherit" }}>
            {saveStatus==="saved"?"☁ Synced":saveStatus==="saving"?"⟳ Saving…":"⚠ Retry"}
          </button>
          {followUps.length > 0 && (
            <button onClick={() => setMainView("followups")} style={{ background:"#7c2d1233", border:"1px solid #f9731688", color:"#fed7aa", borderRadius:20, padding:`4px ${isMobile?8:12}px`, fontSize:isMobile?11:12, fontWeight:700, cursor:"pointer", fontFamily:"inherit" }}>
              🔔 {followUps.length}
            </button>
          )}
          {!isMobile && isAdmin && <button onClick={() => setPricingSettingsOpen(true)} style={{ background:"none", border:"1px solid #fbbf24", color:"#fbbf24", borderRadius:8, padding:"8px 14px", fontWeight:700, fontSize:12, cursor:"pointer", fontFamily:"inherit" }}>📐 Pricing</button>}
          {!isMobile && isAdmin && <button onClick={() => setMaterialsCatalogOpen(true)} style={{ background:"none", border:"1px solid #a78bfa", color:"#a78bfa", borderRadius:8, padding:"8px 14px", fontWeight:700, fontSize:12, cursor:"pointer", fontFamily:"inherit" }}>🧱 Materials</button>}
          {staffProfile && <button onClick={() => setQuickQuoteOpen(true)} title="Quick Quote" style={{ background:"none", border:"1px solid #38bdf8", color:"#38bdf8", borderRadius:8, padding:isMobile?"6px 10px":"8px 14px", fontWeight:700, fontSize:12, cursor:"pointer", fontFamily:"inherit" }}>🧮{!isMobile && " Quick Quote"}</button>}
          {!isMobile && isAdmin && <button onClick={connectQuickBooks} title={qbStatus?.connected ? `QuickBooks connected${qbStatus.company ? ": " + qbStatus.company : ""}` : "Connect QuickBooks"} style={{ background:"none", border:"1px solid #2CA01C", color:"#2CA01C", borderRadius:8, padding:"8px 14px", fontWeight:700, fontSize:12, cursor:"pointer", fontFamily:"inherit" }}>{qbStatus?.connected ? "✓ QB" : "🔗 QB"}</button>}
          <button onClick={() => supabase.auth.signOut()} style={{ background:"none", border:`1px solid ${BORDER}`, color:MUTED, borderRadius:8, padding:isMobile?"6px 10px":"8px 14px", fontWeight:700, fontSize:12, cursor:"pointer", fontFamily:"inherit" }}>{isMobile?"↪":"Sign Out"}</button>
          <button onClick={openNew} style={{ background:GOLD, color:"#000", border:"none", borderRadius:8, padding:isMobile?"8px 14px":"8px 18px", fontWeight:800, fontSize:isMobile?12:13, cursor:"pointer", fontFamily:"inherit" }}>+ {isMobile?"New":"NEW JOB"}</button>
        </div>
      </header>

      {/* SAVE ERROR BANNER — visible, not just an icon */}
      {saveStatus === "error" && (
        <div style={{ background:"#7c2d12", borderBottom:"1px solid #f87171", padding:"10px 16px", display:"flex", alignItems:"center", justifyContent:"space-between", gap:12 }}>
          <div style={{ fontSize:13, color:"#fed7aa" }}>
            <strong>⚠ Save failed.</strong> {saveError || "Your last change may not have been saved."} Changes on screen are not confirmed in the database.
          </div>
          <button onClick={resync} style={{ background:"#f87171", color:"#000", border:"none", borderRadius:6, padding:"6px 14px", fontWeight:700, fontSize:12, cursor:"pointer", fontFamily:"inherit", flexShrink:0 }}>Reload from server</button>
        </div>
      )}

      {/* One-time: old photos are stored inside the job records, which makes every load slow */}
      {isAdmin && legacyPhotoCount > 0 && (
        <div style={{ background:PANEL2, borderBottom:`1px solid ${GOLD}66`, padding:"10px 16px", display:"flex", alignItems:"center", justifyContent:"space-between", gap:12 }}>
          <div style={{ fontSize:13, color:TEXT }}>
            <strong style={{ color:GOLD }}>{legacyPhotoCount} older photo{legacyPhotoCount===1?"":"s"}</strong> are stored the old way, which slows the app down for everyone. Move them to photo storage (one time, keep this tab open).
          </div>
          <button disabled={!!photoMove} onClick={runPhotoMove} style={{ background:GOLD, color:"#000", border:"none", borderRadius:6, padding:"6px 14px", fontWeight:700, fontSize:12, cursor:"pointer", fontFamily:"inherit", flexShrink:0 }}>
            {photoMove ? `Moving… ${photoMove.done}/${photoMove.total || "?"} jobs` : "Move photos"}
          </button>
        </div>
      )}

      {/* NAV */}
      <nav style={{ background:PANEL2, borderBottom:`1px solid ${BORDER}`, padding:`0 ${isMobile?8:20}px`, display:"flex", alignItems:"center", gap:2, overflowX:"auto", WebkitOverflowScrolling:"touch" }}>
        {[{id:"board",label:isMobile?"📋":"📋 Board"},{id:"list",label:isMobile?"📄":"📄 Jobs"},{id:"followups",label:isMobile?`🔔${followUps.length}`:`🔔 Follow-ups (${followUps.length})`},{id:"commission",label:isMobile?"💰":"💰 Commission"}].map(v => (
          <button key={v.id} onClick={() => setMainView(v.id)} style={{ background:"none", border:"none", color:mainView===v.id?GOLD:MUTED, borderBottom:mainView===v.id?`2px solid ${GOLD}`:"2px solid transparent", padding:isMobile?"10px 12px":"12px 16px", cursor:"pointer", fontSize:isMobile?12:13, fontWeight:mainView===v.id?700:500, fontFamily:"inherit", whiteSpace:"nowrap", flexShrink:0 }}>{v.label}</button>
        ))}
        <div style={{ marginLeft:"auto", display:"flex", gap:6, alignItems:"center", flexShrink:0 }}>
          {["all",...STATES].map(s => {
            const c = s === "all" ? TEAL : stateColor(s);
            return (
              <button key={s} onClick={() => setFilterState(s)} style={{ background:filterState===s?c+"22":"none", border:`1px solid ${filterState===s?c:BORDER}`, color:filterState===s?c:MUTED, borderRadius:6, padding:"3px 8px", fontSize:10, fontWeight:700, cursor:"pointer", fontFamily:"inherit" }}>{s==="all"?"All":s}</button>
            );
          })}
        </div>
      </nav>

      {/* BOARD */}
      {mainView==="board" && (
        <div style={{ display:"flex", gap:8, padding:isMobile?8:14, overflowX:"auto", alignItems:"flex-start", minHeight:"calc(100vh - 110px)", WebkitOverflowScrolling:"touch" }}>
          {STAGES.map(stage => {
            const cols = filtered.filter(j => j.stage === stage.id);
            const checkPct = (job) => { const total = CHECKLIST_ITEMS.length; const done = Object.values(job.checklist||{}).filter(Boolean).length; return Math.round(done/total*100); };
            return (
              <div key={stage.id} style={{ minWidth:isMobile?175:210, maxWidth:isMobile?175:210, flexShrink:0, background:PANEL, borderRadius:10, border:`1px solid ${BORDER}`, overflow:"hidden" }}>
                <div style={{ padding:"8px 10px", borderBottom:`2px solid ${stage.color}44`, display:"flex", alignItems:"center", gap:6, background:PANEL2 }}>
                  <span style={{ fontSize:12 }}>{stage.icon}</span>
                  <span style={{ fontWeight:700, fontSize:9, letterSpacing:1.5, textTransform:"uppercase", color:stage.color, flex:1 }}>{stage.label}</span>
                  <span style={{ background:stage.color+"22", color:stage.color, borderRadius:10, padding:"1px 6px", fontSize:11, fontWeight:800 }}>{cols.length}</span>
                </div>
                <div style={{ padding:6, display:"flex", flexDirection:"column", gap:6 }}>
                  {cols.map(job => {
                    const pct = checkPct(job);
                    return (
                      <div key={job.id} onClick={() => { setSelected(job); setJobTab("details"); }}
                        style={{ background:PANEL2, border:`1px solid ${BORDER}`, borderRadius:8, padding:"9px 10px", cursor:"pointer" }}>
                        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:3 }}>
                          <div style={{ fontWeight:700, fontSize:12, flex:1, lineHeight:1.2 }}>{job.name}</div>
                          <button onClick={e => { e.stopPropagation(); toggleFollowUp(job.id); }} style={{ background:"none", border:"none", cursor:"pointer", fontSize:13, padding:0 }}>{job.followUp?"🔔":"🔕"}</button>
                        </div>
                        <div style={{ color:MUTED, fontSize:11, marginBottom:3 }}>{job.city}, <span style={{ color:stateColor(job.state), fontWeight:700 }}>{job.state}</span></div>
                        <span style={{ background:TEAL+"22", color:TEAL, borderRadius:3, padding:"1px 6px", fontSize:10, fontWeight:600 }}>{job.type}</span>
                        {job.parLead && <span style={{ background:"#22d3ee22", color:"#22d3ee", borderRadius:3, padding:"1px 6px", fontSize:10, fontWeight:700, marginLeft:4 }}>📞 PAR</span>}
                        {job.estimate?.total > 0 && <div style={{ fontSize:10, color:"#10b981", marginTop:3, fontWeight:700 }}>${job.estimate.total.toLocaleString()}</div>}
                        {job.claimNum && <div style={{ fontSize:10, color:GOLD, marginTop:2, fontFamily:"monospace" }}>{job.claimNum}</div>}
                        <div style={{ marginTop:6 }}>
                          <div style={{ background:BORDER, borderRadius:3, height:3 }}>
                            <div style={{ background:pct===100?"#10b981":TEAL, borderRadius:3, height:3, width:`${pct}%` }}/>
                          </div>
                        </div>
                        <div style={{ display:"flex", gap:4, marginTop:6 }}>
                          {(() => { const idx = STAGES.findIndex(s => s.id === job.stage); return (<>
                            <button disabled={idx===0} onClick={e => { e.stopPropagation(); moveStage(job,-1); }} style={{ flex:1, background:"none", border:`1px solid ${idx===0?DARK:BORDER}`, color:idx===0?DARK:MUTED, borderRadius:5, padding:"3px 0", cursor:idx===0?"default":"pointer", fontSize:14 }}>←</button>
                            <button disabled={idx===STAGES.length-1} onClick={e => { e.stopPropagation(); moveStage(job,1); }} style={{ flex:1, background:"none", border:`1px solid ${idx===STAGES.length-1?DARK:BORDER}`, color:idx===STAGES.length-1?DARK:MUTED, borderRadius:5, padding:"3px 0", cursor:idx===STAGES.length-1?"default":"pointer", fontSize:14 }}>→</button>
                          </>); })()}
                        </div>
                      </div>
                    );
                  })}
                  {cols.length===0 && <div style={{ color:BORDER, fontSize:11, textAlign:"center", padding:"12px 0" }}>—</div>}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* LIST VIEW */}
      {mainView==="list" && (
        <div style={{ padding:isMobile?8:16, maxWidth:1400, margin:"0 auto" }}>
          <div style={{ display:"flex", gap:5, flexWrap:"wrap", marginBottom:12, overflowX:"auto", WebkitOverflowScrolling:"touch" }}>
            {[{id:"all",label:"All",color:MUTED},...STAGES].map(s => (
              <button key={s.id} onClick={() => setFilterStage(s.id)} style={{ background:filterStage===s.id?s.color+"22":"none", border:`1px solid ${filterStage===s.id?s.color:BORDER}`, color:filterStage===s.id?s.color:MUTED, borderRadius:5, padding:"4px 10px", fontSize:10, fontWeight:700, cursor:"pointer", fontFamily:"inherit", whiteSpace:"nowrap", flexShrink:0 }}>{s.label}</button>
            ))}
          </div>

          {isMobile ? (
            // MOBILE: Card list instead of table
            <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
              {filtered.map(job => {
                const s = stageObj(job.stage);
                const pct = Math.round(Object.values(job.checklist||{}).filter(Boolean).length / CHECKLIST_ITEMS.length * 100);
                return (
                  <div key={job.id} onClick={() => { setSelected(job); setJobTab("details"); }}
                    style={{ background:PANEL, border:`1px solid ${BORDER}`, borderLeft:`3px solid ${s.color}`, borderRadius:10, padding:"12px 14px", cursor:"pointer" }}>
                    <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:6 }}>
                      <div>
                        <div style={{ fontWeight:700, fontSize:15 }}>{job.name}</div>
                        <div style={{ color:MUTED, fontSize:12 }}>{job.city}, <span style={{ color:stateColor(job.state), fontWeight:700 }}>{job.state}</span></div>
                      </div>
                      <span style={{ background:s.color+"22", color:s.color, borderRadius:5, padding:"3px 8px", fontSize:11, fontWeight:700, flexShrink:0 }}>{s.icon} {s.label}</span>
                    </div>
                    <div style={{ display:"flex", gap:6, flexWrap:"wrap", alignItems:"center" }}>
                      <span style={{ background:TEAL+"22", color:TEAL, borderRadius:3, padding:"2px 7px", fontSize:10 }}>{job.type}</span>
                      {job.estimate?.total > 0 && <span style={{ color:"#10b981", fontWeight:700, fontSize:12 }}>${job.estimate.total.toLocaleString()}</span>}
                      {job.claimNum && <span style={{ color:GOLD, fontSize:10, fontFamily:"monospace" }}>{job.claimNum}</span>}
                      <span style={{ marginLeft:"auto", fontSize:10, color:pct===100?"#10b981":MUTED }}>{pct}%</span>
                    </div>
                  </div>
                );
              })}
              {filtered.length===0 && <div style={{ textAlign:"center", color:MUTED, padding:32 }}>No jobs found.</div>}
            </div>
          ) : (
            // DESKTOP: Full table
            <div style={{ background:PANEL, borderRadius:10, border:`1px solid ${BORDER}`, overflow:"hidden" }}>
              <table style={{ width:"100%", borderCollapse:"collapse" }}>
                <thead>
                  <tr style={{ background:PANEL2, borderBottom:`1px solid ${BORDER}` }}>
                    {["Customer","Location","Type","Stage","$Value","Claim #","Adjuster","Checklist","📷","🔔",""].map(h => (
                      <th key={h} style={{ padding:"9px 12px", textAlign:"left", fontSize:10, fontWeight:700, letterSpacing:1, textTransform:"uppercase", color:MUTED }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((job, i) => {
                    const s = stageObj(job.stage);
                    const pct = Math.round(Object.values(job.checklist||{}).filter(Boolean).length / CHECKLIST_ITEMS.length * 100);
                    return (
                      <tr key={job.id} onClick={() => { setSelected(job); setJobTab("details"); }}
                        style={{ borderBottom:`1px solid ${BORDER}`, cursor:"pointer", background:i%2===0?"transparent":PANEL2+"44" }}
                        onMouseEnter={e => e.currentTarget.style.background=TEAL+"11"}
                        onMouseLeave={e => e.currentTarget.style.background=i%2===0?"transparent":PANEL2+"44"}>
                        <td style={{ padding:"10px 12px", fontWeight:700 }}>{job.name}</td>
                        <td style={{ padding:"10px 12px", color:MUTED, fontSize:12 }}>{job.city}, <span style={{ color:stateColor(job.state), fontWeight:800 }}>{job.state}</span></td>
                        <td style={{ padding:"10px 12px" }}><span style={{ background:TEAL+"22", color:TEAL, borderRadius:3, padding:"2px 7px", fontSize:11 }}>{job.type}</span></td>
                        <td style={{ padding:"10px 12px" }}><span style={{ background:s.color+"22", color:s.color, border:`1px solid ${s.color}44`, borderRadius:3, padding:"2px 7px", fontSize:11, fontWeight:600 }}>{s.icon} {s.label}</span></td>
                        <td style={{ padding:"10px 12px", fontWeight:700, color: job.estimate?.total>0?"#10b981":BORDER }}>{job.estimate?.total>0?`$${job.estimate.total.toLocaleString()}`:"—"}</td>
                        <td style={{ padding:"10px 12px", fontFamily:"monospace", fontSize:11, color:GOLD }}>{job.claimNum||"—"}</td>
                        <td style={{ padding:"10px 12px", fontSize:12, color:MUTED }}>{job.adjuster||"—"}</td>
                        <td style={{ padding:"10px 12px" }}>
                          <div style={{ display:"flex", alignItems:"center", gap:6 }}>
                            <div style={{ background:BORDER, borderRadius:3, height:6, width:60 }}><div style={{ background:pct===100?"#10b981":TEAL, borderRadius:3, height:6, width:`${pct}%` }}/></div>
                            <span style={{ fontSize:10, color:pct===100?"#10b981":MUTED }}>{pct}%</span>
                          </div>
                        </td>
                        <td style={{ padding:"10px 12px", fontSize:12, color:job.photos?.length?TEAL:BORDER }}>{job.photos?.length?`📷 ${job.photos.length}`:"—"}</td>
                        <td style={{ padding:"10px 12px" }}><button onClick={e => { e.stopPropagation(); toggleFollowUp(job.id); }} style={{ background:"none", border:"none", cursor:"pointer", fontSize:15 }}>{job.followUp?"🔔":"🔕"}</button></td>
                        <td style={{ padding:"10px 12px" }}><button onClick={e => { e.stopPropagation(); openEdit(job); }} style={{ background:PANEL2, border:`1px solid ${BORDER}`, color:TEXT, borderRadius:5, padding:"3px 10px", fontSize:11, cursor:"pointer", fontFamily:"inherit" }}>Edit</button></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {filtered.length===0 && <div style={{ padding:32, textAlign:"center", color:MUTED }}>No jobs found.</div>}
            </div>
          )}
        </div>
      )}

      {/* FOLLOW-UPS */}
      {mainView==="followups" && (
        <div style={{ padding:isMobile?8:16, maxWidth:800, margin:"0 auto" }}>
          <div style={{ marginBottom:16 }}>
            <div style={{ fontFamily:"'Barlow Condensed',sans-serif", fontWeight:800, fontSize:22, letterSpacing:1 }}>🔔 Follow-ups Needed</div>
            <div style={{ color:MUTED, fontSize:13 }}>Tap "Clear" once you've followed up.</div>
          </div>
          {followUps.length===0 && <div style={{ background:PANEL, border:`1px solid ${BORDER}`, borderRadius:10, padding:40, textAlign:"center" }}><div style={{ fontSize:40 }}>✅</div><div style={{ fontWeight:700, fontSize:18, marginTop:8 }}>All clear!</div></div>}
          {followUps.map(job => {
            const s = stageObj(job.stage);
            return (
              <div key={job.id} onClick={() => { setSelected(job); setJobTab("details"); }} style={{ background:PANEL, border:`1px solid ${BORDER}`, borderLeft:`4px solid ${GOLD}`, borderRadius:10, padding:"14px 18px", marginBottom:8, cursor:"pointer", display:"flex", alignItems:"flex-start", justifyContent:"space-between", gap:12 }}>
                <div style={{ flex:1, minWidth:0 }}>
                  <div style={{ fontWeight:700, fontSize:15 }}>{job.name}</div>
                  <div style={{ color:MUTED, fontSize:12, marginTop:2 }}>{job.city}, <span style={{ color:stateColor(job.state), fontWeight:700 }}>{job.state}</span> · {job.type}</div>
                  <div style={{ display:"flex", gap:6, marginTop:6, flexWrap:"wrap" }}>
                    <span style={{ background:s.color+"22", color:s.color, borderRadius:3, padding:"2px 7px", fontSize:11 }}>{s.icon} {s.label}</span>
                    {job.claimNum && <span style={{ background:PANEL2, color:GOLD, borderRadius:3, padding:"2px 7px", fontSize:11, fontFamily:"monospace" }}>{job.claimNum}</span>}
                  </div>
                  {job.notes && <div style={{ color:TEXT, fontSize:12, marginTop:6, background:PANEL2, borderRadius:5, padding:"5px 8px" }}>📝 {job.notes}</div>}
                </div>
                <button onClick={e => { e.stopPropagation(); toggleFollowUp(job.id); }} style={{ background:TEAL+"22", border:`1px solid ${TEAL}`, color:TEAL, borderRadius:7, padding:"7px 14px", fontSize:12, fontWeight:700, cursor:"pointer", flexShrink:0, fontFamily:"inherit" }}>Clear ✓</button>
              </div>
            );
          })}
        </div>
      )}

      {/* COMMISSION */}
      {mainView==="commission" && (
        <div style={{ padding:isMobile?8:16, maxWidth:900, margin:"0 auto" }}>
          <div style={{ fontFamily:"'Barlow Condensed',sans-serif", fontWeight:800, fontSize:22, letterSpacing:1, marginBottom:16 }}>💰 Commission Workbook</div>
          <div style={{ display:"grid", gridTemplateColumns:isMobile?"1fr":"1fr 1fr", gap:16 }}>
            {jobs.filter(j => j.estimate?.total > 0 || j.commission?.grossRevenue > 0).map(job => {
              const c = job.commission || {};
              const r = calcCommission({ ...c, grossRevenue: c.grossRevenue || job.estimate?.total || 0 }, !!job.parLead);
              const final = r.isParLead ? r.repNet : r.commission;
              const money = v => `$${(Number(v) || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
              return (
                <div key={job.id} style={{ background:PANEL, border:`1px solid ${BORDER}`, borderRadius:10, padding:16 }}>
                  <div style={{ fontWeight:700, fontSize:15, marginBottom:2 }}>{job.name}</div>
                  <div style={{ color:MUTED, fontSize:12, marginBottom:12 }}>{job.city}, {job.state} · {job.type}{c.grossRevenue ? "" : " · using estimate total"}</div>
                  <div style={{ background:PANEL2, borderRadius:8, padding:12 }}>
                    <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:6 }}>
                      {[["Gross Revenue", r.gross],["Op. Alloc (15%)", r.opAlloc],["Total Costs", r.costs],["Comm. Net", r.commNet], ...(r.isParLead ? [["PAR Fee (10.5%)", r.parFee]] : [])].map(([label, val]) => (
                        <div key={label}><div style={{ fontSize:9, color:MUTED, textTransform:"uppercase" }}>{label}</div><div style={{ fontSize:13, fontWeight:600, color: val < 0 ? "#f87171" : TEXT }}>{money(val)}</div></div>
                      ))}
                    </div>
                    <div style={{ marginTop:10, borderTop:`1px solid ${BORDER}`, paddingTop:10, textAlign:"center" }}>
                      <div style={{ fontSize:10, color:MUTED, textTransform:"uppercase" }}>{r.isParLead ? "Rep Commission after PAR" : "Commission"} ({r.tier}% tier)</div>
                      <div style={{ fontSize:26, fontWeight:800, color: final < 0 ? "#f87171" : GOLD }}>{money(final)}</div>
                    </div>
                  </div>
                  <button onClick={() => { setSelected(job); setCommissionOpen(true); }} style={{ width:"100%", marginTop:10, background:GREEN+"22", border:`1px solid ${GREEN}`, color:GREEN, borderRadius:7, padding:"9px", fontSize:13, fontWeight:700, cursor:"pointer", fontFamily:"inherit" }}>Open Commission Workbook</button>
                </div>
              );
            })}
            {jobs.filter(j => j.estimate?.total > 0 || j.commission?.grossRevenue > 0).length === 0 && (
              <div style={{ gridColumn:"1/-1", background:PANEL, border:`1px solid ${BORDER}`, borderRadius:10, padding:40, textAlign:"center", color:MUTED }}>Jobs with estimates will appear here.</div>
            )}
          </div>
        </div>
      )}

      {/* JOB DETAIL MODAL */}
      {selected && !showForm && (
        <Overlay onClose={() => setSelected(null)} isMobile={isMobile}>
          <div style={{ display:"flex", flexDirection:"column", maxHeight:isMobile?"100vh":"92vh" }}>
            <div style={{ padding:isMobile?"14px 16px 0":"20px 24px 0", flexShrink:0 }}>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:10 }}>
                <div style={{ flex:1, minWidth:0, paddingRight:8 }}>
                  <div style={{ fontFamily:"'Barlow Condensed',sans-serif", fontWeight:800, fontSize:isMobile?20:24, letterSpacing:1 }}>{selected.name}</div>
                  <div style={{ color:MUTED, fontSize:12 }}>{selected.city}, <span style={{ color:stateColor(selected.state), fontWeight:700 }}>{selected.state}</span> · {selected.phone}</div>
                </div>
                {(() => { const s = stageObj(selected.stage); return <span style={{ background:s.color+"22", color:s.color, border:`1px solid ${s.color}55`, borderRadius:7, padding:"4px 10px", fontSize:11, fontWeight:700, flexShrink:0 }}>{s.icon} {s.label}</span>; })()}
              </div>
              <div style={{ display:"flex", gap:0, borderBottom:`1px solid ${BORDER}`, overflowX:"auto", WebkitOverflowScrolling:"touch" }}>
                {[{id:"details",label:"📋"},{id:"checklist",label:"☑️"},{id:"estimate",label:"💵"},{id:"materials",label:"🏗️"},{id:"contracts",label:"📄"},{id:"photos",label:"📷"}].map(t => (
                  <button key={t.id} onClick={() => setJobTab(t.id)} style={{ background:"none", border:"none", color:jobTab===t.id?GOLD:MUTED, borderBottom:jobTab===t.id?`2px solid ${GOLD}`:"2px solid transparent", padding:isMobile?"10px 14px":"8px 12px", cursor:"pointer", fontSize:isMobile?16:12, fontWeight:jobTab===t.id?700:500, fontFamily:"inherit", marginBottom:-1, flexShrink:0 }}>{isMobile?t.label:`${t.label} ${t.id.charAt(0).toUpperCase()+t.id.slice(1)}`}</button>
                ))}
              </div>
            </div>

            <div style={{ overflowY:"auto", flex:1, padding:isMobile?"12px 16px 16px":"16px 24px 20px", WebkitOverflowScrolling:"touch" }}>

              {jobTab==="details" && (
                <div>
                  {isAdmin && <div style={{ display:"flex", gap:8, marginBottom:12, flexWrap:"wrap" }}>
                    <a href={(() => { const e = buildRepEmail(selected); return `mailto:${e.to}?subject=${encodeURIComponent(e.subject)}&body=${encodeURIComponent(e.body)}`; })()}
                      style={{ background:"none", border:"1px solid #38bdf8", color:"#38bdf8", borderRadius:7, padding:"7px 12px", fontWeight:700, fontSize:11, textDecoration:"none", fontFamily:"inherit" }}>
                      📧 Email to Rep{selected.assigned && selected.assigned!=="Nick" ? ` (${selected.assigned})` : ""}
                    </a>
                    <button onClick={() => { setImportText(""); setImportPreview(null); setImportModalOpen(true); }}
                      style={{ background:"none", border:`1px solid ${GOLD}`, color:GOLD, borderRadius:7, padding:"7px 12px", fontWeight:700, fontSize:11, cursor:"pointer", fontFamily:"inherit" }}>
                      📥 Import from Email
                    </button>
                  </div>}
                  <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8, marginBottom:12 }}>
                    {[["Job Type",selected.type],["Assigned",selected.assigned],["Insurance",selected.insurer],["Claim #",selected.claimNum||"Not filed"],["Adjuster",selected.adjuster||"—"],["Adj. Phone",selected.adjPhone||"—"],["Date Added",selected.added]].map(([l,v]) => (
                      <div key={l} style={{ background:PANEL2, borderRadius:7, padding:"8px 10px" }}>
                        <div style={{ color:MUTED, fontSize:9, fontWeight:700, textTransform:"uppercase", letterSpacing:1, marginBottom:2 }}>{l}</div>
                        <div style={{ fontWeight:600, fontSize:12 }}>{v}</div>
                      </div>
                    ))}
                    <div style={{ background:PANEL2, borderRadius:7, padding:"8px 10px", border:selected.hoverId?`1px solid ${GOLD}44`:`1px solid ${BORDER}` }}>
                      <div style={{ color:MUTED, fontSize:9, fontWeight:700, textTransform:"uppercase", letterSpacing:1, marginBottom:2 }}>Hover ID</div>
                      {selected.hoverId ? <a href={`https://hover.to/jobs/${selected.hoverId}`} target="_blank" rel="noopener noreferrer" style={{ color:GOLD, fontFamily:"monospace", fontSize:12, fontWeight:700, textDecoration:"none" }}>{selected.hoverId} ↗</a> : <div style={{ color:BORDER, fontSize:11 }}>Not linked</div>}
                    </div>
                  </div>
                  {selected.parLead && (
                    <div style={{ background:"#22d3ee11", border:"1px solid #22d3ee44", borderRadius:8, padding:"10px 14px", marginBottom:12, display:"flex", alignItems:"center", gap:10 }}>
                      <span style={{ fontSize:18 }}>📞</span>
                      <div>
                        <div style={{ fontWeight:700, fontSize:12, color:"#22d3ee" }}>ProAct Resources (PAR) Lead</div>
                        <div style={{ fontSize:11, color:MUTED, marginTop:2 }}>35% of gross commission owed to PAR within 15 days of deposit. Commission Workbook will auto-set to PAR tier.</div>
                      </div>
                    </div>
                  )}
                  {selected.notes && <div style={{ background:PANEL2, borderRadius:7, padding:"10px 12px", marginBottom:12 }}><div style={{ color:MUTED, fontSize:9, fontWeight:700, textTransform:"uppercase", letterSpacing:1, marginBottom:4 }}>Internal Notes</div><div style={{ fontSize:13, lineHeight:1.6 }}>{selected.notes}</div></div>}
                  {selected.homeownerNote && <div style={{ background:PANEL2, borderRadius:7, padding:"10px 12px", marginBottom:12 }}><div style={{ color:MUTED, fontSize:9, fontWeight:700, textTransform:"uppercase", letterSpacing:1, marginBottom:4 }}>Note for Homeowner (visible in portal)</div><div style={{ fontSize:13, lineHeight:1.6 }}>{selected.homeownerNote}</div></div>}
                  <PortalActivity job={selected}/>

                  {/* Stage buttons */}
                  <div style={{ display:"flex", gap:8, marginBottom:12, alignItems:"center" }}>
                    {(() => { const idx = STAGES.findIndex(s => s.id === selected.stage); return (<>
                      <button disabled={idx===0} onClick={() => moveStage(selected,-1)} style={{ flex:1, background:PANEL2, border:`1px solid ${BORDER}`, color:idx===0?BORDER:TEXT, borderRadius:7, padding:"10px 0", cursor:idx===0?"default":"pointer", fontFamily:"inherit", fontSize:14 }}>← Back</button>
                      <button disabled={idx===STAGES.length-1} onClick={() => moveStage(selected,1)} style={{ flex:1, background:PANEL2, border:`1px solid ${BORDER}`, color:idx===STAGES.length-1?BORDER:TEXT, borderRadius:7, padding:"10px 0", cursor:idx===STAGES.length-1?"default":"pointer", fontFamily:"inherit", fontSize:14 }}>Forward →</button>
                    </>); })()}
                  </div>

                  {/* Action buttons — stacked on mobile */}
                  <div style={{ display:"flex", flexDirection:isMobile?"column":"row", gap:8, flexWrap:"wrap" }}>
                    <button onClick={() => toggleFollowUp(selected.id)} style={{ background:selected.followUp?GOLD+"22":PANEL2, border:`1px solid ${selected.followUp?GOLD:BORDER}`, color:selected.followUp?GOLD:MUTED, borderRadius:7, padding:"10px 14px", cursor:"pointer", fontFamily:"inherit", fontSize:13, fontWeight:600 }}>{selected.followUp?"🔔 Unmark Follow-up":"🔕 Mark Follow-up"}</button>
                    <button onClick={() => openEdit(selected)} style={{ background:TEAL+"22", border:`1px solid ${TEAL}`, color:TEAL, borderRadius:7, padding:"10px 14px", cursor:"pointer", fontFamily:"inherit", fontSize:13, fontWeight:700 }}>✏️ Edit Job</button>
                    <button onClick={() => setContractorAgreementOpen(true)} style={{ background:"#8b5cf622", border:"1px solid #8b5cf6", color:"#a78bfa", borderRadius:7, padding:"10px 14px", cursor:"pointer", fontFamily:"inherit", fontSize:13, fontWeight:700 }}>🤝 Inspection Agreement{selected.contractorAgreement?.homeownerSignature ? " ✓" : ""}</button>
                    <button onClick={() => setContractFillOpen(true)} style={{ background:GOLD+"22", border:`1px solid ${GOLD}`, color:GOLD, borderRadius:7, padding:"10px 14px", cursor:"pointer", fontFamily:"inherit", fontSize:13, fontWeight:700 }}>📝 Roofing Contract{selected.contract?.ownerSignature && selected.contract?.contractorSignature ? " ✓" : ""}</button>
                    <button onClick={() => setRetailContractOpen(true)} style={{ background:"#0ea5e922", border:"1px solid #0ea5e9", color:"#38bdf8", borderRadius:7, padding:"10px 14px", cursor:"pointer", fontFamily:"inherit", fontSize:13, fontWeight:700 }}>🧾 Retail Contract{selected.retailContract?.ownerSignature && selected.retailContract?.contractorSignature ? " ✓" : ""}</button>
                    <button onClick={() => setPurchaseAgreementOpen(true)} style={{ background:"#a78bfa22", border:"1px solid #a78bfa", color:"#a78bfa", borderRadius:7, padding:"10px 14px", cursor:"pointer", fontFamily:"inherit", fontSize:13, fontWeight:700 }}>📋 Purchase Agreement{selected.purchaseAgreement?.ownerSignature && selected.purchaseAgreement?.contractorSignature ? " ✓" : ""}</button>
                    <button onClick={() => setPreBuildLetterOpen(true)} style={{ background:"#10b98122", border:"1px solid #10b981", color:"#10b981", borderRadius:7, padding:"10px 14px", cursor:"pointer", fontFamily:"inherit", fontSize:13, fontWeight:700 }}>🏗️ Pre-Build Letter{selected.preBuildLetter?.homeownerSignature ? " ✓" : ""}</button>
                    <button onClick={() => setLienNoticeOpen(true)} style={{ background:"#f9731622", border:"1px solid #f97316", color:"#fb923c", borderRadius:7, padding:"10px 14px", cursor:"pointer", fontFamily:"inherit", fontSize:13, fontWeight:700 }}>⚖️ Lien Notice{selected.lienNotice?.ownerSignature ? " ✓" : ""}</button>
                    <button onClick={() => setCancellationNoticeOpen(true)} style={{ background:"#f8717122", border:"1px solid #f87171", color:"#f87171", borderRadius:7, padding:"10px 14px", cursor:"pointer", fontFamily:"inherit", fontSize:13, fontWeight:700 }}>📄 Cancellation Notice{selected.cancellationNotice?.companySignature ? " ✓" : ""}</button>
                    <button onClick={() => setDocsAckOpen(true)} style={{ background:"#e8a82022", border:`1px solid ${GOLD}`, color:GOLD, borderRadius:7, padding:"10px 14px", cursor:"pointer", fontFamily:"inherit", fontSize:13, fontWeight:700 }}>📋 Docs Acknowledgement{selected.docsAcknowledgement?.homeownerSignature ? " ✓" : ""}</button>
                    <button onClick={() => setCommissionOpen(true)} style={{ background:GREEN+"22", border:`1px solid ${GREEN}`, color:GREEN, borderRadius:7, padding:"10px 14px", cursor:"pointer", fontFamily:"inherit", fontSize:13, fontWeight:700 }}>💰 Commission{selected.commission?.grossRevenue ? " ✓" : ""}</button>
                    <button onClick={() => setGbbOpen(true)} style={{ background:"#fbbf2422", border:"1px solid #fbbf24", color:"#fbbf24", borderRadius:7, padding:"10px 14px", cursor:"pointer", fontFamily:"inherit", fontSize:13, fontWeight:700 }}>📐 Good/Better/Best{selected.gbb?.sqFt ? " ✓" : ""}</button>
                    {isAdmin && <button onClick={() => setScopeReviewOpen(true)} style={{ background:"#38bdf822", border:"1px solid #38bdf8", color:"#38bdf8", borderRadius:7, padding:"10px 14px", cursor:"pointer", fontFamily:"inherit", fontSize:13, fontWeight:700 }}>🔎 Scope Review{selected.scopeReviews?.length ? ` (${selected.scopeReviews.length})` : ""}</button>}
                    <button onClick={async () => { const token = selected.portal_token || newPortalToken(); if (!selected.portal_token) updateJob(selected.id, { portal_token: token }); const link = `${window.location.origin}/portal/${token}`; navigator.clipboard.writeText(link); alert("Portal link copied!"); }} style={{ background:GOLD+"22", border:`1px solid ${GOLD}`, color:GOLD, borderRadius:7, padding:"10px 14px", cursor:"pointer", fontFamily:"inherit", fontSize:13, fontWeight:700 }}>🔗 Portal Link</button>
                    {isAdmin && selected.stage === "collected" && (
                      selected.qbInvoiceId
                        ? <span style={{ background:"#2CA01C11", border:"1px solid #2CA01C66", color:"#2CA01C", borderRadius:7, padding:"10px 14px", fontSize:13, fontWeight:700 }}>📊 QB Invoice {selected.qbInvoiceDocNumber || selected.qbInvoiceId} ✓</span>
                        : <button disabled={qbInvoicing} onClick={() => createQbInvoice(selected)} style={{ background:"#2CA01C22", border:"1px solid #2CA01C", color:"#2CA01C", borderRadius:7, padding:"10px 14px", cursor:"pointer", fontFamily:"inherit", fontSize:13, fontWeight:700, opacity:qbInvoicing?0.6:1 }}>{qbInvoicing ? "Creating invoice…" : "📊 QB Invoice"}</button>
                    )}
                    {selected.installDate && <button onClick={() => openGoogleCalendar(selected)} style={{ background:"#1a73e822", border:"1px solid #1a73e8", color:"#1a73e8", borderRadius:7, padding:"10px 14px", cursor:"pointer", fontFamily:"inherit", fontSize:13, fontWeight:700 }}>📅 Add to Calendar</button>}
                    {selected.hoverId && <button onClick={() => fetchHoverMeasurements(selected)} style={{ background:"#ff6b2222", border:"1px solid #ff6b22", color:"#ff6b22", borderRadius:7, padding:"10px 14px", cursor:"pointer", fontFamily:"inherit", fontSize:13, fontWeight:700 }}>📐 Fetch Measurements</button>}
                    {isAdmin && <button onClick={() => removeJob(selected.id)} style={{ background:"#7c2d1222", border:"1px solid #7c2d12", color:"#f87171", borderRadius:7, padding:"10px 14px", cursor:"pointer", fontFamily:"inherit", fontSize:13 }}>🗑️ Delete</button>}
                  </div>
                </div>
              )}

              {jobTab==="checklist" && (
                <div>
                  <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:10 }}>
                    <div style={{ fontWeight:700, fontSize:14 }}>Job Checklist</div>
                    {(() => { const done = Object.values(selected.checklist||{}).filter(Boolean).length; const pct = Math.round(done/CHECKLIST_ITEMS.length*100); return <span style={{ color:pct===100?"#10b981":GOLD, fontWeight:700 }}>{done}/{CHECKLIST_ITEMS.length} ({pct}%)</span>; })()}
                  </div>
                  {(() => { const pct = Math.round(Object.values(selected.checklist||{}).filter(Boolean).length/CHECKLIST_ITEMS.length*100); return <div style={{ background:BORDER, borderRadius:4, height:8, marginBottom:14 }}><div style={{ background:pct===100?"#10b981":TEAL, borderRadius:4, height:8, width:`${pct}%`, transition:"width 0.3s" }}/></div>; })()}
                  <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
                    {CHECKLIST_ITEMS.map(item => {
                      const checked = selected.checklist?.[item.id] || false;
                      return (
                        <div key={item.id} onClick={() => toggleCheck(selected.id, item.id)} style={{ display:"flex", alignItems:"flex-start", gap:10, padding:"10px 12px", background:checked?TEAL+"11":PANEL2, border:`1px solid ${checked?TEAL:BORDER}`, borderRadius:7, cursor:"pointer" }}>
                          <div style={{ width:20, height:20, borderRadius:4, border:`2px solid ${checked?TEAL:BORDER}`, background:checked?TEAL:"none", display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0, marginTop:1 }}>
                            {checked && <span style={{ color:"#fff", fontSize:12, fontWeight:800 }}>✓</span>}
                          </div>
                          <span style={{ fontSize:13, color:checked?TEXT:MUTED, lineHeight:1.5, textDecoration:checked?"line-through":"none" }}>{item.label}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {jobTab==="estimate" && (
                <div>
                  <div style={{ fontWeight:700, fontSize:14, marginBottom:12 }}>Job Estimate</div>
                  <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10, marginBottom:12 }}>
                    {[["Total Job Value","total"],["Down Payment","downPayment"],["Deductible","deductible"]].map(([label, key]) => (
                      <div key={key}>
                        <label style={{ fontSize:10, color:MUTED, textTransform:"uppercase", letterSpacing:1, display:"block", marginBottom:4 }}>{label}</label>
                        <input type="number" value={selected.estimate?.[key]||""} onChange={e => updateJob(selected.id, { estimate: { ...(selected.estimate||{}), [key]: parseFloat(e.target.value)||0 } })}
                          style={{ width:"100%", background:PANEL2, border:`1px solid ${BORDER}`, borderRadius:7, color:TEXT, padding:"10px", fontSize:14, fontFamily:"inherit", boxSizing:"border-box" }} placeholder="0"/>
                      </div>
                    ))}
                    <div>
                      <label style={{ fontSize:10, color:MUTED, textTransform:"uppercase", letterSpacing:1, display:"block", marginBottom:4 }}>Install Date</label>
                      <input type="date" value={selected.installDate||""} onChange={e => updateJob(selected.id, { installDate: e.target.value })}
                        style={{ width:"100%", background:PANEL2, border:`1px solid ${BORDER}`, borderRadius:7, color:TEXT, padding:"10px", fontSize:13, fontFamily:"inherit", boxSizing:"border-box" }}/>
                    </div>
                  </div>
                  <div style={{ marginBottom:12 }}>
                    <label style={{ fontSize:10, color:MUTED, textTransform:"uppercase", letterSpacing:1, display:"block", marginBottom:4 }}>Scope of Work</label>
                    <textarea value={selected.estimate?.scope||""} onChange={e => updateJob(selected.id, { estimate: { ...(selected.estimate||{}), scope: e.target.value } })}
                      placeholder="Describe materials, scope, specifications..." rows={5}
                      style={{ width:"100%", background:PANEL2, border:`1px solid ${BORDER}`, borderRadius:7, color:TEXT, padding:"10px", fontSize:13, fontFamily:"inherit", boxSizing:"border-box", resize:"vertical" }}/>
                  </div>
                  {selected.estimate?.total > 0 && (
                    <div style={{ background:PANEL2, borderRadius:8, padding:14 }}>
                      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:8, textAlign:"center" }}>
                        {[["Value",`$${(selected.estimate.total||0).toLocaleString()}`,"#10b981"],["Down Pmt",`$${(selected.estimate.downPayment||0).toLocaleString()}`,GOLD],["Deduct.",`$${(selected.estimate.deductible||0).toLocaleString()}`,"#f87171"]].map(([l,v,c]) => (
                          <div key={l}><div style={{ fontSize:9, color:MUTED, textTransform:"uppercase" }}>{l}</div><div style={{ fontSize:18, fontWeight:800, color:c }}>{v}</div></div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {jobTab==="materials" && (
                <div>
                  <div style={{ fontWeight:700, fontSize:14, marginBottom:4 }}>🏗️ ABC Supply — Material List</div>
                  <div style={{ color:MUTED, fontSize:12, marginBottom:12 }}>Tap items to add to your order.</div>
                  <div style={{ display:"flex", gap:5, flexWrap:"wrap", marginBottom:12 }}>
                    {["All", ...new Set(ABC_CATALOG.map(i => i.cat))].map(cat => (
                      <button key={cat} onClick={() => setAbcFilter(cat)} style={{ background:abcFilter===cat?TEAL+"22":"none", border:`1px solid ${abcFilter===cat?TEAL:BORDER}`, color:abcFilter===cat?TEAL:MUTED, borderRadius:5, padding:"4px 10px", fontSize:11, fontWeight:700, cursor:"pointer", fontFamily:"inherit" }}>{cat}</button>
                    ))}
                  </div>
                  <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:6, marginBottom:16 }}>
                    {ABC_CATALOG.filter(i => abcFilter==="All" || i.cat===abcFilter).map(item => (
                      <div key={item.id} onClick={() => addMaterial(selected.id, item)} style={{ background:PANEL2, border:`1px solid ${BORDER}`, borderRadius:7, padding:"10px", cursor:"pointer", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                        <div>
                          <div style={{ fontSize:12, fontWeight:600 }}>{item.name}</div>
                          <div style={{ fontSize:10, color:MUTED }}>{item.cat}</div>
                        </div>
                        <div style={{ textAlign:"right" }}>
                          <div style={{ fontSize:13, fontWeight:700, color:TEAL }}>${item.price}</div>
                          <div style={{ fontSize:10, color:GOLD }}>+ Add</div>
                        </div>
                      </div>
                    ))}
                  </div>
                  {(selected.materials||[]).length > 0 && (
                    <div>
                      <div style={{ fontSize:10, color:MUTED, textTransform:"uppercase", letterSpacing:1, marginBottom:8, paddingTop:8, borderTop:`1px solid ${BORDER}` }}>Your Order</div>
                      <div style={{ display:"flex", flexDirection:"column", gap:5, marginBottom:12 }}>
                        {(selected.materials||[]).map(m => (
                          <div key={m.id} style={{ background:PANEL2, border:`1px solid ${BORDER}`, borderRadius:7, padding:"10px 12px", display:"flex", alignItems:"center", gap:8 }}>
                            <div style={{ flex:1, minWidth:0 }}>
                              <div style={{ fontSize:12, fontWeight:600 }}>{m.name}</div>
                              <div style={{ fontSize:10, color:MUTED }}>${m.price}/{m.unit}</div>
                            </div>
                            <div style={{ display:"flex", alignItems:"center", gap:6 }}>
                              <button onClick={() => updateMaterialQty(selected.id, m.id, m.qty-1)} style={{ background:PANEL, border:`1px solid ${BORDER}`, color:TEXT, borderRadius:4, width:28, height:28, cursor:"pointer", fontSize:16 }}>−</button>
                              <span style={{ fontSize:13, fontWeight:700, minWidth:24, textAlign:"center" }}>{m.qty}</span>
                              <button onClick={() => updateMaterialQty(selected.id, m.id, m.qty+1)} style={{ background:PANEL, border:`1px solid ${BORDER}`, color:TEXT, borderRadius:4, width:28, height:28, cursor:"pointer", fontSize:16 }}>+</button>
                            </div>
                            <div style={{ fontWeight:700, fontSize:13, color:"#10b981", minWidth:60, textAlign:"right" }}>${(m.price*m.qty).toFixed(2)}</div>
                            <button onClick={() => removeMaterial(selected.id, m.id)} style={{ background:"none", border:"none", color:"#f87171", cursor:"pointer", fontSize:16, padding:"0 4px" }}>✕</button>
                          </div>
                        ))}
                      </div>
                      <div style={{ background:PANEL2, borderRadius:8, padding:"12px 16px", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                        <div><div style={{ fontSize:10, color:MUTED, textTransform:"uppercase" }}>Total</div><div style={{ fontSize:22, fontWeight:800, color:"#10b981" }}>${materialsTotal(selected.materials).toFixed(2)}</div></div>
                        <a href="https://www.abcsupply.com/login" target="_blank" rel="noopener noreferrer" style={{ background:GOLD, color:"#000", borderRadius:8, padding:"10px 16px", fontWeight:800, fontSize:13, textDecoration:"none" }}>Order at ABC ↗</a>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {jobTab==="contracts" && (
                <div>
                  <div style={{ fontWeight:700, fontSize:14, marginBottom:4 }}>📄 Contract Templates</div>
                  <div style={{ color:MUTED, fontSize:12, marginBottom:14 }}>Select a template — auto-fills with job info.</div>
                  <div style={{ display:"flex", flexDirection:"column", gap:10, marginBottom:16 }}>
                    {Object.entries(CONTRACT_TEMPLATES).map(([key, tmpl]) => (
                      <div key={key} style={{ background:PANEL2, border:`1px solid ${selected.contract===key?tmpl.color:BORDER}`, borderRadius:8, padding:"14px", cursor:"pointer" }}
                        onClick={() => { updateJob(selected.id, { contract: key }); setContractPreview({ key, text: tmpl.body(selected, selected.estimate) }); }}>
                        <div style={{ display:"flex", alignItems:"center", gap:10 }}>
                          <span style={{ fontSize:22 }}>{tmpl.icon}</span>
                          <div style={{ flex:1 }}>
                            <div style={{ fontWeight:700, fontSize:13, color:selected.contract===key?tmpl.color:TEXT }}>{tmpl.label}</div>
                            <div style={{ fontSize:11, color:MUTED }}>{tmpl.desc}</div>
                          </div>
                          {selected.contract===key && <span style={{ color:tmpl.color, fontSize:12, fontWeight:700 }}>✓</span>}
                        </div>
                      </div>
                    ))}
                  </div>
                  <div style={{ fontSize:10, color:MUTED, textTransform:"uppercase", letterSpacing:1, marginBottom:8, paddingTop:8, borderTop:`1px solid ${BORDER}` }}>MN Required Documents</div>
                  <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
                    {[{label:"MN Mandatory Lien Notice (§514.011)",desc:"Required on all contracts"},{label:"Cancellation Notice (§326B.811)",desc:"72-hr right to cancel"},{label:"Contractor Documents Acknowledgement",desc:"Homeowner receipt"},{label:"Pre-Build Precaution Letter",desc:"8 items initialed"},{label:"Certificate of Insurance",desc:"Berkley · ASP698081595-01 · Exp. 05/12/2027"}].map(doc => (
                      <div key={doc.label} style={{ background:PANEL2, border:`1px solid ${BORDER}`, borderRadius:7, padding:"10px 12px", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                        <div><div style={{ fontSize:12, fontWeight:600 }}>{doc.label}</div><div style={{ fontSize:10, color:MUTED }}>{doc.desc}</div></div>
                        <span style={{ fontSize:10, color:TEAL, fontWeight:700, background:TEAL+"22", borderRadius:4, padding:"2px 8px", flexShrink:0, marginLeft:8 }}>On File</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {jobTab==="photos" && (
                <div>
                  <div style={{ marginBottom:10 }}>
                    <label style={{ display:"block", fontSize:10, fontWeight:700, color:MUTED, textTransform:"uppercase", letterSpacing:1, marginBottom:5 }}>Uploading as</label>
                    <select value={photoUploadCat} onChange={e => setPhotoUploadCat(e.target.value)}
                      style={{ width:"100%", background:PANEL2, border:`1px solid ${BORDER}`, borderRadius:7, color:TEXT, padding:"9px 10px", fontSize:13, fontFamily:"inherit" }}>
                      {PHOTO_CATS.map(cat => <option key={cat} value={cat}>{cat}</option>)}
                    </select>
                  </div>
                  <label style={{ display:"flex", alignItems:"center", justifyContent:"center", gap:10, cursor:"pointer", background:PANEL2, border:`2px dashed ${BORDER}`, borderRadius:9, padding:"20px", marginBottom:12 }}>
                    <input type="file" accept="image/*" multiple style={{ display:"none" }} onChange={e => { stagePhotos(e.target.files, photoUploadCat); e.target.value = ""; }}/>
                    <span style={{ fontSize:28 }}>📷</span>
                    <div><div style={{ fontWeight:700, fontSize:14 }}>Upload {photoUploadCat}</div><div style={{ color:MUTED, fontSize:11 }}>Photos are tagged as "{photoUploadCat}" above</div></div>
                  </label>

                  {pendingPhotos.length > 0 && (
                    <div style={{ background:`${GOLD}11`, border:`1px solid ${GOLD}44`, borderRadius:9, padding:12, marginBottom:14 }}>
                      <div style={{ fontSize:11, color:GOLD, fontWeight:700, marginBottom:8 }}>
                        {pendingPhotos.length} photo{pendingPhotos.length===1?"":"s"} ready — not saved yet
                      </div>
                      <div style={{ display:"grid", gridTemplateColumns:isMobile?"repeat(3,1fr)":"repeat(4,1fr)", gap:6, marginBottom:10 }}>
                        {pendingPhotos.map(ph => (
                          <div key={ph.id} style={{ position:"relative", borderRadius:6, overflow:"hidden", border:`1px solid ${GOLD}66` }}>
                            <img src={ph.preview} alt={ph.name} style={{ width:"100%", height:80, objectFit:"cover", display:"block" }}/>
                            <button onClick={() => { URL.revokeObjectURL(ph.preview); setPendingPhotos(p => p.filter(x => x.id !== ph.id)); }}
                              style={{ position:"absolute", top:3, right:3, background:"rgba(0,0,0,0.7)", border:"none", color:"#f87171", borderRadius:5, width:20, height:20, fontSize:12, cursor:"pointer", lineHeight:1 }}>✕</button>
                          </div>
                        ))}
                      </div>
                      <div style={{ display:"flex", gap:8 }}>
                        <button onClick={() => setPendingPhotos([])} style={{ flex:1, background:"none", border:`1px solid ${BORDER}`, color:MUTED, borderRadius:7, padding:"10px", fontWeight:700, fontSize:12, cursor:"pointer", fontFamily:"inherit" }}>Discard</button>
                        <button disabled={photoSaving} onClick={() => savePendingPhotos(selected.id)} style={{ flex:2, opacity:photoSaving?0.6:1, background:"#10b981", color:"#000", border:"none", borderRadius:7, padding:"10px", fontWeight:800, fontSize:12, cursor:"pointer", fontFamily:"inherit" }}>{photoSaving ? "Uploading…" : `💾 Save ${pendingPhotos.length} Photo${pendingPhotos.length===1?"":"s"}`}</button>
                      </div>
                    </div>
                  )}

                  {(selected.photos||[]).length === 0 && pendingPhotos.length === 0 && <div style={{ textAlign:"center", color:MUTED, padding:"20px 0" }}>No photos yet.</div>}
                  {[...PHOTO_CATS, ...new Set((selected.photos||[]).map(p => p.cat).filter(c => !PHOTO_CATS.includes(c)))].filter(cat => (selected.photos||[]).some(p => p.cat===cat)).map(cat => (
                    <div key={cat} style={{ marginBottom:14 }}>
                      <div style={{ fontSize:11, color:GOLD, fontWeight:700, marginBottom:6 }}>{cat}</div>
                      <div style={{ display:"grid", gridTemplateColumns:isMobile?"repeat(3,1fr)":"repeat(4,1fr)", gap:6 }}>
                        {(selected.photos||[]).filter(p => p.cat===cat).map(ph => (
                          <div key={ph.id} style={{ position:"relative", borderRadius:6, overflow:"hidden", border:`1px solid ${BORDER}` }}>
                            <img src={photoUrls[ph.id]} alt={ph.name} onClick={() => setLightbox({ ...ph, url: photoUrls[ph.id] })} style={{ width:"100%", height:80, objectFit:"cover", display:"block", cursor:"pointer", background:PANEL2 }}/>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </Overlay>
      )}

      {/* ADD / EDIT JOB FORM */}
      {showForm && (
        <Overlay onClose={() => setShowForm(false)} isMobile={isMobile}>
          <div style={{ padding:isMobile?"16px":"22px", overflowY:"auto", maxHeight:isMobile?"100vh":"90vh", WebkitOverflowScrolling:"touch" }}>
            <div style={{ fontFamily:"'Barlow Condensed',sans-serif", fontWeight:800, fontSize:20, letterSpacing:1, marginBottom:16, color:GOLD }}>{editing?"✏️ Edit Job":"📥 New Job"}</div>
            <Sec title="Customer Info">
              <div style={{ display:"grid", gridTemplateColumns:isMobile?"1fr":"1fr 1fr", gap:10 }}>
                <F label="Full Name *" value={form.name} onChange={v => setForm(p=>({...p,name:v}))}/>
                <F label="Phone" value={form.phone} onChange={v => setForm(p=>({...p,phone:v}))}/>
                <F label="Email" value={form.email||""} onChange={v => setForm(p=>({...p,email:v}))}/>
                <F label="Street Address" value={form.address} onChange={v => setForm(p=>({...p,address:v}))}/>
                <F label="City" value={form.city} onChange={v => setForm(p=>({...p,city:v}))}/>
                <Sel label="State" value={form.state} onChange={v => setForm(p=>({...p,state:v}))} options={STATES}/>
                <Sel label="Job Type" value={form.type} onChange={v => setForm(p=>({...p,type:v}))} options={JOB_TYPES}/>
                <Sel label="Stage" value={form.stage} onChange={v => setForm(p=>({...p,stage:v}))} options={STAGES.map(s=>({value:s.id,label:s.label}))}/>
              </div>
            </Sec>
            <Sec title="Insurance">
              <div style={{ display:"grid", gridTemplateColumns:isMobile?"1fr":"1fr 1fr", gap:10 }}>
                <Sel label="Insurance Company" value={form.insurer} onChange={v => setForm(p=>({...p,insurer:v}))} options={INSURERS}/>
                <F label="Claim Number" value={form.claimNum} onChange={v => setForm(p=>({...p,claimNum:v}))} placeholder="CLM-2026-XXXX"/>
                <F label="Adjuster Name" value={form.adjuster} onChange={v => setForm(p=>({...p,adjuster:v}))}/>
                <F label="Adjuster Phone" value={form.adjPhone} onChange={v => setForm(p=>({...p,adjPhone:v}))}/>
              </div>
            </Sec>
            <Sec title="Hover & Assignment">
              <div style={{ display:"grid", gridTemplateColumns:isMobile?"1fr":"1fr 1fr", gap:10 }}>
                <F label="Hover Job ID" value={form.hoverId} onChange={v => setForm(p=>({...p,hoverId:v}))} placeholder="e.g. 1234567"/>
                {isAdmin
                  ? <Sel label="Assigned To" value={form.assigned} onChange={v => setForm(p=>({...p,assigned:v}))}
                      options={[{ value:"", label:"Unassigned" }, ...[...new Set([...staffNames, ...(form.assigned ? [form.assigned] : [])])].map(n => ({ value:n, label:n }))]}/>
                  : <F label="Assigned To" value={form.assigned} onChange={() => {}} disabled/>}
              </div>
              {form.hoverId && <a href={`https://hover.to/jobs/${form.hoverId}`} target="_blank" rel="noopener noreferrer" style={{ color:GOLD, fontSize:12, fontWeight:700, textDecoration:"none" }}>Open in Hover ↗</a>}
            </Sec>
            <Sec title="Internal Notes (team only)">
              <textarea value={form.notes} onChange={e => setForm(p=>({...p,notes:e.target.value}))} placeholder="Supplement details, material specs, special instructions..." rows={3}
                style={{ width:"100%", background:PANEL2, border:`1px solid ${BORDER}`, borderRadius:7, color:TEXT, padding:"10px", fontSize:13, fontFamily:"inherit", boxSizing:"border-box", resize:"vertical" }}/>
            </Sec>
            <Sec title="Note for Homeowner (shows in their portal)">
              <textarea value={form.homeownerNote || ""} onChange={e => setForm(p=>({...p,homeownerNote:e.target.value}))} placeholder="e.g. Crew arrives 7am Tuesday — please move cars out of the driveway." rows={2}
                style={{ width:"100%", background:PANEL2, border:`1px solid ${BORDER}`, borderRadius:7, color:TEXT, padding:"10px", fontSize:13, fontFamily:"inherit", boxSizing:"border-box", resize:"vertical" }}/>
            </Sec>
            <label style={{ display:"flex", alignItems:"center", gap:8, cursor:"pointer", marginBottom:10, fontSize:13 }}>
              <input type="checkbox" checked={form.followUp} onChange={e => setForm(p=>({...p,followUp:e.target.checked}))} style={{ width:18, height:18, accentColor:GOLD }}/>
              <span>🔔 Flag for follow-up</span>
            </label>
            <label style={{ display:"flex", alignItems:"center", gap:8, cursor:"pointer", marginBottom:20, fontSize:13, background:form.parLead?"#22d3ee11":"transparent", border:`1px solid ${form.parLead?"#22d3ee":"transparent"}`, borderRadius:7, padding: form.parLead?"8px 12px":"0" }}>
              <input type="checkbox" checked={!!form.parLead} onChange={e => setForm(p=>({...p,parLead:e.target.checked}))} style={{ width:18, height:18, accentColor:"#22d3ee" }}/>
              <span style={{ color: form.parLead ? "#22d3ee" : TEXT }}>📞 PAR Lead — ProAct Resources {form.parLead && <span style={{ fontSize:11, color:"#22d3ee", marginLeft:4 }}>(35% commission fee owed to PAR on close)</span>}</span>
            </label>
            <div style={{ display:"flex", gap:8, justifyContent:"flex-end" }}>
              <button onClick={() => setShowForm(false)} style={{ background:"none", border:`1px solid ${BORDER}`, color:MUTED, borderRadius:7, padding:"11px 18px", cursor:"pointer", fontFamily:"inherit", fontSize:13 }}>Cancel</button>
              <button onClick={saveJob} style={{ background:GOLD, color:"#000", border:"none", borderRadius:7, padding:"11px 22px", fontWeight:800, cursor:"pointer", fontFamily:"inherit", fontSize:13 }}>{editing?"Save Changes":"Add Job"}</button>
            </div>
          </div>
        </Overlay>
      )}

      {/* CONTRACT PREVIEW */}
      {contractPreview && (
        <Overlay onClose={() => setContractPreview(null)} wide isMobile={isMobile}>
          <div style={{ padding:isMobile?"14px":"22px", overflowY:"auto", maxHeight:isMobile?"100vh":"90vh" }}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:14 }}>
              <div style={{ fontFamily:"'Barlow Condensed',sans-serif", fontWeight:800, fontSize:16, color:GOLD }}>{CONTRACT_TEMPLATES[contractPreview.key]?.label}</div>
              <button onClick={() => { navigator.clipboard?.writeText(contractPreview.text); }} style={{ background:TEAL+"22", border:`1px solid ${TEAL}`, color:TEAL, borderRadius:7, padding:"6px 14px", cursor:"pointer", fontSize:12, fontWeight:700, fontFamily:"inherit" }}>Copy</button>
            </div>
            <pre style={{ background:PANEL2, border:`1px solid ${BORDER}`, borderRadius:8, padding:14, fontSize:10, lineHeight:1.7, color:TEXT, whiteSpace:"pre-wrap", fontFamily:"'Courier New',monospace", overflowX:"auto" }}>{contractPreview.text}</pre>
          </div>
        </Overlay>
      )}

      {/* FILL CONTRACT (digitized, iPad-friendly) */}
      {contractFillOpen && selected && (
        <ContractFill
          job={selected}
          onSave={(contractData) => updateJob(selected.id, { contract: contractData })}
          onClose={() => setContractFillOpen(false)}
        />
      )}

      {/* RETAIL CONTRACT */}
      {retailContractOpen && selected && (
        <RetailContract job={selected} onSave={(d) => { updateJob(selected.id, { retailContract: d }); }} onClose={() => setRetailContractOpen(false)} />
      )}

      {/* PURCHASE AGREEMENT (trade-specific: Roofing / Windows & Doors / Siding / Deck) */}
      {purchaseAgreementOpen && selected && (
        <PurchaseAgreement job={selected} onSave={(d) => { updateJob(selected.id, { purchaseAgreement: d }); }} onClose={() => setPurchaseAgreementOpen(false)} />
      )}

      {/* PRE-BUILD LETTER */}
      {preBuildLetterOpen && selected && (
        <PreBuildLetter job={selected} onSave={(d) => { updateJob(selected.id, { preBuildLetter: d }); }} onClose={() => setPreBuildLetterOpen(false)} />
      )}

      {/* LIEN NOTICE */}
      {lienNoticeOpen && selected && (
        <LienNotice job={selected} onSave={(d) => { updateJob(selected.id, { lienNotice: d }); }} onClose={() => setLienNoticeOpen(false)} />
      )}

      {/* CANCELLATION NOTICE */}
      {cancellationNoticeOpen && selected && (
        <CancellationNotice job={selected} onSave={(d) => { updateJob(selected.id, { cancellationNotice: d }); }} onClose={() => setCancellationNoticeOpen(false)} />
      )}


      {/* DOCS ACKNOWLEDGEMENT */}
      {docsAckOpen && selected && (
        <DocsAcknowledgement job={selected} onSave={(d) => { updateJob(selected.id, { docsAcknowledgement: d }); }} onClose={() => setDocsAckOpen(false)} />
      )}

      {/* CONTRACTOR AGREEMENT */}
      {contractorAgreementOpen && selected && (
        <ContractorAgreement
          job={selected}
          onSave={(agreementData) => { updateJob(selected.id, { contractorAgreement: agreementData }); }}
          onClose={() => setContractorAgreementOpen(false)}
        />
      )}

      {/* COMMISSION WORKBOOK */}
      {commissionOpen && selected && (
        <CommissionWorkbook
          job={selected}
          isAdmin={isAdmin}
          onSave={(patch) => { updateJob(selected.id, patch); setCommissionOpen(false); }}
          onClose={() => setCommissionOpen(false)}
        />
      )}

      {/* GOOD / BETTER / BEST PRICING */}
      {scopeReviewOpen && selected && isAdmin && (
        <ScopeReview
          job={selected}
          onSave={(patch) => updateJob(selected.id, patch)}
          onClose={() => setScopeReviewOpen(false)}
        />
      )}

      {gbbOpen && selected && (
        <GoodBetterBest
          job={selected}
          pricing={pricing}
          catalog={materialsCatalog}
          isAdmin={isAdmin}
          onSave={(patch) => { updateJob(selected.id, patch); }}
          onClose={() => setGbbOpen(false)}
          onOpenSettings={() => setPricingSettingsOpen(true)}
        />
      )}

      {/* PRICING SETTINGS (admin) */}
      {pricingSettingsOpen && (
        <PricingSettings
          pricing={pricing}
          onSave={(p) => { savePricing(p); }}
          onClose={() => setPricingSettingsOpen(false)}
        />
      )}

      {/* MATERIALS CATALOG (admin) */}
      {materialsCatalogOpen && (
        <MaterialsCatalogSettings
          catalog={materialsCatalog}
          onSave={(c) => { saveCatalog(c); }}
          onClose={() => setMaterialsCatalogOpen(false)}
        />
      )}

      {/* IMPORT FROM EMAIL (rep reply paste-in) */}
      {importModalOpen && selected && (
        <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.7)", zIndex:400, display:"flex", alignItems:"center", justifyContent:"center", padding:16 }}>
          <div style={{ background:PANEL, border:`1px solid ${BORDER}`, borderRadius:12, maxWidth:560, width:"100%", maxHeight:"85vh", overflowY:"auto", padding:20 }}>
            <div style={{ fontWeight:800, fontSize:16, marginBottom:4 }}>📥 Import from Email</div>
            <div style={{ color:MUTED, fontSize:12, marginBottom:14 }}>Paste the rep's reply below, then review before it's saved to the job.</div>

            {!importPreview ? (
              <>
                <textarea value={importText} onChange={e => setImportText(e.target.value)} placeholder="Paste the full reply email here…"
                  style={{ width:"100%", minHeight:220, background:PANEL2, border:`1px solid ${BORDER}`, borderRadius:8, color:TEXT, padding:12, fontSize:13, fontFamily:"monospace", boxSizing:"border-box", resize:"vertical" }}/>
                <div style={{ display:"flex", gap:8, marginTop:14, justifyContent:"flex-end" }}>
                  <button onClick={() => setImportModalOpen(false)} style={{ background:"none", border:`1px solid ${BORDER}`, color:MUTED, borderRadius:7, padding:"9px 16px", fontWeight:700, fontSize:12, cursor:"pointer", fontFamily:"inherit" }}>Cancel</button>
                  <button onClick={() => { const parsed = parseRepEmail(importText); if (Object.keys(parsed).length===0) { alert("No recognized fields found. Make sure the labels weren't removed or renamed."); return; } setImportPreview(parsed); }}
                    disabled={!importText.trim()}
                    style={{ background:GOLD, color:"#000", border:"none", borderRadius:7, padding:"9px 16px", fontWeight:800, fontSize:12, cursor:importText.trim()?"pointer":"default", fontFamily:"inherit", opacity:importText.trim()?1:0.5 }}>
                    Parse →
                  </button>
                </div>
              </>
            ) : (
              <>
                <div style={{ fontSize:11, color:MUTED, marginBottom:10 }}>Found {Object.keys(importPreview).length} field{Object.keys(importPreview).length===1?"":"s"}. Edit anything below before saving — nothing is written to the job yet.</div>
                {REP_FIELDS.filter(f => importPreview[f.key] !== undefined).map(f => (
                  <div key={f.key} style={{ marginBottom:10 }}>
                    <label style={{ fontSize:10, color:MUTED, textTransform:"uppercase", letterSpacing:1, display:"block", marginBottom:4 }}>{f.label}</label>
                    {f.multiline ? (
                      <textarea value={importPreview[f.key]} onChange={e => setImportPreview(p => ({ ...p, [f.key]: e.target.value }))}
                        style={{ width:"100%", minHeight:70, background:PANEL2, border:`1px solid ${BORDER}`, borderRadius:7, color:TEXT, padding:10, fontSize:13, fontFamily:"inherit", boxSizing:"border-box", resize:"vertical" }}/>
                    ) : (
                      <input type={f.numeric ? "number" : "text"} value={importPreview[f.key]} onChange={e => setImportPreview(p => ({ ...p, [f.key]: f.numeric ? (parseFloat(e.target.value)||0) : e.target.value }))}
                        style={{ width:"100%", background:PANEL2, border:`1px solid ${BORDER}`, borderRadius:7, color:TEXT, padding:10, fontSize:13, fontFamily:"inherit", boxSizing:"border-box" }}/>
                    )}
                  </div>
                ))}
                <div style={{ display:"flex", gap:8, marginTop:14, justifyContent:"flex-end" }}>
                  <button onClick={() => setImportPreview(null)} style={{ background:"none", border:`1px solid ${BORDER}`, color:MUTED, borderRadius:7, padding:"9px 16px", fontWeight:700, fontSize:12, cursor:"pointer", fontFamily:"inherit" }}>← Back</button>
                  <button onClick={() => {
                      const updates = {};
                      const estUpdates = {};
                      Object.entries(importPreview).forEach(([key, val]) => {
                        if (key.startsWith("estimate.")) estUpdates[key.split(".")[1]] = val;
                        else updates[key] = val;
                      });
                      if (Object.keys(estUpdates).length) updates.estimate = { ...(selected.estimate||{}), ...estUpdates };
                      updateJob(selected.id, updates);
                      setImportModalOpen(false);
                    }}
                    style={{ background:"#10b981", color:"#000", border:"none", borderRadius:7, padding:"9px 16px", fontWeight:800, fontSize:12, cursor:"pointer", fontFamily:"inherit" }}>
                    ✓ Save to Job
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* QUICK QUOTE (admin, no job required) */}
      {quickQuoteOpen && (
        <QuickQuote
          pricing={pricing}
          catalog={materialsCatalog}
          onClose={() => setQuickQuoteOpen(false)}
        />
      )}

      {/* LIGHTBOX */}
      {lightbox && (
        <div onClick={() => setLightbox(null)} style={{ position:"fixed", inset:0, background:"#000000ee", display:"flex", alignItems:"center", justifyContent:"center", zIndex:300, padding:16 }}>
          <div onClick={e => e.stopPropagation()} style={{ position:"relative", maxWidth:"95vw", maxHeight:"95vh" }}>
            <img src={lightbox.url} alt={lightbox.name} style={{ maxWidth:"100%", maxHeight:"90vh", borderRadius:8, display:"block" }}/>
            <button onClick={() => setLightbox(null)} style={{ position:"absolute", top:-10, right:-10, background:PANEL, border:`1px solid ${BORDER}`, color:TEXT, borderRadius:"50%", width:30, height:30, cursor:"pointer", fontSize:16 }}>✕</button>
          </div>
        </div>
      )}
    </div>
  );
}

function Overlay({ children, onClose, wide, isMobile }) {
  return (
    <div onClick={onClose} style={{ position:"fixed", inset:0, background:"#000000cc", display:"flex", alignItems:isMobile?"flex-end":"center", justifyContent:"center", zIndex:200, padding:isMobile?0:16 }}>
      <div onClick={e => e.stopPropagation()} style={{ background:PANEL, border:`1px solid ${BORDER}`, borderRadius:isMobile?"14px 14px 0 0":14, width:"100%", maxWidth:isMobile?"100%":wide?780:640, position:"relative", boxShadow:"0 25px 60px #000b", maxHeight:isMobile?"95vh":"92vh", display:"flex", flexDirection:"column" }}>
        <button onClick={onClose} style={{ position:"absolute", top:12, right:12, background:PANEL2, border:`1px solid ${BORDER}`, color:MUTED, borderRadius:5, width:28, height:28, cursor:"pointer", fontSize:14, zIndex:1 }}>✕</button>
        {children}
      </div>
    </div>
  );
}

function Sec({ title, children }) {
  return (
    <div style={{ marginBottom:16 }}>
      <div style={{ fontSize:9, fontWeight:700, letterSpacing:2, textTransform:"uppercase", color:TEAL, marginBottom:8, paddingBottom:5, borderBottom:`1px solid ${BORDER}` }}>{title}</div>
      {children}
    </div>
  );
}
function F({ label, value, onChange, placeholder, disabled }) {
  return (
    <div>
      <label style={{ display:"block", fontSize:9, fontWeight:700, color:MUTED, textTransform:"uppercase", letterSpacing:1, marginBottom:4 }}>{label}</label>
      <input value={value||""} onChange={e => onChange(e.target.value)} placeholder={placeholder||""} disabled={disabled}
        style={{ width:"100%", opacity:disabled?0.6:1, background:PANEL2, border:`1px solid ${BORDER}`, borderRadius:7, color:TEXT, padding:"10px", fontSize:14, fontFamily:"inherit", boxSizing:"border-box", outline:"none" }}/>
    </div>
  );
}
function Sel({ label, value, onChange, options }) {
  return (
    <div>
      <label style={{ display:"block", fontSize:9, fontWeight:700, color:MUTED, textTransform:"uppercase", letterSpacing:1, marginBottom:4 }}>{label}</label>
      <select value={value||""} onChange={e => onChange(e.target.value)}
        style={{ width:"100%", background:PANEL2, border:`1px solid ${BORDER}`, borderRadius:7, color:TEXT, padding:"10px", fontSize:14, fontFamily:"inherit", boxSizing:"border-box", outline:"none" }}>
        {options.map(o => typeof o==="string" ? <option key={o} value={o}>{o}</option> : <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  );
}