# Agentic Markdown

[中文](./README.md)

A high-performance, local-first desktop app for viewing and editing multiple Markdown documents, currently in design.

## Current Status

The project is currently consolidating its product specification and preparing for M0 technical validation. Product research, capability-by-capability decisions, and the first consistency audit are complete, but the repository does not yet contain a runnable app or usable installation, build, or test commands.

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

The desktop framework is fixed on Electrobun and `electrobun-app-starter`. CodeMirror 6, Lezer, and an independent Canonical Markdown reading pipeline are the current technical direction; the concrete implementations of the editing hot path, reading renderer, document service, indexing, and file watching must be reevaluated through M0 performance and feasibility proofs of concept. They must not be described as implemented or permanently locked in.

## Project Documents

- [Product capability register](./docs/product-capability-register.md): complete capability list, stages, boundaries, and decision history;
- [Domain language](./CONTEXT.md): shared terminology for document identity, paths, save states, and parsing semantics.

## Next Step

Extract a standalone MVP product specification from the capability register, then begin M0 technical proofs of concept focused on editing performance, the Canonical reading pipeline, atomic save and recovery, multi-root scanning, and large-document behavior.
