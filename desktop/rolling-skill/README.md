# Rolling Skill Desktop

Rolling Skill is a local-first macOS client for running and evaluating Skill tasks through agent
runtimes already installed on the machine. It opens directly into a task interface, discovers
compatible runtimes, and connects through a provider adapter. The application does not package an
agent runtime and does not require Docker or a separate backend service.

## Open the app

Double-click `Rolling Skill.app` at the repository root. On the first launch, macOS may require a
Control-click followed by **Open** because the local build uses an ad-hoc signature.

There is no application login screen. Runtime discovery, workspace selection, and local dataset
access work independently of provider authentication. If the selected runtime cannot make a model
request, only that turn reports the runtime error.

## Runtime discovery

The built-in provider adapters support Codex app-server and CodeBuddy ACP. Codex candidates are
probed in this order:

1. A runtime explicitly selected by the operator.
2. `ROLLING_SKILL_CODEX_BIN`.
3. Executables named `codex` in the process `PATH`.
4. Codex resources inside known local applications such as ChatGPT.app.
5. Homebrew, system, and common user-local installation paths.

CodeBuddy checks an explicitly selected executable, `ROLLING_SKILL_CODEBUDDY_BIN`, `PATH`,
Homebrew/system paths, common user-local paths, and compatible `.sre-codex` installations. A
candidate must identify its provider and pass the provider's compatibility probe: Codex must expose
`app-server`; CodeBuddy must expose stdio ACP. Rolling Skill records the provider, version, source,
path, capabilities, and stable `runtimeId` of every compatible result.

Finder-launched apps receive a minimal macOS `PATH`. CodeBuddy installations whose executable uses
`#!/usr/bin/env node` are still supported: the compatibility probe prepends the executable's own
directory, matching the environment used for the real ACP process. CodeBuddy does not need to be
running before it can appear in the Runtime list.

Use **Settings → Runtime…** or the native **Runtime** menu to:

- rescan installed runtimes;
- choose an executable explicitly;
- return to automatic selection; or
- restart the active runtime.

If no compatible runtime is found, the desktop shell and local datasets still open. Rolling Skill
does not download, install, upgrade, or authenticate a runtime.

The active runtime's model catalog is loaded through its provider adapter. The task composer and
each editable Case Draft can select both a model and reasoning effort. Settings provides defaults
for new tasks, Curator tasks, and Automatic Capture. No model names are bundled into the desktop
application.

## Settings and appearance

Open **Settings** in the lower-left sidebar to configure:

- Simplified Chinese or English interface text;
- Codex Light (the default white-and-blue theme), Codex Dark, or the original Graphite theme;
- Full local access (default) or Workspace only for new runtime tasks;
- the default model and reasoning effort for new tasks and Curator tasks; and
- Automatic Capture, including its Curator model and effort, current runtime Skill, destination
  dataset, and default case type.

All settings are stored locally. Automatic Capture remains disabled until explicitly enabled.
Runtime selection, raw Trace access, and the local dataset file are also grouped in **Settings**.

For runtimes that expose a sandbox policy, Full local access maps Codex to
`danger-full-access` with `approvalPolicy: never`, allowing the selected local CLI to read
credentials and files already available to the signed-in macOS user. Workspace only maps to
`workspace-write`. Rolling Skill does not create a container or require Docker. CodeBuddy ACP does
not expose an equivalent workspace sandbox, so the control is disabled and the UI says
**Runtime-managed access** when CodeBuddy is active. The Electron renderer still uses Chromium's
separate renderer sandbox in every mode.

## Conversation history and workspace scope

Codex conversation history is runtime-native. Use **Current / Archived** above the task list,
archive a stopped conversation from its hover action, and restore it from the Archived view.
Archived conversations open read-only until restored. CodeBuddy ACP does not currently expose a
durable archive/list contract, so Rolling Skill reports archive history as unsupported instead of
maintaining a conflicting local copy.

Each runtime/workspace/conversation keeps its own unsent composer draft and reading position. A
new task has an independent draft as well. Switching tasks restores the previous draft and scroll
offset directly; it does not replay a smooth scroll from the top. Drafts are local UI state and do
not alter runtime-native conversation history.

Codex filters `thread/list` by an exact working-directory string. Rolling Skill shows that full
path beside the conversation list and in Settings. For example, a thread created with
`/Users/example/project` is persisted but will not appear in a Codex project view filtered to
`/Users/example/project/agenta`. Choose the exact intended workspace before creating the thread;
existing threads are not silently moved between workspaces.

Messages render common Markdown and GFM structures including headings, lists, quotes, code blocks,
and tables. HTTP(S) URLs, HTTP(S) Markdown links, and high-confidence absolute local file references
are clickable. Bare local paths must sit below the active workspace or a standard macOS filesystem
root, so slash commands, API routes, dates, ratios, and prose containing `/` remain plain text. Web
links are handed to the default browser. Local links are validated as absolute existing paths and
revealed in Finder through a narrow main-process bridge; they are not executed directly. Markdown
is lexed and rebuilt with safe DOM nodes: message HTML and images are displayed as inert text and
are never injected into the renderer.

Reasoning and compact activity cards are shown inline for commands, file changes, MCP/dynamic
tools, collaboration tools, subagents, plans, and context compaction. Codex may omit command items
from a later `thread/read` response even though they were available while the turn streamed.
Rolling Skill therefore keeps a bounded local index of activity it observes and merges that index
back into history by item ID. The index stores only compact labels/status metadata, not command
arguments or output, tool arguments/results, file paths, or file diffs. Persisted command cards keep
only the executable name. Activity that predates this index and is also absent
from the runtime's own history cannot be reconstructed; its raw trace remains available when the
conversation originally ran through Rolling Skill.

## Chat and Skill evaluation workbench

Use the switch below the Rolling Skill logo to move between the native **Chat** client and the
**Skill evaluation** workbench. The workbench can:

- create, browse, and delete local datasets;
- inspect current dataset questions, immutable source wording, and curated references;
- delete a Case without invalidating older evaluation snapshots;
- query a provider's path-precise Skill inventory when it exposes one;
- run one selected Case or an entire dataset;
- select multiple runtime/model/reasoning-effort configurations for one run; and
- inspect and delete durable Case × Runtime results under **Evaluation runs / 评测记录**.

Automatic activation sends only the current dataset question, byte-for-byte as saved. That input
may be an operator edit made before curation; the frozen source wording remains separate
provenance. This is the path to use when measuring whether the runtime can discover and activate a
Skill by itself. Explicit diagnostic activation attaches the provider's explicit Skill input
alongside the same saved dataset question: a structured `name` plus absolute `SKILL.md` path for
Codex, or `/<skill-name>` for CodeBuddy. It is useful for separating an activation failure from a
Skill execution failure; it is not equivalent to the automatic-trigger score. Do not prepend
`/skill` to automatic-trigger cases.

Different runtime configurations execute concurrently; Cases remain sequential within each runtime
to keep provider state isolated and predictable. Every run snapshots its dataset, Cases, Skill,
runtime paths and versions, models, efforts, responses/errors, duration, session/thread identifiers,
and Trace references. Deleting a current Case therefore does not damage historical evidence. The
Curator grading contract is not yet applied automatically, so results remain reviewable evidence
rather than a numeric pass/fail score.

Deleting a dataset removes its current Cases and finished Curator records but preserves immutable
evaluation-run snapshots. An unfinished Curator draft blocks dataset deletion. Only terminal
evaluation runs can be deleted; deleting a run does not remove its separate raw Trace files. If the
deleted dataset was the Automatic Capture target, capture is disabled instead of being silently
redirected to another dataset.

Codex app-server currently exposes `skills/list`, `skills/config/write`, `plugin/list`,
`plugin/installed`, `plugin/read`, `plugin/install`, and `plugin/uninstall`. Rolling Skill's Codex
adapter uses runtime-owned discovery and exposes provider hooks for listing and installation; it
does not copy Skills or Plugins into an application-owned directory. A future plugin manager should
keep this boundary for every provider: Rolling Skill presents a common inventory and explicit
install action, while the selected runtime remains the source of truth. Installation must happen
before an evaluation snapshot is created and must require an operator action; silently installing
a missing Plugin during a run would contaminate reproducibility. CodeBuddy ACP does not currently
provide a path-precise Skill inventory, so Rolling Skill says that explicitly instead of fabricating
one; the operator is responsible for confirming the selected Skill is available to CodeBuddy.

## Provider architecture

`src/runtime-registry.cjs` contains the provider-neutral registry. Providers implement two
operations:

- `discover(options)` returns compatible runtime descriptors;
- `createClient(descriptor, options)` creates the runtime-specific client.

`src/codex-runtime-provider.cjs` implements Codex app-server and
`src/codebuddy-runtime-provider.cjs` implements CodeBuddy's native ACP transport. Chat remains bound
to one active runtime, while `src/evaluation-runner.cjs` creates isolated clients for every selected
evaluation configuration and attributes results and traces by `runtimeId`.

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

Development and packaged builds use the same discovery path. Set `ROLLING_SKILL_CODEX_BIN` or
`ROLLING_SKILL_CODEBUDDY_BIN` when a specific executable should be used without saving it through
the UI.

## Local evaluation workflow

1. Select a workspace and active runtime. Use the **Skill evaluation** workbench to confirm that the
   intended Skill is installed and enabled in that exact runtime and workspace.
2. Start a new task or open an existing workspace-scoped task.
3. Inspect the streamed conversation and raw local trace.
4. Select **Curate case** beside the assistant message that ends the useful problem-solving episode.
5. Choose the source user message where the episode begins, the enabled Skill under review, a
   dataset, and `goodcase` or `badcase`. The dataset question starts with the exact source wording
   and remains editable until curation starts. Editing it changes the evaluation input only; the
   frozen source conversation and its original question remain unchanged for audit.
6. Select **Start curation**. Rolling Skill freezes the selected conversation/trace range while the
   original task remains live, then starts an independent read-only Curator task.
7. Review the Curator conversation and structured reference answer in **Case drafts**. Ask follow-up
   questions or request revisions, change the model used by subsequent Curator turns, use **Retry**
   after a failed draft, and select **Done** only when the hard requirements and reference result
   are ready. **Discard** stops and archives the Curator task without saving a Case. Both actions
   remove the item from active Case Drafts; archived history is available only in **Settings**.

Before the Curator starts, Rolling Skill force-refreshes the selected runtime's Skill inventory and
rejects a Skill that is missing or disabled. The Curator prompt names that Skill and requires the
agent to read the currently installed version as its evaluation rubric without executing the
Skill's workflow. A runtime-native structured Skill reference pins the exact selected path when
several installed Skills share a name. Rolling Skill does not copy or cache `SKILL.md`; the runtime
remains the source of truth. Each draft and approved Case records the Skill name/path, scope,
runtime identity, and confirmation time as provenance.

The Curator output has a fixed agent-grading contract: reference summary, required facts, required
steps, required output format, evidence links, hard pass/fail requirements, soft criteria, and
automatic failures. Badcases also record the first divergence, root causes, compact loop summary,
and expected recovery. Shell activity is grouped by CLI/subcommand (for example `git status` and
`billing-cli cost query`) while repeated CLI and MCP calls are compacted with counts and status
distributions.

Automatic Capture is disabled by default. When enabled it requires a default enabled Skill and
creates reviewable Case Drafts after completed assistant responses; it never saves them
automatically. A missing or disabled Skill produces an explicit capture error instead of a
Skill-less draft. No case is written until
**Done**. Approved cases retain the selected dataset question and the exact source question
separately in provenance, plus structured grading data, source and Curator runtime provenance,
immutable Episode evidence, and the append-only trace range. The default Curator model lives in **Settings**;
each editable Case Draft can override it for subsequent follow-up turns. If no override is set, the
source model is reused when the runtime exposes it, with the active runtime default as fallback.

Local state is stored under `~/Library/Application Support/Rolling Skill/`:

| Path | Contents |
| --- | --- |
| `evaluation-store.json` | Datasets, cases, Curator sessions/revisions, settings, and immutable evaluation runs |
| `preferences.json` | Selected workspace and optional runtime selection |
| `traces/*.jsonl` | Append-only runtime events with runtime identity metadata |

## Security model

- Runtime probes and launches use fixed executable/argument arrays with `shell: false`.
- Source Codex and Codex evaluation threads use the selected local-access policy, defaulting to
  `danger-full-access`; Codex Curator threads remain forced to `read-only`. CodeBuddy uses its own
  ACP permission mode because it does not expose the same OS workspace sandbox. Codex threads use
  `approvalPolicy: never`.
- The renderer has Node integration disabled, context isolation enabled, and Chromium sandboxing
  enabled.
- The preload bridge exposes only runtime, workspace, thread, turn, dataset, and trace operations;
  it does not expose shell or filesystem primitives.
- Packaged renderer files are the only internal navigation target. Validated HTTP/HTTPS links are
  handed to macOS, validated absolute local paths are revealed in Finder, and all other navigation
  is blocked.
- Dataset writes are atomic and trace files are append-only with owner-only permissions.

## Tests

`npm test` covers provider discovery priority and de-duplication, compatibility probing, registry
selection/client delegation, a real locally discovered app-server smoke, protocol framing, Git
workspace discovery, local-first surface invariants, episode boundaries, dataset/source questions,
CLI/MCP compaction, Curator lifecycle/retries/revisions/discard, Automatic Capture gating, model
catalog and turn overrides, reasoning-effort propagation, settings migration, atomic dataset
persistence, Case deletion and immutable run snapshots, fixed grading contracts, multi-runtime
parallel queues, CodeBuddy ACP configuration, runtime attribution, shutdown cleanup, and trace
provenance.

## Troubleshooting

### CodeBuddy appears in Terminal but not from Finder

Older Rolling Skill builds probed an env-based CodeBuddy launcher with Finder's minimal `PATH`, so
`/usr/bin/env node` failed even though Terminal discovery worked. Rebuild the current app; its
probe prepends CodeBuddy's executable directory. Use **Settings → Runtime… → Rescan** after replacing
an older packaged app.

### Codex originator compatibility mode

Codex app-server copies `initialize.params.clientInfo.name` into the `originator` header of model
requests. Some enterprise Codex endpoints only accept a registered list of clients and reject any
other value before model execution.

This error is not an authentication, model, or reasoning-effort failure. The current development
build temporarily uses `codex_exec` as its app-server originator so it can work with an internal
gateway that already permits the local Codex CLI. The title and product UI remain Rolling Skill.
Restore the originator to `rolling-skill` and register that client identity before distributing a
production build.
