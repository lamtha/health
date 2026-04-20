import { describe, expect, it } from "vitest";

import {
  applyLossyFixes,
  applySelfHealSkips,
  buildClaudePrompt,
  chunk,
  parseClaudeResponse,
  recategorizeOther,
  sanitizeNewCanonical,
  type FixupProposal,
} from "@/lib/bulk-map-util";

describe("chunk", () => {
  it("splits an array into batches of the requested size", () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });

  it("returns an empty array for an empty input", () => {
    expect(chunk([], 10)).toEqual([]);
  });
});

describe("buildClaudePrompt", () => {
  it("includes the existing canonicals, allowed slugs, and the batch", () => {
    const prompt = buildClaudePrompt(
      [{ canonicalName: "White Blood Cells", category: "cbc" }],
      [
        {
          rawName: "WBC Count",
          occurrenceCount: 3,
          sampleProviders: ["quest", "labcorp"],
        },
      ],
    );
    expect(prompt).toContain(`"White Blood Cells"  (cbc)`);
    expect(prompt).toContain("ALLOWED CATEGORIES:");
    expect(prompt).toContain("ALLOWED TAGS:");
    expect(prompt).toContain(`"WBC Count"  (seen 3× across providers: quest, labcorp)`);
  });
});

describe("parseClaudeResponse", () => {
  it("extracts JSON from a response wrapped in prose", () => {
    const text = `Here's the mapping:\n\n{"proposals": [{"rawName": "WBC", "action": "skip", "reason": "header", "confidence": 0.9}]}\n\nDone.`;
    const parsed = parseClaudeResponse(text);
    expect(parsed.proposals).toHaveLength(1);
    expect(parsed.proposals[0].action).toBe("skip");
  });

  it("extracts JSON even when wrapped in markdown fences", () => {
    const text = "```json\n{\"proposals\": []}\n```";
    const parsed = parseClaudeResponse(text);
    expect(parsed.proposals).toEqual([]);
  });

  it("throws when no JSON object is present", () => {
    expect(() => parseClaudeResponse("no json here")).toThrow(
      /no JSON object/,
    );
  });
});

describe("sanitizeNewCanonical", () => {
  it("coerces an unknown category to 'other' and drops unknown tags", () => {
    const out = sanitizeNewCanonical({
      canonicalName: "Foo",
      category: "bogus-category",
      tags: ["longevity", "made-up-tag"],
      preferredUnits: null,
      description: "",
    });
    expect(out.category).toBe("other");
    expect(out.originalCategory).toBe("bogus-category");
    expect(out.tags).toEqual(["longevity"]);
    expect(out.droppedTags).toEqual(["made-up-tag"]);
  });

  it("passes through a valid slug unchanged", () => {
    const out = sanitizeNewCanonical({
      canonicalName: "Foo",
      category: "gi-microbiome",
      tags: ["gut-barrier"],
      preferredUnits: "CFU/g",
      description: "x",
    });
    expect(out.category).toBe("gi-microbiome");
    expect(out.tags).toEqual(["gut-barrier"]);
    expect(out.droppedTags).toEqual([]);
  });
});

describe("applyLossyFixes", () => {
  const escherichiaMapExisting: FixupProposal = {
    rawName: "Escherichia spp.",
    action: "map_existing",
    proposedCanonicalName: "Escherichia coli",
  };
  const unaffectedSkip: FixupProposal = {
    rawName: "Total",
    action: "skip",
    reason: "header",
  };

  it("converts the two known-lossy map_existing cases to create_new", () => {
    const { proposals, fixed } = applyLossyFixes([escherichiaMapExisting, unaffectedSkip]);
    expect(fixed).toBe(1);
    expect(proposals[0].action).toBe("create_new");
    expect(proposals[0].newCanonical?.canonicalName).toBe("Escherichia spp.");
    expect(proposals[0].newCanonical?.category).toBe("gi-microbiome");
    expect(proposals[1]).toEqual(unaffectedSkip);
  });

  it("is idempotent — re-running produces the same proposals", () => {
    const first = applyLossyFixes([escherichiaMapExisting]);
    const second = applyLossyFixes(first.proposals);
    expect(second.fixed).toBe(0);
    expect(second.proposals[0].action).toBe("create_new");
  });
});

describe("applySelfHealSkips", () => {
  it("folds a skipped rawName into the matching create_new's extraAliases", () => {
    const proposals: FixupProposal[] = [
      {
        rawName: "Akkermansia muciniphila",
        action: "create_new",
        proposedCanonicalName: "Akkermansia muciniphila",
        newCanonical: {
          canonicalName: "Akkermansia muciniphila",
          category: "gi-microbiome",
          tags: [],
          preferredUnits: null,
          description: "keystone commensal",
        },
      },
      {
        rawName: "A. muciniphila",
        action: "skip",
        reason: `Claude proposed map_existing to "Akkermansia muciniphila" but no such canonical exists — needs human review`,
      },
    ];
    const out = applySelfHealSkips(proposals);
    expect(out.selfHealed).toBe(1);
    expect(out.proposals).toHaveLength(1);
    expect(out.proposals[0].extraAliases).toEqual(["A. muciniphila"]);
  });

  it("leaves skips alone when the target create_new is absent", () => {
    const proposals: FixupProposal[] = [
      {
        rawName: "A. muciniphila",
        action: "skip",
        reason: `Claude proposed map_existing to "Akkermansia muciniphila" but no such canonical exists`,
      },
    ];
    const out = applySelfHealSkips(proposals);
    expect(out.selfHealed).toBe(0);
    expect(out.proposals).toHaveLength(1);
  });

  it("is idempotent", () => {
    const proposals: FixupProposal[] = [
      {
        rawName: "Target",
        action: "create_new",
        newCanonical: {
          canonicalName: "Target",
          category: "other",
          tags: [],
          preferredUnits: null,
          description: "",
        },
      },
      {
        rawName: "Syn",
        action: "skip",
        reason: `Claude proposed map_existing to "Target" but no such canonical exists`,
      },
    ];
    const first = applySelfHealSkips(proposals);
    const second = applySelfHealSkips(first.proposals);
    expect(second.selfHealed).toBe(0);
    expect(second.proposals[0].extraAliases).toEqual(["Syn"]);
  });
});

describe("recategorizeOther", () => {
  const makeOther = (name: string, description = "", preferredUnits: string | null = null): FixupProposal => ({
    rawName: name,
    action: "create_new",
    newCanonical: {
      canonicalName: name,
      category: "other",
      tags: [],
      preferredUnits,
      description,
    },
  });

  it("recategorizes mycotoxins by known name", () => {
    const out = recategorizeOther([makeOther("Ochratoxin A")]);
    expect(out.recategorized).toBe(1);
    expect(out.proposals[0].newCanonical?.category).toBe("mycotoxins");
    expect(out.countsByCategory.mycotoxins).toBe(1);
  });

  it("recategorizes organic acids by description or creatinine units", () => {
    const byDesc = recategorizeOther([
      makeOther("Foo", "urine organic acid marker"),
    ]);
    expect(byDesc.proposals[0].newCanonical?.category).toBe("organic-acids");

    const byUnits = recategorizeOther([
      makeOther("Bar", "n/a", "mcg/mg creatinine"),
    ]);
    expect(byUnits.proposals[0].newCanonical?.category).toBe("organic-acids");
  });

  it("recategorizes specific fatty acids into lipids", () => {
    const out = recategorizeOther([makeOther("Linoleic Acid")]);
    expect(out.proposals[0].newCanonical?.category).toBe("lipids");
  });

  it("recategorizes neurotransmitter metabolites into hormones", () => {
    const out = recategorizeOther([
      makeOther("Serotonin", "measures a neurotransmitter"),
    ]);
    expect(out.proposals[0].newCanonical?.category).toBe("hormones");
  });

  it("leaves untouched rows in 'other' when no rule matches", () => {
    const out = recategorizeOther([makeOther("Widget", "unrelated")]);
    expect(out.recategorized).toBe(0);
    expect(out.proposals[0].newCanonical?.category).toBe("other");
  });
});
