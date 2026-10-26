# MusicSceneMap

> Discover the artists, venues, and communities that define a city's music scene.

## Overview

MusicSceneMap is a graph-powered music discovery platform that helps users discover:

* Music venues
* Concerts
* Artists
* Local scenes
* Related musicians
* Cities with similar musical communities

Instead of recommending music based only on listening history or genre similarity, MusicSceneMap builds a map of the relationships that create real-world music scenes.

The goal is to answer questions like:

> "I'm visiting Los Angeles. Where should I go if I love Osees and Ty Segall?"

or:

> "What groups should I know if I love this scene?"

or:

> "Which venues are at the center of the music community I enjoy?"

---

# Current Implementation

The app has four features, powered by a precomputed SQLite database (built from MusicBrainz data dumps) queried directly in the browser via WebAssembly. It works on desktop and phones.

## Explore

Search for any artist or group and visualize their network — group members, side projects, and supporting musicians rendered as an interactive force-directed graph. Click a node to see what MusicBrainz says about it (its disambiguation, its genres, and a link to its MusicBrainz page) and to explore further. The legend explains the colours and arrows, and its checkboxes add more kinds of connection: musicians who played or sang on an artist's records, producers, and acts that opened for them.

As you type, a dropdown suggests matching artists from the app's database. Each one is labelled the way MusicBrainz does it, with its disambiguation in parentheses, e.g. **Fuzz** (US garage rock band), so you can pick the right one when several artists share a name. Artists MusicBrainz doesn't disambiguate (like Alex Turner) have no label. Artists the database doesn't have are looked up on MusicBrainz; picking one of those (or an Explore search that finds nothing) is logged, and [concert-database](https://github.com/rahuljaisimha/concert-database) crawls those artists' concerts so they join the graph at its next rebuild. The same dropdown is on Discover, Similarity and the custom game in Play, and everywhere the artist you pick is the one used, even when others share its name.

## Six Degrees of Music (Game)

A game that gives you two musicians (or two groups) and challenges you to find the path connecting them through group memberships and supporting roles. Navigate by selecting from valid connections at each step. The app computes the shortest path and shows you a "par" to beat. The page opens straight away: a game in progress comes back at once, and a new game's artists fill in as soon as the music graph has downloaded.

## Discover

Find venues in any city based on artists you like. Enter a city and a list of artists — the app finds venues where they've performed, then expands to related groups for richer recommendations. Powered by Setlist.fm data, cached in a backend database.

Switch to **Concerts** to see upcoming shows at the city's top venues (from Pollstar), ranked by how well each headliner fits the artists you listed.

## Similarity

Score how closely an artist fits a group of artists you like, from 0 to 100, based on shared group members, collaborations, who opened for whom at concerts, and other connections in the music graph. Artists missing from the built-in graph are looked up from the backend database and MusicBrainz.

Tap an artist in the breakdown to see how it connects to the one you're comparing: the shortest chain of relationships between them, and what each connection added to the score.

## Running

```bash
npm install
npm run dev
```

The app requires `public/graph.db.gz` (generated from MusicBrainz data, committed to the repo). To regenerate:

```bash
brew install zstd
python3 scripts/process_mb_dump.py
python3 scripts/add_concertdb_edges.py   # "opened for" links from concert-database
```

`process_mb_dump.py` starts from ~145 curated artists and, when a local concert-database ledger is present, from every artist with a concert in it, and keeps the download under 74 MB. `add_concertdb_edges.py` reads a local [concert-database](https://github.com/rahuljaisimha/concert-database) ledger (`~/concert-database/data/ledger.sqlite`, or `--ledger` / `$CONCERTDB_LEDGER`) and adds an "opened for" link for every opener/headliner pair it has confirmed. It can be re-run on its own to refresh those links without rebuilding the graph.

To see the debug log console, open the app with `?debug=1` or `?debug=true` in the URL, e.g. `http://localhost:5173/?debug=1` or `…/#/explore?debug=1`. It stays on while you navigate; reload without the flag to turn it off.

## Deploying

The app is a static site, deployable to GitHub Pages or Cloudflare (Workers Builds). On Cloudflare the graph database is served from Cloudflare R2 (the file exceeds the 25 MiB static-asset cap). See [`docs/CDN_HOSTING.md`](docs/CDN_HOSTING.md) for setup.

## Contributing

Changes go through pull requests into `main`, one squashed commit per PR. Cloudflare builds a preview of every PR; the Cloudflare bot posts the preview link as a comment on the PR. See [`CLAUDE.md`](CLAUDE.md) for the full workflow and [`SUMMARY.md`](SUMMARY.md) for the architecture.

## Testing

Unit tests run with [Vitest](https://vitest.dev/):

```bash
npm test          # run all tests once
npm run test:watch  # re-run on file changes
```

The tests cover the Similarity scoring, concert ranking, tiered graph lookups, search resolution and artist-dropdown labels, plus integration-style checks against real MusicBrainz API responses (captured as fixtures in `src/test/fixtures/`, with `fetch` stubbed so tests are offline and deterministic). They lock in specific edge cases that caused repeated bugs — e.g. searching "Fuzz" returning "Buzz Fuzz", multiple artists named "Jack White", and current-vs-former group member deduplication. To refresh a fixture, re-capture the response from the MusicBrainz API for the relevant MBID.

---

# Motivation

Music discovery often happens through communities.

A listener does not just discover a group because it sounds similar to another group. They discover music through:

* seeing an opener at a concert
* following a musician's side projects
* exploring a record label
* visiting a local venue
* attending a festival
* finding a group from the same scene

For example:

A fan of Ty Segall may discover:

* Fuzz
* White Fence
* CFM
* GØGGS
* The Muggers
* Primitive Ring

not because they share a genre tag, but because they share musicians, collaborators, venues, and history.

MusicSceneMap models these connections.

---

# Knowledge Graph

The foundation of MusicSceneMap is a **heterogeneous knowledge graph** representing the relationships between the people, places, and organizations that create music communities.

Unlike traditional recommendation systems that focus primarily on:

* listening similarity
* genre tags
* popularity

MusicSceneMap focuses on:

* collaboration
* touring history
* shared musicians
* venues
* labels
* festivals
* geographic communities

Recommendations emerge from the structure of the graph.

---

# Graph Nodes & Relationships

| Node Type         | Description                        | Example Relationships                                                          |
| ----------------- | ---------------------------------- | ------------------------------------------------------------------------------ |
| Artist            | A group or solo project            | toured with, opened for, collaborated with, played venue, appeared at festival |
| Musician          | Individual artists behind projects | member of, former member of, produced, collaborated with                       |
| Venue             | Physical music locations           | hosted artist, recurring artist, located in city                               |
| Tour              | Live performance events            | headliner, opener, co-headliner, performed at venue                            |
| Festival          | Curated music events               | lineup, performed at, associated with scene                                    |
| Record Label      | Organizations releasing music      | signed artist, released album, compilation appearance                          |
| Album / Recording | Musical works                      | features musician, produced by, released on label                              |
| City              | Geographic communities             | home of artist, contains venue, associated with scene                          |
| Scene             | Cultural music communities         | contains artists, venues, labels, and cities                                   |

---

# Example Graph

```text
Charles Moothart
        |
        +-- member of --> Fuzz
        |
        +-- member of --> CFM
        |
        +-- member of --> Ty Segall Band
        |
        +-- member of --> Primitive Ring


Ty Segall
        |
        +-- member of --> Fuzz
        |
        +-- member of --> GØGGS
        |
        +-- collaborated with --> Charles Moothart


Fuzz
        |
        +-- played at --> Zebulon


Zebulon
        |
        +-- located in --> Los Angeles


Los Angeles
        |
        +-- contains --> Garage Psych Scene
```

The graph reveals that these artists are connected through a broader community rather than simply a shared genre.

---

# Recommendation Engine

MusicSceneMap uses graph relationships to generate recommendations.

Potential signals include:

* Shared musicians
* Collaboration history
* Touring relationships
* Opening slots
* Venue overlap
* Label relationships
* Festival lineups
* Geographic proximity
* Scene membership

A recommendation becomes stronger when multiple independent paths connect two entities.

Example:

```text
User likes:

Ty Segall
Osees
Wand


Graph expansion:

Ty Segall
    |
    +-- Fuzz
    +-- White Fence
    +-- CFM

Osees
    |
    +-- Castle Face Records
    +-- Zebulon
    +-- Desert Daze

Wand
    |
    +-- Lodge Room
    +-- Los Angeles Psych Scene


Recommendations:

Artists:
- Hooveriii
- Frankie and the Witch Fingers
- Meatbodies

Venues:
- Zebulon
- Lodge Room
- Permanent Records Roadhouse

Concerts:
- Upcoming events matching the scene
```

---

# Travel Mode

MusicSceneMap is designed for discovering cities through their music communities.

Example:

```text
Destination:

Los Angeles
```

Instead of showing every concert, MusicSceneMap identifies the scenes most relevant to the user.

Example output:

```text
Your LA Music Map:

Psych / Garage Scene

Key Venues:
- Zebulon
- Lodge Room
- Permanent Records Roadhouse

Related Artists:
- Hooveriii
- Frankie and the Witch Fingers
- Meatbodies

Upcoming Shows:
- Ranked by scene compatibility
```

---

# Features

## Personalized Scene Discovery

Connect music preferences and discover adjacent communities.

## Venue Discovery

Find venues that match your taste before choosing a specific concert.

## Concert Recommendations

Recommend upcoming shows based on scene compatibility rather than popularity.

## Musician Graph

Discover side projects and related groups through shared members.

## Scene Maps

Explore how artists, venues, and communities connect within a city.

## Similar Cities

Find cities with overlapping musical ecosystems.

---

# Potential Data Sources

Possible sources:

* Spotify API
* MusicBrainz
* Last.fm
* Ticketing platforms
* Venue calendars
* Festival lineups
* Tour archives
* Record label catalogs
* Community-curated music databases

---

# Potential Technology Stack

These were the options considered at the start of the project. The current build uses Vite, React and TypeScript, SQLite in the browser (sql.js), Supabase (Postgres and edge functions), and Cloudflare R2 for hosting the graph. See [`SUMMARY.md`](SUMMARY.md) for details.

## Frontend

* React
* Next.js
* Map-based visualization

## Backend

* Python / FastAPI
* Node.js

## Storage

* PostgreSQL
* Graph database (Neo4j or similar)

## Recommendation Layer

Potential approaches:

* Graph traversal
* Personalized PageRank
* Graph embeddings
* Similarity scoring
* Community detection algorithms

---

# Long-Term Vision

MusicSceneMap aims to become a living map of global music communities.

Not just:

> "What songs do you like?"

but:

> "What musical world do you belong to?"

The future of music discovery is not only finding artists.

It is finding the people, places, and communities that connect them.

---

# Future Name Exploration

MusicSceneMap is a working repository name. As the project evolves, the product name may shift toward something more focused on the ideas of connection, discovery, and musical communities.

| Name Direction   | Concept                                                                      | Potential Names                    |
| ---------------- | ---------------------------------------------------------------------------- | ---------------------------------- |
| Resonance        | The connections, influences, and collaborations that make music scenes exist | Resonant, Resonance, Resonance.fm  |
| Discovery        | Finding overlooked artists and hidden communities                            | Deep Cut, Hidden Track, The B-Side |
| Scene + Location | Mapping the places and communities around music                              | Vicinity, Viscenity, Obscenity     |
| Connection       | The network of relationships between artists, venues, and scenes             | SceneMesh, Crosstalk, SceneMap     |

The ideal name should capture the core idea:

> A map of the relationships, communities, and hidden connections that make music scenes exist.

