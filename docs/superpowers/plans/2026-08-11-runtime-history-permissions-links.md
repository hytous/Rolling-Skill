# Runtime History, Permissions, and Message Links Implementation Plan

**Goal:** Deliver a Finder-consistent multi-runtime desktop app with native Codex archive history,
explicit local access, a resilient composer, visible workspace identity, and safe clickable links.

## Task 1: Lock in diagnosed behavior with failing tests

- Add a Finder-PATH CodeBuddy compatibility-probe regression.
- Add Codex client contract tests for active/archived listing, archive/unarchive, and configurable
  thread start/resume sandbox values.
- Add main/preload and renderer surface tests for archive IPC, access preferences, safe link IPC,
  workspace visibility, and pinned composer constraints.
- Run the focused tests and confirm they fail for the intended missing behavior.

## Task 2: Repair provider discovery

- Share CodeBuddy's executable-local PATH behavior between compatibility probing and runtime start.
- Confirm CodeBuddy appears when the packaged app is launched with a Finder-like environment.

## Task 3: Add native Codex archive history

- Extend the Codex app-server adapter with archived listing, archive, and unarchive calls.
- Add capability-gated IPC/preload methods.
- Add Current/Archived sidebar state, hover actions, read-only archived threads, restore behavior,
  notification refresh, and an honest unsupported state for CodeBuddy.

## Task 4: Add runtime local-access settings and clarify workspace ownership

- Persist a two-value local-access preference and default new sessions to full local access.
- Pass the resolved sandbox and approval policy to thread start/resume through the selected client.
- Show the exact current workspace in Settings and the chat sidebar so Codex's exact-cwd history
  boundary is visible.

## Task 5: Harden chat layout and render safe links

- Constrain every grid/flex parent so only the message scroller grows.
- Cap textarea growth relative to the viewport while keeping the composer pinned.
- Parse Markdown links, bare web URLs, and absolute local paths into safe DOM nodes.
- Route external and local link activation through validated main-process handlers.

## Task 6: Verify rendered behavior

- Run focused tests, JavaScript syntax checks, and the complete desktop test suite.
- Launch an Electron probe at minimum height, grow the input, and verify composer geometry.
- Launch with Finder-like PATH and verify CodeBuddy appears in the Runtime chooser.
- Exercise Codex archive, archived listing, restore, workspace display, access-policy trace values,
  external links, and local file links.

## Task 7: Build and deliver

- Update the desktop README with history, runtime discovery, workspace, permissions, and startup
  behavior.
- Build and sign `Rolling Skill.app`, inspect its signature and packaged archive hash, then launch
  the final artifact.
- Append the project record entry, commit the implementation, and push the branch to the
  `rolling-skill` remote.
