// GI-MAP signature: the brand text "GI-MAP" lives in a logo image, not the
// extractable text layer. Detection therefore leans on (a) the lab footer
// printed on every page and (b) a quorum of section headers unique to
// Diagnostic Solutions Laboratory's GI-MAP layout.

const SECTION_PATTERNS: RegExp[] = [
  /\bBACTERIAL PATHOGENS\b/,
  /\bH\.\s*PYLORI\b/i,
  /\bCOMMENSAL[/\s-]*KEYSTONE BACTERIA\b/i,
  /\bOPPORTUNISTIC[/\s-]*OVERGROWTH\b/i,
  /\bFUNGI\s*\/\s*YEAST\b/i,
  /\bINTESTINAL HEALTH MARKERS?\b/i,
  /\bANTIBIOTIC RESISTANCE GENES?\b/i,
  /\bDNA STOOL ANALYSIS BY QUANTITATIVE PCR\b/i,
];

export function detect(text: string): boolean {
  if (!/Diagnostic Solutions Laboratory/i.test(text)) return false;
  let hits = 0;
  for (const re of SECTION_PATTERNS) {
    if (re.test(text)) hits += 1;
    if (hits >= 3) return true;
  }
  return false;
}
