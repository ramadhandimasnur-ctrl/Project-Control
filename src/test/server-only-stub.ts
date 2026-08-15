/**
 * Stand-in for the `server-only` package under Vitest.
 *
 * That package throws on import outside a React Server Component graph, which
 * is exactly the protection we want in application code — and exactly what
 * stops a test from importing a service. Vitest aliases the package to this
 * empty module so services remain testable without weakening the guard for
 * the real build.
 */
export {};
