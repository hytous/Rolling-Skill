# Rolling Skill Desktop

Rolling Skill is a local-first macOS client for running and evaluating Codex Skill tasks. The
application opens directly into a task interface and starts its bundled Codex app-server process
over JSONL stdio. The desktop client does not need Docker, Compose, Postgres, Redis, Traefik, an
Agenta service, a browser session, or a separately installed Codex CLI.

## Open the app

Double-click `Rolling Skill.app` at the repository root. On the first launch, macOS may require a
Control-click followed by **Open** because the local build uses an ad-hoc signature.

There is no application login screen. Starting the runtime, selecting a workspace, and browsing
existing local tasks work without provider authentication. If the selected model provider has no
usable credentials, only the model turn reports that error; the rest of the desktop client remains
available.

Use the sidebar workspace control or **Runtime → Choose Workspace…** to scope the task list to a
folder. Tasks from other working directories are not shown.

## Build the double-clickable app

From the repository root:

```bash
bash desktop/rolling-skill/scripts/build-macos-app.sh
```

The script installs the pinned dependencies, runs the unit and app-server integration tests,
packages the Apple Silicon runtime, verifies the bundled Codex executable, applies an ad-hoc
signature, and writes `Rolling Skill.app` at the repository root. It targets macOS 13 or newer.

## Develop

```bash
cd desktop/rolling-skill
npm ci
npm test
npm start
```

Development uses the pinned native runtime installed by `@openai/codex`. The packaged application
copies the complete arm64 runtime directory, including its bundled search and shell resources, to
`Contents/Resources/codex-runtime/`.

## Local evaluation workflow

1. Start a new task or open an existing workspace-scoped task.
2. Inspect the streamed conversation and the raw local trace.
3. Select **Save case** beside an assistant message.
4. Choose or create a dataset, classify it as `goodcase` or `badcase`, review the question and
   answer, and save it.

Automatic capture is disabled by default. Saving a case is always an explicit action. The case row
includes thread, turn, item, and trace provenance.

Local state is stored under `~/Library/Application Support/Rolling Skill/`:

| Path | Contents |
| --- | --- |
| `evaluation-store.json` | Dataset definitions, goodcases, badcases, and capture settings |
| `preferences.json` | Selected workspace |
| `traces/*.jsonl` | Append-only inbound and outbound app-server messages |

## Runtime and security model

- Electron starts a fixed bundled `codex app-server` binary with `shell: false`.
- Threads default to `workspace-write` and `approvalPolicy: never`.
- The renderer has Node integration disabled, context isolation enabled, and Chromium sandboxing
  enabled.
- The preload bridge exposes only workspace, thread, turn, dataset, and trace operations; it does
  not expose shell or filesystem primitives.
- Packaged renderer files are the only internal navigation target. External HTTPS links are handed
  to macOS and all other navigation is blocked.
- Dataset writes are atomic and local trace files are append-only with owner-only permissions.

The wider Agenta repository still contains server deployment options. Those are independent
capabilities and are not inspected, started, or required by `Rolling Skill.app`.

## Tests

`npm test` covers protocol framing and request correlation, bundled binary selection, a real
app-server initialize/list smoke, Git workspace discovery, local-first surface invariants, atomic
dataset persistence, case classification, and trace provenance.
