# Rolling Skill Desktop

Rolling Skill is a local-first macOS client for running and evaluating Skill tasks through agent
runtimes already installed on the machine. It opens directly into a task interface, discovers
compatible runtimes, and connects through a provider adapter. The application does not package an
agent runtime and does not require Docker or a separate backend service.

## Open the app

Double-click `Rolling Skill.app` at the repository root. The first local build creates a persistent
10-year code-signing identity named `Rolling Skill Local Development` in the current user's login
keychain. Later builds reuse the same identity so macOS privacy grants remain attached to the same
application identity while this certificate, bundle identifier, and app path remain unchanged.

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

The active runtime's model catalog is loaded through its provider adapter. The task composer can
select a model, reasoning effort, and conversation permission mode; each editable Case Draft can
select its model and effort. Settings provides defaults
for new tasks, Curator tasks, and Automatic Capture. No model names are bundled into the desktop
application.

## Settings and appearance

Open **Settings** in the lower-left sidebar to configure:

- Simplified Chinese or English interface text;
- Codex Light (the default white-and-blue theme), Codex Dark, or the original Graphite theme;
- Full local access (default) or Workspace only as the default for new Codex conversations;
- the default model and reasoning effort for new tasks and Curator tasks; and
- Automatic Capture, including its Curator model and effort, Skill-bound destination dataset, and
  default case type.

All settings are stored locally. Automatic Capture remains disabled until explicitly enabled.
Runtime selection, raw Trace access, and the local dataset file are also grouped in **Settings**.

The permission picker in the task composer is provider-aware and stored per runtime conversation.
Codex offers Full local access (`danger-full-access`), Workspace only (`workspace-write`), and Read
only. CodeBuddy offers its native session modes: Auto review, Ask when needed, Accept edits, Plan,
Don't ask, Bypass prompts, and Full local access. Rolling Skill applies CodeBuddy changes through
ACP `session/set_mode`, so switching modes does not restart the runtime. **Don't ask** means that an
operation needing approval is rejected. **Bypass prompts** can still be stopped by explicit rules
or dangerous-command checks; CodeBuddy's ACP-only `fullAccess` mode is the actual full-access
choice. **Ask when needed** relays
ACP permission requests to a local approval dialog, shows the runtime, workspace, session and raw
tool input, and returns the exact option selected by the operator. Requests without an explicit
reject option are cancelled safely. New CodeBuddy conversations default to Auto review instead of
Don't ask.

Rolling Skill does not create a container or require Docker. CodeBuddy's permission mode controls
tool approval, while CodeBuddy's optional shell sandbox is a separate runtime feature. The Electron
renderer also keeps using Chromium's own renderer sandbox in every mode.

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
`/Users/example/project/rolling-skill`. Choose the exact intended workspace before creating the thread;
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
back into history by item ID. The index keeps full command input and compact labels/status metadata,
but does not persist command output, tool results, or file diffs. Activity that predates this index and is also absent
from the runtime's own history cannot be reconstructed; its raw trace remains available when the
conversation originally ran through Rolling Skill.

## Chat and Skill evaluation workbench

Use the switch below the Rolling Skill logo to move between the native **Chat** client and the
**Skill evaluation** workbench. The workbench can:

- create, browse, and delete local datasets;
- export a complete dataset as CSV, with `input` and `output` columns whose cells are JSON message arrays;
- bind exactly one enabled runtime Skill to each dataset and repair or change that binding;
- inspect original evaluation questions, optional answer-issue descriptions, and curated references;
- delete a Case without invalidating older evaluation snapshots;
- query a provider's path-precise Skill inventory when it exposes one;
- run one selected Case or an entire dataset;
- stop one active evaluation without affecting Chat or other concurrent runs, preserving completed
  answers and Trace evidence while cancelling current and queued Case/Judge work;
- select multiple runtime/model/reasoning-effort configurations for one run; and
- inspect and delete durable Case × Runtime results under **Evaluation runs / 评测记录**.

Automatic activation sends only the frozen original user question, byte-for-byte as captured. The
optional answer-issue description is Curator and Judge context only and can never replace the
evaluation input. This is the path to use when measuring whether the runtime can discover and
activate a Skill by itself. Explicit diagnostic activation attaches the provider's explicit Skill input
alongside the same original question: a structured `name` plus absolute `SKILL.md` path for
Codex, or `/<skill-name>` for CodeBuddy. It is useful for separating an activation failure from a
Skill execution failure; it is not equivalent to the automatic-trigger score. Do not prepend
`/skill` to automatic-trigger cases.

Different runtime configurations execute concurrently; Cases remain sequential within each runtime
to keep provider state isolated and predictable. Each completed target result immediately enters a
separate, single-worker Judge queue, so grading overlaps later target execution instead of waiting
for the slowest runtime to finish. A run completes only after both the runtime queues and the Judge
queue drain. Every run snapshots its dataset, Cases, Skill,
runtime paths and versions, models, efforts, responses/errors, duration, session/thread identifiers,
and Case-scoped Trace references. Deleting a current Case therefore does not damage historical
evidence.

While any evaluation run is active, the app holds macOS's `prevent-app-suspension` power lease. The
display may still sleep, but system sleep no longer consumes the wall-clock evaluation timeout. The
lease is shared across concurrent runs and released after the last run finishes or fails. If a target
turn does time out, Rolling Skill interrupts that exact Codex turn or cancels that CodeBuddy ACP
session before continuing. The failed result retains the runtime error code, duration, last observed
activity time, thread/session ID, turn ID, raw Trace range, and bounded Trace evidence for diagnosis.

Each `Case × runtime` result is scored out of 100. Layer A is a fixed 40-point generic Skill-compliance
rubric covering activation, required references, tool/CLI policy, workflow order,
pagination/completeness/artifacts, deterministic processing, evidence/output requirements, and
error recovery. The application requires the Judge to assess every fixed item and computes the A
score itself; A passes at 32 points unless the activation gate fails. When a complete Trace contains
no error event, the fixed program awards full error-recovery credit because no recovery was needed.
When an error occurred, positive recovery credit requires both failure evidence and a later recovery
action. Layer B is a flexible 60-point Skill/Case-specific subjective assessment built from the
Curator contract. It records verifiable fields, cross-checks, verification status, and Judge
confidence, but never reverses the A verdict. The workbench presents the fixed outcome as one of four
operator-facing tiers: **Formal pass** (A at least 32 with no critical failure), **Usable · needs
improvement** (A at least 24 with no critical failure), **Failed**, or **Diagnostic only**.

Target execution, grading execution, and quality verdict remain separate states. A result first waits
for target execution, then waits in the Judge queue, then moves through active and terminal grading
states. Explicit activation
runs are diagnostic: they retain A/B component scores but do not produce a formal total or pass/fail
quality verdict. As each target result completes, one independently selected read-only Judge runtime
grades the saved response,
bounded Trace evidence, and a digest-pinned snapshot of the selected `SKILL.md` plus its recursively
linked local Markdown references. A typed evidence catalog prevents positive A ratings from citing
unrelated response or Trace entries when stronger activation, reference-read, command/tool, output,
or error evidence exists. The Skill digest is checked again immediately before and after every Case;
a changed installation rejects that target result instead of grading against a stale snapshot.
Invalid or incomplete Judge JSON is retried once with the fixed validator error. A final Judge failure keeps
the target response and Trace intact and marks only grading as failed. Legacy runs remain explicitly
ungraded rather than receiving guessed scores.

Raw runtime JSONL is always retained unchanged. Judge evidence is a deterministic projection: noisy
deltas are omitted, a completed CodeBuddy `tool_call` plus `tool_call_update` pair becomes one merged
terminal event, and an unfinished call keeps its start event. Commands and parameters remain
inspectable. Oversized stdout/stderr and tool-result bodies are reduced to a bounded head/tail excerpt
after an SHA-256 digest is recorded, so repeated multi-kilobyte output cannot crowd commands, errors,
or Skill reads out of the Judge budget. Duplicate ACP `rawResponse` bodies are not copied into Judge
evidence. The evidence states whether every semantic event fit; protocol noise and output-body
compaction do not by themselves make semantic coverage incomplete. The Judge prompt receives the raw
bounded evidence once plus a compact typed index, rather than receiving duplicate full Trace and Skill
copies.

A formal score normally uses the target runtime's Skill inventory to confirm the exact frozen Skill
path. Inventory declaration and execution observation are stored separately. For providers such as
CodeBuddy that do not expose path-precise inventory, a completed Skill tool event can recover formal
binding only when the unabridged executed Skill body digest exactly matches the frozen `SKILL.md` body.
A matching name alone is insufficient, and an observed body mismatch forces diagnostic-only grading.
The same Trace remains the evidence for whether the agent actually activated, read, and applied the
Skill; installation binding never awards the Skill-activation rubric by itself.

The Skill is selected once at dataset creation rather than separately for each capture or run.
Case capture, Curator, Automatic Capture, and evaluation all inherit the dataset binding. Rebinding
affects only future work: existing Cases, Curator sessions, and evaluation-run snapshots retain
their frozen historical evidence. A dataset cannot be rebound while a capture reservation or an
unfinished Curator session exists. Legacy datasets migrate automatically only when their saved
Case/Curator references agree on one exact Skill name and absolute path; conflicting or evidence-free
datasets stay unbound until the operator repairs them. A missing or stale exact name+path is never
displayed as ready and blocks new capture or evaluation.

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
runtime, creates or reuses the local keychain signing identity, and writes the signed
`Rolling Skill.app` at the repository root. Private signing material remains in the login keychain
and is never written to the repository. It targets macOS 13 or newer.

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
5. Choose the source user message where the episode begins, a Skill-bound dataset, and `goodcase`
   or `badcase`. The optional answer-issue field starts empty and records
   what went wrong in the captured Agent answer. It never changes the frozen original question
   used as the evaluation input.
6. Select **Start curation**. Rolling Skill freezes the selected conversation/trace range while the
   original task remains live, then starts an independent read-only Curator task.
7. Review the Curator conversation and structured reference answer in **Case drafts**. Ask follow-up
   questions or request revisions, change the model used by subsequent Curator turns, use **Retry**
   after a failed draft, and select **Done** only when the hard requirements and reference result
   are ready. **Discard** stops and archives the Curator task without saving a Case. Both actions
   remove the item from active Case Drafts; archived history is available only in **Settings**.

Before the Curator starts, Rolling Skill force-refreshes the selected runtime's Skill inventory and
rejects the dataset binding if the exact Skill name and path are missing or disabled. The Curator
prompt names that Skill and requires the
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

Automatic Capture is disabled by default. When enabled it requires a configured Skill-bound dataset and
creates reviewable Case Drafts after completed assistant responses; it never saves them
automatically. A missing or disabled Skill produces an explicit capture error instead of a
Skill-less draft. No case is written until
**Done**. Approved cases retain the exact source question as evaluation input and store the optional
answer-issue description separately, plus structured grading data, source and Curator runtime provenance,
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
