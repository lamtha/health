// GI-MAP section headers, in declaration order so we can detect them as the
// parser walks lines top-to-bottom. The `panel` is the canonical panel name
// we'll write to the metrics row. Patterns intentionally anchor at the start
// of the line and don't require the trailing column header (` Result Reference`)
// because some vintages print it on a separate line.

export interface SectionSpec {
  pattern: RegExp;
  panel: string;
}

export const SECTION_SPECS: SectionSpec[] = [
  { pattern: /^BACTERIAL PATHOGENS\b/i, panel: "Bacterial Pathogens" },
  { pattern: /^PARASITIC PATHOGENS\b/i, panel: "Parasitic Pathogens" },
  { pattern: /^VIRAL PATHOGENS\b/i, panel: "Viral Pathogens" },
  {
    pattern: /^H\.\s*PYLORI\s*&?\s*VIRULENCE FACTORS\b/i,
    panel: "H. pylori & Virulence Factors",
  },
  { pattern: /^COMMENSAL BACTERIA\b/i, panel: "Commensal/Keystone Bacteria" },
  { pattern: /^BACTERIAL PHYLA\b/i, panel: "Bacterial Phyla" },
  {
    pattern: /^DYSBIOTIC\s*&?\s*OVERGROWTH BACTERIA\b/i,
    panel: "Dysbiotic & Overgrowth Bacteria",
  },
  {
    pattern: /^COMMENSAL OVERGROWTH MICROBES\b/i,
    panel: "Commensal Overgrowth Microbes",
  },
  {
    pattern: /^INFLAMMATORY\s*&?\s*AUTOIMMUNE-?RELATED BACTERIA\b/i,
    panel: "Inflammatory & Autoimmune Bacteria",
  },
  {
    pattern: /^COMMENSAL INFLAMMATORY\s*&?\s*AUTOIMMUNE-?RELATED BACTERIA\b/i,
    panel: "Commensal Inflammatory Bacteria",
  },
  { pattern: /^FUNGI\s*\/\s*YEAST\b/i, panel: "Fungi/Yeast" },
  { pattern: /^VIRUSES\b/i, panel: "Viruses" },
  { pattern: /^PROTOZOA\b/i, panel: "Parasites: Protozoa" },
  { pattern: /^WORMS\b/i, panel: "Parasites: Worms" },
  { pattern: /^DIGESTION\b/i, panel: "Intestinal Health: Digestion" },
  { pattern: /^GI MARKERS\b/i, panel: "Intestinal Health: GI Markers" },
  {
    pattern: /^IMMUNE RESPONSE\b/i,
    panel: "Intestinal Health: Immune Response",
  },
  { pattern: /^INFLAMMATION\b/i, panel: "Intestinal Health: Inflammation" },
  { pattern: /^ADD-ON TESTS\b/i, panel: "Intestinal Health: Add-On Tests" },
  { pattern: /^PRIMARY BILE ACIDS\b/i, panel: "Primary Bile Acids" },
  { pattern: /^SECONDARY BILE ACIDS\b/i, panel: "Secondary Bile Acids" },
  {
    pattern: /^SACCHAROLYTIC STRAIGHT CHAIN FATTY ACIDS\b/i,
    panel: "Short Chain Fatty Acids (SCFA)",
  },
  {
    pattern: /^PROTEOLYTIC BRANCHED CHAIN FATTY ACIDS\b/i,
    panel: "Branched Chain Fatty Acids (BCFA)",
  },
  {
    pattern: /^H\.\s*PYLORI ANTIBIOTIC RESISTANCE GENES?\b/i,
    panel: "H. pylori Antibiotic Resistance",
  },
  { pattern: /^BILE ACIDS\s*[-–]\s*SUMMARY\b/i, panel: "Bile Acids Summary" },
  {
    pattern: /^SHORT CHAIN FATTY ACIDS\s*[-–]\s*SUMMARY\b/i,
    panel: "SCFA Summary",
  },
  { pattern: /^BILE ACIDS\s*[-–]\s*RESULTS\b/i, panel: "Bile Acids" },
  {
    pattern: /^SHORT CHAIN FATTY ACIDS\s*[-–]\s*RESULTS\b/i,
    panel: "Short Chain Fatty Acids",
  },
];

// Lines that look like section headers / column-header rows and should not
// be parsed as data rows.
const HEADER_NOISE_RE = [
  /^Result\s+Reference/i,
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
const UMBRELLA_BANNERS = [
  /^PATHOGENS\b/,
  /^OPPORTUNISTIC\/OVERGROWTH MICROBES\b/i,
  /^HELICOBACTER PYLORI\b/i,
  /^COMMENSAL\/KEYSTONE BACTERIA\b/i,
  /^INTESTINAL HEALTH MARKERS\b/i,
  /^PARASITES\s*$/i,
  /^SUMMARY INFO\b/i,
  /^BILE ACIDS AND FATTY ACIDS OVERVIEW\b/i,
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
