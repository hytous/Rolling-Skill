# Tool-Registered Skill Installation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** Make Runtime Agents register Skill installation and optimization results through a scoped tool, remove both Runtime-directory marker files, and replace the truncated installer conversation with a compact installation detail view.

**Architecture:** Keep Runtime Agents responsible for path discovery and filesystem mutation, but bind one short-lived control capability to each installation Job. Codex uses a dynamic tool, CodeBuddy uses a one-tool MCP server, and DSH uses the same scoped control method through the bundled tool executable when a typed session tool is unavailable. The App validates tool evidence against the frozen Job, commits it to the atomic installation store, and treats final assistant prose as display-only.

**Tech Stack:** Electron 43, Node.js CommonJS, Zod 4, Codex app-server dynamic tools, CodeBuddy ACP MCP servers, DSH Host/CLI transport, node:test, vanilla JavaScript renderer, CSS.

---

## File map

- Modify desktop/rolling-skill/src/skill-installation-protocol.cjs: marker-free frozen requests, prompts, and registration validation.
- Modify desktop/rolling-skill/src/managed-skill-snapshot.cjs and managed-skill-git.cjs: include all real files in digests.
- Modify desktop/rolling-skill/src/control-plane/contracts.cjs: private installer registration contract.
- Create desktop/rolling-skill/src/skill-installation-tool-transport.cjs: provider transport selection.
- Modify desktop/rolling-skill/tools/rolling-skill-tool.mjs: one-tool installer MCP entry point.
- Modify desktop/rolling-skill/src/skill-installation-store.cjs: accepted registration journal.
- Modify desktop/rolling-skill/src/skill-installation-manager.cjs: capability lifecycle and tool-driven completion.
- Modify desktop/rolling-skill/src/main.cjs: inject control dependencies and bundled tool path.
- Modify desktop/rolling-skill/src/optimization/optimization-runner.cjs and optimization-control-service.cjs: digest-based recovery.
- Modify desktop/rolling-skill/renderer/renderer.js and styles.css: compact detail and collapsed diagnostics.
- Update focused tests, smoke coverage, and desktop/rolling-skill/README.md.

### Task 1: Marker-free registration evidence protocol

**Files:**
- Modify: desktop/rolling-skill/test/skill-installation-protocol.test.cjs
- Modify: desktop/rolling-skill/test/skill-experiment-installation.test.cjs
- Modify: desktop/rolling-skill/src/skill-installation-protocol.cjs

- [ ] **Step 1: Replace final-text tests with registration tests**

Add direct tests for validateSkillInstallationRegistration:

~~~js
const registered = validateSkillInstallationRegistration({
    status: "succeeded",
    operation: "install",
    classificationBefore: "unmanaged",
    destination: "/runtime/skills/billing",
    actualDigest: request.source.expectedDigest,
    beforeDigest: `sha256:${"c".repeat(64)}`,
    mutationPerformed: true,
    runtimeDiscovered: true,
    warnings: [],
    error: null,
}, request)
assert.equal(registered.trusted, true)
assert.equal(Object.hasOwn(registered.result, "markerWritten"), false)
~~~

Cover relative destinations, wrong digests, operation mismatch, failure registration, absent inspection, Candidate install, restore, remove, and recovery inspection. Assert prompts contain rolling_skill_installations_register, contain no result sentinels, and mention neither retired marker filename.

- [ ] **Step 2: Run RED**

Run:

~~~bash
node --test test/skill-installation-protocol.test.cjs test/skill-experiment-installation.test.cjs
~~~

Expected: validation export is missing and prompt assertions fail.

- [ ] **Step 3: Implement marker-free validation**

Remove marker schemas, marker request fields, and marker result fields. Normalize evidence into the existing parsedResult-compatible shape:

~~~js
return deepFreeze({
    schema: INSTALL_RESULT_SCHEMA,
    purpose: request.purpose,
    status,
    operation,
    classificationBefore,
    destination,
    source: {...request.source},
    result: {actualDigest, beforeDigest, mutationPerformed, runtimeDiscovered},
    warnings,
    error,
    verification,
    trusted: status === "succeeded" && verification !== "none",
})
~~~

Build prompts around a required terminal tool call. Accept an injected CLI instruction for DSH fallback and state that final prose is display-only.

- [ ] **Step 4: Run GREEN and commit**

Run the Step 2 command, then:

~~~bash
git add desktop/rolling-skill/src/skill-installation-protocol.cjs desktop/rolling-skill/test/skill-installation-protocol.test.cjs desktop/rolling-skill/test/skill-experiment-installation.test.cjs
git commit -m "refactor: validate marker-free installation reports"
~~~

### Task 2: Include all Skill files in digests

**Files:**
- Modify: desktop/rolling-skill/test/managed-skill-snapshot.test.cjs
- Modify: desktop/rolling-skill/test/managed-skill-git.test.cjs
- Modify: desktop/rolling-skill/src/managed-skill-snapshot.cjs
- Modify: desktop/rolling-skill/src/managed-skill-git.cjs

- [ ] **Step 1: Write RED tests**

Adding either retired filename must change the digest and appear in the file inventory:

~~~js
const before = snapshotManagedSkill(root)
writeFileSync(join(root, ".rolling-skill-managed.json"), "legacy\n")
const after = snapshotManagedSkill(root)
assert.notEqual(after.contentDigest, before.contentDigest)
assert.equal(after.files.some((entry) => entry.path === ".rolling-skill-managed.json"), true)
~~~

- [ ] **Step 2: Run RED**

~~~bash
node --test test/managed-skill-snapshot.test.cjs test/managed-skill-git.test.cjs
~~~

Expected: the ordinary marker is still excluded.

- [ ] **Step 3: Delete marker exclusions, run GREEN, and commit**

Do not delete existing user files. Run the Step 2 command, then:

~~~bash
git add desktop/rolling-skill/src/managed-skill-snapshot.cjs desktop/rolling-skill/src/managed-skill-git.cjs desktop/rolling-skill/test/managed-skill-snapshot.test.cjs desktop/rolling-skill/test/managed-skill-git.test.cjs
git commit -m "fix: include legacy marker files in skill digests"
~~~

### Task 3: Private scoped registration Tool transport

**Files:**
- Modify: desktop/rolling-skill/test/control-plane-contracts.test.cjs
- Create: desktop/rolling-skill/test/skill-installation-tool-transport.test.cjs
- Modify: desktop/rolling-skill/test/external-tool.test.cjs
- Modify: desktop/rolling-skill/src/control-plane/contracts.cjs
- Create: desktop/rolling-skill/src/skill-installation-tool-transport.cjs
- Modify: desktop/rolling-skill/tools/rolling-skill-tool.mjs
- Modify: desktop/rolling-skill/scripts/build-external-tool.mjs

- [ ] **Step 1: Write contract and transport RED tests**

The strict method input contains evidence but no Runtime/Skill/version identity:

~~~js
assert.deepEqual(INSTALLATION_AGENT_CONTROL_METHODS, ["installations.register"])
assert.equal(OPERATOR_CONTROL_METHODS.includes("installations.register"), false)
assert.deepEqual(parseControlInput("installations.register", validEvidence), validEvidence)
assert.throws(() => parseControlInput("installations.register", {
    ...validEvidence,
    runtimeId: "agent-must-not-set-this",
}))
~~~

Test Codex selects codex-dynamic, CodeBuddy selects acp-mcp, and DSH selects cli. Assert only rolling_skill_installations_register is exposed and credentials never appear in prompts or command arguments.

- [ ] **Step 2: Run RED**

~~~bash
node --test test/control-plane-contracts.test.cjs test/skill-installation-tool-transport.test.cjs test/external-tool.test.cjs
~~~

Expected: missing method list, transport module, and external MCP command.

- [ ] **Step 3: Add the strict private contract**

Add installations.register with action installations.register and input:

~~~js
const installationRegistrationInput = z.object({
    status: z.enum(["succeeded", "failed", "cancelled", "unverified", "needs_recovery"]),
    operation: z.enum(["install", "inspect", "experiment_install", "experiment_restore", "experiment_remove", "experiment_inspect"]),
    classificationBefore: z.enum(["absent", "managed-clean", "managed-drifted", "unmanaged", "conflict", "uncertain"]),
    destination: z.string().max(4096).nullable(),
    actualDigest: z.string().max(80).nullable(),
    beforeDigest: z.string().max(80).nullable(),
    mutationPerformed: z.boolean(),
    runtimeDiscovered: z.boolean().nullable(),
    warnings: z.array(z.string().max(4096)).max(100),
    error: z.object({code: id, message: z.string().min(1).max(8192)}).strict().nullable(),
}).strict()
~~~

Export INSTALLATION_AGENT_CONTROL_METHODS. Keep the method available to a registered Runtime executor but exclude it from general Operator tool catalogs.

- [ ] **Step 4: Implement transport and external MCP**

Model SkillInstallationToolTransport after OperatorToolTransport. Generate one dynamic function, one MCP server entry invoking installation-mcp, or the inherited-credential CLI instruction:

~~~text
"/absolute/rolling-skill-tool" control installations.register --params-json -
~~~

Add createInstallationMcpServer(credentials) to rolling-skill-tool.mjs. It exposes only rolling_skill_installations_register and delegates to invokeControl.

- [ ] **Step 5: Run GREEN, build, and commit**

~~~bash
node --test test/control-plane-contracts.test.cjs test/skill-installation-tool-transport.test.cjs test/external-tool.test.cjs
npm run build:tool
git add desktop/rolling-skill/src/control-plane/contracts.cjs desktop/rolling-skill/src/skill-installation-tool-transport.cjs desktop/rolling-skill/tools/rolling-skill-tool.mjs desktop/rolling-skill/scripts/build-external-tool.mjs desktop/rolling-skill/test/control-plane-contracts.test.cjs desktop/rolling-skill/test/skill-installation-tool-transport.test.cjs desktop/rolling-skill/test/external-tool.test.cjs
git commit -m "feat: add scoped installation registration tool"
~~~

### Task 4: Complete installation Jobs from Tool events

**Files:**
- Modify: desktop/rolling-skill/test/skill-installation-store.test.cjs
- Modify: desktop/rolling-skill/test/skill-installation-manager.test.cjs
- Modify: desktop/rolling-skill/test/control-plane.test.cjs
- Modify: desktop/rolling-skill/src/skill-installation-store.cjs
- Modify: desktop/rolling-skill/src/skill-installation-manager.cjs
- Modify: desktop/rolling-skill/src/main.cjs

- [ ] **Step 1: Write store and manager RED tests**

Replace resultText fixtures with fake Runtime tool calls:

~~~js
const accepted = await client.options.requestTool({
    threadId: turn.threadId,
    turnId: turn.turnId,
    callId: "register-1",
    method: "installations.register",
    params: successfulEvidence(job.request),
})
assert.equal(accepted.accepted, true)
client.complete(turn, "Installation complete")
~~~

Cover forged legacy sentinel prose, no tool call, invalid then corrected calls, idempotent identical calls, conflicting calls, authority revocation, executor cleanup, secret redaction, restart pending evidence, and trusted matrix updates.

- [ ] **Step 2: Run RED**

~~~bash
node --test test/skill-installation-store.test.cjs test/skill-installation-manager.test.cjs test/control-plane.test.cjs
~~~

Expected: final text still controls completion and no Job authority exists.

- [ ] **Step 3: Add atomic registration persistence**

Jobs gain registration state pending or accepted, an invocation fingerprint, normalized evidence, and timestamps. Add:

~~~js
acceptRegistration(jobId, {invocationFingerprint, parsedResult})
~~~

Identical repeats return the accepted record; conflicting repeats fail. A successful ordinary registration appends one trusted installation. completeJob("succeeded") requires accepted registration.

- [ ] **Step 4: Add capability and executor lifecycle**

Before Runtime startup, issue a short-lived capability:

~~~js
const authority = await capabilities.issue({
    sessionId: "installation-" + randomUUID(),
    actions: ["installations.register"],
    scopes: {
        skillIds: [job.request.source.skillId],
        runtimeIds: [job.runtime.runtimeId],
        repositoryIds: [job.request.source.repositoryId],
    },
    expiresInMs: timeoutMs + 60_000,
})
~~~

Register one enabled ControlPlane executor that accepts only installations.register, validates against the frozen Job, persists idempotently, and returns a bounded acknowledgement. Bind dynamic tools/MCP servers/child environment to the Runtime client and thread.

- [ ] **Step 5: Make final prose non-authoritative**

After turn completion, read persisted registration:

~~~js
const current = this.store.getJob(jobId)
if (current.registration?.state !== "accepted") {
    return this.finish(jobId, "unverified", {
        rawResult: output.response,
        error: {
            code: "INSTALLATION_REGISTRATION_MISSING",
            message: "安装 Agent 未登记执行结果。",
        },
    })
}
return this.finish(jobId, current.parsedResult.status, {
    parsedResult: current.parsedResult,
    rawResult: output.response,
    error: current.parsedResult.error,
})
~~~

Delete final-response parsing calls. Always unregister the executor and revoke the capability in finally.

- [ ] **Step 6: Run GREEN and commit**

~~~bash
node --test test/skill-installation-store.test.cjs test/skill-installation-manager.test.cjs test/control-plane.test.cjs
git add desktop/rolling-skill/src/skill-installation-store.cjs desktop/rolling-skill/src/skill-installation-manager.cjs desktop/rolling-skill/src/main.cjs desktop/rolling-skill/test/skill-installation-store.test.cjs desktop/rolling-skill/test/skill-installation-manager.test.cjs desktop/rolling-skill/test/control-plane.test.cjs
git commit -m "feat: register installation results through job tools"
~~~

### Task 5: Remove experiment-marker recovery state

**Files:**
- Modify: desktop/rolling-skill/test/optimization-runner.test.cjs
- Modify: desktop/rolling-skill/test/optimization-control-service.test.cjs
- Modify: desktop/rolling-skill/src/optimization/optimization-runner.cjs
- Modify: desktop/rolling-skill/src/optimization/optimization-control-service.cjs
- Modify: desktop/rolling-skill/src/optimization/optimization-store.cjs only if schema validation references markers.

- [ ] **Step 1: Write marker-free recovery RED tests**

Persist only destination, lastVerifiedDigest, Candidate version identity, Epoch, operation, and installation Job ID. Assert public reports contain no lastVerifiedMarker and recovery still distinguishes Candidate, baseline, and absent states.

- [ ] **Step 2: Run RED**

~~~bash
node --test test/optimization-runner.test.cjs test/optimization-control-service.test.cjs
~~~

Expected: current recovery reads markerAfter and lastVerifiedMarker.

- [ ] **Step 3: Replace marker reads with journal evidence**

~~~js
return {
    runtimeId,
    status,
    installationJobId,
    destination: job.parsedResult?.destination ?? null,
    lastVerifiedDigest: job.parsedResult?.result?.actualDigest ?? null,
    operation: job.operation,
}
~~~

Recovery inspection compares live digest with frozen Candidate and baseline digests and never searches for an experiment marker.

- [ ] **Step 4: Run GREEN and commit**

~~~bash
node --test test/optimization-runner.test.cjs test/optimization-control-service.test.cjs
git add desktop/rolling-skill/src/optimization desktop/rolling-skill/test/optimization-runner.test.cjs desktop/rolling-skill/test/optimization-control-service.test.cjs
git commit -m "refactor: recover optimization installs from journal evidence"
~~~

### Task 6: Compact installation detail UI

**Files:**
- Modify: desktop/rolling-skill/test/local-first-surface.test.cjs
- Create: desktop/rolling-skill/test/renderer-installation-detail.test.cjs
- Modify: desktop/rolling-skill/renderer/renderer.js
- Modify: desktop/rolling-skill/renderer/styles.css
- Modify: desktop/rolling-skill/renderer/index.html if static action markup changes.
- Modify: desktop/rolling-skill/scripts/renderer-smoke.cjs and renderer-smoke-preload.cjs as needed.

- [ ] **Step 1: Write renderer RED tests**

Assert the UI contains 安装详情 and 完整执行记录, removes 追问安装 Agent and its composer, localizes known error codes, and hides raw protocol/commands by default. Expanding details must expose bounded diagnostic entries.

- [ ] **Step 2: Run RED**

~~~bash
node --test test/local-first-surface.test.cjs test/renderer-installation-detail.test.cjs
~~~

Expected: old conversation label/composer and flat timeline remain.

- [ ] **Step 3: Render compact details**

Use a native details element:

~~~js
const diagnostics = document.createElement("details")
diagnostics.className = "managed-install-diagnostics"
diagnostics.append(
    node("summary", "", t("completeExecutionLog")),
    renderInstallationDiagnostics(job.timeline),
)
~~~

Default content is Runtime/version, destination, preparing/installing/verifying/registering steps, final verification, localized error, and stop/retry/recheck actions. Known codes TARGET_NOT_INSTALLED, OVERWRITE_CONFIRMATION_REQUIRED, INSTALLATION_REGISTRATION_MISSING, and INSTALLATION_RESULT_INVALID receive concise product copy. Unknown raw errors appear only under diagnostics.

- [ ] **Step 4: Fix layout**

Remove max-height: 310px from the flat timeline. Use:

~~~css
.managed-install-diagnostics-body {
    max-height: min(52vh, 640px);
    overflow: auto;
    overflow-wrap: anywhere;
}
~~~

Commands become collapsed one-line summaries. Remove the free-form follow-up composer and Renderer send path.

- [ ] **Step 5: Run GREEN, smoke, and commit**

~~~bash
node --test test/local-first-surface.test.cjs test/renderer-installation-detail.test.cjs
npm run smoke:renderer
git add desktop/rolling-skill/renderer desktop/rolling-skill/test/local-first-surface.test.cjs desktop/rolling-skill/test/renderer-installation-detail.test.cjs desktop/rolling-skill/scripts/renderer-smoke.cjs desktop/rolling-skill/scripts/renderer-smoke-preload.cjs
git commit -m "fix: present compact skill installation details"
~~~

### Task 7: Regression, documentation, packaging, and real UI verification

**Files:**
- Modify: desktop/rolling-skill/README.md
- Modify: packages/rolling-skill-dsh source/tests only if the repository's shared-source build requires synchronization.

- [ ] **Step 1: Update documentation**

Describe scoped tool registration, central journal, provider transports, marker-free Runtime directories, unverified semantics, and the compact detail surface.

- [ ] **Step 2: Scan for retired active behavior**

~~~bash
rg -n "rolling-skill-managed|rolling-skill-experiment|INSTALL_RESULT_SENTINEL|markerWritten|markerBefore|markerAfter" desktop/rolling-skill/src desktop/rolling-skill/renderer desktop/rolling-skill/README.md
~~~

Expected: no active implementation/documentation references. Any migration-only compatibility code must have an explicit test.

- [ ] **Step 3: Run full verification**

~~~bash
npm test
npm run smoke:renderer
npm run build:tool
git diff --check
~~~

Expected: every command exits 0.

- [ ] **Step 4: Build and reinstall**

Run the existing signed local packaging/install workflow. Do not add, modify, delete, or stage any rolling-skill-dsh-plugin-*.tgz archive. Verify /Applications/Rolling Skill.app contains the new tool and launches.

- [ ] **Step 5: Test from the installed App**

Open Skill 管理 → Runtime 安装. Verify compact details, expandable complete logs, long-command scrolling, a real tool-registered installation, marker-free recheck, and absence of both marker files in the target.

- [ ] **Step 6: Commit documentation and push**

~~~bash
git add desktop/rolling-skill/README.md
git commit -m "docs: describe tool-registered skill installation"
git status --short
git push origin main
~~~

Expected: only the known untracked tgz archives remain locally and remote main advances to the verified implementation.
