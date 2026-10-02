// The reference estimate's content, entered as an invoice, so the generated
// file can be compared with reference/Freedom_Exteriors_Estimate_Pearson.docx
// like for like (npm run compare-reference).
import type { InvoiceFormInput } from "../../src/lib/invoice";

export const PEARSON_FORM: InvoiceFormInput = {
  customerName: "Ilene Pearson",
  customerPhone: "",
  customerAddress: "",
  jobAddress: "2887 Bartelmy Ln, Maplewood, MN 55109",
  subtitle: "Water Damage Repair, Deck Replacement & Exterior Openings",
  tag: "REVISED BID",
  contractDate: "2026-08-31",
  invoiceDate: "2026-08-31",
  dueDate: "2026-09-30",
  scope: [
    "Freedom Exteriors will remove and dispose of the existing rear elevated deck (approx. 10' x 16', with stairs); remove board & batten siding as needed to expose and inspect the rear wall framing and header for water damage; furnish and install a new sliding patio door and a new slider window in the existing rough openings; repair interior popcorn ceiling and drywall damage near the affected window/wall; and construct a new pressure-treated rear deck with framing and stairs with railings. Any additional rotted or damaged framing discovered once the wall or deck is opened up will be addressed per the time & materials allowance below, with client approval prior to proceeding.",
  ],
  costLines: [
    { description: "Remove & Reinstall Board & Batten Siding (3 sq) — inspect rear wall framing, install new header", detail: "Remove siding to expose wall/header for inspection; re-install existing product if reusable, replace if damaged.", qty: "3", rate: "950", amount: "" },
    { description: 'Sliding Patio Door — White on White (76"W x 81"H)', detail: "Remove & dispose of existing unit; furnish & install new insulated vinyl slider, flash and seal per manufacturer spec.", qty: "1", rate: "3500", amount: "" },
    { description: 'Slider Window — White on White (53"W x 36"H)', detail: "Remove & dispose of existing unit; furnish & install new insulated vinyl slider window, flash and seal.", qty: "1", rate: "1800", amount: "" },
    { description: "Deck Removal & Haul-Away (10' x 16', elevated w/ stairs)", detail: "Disconnect from ledger, demo deck surface, framing, stairs & railings; haul debris off-site and dispose.", qty: "1", rate: "2500", amount: "" },
    { description: "Interior Repairs — popcorn ceiling texture match & drywall patch near window/wall opening", detail: "Cut out and replace damaged drywall, re-texture to match existing popcorn ceiling, prime and paint affected areas.", qty: "6", rate: "900", amount: "" },
    { description: "New Rear Deck Framing — 10' x 16', pressure-treated (materials & labor, stairs priced separately)", detail: "Ledger, posts, beams, joists and decking, PT lumber, fasteners & hardware; framed and installed to current code.", qty: "1", rate: "4500", amount: "" },
    { description: "Rear Stairs with Railings (6–7 steps)", detail: "PT stringers, treads, and code-compliant railings/balusters.", qty: "1", rate: "2587", amount: "" },
    { description: "Rotted / Unforeseen Substrate — allowance", detail: "T&M if additional rot is found once wall/deck is opened up: labor $125/man-hr; std. dimensional lumber $8/ft; OSB/CDX sheet goods $175/sheet. Anything larger than 2x6 is non-standard and priced separately. Client notified & approves before proceeding.", qty: "1", rate: "0", amount: "" },
  ],
  overheadPercent: "10",
  profitPercent: "10",
  contractTotal: "",
  deposits: [{ date: "2026-09-02", description: "50% deposit at signing", amount: "13,882.20" }],
  changeOrders: [{ description: "Additional rotted sill plate (allowance used)", amount: "640.00" }],
  paymentTerms: "",
};
