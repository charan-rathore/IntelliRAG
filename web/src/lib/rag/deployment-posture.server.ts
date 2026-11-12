import { classifyDeployment, type DeploymentPosture } from "./deployment-mode";
import { getStorageStatus } from "./storage";

function operatorForcedDemo(): boolean {
  if (typeof process === "undefined") return false;
  // Dynamic key so the bundler cannot inline a build-time value.
  const name = ["INTELLIRAG", "PUBLIC", "DEMO"].join("_");
  const raw = process.env?.[name]?.trim().toLowerCase();
  return raw === "1" || raw === "true";
}

/** Posture for the running process. Database reachability is checked by /api/health only. */
export function currentPosture(databaseReachable?: boolean): DeploymentPosture {
  return classifyDeployment({
    storage: getStorageStatus(),
    databaseReachable,
    forceDemo: operatorForcedDemo(),
  });
}
