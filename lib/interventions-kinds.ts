// Plain module (no "server-only") so client components can import the
// intervention-kind enum without pulling the whole DB layer in.

export const INTERVENTION_KINDS = [
  "supplement",
  "med",
  "diet",
  "protocol",
] as const;

export type InterventionKind = (typeof INTERVENTION_KINDS)[number];
