#!/usr/bin/env python3
"""
MusicBrainz Data Dump Processor
================================

Builds the browser graph (public/graph.db.gz) from the MusicBrainz data dump.
seed_supabase.py builds Postgres from the same inputs (load_graph_inputs).

Usage:
    python3 scripts/process_mb_dump.py                      # then: python3 scripts/add_concertdb_edges.py
    python3 scripts/process_mb_dump.py --concertdb-hops 2   # fewer hops around concert-database's artists

Requirements:
    - Python 3.10+
    - ~25GB free disk space (download + extracted tables), ~10GB RAM
    - Internet connection (for the initial download)
    - Optional: a concert-database ledger (CONCERTDB_LEDGER, default
      ~/concert-database/data/ledger.sqlite); without it only the curated seeds are used

Which artists: every artist within 6 hops of the curated seeds (SEED_ARTIST_NAMES)
and of each artist with a concert in concert-database (CONCERTDB_HOPS, default 6),
over band relationships (member of / supporting musician). If graph.db.gz comes
out over MAX_GZIP_MB, it is rebuilt with one hop fewer around concert-database's
artists until it fits; Supabase keeps the full set.

Edges: band relationships, plus collaborations: a producer / vocal / instrument / performer
credit on another artist's record becomes one "produced_for" or
"collaborated_with" edge to that record's artist (see build_collaborations).
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
# Credits kept (see COLLAB_REL_TYPES): producing and performing. Engineering
# credits (mix, engineer, recording) are left out.
RELEVANT_ARTIST_RECORDING_TYPES = {
    "producer",
    "vocal",
    "instrument",
    "performer",
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
        "mbdump/area",
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


def parse_areas(data_dir: Path) -> dict[int, str]:
    """Parse area table (countries, cities, ...). Returns dict of area_id → name."""
    areas = {}
    with open(data_dir / "mbdump" / "area", "r", encoding="utf-8") as f:
        for line in f:
            # Columns: id, gid, name, type, ...
            parts = line.rstrip("\n").split("\t")
            if len(parts) >= 3:
                areas[int(parts[0])] = parts[2]
    print(f"  Found {len(areas)} areas")
    return areas


def parse_artists(data_dir: Path, areas: dict[int, str]) -> dict[int, dict]:
    """
    Parse artist table. Returns dict of artist_id → {name, type, gid,
    disambiguation, area}. `area` is the begin area (usually a city: where a
    band formed or a person was born), else the artist's area (often a country).
    Both label artists in the app's search dropdowns.
    """
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
                comment = parts[13] if len(parts) > 13 and parts[13] != "\\N" else ""
                area_name = None
                for idx in (17, 11):  # begin_area, then area
                    if len(parts) > idx and parts[idx] != "\\N":
                        area_name = areas.get(int(parts[idx]))
                        if area_name:
                            break

                artists[artist_id] = {
                    "name": name,
                    "gid": gid,
                    "type": artist_type,
                    "disambiguation": comment or None,
                    "area": area_name,
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


def parse_artist_recording_relationships(
    data_dir: Path,
    links: dict[int, tuple[int, bool]],
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
                link_info = links.get(int(parts[1]))
                if link_info and link_info[0] in relevant_type_ids:
                    relationships.append((int(parts[2]), int(parts[3]), link_types[link_info[0]]))

    print(f"  Found {len(relationships)} relevant artist-recording relationships")
    return relationships


# --- Collaborations ----------------------------------------------------------
#
# A credit on someone else's record becomes one edge from the credited artist to
# the album's (release group's) first credited artist, e.g. Josh Homme -> Arctic
# Monkeys for producing and playing on Humbug. Producing and performing are kept
# apart; engineering credits (mix, engineer, recording) are left out. `count` is
# the number of song credits behind the edge (one per credited recording, per role).
# Albums aren't stored: no album nodes, no album table.

COLLAB_REL_TYPES = {
    "producer": "produced_for",        # produced their record
    "vocal": "collaborated_with",      # sang on their record
    "instrument": "collaborated_with", # played on their record
    "performer": "collaborated_with",  # performed on it (MusicBrainz's general performance credit)
}
VARIOUS_ARTISTS = "89ad4ac3-39f7-470e-963a-56509c546377"


def build_collaborations(
    artist_recording_rels: list[tuple[int, int, str]],
    recording_to_rg: dict[int, int],
    release_groups: dict[int, dict],
    credit_to_artist: dict[int, int],
    artists: dict[int, dict],
) -> dict[tuple[str, str, str], int]:
    """(contributor MBID, album artist MBID, rel_type) -> number of song credits.

    Credits on an artist's own records, on "Various Artists" compilations, and
    by entities without their own artist entry are skipped.
    """
    print("Building collaborations (credited artist -> album artist)...")
    counts: dict[tuple[str, str, str], int] = defaultdict(int)
    for artist_id, recording_id, credit in artist_recording_rels:
        rel = COLLAB_REL_TYPES.get(credit)
        if rel is None or artist_id not in artists:
            continue
        rg = recording_to_rg.get(recording_id)
        info = release_groups.get(rg) if rg is not None else None
        if not info:
            continue
        owner = credit_to_artist.get(info.get("artist_credit"))
        if owner is None or owner == artist_id or owner not in artists:
            continue
        owner_gid = artists[owner]["gid"]
        if owner_gid == VARIOUS_ARTISTS:
            continue
        counts[(artists[artist_id]["gid"], owner_gid, rel)] += 1
    by_type = defaultdict(int)
    for (_, _, rel) in counts:
        by_type[rel] += 1
    print(f"  Collaborations: {len(counts)} ({dict(by_type)})")
    return counts


# --- Which artists are in the graph -------------------------------------------

# Curated seed artists (also the game's list, src/game/artists.ts), and the
# artists with concerts in concert-database (https://github.com/rahuljaisimha/concert-database),
# read from its ledger. The graph is every artist within a seed's hop budget over
# band relationships (member of / supporting musician).
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

CURATED_HOPS = 6
CONCERTDB_HOPS = int(os.environ.get("CONCERTDB_HOPS") or 6)
CONCERTDB_LEDGER = Path(os.environ.get("CONCERTDB_LEDGER")
                        or Path.home() / "concert-database" / "data" / "ledger.sqlite")
# The browser download (graph.db.gz). If the graph comes out bigger, it is rebuilt
# with fewer hops around concert-database's artists (Supabase keeps them all and
# answers for the rest). The app downloads it in the background (preloadDb) and
# answers from Supabase until it has loaded, so a bigger file only delays the
# local graph, it doesn't block the page.
MAX_GZIP_MB = 74

TYPE_MAP = {"1": "person", "2": "group", "3": "group", "4": "group", "5": "person", "6": "person"}


def node_type(raw_type: str | None) -> str:
    """MusicBrainz artist type id -> "person" | "group"."""
    return TYPE_MAP.get(raw_type, "person") if raw_type else "person"


def resolve_curated_seeds(artists: dict[int, dict]) -> set[str]:
    name_to_gid = {data["name"].lower(): data["gid"] for data in artists.values()}
    seeds = set()
    for name in SEED_ARTIST_NAMES:
        gid = name_to_gid.get(name.lower())
        if gid:
            seeds.add(gid)
        else:
            print(f"  WARNING: Seed artist not found in dump: {name}")
    print(f"  Curated seeds: {len(seeds)} / {len(SEED_ARTIST_NAMES)}")
    return seeds


def concertdb_seeds(ledger: Path, artists: dict[int, dict]) -> set[str]:
    """MusicBrainz IDs of artists with at least one concert in the concert-database
    ledger (read-only). Empty, with a warning, if there is no ledger."""
    import sqlite3

    if not ledger.exists():
        print(f"  WARNING: no concert-database ledger at {ledger}: curated seeds only"
              " (set CONCERTDB_LEDGER)")
        return set()
    conn = sqlite3.connect(f"file:{ledger}?mode=ro", uri=True)
    try:
        mbids = {r[0] for r in conn.execute(
            "SELECT DISTINCT a.mbid FROM billings b JOIN artists a ON a.id = b.artist_id"
            " WHERE a.mbid IS NOT NULL")}
    finally:
        conn.close()
    known = {data["gid"] for data in artists.values()}
    seeds = mbids & known
    print(f"  concert-database seeds: {len(seeds)} artists with concerts ({len(mbids) - len(seeds)} not in this dump)")
    return seeds


def seed_budgets(curated: set[str], concert: set[str], concert_hops: int) -> dict[str, int]:
    budgets = {gid: concert_hops for gid in concert}
    for gid in curated:
        budgets[gid] = max(budgets.get(gid, 0), CURATED_HOPS)
    return budgets


def bfs_reachable(
    budgets: dict[str, int],
    relationships: list[tuple[int, int, str, bool]],
    artists: dict[int, dict],
) -> set[str]:
    """Every artist within some seed's hop budget over band relationships
    (member of / supporting musician). budgets: seed MBID -> hops."""
    gid_to_id = {data["gid"]: aid for aid, data in artists.items()}
    adjacency: dict[int, set[int]] = defaultdict(set)
    for e0, e1, _, _ in relationships:
        adjacency[e0].add(e1)
        adjacency[e1].add(e0)

    # A node keeps the largest budget it is reached with; expand from the biggest first.
    best: dict[int, int] = {}
    for gid, hops in budgets.items():
        aid = gid_to_id.get(gid)
        if aid is not None:
            best[aid] = max(best.get(aid, -1), hops)
    buckets: dict[int, set[int]] = defaultdict(set)
    for aid, hops in best.items():
        buckets[hops].add(aid)
    for hops in range(max(buckets, default=0), 0, -1):
        for aid in buckets.pop(hops, ()):
            if best.get(aid) != hops:
                continue
            for neighbor in adjacency.get(aid, ()):
                if best.get(neighbor, -1) < hops - 1:
                    best[neighbor] = hops - 1
                    buckets[hops - 1].add(neighbor)

    reachable = {artists[aid]["gid"] for aid in best}
    print(f"  BFS from {len(budgets)} seeds: {len(reachable)} artists")
    return reachable


def band_edges(relationships, artists, reachable_gids):
    """(source MBID, target MBID, rel_type) for band relationships between reachable
    artists, deduplicated. A membership is current if ANY of its MusicBrainz
    relationships hasn't ended (so Dave Grohl isn't a former member of Foo Fighters)."""
    id_to_gid = {aid: data["gid"] for aid, data in artists.items() if data["gid"] in reachable_gids}
    current: dict[tuple[str, str], bool] = {}
    for e0, e1, rel_type, ended in relationships:
        if rel_type == "member of band" and e0 in id_to_gid and e1 in id_to_gid:
            key = (id_to_gid[e0], id_to_gid[e1])
            current[key] = current.get(key, False) or not ended
    seen = set()
    for e0, e1, rel_type, ended in relationships:
        gid0, gid1 = id_to_gid.get(e0), id_to_gid.get(e1)
        if not gid0 or not gid1:
            continue
        if rel_type == "member of band":
            mapped = "member_of" if current[(gid0, gid1)] else "former_member_of"
        else:
            mapped = "support_musician"
        key = (gid0, gid1, mapped)
        if key not in seen:
            seen.add(key)
            yield key


def build_graph(
    artists: dict[int, dict],
    relationships: list[tuple[int, int, str, bool]],
    collaborations: dict[tuple[str, str, str], int],
    reachable_gids: set[str],
    output_path: Path,
    meta: dict[str, str] | None = None,
):
    """
    Write the browser SQLite graph: reachable artists, band edges between them,
    and collaborations where both artists are reachable.

    Schema:
        nodes(id TEXT PRIMARY KEY, name TEXT, type TEXT, disambiguation TEXT, area TEXT)
            type: "person", "group"; disambiguation/area NULL when MusicBrainz has none
        edges(source TEXT, target TEXT, rel_type TEXT)
            rel_type: "member_of", "former_member_of", "support_musician",
                      "collaborated_with", "produced_for" (credited artist -> album artist)
        graph_meta(key TEXT PRIMARY KEY, value TEXT)
        + indexes
    """
    import sqlite3

    print(f"Building graph: {len(reachable_gids)} artists...")
    if output_path.exists():
        output_path.unlink()
    conn = sqlite3.connect(str(output_path))
    cur = conn.cursor()
    cur.execute("PRAGMA synchronous=OFF")
    cur.execute("CREATE TABLE nodes (id TEXT PRIMARY KEY, name TEXT NOT NULL, type TEXT NOT NULL,"
                " disambiguation TEXT, area TEXT)")
    cur.execute("CREATE TABLE edges (source TEXT NOT NULL, target TEXT NOT NULL, rel_type TEXT NOT NULL)")
    cur.execute("CREATE TABLE graph_meta (key TEXT PRIMARY KEY, value TEXT)")

    cur.executemany(
        "INSERT OR IGNORE INTO nodes (id, name, type, disambiguation, area) VALUES (?, ?, ?, ?, ?)",
        ((d["gid"], d["name"], node_type(d["type"]), d["disambiguation"], d["area"])
         for d in artists.values() if d["gid"] in reachable_gids))
    node_count = cur.execute("SELECT COUNT(*) FROM nodes").fetchone()[0]

    cur.executemany("INSERT INTO edges (source, target, rel_type) VALUES (?, ?, ?)",
                    band_edges(relationships, artists, reachable_gids))
    cur.executemany("INSERT INTO edges (source, target, rel_type) VALUES (?, ?, ?)",
                    ((a, b, rel) for (a, b, rel) in collaborations
                     if a in reachable_gids and b in reachable_gids))
    edge_count = cur.execute("SELECT COUNT(*) FROM edges").fetchone()[0]
    cur.executemany("INSERT INTO graph_meta (key, value) VALUES (?, ?)", (meta or {}).items())

    print("  Creating indexes...")
    cur.execute("CREATE INDEX idx_edges_source ON edges(source)")
    cur.execute("CREATE INDEX idx_edges_target ON edges(target)")
    cur.execute("CREATE INDEX idx_edges_rel_type ON edges(rel_type)")
    cur.execute("CREATE INDEX idx_nodes_name ON nodes(name COLLATE NOCASE)")
    cur.execute("CREATE INDEX idx_nodes_type ON nodes(type)")
    conn.commit()
    conn.execute("VACUUM")
    conn.close()
    print(f"  Output: {node_count} nodes, {edge_count} edges")
    return node_count, edge_count


def load_graph_inputs():
    """Everything both the browser graph and seed_supabase.py are built from."""
    link_types = parse_link_types(DATA_DIR)
    aa_ids = {t for t, n in link_types.items() if n in RELEVANT_ARTIST_ARTIST_TYPES}
    ar_ids = {t for t, n in link_types.items() if n in RELEVANT_ARTIST_RECORDING_TYPES}
    if not aa_ids:
        raise RuntimeError("Could not find relevant artist-artist relationship types.")
    links = parse_links(DATA_DIR)
    artists = parse_artists(DATA_DIR, parse_areas(DATA_DIR))
    relationships = parse_artist_relationships(DATA_DIR, links, link_types, aa_ids)
    credits = parse_artist_recording_relationships(DATA_DIR, links, link_types, ar_ids)
    recording_to_rg, release_groups = build_recording_to_release_group(DATA_DIR)
    credit_to_artist = parse_artist_credit_name(DATA_DIR)
    collaborations = build_collaborations(credits, recording_to_rg, release_groups, credit_to_artist, artists)
    del credits, recording_to_rg, release_groups, credit_to_artist
    print()
    curated = resolve_curated_seeds(artists)
    concert = concertdb_seeds(CONCERTDB_LEDGER, artists)
    return artists, relationships, collaborations, curated, concert


def main():
    import argparse
    from datetime import datetime, timezone

    ap = argparse.ArgumentParser(description="Build public/graph.db.gz from the MusicBrainz dump")
    ap.add_argument("--concertdb-hops", type=int, default=CONCERTDB_HOPS,
                    help="hops around concert-database's artists (lowered automatically to fit --max-gzip-mb)")
    ap.add_argument("--max-gzip-mb", type=float, default=MAX_GZIP_MB)
    args = ap.parse_args()

    print("=" * 60)
    print("MusicBrainz Dump Processor")
    print("=" * 60)
    dump_url = get_latest_dump_url()
    print(f"Latest dump: {dump_url}")
    download_dump_tables(dump_url)
    print()
    artists, relationships, collaborations, curated, concert = load_graph_inputs()

    OUTPUT_FILE.parent.mkdir(parents=True, exist_ok=True)
    gz_path = OUTPUT_FILE.with_suffix(".db.gz")
    for hops in range(args.concertdb_hops, -1, -1):
        print(f"\nconcert-database artists at {hops} hops (curated seeds at {CURATED_HOPS}):")
        reachable = bfs_reachable(seed_budgets(curated, concert, hops), relationships, artists)
        meta = {"built_at": datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
                "musicbrainz_dump": dump_url.rsplit("/", 1)[-1], "curated_seeds": str(len(curated)),
                "curated_hops": str(CURATED_HOPS), "concertdb_seeds": str(len(concert)),
                "concertdb_hops": str(hops)}
        node_count, edge_count = build_graph(artists, relationships, collaborations, reachable, OUTPUT_FILE, meta)
        with open(OUTPUT_FILE, "rb") as f_in, gzip.open(gz_path, "wb", compresslevel=9) as f_out:
            shutil.copyfileobj(f_in, f_out)
        gz_mb = gz_path.stat().st_size / 1e6
        print(f"  graph.db.gz: {gz_mb:.1f} MB (limit {args.max_gzip_mb} MB)")
        if gz_mb <= args.max_gzip_mb or not concert:
            break
        print("  Too big for the browser download: one hop fewer around concert-database's artists")

    print()
    print("=" * 60)
    print(f"Done: {node_count} nodes, {edge_count} edges, concert-database hops {hops}")
    print(f"  SQLite: {OUTPUT_FILE.stat().st_size / 1e6:.1f} MB, gzipped: {gz_mb:.1f} MB")
    print("  Next: python3 scripts/add_concertdb_edges.py (opened_for edges)")
    print("=" * 60)


if __name__ == "__main__":
    main()
