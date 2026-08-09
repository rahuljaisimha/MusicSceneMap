export function AboutPage() {
  return (
    <div style={styles.container}>
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

        <h2 style={styles.heading}>Data</h2>
        <p style={styles.paragraph}>
          Powered by a precomputed graph database built from{" "}
          <a href="https://musicbrainz.org" target="_blank" rel="noreferrer" style={styles.link}>
            MusicBrainz
          </a>{" "}
          data dumps. MusicBrainz is an open music encyclopedia with artist relationships,
          band members, recording credits, and more — all under{" "}
          <a href="https://creativecommons.org/publicdomain/zero/1.0/" target="_blank" rel="noreferrer" style={styles.link}>
            CC0
          </a>{" "}
          (public domain).
        </p>
        <p style={styles.paragraph}>
          The database is loaded directly in your browser via WebAssembly (sql.js) — no backend
          server required. First visit downloads ~60MB (cached after that).
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
