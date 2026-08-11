# Runtime History, Permissions, and Message Links Design

## Goal

Make the packaged Rolling Skill desktop app behave consistently when launched from Finder,
keep chat usable in short windows, expose native Codex history controls, let the user choose the
runtime's local-access policy, and render useful links without weakening Electron security.

## Diagnosed behavior

- Finder launches the app with `/usr/bin:/bin:/usr/sbin:/sbin`. The discovered CodeBuddy wrapper
  uses `#!/usr/bin/env node`, so its compatibility probe fails unless the wrapper directory is
  prepended to `PATH`. Runtime startup already does this; discovery must use the same environment.
- Rolling Skill starts persistent Codex threads, but Codex `thread/list` applies an exact `cwd`
  filter. A thread created for `/Users/wangbaoheng/Downloads/billing-cli` will not appear under a Codex Desktop view
  filtered to `/Users/wangbaoheng/Downloads/billing-cli/agenta`.
- The Codex adapter currently hardcodes `sandbox: "workspace-write"` and
  `approvalPolicy: "never"`. That can prevent a CLI from reading credentials outside the selected
  workspace while also preventing it from asking for an exception.
- The renderer currently emits message bodies as text nodes, so URLs, Markdown links, and local
  file references are not interactive.

## Runtime discovery

Every provider owns its compatibility environment. The CodeBuddy provider prepends the selected
executable's directory to `PATH` for both `--version` and `--help`, matching the ACP client. A
Finder-like regression test must prove that a sibling `node` makes an env-based CodeBuddy wrapper
discoverable. The runtime does not need to be running before discovery.

## Conversation history and archive

Conversation history remains runtime-native. For Codex, Rolling Skill lists active or archived
threads by passing `archived` to `thread/list`, archives with `thread/archive`, restores with
`thread/unarchive`, and opens an archived thread read-only. The sidebar gets a compact
`Current / Archived` switch. Active cards reveal an Archive action on hover; archived cards reveal
Restore. A running thread cannot be archived until its turn is stopped.

CodeBuddy does not expose durable archive/list semantics in its current ACP adapter. Rolling Skill
must show that archive history is unsupported for that runtime instead of implementing a local
shadow archive that would diverge from the provider.

## Workspace identity

The current workspace path is shown explicitly near the thread list and in Settings. Thread
listing and thread creation use the same exact path. Changing it restarts the runtime view. This
does not copy threads between workspaces; it makes the Codex storage boundary visible so the user
can choose `/Users/wangbaoheng/Downloads/billing-cli/agenta` when they expect the thread in that Codex workspace.

## Local access policy

Settings exposes a capability-gated `Local access` choice persisted in the app preferences:

- `Full local access` maps to `sandbox: "danger-full-access"` and
  `approvalPolicy: "never"`. This is the default for new Rolling Skill sessions because the user
  explicitly needs local CLI credential access.
- `Workspace only` maps to `sandbox: "workspace-write"` and
  `approvalPolicy: "never"`.

The choice is passed to both `thread/start` and `thread/resume`, including isolated evaluation
clients. Curator threads remain explicitly read-only because they summarize frozen evidence rather
than execute the source workflow. The setting controls Codex's own OS sandbox; Rolling Skill does
not add a container or a second sandbox. Settings explains that full access lets the selected local
runtime read files and credentials available to the user account.

CodeBuddy ACP does not expose an equivalent workspace-only sandbox. Its descriptor therefore does
not claim the sandbox-policy capability; Settings disables the selector and labels access as
runtime-managed instead of implying that the Codex policy applies to CodeBuddy.

## Composer layout

The chat workbench and all intermediate flex/grid containers receive explicit `min-height: 0`.
The conversation is the only vertically growing region, while the composer remains in the final
grid row. The textarea auto-grows only up to the smaller of 220px and a viewport-relative cap;
after that it scrolls internally. Tests cover minimum window height, a visible error banner, and
multi-line input.

## Safe link rendering

Messages are tokenized without `innerHTML` into text and anchor nodes. Supported references are:

- Markdown links such as `[OpenAI](https://openai.com)`;
- bare `http://` and `https://` URLs;
- absolute local paths, optionally with a `:line` suffix, including Codex-style Markdown file
  links.

External links are opened through a narrow preload IPC handler using `shell.openExternal` and only
allow `http:` or `https:` URLs. Local file links require an absolute path; the main process checks
that it exists and reveals it in Finder (the line number remains display metadata). This avoids
executing `.command`, application, or other executable targets from message content. Whitespace
and unrecognized text remain text nodes, preventing HTML injection.

## Failure handling and observability

Archive, restore, permission, path-open, and external-open failures return structured errors to
the renderer and surface in the existing error banner. Runtime notifications refresh the relevant
history view. Existing JSONL traces continue recording the exact app-server requests, including
the selected sandbox and workspace, so behavior remains auditable.

## Non-goals

- Emulating Codex archive behavior for CodeBuddy before CodeBuddy exposes durable thread history.
- Making Rolling Skill-created threads appear under a different Codex `cwd` automatically.
- Registering Rolling Skill as a new enterprise Codex originator during this development phase.
- Rendering arbitrary Markdown or allowing arbitrary Electron navigation.
