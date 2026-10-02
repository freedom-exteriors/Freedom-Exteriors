// Company facts used on every invoice. Change them here and nowhere else.
// Both license numbers MUST print on every generated invoice; a test
// (test/docx.test.ts) fails if either is missing from the .docx.

export const MN_LICENSE = "BC-810020";
export const WI_LICENSE = "4811-DCFR";

export const COMPANY = {
  legalName: "Freedom Exteriors LLC",
  addressLine: "1145 Summit Ave., Mahtomedi, MN 55115",
  website: "www.freedom-exteriors.com",
  phone: "(651) 283-1689",
  mnLicense: MN_LICENSE,
  wiLicense: WI_LICENSE,
  /** Second header line, exactly as on the reference estimate. */
  get licenseLine() {
    return `${this.website}  •  MN License # ${MN_LICENSE}  •  WI Dwelling Contractor License # ${WI_LICENSE}`;
  },
  colors: {
    teal: "0E8A96",
    gold: "F5B301",
    text: "222222",
    gray: "666666",
    lightFill: "F2F2F2",
  },
  invoicePrefix: "FE-INV",
  defaultTermsDays: 30,
  // TODO(reference): replace with the PAYMENT TERMS wording from the
  // reference estimate once it's in the repo. Editable per invoice.
  defaultPaymentTerms:
    "Payment is due by the due date shown above. Please make checks payable to Freedom Exteriors LLC and reference the invoice number. Thank you for your business!",
} as const;
