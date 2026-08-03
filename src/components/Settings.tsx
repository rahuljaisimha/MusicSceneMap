import { useState } from "react";
import { getApiKey, setApiKey } from "../api/setlistfm";

interface Props {
  onKeyChange: () => void;
}

export function Settings({ onKeyChange }: Props) {
  const [open, setOpen] = useState(false);
  const [key, setKey] = useState(getApiKey() ?? "");
  const [saved, setSaved] = useState(!!getApiKey());

  const handleSave = () => {
    const trimmed = key.trim();
    if (trimmed) {
      setApiKey(trimmed);
      setSaved(true);
      onKeyChange();
    }
  };

  return (
    <div style={styles.wrapper}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        style={styles.toggle}
        aria-label="Settings"
        title="API key settings"
      >
        ⚙
      </button>
      {open && (
        <div style={styles.dropdown}>
          <label style={styles.label}>
            Setlist.fm API Key
            <span style={styles.hint}>
              {" "}
              — <a href="https://www.setlist.fm/settings/api" target="_blank" rel="noreferrer" style={styles.link}>get one free</a>
            </span>
          </label>
          <div style={styles.row}>
            <input
              type="password"
              value={key}
              onChange={(e) => { setKey(e.target.value); setSaved(false); }}
              placeholder="Paste your API key"
              style={styles.input}
              aria-label="Setlist.fm API key"
            />
            <button type="button" onClick={handleSave} disabled={!key.trim()} style={styles.saveBtn}>
              {saved ? "✓ Saved" : "Save"}
            </button>
          </div>
          <p style={styles.note}>
            Stored in your browser's localStorage only. Never sent anywhere except setlist.fm.
          </p>
        </div>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  wrapper: {
    position: "relative",
  },
  toggle: {
    background: "none",
    border: "none",
    color: "#888",
    fontSize: "1.2rem",
    cursor: "pointer",
    padding: "0.25rem 0.5rem",
  },
  dropdown: {
    position: "absolute",
    top: "100%",
    right: 0,
    marginTop: "0.5rem",
    background: "#1a1a1a",
    border: "1px solid #333",
    borderRadius: "6px",
    padding: "0.75rem",
    width: "320px",
    zIndex: 100,
    boxShadow: "0 4px 12px rgba(0,0,0,0.5)",
  },
  label: {
    fontSize: "0.8rem",
    fontWeight: 600,
    color: "#ccc",
    display: "block",
    marginBottom: "0.4rem",
  },
  hint: {
    fontWeight: 400,
    color: "#888",
  },
  link: {
    color: "#48dbfb",
    textDecoration: "none",
  },
  row: {
    display: "flex",
    gap: "0.5rem",
  },
  input: {
    flex: 1,
    padding: "0.4rem 0.6rem",
    borderRadius: "4px",
    border: "1px solid #444",
    background: "#2a2a2a",
    color: "#e0e0e0",
    fontSize: "0.85rem",
  },
  saveBtn: {
    padding: "0.4rem 0.75rem",
    borderRadius: "4px",
    border: "none",
    background: "#55efc4",
    color: "#000",
    fontWeight: 600,
    cursor: "pointer",
    fontSize: "0.8rem",
    whiteSpace: "nowrap",
  },
  note: {
    fontSize: "0.7rem",
    color: "#666",
    marginTop: "0.4rem",
  },
};
