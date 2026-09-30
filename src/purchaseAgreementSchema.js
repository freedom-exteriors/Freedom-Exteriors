// purchaseAgreementSchema.js — shared trade schemas for the Purchase Agreement
// document (used by both the interactive PurchaseAgreement.js editor and
// pdfExport.js so field labels stay in sync between the two).

// ─── Shared "Dumpster & Debris Disposal" rows (same on every packet) ───────

const DUMPSTER_ROWS = [
  { key: "dumpster", label: "Dumpster", options: ["We provide the dumpster — 10 yd", "We provide the dumpster — 15 yd", "We provide the dumpster — 20 yd", "We provide the dumpster — 30 yd", "Cost included", "Extra cost"], detailsPlaceholder: "Extra cost $, other size…" },
  { key: "haulAway", label: "Haul-away", options: ["We haul debris in our own truck/trailer", "Cost included", "Extra cost"], detailsPlaceholder: "Extra cost $…" },
  { key: "ownerDisposal", label: "Owner Disposal", options: ["Owner provides dumpster / arranges disposal"], detailsPlaceholder: "Where debris is piled (no hauling/dump fees by us)…" },
  { key: "placement", label: "Placement", options: ["Driveway", "Yard", "Street (owner obtains any permit)", "Plywood protection: Yes", "Plywood protection: No"], detailsPlaceholder: "Other placement / permit notes…" },
];

// ─── Per-trade schemas, built from the Freedom Exteriors purchase-agreement packets ───

const TRADES = {
  roofing: {
    label: "Roofing",
    subtitle: "ROOFING",
    sections: [
      { title: "Roofing Specifications", rows: [
        { key: "location", label: "Location", options: ["House", "Garage", "Building", "Shed"], detailsPlaceholder: "Other location…" },
        { key: "tearOff", label: "Tear off, dispose & haul away existing roof system", options: ["Included"], detailsPlaceholder: "Number of layers…" },
        { key: "inspectDeck", label: "Inspect the roof deck for rotten/damaged wood, excessive gaps, and proper nailing", options: ["Included"], details: false },
        { key: "deckRepair", label: "Replace rotten/damaged/gapped roof boards/sheathing with", options: ["OSB", "Plywood", "Standard pine board(s)"], detailsPlaceholder: "$ per sheet/foot — not included in total cost below" },
        { key: "iceWater", label: "Install new self-adhering ice & water barrier", options: ["Included"], detailsPlaceholder: "Ft. up on eaves, 3 ft. wide in valleys, and…" },
        { key: "underlayment", label: "Install new underlayment", options: ["15# tar paper", "Standard synthetic felt", "Premium synthetic felt"], details: false },
        { key: "dripEdge", label: "Install new drip edge / trim", options: ["Drip edge", "Rake edge", "Gutter apron as needed", "Rain diverter(s)"], detailsPlaceholder: "Color…" },
        { key: "valleys", label: "Valleys", options: ["New w-style pre-finished valleys", "Closed-cut style valleys with coil-stock"], detailsPlaceholder: "Color…" },
        { key: "flashing", label: "Replace flashing where needed (PWI item — subject to labor/materials change order unless noted)", options: ["Step-flashing", "Dormer", "Chimney(s)", "Not included in total cost below"], detailsPlaceholder: "Details…" },
        { key: "roofVents", label: "Replace roof vents", options: ["Box vents", "Turbine vents", "Ridge vent"], detailsPlaceholder: "Details…" },
        { key: "newVent", label: "Cut and install new ventilation", options: ["Ridge vent", "Box vents"], detailsPlaceholder: "Details…" },
        { key: "furnacePipe", label: "Replace furnace pipe accessories", options: ["Base flange", "Storm collar", "Furnace cap"], details: false },
        { key: "pipeJacks", label: "Replace pipe-jacks / damper vents", options: ["Pipe-jacks", "Damper vents", "Field paint furnace pipe", "Field paint pipe-jack(s)"], details: false },
        { key: "ridge", label: "Shingle entire roof area complete with", options: ["Low ridge", "High ridge"], detailsPlaceholder: "Other…" },
        { key: "fastenersCleanup", label: "Fasteners & Cleanup", options: ["Roofing nails used as fasteners", "Apply caulking as needed", "Magnetic sweep of ground included"], details: false },
      ]},
      { title: "Roofing Material & Warranty Information", rows: [
        { key: "shingleBrand", label: "Freedom Exteriors will install", options: ["Owens Corning", "IKO"], detailsPlaceholder: "Other brand; Type; Color…" },
        { key: "mfrWarranty", label: "Shingles come with manufacturer warranty, type", options: ["Limited Lifetime", "50 yr.", "40 yr.", "30 yr.", "25 yr."], details: false },
        { key: "extWarranty", label: "Extended Warranty", options: ["System Protection", "Platinum Preferred"], detailsPlaceholder: "Other…" },
        { key: "workmanship", label: "Freedom Exteriors guarantees workmanship against leaks (except structure changes, severe weather, etc.)", options: ["Included"], detailsPlaceholder: "Number of years…" },
      ]},
      { title: "Dumpster & Debris Disposal", rows: DUMPSTER_ROWS },
    ],
  },
  windowsDoors: {
    label: "Windows & Doors",
    subtitle: "WINDOWS & DOORS",
    sections: [
      { title: "Window & Door Specifications", rows: [
        { key: "location", label: "Location", options: ["House", "Garage", "Building", "Shed"], detailsPlaceholder: "Other location…" },
        { key: "woodRepair", label: "Replace rotten/damaged wood with", options: ["OSB", "Plywood", "Pine", "PVC"], detailsPlaceholder: "$ per sheet/lin. ft. — not included in total" },
        { key: "windowScope", label: "Windows — Scope", options: ["Remove and dispose of existing windows", "Install new windows"], detailsPlaceholder: "Quantity…" },
        { key: "windowManuf", label: "Manufacturer / Series", type: "text" },
        { key: "windowType", label: "Window Type", options: ["Double-hung", "Casement", "Slider", "Picture", "Awning", "Bay/bow", "Egress"], detailsPlaceholder: "Other…" },
        { key: "windowFrameGlass", label: "Frame / Glass", options: ["Frame: Vinyl", "Frame: Fiberglass", "Frame: Wood", "Frame: Clad", "Glass: Low-E", "Glass: Triple", "Glass: Tempered", "Glass: Obscure"], details: false },
        { key: "windowGridsScreens", label: "Grids / Screens", options: ["Grids: None", "Grids: Between-glass", "Screens: Full", "Screens: Half", "Screens: None"], details: false },
        { key: "windowColor", label: "Exterior Color", type: "text2", label2: "Interior Color" },
        { key: "windowInstall", label: "Installation", options: ["Insert/retrofit", "Full-frame", "Flash & seal all openings", "Coil-wrap exterior trim", "Egress size verified"], details: false },
        { key: "doorScope", label: "Doors — Scope", options: ["Remove and dispose of existing door(s)", "Install new door(s)"], detailsPlaceholder: "Quantity…" },
        { key: "doorType", label: "Door Type", options: ["Entry", "Storm", "Patio/slider", "French", "Garage service"], detailsPlaceholder: "Other…" },
        { key: "doorMaterial", label: "Door Material", options: ["Steel", "Fiberglass", "Wood", "Prehung", "Sidelites", "Transom"], details: false },
        { key: "doorManufColor", label: "Manufacturer / Model", type: "text2", label2: "Color" },
        { key: "doorHardware", label: "Hardware", options: ["Owner-selected", "Deadbolt", "Handleset", "Sill pan/flashing", "Owner paints/stains"], detailsPlaceholder: "Finish…" },
        { key: "interiorTrim", label: "Interior trim/casing (windows & doors) by", options: ["Us", "Owner"], details: false },
        { key: "leadSafe", label: "Home built before 1978 — Owner received EPA \"Renovate Right\" pamphlet before work began", options: ["Confirmed"], detailsPlaceholder: "Owner initials…" },
        { key: "customOrder", label: "Owner verified all sizes, styles, colors & options; non-cancellable once ordered (Term 15)", options: ["Confirmed"], detailsPlaceholder: "Owner initials…" },
        { key: "otherWork", label: "Other Work", type: "text2", label2: "Lead Time (weeks)" },
      ]},
      { title: "Materials & Warranty Information", rows: [
        { key: "productsInstalled", label: "Products Installed", type: "text2", label2: "Model / Series" },
        { key: "mfrWarranty", label: "Manufacturer Warranty", options: ["Limited Lifetime"], detailsPlaceholder: "Years / other…" },
        { key: "workmanship", label: "Freedom Exteriors guarantees workmanship against installation defects (except structure changes, severe weather, etc.)", options: ["Included"], detailsPlaceholder: "Number of years…" },
      ]},
      { title: "Dumpster & Debris Disposal", rows: DUMPSTER_ROWS },
    ],
  },
  exterior: {
    label: "Siding, Soffit, Fascia & Gutters",
    subtitle: "SIDING, SOFFIT, FASCIA & GUTTERS",
    sections: [
      { title: "Siding, Soffit, Fascia & Gutter Specifications", rows: [
        { key: "location", label: "Location", options: ["House", "Garage", "Building", "Shed"], detailsPlaceholder: "Other location…" },
        { key: "woodRepair", label: "Replace rotten/damaged sheathing or trim with", options: ["OSB", "Plywood", "Pine", "PVC trim"], detailsPlaceholder: "$ per sheet/lin. ft. — not included in total" },
        { key: "sidingRemove", label: "Siding — Remove existing", options: ["None", "Vinyl", "Wood", "Aluminum/steel", "Fiber cement", "Hardboard"], detailsPlaceholder: "Other…" },
        { key: "sidingInstall", label: "Siding — Install new", options: ["Vinyl", "Engineered wood", "Fiber cement", "Steel"], detailsPlaceholder: "Other; Color…" },
        { key: "sidingManuf", label: "Manufacturer / Line", type: "text" },
        { key: "sidingProfile", label: "Profile", options: ["Lap", "Dutch lap", "Board & batten", "Shake/shingle"], detailsPlaceholder: "Other…" },
        { key: "sidingAreas", label: "Areas", options: ["All", "Front", "Rear", "Left", "Right", "Gables"], detailsPlaceholder: "Approx. sq. ft…" },
        { key: "sidingComponents", label: "Components", options: ["House wrap", "Flashing tape at openings", "Foam backer", "Corner posts", "J-channel", "Starter strip"], details: false },
        { key: "sidingTrim", label: "Trim & Accents", options: ["PVC", "Composite", "Wood", "Coil-wrapped", "Shutters", "Gable vents", "Mounting blocks"], detailsPlaceholder: "Color…" },
        { key: "soffit", label: "Soffit", options: ["Vented", "Solid", "Aluminum", "Vinyl"], detailsPlaceholder: "Other…" },
        { key: "fascia", label: "Fascia", options: ["Aluminum-wrapped", "Vinyl", "PVC/composite"], detailsPlaceholder: "Other; Color…" },
        { key: "fasciaAlso", label: "Also", options: ["Frieze board", "Rake/gable trim", "Replace rotten fascia/sub-fascia"], detailsPlaceholder: "$ per lin. ft. — not included in total" },
        { key: "guttersScope", label: "Gutters — Scope", options: ["Remove and dispose of existing gutters & downspouts", "Install new seamless gutters"], details: false },
        { key: "guttersStyle", label: "Gutters — Style / Material", options: ["5\" K", "6\" K", "Half-round", "Aluminum", "Steel", "Copper"], detailsPlaceholder: "Other; gauge/thickness…" },
        { key: "guttersColor", label: "Gutter Color", type: "text2", label2: "Approx. Lin. Ft." },
        { key: "guttersHangers", label: "Hangers", options: ["Hidden", "Spike & ferrule"], details: false },
        { key: "downspouts", label: "Downspouts", options: ["2x3", "3x4", "Round", "Extensions/splash blocks", "Leaf guards"], detailsPlaceholder: "Qty…" },
        { key: "otherWork", label: "Other Work", type: "text" },
        { key: "leadSafe", label: "Home built before 1978 — Owner received EPA \"Renovate Right\" pamphlet before work began", options: ["Confirmed"], detailsPlaceholder: "Owner initials…" },
      ]},
      { title: "Materials & Warranty Information", rows: [
        { key: "productsInstalled", label: "Products Installed", type: "text2", label2: "Model / Series" },
        { key: "mfrWarranty", label: "Manufacturer Warranty", options: ["Limited Lifetime"], detailsPlaceholder: "Years / other…" },
        { key: "workmanship", label: "Freedom Exteriors guarantees workmanship against installation defects (except structure changes, severe weather, etc.)", options: ["Included"], detailsPlaceholder: "Number of years…" },
      ]},
      { title: "Dumpster & Debris Disposal", rows: DUMPSTER_ROWS },
    ],
  },
  deck: {
    label: "Deck",
    subtitle: "DECK BUILD, REFINISH & REMOVAL",
    sections: [
      { title: "Deck Specifications", rows: [
        { key: "workIncluded", label: "Work Included", options: ["Build new deck", "Rebuild/replace existing", "Repair", "Refinish (clean, stain or seal)", "Remove existing deck"], details: false },
        { key: "deckStyle", label: "Style", options: ["Attached", "Freestanding", "Ground level", "Elevated"], detailsPlaceholder: "Size/height — ___ x ___ ft., ___ ft. high" },
        { key: "footings", label: "Footings", options: ["Poured concrete footings to frost depth", "Helical piles"], detailsPlaceholder: "Other; Qty…" },
        { key: "framing", label: "Framing", options: ["Joists: 2x8", "Joists: 2x10", "Joists: 2x12", "Spacing: 12\" o.c.", "Spacing: 16\" o.c.", "Pressure-treated"], detailsPlaceholder: "Other…" },
        { key: "houseAttach", label: "House Attachment", options: ["Ledger board w/ flashing & through-bolts/structural screws", "Freestanding (no ledger)", "Joist tape"], details: false },
        { key: "decking", label: "Decking", options: ["Pressure-treated", "Cedar", "Composite", "PVC", "Fasteners: Coated/galvanized", "Fasteners: Stainless"], detailsPlaceholder: "Other; Brand/color…" },
        { key: "railing", label: "Railing", options: ["None", "Wood", "Composite", "Aluminum", "Cable", "Vinyl", "Posts: 4x4", "Posts: 6x6", "Sleeves"], detailsPlaceholder: "Approx. lin. ft…" },
        { key: "stairs", label: "Stairs", options: ["Landing", "Handrail", "Gate"], detailsPlaceholder: "Steps; Width…" },
        { key: "extras", label: "Extras", options: ["Skirting/fascia", "Under-deck drainage", "Lighting", "Pergola/roof", "Benches/planters"], detailsPlaceholder: "Other…" },
        { key: "prep", label: "Repair/Refinish — Preparation", options: ["Pressure wash/clean", "Brighten/strip old finish", "Sand", "Reset/replace popped fasteners", "Tighten railings/posts"], details: false },
        { key: "boardRepair", label: "Board Repair", options: ["Replace damaged boards/framing"], detailsPlaceholder: "Approx. boards at $___ each — not included in total" },
        { key: "finish", label: "Finish", options: ["Clear sealer", "Transparent stain", "Semi-transparent stain", "Solid stain", "Paint"], detailsPlaceholder: "Coats; Product/brand; Color…" },
        { key: "refinishAreas", label: "Refinish Areas", options: ["Deck surface", "Railings", "Stairs", "Posts", "Skirting", "Underside"], detailsPlaceholder: "Approx. sq. ft…" },
        { key: "removalScope", label: "Removal — Scope", options: ["Entire deck", "Stairs", "Railings", "Ledger board & flashing", "Footings/piers", "Remove", "Cut off below grade"], details: false },
        { key: "restoration", label: "Restoration", options: ["Patch house wall/siding at ledger", "Rough grade area", "Owner keeps salvaged material (landscaping not included)"], details: false },
        { key: "permit", label: "Permit", options: ["We obtain permit", "Fee included", "Owner obtains permit", "Inspections by: Us", "Inspections by: Owner"], detailsPlaceholder: "Fee extra $…" },
        { key: "site", label: "Site", options: ["Owner confirmed property lines, setbacks, HOA approval", "Utilities located (811)"], detailsPlaceholder: "Owner initials…" },
        { key: "leadSafe", label: "Home built before 1978 — Owner received EPA \"Renovate Right\" pamphlet before work began", options: ["Confirmed"], detailsPlaceholder: "Owner initials…" },
      ]},
      { title: "Materials & Warranty Information", rows: [
        { key: "lumberMaterials", label: "Lumber / Materials", type: "text2", label2: "Model / Series" },
        { key: "mfrWarranty", label: "Manufacturer Warranty", options: ["Decking", "Railing", "Stain/sealer"], detailsPlaceholder: "Years for each; other…" },
        { key: "workmanship", label: "Freedom Exteriors guarantees workmanship against installation defects (except structure changes, severe weather, etc.)", options: ["Included"], detailsPlaceholder: "Number of years…" },
      ]},
      { title: "Dumpster & Debris Disposal", rows: DUMPSTER_ROWS },
    ],
  },
};

// Map a job's Job Type to a default trade key so the picker starts on the right tab.
export function defaultTradeForJobType(jobType) {
  const t = (jobType || "").toLowerCase();
  if (t.includes("window") || t.includes("door")) return "windowsDoors";
  if (t.includes("deck")) return "deck";
  if (t.includes("roof") && !t.includes("siding")) return "roofing";
  if (t.includes("siding") || t.includes("gutter") || t.includes("fascia") || t.includes("soffit") || t.includes("full exterior")) return "exterior";
  return "roofing";
}

export { DUMPSTER_ROWS, TRADES };
