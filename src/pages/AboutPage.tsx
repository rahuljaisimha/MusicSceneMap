export function AboutPage() {
  return (
    <div style={styles.container}>
      <div style={styles.content}>
        <h1 style={styles.title}>About MusicSceneMap</h1>
        <p style={styles.paragraph}>
          MusicSceneMap is a graph-powered music discovery tool that maps the relationships
          between artists, musicians, venues, and communities. Instead of recommending music
          based on genre tags or listening history, it reveals the real-world connections that
          create music scenes.
        </p>

        <h2 style={styles.heading}>Explore</h2>
        <p style={styles.paragraph}>
          Search for any artist and watch their network unfold — band members, side projects,
          collaborators, and supporting musicians. Each node you expand reveals more connections.
          The graph persists between sessions so you can build up a rich map over time.
        </p>

        <h2 style={styles.heading}>Play</h2>
        <p style={styles.paragraph}>
          A "Six Degrees of Music" game where you connect two musicians through the shortest
          path of band memberships, collaborations, and shared stages. Coming soon.
        </p>

        <h2 style={styles.heading}>Data Sources</h2>
        <ul style={styles.list}>
          <li>
            <a href="https://musicbrainz.org" target="_blank" rel="noreferrer" style={styles.link}>
              MusicBrainz
            </a>{" "}
            — Artist relationships, band members, labels, and recording credits.
            Open data under{" "}
            <a href="https://creativecommons.org/publicdomain/zero/1.0/" target="_blank" rel="noreferrer" style={styles.link}>
              CC0
            </a>.
          </li>
          <li>
            <a href="https://www.setlist.fm" target="_blank" rel="noreferrer" style={styles.link}>
              Setlist.fm
            </a>{" "}
            — Venue data, setlists, and touring history. Used optionally for venue discovery.
          </li>
        </ul>

        <h2 style={styles.heading}>Source Code</h2>
        <p style={styles.paragraph}>
          <a href="https://github.com/rahuljaisimha/MusicSceneMap" target="_blank" rel="noreferrer" style={styles.link}>
            github.com/rahuljaisimha/MusicSceneMap
          </a>
        </p>

        <h2 style={styles.heading}>How it Works</h2>
        <p style={styles.paragraph}>
          This is a static site with no backend. All API calls are made directly from your
          browser. Responses are cached locally for 48 hours to minimize load on upstream
          services. Your graph and settings are stored in your browser's localStorage.
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
  list: {
    color: "#aaa",
    fontSize: "0.9rem",
    lineHeight: 1.8,
    paddingLeft: "1.25rem",
  },
  link: {
    color: "#48dbfb",
    textDecoration: "none",
  },
};
