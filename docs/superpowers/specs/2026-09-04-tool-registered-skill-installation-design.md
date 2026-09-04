# Tool-Registered Skill Installation Design

## Goal

Replace final-response parsing and Skill-directory marker files with an explicit, Job-scoped registration tool. The Runtime Agent remains responsible for discovering the real target path, installing the frozen Skill, and verifying the result. Rolling Skill owns the installation journal, validates registrations, and presents a compact user-facing installation detail surface.

This design removes both `.rolling-skill-managed.json` and `.rolling-skill-experiment.json` from Runtime Skill directories.

## Current Problems

The current installer asks the Runtime Agent to write a marker into the target Skill directory and finish with a sentinel-wrapped JSON block. Rolling Skill parses that block from the final assistant response. This causes three user-visible failures:

- formatting, truncation, or a missing sentinel turns a completed installation into `unverified`;
- an existing Skill without a Rolling Skill marker is treated as unmanaged even when the user intentionally selected that exact Skill and Runtime;
- the installation panel exposes the raw Agent conversation, shell commands, protocol JSON, and English protocol errors inside a 310-pixel scroll area.

## Chosen Architecture

### Job-scoped registration tool

Each installation or optimization mutation Job receives one scoped reporting capability. After the Agent completes filesystem work and post-install verification, it must call:

```text
rolling_skill_register_installation
```

The call accepts only evidence discovered by the Agent:

- operation and resulting status;
- absolute destination;
- pre-operation classification;
- before and after content digests where applicable;
- whether the Runtime inventory discovered the installed Skill;
- whether a filesystem mutation occurred;
- warnings and structured failure information.

The Agent does not submit `runtimeId`, `repositoryId`, `skillId`, `versionId`, commit, Epoch, or Run identity. Those values come from the capability's immutable Job scope. This prevents a result from being registered against another Runtime, Skill, version, or optimization Run.

The tool handler validates the evidence against the frozen request. A successful ordinary installation must report the frozen expected digest and an absolute destination. A successful Candidate installation, restoration, or removal must match the frozen Candidate/baseline digests and expected operation. Invalid evidence returns a tool error and does not update trusted state, allowing the Agent to correct the call while the Turn is still active.

The registration operation is idempotent. Repeating the same valid call returns the existing registration; a conflicting second call is rejected.

The final assistant response is display-only. Rolling Skill never derives installation state from response text. A Turn that terminates without a valid registration becomes `unverified`.

### Runtime transports

The semantic tool contract is provider-neutral while transport remains provider-specific:

- Codex receives a dynamic function tool on its installer thread.
- CodeBuddy receives the same function through a Job-scoped MCP server.
- DSH mounts the Job-scoped MCP server through `@deepseek-ai/dsh-mcp-client` using a mode-0600 ephemeral `--patch`. The file is a DSH loader patch using `insert:`, not a plain Cordis plugin list. Its descriptor name is `rolling-skill-install`, keeping the final DSH tool name within the Host's 64-character limit so the prompt and advertised tool name remain identical. The patch contains only `process.env` references, never credential values, and is removed on Host exit, startup failure, or client stop. If native MCP mounting is unavailable, preflight fails explicitly; DSH does not fall back to Bash because its safety policy strips control credentials from shell tools.

Every transport routes to the same main-process validator and installation journal. Capability credentials are process-local, short-lived, scoped to one Job, and never included in the prompt, command-line arguments, persisted traces, or user-visible logs. The installer protocol also limits cleanup to temporary paths created by the current Job; pre-existing temporary paths are outside its mutation scope.

### Central installation journal

`skill-installations.json` becomes the only ownership and lifecycle record. It stores:

- pending intent before a Runtime Turn begins;
- immutable Runtime, Skill, version, commit, digest, Run, and Epoch identity;
- the Agent-reported destination and verified before/after evidence;
- the accepted tool-call identity and completion time;
- trusted ordinary installations;
- active Candidate state and restoration/removal results.

No management or experiment marker is written into the target Skill directory. Content digests therefore include every real Skill file and no longer need marker exclusions.

Before an update or optimization step, the Agent receives the prior trusted destination and digest from the journal, rediscovers the Runtime target, and compares the live target digest to the journal. A mismatch is drift. A missing or moved target is reconciled through an inspect Job. The journal records intent before mutation, so a process crash leaves a recoverable pending Job; startup schedules or exposes a read-only reconciliation rather than guessing success.

For an initially unregistered existing target, the explicit user installation action authorizes replacing only the exact discovered Skill target after the Agent verifies its identity and path boundary. Broad paths, symlinks, ambiguous identity, or a target outside the Runtime's Skill boundary still fail closed. Automatic optimization may mutate only a target already reconciled to the selected Released baseline or a proven absent target.

## State Flow

```text
queued
  -> running (pending intent persisted)
  -> registering (valid tool call received)
  -> succeeded | failed | cancelled | unverified | needs_recovery
```

- `succeeded`: the tool call passed frozen-request validation and the journal committed it.
- `failed`: the Agent called the tool with a structured terminal failure, or the Runtime failed before mutation.
- `cancelled`: the user stopped the Job and reconciliation proved a safe terminal state.
- `unverified`: the Turn ended without an accepted tool call or evidence was insufficient.
- `needs_recovery`: a mutation may have happened but the final state cannot be reconciled automatically.

Installation progress is driven by Runtime events and the explicit tool call, not by searching prose or waiting for a particular sentence.

## Installation Detail UI

The selected installation Job is presented as **安装详情**, not **安装 Agent 会话**.

The default view contains only:

- Runtime and Released version;
- destination;
- compact steps: preparing, installing, verifying, registering;
- final verification state;
- a localized, actionable error summary;
- retry, stop, or read-only recheck actions when applicable.

Agent prose, commands, tool activities, and transport diagnostics move into a collapsed **完整执行记录** section. When expanded, it has its own full-height scrolling surface, wraps long content safely, and renders commands as collapsible summaries. Registration payloads and capability data are never rendered as assistant messages.

The free-form **追问安装 Agent** composer is removed. Follow-up prose cannot repair state. Users instead choose **重试安装** or **重新检查**, each of which creates a typed Job with a fresh scoped registration tool.

Errors are mapped to Chinese product language. For example, the legacy message:

```text
The exact target does not match the expected source digest and has no matching management marker.
```

becomes:

```text
目标目录已有不同内容，本次只读检查未进行覆盖。
```

The detail view may show current and expected digest prefixes under diagnostics, but raw protocol JSON is not part of the normal user surface.

## Error Handling and Recovery

- Invalid registration arguments: return a typed tool error; keep the Job running so the Agent can correct it.
- Turn completes without registration: mark `unverified`; do not parse the final response.
- Runtime disconnect before mutation: mark `failed`.
- Runtime disconnect after a pending mutation: mark `needs_recovery` and offer read-only reconciliation.
- App restart with a pending Job: retain the pending journal entry and require reconciliation.
- Duplicate identical registration: return the prior accepted result.
- Conflicting duplicate registration: reject and retain the first accepted result.
- Digest drift after a trusted installation: retain history but do not treat the live target as the trusted version until reconciliation succeeds.

## Testing

Unit tests cover the tool schema, immutable Job scoping, idempotency, digest and operation validation, missing-tool completion, central journal persistence, crash recovery, drift classification, and removal of marker assumptions.

Provider tests cover Codex dynamic-tool dispatch, CodeBuddy Job-scoped MCP transport, and DSH native MCP mounting plus ephemeral-patch cleanup.

Manager tests prove that final response prose cannot create or change installation state and that ordinary and optimization Jobs complete only through accepted registration events.

Renderer tests cover the compact detail view, localized errors, collapsed complete log, long-line wrapping, absence of raw protocol output, and removal of the free-form installer composer.

Finally, the packaged App is installed and exercised from the user interface with at least one successful installation, one digest mismatch/recheck, and one failed registration case.
