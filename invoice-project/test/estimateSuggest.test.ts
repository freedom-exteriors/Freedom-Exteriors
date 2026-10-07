import { describe, expect, it } from "vitest";
import { cleanAttachments, type EstimateFormInput, type PriceBookItem } from "@/lib/estimate";
import { mergeSuggestion, normalizeSuggestion } from "@/lib/estimateSuggest";
import { emptyEstimate } from "@/components/EstimateBuilder";

const ROOF = "aaaaaaaa-0000-4000-8000-000000000001";
const GUTTER = "aaaaaaaa-0000-4000-8000-000000000002";
const OLD = "aaaaaaaa-0000-4000-8000-000000000003";
const pb = (id: string, label: string, unit: string, rate: number | null, active = true): PriceBookItem => ({
  id, trade: "Roofing", label, description: label, detail: null, unit, default_quantity: "1.000", rate_cents: rate, sort_order: 0, active, source_note: null,
});
const PRICE_BOOK = [pb(ROOF, "Roof replacement — Good tier", "sq", 65000), pb(GUTTER, "Seamless gutters", "lf", null), pb(OLD, "Retired item", "ea", 100, false)];

const raw = {
  customer_name: "Jerome Behr",
  customer_phone: "",
  customer_email: "",
  customer_address: "",
  job_address: "12 Lake St, Mahtomedi, MN",
  subtitle: "Hail damage: roof and gutters",
  tag: "INSURANCE CLAIM",
  lines: [
    { price_book_item_id: ROOF, description: "Roof replacement", detail: "", quantity: "28.6", unit: "sq", unit_price: "512.40", basis: "measured", why: "Hover report: 28.6 sq incl. 10% waste" },
    { price_book_item_id: GUTTER, description: "Seamless gutters", detail: "", quantity: "142", unit: "lf", unit_price: "11.25", basis: "document", why: "State Farm scope line 14" },
    { price_book_item_id: "", description: "Window screen repair", detail: "", quantity: "", unit: "ea", unit_price: "", basis: "photo", why: "torn screens in photo 3" },
    { price_book_item_id: OLD, description: "Retired thing", detail: "", quantity: "2", unit: "ea", unit_price: "", basis: "bogus", why: "" },
    { price_book_item_id: "", description: "   ", detail: "", quantity: "", unit: "", unit_price: "", basis: "note", why: "" },
  ],
  scope: ["Tear off and replace roof", "", "Replace gutters"],
  notes: "Claim #12-3456. RCV $18,402.11",
};

describe("normalizeSuggestion", () => {
  it("turns empty strings into null and drops blank lines", () => {
    const s = normalizeSuggestion(raw);
    expect(s.customer_phone).toBeNull();
    expect(s.lines).toHaveLength(4);
    expect(s.lines[2].price_book_item_id).toBeNull();
    expect(s.lines[3].basis).toBe("document"); // unknown basis falls back
    expect(s.scope).toEqual(["Tear off and replace roof", "Replace gutters"]);
  });
  it("survives garbage", () => {
    expect(normalizeSuggestion(null).lines).toEqual([]);
    expect(normalizeSuggestion({ lines: "x", scope: 3 }).scope).toEqual([]);
  });
});

describe("mergeSuggestion", () => {
  const sug = normalizeSuggestion(raw);

  it("fills blank fields, adds lines, keeps our prices", () => {
    const r = mergeSuggestion(emptyEstimate(), sug, PRICE_BOOK);
    expect(r.form.customerName).toBe("Jerome Behr");
    expect(r.form.tag).toBe("INSURANCE CLAIM");
    expect(r.filled).toEqual(["customer name", "job site address", "subtitle", "tag"]);
    expect(r.added).toBe(4);
    const [roof, gutter, screen, retired] = r.form.lines;
    // Price-book price wins over the insurance unit price.
    expect(roof).toMatchObject({ priceBookItemId: ROOF, qty: "28.6", unit: "sq", rate: "650.00" });
    expect(roof.note).toContain("Hover report");
    // No price-book price: the document's price fills the gap, and says so.
    expect(gutter).toMatchObject({ priceBookItemId: GUTTER, qty: "142", rate: "11.25" });
    expect(gutter.note).toContain("document's price");
    // Custom line with no quantity or price: flagged, and blocks saving until priced.
    expect(screen).toMatchObject({ priceBookItemId: null, qty: "", rate: "" });
    expect(screen.note).toMatch(/No quantity found.*Not in the price book/);
    // A retired price-book item is treated as a custom line.
    expect(retired.priceBookItemId).toBeNull();
    expect(r.needPrice).toBe(2);
    expect(r.form.scope).toBe("Tear off and replace roof\nReplace gutters");
  });

  it("never overwrites what Nick already typed", () => {
    const mine: EstimateFormInput = {
      ...emptyEstimate(),
      customerName: "Nick's Customer",
      scope: "My scope",
      lines: [{ priceBookItemId: ROOF, description: "Roof", detail: "", qty: "30", unit: "sq", rate: "700" }],
    };
    const r = mergeSuggestion(mine, sug, PRICE_BOOK);
    expect(r.form.customerName).toBe("Nick's Customer");
    expect(r.form.scope).toBe("My scope");
    expect(r.form.lines[0]).toMatchObject({ qty: "30", rate: "700" });
    expect(r.form.lines.filter((l) => l.priceBookItemId === ROOF)).toHaveLength(1);
    expect(r.alreadyOn[0]).toContain("28.6 sq");
    expect(r.added).toBe(3);
  });
});

describe("cleanAttachments", () => {
  const id = "0f8fad5b-d9cb-469f-a165-70867728950e";
  it("keeps only well-formed, unique entries", () => {
    expect(
      cleanAttachments([
        { uploadId: id, ext: "pdf", fileName: "Hover report.pdf" },
        { uploadId: id, ext: "pdf", fileName: "dup.pdf" },
        { uploadId: "../../etc", ext: "pdf", fileName: "x" },
        { uploadId: "0f8fad5b-d9cb-469f-a165-70867728950f", ext: "exe", fileName: "x" },
        { uploadId: "0f8fad5b-d9cb-469f-a165-70867728950a", ext: "jpg" },
      ]),
    ).toEqual([
      { uploadId: id, ext: "pdf", fileName: "Hover report.pdf" },
      { uploadId: "0f8fad5b-d9cb-469f-a165-70867728950a", ext: "jpg", fileName: "file.jpg" },
    ]);
    expect(cleanAttachments("nope")).toEqual([]);
  });
});
