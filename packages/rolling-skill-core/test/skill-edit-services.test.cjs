const assert = require("node:assert/strict")
const {mkdtempSync} = require("node:fs")
const {tmpdir} = require("node:os")
const {join} = require("node:path")
const {describe, it} = require("node:test")

const {SkillEditStore} = require("../../../desktop/rolling-skill/src/skill-edit-store.cjs")
const {createSkillEditServices} = require("../src/skill-edit-services.cjs")

function fixture() {
    const root = mkdtempSync(join(tmpdir(), "rolling-skill-edit-services-"))
    const store = new SkillEditStore(join(root, "skill-edits.json"))
    const calls = []
    let sequence = 0
    let operatorState = "idle"
    const workspaceManager = {
        workspacePath: (sessionId) => join(root, "workspaces", sessionId),
        async create({sessionId, skillName}) {
            calls.push(["workspace.create", sessionId, skillName])
            return {
                sessionId,
                workspacePath: join(root, "workspaces", sessionId),
                baselineCommit: "d".repeat(40),
                baselineDigest: `sha256:${"b".repeat(64)}`,
            }
        },
        async register() {},
        resolve: (sessionId) => join(root, "workspaces", sessionId),
        diff: async () => ({
            changed: true,
            truncated: false,
            currentSnapshotDigest: `sha256:${"e".repeat(64)}`,
            files: [{
                path: "SKILL.md",
                status: "modified",
                binary: false,
                additions: 2,
                deletions: 1,
                patch: "@@ -1 +1 @@\n-old\n+new\n",
                patchBytes: 25,
                truncated: false,
            }],
        }),
        validate: async () => ({skill: {name: "billing"}, snapshot: {digest: `sha256:${"e".repeat(64)}`}}),
        async cleanup(sessionId) { calls.push(["workspace.cleanup", sessionId]) },
    }
    const managedSkillManager = {
        readSkill: () => ({
            repository: {id: "repository-1"},
            skill: {id: "skill-1", repositoryId: "repository-1", name: "billing", skillRoot: "."},
            snapshot: {digest: `sha256:${"b".repeat(64)}`},
        }),
        candidateBase: async () => ({
            repositoryId: "repository-1",
            skillId: "skill-1",
            commit: "a".repeat(40),
            contentDigest: `sha256:${"b".repeat(64)}`,
            dirty: false,
        }),
        skillPath: () => join(root, "managed", "billing"),
        async applyEditedSkill(input) {
            calls.push(["apply", input])
            return {
                version: {id: "version-2", versionLabel: "1.0.1", state: "released"},
                commit: "c".repeat(40),
                contentDigest: `sha256:${"e".repeat(64)}`,
            }
        },
    }
    const operatorServices = {
        async operatorStart(input) {
            calls.push(["operator.start", input])
            return {
                session: {id: `operator-${++sequence}`, transcript: [
                    {kind: "message", role: "user", content: input.objective},
                    {kind: "message", role: "assistant", content: "I updated the draft."},
                ]},
                parentJob: {id: "job-1", status: "running"},
                state: operatorState,
            }
        },
        operatorGet({sessionId}) {
            return {
                session: {id: sessionId, transcript: [
                    {kind: "operator_session_configuration", workspaceDigest: "secret"},
                    {kind: "message", role: "user", content: "Improve it"},
                    {kind: "message", role: "assistant", content: "I updated the draft."},
                ]},
                parentJob: {id: "job-1", status: "running"},
                state: operatorState,
            }
        },
        async operatorSend(input) { calls.push(["operator.send", input]); operatorState = "active"; return {queued: false} },
        async operatorCancel(input) { calls.push(["operator.cancel", input]); operatorState = "stopped"; return {state: "stopped"} },
    }
    return {
        calls,
        setOperatorState(value) { operatorState = value },
        services: createSkillEditServices({
            store,
            workspaceManager,
            managedSkillManager,
            operatorServices,
            idFactory: () => `edit-${sequence + 1}`,
        }),
    }
}

describe("Rolling Skill Agent edit services", () => {
    it("starts, continues, diffs, applies and publishes a bounded edit session", async () => {
        const test = fixture()
        const started = await test.services.start({
            skillId: "skill-1",
            runtimeId: "codex:one",
            modelId: "gpt-5.6-sol",
            effort: "high",
            objective: "Improve trigger guidance",
        })

        assert.equal(started.skillId, "skill-1")
        assert.equal(started.state, "idle")
        assert.equal(started.messages.at(-1).content, "I updated the draft.")
        await test.services.send({sessionId: started.id, text: "Also add an example"})
        test.setOperatorState("idle")
        const ready = await test.services.get({sessionId: started.id})
        assert.equal((await test.services.diff({sessionId: started.id})).changed, true)
        const applied = await test.services.applyAndRelease({
            sessionId: started.id,
            expectedRevision: ready.revision,
        })

        assert.equal(applied.publishedVersionLabel, "1.0.1")
        assert.equal(applied.state, "published")
        assert.doesNotMatch(
            JSON.stringify(applied),
            /workspacePath|workspaceDigest|capability|executablePath|private\/workspaces/iu,
        )
        const operatorStart = test.calls.find(([kind]) => kind === "operator.start")[1]
        assert.deepEqual(operatorStart.managedSkillBinding, {
            repositoryId: "repository-1",
            skillId: "skill-1",
            skillEditSessionId: started.id,
        })
        assert.deepEqual(operatorStart.actions, ["skills.read"])
        assert.equal(test.calls.some(([kind]) => kind === "apply"), true)
        assert.equal(test.calls.some(([kind]) => kind === "workspace.cleanup"), true)
    })

    it("discards an idle session after stopping its Operator", async () => {
        const test = fixture()
        const started = await test.services.start({
            skillId: "skill-1",
            runtimeId: "codex:one",
            modelId: "gpt-5.6-sol",
            effort: "high",
            objective: "Try another edit",
        })

        const discarded = await test.services.discard({
            sessionId: started.id,
            expectedRevision: started.revision,
        })

        assert.equal(discarded.state, "discarded")
        assert.equal(test.calls.some(([kind]) => kind === "operator.cancel"), true)
        assert.equal((await test.services.list({skillId: "skill-1"})).sessions.length, 1)
    })

    it("rejects renderer-owned paths and applying while the Agent is active", async () => {
        const test = fixture()
        await assert.rejects(() => test.services.start({
            skillId: "skill-1",
            runtimeId: "codex:one",
            modelId: "gpt-5.6-sol",
            effort: "high",
            objective: "Improve it",
            workspacePath: "/attacker/path",
        }), /unsupported field/iu)
        test.setOperatorState("active")
        const started = await test.services.start({
            skillId: "skill-1",
            runtimeId: "codex:one",
            modelId: "gpt-5.6-sol",
            effort: "high",
            objective: "Improve it",
        })
        await assert.rejects(() => test.services.applyAndRelease({
            sessionId: started.id,
            expectedRevision: started.revision,
        }), /still running/iu)
    })
})
