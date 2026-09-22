# Agentic Markdown

[中文](./README.md)

A high-performance, local-first desktop app for viewing and editing multiple Markdown documents, currently in development.

## Current Status

The MVP product specification is confirmed. F-001, the runnable macOS shell, passed manual acceptance on 2026-09-19, including offline restart and basic window interaction. Features inherited from the starter are drafts, not implemented Markdown product capabilities.

F-003a, the read-only document service, passed manual acceptance on 2026-09-20; the full F-003 feature remains partially complete. The content area provides a raw-text verification panel, not a finished reader or editor.

F-004a, single-file path identification and read-only authorization, passed manual acceptance on 2026-09-20. The full F-004 feature remains partially complete.

F-006a, unified command and keyboard entrypoints for existing operations, passed manual acceptance on 2026-09-20. It unifies five commands: open, reload, clear, toggle sidebar, and open the command palette. This does not complete the full F-006 feature or app-wide Chinese localization.

F-007a, Simplified Chinese and app appearance for the current interface, passed manual acceptance on 2026-09-21. The current app-owned interface is fixed to Chinese, with light, dark, and system appearance and saved preferences. The full F-007 feature remains partially complete.

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
- [Deferred obligation register](./docs/deferred-obligations.md): primary owners, status, and acceptance evidence for remaining capabilities;
- [Product feature manual](./docs/product-feature-manual.md): current feature usage, limitations, and changes maintained with each iteration (in Chinese);
- [F-001 iteration record](./docs/iterations/F-001-app-shell.md): scope, approach, and validation results for this iteration.

## Next Step

The user has accepted the other items in [F-012a: in-memory editing foundation](./docs/iterations/F-012a-memory-editing-foundation.md). Selection visibility after tab switching was fixed in `0.1.0-alpha.8` and passed automated and UI verification; only that item awaits user revalidation, so the overall slice and OBL-062 remain pending manual acceptance. Files remain limited to 1 MiB, without saving, formal document modes, or content recovery; do not use real work whose edits must be retained. Parent F-012 remains incomplete.

[F-010: encoding and line-ending read fidelity](./docs/iterations/F-010-text-fidelity.md) and [F-011: single document instances and persistent tabs](./docs/iterations/F-011-persistent-document-tabs.md) passed manual acceptance on 2026-09-22. The F-011 acceptance build is `0.1.0-alpha.3`. That accepted scope covered read-only raw text, without editing, saving, or restart recovery. The next iteration awaits the user's choice; no automatic implementation, commit, or push.

[F-005a: read cancellation and bounded scheduling](./docs/iterations/F-005a-document-task-cancellation.md) passed manual acceptance on 2026-09-21. On the same date, the user selected option A: scope L1 to independent foundations for the current shell and read-only workflow. The parent features described above as partially complete refer to their previous full scope; downstream consumers remain required under [specification section 6.1](./docs/mvp-product-spec.md), with no requirements removed.

The new [F-008a security, anonymous logging, and versioned settings baseline](./docs/iterations/F-008a-shell-security-baseline.md) and [all six L1 modules](./docs/iterations/L1-module-acceptance.md) passed manual acceptance on 2026-09-21, completing the option A L1 foundation scope. F-002 remains an ongoing constraint. The user will choose the next iteration; no automatic L2 work, commit, or push.

[F-009a, the welcome page and standalone files](./docs/iterations/F-009a-welcome-standalone-files.md), passed user manual acceptance on 2026-09-22. Earlier automated checks and the unsigned build passed; the historical record that the agent could not verify the new window while the Mac was locked remains, without adding details of the user's actions. The user chooses the next iteration; no further feature starts automatically. Parent F-009 remains partially complete, with folder and recent-item entrypoints still tracked by OBL-039 / OBL-040. The app is still not a finished reader or editor.

## Local Development

Use the locked Bun version `1.3.14`. Run development, build, and application commands outside the tool sandbox.

```sh
bun install --frozen-lockfile
bun run sdk:sync
bun run dev
AGENTIC_MARKDOWN_SKIP_SIGNING=1 bun run build:canary
```

The unsigned build is in `apps/desktop/build/canary-macos-arm64/` (Apple Silicon is the currently verified platform). Electrobun 2.0.1 downloads its paired toolchain on initial SDK preparation; generated `.hutch/devkit` files are not committed. The app bundles Bun 1.4.0 without changing the local development Bun. Application data defaults to `~/.agentic-markdown`, overridable with `AGENTIC_MARKDOWN_HOME`. Installation normally configures Git hooks; this iteration used `HUSKY=0` to skip that step.

Inherited release, update, and other starter features have not passed product acceptance. See the [starter provenance record](./docs/starter/SOURCE.md).
