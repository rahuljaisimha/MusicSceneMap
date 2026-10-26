import { describe, it, expect } from "vitest";
import { relationSentence } from "../graph/relationships";

describe("relationSentence", () => {
  it("reads the edge the way it points", () => {
    expect(relationSentence("member_of", "Ty Segall", "Fuzz", true)).toBe("Ty Segall is a member of Fuzz");
    expect(relationSentence("member_of", "Fuzz", "Ty Segall", false)).toBe("Ty Segall is a member of Fuzz");
    expect(relationSentence("opened_for", "Osees", "Flat Worms", false)).toBe("Flat Worms opened for Osees");
    expect(relationSentence("produced_for", "Ty Segall", "White Fence", true)).toBe("Ty Segall produced White Fence's records");
  });

  it("names the relationship without a direction when it's unknown", () => {
    expect(relationSentence("former_member_of", "CFM", "Charles Moothart")).toBe("CFM and Charles Moothart: former member");
  });
});
