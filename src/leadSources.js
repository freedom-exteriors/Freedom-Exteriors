// Where a job came from. The dropdown on the job form and the Lead Sources report both read this list.
// `detail` is the prompt for the follow-up box ("who sent them?"); `paid` shows the cost box.
export const LEAD_SOURCES = [
  { id: "word_of_mouth", label: "Word of mouth", detail: "Who said what? (optional)" },
  { id: "customer_referral", label: "Referral — past customer", detail: "Which customer referred them?" },
  { id: "sphere", label: "Personal sphere", detail: "Whose sphere? (name)" },
  { id: "business_card", label: "Business card", detail: "Where was the card handed out? (optional)" },
  { id: "website", label: "Website", detail: "Which page or form? (optional)" },
  { id: "google_search", label: "Google / online search", detail: "Search or listing? (optional)" },
  { id: "social", label: "Social media", detail: "Which platform / post? (optional)" },
  { id: "paid_lead", label: "Paid lead", detail: "Which company or service?", paid: true },
  { id: "par", label: "PAR (ProAct Resources)", detail: "Caller or campaign? (optional)", paid: true },
  { id: "mailer", label: "Direct mail / Bid Mailer", detail: "Which mailing? (optional)", paid: true },
  { id: "door_knock", label: "Door knocking / canvassing", detail: "Which neighborhood or storm? (optional)" },
  { id: "yard_sign", label: "Yard sign / truck / job-site sign", detail: "Which job or truck? (optional)" },
  { id: "partner", label: "Partner / contractor / insurance agent", detail: "Whose referral?" },
  { id: "repeat", label: "Repeat customer", detail: "" },
  { id: "other", label: "Other", detail: "Describe" },
];

export const NOT_RECORDED = "Not recorded";

export const leadSourceOf = id => LEAD_SOURCES.find(s => s.id === id) || null;
export const leadSourceLabel = id => leadSourceOf(id)?.label || NOT_RECORDED;
