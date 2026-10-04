import "server-only";

/**
 * The interactive integration console and its OpenAPI document describe the
 * complete external data surface. Keep them disabled in production unless an
 * operator explicitly enables them for a controlled maintenance window.
 */
export function isDockflowDocsEnabled(): boolean {
  return process.env.NODE_ENV !== "production" || process.env.ENABLE_DOCKFLOW_DOCS === "true";
}
