/** Where the data comes from, and that it's incomplete. Pinned under each page by
 *  Layout; the home page puts it after its content instead (`inline`). */
export function SiteFooter({ inline = false }: { inline?: boolean }) {
  return (
    <footer className="site-footer" style={inline ? { ...styles.footer, ...styles.inline } : styles.footer}>
      Data from MusicBrainz, setlist.fm and Pollstar. Connections and shows may be missing due to incomplete data.
    </footer>
  );
}

const styles: Record<string, React.CSSProperties> = {
  footer: {
    flex: "none",
    padding: "0.3rem 0.75rem",
    borderTop: "1px solid #1f1f1f",
    background: "#0f0f0f",
    color: "#666",
    fontSize: "0.65rem",
    lineHeight: 1.25,
    textAlign: "center",
  },
  // After the home page's content, at the bottom of the screen when it's short;
  // full width (out over the page's side padding, which index.css narrows on phones)
  inline: {
    marginTop: "auto",
    alignSelf: "stretch",
    marginLeft: "-2rem",
    marginRight: "-2rem",
  },
};
