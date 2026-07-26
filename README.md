# Korve documentation

Mintlify source for `docs.korve.dev`. Hand-written task guides live beside generated API resource
pages in `api-reference/`.

```bash
bun install
bun run test
bun run typecheck
bun run validate
```

Regenerate the public API reference from the Korve monorepo root after changing the API spec:

```bash
bun run --cwd packages/api-spec-gen generate:docs
```

The generator excludes internal and server-runtime operations. Do not hand-edit generated resource
pages. `api-reference/overview.mdx` is intentionally hand-authored and preserved by generation.
