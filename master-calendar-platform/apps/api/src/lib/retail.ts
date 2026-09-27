// Retailer handoff, v1: links, not integrations. Amazon and Target have no public cart
// APIs (and we never automate anyone's login), so we build the best link each allows:
// Amazon's add-to-cart URL for items with a saved ASIN, product pages for saved
// Target TCINs / Walmart item ids, and store searches for everything else.
// Kroger and Instacart (real cart APIs) come in the retailer step.

export type HandoffRetailer = "amazon" | "target" | "walmart";

interface Item {
  name: string;
  quantity: string | null;
  retailerRefs: unknown;
}

export interface Handoff {
  retailer: HandoffRetailer;
  /** One link that fills the cart with every matched item (Amazon only). */
  cartUrl: string | null;
  items: { name: string; url: string; kind: "cart" | "product" | "search" }[];
}

const ref = (refs: unknown, retailer: string, key: string): string | null => {
  const v = (refs as Record<string, Record<string, unknown>> | null)?.[retailer]?.[key];
  return typeof v === "string" && /^[A-Za-z0-9-]{1,40}$/.test(v) ? v : null;
};
const qty = (q: string | null) => {
  const n = Number.parseInt(q ?? "", 10);
  return Number.isFinite(n) && n > 0 && n < 100 ? n : 1;
};

export function buildHandoff(retailer: HandoffRetailer, items: Item[]): Handoff {
  const q = encodeURIComponent;
  if (retailer === "amazon") {
    const withAsin = items.filter((i) => ref(i.retailerRefs, "amazon", "asin"));
    let cartUrl: string | null = null;
    if (withAsin.length) {
      const params = withAsin.flatMap((i, n) => [`ASIN.${n + 1}=${ref(i.retailerRefs, "amazon", "asin")}`, `Quantity.${n + 1}=${qty(i.quantity)}`]);
      cartUrl = `https://www.amazon.com/gp/aws/cart/add.html?${params.join("&")}`;
    }
    return {
      retailer,
      cartUrl,
      items: items.map((i) => {
        const asin = ref(i.retailerRefs, "amazon", "asin");
        return asin
          ? { name: i.name, url: `https://www.amazon.com/dp/${asin}`, kind: "cart" as const }
          : { name: i.name, url: `https://www.amazon.com/s?k=${q(i.name)}`, kind: "search" as const };
      }),
    };
  }
  if (retailer === "target") {
    return {
      retailer,
      cartUrl: null,
      items: items.map((i) => {
        const tcin = ref(i.retailerRefs, "target", "tcin");
        return tcin
          ? { name: i.name, url: `https://www.target.com/p/-/A-${tcin}`, kind: "product" as const }
          : { name: i.name, url: `https://www.target.com/s?searchTerm=${q(i.name)}`, kind: "search" as const };
      }),
    };
  }
  return {
    retailer,
    cartUrl: null,
    items: items.map((i) => {
      const id = ref(i.retailerRefs, "walmart", "itemId");
      return id
        ? { name: i.name, url: `https://www.walmart.com/ip/${id}`, kind: "product" as const }
        : { name: i.name, url: `https://www.walmart.com/search?q=${q(i.name)}`, kind: "search" as const };
    }),
  };
}
