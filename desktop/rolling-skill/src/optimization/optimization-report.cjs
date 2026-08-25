"use strict"

const {createHash} = require("node:crypto")

function sha256(value) {
    return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`
}

function display(value, fallback = "—") {
    return value === null || value === undefined || value === "" ? fallback : String(value)
}

function percent(value) {
    return Number.isFinite(value) ? `${(value * 100).toFixed(2)}%` : "—"
}

function artifactValue(value) {
    if (value === null || value === undefined) return null
    if (Buffer.isBuffer(value)) return JSON.parse(value.toString("utf8"))
    if (typeof value === "string") return JSON.parse(value)
    if (typeof value !== "object" || Array.isArray(value)) return value
    if (typeof value.body === "string") return JSON.parse(value.body)
    if (value.inline && typeof value.inline.body === "string") {
        const encoding = value.inline.encoding === "base64" ? "base64" : "utf8"
        return JSON.parse(Buffer.from(value.inline.body, encoding).toString("utf8"))
    }
    return value
}

function readArtifact(read, artifactId) {
    if (!artifactId) return null
    return artifactValue(read(artifactId))
}

function entryText(entry) {
    const identity = [entry.caseId, entry.runtimeId].filter(Boolean).join(" × ") || "未知项"
    const delta = Number.isFinite(entry.delta) ? `（Δ ${entry.delta > 0 ? "+" : ""}${entry.delta}）` : ""
    return `${identity}${delta}`
}

function listSection(lines, title, entries) {
    lines.push(`#### ${title}`, "")
    if (!Array.isArray(entries) || entries.length === 0) {
        lines.push("- 无", "")
        return
    }
    for (const entry of entries) lines.push(`- ${entryText(entry)}`)
    lines.push("")
}

function renderEpoch(lines, epoch, read) {
    const candidate = readArtifact(read, epoch.candidateArtifactId) ?? {}
    const analysis = readArtifact(read, epoch.analysisArtifactId) ?? {}
    const decision = readArtifact(read, epoch.decisionArtifactId) ?? {}
    const installations = (epoch.installArtifactIds ?? [])
        .map((artifactId) => readArtifact(read, artifactId))
        .filter(Boolean)
        .flatMap((artifact) => Array.isArray(artifact.jobs) ? artifact.jobs : [artifact])

    lines.push(
        `### Epoch ${display(epoch.number)}`,
        "",
        `- 状态：${display(epoch.status)}`,
        `- Candidate：${display(candidate.id ?? candidate.versionId)}`,
        `- commit：${display(candidate.commit)}`,
        `- 内容摘要：${display(candidate.contentDigest)}`,
        `- Diff 摘要：${display(candidate.diffSummary, "未提供")}`,
        `- 得分：${display(analysis.score)}（相对上一轮 Δ ${display(analysis.scoreDelta)}）`,
        `- 通过率：${percent(analysis.passRate)}`,
        `- 执行失败：${display(analysis.executionFailureCount, "0")}；评分失败：${display(analysis.gradingFailureCount, "0")}`,
        "",
        "#### Runtime 安装结果",
        "",
    )
    if (installations.length === 0) lines.push("- 未提供")
    for (const job of installations) {
        lines.push(`- ${display(job.runtime?.runtimeId ?? job.runtimeId)}：${display(job.status)}`)
    }
    lines.push("")
    listSection(lines, "改进项", analysis.improved)
    listSection(lines, "回归项", analysis.regressed)
    listSection(lines, "关键失败", analysis.criticalFailures)
    lines.push(
        "#### Agent 判断理由",
        "",
        `> ${display(decision.rationale, "未提供")}`,
        "",
    )
}

function generateOptimizationReport({run, readArtifact: read}) {
    if (!run || typeof run !== "object" || Array.isArray(run)) {
        throw new Error("Optimization Run is required")
    }
    if (typeof read !== "function") throw new Error("Optimization artifact reader is required")
    const snapshot = run.snapshot ?? {}
    const baseline = snapshot.baseline ?? {}
    const checkpoint = run.checkpoint ?? {}
    const tokens = checkpoint.telemetry?.tokens
    const costMicros = checkpoint.telemetry?.costMicros
    const lines = [
        "# Skill 多轮优化报告",
        "",
        `- Run：${display(run.id)}`,
        `- 状态：${display(run.state)}`,
        `- 停止原因：${display(checkpoint.stopReason, "未提供")}`,
        "",
        "## 冻结输入",
        "",
        `- Repository：${display(baseline.repositoryId)}`,
        `- Skill：${display(baseline.skillId)}`,
        `- Released 基线：${display(baseline.versionId)}`,
        `- 基线 commit：${display(baseline.commit)}`,
        `- Skill 根目录：${display(baseline.skillRoot)}`,
        `- 基线内容摘要：${display(baseline.contentDigest)}`,
        `- Dataset：${display(snapshot.dataset?.id)} @ revision ${display(snapshot.dataset?.revision)}（${display(snapshot.dataset?.digest)}）`,
        `- Rubric：${display(snapshot.rubric?.id)} @ version ${display(snapshot.rubric?.version)}（${display(snapshot.rubric?.digest)}）`,
        "",
        "## Runtime 矩阵",
        "",
        "| Runtime | Model | Effort |",
        "| --- | --- | --- |",
    ]
    for (const target of snapshot.targets ?? []) {
        lines.push(`| ${display(target.runtimeId)} | ${display(target.modelId)} | ${display(target.effort)} |`)
    }
    lines.push("", "## Epoch 结果", "")
    for (const epoch of run.epochs ?? []) renderEpoch(lines, epoch, read)

    lines.push(
        "## 预算与遥测",
        "",
        `- Token：${Number.isFinite(tokens) ? tokens : "运行时未提供"}`,
        `- 成本（micros）：${Number.isFinite(costMicros) ? costMicros : "运行时未提供"}`,
        "",
        "## 发布与最终回归",
        "",
        `- Release approval：${display(checkpoint.releaseApprovalId, "未申请")}`,
        `- Install approval：${display(checkpoint.installApprovalId, "未申请")}`,
        `- Released version：${display(checkpoint.releasedVersionId, "未发布")}`,
        `- Released install Artifact：${display(checkpoint.releasedInstallArtifactId, "未提供")}`,
        `- 最终回归：${checkpoint.finalRegressionPassed === true ? "通过" : checkpoint.finalRegressionPassed === false ? "未通过" : "未运行"}`,
        `- 最终评测 Artifact：${display(checkpoint.finalEvaluationArtifactId, "未提供")}`,
        "",
        "## 恢复状态",
        "",
        `- Run 恢复状态：${display(run.state)}`,
    )
    if (run.recovery) {
        lines.push(
            `- 中断前状态：${display(run.recovery.previousState)}`,
            `- 原因：${display(run.recovery.reason)}`,
            `- 恢复时间：${display(run.recovery.recoveredAt)}`,
        )
    }
    for (const target of checkpoint.recoveryTargets ?? []) {
        lines.push(
            `- ${display(target.runtimeId)}：${display(target.status)}；安装 Job ${display(target.installationJobId)}；` +
            `marker run=${display(target.marker?.runId)}, epoch=${display(target.marker?.epoch)}；digest ${display(target.contentDigest)}`,
        )
    }
    lines.push("")
    const markdown = lines.join("\n")
    return {markdown, digest: sha256(markdown)}
}

function persistOptimizationReport({run, readArtifact, artifactStore, jobId}) {
    if (!artifactStore || typeof artifactStore.createArtifact !== "function") {
        throw new Error("Optimization Artifact store is required")
    }
    if (typeof jobId !== "string" || !jobId.trim()) {
        throw new Error("Optimization report Job id is required")
    }
    const report = generateOptimizationReport({run, readArtifact})
    const artifact = artifactStore.createArtifact(jobId, {
        kind: "optimization-report",
        name: `${run.id}.md`,
        mediaType: "text/markdown; charset=utf-8",
        body: report.markdown,
        metadata: {runId: run.id, digest: report.digest},
    })
    return {...report, artifact, reportArtifactId: artifact.id}
}

module.exports = {generateOptimizationReport, persistOptimizationReport}
