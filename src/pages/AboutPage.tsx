export function AboutPage() {
  return (
    <div className="page-container" style={styles.container}>
      <div style={styles.content}>
        <h1 style={styles.title}>About MusicSceneMap</h1>
        <p style={styles.paragraph}>
          MusicSceneMap is a graph-powered music discovery tool that maps the relationships
          between artists, musicians, and bands. Instead of recommending music based on genre
          tags or listening history, it reveals the real-world connections — shared band members,
          side projects, and collaborations — that create music scenes.
        </p>

        <h2 style={styles.heading}>Explore</h2>
        <p style={styles.paragraph}>
          Search for any artist or band and visualize their network — band members, former members,
          side projects, and supporting musicians rendered as an interactive force-directed graph.
          Click any node to see its connections, then expand further. Your graph persists between
          sessions so you can build up a rich map over time.
        </p>

        <h2 style={styles.heading}>Six Degrees of Music</h2>
        <p style={styles.paragraph}>
          A game that gives you two musicians (or two bands) and challenges you to find a path
          connecting them through band memberships and supporting roles. The app computes the
          shortest possible path and shows you a "par" to beat. Navigate by selecting from the
          list of valid connections at each step.
        </p>
        <p style={styles.paragraph}>
          You can start a random game, or create a custom game between any two connected artists
          or bands (they don't have to be the same type). Every game has a shareable link —
          hit Share to copy a URL that drops a friend into the exact same puzzle.
        </p>

        <h2 style={styles.heading}>Discover</h2>
        <p style={styles.paragraph}>
          Find venues in any city based on artists you like. Enter a city and your favorite
          artists — the app finds venues where they've performed, then automatically expands to
          related bands for richer recommendations. Data comes from Setlist.fm and is cached
          for future queries.
        </p>
        <p style={styles.paragraph}>
          Toggle to <strong>Concerts</strong> to see upcoming shows at the city's top venues,
          ranked by how well each concert's artist fits your taste — reusing the same graph-based
          similarity scoring. Upcoming event data comes from Pollstar (fetched live in your browser
          and cached for 24 hours). Artists not yet in the graph are shown but ranked lowest.
        </p>

        <h2 style={styles.heading}>Similarity Score</h2>
        <p style={styles.paragraph}>
          Give the app a list of artists you like plus one artist to compare, and it scores how
          closely that artist fits the group — from 0 (no connection) to 100 (same musical world).
          The score uses every relationship in the graph: band memberships, former memberships,
          supporting roles, and album credits.
        </p>
        <p style={styles.paragraph}>
          Not all connections count equally. Current band members are the strongest signal, former
          members slightly less, and supporting musicians less again. Album collaborations are
          weighted by how many credits two artists share. The breakdown shows exactly how each
          connection was made — the shared bandmates, side projects, and albums that link them —
          so a strong match is never a black box.
        </p>

        <h2 style={styles.heading}>Data</h2>
        <p style={styles.paragraph}>
          Powered by a precomputed graph database built from{" "}
          <a href="https://musicbrainz.org" target="_blank" rel="noreferrer" style={styles.link}>
            MusicBrainz
          </a>{" "}
          data dumps (artist relationships, band members, recording credits) and live data from{" "}
          <a href="https://www.setlist.fm" target="_blank" rel="noreferrer" style={styles.link}>
            Setlist.fm
          </a>{" "}
          (venues, concert history). Upcoming concert listings come from{" "}
          <a href="https://www.pollstar.com" target="_blank" rel="noreferrer" style={styles.link}>
            Pollstar
          </a>. MusicBrainz data is under{" "}
          <a href="https://creativecommons.org/publicdomain/zero/1.0/" target="_blank" rel="noreferrer" style={styles.link}>
            CC0
          </a>{" "}
          (public domain).
        </p>
        <p style={styles.paragraph}>
          Explore, Play, and Similarity use a SQLite database loaded in your browser via WebAssembly
          (~60MB, cached after first visit). Discover queries a backend database that fetches and caches
          venue data on demand.
        </p>

        <h2 style={styles.heading}>Source Code</h2>
        <p style={styles.paragraph}>
          <a href="https://github.com/rahuljaisimha/MusicSceneMap" target="_blank" rel="noreferrer" style={styles.link}>
            github.com/rahuljaisimha/MusicSceneMap
          </a>
        </p>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    flex: 1,
    overflowY: "auto",
    padding: "2rem",
    display: "flex",
    justifyContent: "center",
  },
  content: {
    maxWidth: "600px",
    width: "100%",
  },
  title: {
    fontSize: "1.6rem",
    fontWeight: 700,
    color: "#e0e0e0",
    marginBottom: "1rem",
  },
  heading: {
    fontSize: "1.1rem",
    fontWeight: 600,
    color: "#e0e0e0",
    marginTop: "1.5rem",
    marginBottom: "0.5rem",
  },
  paragraph: {
    color: "#aaa",
    fontSize: "0.9rem",
    lineHeight: 1.6,
    marginBottom: "0.75rem",
  },
  link: {
    color: "#48dbfb",
    textDecoration: "none",
  },
};
