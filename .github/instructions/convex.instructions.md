---
applyTo: "convex/**/*.ts"
---

# Convex development

Consult the current [official Convex AI guidance](https://docs.convex.dev/ai) and
[function documentation](https://docs.convex.dev/functions/overview) before
changing backend integration patterns.

- Validate public arguments and derive the caller from `ctx.auth`.
- Keep database reads in queries and atomic writes in mutations.
- Perform external network requests in actions, using internal queries/mutations
  for database access; do not expose internal provider callbacks to clients.
- Use indexes for ownership and identity lookups.
- Persist asynchronous job state and reject stale results before writing.
- Keep provider keys in Convex environment variables and avoid logging user media.
- Never publish starter guides or generated assemblies without explicit review.
- Preserve owner-only access to problem data, transcripts, files, and comments.
- Cover access boundaries and job state transitions with `convex-test`.
