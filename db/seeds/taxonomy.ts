// Canonical taxonomy for metric classification.
//
// Primary `category` is required on every canonical metric (one value).
// `tags` are optional cross-cutting themes (zero or more).
//
// String-union types are derived from these tuples so the seed file and
// filter UI share the exact same slug set.

export const CATEGORIES = [
  "cbc",
  "cmp",
  "lipids",
  "inflammation",
  "thyroid",
  "hormones",
  "nutrients",
  "kidney",
  "liver",
  "glycemic",
  "gi-microbiome",
  "gi-pathogens",
  "gi-inflammation",
  "gi-digestion",
  "sibo",
  "aging",
  "imaging",
  "organic-acids",
  "mycotoxins",
  "other",
] as const;
export type CategorySlug = (typeof CATEGORIES)[number];

export const TAGS = [
  "longevity",
  "cardio-risk",
  "autoimmunity",
  "methylation",
  "iron-status",
  "insulin-resistance",
  "gut-barrier",
  "sibo-theme",
] as const;
export type TagSlug = (typeof TAGS)[number];

export const CATEGORY_LABELS: Record<CategorySlug, string> = {
  cbc: "CBC",
  cmp: "Comprehensive metabolic",
  lipids: "Lipids",
  inflammation: "Inflammation",
  thyroid: "Thyroid",
  hormones: "Hormones",
  nutrients: "Nutrients",
  kidney: "Kidney",
  liver: "Liver",
  glycemic: "Glycemic",
  "gi-microbiome": "GI · microbiome",
  "gi-pathogens": "GI · pathogens",
  "gi-inflammation": "GI · inflammation",
  "gi-digestion": "GI · digestion",
  sibo: "SIBO",
  aging: "Aging",
  imaging: "Imaging",
  "organic-acids": "Organic acids",
  mycotoxins: "Mycotoxins",
  other: "Other",
};

export const TAG_LABELS: Record<TagSlug, string> = {
  longevity: "Longevity",
  "cardio-risk": "Cardio risk",
  autoimmunity: "Autoimmunity",
  methylation: "Methylation",
  "iron-status": "Iron status",
  "insulin-resistance": "Insulin resistance",
  "gut-barrier": "Gut barrier",
  "sibo-theme": "SIBO theme",
};

export function isCategorySlug(v: string): v is CategorySlug {
  return (CATEGORIES as readonly string[]).includes(v);
}

export function isTagSlug(v: string): v is TagSlug {
  return (TAGS as readonly string[]).includes(v);
}
