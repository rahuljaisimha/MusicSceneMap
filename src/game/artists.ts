/**
 * Curated artist list for the Six Degrees game.
 * 
 * Sources:
 * - Wikipedia "List of most-streamed artists on Spotify" (top 50 monthly listeners)
 * - Wikipedia "List of best-selling music artists" (classic era coverage)
 * - Hand-picked additions for graph connectivity (supergroups, prolific collaborators)
 *
 * MBIDs are resolved at runtime via MusicBrainz search.
 * The game picks two random artists from this list and challenges the user to connect them.
 */

export interface GameArtist {
  name: string;
  type: "person" | "group";
}

export const GAME_ARTISTS: GameArtist[] = [
  // --- From Spotify Top 50 monthly listeners (Aug 2026) ---
  { name: "Bruno Mars", type: "person" },
  { name: "Justin Bieber", type: "person" },
  { name: "The Weeknd", type: "person" },
  { name: "Rihanna", type: "person" },
  { name: "Shakira", type: "person" },
  { name: "Taylor Swift", type: "person" },
  { name: "Michael Jackson", type: "person" },
  { name: "Bad Bunny", type: "person" },
  { name: "Lady Gaga", type: "person" },
  { name: "Ariana Grande", type: "person" },
  { name: "Coldplay", type: "group" },
  { name: "Drake", type: "person" },
  { name: "Ed Sheeran", type: "person" },
  { name: "Eminem", type: "person" },
  { name: "Billie Eilish", type: "person" },
  { name: "Kendrick Lamar", type: "person" },
  { name: "Dua Lipa", type: "person" },
  { name: "Post Malone", type: "person" },
  { name: "Kanye West", type: "person" },
  { name: "Imagine Dragons", type: "group" },
  { name: "Maroon 5", type: "group" },
  { name: "Linkin Park", type: "group" },
  { name: "Adele", type: "person" },
  { name: "Doja Cat", type: "person" },
  { name: "Miley Cyrus", type: "person" },
  { name: "Justin Timberlake", type: "person" },
  { name: "Madonna", type: "person" },

  // --- Classic rock / essential for connectivity ---
  { name: "Led Zeppelin", type: "group" },
  { name: "The Beatles", type: "group" },
  { name: "The Rolling Stones", type: "group" },
  { name: "Pink Floyd", type: "group" },
  { name: "Queen", type: "group" },
  { name: "The Who", type: "group" },
  { name: "Fleetwood Mac", type: "group" },
  { name: "David Bowie", type: "person" },
  { name: "Jimmy Page", type: "person" },
  { name: "Robert Plant", type: "person" },
  { name: "Paul McCartney", type: "person" },
  { name: "John Lennon", type: "person" },
  { name: "Mick Jagger", type: "person" },
  { name: "Eric Clapton", type: "person" },
  { name: "Freddie Mercury", type: "person" },
  { name: "Neil Young", type: "person" },
  { name: "Prince", type: "person" },
  { name: "Stevie Wonder", type: "person" },
  { name: "Elton John", type: "person" },
  { name: "Bob Dylan", type: "person" },

  // --- Grunge / 90s alt ---
  { name: "Nirvana", type: "group" },
  { name: "Foo Fighters", type: "group" },
  { name: "Soundgarden", type: "group" },
  { name: "Pearl Jam", type: "group" },
  { name: "Alice in Chains", type: "group" },
  { name: "Red Hot Chili Peppers", type: "group" },
  { name: "Rage Against the Machine", type: "group" },
  { name: "Dave Grohl", type: "person" },
  { name: "Chris Cornell", type: "person" },
  { name: "Eddie Vedder", type: "person" },

  // --- Modern rock / indie ---
  { name: "Radiohead", type: "group" },
  { name: "Arctic Monkeys", type: "group" },
  { name: "Queens of the Stone Age", type: "group" },
  { name: "The Strokes", type: "group" },
  { name: "The Black Keys", type: "group" },
  { name: "Gorillaz", type: "group" },
  { name: "Tame Impala", type: "group" },
  { name: "LCD Soundsystem", type: "group" },
  { name: "The White Stripes", type: "group" },
  { name: "Oasis", type: "group" },
  { name: "Blur", type: "group" },
  { name: "Jack White", type: "person" },
  { name: "Josh Homme", type: "person" },
  { name: "Thom Yorke", type: "person" },
  { name: "Alex Turner", type: "person" },
  { name: "Damon Albarn", type: "person" },
  { name: "Noel Gallagher", type: "person" },

  // --- Supergroups (key connectors) ---
  { name: "Them Crooked Vultures", type: "group" },
  { name: "Audioslave", type: "group" },
  { name: "Temple of the Dog", type: "group" },
  { name: "The Raconteurs", type: "group" },
  { name: "Cream", type: "group" },

  // --- Metal ---
  { name: "Metallica", type: "group" },
  { name: "Black Sabbath", type: "group" },
  { name: "Tool", type: "group" },
  { name: "Ozzy Osbourne", type: "person" },

  // --- Hip hop connectors ---
  { name: "OutKast", type: "group" },
  { name: "Wu-Tang Clan", type: "group" },
  { name: "Pharrell Williams", type: "person" },
  { name: "Dr. Dre", type: "person" },
  { name: "André 3000", type: "person" },

  // --- Electronic ---
  { name: "Daft Punk", type: "group" },
  { name: "Massive Attack", type: "group" },

  // --- Garage / Psych ---
  { name: "Ty Segall", type: "person" },
  { name: "King Gizzard & the Lizard Wizard", type: "group" },
  { name: "Osees", type: "group" },

  // --- Producers (bridge nodes) ---
  { name: "Brian Eno", type: "person" },
  { name: "Rick Rubin", type: "person" },
  { name: "Danger Mouse", type: "person" },
  { name: "Nigel Godrich", type: "person" },
  { name: "Jack Antonoff", type: "person" },

  // --- Other well-connected artists ---
  { name: "Johnny Cash", type: "person" },
  { name: "Tom Waits", type: "person" },
  { name: "Nick Cave", type: "person" },
  { name: "Iggy Pop", type: "person" },
  { name: "Björk", type: "person" },
  { name: "PJ Harvey", type: "person" },
  { name: "Flea", type: "person" },
  { name: "John Paul Jones", type: "person" },
  { name: "Trent Reznor", type: "person" },
];
