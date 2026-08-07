import { NavLink, Outlet } from "react-router-dom";

export function Layout() {
  return (
    <>
      <nav style={styles.nav}>
        <span style={styles.brand}>MusicSceneMap</span>
        <div style={styles.links}>
          <NavLink to="/" style={({ isActive }) => ({ ...styles.link, ...(isActive ? styles.activeLink : {}) })}>
            Explore
          </NavLink>
          <NavLink to="/play" style={({ isActive }) => ({ ...styles.link, ...(isActive ? styles.activeLink : {}) })}>
            Play
          </NavLink>
          <NavLink to="/about" style={({ isActive }) => ({ ...styles.link, ...(isActive ? styles.activeLink : {}) })}>
            About
          </NavLink>
        </div>
      </nav>
      <Outlet />
    </>
  );
}

const styles: Record<string, React.CSSProperties> = {
  nav: {
    display: "flex",
    alignItems: "center",
    gap: "1rem",
    padding: "0.5rem 0.75rem",
    background: "#1a1a1a",
    borderBottom: "1px solid #2a2a2a",
  },
  brand: {
    fontWeight: 700,
    fontSize: "1.1rem",
    color: "#ff6b6b",
    marginRight: "auto",
  },
  links: {
    display: "flex",
    gap: "0.75rem",
  },
  link: {
    color: "#888",
    textDecoration: "none",
    fontSize: "0.9rem",
    fontWeight: 500,
    padding: "0.25rem 0.5rem",
    borderRadius: "4px",
    transition: "color 0.2s",
  },
  activeLink: {
    color: "#e0e0e0",
    background: "#2a2a2a",
  },
};
