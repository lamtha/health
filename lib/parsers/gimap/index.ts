export { detect } from "./detect";
export { parsePdf, parseText } from "./parse";

export const name = "gimap";
// Bump when parser rules meaningfully change. Used in extractions.extractor_version
// so we can identify reports parsed by an older parser and re-extract them.
//
// v1: initial release.
// v2: row-shape fixes (analyte+value+range triple completion for split layouts
//     like page-8 Caproate); bile-acid abbreviation+conjugation column strip;
//     case-sensitive section patterns (avoid Title-Case data row collisions);
//     drop emit when neither numeric nor text value recovered (no ghost rows
//     for the page-5 antibiotic resistance gene table when H. pylori is below
//     detection); Helicobacter-banner regex tightened so the actual H. pylori
//     data row isn't filtered as a banner.
export const version = 2;
