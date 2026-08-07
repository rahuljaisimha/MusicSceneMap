import { GAME_ARTISTS } from "./artists";
import {
  searchArtists,
  getArtistWithRelations,
  extractMembers,
  extractBands,
  extractSupportMusicians,
  extractSupportedBands,
  type MBArtist,
} from "../api/musicbrainz";
import { debugLog } from "../debug/DebugLog";

/**
 * A chain link in the game path.
 * The full chain is: person → band → person → band → person
 */
export interface ChainLink {
  id: string; // MBID
  name: string;
  type: "person" | "group";
}

export interface GameChain {
  /** The full 5-step path: [person, band, person, band, person] */
  chain: [ChainLink, ChainLink, ChainLink, ChainLink, ChainLink];
}

/**
 * Pick a random element from an array.
 */
function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]!;
}

/**
 * Check if a member looks like a "lead" (vocalist or guitarist) based on common heuristics.
 * MusicBrainz doesn't always have role info at the artist-rel level, so we prefer
 * artists whose name appears prominently or we just pick randomly.
 */
function preferLead(members: Array<{ artist: MBArtist; current: boolean }>): MBArtist | null {
  // Prefer current members
  const current = members.filter((m) => m.current);
  const pool = current.length > 0 ? current : members;
  if (pool.length === 0) return null;
  return pickRandom(pool).artist;
}

/**
 * Get all bands a person is connected to (member + supported).
 */
async function getBandsForPerson(mbid: string): Promise<Array<{ id: string; name: string }>> {
  const artist = await getArtistWithRelations(mbid);
  const memberBands = extractBands(artist).map((b) => ({ id: b.artist.id, name: b.artist.name }));
  const supportedBands = extractSupportedBands(artist).map((b) => ({ id: b.artist.id, name: b.artist.name }));
  return [...memberBands, ...supportedBands];
}

/**
 * Get all persons connected to a band (members + support musicians).
 */
async function getPersonsForBand(mbid: string): Promise<Array<{ id: string; name: string; current: boolean }>> {
  const artist = await getArtistWithRelations(mbid);
  const members = extractMembers(artist).map((m) => ({ id: m.artist.id, name: m.artist.name, current: m.current }));
  const supporters = extractSupportMusicians(artist).map((m) => ({ id: m.artist.id, name: m.artist.name, current: true }));
  return [...members, ...supporters];
}

/**
 * Resolve a game artist to a person MBID.
 * If the artist is a group, pick a member. If it's a person, resolve directly.
 */
async function resolveStartPerson(
): Promise<{ personId: string; personName: string } | null> {
  const candidate = pickRandom(GAME_ARTISTS);
  debugLog.log(`Game: picked starting artist "${candidate.name}" (${candidate.type})`);

  const searchResults = await searchArtists(candidate.name, 5);
  const exact = searchResults.find((a) => a.name.toLowerCase() === candidate.name.toLowerCase());
  const resolved = exact ?? searchResults[0];
  if (!resolved) return null;

  if (candidate.type === "person") {
    return { personId: resolved.id, personName: resolved.name };
  }

  // It's a group — pick a member
  const artist = await getArtistWithRelations(resolved.id);
  const members = extractMembers(artist);
  if (members.length === 0) return null;

  const chosen = preferLead(members);
  if (!chosen) return null;

  debugLog.log(`Game: resolved group "${candidate.name}" → member "${chosen.name}"`);
  return { personId: chosen.id, personName: chosen.name };
}

/**
 * Generate a game chain: person1 → band1 → person2 → band2 → person3
 * 
 * Strategy:
 * 1. Pick a random artist from the list, resolve to a person (person1)
 * 2. Get their bands, pick one (band1)
 * 3. Get band1's members, pick a DIFFERENT person (person2)
 * 4. Get person2's bands, pick a DIFFERENT band (band2)
 * 5. Get band2's members, pick a DIFFERENT person (person3)
 * 
 * Retries up to 5 times if the chain can't be completed.
 */
export async function generateGameChain(): Promise<GameChain | null> {
  for (let attempt = 0; attempt < 5; attempt++) {
    debugLog.log(`Game: generation attempt ${attempt + 1}`);

    try {
      // Step 1: Get person1
      const start = await resolveStartPerson();
      if (!start) continue;
      const person1: ChainLink = { id: start.personId, name: start.personName, type: "person" };

      // Step 2: Get a band for person1
      const bands1 = await getBandsForPerson(person1.id);
      if (bands1.length === 0) continue;
      const band1Pick = pickRandom(bands1);
      const band1: ChainLink = { id: band1Pick.id, name: band1Pick.name, type: "group" };

      // Step 3: Get a different person from band1
      const persons2 = await getPersonsForBand(band1.id);
      const persons2Filtered = persons2.filter((p) => p.id !== person1.id);
      if (persons2Filtered.length === 0) continue;
      // Prefer current members
      const current2 = persons2Filtered.filter((p) => p.current);
      const person2Pick = pickRandom(current2.length > 0 ? current2 : persons2Filtered);
      const person2: ChainLink = { id: person2Pick.id, name: person2Pick.name, type: "person" };

      // Step 4: Get a different band for person2
      const bands2 = await getBandsForPerson(person2.id);
      const bands2Filtered = bands2.filter((b) => b.id !== band1.id);
      if (bands2Filtered.length === 0) continue;
      const band2Pick = pickRandom(bands2Filtered);
      const band2: ChainLink = { id: band2Pick.id, name: band2Pick.name, type: "group" };

      // Step 5: Get a different person from band2
      const persons3 = await getPersonsForBand(band2.id);
      const persons3Filtered = persons3.filter((p) => p.id !== person2.id && p.id !== person1.id);
      if (persons3Filtered.length === 0) continue;
      const current3 = persons3Filtered.filter((p) => p.current);
      const person3Pick = pickRandom(current3.length > 0 ? current3 : persons3Filtered);
      const person3: ChainLink = { id: person3Pick.id, name: person3Pick.name, type: "person" };

      debugLog.log(`Game: chain generated: ${person1.name} → ${band1.name} → ${person2.name} → ${band2.name} → ${person3.name}`);

      return {
        chain: [person1, band1, person2, band2, person3],
      };
    } catch (e) {
      debugLog.log(`Game: attempt ${attempt + 1} failed: ${e instanceof Error ? e.message : "unknown error"}`);
      continue;
    }
  }

  return null;
}
