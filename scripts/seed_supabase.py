#!/usr/bin/env python3
"""
Seed Supabase PostgreSQL with MusicBrainz data.

Same BFS approach as process_mb_dump.py: starts from seed artists,
expands N hops, only includes reachable artists + their album credits.

Usage:
    pip install psycopg2-binary
    export SUPABASE_DB_URL='postgresql://...'
    caffeinate python3 server/seed_supabase.py
"""

import os
import sys
from pathlib import Path
from collections import defaultdict

try:
    import psycopg2
    from psycopg2.extras import execute_values
except ImportError:
    print("Install psycopg2: pip install psycopg2-binary")
    sys.exit(1)

SCRIPT_DIR = Path(__file__).parent
PROJECT_DIR = SCRIPT_DIR.parent
DATA_DIR = PROJECT_DIR / "scripts" / "data"

RELEVANT_ARTIST_ARTIST_TYPES = {"member of band", "supporting musician"}
RELEVANT_ARTIST_RECORDING_TYPES = {"producer", "vocal", "instrument", "mix", "engineer", "recording"}

MAX_HOPS = 6
BATCH_SIZE = 5000

SEED_ARTIST_NAMES = [
    "Bruno Mars", "The Weeknd", "Rihanna", "Taylor Swift", "Lady Gaga",
    "Ariana Grande", "Drake", "Billie Eilish", "Kendrick Lamar", "Post Malone",
    "Kanye West", "Beyoncé", "Frank Ocean", "Tyler, the Creator",
    "Pharrell Williams", "Jay-Z", "Snoop Dogg", "Dr. Dre", "André 3000",
    "Nas", "MF DOOM", "Madlib", "RZA", "Q-Tip", "Lauryn Hill",
    "Missy Elliott", "Justin Timberlake", "D'Angelo", "Erykah Badu",
    "Anderson .Paak", "Thundercat", "Flying Lotus",
    "Jimmy Page", "Robert Plant", "John Paul Jones", "Mick Jagger",
    "Keith Richards", "David Bowie", "Paul McCartney", "George Harrison",
    "Eric Clapton", "Jimi Hendrix", "Roger Waters", "David Gilmour",
    "Freddie Mercury", "Brian May", "Pete Townshend", "Neil Young",
    "Stevie Nicks", "Peter Gabriel", "Phil Collins",
    "Iggy Pop", "Joe Strummer", "Robert Smith", "David Byrne",
    "Dave Grohl", "Chris Cornell", "Eddie Vedder", "Billy Corgan",
    "Trent Reznor", "Flea", "John Frusciante", "Tom Morello",
    "Thom Yorke", "Jack White", "Josh Homme", "Alex Turner",
    "Damon Albarn", "Noel Gallagher", "Kevin Parker", "Dan Auerbach",
    "Julian Casablancas", "St. Vincent",
    "Ty Segall", "John Dwyer",
    "Tony Iommi", "Ozzy Osbourne", "James Hetfield", "Lemmy", "Dave Mustaine",
    "Prince", "Stevie Wonder", "Michael Jackson", "James Brown",
    "Bob Dylan", "Tom Waits", "Nick Cave", "Johnny Cash",
    "Kate Bush", "Björk", "PJ Harvey",
    "Brian Eno", "Rick Rubin", "Danger Mouse", "Nigel Godrich",
    "Jack Antonoff", "Mark Ronson", "Quincy Jones", "Butch Vig",
    "Led Zeppelin", "The Rolling Stones", "Pink Floyd", "The Beatles",
    "Queen", "The Who", "Fleetwood Mac", "Nirvana", "Foo Fighters",
    "Soundgarden", "Pearl Jam", "Red Hot Chili Peppers", "Radiohead",
    "Arctic Monkeys", "Queens of the Stone Age", "The Strokes",
    "The Black Keys", "Oasis", "Blur", "Gorillaz", "Metallica",
    "Black Sabbath", "Iron Maiden", "AC/DC", "The Clash", "Joy Division",
    "New Order", "The Cure", "Rage Against the Machine", "Nine Inch Nails",
    "Tool", "OutKast", "Wu-Tang Clan", "A Tribe Called Quest", "The Roots",
    "N.W.A", "Beastie Boys", "Daft Punk", "Massive Attack", "Tame Impala",
    "LCD Soundsystem", "Arcade Fire", "The White Stripes", "Osees",
    "King Gizzard & the Lizard Wizard", "Earth, Wind & Fire",
    "Talking Heads", "Depeche Mode", "Kraftwerk",
]


def get_db_url():
    url = os.environ.get("SUPABASE_DB_URL")
    if not url:
        print("ERROR: Set SUPABASE_DB_URL environment variable.")
        sys.exit(1)
    return url


def parse_link_types(data_dir: Path) -> dict[int, str]:
    link_types = {}
    with open(data_dir / "mbdump" / "link_type", "r", encoding="utf-8") as f:
        for line in f:
            parts = line.strip().split("\t")
            if len(parts) > 6:
                link_types[int(parts[0])] = parts[6]
    return link_types


def parse_links(data_dir: Path) -> dict[int, tuple[int, bool]]:
    links = {}
    with open(data_dir / "mbdump" / "link", "r", encoding="utf-8") as f:
        for line in f:
            parts = line.strip().split("\t")
            if len(parts) >= 11:
                links[int(parts[0])] = (int(parts[1]), parts[10] == "t")
    return links


def parse_artists(data_dir: Path) -> dict[int, dict]:
    artists = {}
    type_map = {"1": "person", "2": "group", "3": "group", "4": "group", "5": "person", "6": "person"}
    with open(data_dir / "mbdump" / "artist", "r", encoding="utf-8") as f:
        for line in f:
            parts = line.strip().split("\t")
            if len(parts) > 10:
                aid = int(parts[0])
                artists[aid] = {
                    "gid": parts[1],
                    "name": parts[2],
                    "type": type_map.get(parts[10], "person") if parts[10] != "\\N" else "person",
                    "disambiguation": parts[13] if len(parts) > 13 and parts[13] != "\\N" else None,
                }
    return artists


def parse_artist_relationships(data_dir, links, link_types, relevant_ids):
    relationships = []
    with open(data_dir / "mbdump" / "l_artist_artist", "r", encoding="utf-8") as f:
        for line in f:
            parts = line.strip().split("\t")
            if len(parts) >= 4:
                link_info = links.get(int(parts[1]))
                if link_info:
                    link_type_id, ended = link_info
                    if link_type_id in relevant_ids:
                        relationships.append((int(parts[2]), int(parts[3]), link_types[link_type_id], ended))
    return relationships


def bfs_reachable(seed_gids, relationships, artists, max_hops):
    """BFS from seed GIDs, return reachable GIDs."""
    print(f"  Running BFS from {len(seed_gids)} seeds ({max_hops} hops)...")

    gid_to_id = {}
    id_to_gid = {}
    for aid, data in artists.items():
        gid_to_id[data["gid"]] = aid
        id_to_gid[aid] = data["gid"]

    adjacency: dict[int, set[int]] = defaultdict(set)
    for e0, e1, _, _ in relationships:
        adjacency[e0].add(e1)
        adjacency[e1].add(e0)

    seed_ids = {gid_to_id[g] for g in seed_gids if g in gid_to_id}
    print(f"  Resolved {len(seed_ids)} seeds")

    visited = set(seed_ids)
    frontier = set(seed_ids)

    for hop in range(max_hops):
        next_frontier = set()
        for node in frontier:
            for neighbor in adjacency.get(node, set()):
                if neighbor not in visited:
                    visited.add(neighbor)
                    next_frontier.add(neighbor)
        frontier = next_frontier
        print(f"    Hop {hop + 1}: +{len(next_frontier)} (total: {len(visited)})")
        if not next_frontier:
            break

    return {id_to_gid[aid] for aid in visited if aid in id_to_gid}


def main():
    print("=" * 60)
    print("MusicSceneMap: Seed Supabase (BFS filtered)")
    print("=" * 60)

    if not (DATA_DIR / "mbdump" / "artist").exists():
        print("ERROR: Run 'python3 scripts/process_mb_dump.py' first to download the dump.")
        sys.exit(1)

    db_url = get_db_url()
    print("\nConnecting to Supabase...")
    conn = psycopg2.connect(db_url)
    print("Connected.\n")

    # Parse metadata
    print("Parsing link metadata...")
    link_types = parse_link_types(DATA_DIR)
    links = parse_links(DATA_DIR)
    relevant_aa_ids = {tid for tid, name in link_types.items() if name in RELEVANT_ARTIST_ARTIST_TYPES}
    relevant_ar_ids = {tid for tid, name in link_types.items() if name in RELEVANT_ARTIST_RECORDING_TYPES}

    print("Parsing artists...")
    artists = parse_artists(DATA_DIR)
    print(f"  {len(artists)} artists")

    print("Parsing artist-artist relationships...")
    relationships = parse_artist_relationships(DATA_DIR, links, link_types, relevant_aa_ids)
    print(f"  {len(relationships)} relationships")

    # Resolve seeds
    print("\nResolving seed artists...")
    name_to_gid = {}
    for aid, data in artists.items():
        name_to_gid[data["name"].lower()] = data["gid"]

    seed_gids = set()
    for name in SEED_ARTIST_NAMES:
        gid = name_to_gid.get(name.lower())
        if gid:
            seed_gids.add(gid)
        else:
            print(f"  WARNING: not found: {name}")
    print(f"  Resolved {len(seed_gids)} / {len(SEED_ARTIST_NAMES)} seeds")

    # BFS
    print()
    reachable_gids = bfs_reachable(seed_gids, relationships, artists, MAX_HOPS)
    print(f"  Reachable: {len(reachable_gids)} artists")

    # --- Seed artists table ---
    print("\nSeeding artists...")
    cur = conn.cursor()
    batch = []
    count = 0
    for aid, data in artists.items():
        if data["gid"] in reachable_gids:
            batch.append((data["gid"], data["name"], data["type"], data.get("disambiguation"), None))
            if len(batch) >= BATCH_SIZE:
                execute_values(cur,
                    "INSERT INTO artists (mbid, name, type, disambiguation, country) VALUES %s ON CONFLICT (mbid) DO UPDATE SET name=EXCLUDED.name, type=EXCLUDED.type, disambiguation=EXCLUDED.disambiguation, country=EXCLUDED.country",
                    batch)
                count += len(batch)
                batch = []
                if count % 50000 == 0:
                    print(f"  {count}...")
                    conn.commit()
    if batch:
        execute_values(cur,
            "INSERT INTO artists (mbid, name, type, disambiguation, country) VALUES %s ON CONFLICT (mbid) DO UPDATE SET name=EXCLUDED.name, type=EXCLUDED.type, disambiguation=EXCLUDED.disambiguation, country=EXCLUDED.country",
            batch)
        count += len(batch)
    conn.commit()
    print(f"  Done: {count} artists")

    # --- Seed artist-artist relationships ---
    print("\nSeeding artist-artist relationships...")
    edge_type_map = {"member of band": "member_of", "supporting musician": "support_musician"}

    # Membership dedup
    membership_status: dict[tuple[str, str], bool] = {}
    id_to_gid = {aid: data["gid"] for aid, data in artists.items()}

    for e0, e1, rel_type, ended in relationships:
        if rel_type != "member of band":
            continue
        gid0 = id_to_gid.get(e0)
        gid1 = id_to_gid.get(e1)
        if gid0 and gid1 and gid0 in reachable_gids and gid1 in reachable_gids:
            key = (gid0, gid1)
            if key in membership_status:
                if not ended:
                    membership_status[key] = True
            else:
                membership_status[key] = not ended

    batch = []
    count = 0
    seen = set()
    for e0, e1, rel_type, ended in relationships:
        gid0 = id_to_gid.get(e0)
        gid1 = id_to_gid.get(e1)
        if not gid0 or not gid1:
            continue
        if gid0 not in reachable_gids or gid1 not in reachable_gids:
            continue

        mapped = edge_type_map.get(rel_type, rel_type)
        if mapped == "member_of":
            if not membership_status.get((gid0, gid1), not ended):
                mapped = "former_member_of"

        edge_key = (gid0, gid1, mapped)
        if edge_key in seen:
            continue
        seen.add(edge_key)

        batch.append((gid0, gid1, mapped, 1))
        if len(batch) >= BATCH_SIZE:
            execute_values(cur,
                "INSERT INTO relationships (source_id, target_id, rel_type, count) VALUES %s ON CONFLICT (source_id, target_id, rel_type) DO UPDATE SET count=EXCLUDED.count",
                batch)
            count += len(batch)
            batch = []
            if count % 50000 == 0:
                print(f"  {count}...")
                conn.commit()

    if batch:
        execute_values(cur,
            "INSERT INTO relationships (source_id, target_id, rel_type, count) VALUES %s ON CONFLICT (source_id, target_id, rel_type) DO UPDATE SET count=EXCLUDED.count",
            batch)
        count += len(batch)
    conn.commit()
    print(f"  Done: {count} relationships")

    # --- Seed albums + credit relationships ---
    print("\nSeeding albums and credit relationships...")
    print("  Building recording → album mapping...")

    recording_to_medium = {}
    with open(DATA_DIR / "mbdump" / "track", "r", encoding="utf-8") as f:
        for line in f:
            parts = line.strip().split("\t")
            if len(parts) >= 4:
                rec_id = int(parts[2])
                if rec_id not in recording_to_medium:
                    recording_to_medium[rec_id] = int(parts[3])

    medium_to_release = {}
    with open(DATA_DIR / "mbdump" / "medium", "r", encoding="utf-8") as f:
        for line in f:
            parts = line.strip().split("\t")
            if len(parts) >= 2:
                medium_to_release[int(parts[0])] = int(parts[1])

    release_to_rg = {}
    with open(DATA_DIR / "mbdump" / "release", "r", encoding="utf-8") as f:
        for line in f:
            parts = line.strip().split("\t")
            if len(parts) >= 5:
                try:
                    release_to_rg[int(parts[0])] = int(parts[4])
                except ValueError:
                    continue

    rg_data = {}  # rg_id → {gid, name, artist_credit}
    with open(DATA_DIR / "mbdump" / "release_group", "r", encoding="utf-8") as f:
        for line in f:
            parts = line.strip().split("\t")
            if len(parts) >= 4:
                rg_id = int(parts[0])
                rg_data[rg_id] = {"gid": parts[1], "name": parts[2]}
                try:
                    rg_data[rg_id]["artist_credit"] = int(parts[3])
                except ValueError:
                    pass

    rg_id_to_gid = {rg_id: d["gid"] for rg_id, d in rg_data.items()}

    # Parse artist_credit_name for primary artist
    credit_to_artist_id: dict[int, int] = {}
    acn_file = DATA_DIR / "mbdump" / "artist_credit_name"
    if acn_file.exists():
        with open(acn_file, "r", encoding="utf-8") as f:
            for line in f:
                parts = line.strip().split("\t")
                if len(parts) >= 3 and int(parts[1]) == 0:
                    credit_to_artist_id[int(parts[0])] = int(parts[2])

    def get_album_gid(recording_id):
        med_id = recording_to_medium.get(recording_id)
        if not med_id: return None
        rel_id = medium_to_release.get(med_id)
        if not rel_id: return None
        rg_id = release_to_rg.get(rel_id)
        if not rg_id: return None
        return rg_id_to_gid.get(rg_id)

    # Count credits (only for reachable artists)
    print("  Counting credits for reachable artists...")
    credit_counts: dict[tuple[str, str, str], int] = defaultdict(int)

    with open(DATA_DIR / "mbdump" / "l_artist_recording", "r", encoding="utf-8") as f:
        for line in f:
            parts = line.strip().split("\t")
            if len(parts) >= 4:
                link_info = links.get(int(parts[1]))
                if not link_info:
                    continue
                link_type_id, _ = link_info
                if link_type_id not in relevant_ar_ids:
                    continue

                artist_gid = id_to_gid.get(int(parts[2]))
                if not artist_gid or artist_gid not in reachable_gids:
                    continue

                album_gid = get_album_gid(int(parts[3]))
                if not album_gid:
                    continue

                credit_counts[(artist_gid, album_gid, link_types[link_type_id])] += 1

    print(f"  {len(credit_counts)} unique credits")

    # Insert albums that have credits from reachable artists
    albums_needed = {album_gid for (_, album_gid, _) in credit_counts}
    print(f"  Inserting {len(albums_needed)} albums...")

    # Resolve primary artist for albums
    rg_type_map = {"1": "album", "2": "single", "3": "ep", "11": "compilation"}

    batch = []
    count = 0
    for rg_id, data in rg_data.items():
        if data["gid"] not in albums_needed:
            continue
        primary_mbid = None
        ac = data.get("artist_credit")
        if ac:
            artist_internal = credit_to_artist_id.get(ac)
            if artist_internal:
                primary_mbid = id_to_gid.get(artist_internal)

        batch.append((data["gid"], data["name"], primary_mbid, None, None))
        if len(batch) >= BATCH_SIZE:
            execute_values(cur,
                "INSERT INTO albums (mbid, name, primary_artist_mbid, release_year, type) VALUES %s ON CONFLICT (mbid) DO UPDATE SET name=EXCLUDED.name, primary_artist_mbid=EXCLUDED.primary_artist_mbid, release_year=EXCLUDED.release_year, type=EXCLUDED.type",
                batch)
            count += len(batch)
            batch = []
            conn.commit()

    if batch:
        execute_values(cur,
            "INSERT INTO albums (mbid, name, primary_artist_mbid, release_year, type) VALUES %s ON CONFLICT (mbid) DO UPDATE SET name=EXCLUDED.name, primary_artist_mbid=EXCLUDED.primary_artist_mbid, release_year=EXCLUDED.release_year, type=EXCLUDED.type",
            batch)
        count += len(batch)
    conn.commit()
    print(f"  Done: {count} albums")

    # Insert credit relationships
    print("  Inserting credit relationships...")
    batch = []
    count = 0
    for (artist_gid, album_gid, rel_type), track_count in credit_counts.items():
        batch.append((artist_gid, album_gid, rel_type, track_count))
        if len(batch) >= BATCH_SIZE:
            execute_values(cur,
                "INSERT INTO relationships (source_id, target_id, rel_type, count) VALUES %s ON CONFLICT (source_id, target_id, rel_type) DO UPDATE SET count=EXCLUDED.count",
                batch)
            count += len(batch)
            batch = []
            if count % 100000 == 0:
                print(f"    {count}...")
                conn.commit()

    if batch:
        execute_values(cur,
            "INSERT INTO relationships (source_id, target_id, rel_type, count) VALUES %s ON CONFLICT (source_id, target_id, rel_type) DO UPDATE SET count=EXCLUDED.count",
            batch)
        count += len(batch)
    conn.commit()
    print(f"  Done: {count} credit relationships")

    conn.close()
    print()
    print("=" * 60)
    print("Done!")
    print("=" * 60)


if __name__ == "__main__":
    main()
