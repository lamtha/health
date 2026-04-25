// GI-MAP section headers, in declaration order so we can detect them as the
// parser walks lines top-to-bottom. The `panel` is the canonical panel name
// we'll write to the metrics row. Patterns intentionally anchor at the start
// of the line and don't require the trailing column header (` Result Reference`)
// because some vintages print it on a separate line.

export interface SectionSpec {
  pattern: RegExp;
  panel: string;
}

// Section header patterns. All-caps in the GI-MAP PDF — case-sensitive
// matches keep them from accidentally claiming Title-Case data rows
// like "Primary Bile Acids - %" (a SCFA-summary row that shouldn't
// route to the Primary Bile Acids panel).
export const SECTION_SPECS: SectionSpec[] = [
  { pattern: /^BACTERIAL PATHOGENS\b/, panel: "Bacterial Pathogens" },
  { pattern: /^PARASITIC PATHOGENS\b/, panel: "Parasitic Pathogens" },
  { pattern: /^VIRAL PATHOGENS\b/, panel: "Viral Pathogens" },
  {
    pattern: /^H\.\s*PYLORI\s*&?\s*VIRULENCE FACTORS\b/,
    panel: "H. pylori & Virulence Factors",
  },
  { pattern: /^COMMENSAL BACTERIA\b/, panel: "Commensal/Keystone Bacteria" },
  { pattern: /^BACTERIAL PHYLA\b/, panel: "Bacterial Phyla" },
  {
    pattern: /^DYSBIOTIC\s*&?\s*OVERGROWTH BACTERIA\b/,
    panel: "Dysbiotic & Overgrowth Bacteria",
  },
  {
    pattern: /^COMMENSAL OVERGROWTH MICROBES\b/,
    panel: "Commensal Overgrowth Microbes",
  },
  {
    pattern: /^INFLAMMATORY\s*&?\s*AUTOIMMUNE-?RELATED BACTERIA\b/,
    panel: "Inflammatory & Autoimmune Bacteria",
  },
  {
    pattern: /^COMMENSAL INFLAMMATORY\s*&?\s*AUTOIMMUNE-?RELATED BACTERIA\b/,
    panel: "Commensal Inflammatory Bacteria",
  },
  { pattern: /^FUNGI\s*\/\s*YEAST\b/, panel: "Fungi/Yeast" },
  { pattern: /^VIRUSES\b/, panel: "Viruses" },
  { pattern: /^PROTOZOA\b/, panel: "Parasites: Protozoa" },
  { pattern: /^WORMS\b/, panel: "Parasites: Worms" },
  { pattern: /^DIGESTION\b/, panel: "Intestinal Health: Digestion" },
  { pattern: /^GI MARKERS\b/, panel: "Intestinal Health: GI Markers" },
  {
    pattern: /^IMMUNE RESPONSE\b/,
    panel: "Intestinal Health: Immune Response",
  },
  { pattern: /^INFLAMMATION\b/, panel: "Intestinal Health: Inflammation" },
  { pattern: /^ADD-ON TESTS\b/, panel: "Intestinal Health: Add-On Tests" },
  { pattern: /^PRIMARY BILE ACIDS\b/, panel: "Primary Bile Acids" },
  { pattern: /^SECONDARY BILE ACIDS\b/, panel: "Secondary Bile Acids" },
  {
    pattern: /^SACCHAROLYTIC STRAIGHT CHAIN FATTY ACIDS\b/,
    panel: "Short Chain Fatty Acids (SCFA)",
  },
  {
    pattern: /^PROTEOLYTIC BRANCHED CHAIN FATTY ACIDS\b/,
    panel: "Branched Chain Fatty Acids (BCFA)",
  },
  {
    pattern: /^H\.\s*PYLORI ANTIBIOTIC RESISTANCE GENES?\b/,
    panel: "H. pylori Antibiotic Resistance",
  },
  { pattern: /^BILE ACIDS\s*[-–]\s*SUMMARY\b/, panel: "Bile Acids Summary" },
  {
    pattern: /^SHORT CHAIN FATTY ACIDS\s*[-–]\s*SUMMARY\b/,
    panel: "SCFA Summary",
  },
  { pattern: /^BILE ACIDS\s*[-–]\s*RESULTS\b/, panel: "Bile Acids" },
  {
    pattern: /^SHORT CHAIN FATTY ACIDS\s*[-–]\s*RESULTS\b/,
    panel: "Short Chain Fatty Acids",
  },
];

// Lines that look like section headers / column-header rows and should not
// be parsed as data rows.
const HEADER_NOISE_RE = [
  /^Result(\s+\S+)?\s+Reference(\s+\S+)?\s*$/i,
  /^Abbreviation\b/i,
  /^Conjugation/i,
  /^The assays were developed/i,
  /^determined by Diagnostic Solutions Laboratory/i,
  /^KEY:/i,
  /^DNA STOOL ANALYSIS/i,
  /^YOUR PERSONALIZED REPORT/i,
  /^Patient:/i,
  /^Accession:/i,
  /^Collected:/i,
  /^Received:/i,
  /^DOB:/i,
  /^Completed:/i,
  /^Ordered by:/i,
  /^CLIA#/i,
  /^Medical Director/i,
  /^\d+\s*$/, // page numbers
  /^Genes associated with/i,
  /^Reference set at/i,
  /^based on absolute values/i,
  /^Ratio of total straight chain/i,
  /^\*LCA/, // footnote
];

export function isNoiseLine(line: string): boolean {
  for (const re of HEADER_NOISE_RE) if (re.test(line)) return true;
  return false;
}

// All-caps banners that are umbrella section headers but don't change panel
// (they precede a more-specific subsection like "BACTERIAL PATHOGENS").
// Anchored to end-of-line — banners always sit alone on their line, and
// without `$` the pattern would also match data rows that happen to start
// with the banner text (e.g. case-insensitive "Helicobacter pylori 1.91e2 …"
// would match `/^HELICOBACTER PYLORI\b/i` and the data row gets dropped).
const UMBRELLA_BANNERS = [
  /^PATHOGENS\s*$/,
  /^OPPORTUNISTIC\/OVERGROWTH MICROBES\s*$/i,
  /^HELICOBACTER PYLORI\s*$/i,
  /^COMMENSAL\/KEYSTONE BACTERIA\s*$/i,
  /^INTESTINAL HEALTH MARKERS\s*$/i,
  /^PARASITES\s*$/i,
  /^SUMMARY INFO\s*$/i,
  /^BILE ACIDS AND FATTY ACIDS OVERVIEW\s*$/i,
];

export function isUmbrellaBanner(line: string): boolean {
  for (const re of UMBRELLA_BANNERS) if (re.test(line)) return true;
  return false;
}

export function findSection(line: string): SectionSpec | null {
  for (const spec of SECTION_SPECS) {
    if (spec.pattern.test(line)) return spec;
  }
  return null;
}
