# Rolling Skill Desktop

Rolling Skill is a local-first macOS client for running and evaluating Skill tasks through agent
runtimes already installed on the machine. It opens directly into a task interface, discovers
compatible runtimes, and connects through a provider adapter. The application does not package
Codex and does not require Docker, Compose, Postgres, Redis, Traefik, an Agenta service, or a browser
session.

## Open the app

Double-click `Rolling Skill.app` at the repository root. On the first launch, macOS may require a
Control-click followed by **Open** because the local build uses an ad-hoc signature.

There is no application login screen. Runtime discovery, workspace selection, and local dataset
access work independently of provider authentication. If the selected runtime cannot make a model
request, only that turn reports the runtime error.

## Runtime discovery

The first provider supports Codex app-server. It probes candidates in this order:

1. A runtime explicitly selected by the operator.
2. `ROLLING_SKILL_CODEX_BIN`.
3. Executables named `codex` in the process `PATH`.
4. Codex resources inside known local applications such as ChatGPT.app.
5. Homebrew, system, and common user-local installation paths.

Every candidate must identify itself as Codex and expose `app-server` before it can be selected.
Rolling Skill records its provider, version, source, path, capabilities, and stable `runtimeId`.

Use the sidebar **Runtime…** control or the native **Runtime** menu to:

- rescan installed runtimes;
- choose an executable explicitly;
- return to automatic selection; or
- restart the active runtime.

If no compatible runtime is found, the desktop shell and local datasets still open. Rolling Skill
does not download, install, upgrade, or authenticate a runtime.

## Provider architecture

`src/runtime-registry.cjs` contains the provider-neutral registry. Providers implement two
operations:

- `discover(options)` returns compatible runtime descriptors;
- `createClient(descriptor, options)` creates the runtime-specific client.

`src/codex-runtime-provider.cjs` is the first adapter. The registry retains every compatible
descriptor even though this version selects one active runtime. A future evaluation orchestrator
can create clients for multiple selected descriptors and run the same Skill case in parallel while
attributing traces and case results by `runtimeId`.

## Build the double-clickable app

From the repository root:

```bash
bash desktop/rolling-skill/scripts/build-macos-app.sh
```

The script installs desktop dependencies, runs unit and discovered-runtime integration tests,
packages the Apple Silicon Electron client, refuses any bundle containing an embedded Codex
runtime, applies an ad-hoc signature, and writes `Rolling Skill.app` at the repository root. It
targets macOS 13 or newer.

## Develop

```bash
cd desktop/rolling-skill
npm ci
npm test
npm start
```

Development and packaged builds use the same discovery path. Set `ROLLING_SKILL_CODEX_BIN` when a
specific local Codex should be used without saving it through the UI.

## Local evaluation workflow

1. Select a workspace and active runtime.
2. Start a new task or open an existing workspace-scoped task.
3. Inspect the streamed conversation and raw local trace.
4. Select **Curate case** beside the assistant message that ends the useful problem-solving episode.
5. Choose the source user message where the episode begins, a dataset, and `goodcase` or `badcase`.
   The displayed dataset question is read-only and is preserved verbatim.
6. Select **Start curation**. Rolling Skill freezes the selected conversation/trace range while the
   original task remains live, then starts an independent read-only Curator task.
7. Review the Curator conversation and structured reference answer in **Case drafts**. Ask follow-up
   questions or request revisions, use **Retry** after a failed draft, and select **Done** only when
   the hard requirements and reference result are ready.

The Curator output has a fixed agent-grading contract: reference summary, required facts, required
steps, required output format, evidence links, hard pass/fail requirements, soft criteria, and
automatic failures. Badcases also record the first divergence, root causes, compact loop summary,
and expected recovery. Shell activity is grouped by CLI/subcommand (for example `git status` and
`billing-cli cost query`) while repeated CLI and MCP calls are compacted with counts and status
distributions.

Automatic capture is disabled by default. No case is written until **Done**. Approved cases retain
the exact user question, structured grading data, source and Curator runtime provenance, immutable
Episode evidence, and the append-only trace range. The optional Curator model override lives in the
**Case drafts → Curator model** setting; otherwise the source model is reused when the runtime
exposes it, with the active runtime default as fallback.

Local state is stored under `~/Library/Application Support/Rolling Skill/`:

| Path | Contents |
| --- | --- |
| `evaluation-store.json` | Datasets, cases, Curator sessions/revisions, and capture settings |
| `preferences.json` | Selected workspace and optional runtime selection |
| `traces/*.jsonl` | Append-only runtime events with runtime identity metadata |

## Security model

- Runtime probes and launches use fixed executable/argument arrays with `shell: false`.
- Source Codex threads default to `workspace-write`; Curator threads are forced to `read-only`.
  Both use `approvalPolicy: never`.
- The renderer has Node integration disabled, context isolation enabled, and Chromium sandboxing
  enabled.
- The preload bridge exposes only runtime, workspace, thread, turn, dataset, and trace operations;
  it does not expose shell or filesystem primitives.
- Packaged renderer files are the only internal navigation target. External HTTPS links are handed
  to macOS and all other navigation is blocked.
- Dataset writes are atomic and trace files are append-only with owner-only permissions.

The wider Agenta repository still contains server deployment options. Those are independent
capabilities and are not inspected, started, or required by `Rolling Skill.app`.

## Tests

`npm test` covers provider discovery priority and de-duplication, compatibility probing, registry
selection/client delegation, a real locally discovered app-server smoke, protocol framing, Git
workspace discovery, local-first surface invariants, episode boundaries, verbatim questions,
CLI/MCP compaction, Curator lifecycle/retries/revisions, atomic dataset persistence, fixed grading
contracts, runtime attribution, and trace provenance.
