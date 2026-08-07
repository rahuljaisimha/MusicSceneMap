/**
 * Curated artist list for the Six Degrees game.
 * These are recognizable names that serve as game start/end points.
 * The game picks two of the same type (both persons or both groups).
 *
 * No supergroups — they emerge naturally from the graph.
 * No duplicates between persons and their bands (some overlap is fine for recognizability).
 */

export interface GameArtist {
  name: string;
  type: "person" | "group";
}

export const GAME_ARTISTS: GameArtist[] = [
  // --- Modern Pop / Hip Hop / R&B ---
  { name: "Bruno Mars", type: "person" },
  { name: "The Weeknd", type: "person" },
  { name: "Rihanna", type: "person" },
  { name: "Taylor Swift", type: "person" },
  { name: "Lady Gaga", type: "person" },
  { name: "Ariana Grande", type: "person" },
  { name: "Drake", type: "person" },
  { name: "Billie Eilish", type: "person" },
  { name: "Kendrick Lamar", type: "person" },
  { name: "Post Malone", type: "person" },
  { name: "Kanye West", type: "person" },
  { name: "Beyoncé", type: "person" },
  { name: "Frank Ocean", type: "person" },
  { name: "Tyler, the Creator", type: "person" },
  { name: "Pharrell Williams", type: "person" },
  { name: "Jay-Z", type: "person" },
  { name: "Snoop Dogg", type: "person" },
  { name: "Dr. Dre", type: "person" },
  { name: "André 3000", type: "person" },
  { name: "Nas", type: "person" },
  { name: "MF DOOM", type: "person" },
  { name: "Madlib", type: "person" },
  { name: "RZA", type: "person" },
  { name: "Q-Tip", type: "person" },
  { name: "Lauryn Hill", type: "person" },
  { name: "Missy Elliott", type: "person" },
  { name: "Justin Timberlake", type: "person" },
  { name: "D'Angelo", type: "person" },
  { name: "Erykah Badu", type: "person" },
  { name: "Anderson .Paak", type: "person" },
  { name: "Thundercat", type: "person" },
  { name: "Flying Lotus", type: "person" },

  // --- Classic Rock ---
  { name: "Jimmy Page", type: "person" },
  { name: "Robert Plant", type: "person" },
  { name: "John Paul Jones", type: "person" },
  { name: "Mick Jagger", type: "person" },
  { name: "Keith Richards", type: "person" },
  { name: "David Bowie", type: "person" },
  { name: "Paul McCartney", type: "person" },
  { name: "George Harrison", type: "person" },
  { name: "Eric Clapton", type: "person" },
  { name: "Jimi Hendrix", type: "person" },
  { name: "Roger Waters", type: "person" },
  { name: "David Gilmour", type: "person" },
  { name: "Freddie Mercury", type: "person" },
  { name: "Brian May", type: "person" },
  { name: "Pete Townshend", type: "person" },
  { name: "Neil Young", type: "person" },
  { name: "Stevie Nicks", type: "person" },
  { name: "Peter Gabriel", type: "person" },
  { name: "Phil Collins", type: "person" },

  // --- Punk / Post-Punk ---
  { name: "Iggy Pop", type: "person" },
  { name: "Joe Strummer", type: "person" },
  { name: "Robert Smith", type: "person" },
  { name: "David Byrne", type: "person" },

  // --- Grunge / 90s Alt ---
  { name: "Dave Grohl", type: "person" },
  { name: "Chris Cornell", type: "person" },
  { name: "Eddie Vedder", type: "person" },
  { name: "Billy Corgan", type: "person" },
  { name: "Trent Reznor", type: "person" },
  { name: "Flea", type: "person" },
  { name: "John Frusciante", type: "person" },
  { name: "Tom Morello", type: "person" },

  // --- Indie / Alternative ---
  { name: "Thom Yorke", type: "person" },
  { name: "Jack White", type: "person" },
  { name: "Josh Homme", type: "person" },
  { name: "Alex Turner", type: "person" },
  { name: "Damon Albarn", type: "person" },
  { name: "Noel Gallagher", type: "person" },
  { name: "Kevin Parker", type: "person" },
  { name: "Dan Auerbach", type: "person" },
  { name: "Julian Casablancas", type: "person" },
  { name: "St. Vincent", type: "person" },

  // --- Garage / Psych ---
  { name: "Ty Segall", type: "person" },
  { name: "John Dwyer", type: "person" },

  // --- Metal ---
  { name: "Tony Iommi", type: "person" },
  { name: "Ozzy Osbourne", type: "person" },
  { name: "James Hetfield", type: "person" },
  { name: "Lemmy", type: "person" },
  { name: "Dave Mustaine", type: "person" },

  // --- R&B / Soul / Funk ---
  { name: "Prince", type: "person" },
  { name: "Stevie Wonder", type: "person" },
  { name: "Michael Jackson", type: "person" },
  { name: "James Brown", type: "person" },

  // --- Singer-Songwriters ---
  { name: "Bob Dylan", type: "person" },
  { name: "Tom Waits", type: "person" },
  { name: "Nick Cave", type: "person" },
  { name: "Johnny Cash", type: "person" },
  { name: "Kate Bush", type: "person" },
  { name: "Björk", type: "person" },
  { name: "PJ Harvey", type: "person" },

  // --- Producers ---
  { name: "Brian Eno", type: "person" },
  { name: "Rick Rubin", type: "person" },
  { name: "Danger Mouse", type: "person" },
  { name: "Nigel Godrich", type: "person" },
  { name: "Jack Antonoff", type: "person" },
  { name: "Mark Ronson", type: "person" },
  { name: "Quincy Jones", type: "person" },
  { name: "Butch Vig", type: "person" },

  // --- Iconic Bands (recognizable, no single iconic frontperson) ---
  { name: "Led Zeppelin", type: "group" },
  { name: "The Rolling Stones", type: "group" },
  { name: "Pink Floyd", type: "group" },
  { name: "The Beatles", type: "group" },
  { name: "Queen", type: "group" },
  { name: "The Who", type: "group" },
  { name: "Fleetwood Mac", type: "group" },
  { name: "Nirvana", type: "group" },
  { name: "Foo Fighters", type: "group" },
  { name: "Soundgarden", type: "group" },
  { name: "Pearl Jam", type: "group" },
  { name: "Red Hot Chili Peppers", type: "group" },
  { name: "Radiohead", type: "group" },
  { name: "Arctic Monkeys", type: "group" },
  { name: "Queens of the Stone Age", type: "group" },
  { name: "The Strokes", type: "group" },
  { name: "The Black Keys", type: "group" },
  { name: "Oasis", type: "group" },
  { name: "Blur", type: "group" },
  { name: "Gorillaz", type: "group" },
  { name: "Metallica", type: "group" },
  { name: "Black Sabbath", type: "group" },
  { name: "Iron Maiden", type: "group" },
  { name: "AC/DC", type: "group" },
  { name: "The Clash", type: "group" },
  { name: "Joy Division", type: "group" },
  { name: "New Order", type: "group" },
  { name: "The Cure", type: "group" },
  { name: "Rage Against the Machine", type: "group" },
  { name: "Nine Inch Nails", type: "group" },
  { name: "Tool", type: "group" },
  { name: "OutKast", type: "group" },
  { name: "Wu-Tang Clan", type: "group" },
  { name: "A Tribe Called Quest", type: "group" },
  { name: "The Roots", type: "group" },
  { name: "N.W.A", type: "group" },
  { name: "Beastie Boys", type: "group" },
  { name: "Daft Punk", type: "group" },
  { name: "Massive Attack", type: "group" },
  { name: "Tame Impala", type: "group" },
  { name: "LCD Soundsystem", type: "group" },
  { name: "Arcade Fire", type: "group" },
  { name: "The White Stripes", type: "group" },
  { name: "Osees", type: "group" },
  { name: "King Gizzard & the Lizard Wizard", type: "group" },
  { name: "Earth, Wind & Fire", type: "group" },
  { name: "Talking Heads", type: "group" },
  { name: "Depeche Mode", type: "group" },
  { name: "Kraftwerk", type: "group" },
];
