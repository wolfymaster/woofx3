// Security headers built from parts, so a policy is never assembled by
// joining strings that might each name the same directive (the browser
// applies the first and ignores the rest without a word).

/** A Content-Security-Policy as directive name to sources; `[]` for a directive that takes none (`sandbox`). */
export type CspDirectives = Readonly<Record<string, readonly string[]>>;

/**
 * `base` with `overrides` laid over it, directive by directive: a directive
 * in `overrides` replaces the same directive in `base` whole.
 */
export function withDirectives(base: CspDirectives, overrides: CspDirectives): CspDirectives {
  return { ...base, ...overrides };
}

/** `directives` as a Content-Security-Policy header value. */
export function contentSecurityPolicy(directives: CspDirectives): string {
  return Object.entries(directives)
    .map(([name, sources]) => (sources.length === 0 ? name : `${name} ${sources.join(" ")}`))
    .join("; ");
}
