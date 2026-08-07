#!/usr/bin/env python3
"""
MusicBrainz Data Dump Processor
================================

Downloads the MusicBrainz data dump and extracts a game-ready adjacency graph.

Output: A JSON file with artists and their relationships, filtered to artists
with sufficient connections to be useful for the Six Degrees game.

Usage:
    python3 scripts/process_mb_dump.py

Requirements:
    - Python 3.9+
    - ~10GB free disk space (for download + processing)
    - Internet connection (for initial download)

The script will:
1. Download the relevant tables from the MusicBrainz data dump
2. Parse artist and relationship data
3. Filter to well-connected artists
4. Export a compact JSON adjacency graph
"""

import os
import gzip
import urllib.request
import tarfile
import shutil
from pathlib import Path
from collections import defaultdict

# --- Configuration ---

# Base URL for MusicBrainz dump (use latest available)
DUMP_BASE_URL = "https://data.metabrainz.org/pub/musicbrainz/data/fullexport/LATEST"
DUMP_MIRROR = "https://data.metabrainz.org/pub/musicbrainz/data/fullexport"

# Output paths
SCRIPT_DIR = Path(__file__).parent
PROJECT_DIR = SCRIPT_DIR.parent
DATA_DIR = SCRIPT_DIR / "data"
OUTPUT_FILE = PROJECT_DIR / "public" / "graph.db"

# Relationship types we care about for artist-to-artist (from MusicBrainz link_type table)
RELEVANT_ARTIST_ARTIST_TYPES = {
    "member of band",
    "supporting musician",
}

# Relationship types we care about for artist-to-recording credits
RELEVANT_ARTIST_RECORDING_TYPES = {
    "producer",
    "vocal",
    "instrument",
    "mix",
    "engineer",
    "recording",
}


def get_latest_dump_url():
    """Get the URL of the latest full export."""
    print("Finding latest dump...")
    try:
        with urllib.request.urlopen(DUMP_BASE_URL) as resp:
            latest = resp.read().decode().strip()
        return f"{DUMP_MIRROR}/{latest}"
    except Exception:
        # Fallback: list directory and pick latest
        print("Could not read LATEST file, will need manual URL.")
        raise


def download_file(url: str, dest: Path):
    """Download a file with progress indication."""
    if dest.exists():
        print(f"  Already downloaded: {dest.name}")
        return

    print(f"  Downloading: {url}")
    print(f"  To: {dest}")

    def reporthook(block_num, block_size, total_size):
        downloaded = block_num * block_size
        if total_size > 0:
            pct = min(100, downloaded * 100 // total_size)
            mb = downloaded / (1024 * 1024)
            print(f"\r  {pct}% ({mb:.1f} MB)", end="", flush=True)

    urllib.request.urlretrieve(url, dest, reporthook)
    print()


def download_dump_tables(dump_url: str):
    """Download only the tables we need from the dump. Skips if already present."""
    DATA_DIR.mkdir(parents=True, exist_ok=True)

    tables_needed = [
        "mbdump/artist",
        "mbdump/artist_credit_name",
        "mbdump/l_artist_artist",
        "mbdump/l_artist_recording",
        "mbdump/link",
        "mbdump/link_type",
        "mbdump/recording",
        "mbdump/track",
        "mbdump/medium",
        "mbdump/release",
        "mbdump/release_group",
    ]

    # Check if all tables are already extracted
    all_extracted = all((DATA_DIR / t).exists() for t in tables_needed)
    if all_extracted:
        print("All required tables already extracted. Skipping download.")
        return

    # Check which tables are missing
    missing = [t for t in tables_needed if not (DATA_DIR / t).exists()]
    print(f"Missing tables: {', '.join(t.split('/')[1] for t in missing)}")

    # Check if we already have a downloaded tar file
    tar_path_zst = DATA_DIR / "mbdump.tar.zst"
    tar_path_bz2 = DATA_DIR / "mbdump.tar.bz2"
    tar_path_plain = DATA_DIR / "mbdump.tar"

    tar_path = None
    if tar_path_plain.exists():
        tar_path = tar_path_plain
        print(f"Found existing decompressed tar: {tar_path.name}")
    elif tar_path_zst.exists():
        tar_path = tar_path_zst
        print(f"Found existing compressed tar: {tar_path.name}")
    elif tar_path_bz2.exists():
        tar_path = tar_path_bz2
        print(f"Found existing compressed tar: {tar_path.name}")
    else:
        # Need to download
        tar_url = f"{dump_url}/mbdump.tar.zst"
        tar_path = tar_path_zst
        try:
            download_file(tar_url, tar_path)
        except Exception:
            tar_url = f"{dump_url}/mbdump.tar.bz2"
            tar_path = tar_path_bz2
            download_file(tar_url, tar_path)

    # Extract missing tables
    print(f"Extracting missing tables from {tar_path.name}...")

    if tar_path.suffix == ".zst":
        # Decompress zst → tar first
        if not tar_path_plain.exists():
            print("  Decompressing .tar.zst (this may take a while)...")
            ret = os.system(f"zstd -d '{tar_path}' -o '{tar_path_plain}'")
            if ret != 0:
                raise RuntimeError("zstd decompression failed. Install with: brew install zstd")
        tar_path = tar_path_plain

    if str(tar_path).endswith(".tar.bz2"):
        open_mode = "r:bz2"
    else:
        open_mode = "r:"

    with tarfile.open(tar_path, open_mode) as tar:
        for member in tar.getmembers():
            if member.name in missing:
                print(f"  Extracting: {member.name}")
                tar.extract(member, DATA_DIR)

    # Verify all extracted
    still_missing = [t for t in tables_needed if not (DATA_DIR / t).exists()]
    if still_missing:
        raise RuntimeError(f"Failed to extract: {still_missing}")


def parse_link_types(data_dir: Path) -> dict[int, str]:
    """Parse link_type table to get relationship type names by ID."""
    link_types = {}
    link_type_file = data_dir / "mbdump" / "link_type"

    print("Parsing link_type table...")
    with open(link_type_file, "r", encoding="utf-8") as f:
        for line in f:
            parts = line.strip().split("\t")
            if len(parts) >= 4:
                type_id = int(parts[0])
                # Column indices: id, parent, child_order, gid, entity_type0, entity_type1, name, ...
                # name is at index 6
                if len(parts) > 6:
                    name = parts[6]
                    link_types[type_id] = name

    print(f"  Found {len(link_types)} link types")
    return link_types


def parse_links(data_dir: Path) -> dict[int, tuple[int, bool]]:
    """Parse link table to map link_id → (link_type_id, ended)."""
    links = {}
    link_file = data_dir / "mbdump" / "link"

    print("Parsing link table...")
    with open(link_file, "r", encoding="utf-8") as f:
        for line in f:
            parts = line.strip().split("\t")
            if len(parts) >= 11:
                link_id = int(parts[0])
                link_type_id = int(parts[1])
                ended = parts[10] == "t"
                links[link_id] = (link_type_id, ended)

    print(f"  Found {len(links)} links")
    return links


def parse_artists(data_dir: Path) -> dict[int, dict]:
    """Parse artist table. Returns dict of artist_id → {name, type, gid}."""
    artists = {}
    artist_file = data_dir / "mbdump" / "artist"

    print("Parsing artist table...")
    with open(artist_file, "r", encoding="utf-8") as f:
        for line in f:
            parts = line.strip().split("\t")
            if len(parts) >= 5:
                # Columns: id, gid, name, sort_name, begin_date_year, ...
                # type is at a specific index - need to check schema
                # Schema: id | gid | name | sort_name | begin_date_year | begin_date_month |
                #         begin_date_day | end_date_year | end_date_month | end_date_day |
                #         type | area | gender | comment | edits_pending | last_updated |
                #         ended | begin_area | end_area
                artist_id = int(parts[0])
                gid = parts[1]  # MBID
                name = parts[2]
                # Type: 1=Person, 2=Group, 3=Orchestra, 4=Choir, 5=Character, 6=Other
                artist_type = parts[10] if len(parts) > 10 and parts[10] != "\\N" else None

                artists[artist_id] = {
                    "name": name,
                    "gid": gid,
                    "type": artist_type,
                }

    print(f"  Found {len(artists)} artists")
    return artists


def parse_artist_relationships(
    data_dir: Path,
    links: dict[int, tuple[int, bool]],
    link_types: dict[int, str],
    relevant_type_ids: set[int],
) -> list[tuple[int, int, str, bool]]:
    """Parse l_artist_artist table. Returns list of (artist0_id, artist1_id, rel_type_name, ended)."""
    relationships = []
    rel_file = data_dir / "mbdump" / "l_artist_artist"

    print("Parsing l_artist_artist table...")
    with open(rel_file, "r", encoding="utf-8") as f:
        for line in f:
            parts = line.strip().split("\t")
            if len(parts) >= 4:
                # Columns: id, link_id, entity0, entity1, ...
                link_id = int(parts[1])
                entity0 = int(parts[2])
                entity1 = int(parts[3])

                link_info = links.get(link_id)
                if link_info:
                    link_type_id, ended = link_info
                    if link_type_id in relevant_type_ids:
                        type_name = link_types[link_type_id]
                        relationships.append((entity0, entity1, type_name, ended))

    print(f"  Found {len(relationships)} relevant relationships")
    return relationships


def parse_recordings(data_dir: Path) -> dict[int, str]:
    """Parse recording table. Returns dict of recording_id → recording_gid."""
    recordings = {}
    rec_file = data_dir / "mbdump" / "recording"

    print("Parsing recording table...")
    with open(rec_file, "r", encoding="utf-8") as f:
        for line in f:
            parts = line.strip().split("\t")
            if len(parts) >= 2:
                # Columns: id, gid, name, artist_credit, length, comment, ...
                rec_id = int(parts[0])
                rec_gid = parts[1]
                recordings[rec_id] = rec_gid

    print(f"  Found {len(recordings)} recordings")
    return recordings


def build_recording_to_release_group(data_dir: Path) -> dict[int, int]:
    """
    Build a mapping from recording_id → release_group_id.
    Chain: recording → track → medium → release → release_group
    """
    print("Building recording → release_group mapping...")

    # Step 1: track → (recording_id, medium_id)
    # track columns: id | gid | recording | medium | position | number | name | artist_credit | length | ...
    print("  Parsing track table...")
    recording_to_medium = {}  # recording_id → medium_id (first encountered)
    track_file = data_dir / "mbdump" / "track"
    with open(track_file, "r", encoding="utf-8") as f:
        for line in f:
            parts = line.strip().split("\t")
            if len(parts) >= 4:
                recording_id = int(parts[2])
                medium_id = int(parts[3])
                if recording_id not in recording_to_medium:
                    recording_to_medium[recording_id] = medium_id

    print(f"    {len(recording_to_medium)} recordings mapped to media")

    # Step 2: medium → release_id
    # medium columns: id, release, position, format, name, ...
    print("  Parsing medium table...")
    medium_to_release = {}
    medium_file = data_dir / "mbdump" / "medium"
    with open(medium_file, "r", encoding="utf-8") as f:
        for line in f:
            parts = line.strip().split("\t")
            if len(parts) >= 2:
                medium_id = int(parts[0])
                release_id = int(parts[1])
                medium_to_release[medium_id] = release_id

    print(f"    {len(medium_to_release)} media mapped to releases")

    # Step 3: release → release_group_id
    # release columns: id | gid | name | artist_credit | release_group | status | ...
    print("  Parsing release table...")
    release_to_rg = {}
    release_file = data_dir / "mbdump" / "release"
    with open(release_file, "r", encoding="utf-8") as f:
        for line in f:
            parts = line.strip().split("\t")
            if len(parts) >= 5:
                release_id = int(parts[0])
                try:
                    release_group_id = int(parts[4])
                except ValueError:
                    continue
                release_to_rg[release_id] = release_group_id

    print(f"    {len(release_to_rg)} releases mapped to release groups")

    # Step 4: Parse release_group for names
    # release_group columns: id, gid, name, artist_credit, type, ...
    print("  Parsing release_group table...")
    release_groups = {}  # rg_id → {gid, name, artist_credit}
    rg_file = data_dir / "mbdump" / "release_group"
    with open(rg_file, "r", encoding="utf-8") as f:
        for line in f:
            parts = line.strip().split("\t")
            if len(parts) >= 4:
                rg_id = int(parts[0])
                rg_gid = parts[1]
                rg_name = parts[2]
                try:
                    artist_credit = int(parts[3])
                except ValueError:
                    artist_credit = None
                release_groups[rg_id] = {"gid": rg_gid, "name": rg_name, "artist_credit": artist_credit}

    print(f"    {len(release_groups)} release groups")

    # Combine: recording_id → release_group_id
    recording_to_rg = {}
    for rec_id, med_id in recording_to_medium.items():
        rel_id = medium_to_release.get(med_id)
        if rel_id:
            rg_id = release_to_rg.get(rel_id)
            if rg_id:
                recording_to_rg[rec_id] = rg_id

    print(f"  Final mapping: {len(recording_to_rg)} recordings → release groups")
    return recording_to_rg, release_groups


def parse_artist_credit_name(data_dir: Path) -> dict[int, int]:
    """
    Parse artist_credit_name table.
    Returns mapping of artist_credit_id → artist_id (first/primary artist for that credit).
    
    artist_credit_name columns: artist_credit | position | artist | name | join_phrase
    We take position=0 (the primary credited artist).
    """
    credit_to_artist = {}
    acn_file = data_dir / "mbdump" / "artist_credit_name"

    print("Parsing artist_credit_name table...")
    with open(acn_file, "r", encoding="utf-8") as f:
        for line in f:
            parts = line.strip().split("\t")
            if len(parts) >= 3:
                credit_id = int(parts[0])
                position = int(parts[1])
                artist_id = int(parts[2])
                # Only keep position 0 (primary artist)
                if position == 0:
                    credit_to_artist[credit_id] = artist_id

    print(f"  Found {len(credit_to_artist)} artist credits (primary)")
    return credit_to_artist


def build_album_to_artist_mapping(
    release_groups: dict[int, dict],
    credit_to_artist: dict[int, int],
    artists: dict[int, dict],
) -> dict[str, str]:
    """
    Build mapping of album_gid → primary_artist_gid.
    Uses release_group.artist_credit → artist_credit_name → artist.
    """
    print("Building album → primary artist mapping...")

    album_to_artist = {}  # album_gid → artist_gid
    for rg_id, rg_data in release_groups.items():
        credit_id = rg_data.get("artist_credit")
        if credit_id is None:
            continue
        artist_id = credit_to_artist.get(credit_id)
        if artist_id is None:
            continue
        artist = artists.get(artist_id)
        if artist is None:
            continue
        album_to_artist[rg_data["gid"]] = artist["gid"]

    print(f"  Mapped {len(album_to_artist)} albums to primary artists")
    return album_to_artist


def parse_artist_recording_relationships(
    data_dir: Path,
    links: dict[int, int],
    link_types: dict[int, str],
    relevant_type_ids: set[int],
) -> list[tuple[int, int, str]]:
    """Parse l_artist_recording table. Returns list of (artist_id, recording_id, rel_type_name)."""
    relationships = []
    rel_file = data_dir / "mbdump" / "l_artist_recording"

    print("Parsing l_artist_recording table...")
    with open(rel_file, "r", encoding="utf-8") as f:
        for line in f:
            parts = line.strip().split("\t")
            if len(parts) >= 4:
                # Columns: id, link_id, entity0 (artist), entity1 (recording), ...
                link_id = int(parts[1])
                artist_id = int(parts[2])
                recording_id = int(parts[3])

                link_info = links.get(link_id)
                if link_info:
                    link_type_id, _ = link_info
                    if link_type_id in relevant_type_ids:
                        type_name = link_types[link_type_id]
                        relationships.append((artist_id, recording_id, type_name))

    print(f"  Found {len(relationships)} relevant artist-recording relationships")
    return relationships


def flatten_recording_credits_to_album_credits(
    artist_recording_rels: list[tuple[int, int, str]],
    recording_to_rg: dict[int, int],
    release_groups: dict[int, dict],
    artists: dict[int, dict],
) -> list[tuple[str, str, str]]:
    """
    Flatten recording-level credits to per-artist-per-album credits.
    
    Only includes credits where the artist has their own MusicBrainz artist page
    (i.e., exists in the artists table). This filters out placeholder entries.
    
    Returns list of (artist_gid, album_gid, credit_type) tuples, deduplicated.
    """
    print("Flattening recording credits to album-level credits...")
    print("  (Only including artists with their own MusicBrainz page)")

    # Deduplicate: (artist_id, rg_id, credit_type) → keep unique
    seen = set()
    credits = []

    skipped_no_artist = 0
    for artist_id, recording_id, rel_type in artist_recording_rels:
        # Only include if this artist has their own MB page
        if artist_id not in artists:
            skipped_no_artist += 1
            continue

        rg_id = recording_to_rg.get(recording_id)
        if not rg_id:
            continue

        key = (artist_id, rg_id, rel_type)
        if key in seen:
            continue
        seen.add(key)

        artist = artists[artist_id]
        rg_info = release_groups.get(rg_id)
        if not rg_info:
            continue

        credits.append((artist["gid"], rg_info["gid"], rel_type))

    print(f"  Skipped {skipped_no_artist} credits from non-artist entities")
    print(f"  Unique album credits (before filtering): {len(credits)}")

    # Filter out compilations: albums with more than 25 unique contributors
    # are likely compilations, tribute albums, or festival recordings
    MAX_CONTRIBUTORS_PER_ALBUM = 25
    album_contributor_count: dict[str, int] = defaultdict(int)
    for _, album_gid, _ in credits:
        album_contributor_count[album_gid] += 1

    compilation_gids = {gid for gid, count in album_contributor_count.items() if count > MAX_CONTRIBUTORS_PER_ALBUM}
    print(f"  Filtering {len(compilation_gids)} likely compilations (>{MAX_CONTRIBUTORS_PER_ALBUM} contributors)")

    credits = [(a, alb, ct) for a, alb, ct in credits if alb not in compilation_gids]
    print(f"  Unique album credits (after filtering): {len(credits)}")
    return credits


# Maximum hops from seed artists to include in the browser SQLite
MAX_HOPS = 6


def bfs_reachable(
    seed_gids: set[str],
    relationships: list[tuple[int, int, str]],
    artists: dict[int, dict],
    max_hops: int,
) -> set[str]:
    """
    BFS from seed artist GIDs through member_of/support_musician edges.
    Returns set of all reachable artist GIDs within max_hops.
    """
    print(f"  Running BFS from {len(seed_gids)} seed artists (max {max_hops} hops)...")

    # Build adjacency list using internal IDs for speed
    # First build gid → internal_id mapping
    gid_to_id = {}
    id_to_gid_map = {}
    for aid, data in artists.items():
        gid_to_id[data["gid"]] = aid
        id_to_gid_map[aid] = data["gid"]

    adjacency: dict[int, set[int]] = defaultdict(set)
    for e0, e1, _, _ in relationships:
        adjacency[e0].add(e1)
        adjacency[e1].add(e0)

    # BFS
    seed_ids = set()
    for gid in seed_gids:
        aid = gid_to_id.get(gid)
        if aid is not None:
            seed_ids.add(aid)

    print(f"  Resolved {len(seed_ids)} seed artists to internal IDs")

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
        print(f"    Hop {hop + 1}: +{len(next_frontier)} nodes (total: {len(visited)})")
        if not next_frontier:
            print(f"    No more nodes reachable at hop {hop + 1}, stopping.")
            break

    # Convert back to GIDs
    reachable_gids = set()
    for aid in visited:
        gid = id_to_gid_map.get(aid)
        if gid:
            reachable_gids.add(gid)

    print(f"  BFS complete: {len(reachable_gids)} reachable artists")
    return reachable_gids


def build_graph(
    artists: dict[int, dict],
    relationships: list[tuple[int, int, str]],
    album_credits: list[tuple[str, str, str]],
    release_groups: dict[int, dict],
    album_to_artist: dict[str, str],
    reachable_gids: set[str],
    output_path: Path,
):
    """
    Build unified graph and write to SQLite.
    Only includes nodes/edges where at least one endpoint is in reachable_gids.

    Schema:
        nodes(id TEXT PRIMARY KEY, name TEXT, type TEXT)
            type: "person", "group", "album"
        edges(source TEXT, target TEXT, rel_type TEXT)
            rel_type: "member_of", "support_musician", "producer", "vocal", "instrument", "mix", "engineer", "recording"
        + indexes
    """
    import sqlite3

    print("Building graph...")

    # Build artist id → gid mapping (only for reachable artists)
    type_map = {"1": "person", "2": "group", "3": "group", "4": "group", "5": "person", "6": "person"}
    edge_type_map = {
        "member of band": "member_of",
        "supporting musician": "support_musician",
    }

    id_to_gid = {}
    for aid, data in artists.items():
        if data["gid"] in reachable_gids:
            id_to_gid[aid] = data["gid"]

    print(f"  Reachable artists: {len(reachable_gids)}")

    # Filter album credits to only those involving reachable artists
    filtered_credits = [(a, alb, ct) for a, alb, ct in album_credits if a in reachable_gids]
    album_gids_needed = {alb for _, alb, _ in filtered_credits}

    print(f"  Album credits (filtered): {len(filtered_credits)}")
    print(f"  Albums needed: {len(album_gids_needed)}")

    # Build album gid → data lookup
    gid_to_album = {}
    for rg_id, rg_data in release_groups.items():
        if rg_data["gid"] in album_gids_needed:
            gid_to_album[rg_data["gid"]] = rg_data

    print(f"  Total album nodes: {len(gid_to_album)}")

    # Write SQLite
    if output_path.exists():
        output_path.unlink()

    print(f"  Writing SQLite database: {output_path}")
    conn = sqlite3.connect(str(output_path))
    cur = conn.cursor()

    cur.execute("PRAGMA journal_mode=WAL")
    cur.execute("PRAGMA synchronous=OFF")

    cur.execute("""
        CREATE TABLE nodes (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            type TEXT NOT NULL
        )
    """)

    cur.execute("""
        CREATE TABLE edges (
            source TEXT NOT NULL,
            target TEXT NOT NULL,
            rel_type TEXT NOT NULL
        )
    """)

    # Insert artist nodes (only reachable)
    node_count = 0
    for aid, data in artists.items():
        if data["gid"] in reachable_gids:
            name = data["name"]
            node_type = type_map.get(data["type"], "person") if data["type"] else "person"
            cur.execute("INSERT OR IGNORE INTO nodes (id, name, type) VALUES (?, ?, ?)", (data["gid"], name, node_type))
            node_count += 1

    # Insert album nodes
    for gid, data in gid_to_album.items():
        cur.execute("INSERT OR IGNORE INTO nodes (id, name, type) VALUES (?, ?, ?)", (gid, data["name"], "album"))
        node_count += 1

    # Insert artist-artist edges (deduplicated in Python)
    edge_count = 0
    seen_edges = set()
    for e0, e1, rel_type, ended in relationships:
        gid0 = id_to_gid.get(e0)
        gid1 = id_to_gid.get(e1)
        if gid0 and gid1:
            mapped_type = edge_type_map.get(rel_type, rel_type)
            # Mark ended memberships as former_member_of
            if mapped_type == "member_of" and ended:
                mapped_type = "former_member_of"
            key = (gid0, gid1, mapped_type)
            if key not in seen_edges:
                seen_edges.add(key)
                cur.execute("INSERT INTO edges (source, target, rel_type) VALUES (?, ?, ?)", (gid0, gid1, mapped_type))
                edge_count += 1

    # Insert album credit edges (already deduplicated by flatten function)
    for artist_gid, album_gid, credit_type in filtered_credits:
        key = (artist_gid, album_gid, credit_type)
        if key not in seen_edges:
            seen_edges.add(key)
            cur.execute("INSERT INTO edges (source, target, rel_type) VALUES (?, ?, ?)",
                        (artist_gid, album_gid, credit_type))
            edge_count += 1

    # Insert album_by edges (album → primary artist/band)
    for album_gid in gid_to_album:
        primary_artist_gid = album_to_artist.get(album_gid)
        if primary_artist_gid and primary_artist_gid in reachable_gids:
            key = (album_gid, primary_artist_gid, "album_by")
            if key not in seen_edges:
                seen_edges.add(key)
                cur.execute("INSERT INTO edges (source, target, rel_type) VALUES (?, ?, ?)",
                            (album_gid, primary_artist_gid, "album_by"))
                edge_count += 1

    # Create indexes
    print("  Creating indexes...")
    cur.execute("CREATE INDEX idx_edges_source ON edges(source)")
    cur.execute("CREATE INDEX idx_edges_target ON edges(target)")
    cur.execute("CREATE INDEX idx_edges_rel_type ON edges(rel_type)")
    cur.execute("CREATE INDEX idx_nodes_name ON nodes(name COLLATE NOCASE)")
    cur.execute("CREATE INDEX idx_nodes_type ON nodes(type)")

    conn.commit()
    conn.close()

    print(f"  Output: {node_count} nodes, {edge_count} edges")
    return node_count, edge_count


def main():
    print("=" * 60)
    print("MusicBrainz Dump Processor")
    print("=" * 60)
    print()

    # Step 1: Get dump URL
    try:
        dump_url = get_latest_dump_url()
        print(f"Latest dump: {dump_url}")
    except Exception as e:
        print(f"Error finding latest dump: {e}")
        print("You can manually set the dump URL in the script.")
        print("Check https://data.metabrainz.org/pub/musicbrainz/data/fullexport/")
        return

    # Step 2: Download needed tables
    print()
    download_dump_tables(dump_url)

    # Step 3: Parse link types
    print()
    link_types = parse_link_types(DATA_DIR)

    # Find IDs of relationship types we care about
    relevant_artist_artist_ids = set()
    relevant_artist_recording_ids = set()
    for type_id, type_name in link_types.items():
        if type_name in RELEVANT_ARTIST_ARTIST_TYPES:
            relevant_artist_artist_ids.add(type_id)
            print(f"  Artist-artist type: {type_name} (id={type_id})")
        if type_name in RELEVANT_ARTIST_RECORDING_TYPES:
            relevant_artist_recording_ids.add(type_id)
            print(f"  Artist-recording type: {type_name} (id={type_id})")

    if not relevant_artist_artist_ids:
        print("ERROR: Could not find relevant artist-artist relationship types.")
        return

    # Step 4: Parse links
    print()
    links = parse_links(DATA_DIR)

    # Step 5: Parse artists
    print()
    artists = parse_artists(DATA_DIR)

    # Step 6: Parse artist-artist relationships
    print()
    relationships = parse_artist_relationships(DATA_DIR, links, link_types, relevant_artist_artist_ids)

    # Step 7: Parse recording credits (if tables exist)
    album_credits = []
    release_groups = {}
    album_to_artist = {}
    rec_table = DATA_DIR / "mbdump" / "l_artist_recording"
    if rec_table.exists() and relevant_artist_recording_ids:
        print()
        artist_recording_rels = parse_artist_recording_relationships(
            DATA_DIR, links, link_types, relevant_artist_recording_ids
        )

        print()
        recording_to_rg, release_groups = build_recording_to_release_group(DATA_DIR)

        print()
        album_credits = flatten_recording_credits_to_album_credits(
            artist_recording_rels, recording_to_rg, release_groups, artists
        )

        # Parse artist_credit_name to build album → primary artist mapping
        print()
        acn_table = DATA_DIR / "mbdump" / "artist_credit_name"
        if acn_table.exists():
            credit_to_artist = parse_artist_credit_name(DATA_DIR)
            print()
            album_to_artist = build_album_to_artist_mapping(release_groups, credit_to_artist, artists)
        else:
            print("  Skipping album→artist mapping (artist_credit_name not extracted)")
    else:
        print("\n  Skipping recording credits (tables not extracted)")

    # Step 8: BFS from seed artists to find reachable nodes
    print()
    print("Resolving seed artists...")
    # Seed artists from src/game/artists.ts (names)
    SEED_ARTIST_NAMES = [
        # Modern Pop / Hip Hop / R&B
        "Bruno Mars", "The Weeknd", "Rihanna", "Taylor Swift", "Lady Gaga",
        "Ariana Grande", "Drake", "Billie Eilish", "Kendrick Lamar", "Post Malone",
        "Kanye West", "Beyoncé", "Frank Ocean", "Tyler, the Creator",
        "Pharrell Williams", "Jay-Z", "Snoop Dogg", "Dr. Dre", "André 3000",
        "Nas", "MF DOOM", "Madlib", "RZA", "Q-Tip", "Lauryn Hill",
        "Missy Elliott", "Justin Timberlake", "D'Angelo", "Erykah Badu",
        "Anderson .Paak", "Thundercat", "Flying Lotus",
        # Classic Rock
        "Jimmy Page", "Robert Plant", "John Paul Jones", "Mick Jagger",
        "Keith Richards", "David Bowie", "Paul McCartney", "George Harrison",
        "Eric Clapton", "Jimi Hendrix", "Roger Waters", "David Gilmour",
        "Freddie Mercury", "Brian May", "Pete Townshend", "Neil Young",
        "Stevie Nicks", "Peter Gabriel", "Phil Collins",
        # Punk / Post-Punk
        "Iggy Pop", "Joe Strummer", "Robert Smith", "David Byrne",
        # Grunge / 90s Alt
        "Dave Grohl", "Chris Cornell", "Eddie Vedder", "Billy Corgan",
        "Trent Reznor", "Flea", "John Frusciante", "Tom Morello",
        # Indie / Alternative
        "Thom Yorke", "Jack White", "Josh Homme", "Alex Turner",
        "Damon Albarn", "Noel Gallagher", "Kevin Parker", "Dan Auerbach",
        "Julian Casablancas", "St. Vincent",
        # Garage / Psych
        "Ty Segall", "John Dwyer",
        # Metal
        "Tony Iommi", "Ozzy Osbourne", "James Hetfield", "Lemmy", "Dave Mustaine",
        # R&B / Soul / Funk
        "Prince", "Stevie Wonder", "Michael Jackson", "James Brown",
        # Singer-Songwriters
        "Bob Dylan", "Tom Waits", "Nick Cave", "Johnny Cash",
        "Kate Bush", "Björk", "PJ Harvey",
        # Producers
        "Brian Eno", "Rick Rubin", "Danger Mouse", "Nigel Godrich",
        "Jack Antonoff", "Mark Ronson", "Quincy Jones", "Butch Vig",
        # Iconic Bands
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

    # Resolve seed names to GIDs
    name_to_gid = {}
    for aid, data in artists.items():
        lower_name = data["name"].lower()
        name_to_gid[lower_name] = data["gid"]

    seed_gids = set()
    for name in SEED_ARTIST_NAMES:
        gid = name_to_gid.get(name.lower())
        if gid:
            seed_gids.add(gid)
        else:
            print(f"  WARNING: Seed artist not found in dump: {name}")

    print(f"  Resolved {len(seed_gids)} / {len(SEED_ARTIST_NAMES)} seed artists")

    reachable_gids = bfs_reachable(seed_gids, relationships, artists, MAX_HOPS)

    # Step 9: Build and export SQLite graph
    print()
    OUTPUT_FILE.parent.mkdir(parents=True, exist_ok=True)
    node_count, edge_count = build_graph(artists, relationships, album_credits, release_groups, album_to_artist, reachable_gids, OUTPUT_FILE)

    file_size = OUTPUT_FILE.stat().st_size / (1024 * 1024)
    print()
    print(f"Written to: {OUTPUT_FILE}")
    print(f"File size: {file_size:.1f} MB")

    # Also write a gzipped version for serving
    gz_path = OUTPUT_FILE.with_suffix(".db.gz")
    print(f"Compressing to: {gz_path.name}")
    with open(OUTPUT_FILE, "rb") as f_in:
        with gzip.open(gz_path, "wb") as f_out:
            shutil.copyfileobj(f_in, f_out)

    gz_size = gz_path.stat().st_size / (1024 * 1024)
    print(f"Compressed size: {gz_size:.1f} MB")

    print()
    print("=" * 60)
    print("Done!")
    print(f"  Nodes: {node_count}")
    print(f"  Edges: {edge_count}")
    print(f"  SQLite: {file_size:.1f} MB")
    print(f"  Gzipped: {gz_size:.1f} MB")
    print("=" * 60)


if __name__ == "__main__":
    main()
