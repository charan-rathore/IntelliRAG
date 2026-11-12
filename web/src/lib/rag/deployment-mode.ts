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
  /** Visitors may hand the server their own provider keys. */
  visitorKeys: boolean;
  /** One sentence a visitor can read without knowing what Postgres is. */
  headline: string;
};

export const DEMO_HEADLINE =
  "Interactive demo · seed corpus only. Nothing you add here is kept.";
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
  return {
    mode: demo ? "demo" : "product",
    reasons,
    customSources: !demo,
    visitorKeys: !demo,
    headline: demo ? DEMO_HEADLINE : PRODUCT_HEADLINE,
  };
}

export class DemoModeRefusal extends Error {
  readonly code = "demo_mode";
  constructor(action: string) {
    super(
      `${action} is turned off on this public demo because its storage does not survive restarts. ` +
        "Ask the seeded sources instead, or run IntelliRAG with a database to keep your own.",
    );
    this.name = "DemoModeRefusal";
  }
}

/** Throw before doing any work a visitor would expect to persist. */
export function assertCustomSourcesAllowed(posture: DeploymentPosture, action: string) {
  if (!posture.customSources) throw new DemoModeRefusal(action);
}
