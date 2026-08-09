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

> "What bands should I know if I love this scene?"

or:

> "Which venues are at the center of the music community I enjoy?"

---

# Current Implementation

The project currently has two working features, powered by a precomputed SQLite database (built from MusicBrainz data dumps) queried directly in the browser via WebAssembly:

## Explore

Search for any artist or band and visualize their network — band members, side projects, and supporting musicians rendered as an interactive force-directed graph. Click nodes to explore further.

## Six Degrees of Music (Game)

A game that gives you two musicians (or two bands) and challenges you to find the path connecting them through band memberships and supporting roles. Navigate by selecting from valid connections at each step. The app computes the shortest path and shows you a "par" to beat.

## Running

```bash
npm install
npm run dev
```

The app requires `public/graph.db.gz` (generated from MusicBrainz data, committed to the repo). To regenerate:

```bash
brew install zstd
python3 scripts/process_mb_dump.py
```

---

# Motivation

Music discovery often happens through communities.

A listener does not just discover a band because it sounds similar to another band. They discover music through:

* seeing an opener at a concert
* following a musician's side projects
* exploring a record label
* visiting a local venue
* attending a festival
* finding a band from the same scene

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
| Artist            | A band or solo project             | toured with, opened for, collaborated with, played venue, appeared at festival |
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

Discover side projects and related bands through shared members.

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

