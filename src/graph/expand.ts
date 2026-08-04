import {
  searchArtists,
  getArtistWithRelations,
  extractMembers,
  extractBands,
  extractLabels,
} from "../api/musicbrainz";
import {
  getSetlistsForArtist,
  extractVenues,
  extractRelatedArtists,
  getApiKey,
  isSetlistFmEnabled,
} from "../api/setlistfm";
import { SceneGraph } from "./SceneGraph";
import type { ArtistNode, MusicianNode, VenueNode, CityNode, LabelNode } from "./types";

/**
 * Search for an artist, then expand their graph neighborhood:
 * - Members / bands (from MusicBrainz)
 * - Labels (from MusicBrainz)
 * - Venues + cities (from Setlist.fm)
 * - Related artists via covers/guests (from Setlist.fm)
 */
export async function expandArtist(artistName: string, graph: SceneGraph): Promise<void> {
  // 1. Search MusicBrainz for the artist
  const searchResults = await searchArtists(artistName, 5);
  if (searchResults.length === 0) {
    throw new Error(`No artist found for "${artistName}"`);
  }

  // Prefer an exact name match over MusicBrainz's relevance ranking
  const exactMatch = searchResults.find(
    (a) => a.name.toLowerCase() === artistName.toLowerCase()
  );
  const topResult = exactMatch ?? searchResults[0]!;
  const mbid = topResult.id;

  // 2. Get full artist with relations
  const artist = await getArtistWithRelations(mbid);

  // Add the artist node (use MB type to distinguish person vs group)
  const isPerson = artist.type === "Person";
  const artistNode: ArtistNode | MusicianNode = isPerson
    ? {
        id: mbid,
        type: "musician",
        name: artist.name,
        mbid,
      }
    : {
        id: mbid,
        type: "artist",
        name: artist.name,
        mbid,
        disambiguation: artist.disambiguation,
        country: artist.country,
      };
  graph.addNode(artistNode);
  graph.markExpanded(mbid);

  // 3. Process members (people in this band)
  const members = extractMembers(artist);
  for (const { artist: member, current } of members) {
    const memberNode: MusicianNode = {
      id: member.id,
      type: "musician",
      name: member.name,
      mbid: member.id,
    };
    graph.addNode(memberNode);
    graph.addEdge({
      id: `${member.id}-member_of-${mbid}`,
      source: member.id,
      target: mbid,
      type: current ? "member_of" : "former_member_of",
    });
  }

  // 4. Process bands this artist is a member of
  const bands = extractBands(artist);
  for (const { artist: band, current } of bands) {
    const bandNode: ArtistNode = {
      id: band.id,
      type: "artist",
      name: band.name,
      mbid: band.id,
      disambiguation: band.disambiguation,
    };
    graph.addNode(bandNode);
    graph.addEdge({
      id: `${mbid}-member_of-${band.id}`,
      source: mbid,
      target: band.id,
      type: current ? "member_of" : "former_member_of",
    });
  }

  // 5. Process labels
  const labels = extractLabels(artist);
  for (const label of labels) {
    const labelNode: LabelNode = {
      id: label.id,
      type: "label",
      name: label.name,
      mbid: label.id,
    };
    graph.addNode(labelNode);
    graph.addEdge({
      id: `${mbid}-signed_to-${label.id}`,
      source: mbid,
      target: label.id,
      type: "signed_to",
    });
  }

  // 6. If Setlist.fm is enabled and API key is available, get venue data
  if (isSetlistFmEnabled() && getApiKey()) {
    try {
      const setlistResult = await getSetlistsForArtist(mbid, 1);
      const setlists = setlistResult.setlist ?? [];

      // Add venues and cities
      const venues = extractVenues(setlists);
      for (const { venue, playCount } of venues.slice(0, 10)) {
        // Top 10 venues
        const cityId = `city-${venue.city.id}`;
        const cityNode: CityNode = {
          id: cityId,
          type: "city",
          name: venue.city.name,
          country: venue.city.country.name,
        };
        graph.addNode(cityNode);

        const venueNode: VenueNode = {
          id: `venue-${venue.id}`,
          type: "venue",
          name: venue.name,
          city: venue.city.name,
          country: venue.city.country.name,
          latitude: venue.city.coords?.lat,
          longitude: venue.city.coords?.long,
          metadata: { playCount },
        };
        graph.addNode(venueNode);

        graph.addEdge({
          id: `venue-${venue.id}-located_in-${cityId}`,
          source: `venue-${venue.id}`,
          target: cityId,
          type: "located_in",
        });

        graph.addEdge({
          id: `${mbid}-played_at-venue-${venue.id}`,
          source: mbid,
          target: `venue-${venue.id}`,
          type: "played_at",
        });
      }

      // Add related artists (covers, guests)
      const related = extractRelatedArtists(setlists);
      for (const { artist: relArtist, relation } of related.slice(0, 10)) {
        const relNode: ArtistNode = {
          id: relArtist.mbid,
          type: "artist",
          name: relArtist.name,
          mbid: relArtist.mbid,
        };
        graph.addNode(relNode);
        graph.addEdge({
          id: `${mbid}-collaborated_with-${relArtist.mbid}`,
          source: mbid,
          target: relArtist.mbid,
          type: "collaborated_with",
          metadata: { via: relation },
        });
      }
    } catch (e) {
      // Setlist.fm is optional - log but don't fail
      console.warn("Setlist.fm fetch failed:", e);
    }
  }
}
