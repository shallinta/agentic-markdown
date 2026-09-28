# Agentic Markdown

## Current F-018j: alpha.47 slice accepted (2026-09-28)

The user accepted the F-018j alpha.47 slice overall on 2026-09-28; evidence from 24 correct real-disk groups is retained. Internal Text.length routing enters at 512000 and exits below 256000 UTF-16 units, not disk bytes. A freshly opened 440k document remains synchronous, while one shrunk from a larger size may remain in the background until the exit boundary. Synchronous blocking decreased for the ordinary 800k paragraph; mixed documents still vary, so no universal improvement is claimed. The 1 MiB limit, long-line presentation rules, wait scheduling, and semantics remain unchanged. Full parent F-018 and OBL-003 work remains open. Overall acceptance does not invent individual user test actions. The user has authorized a commit and push; authorization alone does not establish that either has completed.

## F-018i: alpha.43 accepted within this slice (2026-09-28)

On 2026-09-28, the user accepted F-018i alpha.43 within its scope of real-disk opening observations and a BOM incremental-syntax correctness fix. This overall acceptance does not invent individual hands-on actions or remove historical evidence limits. No speedup is claimed: initial interaction with large multiline paragraphs remains outstanding performance work. Production wait, the 1 MiB limit, semantics, and soft wrapping are unchanged. Full parent F-018 and OBL-003 work remains open. This iteration's authorization has ended; the next feature has not been selected or started, and no Git operation is authorized.

## Current parser-work/cache batch (2026-09-28)

On 2026-09-28, the user explicitly accepted A / F-012j and B / F-012k alpha.40 within their slice scope. This overall acceptance does not invent individual hands-on actions; all historical verification limits remain. A showed no stable scheduling advantage, so production keeps `wait`; `quiet-restart` stays experimental. B provides owned derived-cost accounting and a soft budget, not RSS reduction, memory savings, or a hard cap. Parent F-012 and full OBL-012 / OBL-020 / OBL-041 / OBL-068 remain open. Batch authorization is closed; subsequent iterations require selection. The separate question about opening a file and clicking Open again becoming unresponsive is under investigation, not a failed batch acceptance or a fixed defect. No Git operations.

## Historical: F-018h accepted within this slice (2026-09-28)

On 2026-09-28, the user explicitly accepted F-018h alpha.38 within this slice and requested the next step. This overall acceptance does not invent individual hands-on actions; existing tests, measurements, and untested limits remain recorded. Only long-line documents use the bundled background Worker; ordinary documents remain synchronous. Raw text, saving, soft wrapping, and the 1 MiB limit are unchanged. Bounded synthetic-input improvements do not resolve all performance work; parent F-018 and OBL-003 remain open. This iteration is closed and the user selects the next one; no new iteration, commit, or push has started. See [F-018h](docs/iterations/F-018h-responsive-dense-line-editing.md).

## Historical: F-018g diagnostics passed delegated acceptance (2026-09-28)

On 2026-09-28, F-018g alpha.34 diagnostics and bounded attribution evidence passed user-authorized agent acceptance and independent review, not hands-on user acceptance. No production optimization was delivered, and the full performance issue remains unresolved. All 96 diagnostic rows passed correctness checks; dense 200k-line updates after parser readiness still took about 129ms, with instrumentation locating most synchronous cost within parsing. This applies only to this insert/undo repetition, not natural input, IME, or paint latency. Normal production behavior, soft wrapping, the 1 MiB limit, semantics, and saving are unchanged. Full OBL-003 and parent F-018 work remain open; a key technical-route change requires renewed confirmation. No Git operation or automatic next iteration is authorized.

## L2 long-line and cross-mode protection batch accepted (2026-09-28)

On 2026-09-28 the user explicitly accepted the alpha.33 batch: A / F-018f source-mode long-line token protection, B / F-015b cross-mode save replies, C / F-016b runtime permissions, and D / F-017b cross-mode close/quit protection, within each slice's scope. Batch authorization is closed; the user selects each subsequent iteration. This overall confirmation does not invent individual hands-on actions. Prior evidence remains: 529 tests / 4630 assertions, B/C/D focused tests 37 / 749, the 13/13 WKWebView correctness report, and actual-window observations with their untested limits. Dense 200k-line synthetic dispatch of 128ms in editing and 125ms in source mode remains outstanding performance work. Existing soft wrapping and the normal 1 MiB limit are unchanged; parent features, full OBL-003 / OBL-065 / OBL-066 / OBL-067 obligations, and future consumers remain open. This is documentation-only closure, with no code, version, build, commit, push, or automatic next iteration.

## Closed L2 follow-up batch (2026-09-27, historical records below)

The user authorized A → B → C → D through joint manual acceptance: F-013c CommonMark source colors, F-018d long-line interaction measurements in a real EditorView, F-012i current parser scheduling and destruction/cancellation measurements, and F-018e additional transfer observations. All four slices are implemented and automatically verified in alpha.32. On 2026-09-27 the user accepted A / F-013c and delegated B/C/D acceptance to the agent; B/C/D have now passed delegated acceptance, including actual live cancellation and rerun for B/C and bounded research evidence for D. This batch is accepted within its slice scope. The real WebView report passed 7/7 rows; local and packaged Bun each passed 487 tests / 3831 assertions, and independent spec/standards reviews have no remaining findings. The user's overall A acceptance does not invent individual actions; delegated checks are not described as hands-on user tests; see `docs/iterations/2026-09-27-l2-followup-acceptance.md`. Unmeasurable metrics stay explicitly unknown; the normal 1 MiB production limit and all remaining obligations stay open. Parent F-012 / F-013 / F-018 remain incomplete. OBL-003 / OBL-012 / OBL-069 are only partially covered by this batch; deferred OBL-020 / OBL-041 / OBL-068 / OBL-070 remain open. Earlier accepted slices and evidence are preserved. The batch is closed; the user selects the next iteration, with no automatic Git operations or further features.

## Previously accepted batch (historical conclusion)

On 2026-09-27 the user gave overall acceptance to A / F-012f, B / F-018c, C / F-012g, and D / F-012h. The user accepted CommonMark quote syntax without a required space and withdrew that concern; the previously proposed A/B changes for this concern are not adopted, and parsing behavior is unchanged. See the [joint acceptance conclusion](docs/iterations/2026-09-27-l2-batch-acceptance.md). This overall confirmation does not imply individual dark-theme, IME, launch, or other actions, nor that the agent launched alpha.29; earlier build/test/not-launched records remain historical evidence. Parent F-012 / F-018 remain partly complete. Only these slices are accepted under OBL-003 / OBL-012 / OBL-020 / OBL-041 / OBL-068; all remaining responsibilities stay open. Batch authorization has ended and the user selects the next iteration. This is documentation-only closure, with no code, version, build, or Git changes.

## Previous batch records (historical conclusions below)

Batch accepted and closed, 2026-09-27: the user confirmed acceptance and requested the next iteration. A / F-012e alpha.26 language presentation is accepted; B / F-013b is accepted by the user based on delegated agent verification, not rewritten as individual hands-on user tests. Prior acceptance of C / F-014b and D / F-018b remains unchanged. No new real-IME natural-fault, dark-theme, or keyboard-button retesting is inferred. Future consumers and remaining work under OBL-068 / OBL-069 / OBL-070 / OBL-064 / OBL-003 remain open, and parent features remain incomplete. Batch authorization has ended; selection returns to the user each iteration. No next feature has been selected or started; no commit or push was made. Build, window-check evidence, and limits remain in the individual iteration records and joint checklist.

Historical revision, 2026-09-26 (evidence at that time): A's fence-visibility update is built in `0.1.0-alpha.25` (hash `1i19cut7t322i`, canary), verified against the archive; intermediate alpha.24 is not delivered. Local tests passed 451 tests / 3305 assertions / 68 files, alongside lint, type checks, and independent spec/standards reviews. Only the first/last fence markers are inspected, avoiding traversal proportional to code-block length. The new app at `/private/tmp/agentic-markdown-batch25.6spzk9/Agentic Markdown-canary.app` has not been launched or visually retested. A awaits retesting; C is accepted; D has overall user acceptance and B awaits authorized agent verification. Alpha.23's 448 tests, 46-row report, and window observations remain historical, not alpha.25 runtime evidence. Parent features and outstanding obligations stay open.

[中文](./README.md)

A high-performance, local-first desktop app for viewing and editing multiple Markdown documents, currently in development.

## Current Status

2026-09-26 batch: A basic code-block presentation, B safe source fallback, C CJK/mode regression, and D full-text downlink/transfer measurements have been built and delivered together in `0.1.0-alpha.23` (hash `3ukcs6yqf2ef9`), C now has overall user acceptance; A's other items passed, but unfocused fence markers did not meet expectations, so the visibility adjustment has been built and delivered in alpha.25 and awaits retesting; B/D have not been manually tested. Historical alpha.23 evidence: final full-suite runs on local and packaged Bun each passed 448 tests / 3195 assertions / 68 files. The real experiment report has 46 rows (45 successful, 1 unsupported), with all six full-text downlinks successful. Actual-window checks covered A's light appearance and B's two fault paths, continued editing, and saving; these remain the boundaries of agent-observed evidence. C's overall user acceptance does not invent individual IME or test actions. Use the [joint acceptance checklist](docs/iterations/2026-09-26-batch-acceptance.md). Parent features and outstanding obligations remain open; production stays limited to 1 MiB. No commit or push was made.

2026-09-26: [F-012d: basic list presentation](./docs/iterations/F-012d-basic-list-presentation.md) in `0.1.0-alpha.22` (hash `hq9fjhk765f2`) has passed user acceptance. All 420 tests passed. Actual-window checks confirmed three bullet levels, original ordered numbers, source-marker restoration on activation, and editing/source round trips. The user's overall acceptance does not invent individual actions for Chinese IME, dark appearance, complete copy/save regression, or dedicated soft-wrap checks, nor expand the agent's verified scope. In editing mode, inactive unordered markers become bullets and active markers retain their source spelling; ordered numbers and delimiters are preserved without renumbering. Nesting retains source indentation, soft wraps use hanging alignment within the same physical line, physical continuation lines retain their indentation, and lazy continuation receives no automatic indentation. Source mode remains plain code. List continuation, structural indentation, checkboxes, and fenced-code styling are outside this slice. OBL-068 covers only list appearance here and remains open; parent F-012 / F-042 remain incomplete.

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

[F-013a: source-mode foundation](./docs/iterations/F-013a-source-mode-foundation.md) in `0.1.0-alpha.21` (hash `2g8sxm1ncmwm0`) passed user acceptance on 2026-09-26. Source mode uses a uniform monospace font, size, and regular weight with color-only highlighting, without bold, italics, link underlining, or inline-code backgrounds. Per-document editing/source switching is available only through `⌘⇧M`, sharing text, selections, and undo history. Alpha.21 passed 413 local tests; alpha.20's 412 tests per Bun runtime and window checks remain historical evidence, not new-package measurements. OBL-028 / OBL-042 are closed for this slice's basic highlighting and current switching command; OBL-069 / OBL-070 track future appearance and command integration. Automatic failure fallback, complete highlighting, reading mode, and restart restoration remain unimplemented; parent F-013 remains incomplete.

[F-012c: basic live formatting and syntax-marker visibility](./docs/iterations/F-012c-basic-live-formatting.md) in `0.1.0-alpha.18` has passed user acceptance. It covers headings, bold, emphasis, and inline code while editing source text directly, revealing markers according to the cursor and selection; complete editing/reading modes, formatting commands, and rich content remain outside this slice. Each Bun runtime passed 401 tests; actual-window checks covered light/dark appearance, select-all marker visibility, byte-preserving copy/save, and undo. The user accepted the heading-indentation fix in `0.1.0-alpha.19` on 2026-09-26. All 404 tests passed. OBL-027 is closed for this slice's basic decorations and heading fix; appearance checks for future extensions remain with their respective slices. Fenced-code and list styling are outside this slice; parent features F-012 / F-042 remain incomplete and their remaining scope is retained.

[F-012b: incremental save transport and mismatch resynchronization](./docs/iterations/F-012b-incremental-save-channel.md), version `0.1.0-alpha.17`, passed user acceptance on 2026-09-25. Each Bun runtime's 390 passing tests and existing window evidence are retained without inventing individual user actions. OBL-001 is closed for the save consumer; future parsing consumers' version lifecycles remain assigned to later F-012 slices. Patches serve explicit saving, not per-keystroke synchronization or automatic saving. The normal 1 MiB limit, remaining F-018 work, and four deferred obligations remain unchanged, and parent F-012 is incomplete.

[F-018a: early large-document and long-line validation](./docs/iterations/F-018a-large-document-probe.md), version `0.1.0-alpha.16`, passed user acceptance on 2026-09-25, without inventing individual user actions. `AGENTIC_MARKDOWN_PERF_LAB=1` explicitly enables synthetic 1/10/50 MB experiments; normal startup does not run them. Each Bun runtime passed all 382 tests; see the iteration for real upload/small-acknowledgement measurements and cancellation/rerun evidence. Results do not measure bidirectional full-text transport, actual paint latency, or complete large-document support. Full-text downloads, encoded sizes, actual copying, and other remaining measurements keep OBL-003 in progress. Normal reads and writes remain limited to 1 MiB, and parent F-018 is partially complete.

[F-017a: close and quit confirmation for the current workspace](./docs/iterations/F-017a-close-unsaved-confirmation.md), version `0.1.0-alpha.15`, passed user acceptance on 2026-09-25: single-document confirmation names its target, quitting retains the all-unsaved-changes confirmation, and uncertain save settlement reports a Chinese failure message while keeping the window open. Each Bun runtime's 368 passing tests and existing window evidence are retained without inventing individual user actions. OBL-046 is closed for the current workspace; formal modes, the secondary region, and recovery-record consumers still require later integration and revalidation. Parent F-017 is partially complete. The user chooses the next iteration, with no automatic commit or push.

[F-016a: read-only protection for individual files](./docs/iterations/F-016a-single-file-readonly.md), version `0.1.0-alpha.14`, passed user acceptance on 2026-09-25, including revalidation of the dark-selection fix. The 362 automated tests and historical window evidence are retained. OBL-045 is closed for the current single-file raw-text foundation; capability integration and context revalidation for full directory workspaces, formal modes, and future write interactions remain deferred. Parent F-016 is partially complete. The user chooses the next iteration, with no automatic commit or push.

[F-014a: document-level undo and Chinese input foundations](./docs/iterations/F-014a-undo-ime-foundation.md), version `0.1.0-alpha.12`, passed manual acceptance on 2026-09-22: unified undo/redo, history across saving, and input protection. The user specifically confirmed that saving and tab switching are unavailable during Chinese candidate composition, as expected. Each Bun runtime passed 352 tests, and two-document UI regression checks passed. OBL-043 is closed for the current foundation; parent F-014 remains partially complete, with Japanese, Korean, and command integration and context revalidation in formal modes deferred. Earlier stage outcomes remain below; the user chooses subsequent iterations, with no automatic commit or push.

[F-015a: safe manual saving of the current document](./docs/iterations/F-015a-manual-save.md), version `0.1.0-alpha.10`, passed user acceptance on 2026-09-22. Save through `⌘S`, the button, menu, or command palette, using a precompiled Node-API native module in a background worker. This slice supports regular, single-hard-link local files on macOS, limited to 1 MiB each; automatic saving, formal modes, full conflict resolution, and content recovery are not included. Disposable samples are recommended: saving really changes files on disk.

[F-012a: in-memory editing foundation](./docs/iterations/F-012a-memory-editing-foundation.md) passed user acceptance on 2026-09-22, including revalidation of the `0.1.0-alpha.8` selection-visibility fix after tab switching. OBL-062 and the four obligations assigned to F-015a are closed. Parent F-012 and F-015 remain partially complete; formal modes and other remaining scope are not completed by accepting these slices.

[F-010: encoding and line-ending read fidelity](./docs/iterations/F-010-text-fidelity.md) and [F-011: single document instances and persistent tabs](./docs/iterations/F-011-persistent-document-tabs.md) passed manual acceptance on 2026-09-22. The F-011 acceptance build is `0.1.0-alpha.3`. That accepted scope covered read-only raw text, without editing, saving, or restart recovery. The next iteration awaits the user's choice; no automatic implementation, commit, or push.

[F-005a: read cancellation and bounded scheduling](./docs/iterations/F-005a-document-task-cancellation.md) passed manual acceptance on 2026-09-21. On the same date, the user selected option A: scope L1 to independent foundations for the current shell and read-only workflow. The parent features described above as partially complete refer to their previous full scope; downstream consumers remain required under [specification section 6.1](./docs/mvp-product-spec.md), with no requirements removed.

The new [F-008a security, anonymous logging, and versioned settings baseline](./docs/iterations/F-008a-shell-security-baseline.md) and [all six L1 modules](./docs/iterations/L1-module-acceptance.md) passed manual acceptance on 2026-09-21, completing the option A L1 foundation scope. F-002 remains an ongoing constraint. The user will choose the next iteration; no automatic L2 work, commit, or push.

[F-009a, the welcome page and standalone files](./docs/iterations/F-009a-welcome-standalone-files.md), passed user manual acceptance on 2026-09-22. Earlier automated checks and the unsigned build passed; the historical record that the agent could not verify the new window while the Mac was locked remains, without adding details of the user's actions. The user chooses the next iteration; no further feature starts automatically. Parent F-009 remains partially complete, with folder and recent-item entrypoints still tracked by OBL-039 / OBL-040. The app is still not a finished reader or editor.

## Local Development

Use the locked Bun version `1.3.14`. Compiling the native save module also requires `xcrun clang` from Xcode Command Line Tools and the pinned `node-api-headers@1.9.0`. The app loads the precompiled module without runtime compilation. Run development, build, and application commands outside the tool sandbox.

```sh
bun install --frozen-lockfile
bun run sdk:sync
bun run dev
AGENTIC_MARKDOWN_SKIP_SIGNING=1 bun run build:canary
```

The unsigned build is in `apps/desktop/build/canary-macos-arm64/` (Apple Silicon is the currently verified platform). Electrobun 2.0.1 downloads its paired toolchain on initial SDK preparation; generated `.hutch/devkit` files are not committed. The app bundles Bun 1.4.0 without changing the local development Bun. Application data defaults to `~/.agentic-markdown`, overridable with `AGENTIC_MARKDOWN_HOME`. Installation normally configures Git hooks; this iteration used `HUSKY=0` to skip that step.

Inherited release, update, and other starter features have not passed product acceptance. See the [starter provenance record](./docs/starter/SOURCE.md).
