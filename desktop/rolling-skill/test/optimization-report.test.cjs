"use strict"

const assert = require("node:assert/strict")
const {describe, it} = require("node:test")

const {
    generateOptimizationReport,
    persistOptimizationReport,
} = require("../src/optimization/optimization-report.cjs")

function digest(character) {
    return `sha256:${character.repeat(64)}`
}

function reportFixture() {
    const artifacts = {
        "candidate-1": {
            id: "version-c1",
            commit: "1".repeat(40),
            contentDigest: digest("1"),
            diffSummary: "补充历史时点查询路径",
        },
        "candidate-2": {
            id: "version-c2",
            commit: "2".repeat(40),
            contentDigest: digest("2"),
            diffSummary: "修复实例下钻与错误恢复",
        },
        "install-1": {jobs: [{id: "install-c1", runtime: {runtimeId: "codex:target"}, status: "succeeded"}]},
        "install-2": {jobs: [{id: "install-c2", runtime: {runtimeId: "codex:target"}, status: "succeeded"}]},
        "analysis-1": {
            score: 82,
            scoreDelta: 8,
            passRate: 0.5,
            improved: [{caseId: "case-1", runtimeId: "codex:target", delta: 16}],
            regressed: [{caseId: "case-2", runtimeId: "codex:target", delta: -2}],
            criticalFailures: [],
            executionFailureCount: 0,
            gradingFailureCount: 0,
        },
        "analysis-2": {
            score: 94,
            scoreDelta: 12,
            passRate: 1,
            improved: [
                {caseId: "case-1", runtimeId: "codex:target", delta: 8},
                {caseId: "case-2", runtimeId: "codex:target", delta: 16},
            ],
            regressed: [],
            criticalFailures: [],
            executionFailureCount: 0,
            gradingFailureCount: 0,
        },
        "decision-1": {action: "continue", rationale: "仍有 case-2 回归"},
        "decision-2": {action: "finish", rationale: "目标已达到"},
    }
    const run = {
        id: "optimization-run-1",
        state: "succeeded",
        snapshot: {
            schemaVersion: "rolling-skill-frozen-optimization-run/v2",
            baseline: {
                repositoryId: "repository-1",
                skillId: "skill-1",
                versionId: "released-v1",
                commit: "a".repeat(40),
                skillRoot: "skills/billing",
                contentDigest: digest("a"),
            },
            dataset: {id: "dataset-1", revision: 7, digest: digest("d")},
            rubric: {id: "rubric-1", version: 4, digest: digest("r")},
            targets: [
                {runtimeId: "codex:target", modelId: "gpt-5.6-sol", effort: "high"},
                {runtimeId: "codebuddy:target", modelId: "claude-sonnet", effort: "high"},
            ],
            limits: {maxEpochs: 5},
        },
        epochs: [
            {
                number: 1,
                status: "completed",
                candidateArtifactId: "candidate-1",
                installArtifactIds: ["install-1"],
                evaluationArtifactIds: ["evaluation-1"],
                analysisArtifactId: "analysis-1",
                decisionArtifactId: "decision-1",
            },
            {
                number: 2,
                status: "succeeded",
                candidateArtifactId: "candidate-2",
                installArtifactIds: ["install-2"],
                evaluationArtifactIds: ["evaluation-2"],
                analysisArtifactId: "analysis-2",
                decisionArtifactId: "decision-2",
            },
        ],
        checkpoint: {
            stopReason: "max_epochs_reached",
            finalApprovalId: "approval-final",
            releasedVersionId: "released-v2",
            releasedInstallArtifactId: "released-install",
        },
        recovery: null,
        error: null,
    }
    return {run, artifacts}
}

describe("Optimization Markdown report", () => {
    it("distinguishes a rejected final approval from one that was never requested", () => {
        const {run, artifacts} = reportFixture()
        run.state = "cancelled"
        run.error = {code: "OPTIMIZATION_FINAL_APPROVAL_REJECTED", message: "Optimization release and installation were rejected"}
        run.checkpoint = {
            stopReason: "agent_finish",
            installationOperation: "experiment_restore",
            installationJobIds: ["restore-job-1"],
            installationPending: false,
        }
        const {markdown} = generateOptimizationReport({run, readArtifact: (id) => artifacts[id] ?? null})
        assert.match(markdown, /最终审批：已拒绝/)
        assert.match(markdown, /结束原因：用户选择回退原版本/)
        assert.match(markdown, /恢复基线/)
        assert.match(markdown, /restore-job-1/)
        assert.doesNotMatch(markdown, /最终审批：未申请|\| Runtime \| Model \| Effort \|/)
    })

    it("does not claim approvals were never requested when historical records are incomplete", () => {
        const {run, artifacts} = reportFixture()
        run.state = "failed"
        run.error = {code: "OTHER_FAILURE", message: "Release persistence failed"}
        run.checkpoint = {}
        const {markdown} = generateOptimizationReport({run, readArtifact: (id) => artifacts[id] ?? null})
        assert.match(markdown, /最终审批：未记录审批结果/)
        assert.match(markdown, /结束原因：Release persistence failed/)
        assert.doesNotMatch(markdown, /未申请/)
    })

    it("renders frozen identities, every Epoch delta, and the Epoch-only boundary without usage budgets", () => {
        const {run, artifacts} = reportFixture()
        const first = generateOptimizationReport({
            run,
            readArtifact: (artifactId) => artifacts[artifactId] ?? null,
        })
        const second = generateOptimizationReport({
            run: structuredClone(run),
            readArtifact: (artifactId) => structuredClone(artifacts[artifactId] ?? null),
        })

        assert.equal(first.markdown, second.markdown)
        assert.equal(first.digest, second.digest)
        assert.match(first.digest, /^sha256:[a-f0-9]{64}$/u)
        for (const text of [
            "released-v1",
            "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            "codex:target",
            "codebuddy:target",
            "Epoch 1",
            "Epoch 2",
            "补充历史时点查询路径",
            "修复实例下钻与错误恢复",
            "case-1",
            "case-2",
            "改进项",
            "回归项",
            "最大闭环次数：5",
            "结束原因：达到最大闭环次数（max_epochs_reached）",
            "released-v2",
            "最终审批与安装",
            "恢复状态",
            "Agent 判断理由",
        ]) assert.match(first.markdown, new RegExp(text, "u"))
        assert.doesNotMatch(first.markdown, /最终回归/u)
        assert.doesNotMatch(first.markdown, /Agent 结论|Agent 分数/u)
        assert.doesNotMatch(
            first.markdown,
            /预算与遥测|Token|成本|最长时间|时长|耐心|最小有效提升|minimum improvement|patience|duration|cost/iu,
        )
    })

    it("keeps legacy v1 budget telemetry readable without adding it to v2 reports", () => {
        const {run, artifacts} = reportFixture()
        run.snapshot = {
            ...run.snapshot,
            schemaVersion: "rolling-skill-frozen-optimization-run/v1",
            mode: "adaptive",
            limits: {
                maxEpochs: 3,
                maxDurationMs: 3_600_000,
                patience: 2,
                minimumImprovement: 1,
                maxTurns: 50,
                maxTokens: 100_000,
                maxCostMicros: 5_000_000,
            },
            target: {minimumScore: 90, minimumPassRate: 1, requireCriticalCases: true},
            telemetry: {tokens: true, cost: true},
        }
        run.checkpoint.telemetry = {tokens: 40_000, costMicros: 123_000}

        const {markdown} = generateOptimizationReport({run, readArtifact: (id) => artifacts[id] ?? null})

        assert.match(markdown, /预算与遥测/u)
        assert.match(markdown, /Token：40000/u)
        assert.match(markdown, /成本（micros）：123000/u)
    })

    it("keeps old final-regression evidence readable as a legacy note", () => {
        const {run, artifacts} = reportFixture()
        run.checkpoint.finalEvaluationArtifactId = "final-evaluation"
        run.checkpoint.finalRegressionPassed = true
        artifacts["final-evaluation"] = {id: "evaluation-final", status: "completed"}
        run.epochs[1].evaluationArtifactIds.push("final-evaluation")

        const {markdown} = generateOptimizationReport({run, readArtifact: (id) => artifacts[id] ?? null})

        assert.match(markdown, /历史最终回归：通过/u)
    })

    it("reports needs_recovery targets without hiding the last verified evidence", () => {
        const {run, artifacts} = reportFixture()
        run.state = "needs_recovery"
        run.checkpoint.recoveryTargets = [{
            runtimeId: "codex:target",
            installationJobId: "inspect-job-1",
            marker: {runId: run.id, epoch: 2},
            contentDigest: digest("2"),
            status: "uncertain",
        }]
        run.recovery = {
            previousState: "restoring",
            reason: "process_interrupted",
            recoveredAt: "2026-08-25T08:00:00.000Z",
        }

        const report = generateOptimizationReport({
            run,
            readArtifact: (artifactId) => artifacts[artifactId] ?? null,
        })
        assert.match(report.markdown, /needs_recovery/u)
        assert.match(report.markdown, /inspect-job-1/u)
        assert.match(report.markdown, /uncertain/u)
        assert.match(report.markdown, new RegExp(digest("2"), "u"))
    })

    it("persists the deterministic Markdown as a digest-linked Operator Artifact", () => {
        const {run, artifacts} = reportFixture()
        const created = []
        const artifactStore = {
            createArtifact(jobId, input) {
                created.push({jobId, input})
                return {id: "report-artifact-1", ...input}
            },
        }

        const result = persistOptimizationReport({
            run,
            readArtifact: (artifactId) => artifacts[artifactId] ?? null,
            artifactStore,
            jobId: "operator-job-1",
        })

        assert.equal(created.length, 1)
        assert.equal(created[0].jobId, "operator-job-1")
        assert.equal(created[0].input.kind, "optimization-report")
        assert.equal(created[0].input.mediaType, "text/markdown; charset=utf-8")
        assert.equal(created[0].input.body, result.markdown)
        assert.equal(created[0].input.metadata.runId, run.id)
        assert.equal(created[0].input.metadata.digest, result.digest)
        assert.equal(result.artifact.id, "report-artifact-1")
        assert.equal(result.reportArtifactId, "report-artifact-1")
    })
})
