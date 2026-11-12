import type { StorageStatus } from "./types";

/**
 * What this deployment is entitled to promise a visitor.
 *
 * - `demo`: a seeded, read-mostly showcase. Storage can vanish on cold start,
 *   so the server refuses to accept anything a visitor would expect to keep
 *   (pasted sources, fetched URLs, removals, browser-supplied model keys).
 * - `product`: durable storage is configured and reachable. Custom sources may
 *   be accepted.
 *
 * The classification is derived from storage facts, never from a UI toggle or
 * request input, so a client cannot talk the server into persisting data it
 * will lose.
 */
export type DeploymentMode = "demo" | "product";

export type DemoReason =
  | "ephemeral_storage"
  | "database_unreachable"
  | "forced_by_operator";

export type DeploymentPosture = {
  mode: DeploymentMode;
  reasons: DemoReason[];
  /** Visitors may add or remove their own sources. */
  customSources: boolean;
  /** Imports work but are lost when the server restarts (no durable storage). */
  temporaryImports: boolean;
  /** Visitors may hand the server their own provider keys. */
  visitorKeys: boolean;
  /** One sentence a visitor can read without knowing what Postgres is. */
  headline: string;
};

export const DEMO_HEADLINE =
  "Interactive demo · you can import sources, but they are temporary and disappear when the server restarts.";
export const PRODUCT_HEADLINE = "Your sources are stored durably.";

export function classifyDeployment(input: {
  storage: Pick<StorageStatus, "durable" | "backend">;
  /** `false` only when a reachability check ran and failed. */
  databaseReachable?: boolean;
  /** Operator escape hatch: `INTELLIRAG_PUBLIC_DEMO=1` keeps a durable host in demo posture. */
  forceDemo?: boolean;
}): DeploymentPosture {
  const reasons: DemoReason[] = [];
  if (!input.storage.durable || input.storage.backend === "ephemeral") {
    reasons.push("ephemeral_storage");
  }
  if (input.databaseReachable === false) reasons.push("database_unreachable");
  if (input.forceDemo) reasons.push("forced_by_operator");
  const demo = reasons.length > 0;
  const temporaryImports = reasons.includes("ephemeral_storage") || reasons.includes("database_unreachable");
  return {
    mode: demo ? "demo" : "product",
    reasons,
    // Pasted sources and URL imports keep working on a temporary host; the page
    // says plainly that they do not survive a restart. Only an operator pin
    // turns them off.
    customSources: !reasons.includes("forced_by_operator"),
    temporaryImports,
    // Visitor keys live in the visitor's own HttpOnly cookie and are read per request,
    // never stored on the server. Only an operator pin turns them off.
    visitorKeys: !reasons.includes("forced_by_operator"),
    headline: demo ? DEMO_HEADLINE : PRODUCT_HEADLINE,
  };
}

export class DemoModeRefusal extends Error {
  readonly code = "demo_mode";
  constructor(action: string) {
    super(
      `${action} is turned off on this public demo. ` +
        "Ask the seeded sources instead, or run IntelliRAG with a database and your own keys.",
    );
    this.name = "DemoModeRefusal";
  }
}

/** Throw before accepting a visitor's model key on a host that cannot keep it safe. */
export function assertVisitorKeysAllowed(posture: DeploymentPosture, action: string) {
  if (!posture.visitorKeys) throw new DemoModeRefusal(action);
}

/** Throw when the operator has switched source changes off. */
export function assertCustomSourcesAllowed(posture: DeploymentPosture, action: string) {
  if (!posture.customSources) throw new DemoModeRefusal(action);
}
