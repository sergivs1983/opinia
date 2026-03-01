/**
 * sentry.edge.config.ts
 *
 * Production hotfix:
 * keep Edge Sentry disabled to avoid runtime crashes in Edge bundles
 * ("ReferenceError: __dirname is not defined") caused by Node-oriented
 * dependency paths.
 *
 * Node/server Sentry stays enabled via sentry.server.config.ts.
 */

export {};
