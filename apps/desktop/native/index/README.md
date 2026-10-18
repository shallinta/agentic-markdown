# Internal index / limited-v1

This module is not connected to windows, document grants, dirty buffers or search UI.
`16 documents / 64 KiB` is an internal limited profile, not the product capacity.

Supply an absolute Rust 1.90.0 `bin` directory in `AGENTIC_MARKDOWN_INDEX_RUST_BIN` and
the matching native `AGENTIC_MARKDOWN_INDEX_TARGET` (`aarch64-apple-darwin` or
`x86_64-apple-darwin`). The build validates versions/host/target; it never
downloads a toolchain or searches historical temporary paths. CI provisioning
is a separate explicit step. Cargo's ordinary dependency cache may be supplied
through `CARGO_HOME`; the committed lock is mandatory.

From the repository root, prepare **both** native variants before tests:

```sh
bun apps/desktop/scripts/build-index-native.ts
bun apps/desktop/scripts/build-index-native.ts --test-addon
bun test apps/desktop/src/bun/index
```

The first command writes `dist-native`; preBuild uses only this production
variant. The second writes ignored `.index-test` and enables both the Rust
`bridge-test` feature and C `INDEX_BRIDGE_TEST` macro. Tests intentionally fail
if their required addon was not prepared; they do not silently skip native
coverage. Prepare both variants before a repository-wide `bun test` as well.
Test injections, audit, cleanup and raw/live enumeration are absent from the
production exports and Rust dispatch. A test build never replaces production
resources. Index fixtures are fresh temporary directories, not user documents.

The once-installed anonymous panic hook affects the shared Rust runtime.
Unwind is caught and sessions are poisoned, but abort/OOM is not isolated by a
Worker. Close drains the writer explicitly, then removes the message listener;
it does not use global `close()`, `unref` or `terminate` to claim success.

Package-resource testing is a separate, explicitly approved step:

```sh
"/path/to/App.app/Contents/MacOS/bun" apps/desktop/scripts/verify-index-resources.ts "/path/to/App.app/Contents/Resources/app/bun"
```

The harness checks resource hashes and loads the built host, which uses the
same resolver and protocol. This command is not part of normal App startup;
passing it is not GUI or user-document authorization acceptance.
