const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

export function assertDisposableDatabasePair(runtimeConnectionString, migratorConnectionString, confirmation) {
  const runtime = parseLocalTestDatabase(runtimeConnectionString);
  const migrator = parseLocalTestDatabase(migratorConnectionString);
  if (runtime.identity !== migrator.identity) {
    throw new Error("Browser-smoke runtime and migrator URLs must identify the same loopback database.");
  }
  if (runtime.username === migrator.username) {
    throw new Error("Browser-smoke runtime and migrator URLs must use different roles.");
  }
  const expected = `reset:${migrator.identity}`;
  if (confirmation !== expected) {
    throw new Error(`Refusing to reset supplied schemas without BROWSER_SMOKE_DATABASE_RESET_CONFIRMATION=${expected}`);
  }
}

function parseLocalTestDatabase(connectionString) {
  const url = new URL(connectionString);
  if (
    !["postgres:", "postgresql:"].includes(url.protocol) ||
    !LOOPBACK_HOSTS.has(url.hostname.toLowerCase()) ||
    !url.username ||
    url.search ||
    url.hash
  ) {
    throw new Error("Browser smoke only accepts loopback PostgreSQL URLs without query parameters or fragments.");
  }
  const encodedDatabaseName = url.pathname.slice(1);
  if (!encodedDatabaseName || encodedDatabaseName.includes("/")) {
    throw new Error("Browser-smoke PostgreSQL URLs must contain exactly one database name.");
  }
  const databaseName = decodeURIComponent(encodedDatabaseName);
  if (!databaseName.toLowerCase().endsWith("_test")) {
    throw new Error("Refusing browser smoke against a database without the _test suffix.");
  }
  return {
    identity: `${url.hostname.toLowerCase()}:${url.port || "5432"}/${databaseName}`,
    username: decodeURIComponent(url.username),
  };
}
