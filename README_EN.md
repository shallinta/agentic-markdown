# Agentic Markdown

[中文](./README.md)

A high-performance, local-first desktop app for viewing and editing multiple Markdown documents, currently in development.

## Current Status

The MVP product specification is confirmed. F-001, the runnable macOS shell, passed manual acceptance on 2026-09-19, including offline restart and basic window interaction. Features inherited from the starter are drafts, not implemented Markdown product capabilities.

F-003a, the read-only document service, passed manual acceptance on 2026-09-20; the full F-003 feature remains partially complete. The content area provides a raw-text verification panel, not a finished reader or editor.

## Product Direction

- Provide an elegant way to view and edit multiple Markdown documents;
- Treat performance as a core product metric, not a post-release optimization;
- Keep local `.md` and `.markdown` files as the sole source of truth for document content, with core features fully available offline;
- Target macOS first and build on [`electrobun-app-starter`](https://github.com/shallinta/electrobun-app-starter);
- Treat Agentic as a long-term direction; Agent capabilities are outside the MVP.

## MVP Shape

- One window can contain multiple arbitrary folders and standalone Markdown files as peer top-level items;
- Reading, editing, and source modes are document-level states; full WYSIWYG is not provided;
- A tabbed primary area sits on the left, while a secondary area on the right vertically tiles multiple documents;
- Local quick open, full-text search, in-document find, and Markdown navigation are included;
- Atomic saves, external-change detection, conflict handling, and crash recovery protect local content;
- `.md` and `.markdown` are first-class document formats; `.mdx` is outside the supported scope.

## Current Technical Direction

The desktop framework is based on Electrobun and `electrobun-app-starter`. CodeMirror 6, Lezer, and an independent Canonical Markdown reading pipeline are the current technical direction. Implementations will be reevaluated in their feature iterations, with proofs of concept when needed; there is no separate M0 phase.

## Project Documents

- [Product capability register](./docs/product-capability-register.md): complete capability list, stages, boundaries, and decision history;
- [Domain language](./CONTEXT.md): shared terminology for document identity, paths, save states, and parsing semantics.
- [MVP product specification](./docs/mvp-product-spec.md): dependency layers, dynamic ordering, and implementation status;
- [Product feature manual](./docs/product-feature-manual.md): current feature usage, limitations, and changes maintained with each iteration (in Chinese);
- [F-001 iteration record](./docs/iterations/F-001-app-shell.md): scope, approach, and validation results for this iteration.

## Next Step

The user chooses the next feature. L1 retains 8 entries: 1 of 7 independent features has passed full acceptance, and F-003's first slice, F-003a, has passed acceptance. F-002 is an ongoing constraint implemented alongside related features, not a completion prerequisite.

## Local Development

Use the locked Bun version `1.3.14`. Run development, build, and application commands outside the tool sandbox.

```sh
bun install --frozen-lockfile
bun run dev
AGENTIC_MARKDOWN_SKIP_SIGNING=1 bun run build:canary
```

The unsigned build is in `apps/desktop/build/canary-macos-arm64/` (Apple Silicon is the currently verified platform). Application data defaults to `~/.agentic-markdown`, overridable with `AGENTIC_MARKDOWN_HOME`. Installation normally configures Git hooks; this iteration used `HUSKY=0` to skip that step.

Inherited release, update, and other starter features have not passed product acceptance. See the [starter provenance record](./docs/starter/SOURCE.md).
