import type { EdgeType } from "./types";

/**
 * The relationship types Explore can show, in legend order. Every edge points
 * the way it is stored in the graph (`direction`); the band relationships are
 * shown by default, the rest can be ticked in the legend.
 */
export interface RelationshipInfo {
  type: EdgeType;
  label: string;
  direction: string;
  defaultOn: boolean;
}

export const EXPLORE_RELATIONSHIPS: RelationshipInfo[] = [
  { type: "member_of", label: "Member", direction: "member → group", defaultOn: true },
  { type: "former_member_of", label: "Former member", direction: "member → group", defaultOn: true },
  { type: "support_musician", label: "Supporting musician", direction: "musician → group", defaultOn: true },
  { type: "collaborated_with", label: "Played or sang on their records", direction: "musician → record's artist", defaultOn: false },
  { type: "produced_for", label: "Produced their records", direction: "producer → record's artist", defaultOn: false },
  { type: "opened_for", label: "Opened for", direction: "opener → headliner", defaultOn: false },
];

export const DEFAULT_EXPLORE_RELS: EdgeType[] = EXPLORE_RELATIONSHIPS.filter((r) => r.defaultOn).map((r) => r.type);

const STORAGE_KEY = "explore.relTypes";

/** The viewer's ticked types (this browser), else the defaults. */
export function loadVisibleRels(): EdgeType[] {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null");
    const known = new Set<string>(EXPLORE_RELATIONSHIPS.map((r) => r.type));
    if (Array.isArray(saved)) return saved.filter((t): t is EdgeType => typeof t === "string" && known.has(t));
  } catch {
    /* no storage: defaults */
  }
  return DEFAULT_EXPLORE_RELS;
}

export function saveVisibleRels(types: EdgeType[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(types));
  } catch {
    /* not remembered */
  }
}
