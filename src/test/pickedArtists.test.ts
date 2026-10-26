import { describe, it, expect } from "vitest";
import { addPicked, chipLabel, inputArtist, pickedKey } from "../pages/pickedArtists";

const band = { name: "Fuzz", id: "fuzz-band", disambiguation: "USA rock band" };
const bassist = { name: "Fuzz", id: "fuzz-bassist", disambiguation: "Disturbed bassist Steve Kmak" };

describe("picked artists", () => {
  it("keeps two artists with the same name apart, and drops repeats", () => {
    let list = addPicked([], band);
    list = addPicked(list, bassist);
    list = addPicked(list, band);
    expect(list.map(pickedKey)).toEqual(["mbid:fuzz-band", "mbid:fuzz-bassist"]);
  });

  it("dedupes typed names case-insensitively and ignores blanks", () => {
    expect(addPicked(addPicked([], { name: " Osees " }), { name: "osees" })).toEqual([{ name: "Osees" }]);
    expect(addPicked([], { name: "  " })).toEqual([]);
  });

  it("labels a chip with its disambiguation only when another chip has the same name", () => {
    expect(chipLabel(band, [band])).toBe("Fuzz");
    expect(chipLabel(band, [band, bassist])).toBe("Fuzz (USA rock band)");
  });

  it("uses the pick only while its name is still in the input", () => {
    expect(inputArtist("Fuzz", band)).toBe(band);
    expect(inputArtist("Fuzz Club", band)).toEqual({ name: "Fuzz Club" });
    expect(inputArtist(" Osees ", null)).toEqual({ name: "Osees" });
  });
});
