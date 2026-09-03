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

The built-in provider adapters support Codex app-server, CodeBuddy ACP, and the DeepSeek Harness
local Web Host API. Codex candidates are
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

DeepSeek Harness checks an explicitly selected executable, `ROLLING_SKILL_DSH_BIN`, `PATH`,
Homebrew/system paths, and common user-local locations including `~/.local/bin/dsh`. A compatible
candidate must expose the `web` profile's dynamic `--port` Host mode. Rolling Skill starts and stops
that localhost Host itself, uses its typed HTTP RPC API for sessions, models, Skills, history,
tools, responses, and turn cancellation, and receives live session events from the
`/api/events.mux` WebSocket. Durable history is read when a turn starts and as recovery after a mux
reconnect; it is not continuously polled while a turn runs. The adapter is marked Developer Preview
because the upstream Host API is not yet a stable compatibility contract.

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
for new tasks, Rubric Agent tasks, Curator tasks, Judge tasks, and Automatic Capture. No model names are bundled into the desktop
application. Reasoning effort is capability-gated per model: Rolling Skill passes only values
advertised by the runtime catalog. In particular, a DeepSeek Harness model such as
`wetv-glm/glm-5.3` may advertise no reasoning efforts and a `null` default, in which case the turn
must omit reasoning effort instead of sending a generic value such as `low`.

## Settings and appearance

Open **Settings** in the lower-left sidebar to configure:

- Simplified Chinese or English interface text;
- Codex Light (the default white-and-blue theme), Codex Dark, or the original Graphite theme;
- Full local access (default) or Workspace only as the default for new Codex conversations;
- the default model and reasoning effort for new tasks, Rubric Agent tasks, Curator tasks, and Judge tasks; and
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

DeepSeek Harness offers Full local access (`danger-full-access`), Workspace only
(`workspace-write`), and Read only. The selected mode is applied when Rolling Skill launches the
local Host and can be changed per conversation through the runtime's `/permission` command without
embedding or replacing `dsh`. In an ordinary task, runtime approval requests and questions are
relayed to the matching conversation: approvals preserve the options supplied by the runtime, and
questions support the runtime's single-choice, multiple-choice, and free-text fields. Responses are
returned through `POST /api/respond`; stopping or switching tasks cannot route a late response into
a different Host process. Evaluation targets and Judges are non-interactive, so a requested
approval is rejected or a question is cancelled and that Case fails immediately instead of waiting
for unattended UI input.

Rolling Skill does not create a container or require Docker. CodeBuddy's permission mode controls
tool approval, while CodeBuddy's optional shell sandbox is a separate runtime feature. The Electron
renderer also keeps using Chromium's own renderer sandbox in every mode.

## Conversation history and workspace scope

Codex conversation history is runtime-native. Use **Current / Archived** above the task list,
archive a stopped conversation from its hover action, and restore it from the Archived view.
Archived conversations open read-only until restored. CodeBuddy ACP does not currently expose a
durable archive/list contract. DeepSeek Harness exposes durable session history but its current API
does not expose an unarchive operation. Rolling Skill reports unsupported archive actions where the
provider cannot implement the complete contract instead of maintaining a conflicting local copy.

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

## Raw Case inbox and external Tool

The Chat surface has a right-side **Raw Cases** inbox for questions that are worth keeping but have
not been run, verified, or curated yet. Pending questions are grouped by Skill. They can be edited
or deleted, sent verbatim to the current idle conversation, or sent verbatim to a new conversation
using the active runtime plus the visible model, reasoning-effort, and permission settings. Rolling
Skill does not prepend `/skill`, attach a structured Skill reference, or otherwise alter the
question. A Raw Case leaves the inbox only after the runtime accepts its turn.

When an original conversation range has been frozen for Curator, Chat gives that full range a pale
draft marker. After **Done** creates the formal Case, the range changes to the saved marker and its
assistant action reads **Curate again**. The original conversation remains usable, and repeat
curation is still allowed for a different dataset.

The macOS build also writes an executable named `rolling-skill-tool` beside `Rolling Skill.app`.
Other Agent platforms can enqueue questions while the App is closed without opening a local port:

```bash
./rolling-skill-tool enqueue \
  --skill billing-cost-management \
  --question '查一下 7 月账单，各业务混元 3 多少成本？'

printf '%s' '{"skill":{"name":"billing-cost-management"},"cases":[{"question":"问题一"},{"question":"问题二","note":"稍后验证"}]}' \
  | ./rolling-skill-tool enqueue --json -

./rolling-skill-tool list --skill billing-cost-management --json
```

For an MCP-capable Agent, configure the same executable as a stdio server with the `mcp` argument:

```json
{
  "mcpServers": {
    "rolling-skill-raw-cases": {
      "command": "/absolute/path/to/rolling-skill-tool",
      "args": ["mcp"]
    }
  }
}
```

It exposes `rolling_skill_enqueue_raw_cases` and `rolling_skill_list_raw_cases`. The Tool cannot
execute a runtime, delete formal Cases, or change evaluation datasets. App and Tool communicate
through an append-only, owner-readable JSONL event file; exact pending duplicates under the same
normalized Skill name are reported instead of appended again. A batch accepts at most 200 entries,
one question accepts at most 120,000 characters, and total batch question text is limited to
1,000,000 characters.

The `enqueue`, `list`, and two-tool `mcp` modes above are the offline Raw Case exception. They use
the append-only event file and continue to work while Rolling Skill.app is closed. They do not have
an Operator capability and cannot reach the authenticated control surface.

### Authenticated Operator control gateway

While Rolling Skill.app is running, it listens on an owner-only Unix-domain socket inside the
App's Application Support control directory. This describes the location class only: the App does
not print the live socket path, a capability token, or a session credential. Starting the listener
also issues no external capability, so connecting to the socket by itself grants no authority.

The `rolling-skill-tool control` and `rolling-skill-tool operator-mcp` modes implement the
authenticated transport contract, but Phase 1 deliberately ships no external Operator capability
issuer or trusted launcher. There is currently no supported external workflow for obtaining a valid
token and session, so these modes cannot yet authenticate to the App. A future issuer must keep the
App running and pass the concrete socket path, bearer token, and session ID only in the launched
child process environment:

- `ROLLING_SKILL_CONTROL_SOCKET`
- `ROLLING_SKILL_CONTROL_TOKEN`
- `ROLLING_SKILL_CONTROL_SESSION`

Do not put these credentials in command-line arguments, MCP arguments, repository configuration,
files, logs, or copied shell output. The Tool validates all three environment values before opening
an input file or connecting, redacts control failures, and never returns the token or session ID in
Tool results. Capabilities are short-lived, session-bound, action-bound, and object-scoped; the
socket is transport, not ambient authorization.

`operator-mcp` initially publishes these typed Tools from the shared control contracts:

- `rolling_skill_context_get`
- `rolling_skill_raw_cases_list`, `rolling_skill_raw_cases_enqueue`,
  `rolling_skill_raw_cases_update`, and `rolling_skill_raw_cases_dispatch`
- `rolling_skill_runtimes_list` and `rolling_skill_runtimes_models`
- `rolling_skill_datasets_list` and `rolling_skill_datasets_get`
- `rolling_skill_evaluations_list`, `rolling_skill_evaluations_get`,
  `rolling_skill_evaluations_start`, and `rolling_skill_evaluations_cancel`
- `rolling_skill_skill_repositories_list`, `rolling_skill_skills_list`,
  `rolling_skill_skill_versions_list`, and `rolling_skill_skills_get`
- `rolling_skill_optimization_preflight`, `rolling_skill_optimization_start`,
  `rolling_skill_optimization_get`, `rolling_skill_optimization_pause`,
  `rolling_skill_optimization_resume`, `rolling_skill_optimization_stop`,
  `rolling_skill_optimization_submit_candidate`,
  `rolling_skill_optimization_submit_decision`, and `rolling_skill_optimization_report`

Ordinary Chat sessions and formal target/Judge evaluation clients never receive this Operator
capability, the `operator-mcp` server, or its credential environment. The desktop renderer uses a
separate main-process-private capability for its existing UI actions; no token or session is exposed
through preload, Renderer IPC arguments/results, or DevTools.

## Multi-Epoch Skill optimization

Use **Self-operation → Multi-Epoch Optimization** to improve one managed Skill against a stable
evaluation contract. Before Start is enabled, preflight resolves and freezes the selected Released
baseline, managed Skill/repository identity, Dataset and published Rubric revision, calibrated Case
revisions, Operator Runtime, target Runtime matrix, Judge, activation mode, model/effort choices,
stop targets, and hard budgets. A later Dataset, Rubric, Case, catalog, or Working-tree change does
not mutate an existing Run. Start a new Run when the comparison inputs must change.

The engine, rather than the Operator Agent, owns the phase order:

```text
preflight → baseline evaluation
          → edit → Candidate → experiment install → evaluation → decision
          → next Epoch, one final release-and-install approval, or stop-and-restore
          → approved release + Released install → succeeded
```

The baseline evaluation is not an Epoch. Each Epoch edits a linked worktree under Application
Support, commits an immutable Candidate, installs and verifies it on every selected target Runtime,
evaluates the same frozen Dataset/Rubric, and records deterministic score/pass deltas and
regressions. Candidate installations advance directly between Epochs; the initial Runtime state is
restored only when the whole Run stops, fails, is rejected, or otherwise finishes without a
successful Released installation. Fixed mode follows the configured Epoch bound. Adaptive mode lets
the Agent submit a typed `continue`, `finish`, or `pause` recommendation, but deterministic target,
patience, regression, duration, turn, Epoch, token, and cost gates remain authoritative. Token or
cost can be a hard gate only when every selected Runtime advertises that telemetry.

Experiment installation is separate from ordinary Released installation. It accepts only the
Candidate and worktree registered to the current Run, writes a Run/Epoch experiment marker, and does
not update the trusted Released installation matrix. Preflight permits unattended rotation only
from an absent target or an exactly verified clean managed baseline with a frozen restoration
source. Drifted, unmanaged, conflicting, or uncertain targets must first be repaired in **Runtime
installs**. Restoration rechecks the experiment marker before changing a target and verifies the
restored content and inventory afterward; any uncertain target leaves the parent Job in
`needs_recovery` with its last verified digest, marker, and installer Job link.

The first Candidate experiment installation, the one final release-and-install decision, and any
requested budget increase are distinct approval boundaries. The Agent cannot approve them or raise
its own limits. At the final decision the user chooses either **Install improved version**, which
publishes the immutable Candidate and formally installs it on every frozen target, or **Restore
original version**, which skips release and restores the experiment targets. A successful release
followed by a failed install remains recorded as “released but not installed”; the Released version
is not rolled back, while enrolled Runtime targets are restored or surfaced for recovery. A
successful formal installation ends the Run without another final-regression evaluation.

Pause prevents new phase scheduling without pretending an in-flight side effect was undone. Stop
cancels queued work, interrupts active children, and then restores enrolled Runtime targets. During
App shutdown the runner checkpoints the current phase, active installation/evaluation references,
restoration evidence, and the latest available elapsed-time, turn, token, and cost telemetry before
Runtime sessions are stopped.
Startup reconciles unfinished Runs before the window opens: read-only inspection and saved IDs are
used instead of blindly replaying installation or evaluation writes. Recovery failure remains
durable and blocks a new Epoch or release action.

The right-hand Run panel shows the frozen inputs, Epoch/Candidate timeline, per-Runtime installation
state, score/pass trend, regressions, remaining budgets, stop reason, approvals, release/final
installation result, and recovery targets. Large Diff, evaluation, Trace, and report bodies stay in
lazy Artifacts rather than the Renderer snapshot. The generated Chinese Markdown report is derived
from persisted evidence; unavailable Runtime telemetry is labeled as unavailable, never reported as
zero.

## Managed Skill repositories

Use **Skill management** under the Rolling Skill logo to maintain editable, local-first Skill source
repositories separately from runtime installations. A repository can be imported from a folder,
ZIP archive, local Git repository, or authenticated HTTPS/SSH Git URL. URL import is a one-time
clone in this phase; Rolling Skill does not require or publish to a remote repository.

Every import is copied into Rolling Skill's Application Support directory as an independent Git
working repository. Folder and ZIP imports receive a new local Git history; Git imports retain
their source history. A repository may contain one or several Skills, each discovered from its own
`SKILL.md`. **Reveal repository** opens that managed copy in Finder for editing; it never redirects
edits back into the imported folder or ZIP. **Refresh** performs a bounded rescan rather than merely
reloading the registry, so a repaired manifest or newly added Skill appears without restarting the
App. Renaming a Skill at an existing root is rejected until an explicit identity migration exists,
which prevents Dataset bindings from silently moving to a different Skill. The workbench shows the repository, Skill manifest, and
immutable version records:

- **Working** is the editable repository content and is not a testable version by itself;
- **Candidate** is a committed snapshot created from reviewed Working changes;
- **Released** is a named Candidate protected by an annotated Git tag; and
- **Deprecated** keeps a Released version and its history visible while marking it unsuitable for
  new installations.

Local paths are selected only by the Electron main process and never exposed as arbitrary renderer
filesystem access. ZIP imports reject traversal, absolute paths, escaping symlinks, duplicate
entries, special files, excessive size/count, and suspicious compression ratios. Repository and
version metadata is written as one atomic transaction with owner-only permissions. Folder copying
and repository scanning apply the same entry and byte limits before a complete source tree is
materialized. Git commands use argument arrays without a shell, disable imported hooks, remove the
one-time clone remote, and redact URL credentials from saved provenance and errors. Version
digests are calculated from the committed Git tree, including force-added Skill files that a source
`.gitignore` would otherwise omit. If the registry itself is structurally corrupt, the App preserves
it under a timestamped quarantine name and keeps Chat available with a fresh registry plus a visible
Skill-management warning.

The **Runtime installs** tab is deliberately separate from Versions. Select one immutable Released
version, then choose one or more detected runtimes plus each runtime's model, reasoning effort, and
permission mode. Rolling Skill freezes the registered repository, Skill, commit, and content digest,
then starts one visible installer Agent session per runtime. The selected runtime—not the Electron
host—uses its own Bash/tools to discover the Skill root, export the exact Git commit, classify the
existing target, copy or overwrite the exact Skill directory, write
`.rolling-skill-managed.json`, refresh its inventory when supported, and report a typed result.
Different runtimes run in parallel; jobs for the same Runtime and Skill are serialized.

Only an absent or clean Rolling-Skill-managed target can proceed without another confirmation.
Drifted, unmanaged, conflicting, or uncertain targets must be shown to the operator in the Runtime
interaction UI before overwrite. Permission requests are also relayed to the operator; Rolling Skill
never elevates silently. A missing, duplicated, truncated, contradictory, or identity-mismatched
result remains **Unverified** and never advances the trusted installed-version matrix. Stopping an
active install interrupts that Runtime turn and automatically performs a read-only inspection in
the same installer session because a Bash command may already have changed part of the target.
Terminal sessions retain their messages, compact tool history, Trace reference, a follow-up composer,
and an explicit **Inspect read-only** action. Conversation follow-ups cannot rewrite the recorded
installation outcome; use the inspect action to create a new auditable verification job.

Publishing does not install anything automatically. Its toast only opens Runtime installs, and
evaluation continues to verify the Skill actually exposed by each selected runtime.

## Chat and Skill evaluation workbench

Use the switch below the Rolling Skill logo to move among the native **Chat** client, the
**Skill evaluation** workbench, **Skill management**, and **Self-operation**. The evaluation
workbench can:

- create, browse, and delete local datasets;
- export all Cases or only Good Cases as CSV, choosing either curated references or only the final
  frozen Assistant answer for the JSON-array `output` column;
- bind exactly one enabled runtime Skill to each dataset and repair or change that binding;
- generate, discuss, revise, publish, and inspect versioned dataset-level scoring Rubrics through a
  read-only Rubric Agent;
- inspect original evaluation questions, optional answer-issue descriptions, and curated references;
- delete a Case without invalidating older evaluation snapshots;
- query a provider's path-precise Skill inventory when it exposes one;
- run one selected Case or an entire dataset;
- stop one active evaluation without affecting Chat or other concurrent runs, preserving completed
  answers and Trace evidence while cancelling current and queued Case/Judge work;
- select multiple runtime/model/reasoning-effort configurations for one run; and
- inspect and delete durable Case × Runtime results under **Evaluation runs / 评测记录**. A run
  uses segmented Runtime tabs in its detail pane, so Codex, CodeBuddy, DeepSeek Harness, and later
  providers do not form one long vertical result stream.

Automatic activation sends only the frozen original user question, byte-for-byte as captured. The
optional answer-issue description is Curator and Judge context only and can never replace the
evaluation input. This is the path to use when measuring whether the runtime can discover and
activate a Skill by itself. Explicit diagnostic activation attaches the provider's explicit Skill input
alongside the same original question: a structured `name` plus absolute `SKILL.md` path for
Codex, or `/<skill-name>` for CodeBuddy and DeepSeek Harness. It is useful for separating an activation failure from a
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
turn does time out, Rolling Skill interrupts that exact Codex turn, cancels that CodeBuddy ACP
session, or calls DeepSeek Harness `session.cancel` before continuing. The failed result retains the runtime error code, duration, last observed
activity time, thread/session ID, turn ID, raw Trace range, and bounded Trace evidence for diagnosis.

Each `Case × runtime` result receives one unified score out of 100. Rubric Agent reads the bound Skill
and its references, then publishes a complete dataset rubric covering automatic activation,
required references, tool policy, workflow order, pagination and artifacts, deterministic
processing, evidence/output requirements, applicable error recovery, and Skill-specific answer
quality. Criteria use relative weights and observable 0–10 anchors; the application normalizes them
into the total. Case calibration adds only Case-specific expectations, automatic failures, and
badcase deductions without creating a separate score layer. The Judge records verifiable fields,
cross-checks, verification status, confidence, rationale, and evidence references for every item,
while the application alone computes points and outcomes. The workbench presents **Formal pass**
(80 or above with no critical failure), **Usable · needs improvement** (60 or above with no critical
failure), **Failed**, or **Diagnostic only**. A published critical criterion rated below 5 and an
observed binary automatic-failure condition remain fixed gates.
When either gate fires, the fixed calculator caps the unified total below the usable threshold so a
high-looking score can never contradict a failed outcome.

Target execution, grading execution, and quality verdict remain separate states. A result first waits
for target execution, then waits in the Judge queue, then moves through active and terminal grading
states. Explicit activation
runs are diagnostic: they retain the unified numerical total but do not produce a formal pass/fail
quality verdict. As each target result completes, one independently selected read-only Judge runtime
grades the saved response,
bounded Trace evidence, and a digest-pinned snapshot of the selected `SKILL.md` plus its recursively
linked local Markdown references. A typed evidence catalog limits every assessment to stable
response, Trace, Skill, and reference identifiers. Dataset criteria that require a query chain,
pagination, CLI/MCP execution, or deterministic scripts cannot receive a passing rating from a
response-only citation: the fixed validator requires at least one actual `command` or `tool_call`
Trace citation for each applicable execution criterion. The Judge still determines whether the cited
tool names, parameters, order, and calculation logic match the frozen Skill and Case expectations;
the evidence-kind validator alone does not prove semantic correctness. Point-in-time numbers in a curated reference are treated as
historical comparison values; a different live amount is not penalized when the fresh complete
query, scope, units, sign handling, reconciliation, and deterministic calculation are supported.
The Skill digest is checked again immediately before and after every Case;
a changed installation rejects that target result instead of grading against a stale snapshot.
Invalid or incomplete Judge JSON is retried once with the fixed validator error. A final Judge failure keeps
the target response and Trace intact and marks only grading as failed. Existing split-format grading
is preserved as an immutable historical total, labeled as a legacy score, and is not presented as
current unified-rubric detail. Runs without grading data remain explicitly ungraded rather than
receiving guessed scores.

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
CodeBuddy and DeepSeek Harness that do not expose path-precise inventory, a completed Skill tool event can recover formal
binding only when the unabridged executed Skill body digest exactly matches the frozen `SKILL.md` body.
A matching name alone is insufficient, and an observed body mismatch forces diagnostic-only grading.
The same Trace remains the evidence for whether the agent actually activated, read, and applied the
Skill; installation binding never awards the Skill-activation rubric by itself.

The Skill is selected once at dataset creation rather than separately for each capture or run. A
dataset must then publish one shared Rubric before Case capture or formal evaluation. The Rubric
Agent reads a complete frozen snapshot of the bound Skill and linked local Markdown references,
creates a score-free contract with stable criterion IDs, relative weights, evidence requirements,
0/2/5/8/10 anchors, and narrow failure conditions, and accepts natural-language review messages.
Only the operator's **Publish** action makes a revision active. Every publication creates an
immutable version; stale concurrent drafts cannot overwrite a newer active version.
An active Rubric from the retired split-score contract can be upgraded deterministically: the App
creates a new immutable version by adding only `scoringModel: "unified-100/v1"`, preserves the prior
version and every ordinary Rubric field, and carries Cases already current on that version forward
without invoking an Agent. The action is blocked while an evaluation, Case calibration, or Rubric
Agent editing session for the dataset is active.

Case capture, Curator, Automatic Capture, and evaluation all inherit the dataset binding and active
Rubric. The Curator must cover every dataset criterion exactly once and may add only narrow
Case-specific criteria or failures; `rolling-skill-curated-case/v2` rejects a duplicate per-Case
grading contract. Runs freeze the active Rubric and never recalculate older records. Publishing a
new version marks existing Cases as needing calibration and blocks them from formal evaluation
until re-curated. **Calibrate** on a Case card starts a regular reviewable Curator conversation with
the frozen original exchange, current structured summary, active Skill, and latest Rubric.
**Auto-calibrate all** in the dataset Rubric status processes every stale Case serially: each valid
Curator draft is saved automatically, then the next Case starts. **Stop** cancels the current Curator
task and leaves later Cases untouched; a creation response that arrives after Stop is discarded so
it cannot become an orphan draft. A failed Case pauses the batch without skipping it. An operator
can still open any Case afterward, ask the Curator to revise it, and use **Done · update case**
manually. Saving updates the same Case id, preserves the previous calibrated revision, and clears
the block once every Case is current. Rebinding affects
only future work: existing Cases, Curator sessions, and
evaluation-run snapshots retain their frozen historical evidence, while the active Rubric is
cleared. A dataset cannot be rebound while a capture reservation, unfinished Curator session, or
unfinished Rubric Agent session exists. Legacy datasets migrate automatically only when their saved
Case/Curator references agree on one exact Skill name and absolute path; conflicting or evidence-free
datasets stay unbound until the operator repairs them. A missing or stale exact name+path is never
displayed as ready and blocks new capture or evaluation.

Deleting a dataset removes its current Cases, Rubric versions/sessions, and finished Curator records
but preserves immutable evaluation-run snapshots. An unfinished Curator or Rubric Agent draft blocks
dataset deletion. Only terminal
evaluation runs can be deleted; deleting a run does not remove its separate raw Trace files. If the
deleted dataset was the Automatic Capture target, capture is disabled instead of being silently
redirected to another dataset.

Codex app-server currently exposes `skills/list`, `skills/config/write`, `plugin/list`,
`plugin/installed`, `plugin/read`, `plugin/install`, and `plugin/uninstall`. Rolling Skill nevertheless
keeps managed source repositories separate from runtime-owned installations and inventories. The
provider-neutral installation protocol asks the selected Runtime Agent to discover and mutate its own
installation, rather than teaching Rolling Skill fixed provider paths. The host accepts a success
only when the Runtime reports the frozen identity, expected digest, management marker, and either
runtime-inventory or filesystem verification. CodeBuddy ACP does not currently provide a path-precise
Skill inventory. DeepSeek Harness exposes a runtime-owned name-only catalog. Rolling Skill records
those precision limits instead of fabricating paths or claiming a stronger content match.

## Provider architecture

`src/runtime-registry.cjs` contains the provider-neutral registry. Providers implement two
operations:

- `discover(options)` returns compatible runtime descriptors;
- `createClient(descriptor, options)` creates the runtime-specific client.

`src/codex-runtime-provider.cjs` implements Codex app-server and
`src/codebuddy-runtime-provider.cjs` implements CodeBuddy's native ACP transport.
`src/deepseek-harness-runtime-provider.cjs` discovers `dsh`, while
`src/deepseek-harness-client.cjs` manages the local Host and adapts its typed session history into
Rolling Skill turns and raw Trace evidence. Chat remains bound
to one active runtime, while `src/evaluation-runner.cjs` creates isolated clients for every selected
evaluation configuration and attributes results and traces by `runtimeId`.

## Build the double-clickable app

From the repository root:

```bash
bash desktop/rolling-skill/scripts/build-macos-app.sh
```

The script installs desktop dependencies, runs unit and discovered-runtime integration tests,
packages the Apple Silicon Electron client and standalone Raw Case CLI/MCP Tool, refuses any bundle containing an embedded Codex
runtime, CodeBuddy runtime, or `dsh` executable, creates or reuses the local keychain signing identity, and writes the signed
`Rolling Skill.app` and `rolling-skill-tool` at the repository root. Private signing material remains in the login keychain
and is never written to the repository. It requires Node.js 22 or newer and automatically tries a
local Homebrew Node when the current shell resolves an older version. It targets macOS 13 or newer.

## Develop

```bash
cd desktop/rolling-skill
npm ci
npm test
npm start
```

Development and packaged builds use the same discovery path. Set `ROLLING_SKILL_CODEX_BIN`,
`ROLLING_SKILL_CODEBUDDY_BIN`, or `ROLLING_SKILL_DSH_BIN` when a specific executable should be used
without saving it through the UI.

## Local evaluation workflow

1. Select a workspace and active runtime. Use the **Skill evaluation** workbench to confirm that the
   intended Skill is installed and enabled in that exact runtime and workspace.
2. Start a new task or open an existing workspace-scoped task.
3. Inspect the streamed conversation and raw local trace.
4. In the Skill evaluation workbench, generate, review, and publish the selected dataset's shared Rubric.
5. Select **Curate case** beside the assistant message that ends the useful problem-solving episode.
6. Choose the source user message where the episode begins, a Skill-and-Rubric-bound dataset, and `goodcase`
   or `badcase`. The optional answer-issue field starts empty and records
   what went wrong in the captured Agent answer. It never changes the frozen original question
   used as the evaluation input.
7. Select **Start curation**. Rolling Skill freezes the selected conversation/trace range while the
   original task remains live, then starts an independent read-only Curator task.
8. Review the Curator conversation and structured reference answer in **Case drafts**. Ask follow-up
   questions or request revisions, change the model used by subsequent Curator turns, use **Retry**
   after a failed draft, and select **Done** only when the Rubric coverage and reference result
   are ready. **Discard** stops and archives the Curator task without saving a Case. Both actions
   remove the item from active Case Drafts; archived history is available only in **Settings**.

Before the Rubric Agent or Curator starts, Rolling Skill force-refreshes the selected runtime's
Skill inventory and rejects the dataset binding if the exact Skill name and path are missing or
disabled. The Rubric Agent reads frozen Skill evidence; the Curator receives both the published
Rubric snapshot and a runtime-native structured Skill reference that pins the exact selected path when
several installed Skills share a name. Rolling Skill does not copy or cache `SKILL.md`; the runtime
remains the source of truth. Each draft and approved Case records the Skill name/path, scope,
runtime identity, and confirmation time as provenance.

The Curator output inherits the dataset Rubric and stores a reference summary, required facts,
required steps, required output format, evidence links, per-criterion applicability, and only
narrow Case-specific addenda. Badcases also record the first divergence, root causes, compact loop
summary, expected recovery, and recurrence deductions. Shell activity is grouped by CLI/subcommand (for example `git status` and
`billing-cli cost query`) while repeated CLI and MCP calls are compacted with counts and status
distributions.

Automatic Capture is disabled by default. When enabled it requires a configured Skill-bound dataset with a published Rubric and
creates reviewable Case Drafts after completed assistant responses; it never saves them
automatically. A missing or disabled Skill produces an explicit capture error instead of a
Skill-less draft. No case is written until
**Done**. Approved cases retain the exact source question as evaluation input and store the optional
answer-issue description separately, plus structured Rubric coverage, source and Curator runtime provenance,
immutable Episode evidence, and the append-only trace range. The default Curator model lives in **Settings**;
each editable Case Draft can override it for subsequent follow-up turns. If no override is set, the
source model is reused when the runtime exposes it, with the active runtime default as fallback.

Local state is stored under `~/Library/Application Support/Rolling Skill/`:

| Path | Contents |
| --- | --- |
| `evaluation-store.json` | Datasets, Rubric versions/sessions, cases, Curator sessions/revisions, settings, and immutable evaluation runs |
| `preferences.json` | Selected workspace and optional runtime selection |
| `raw-case-events.jsonl` | Append-only Raw Case inbox events shared with the external CLI/MCP Tool |
| `skill-registry.json` | Atomic registry of managed repositories, Skills, Candidates, Releases, and deprecation state |
| `skill-installations.json` | Runtime installer jobs, ordered message/tool timelines, typed results, and trusted installed-version matrix |
| `operator-jobs.json` | Operator sessions, parent/child Jobs, approvals, bounded events, checkpoints, and Artifact references |
| `optimization-runs.json` | Frozen Optimization Runs, Epochs, Candidates, analyses, decisions, telemetry checkpoints, and recovery state |
| `repositories/<repository-id>/` | Independent editable Git repository for each imported Skill source |
| `optimization-workspaces/<run-id>/` | Registered linked Git worktree for one active Optimization Run; never the primary managed Working tree |
| `traces/*.jsonl` and `traces/skill-installations/` | Append-only runtime events with runtime identity metadata |

## Security model

- Runtime probes and launches use fixed executable/argument arrays with `shell: false`.
- Skill installation source identity comes only from a registered Released version. The renderer
  cannot supply a repository path, destination, commit, or expected digest. Runtime installers may
  request permission or destructive confirmation, but they cannot silently broaden it; a stopped
  installer is followed only by a provider-mapped read-only inspection.
- Source Codex and Codex evaluation threads use the selected local-access policy, defaulting to
  `danger-full-access`; Codex Rubric Agent and Curator threads remain forced to `read-only`. CodeBuddy uses its own
  ACP permission mode because it does not expose the same OS workspace sandbox. DeepSeek Harness
  uses its runtime-native `danger-full-access`, `workspace-write`, or `read-only` permission mode.
  Codex threads use `approvalPolicy: never`.
- The renderer has Node integration disabled, context isolation enabled, and Chromium sandboxing
  enabled.
- The preload bridge exposes only runtime, workspace, thread, turn, dataset, and trace operations;
  it does not expose shell or filesystem primitives.
- Packaged renderer files are the only internal navigation target. Validated HTTP/HTTPS links are
  handed to macOS, validated absolute local paths are revealed in Finder, and all other navigation
  is blocked.
- Dataset and managed-Skill registry writes are atomic; Trace and Raw Case event files are
  append-only with owner-only permissions.

## Tests

`npm test` covers provider discovery priority and de-duplication, compatibility probing, registry
selection/client delegation, a real locally discovered app-server smoke, protocol framing, Git
workspace discovery, local-first surface invariants, episode boundaries, dataset/source questions,
CLI/MCP compaction, Curator lifecycle/retries/revisions/discard, Automatic Capture gating, model
catalog and turn overrides, reasoning-effort propagation, settings migration, atomic dataset
persistence, dataset Rubric schemas/versioning/stale-draft protection, Curator Rubric inheritance,
Case deletion and immutable run snapshots, fixed grading contracts, multi-runtime
parallel queues, CodeBuddy ACP configuration, runtime attribution, shutdown cleanup, and trace
provenance.

## Troubleshooting

### CodeBuddy appears in Terminal but not from Finder

Older Rolling Skill builds probed an env-based CodeBuddy launcher with Finder's minimal `PATH`, so
`/usr/bin/env node` failed even though Terminal discovery worked. Rebuild the current app; its
probe prepends CodeBuddy's executable directory. Use **Settings → Runtime… → Rescan** after replacing
an older packaged app.

### DeepSeek Harness rejects a reasoning-effort value

Reasoning effort support belongs to the selected model, not to the provider as a whole. Rolling
Skill reads `reasoningEfforts` and `defaultReasoningEffort` from the DeepSeek Harness model catalog.
If the selected model reports an empty effort list and a `null` default (as
`wetv-glm/glm-5.3` currently does), leave effort unset. Sending `low`, `medium`, or another value to
such a model is a runtime compatibility error rather than an authentication failure.

### Codex originator compatibility mode

Codex app-server copies `initialize.params.clientInfo.name` into the `originator` header of model
requests. Some enterprise Codex endpoints only accept a registered list of clients and reject any
other value before model execution.

This error is not an authentication, model, or reasoning-effort failure. The current development
build temporarily uses `codex_exec` as its app-server originator so it can work with an internal
gateway that already permits the local Codex CLI. The title and product UI remain Rolling Skill.
Restore the originator to `rolling-skill` and register that client identity before distributing a
production build.
