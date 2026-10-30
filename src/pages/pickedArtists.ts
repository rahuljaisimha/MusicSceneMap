/**
 * The artists a user adds on Similarity and Discover. One picked from the
 * dropdown keeps its MusicBrainz ID, so lookups use that exact artist: several
 * artists can share a name ("Fuzz", the USA rock band, and "Fuzz", Disturbed's
 * bassist). A name typed and added without picking has no ID and is looked up
 * by name.
 */

import type { ArtistSuggestion } from "../db/artistSuggest";

export interface PickedArtist {
  name: string;
  /** MusicBrainz ID, when picked from the dropdown. */
  id?: string;
  /** MusicBrainz disambiguation, to tell same-name chips apart. */
  disambiguation?: string;
}

export function fromSuggestion(s: ArtistSuggestion): PickedArtist {
  return { name: s.name, id: s.id, ...(s.disambiguation ? { disambiguation: s.disambiguation } : {}) };
}

/** Identity in a list: the ID when there is one, else the name (case-insensitive). */
export function pickedKey(a: PickedArtist): string {
  return a.id ? `mbid:${a.id}` : `name:${a.name.trim().toLowerCase()}`;
}

/** The list with `a` added at the end, unless it's already there. */
export function addPicked(list: PickedArtist[], a: PickedArtist): PickedArtist[] {
  const name = a.name.trim();
  if (!name) return list;
  const added = { ...a, name };
  return list.some((x) => pickedKey(x) === pickedKey(added)) ? list : [...list, added];
}

/** A chip's text: the name, plus its disambiguation when another artist in the list has the same name. */
export function chipLabel(a: PickedArtist, list: PickedArtist[]): string {
  const same = list.filter((x) => x.name.toLowerCase() === a.name.toLowerCase());
  return same.length > 1 && a.disambiguation ? `${a.name} (${a.disambiguation})` : a.name;
}

/** What the compare/target input means: the picked artist while its name is still in the input, else the typed text. */
export function inputArtist(text: string, picked: PickedArtist | null): PickedArtist {
  const name = text.trim();
  return picked && picked.name === name ? picked : { name };
}

const STORAGE_KEY = "likedArtists";

/**
 * The artists you like, shared by Similarity and Discover and remembered in this
 * browser, so they're there on the other page and after a reload.
 */
export function loadLikedArtists(): PickedArtist[] {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null");
    if (!Array.isArray(saved)) return [];
    let list: PickedArtist[] = [];
    for (const a of saved) {
      if (!a || typeof a.name !== "string") continue;
      list = addPicked(list, {
        name: a.name,
        ...(typeof a.id === "string" && a.id ? { id: a.id } : {}),
        ...(typeof a.disambiguation === "string" && a.disambiguation ? { disambiguation: a.disambiguation } : {}),
      });
    }
    return list;
  } catch {
    return [];
  }
}

export function saveLikedArtists(list: PickedArtist[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  } catch {
    /* not remembered */
  }
}
