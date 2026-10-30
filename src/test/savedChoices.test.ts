import { beforeEach, describe, expect, it } from "vitest";
import { loadLikedArtists, saveLikedArtists } from "../pages/pickedArtists";
import { loadCity, saveCity } from "../pages/savedCity";

beforeEach(() => localStorage.clear());

describe("liked artists", () => {
  it("are remembered as saved, IDs and disambiguations included", () => {
    const list = [{ name: "Fuzz", id: "a1", disambiguation: "USA rock band" }, { name: "Ty Segall" }];
    saveLikedArtists(list);
    expect(loadLikedArtists()).toEqual(list);
  });

  it("start empty when nothing (or something unreadable) is saved", () => {
    expect(loadLikedArtists()).toEqual([]);
    localStorage.setItem("likedArtists", "{not json");
    expect(loadLikedArtists()).toEqual([]);
    localStorage.setItem("likedArtists", JSON.stringify({ name: "x" }));
    expect(loadLikedArtists()).toEqual([]);
  });

  it("skip bad entries and duplicates", () => {
    localStorage.setItem("likedArtists", JSON.stringify([
      { name: "Osees", id: 5 }, null, { id: "b" }, { name: "  " }, { name: "osees" }, { name: "Oh Sees", id: "c" },
    ]));
    expect(loadLikedArtists()).toEqual([{ name: "Osees" }, { name: "Oh Sees", id: "c" }]);
  });
});

describe("last city", () => {
  it("is remembered with its Pollstar id", () => {
    const berlin = { id: "65443", name: "Berlin, Germany", city: "Berlin", state: null, rank: 9 };
    saveCity(berlin);
    expect(loadCity()).toEqual(berlin);
  });

  it("is nothing when none (or no usable one) is saved", () => {
    expect(loadCity()).toBeNull();
    localStorage.setItem("discover.city", JSON.stringify({ name: "Berlin" }));
    expect(loadCity()).toBeNull();
    localStorage.setItem("discover.city", "nope");
    expect(loadCity()).toBeNull();
  });
});
