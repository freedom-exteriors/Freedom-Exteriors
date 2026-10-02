// Company facts used on every invoice. Change them here and nowhere else.
//
// NOTE: the address/phone/license lines below are the wording Nick gave in
// the project brief. They still need checking against the reference invoice
// (.docx). The CRM's contracts print "Mahtomedi, MN 55115" (with ZIP) and
// "MN License #BC-810020 · WI Dwelling Contractor License #4811-DCFR".
export const COMPANY = {
  legalName: "Freedom Exteriors LLC",
  tagline: "Veteran-Owned and Operated",
  services: "Roofing · Siding · Windows · Doors",
  addressLine1: "1145 Summit Ave",
  addressLine2: "Mahtomedi, MN",
  phone: "(651) 283-1689",
  licenses: ["MN License BC 810020", "WI License 4811-DCFR"],
  colors: {
    teal: "0E7C86",
    gold: "F0B429",
    text: "1A1A1A",
  },
  invoicePrefix: "FE-INV",
  defaultTermsDays: 30,
} as const;
