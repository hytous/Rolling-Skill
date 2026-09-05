const assert = require("node:assert/strict")
const {existsSync} = require("node:fs")
const {join} = require("node:path")
const {describe, it} = require("node:test")

const contextPath = join(
    __dirname,
    "..",
    "src",
    "optimization",
    "optimization-agent-context.cjs",
)
const playbookPath = join(
    __dirname,
    "..",
    "src",
    "optimization",
    "optimization-playbook.cjs",
)

describe("optimization Agent context", () => {
    it("ships a frozen and versioned optimization Playbook", () => {
        assert.equal(existsSync(playbookPath), true, "the packaged Desktop Playbook module must exist")
        const {
            currentOptimizationPlaybook,
            validateOptimizationPlaybook,
        } = require(playbookPath)
        const first = currentOptimizationPlaybook()

        assert.equal(first.id, "rolling-skill-optimization")
        assert.equal(first.version, 1)
        assert.match(first.digest, /^sha256:[a-f0-9]{64}$/u)
        assert.match(first.content, /从用户视角理解完整 Skill/u)
        assert.match(first.content, /建立证据矩阵/u)
        assert.match(first.content, /形成可泛化修改/u)
        assert.match(first.content, /自检候选版本/u)
        assert.match(first.content, /根据完整回归决定下一步/u)
        assert.equal(first.sources.length, 6)
        assert.equal(Object.isFrozen(first), true)
        assert.equal(Object.isFrozen(first.sources), true)
        assert.deepEqual(validateOptimizationPlaybook(first), first)
        assert.throws(() => validateOptimizationPlaybook({...first, content: `${first.content}\nchanged`}), /digest/i)
    })

    it("injects the frozen Playbook, user direction, and bounded evidence by phase", () => {
        assert.equal(existsSync(contextPath), true, "the packaged Desktop context module must exist")
        const {
            optimizationRequestMessage,
            optimizationTaskObjective,
        } = require(contextPath)
        const {currentOptimizationPlaybook} = require(playbookPath)
        const baseline = {
            id: "baseline",
            status: "completed",
            results: Array.from({length: 20}, (_, index) => ({
                caseId: `case-${index}`,
                runtimeId: "target",
                caseSnapshot: {question: "user question", answer: "reference"},
                response: "actual answer ".repeat(1_000),
                status: "completed",
                gradingStatus: "completed",
                computedScore: {totalScore: 60},
                judgment: {assessments: [{
                    criterionId: "format",
                    rating: 6,
                    rationale: "Missing required field",
                }]},
                traceEvidence: {secret: "must not enter prompt"},
                reasoning: "must not enter prompt",
            })),
        }
        const run = {id: "run-1", snapshot: {
            limits: {maxEpochs: 3},
            optimizationDirection: "重点改善异常下钻",
            playbook: currentOptimizationPlaybook(),
            baseline: {skillId: "skill-1", versionId: "version-1"},
            dataset: {id: "dataset-1"},
            rubric: {id: "rubric-1", version: 2},
        }}

        const objective = optimizationTaskObjective(run)
        assert.match(objective, /重点改善异常下钻/u)
        assert.match(objective, /Rolling Skill Optimization Playbook v1/u)
        assert.match(objective, /从用户视角理解完整 Skill/u)
        assert.match(objective, /skill-1/u)
        assert.match(objective, /dataset-1/u)
        assert.match(objective, /rubric-1/u)

        const candidate = optimizationRequestMessage({
            run,
            kind: "candidate",
            epoch: 1,
            baselineEvaluation: baseline,
            currentEvaluation: baseline,
        })
        assert.match(candidate, /重点改善异常下钻/u)
        assert.match(candidate, /从用户视角理解完整 Skill/u)
        assert.match(candidate, /optimization\.submit_candidate/u)
        assert.match(candidate, /Missing required field/u)
        assert.match(candidate, /"omittedResults":/u)
        assert.doesNotMatch(candidate, /must not enter prompt/u)
        assert.ok(candidate.length <= 32_768)

        const decision = optimizationRequestMessage({
            run,
            kind: "decision",
            epoch: 1,
            baselineEvaluation: baseline,
            currentEvaluation: {...baseline, id: "candidate"},
        })
        assert.match(decision, /optimization\.submit_decision/u)
        assert.match(decision, /重点改善异常下钻/u)
        assert.ok(decision.length <= 32_768)
    })
})
