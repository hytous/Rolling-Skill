const assert = require("node:assert/strict")
const {describe, it} = require("node:test")

const {
    CALCULATOR_VERSION,
    COMPUTED_SCORE_SCHEMA,
    JUDGE_RESULT_SCHEMA,
    PASS_THRESHOLD,
    SCORE_CONTRACT_SCHEMA,
    USABLE_THRESHOLD,
    buildJudgePrompt,
    buildScoreContract,
    calculateScore,
    parseJudgeResult,
    validateJudgeResult,
} = require("../src/evaluation-grading.cjs")
const {UNIFIED_SCORING_MODEL} = require("../src/dataset-rubric.cjs")

function datasetRubric({scoringModel = UNIFIED_SCORING_MODEL} = {}) {
    return {
        schemaVersion: "rolling-skill-dataset-rubric/v1",
        ...(scoringModel ? {scoringModel} : {}),
        title: "Billing Skill unified rubric",
        summary: "Assess Skill execution and answer quality together.",
        criteria: [
            {
                id: "R1",
                title: "Skill workflow",
                criterion: "Discover and follow the Skill-prescribed query workflow.",
                weight: 2,
                evidenceRequirements: ["Skill-read and tool Trace", "Agent response"],
                scoringAnchors: {
                    "0": "The workflow was absent.",
                    "2": "Only a token part was visible.",
                    "5": "The workflow had material gaps.",
                    "8": "The workflow was substantially complete.",
                    "10": "The complete workflow was evidenced.",
                },
                criticalFailure: false,
            },
            {
                id: "R2",
                title: "Supported conclusion",
                criterion: "Return a scoped and evidence-backed billing conclusion.",
                weight: 3,
                evidenceRequirements: ["Reference facts", "Agent response"],
                scoringAnchors: {
                    "0": "The conclusion was missing or fabricated.",
                    "2": "Most requested conclusions were unsupported.",
                    "5": "The conclusion was materially incomplete.",
                    "8": "The conclusion had only minor gaps.",
                    "10": "The conclusion was complete and cross-checked.",
                },
                criticalFailure: true,
            },
        ],
        automaticFailures: [{
            id: "RF1",
            condition: "The answer invents an unsupported billing number.",
            rationale: "Fabricated financial results invalidate the result.",
        }],
    }
}

function curatedCase() {
    return {
        id: "case-v2",
        question: "查一下 7 月账单",
        curated: {
            schemaVersion: "rolling-skill-curated-case/v2",
            referenceAnswer: {
                summary: "给出有来源的 7 月账单结果。",
                requiredFacts: ["账期是 7 月"],
                requiredSteps: ["核验账期"],
                requiredOutputFormat: ["金额带币种"],
                evidence: [],
            },
            rubricCoverage: [
                {
                    criterionId: "R1",
                    applicability: "applicable",
                    expectation: "按 Skill 完成查询和验证",
                    evidenceBasis: "Skill 与原始问题",
                },
                {
                    criterionId: "R2",
                    applicability: "applicable",
                    expectation: "按 7 月账期返回可核验结论",
                    evidenceBasis: "原始问题",
                },
            ],
            caseSpecificCriteria: [{
                id: "C1",
                criterion: "明确标出 7 月",
                weight: 1,
                evidenceBasis: "原始问题",
            }],
            caseAutomaticFailures: [{
                id: "CF1",
                condition: "回答其他月份",
                evidenceBasis: "原始问题限定 7 月",
            }],
            badCaseAnalysis: null,
        },
    }
}

function legacyCuratedCase() {
    return {
        id: "legacy-case",
        question: "查账单",
        curated: {
            schemaVersion: "rolling-skill-curated-case/v1",
            referenceAnswer: {summary: "返回账单", requiredFacts: [], requiredSteps: [], requiredOutputFormat: [], evidence: []},
            grading: {
                hardRequirements: [{
                    id: "H1",
                    criterion: "使用目标 Skill",
                    passCondition: "Trace 显示 Skill 工作流",
                    evidenceBasis: "冻结 Skill",
                }],
                softCriteria: [{id: "S1", criterion: "回答清晰", weight: 1}],
                automaticFailures: ["编造数字"],
            },
        },
    }
}

function rubricVersion(rubric = datasetRubric()) {
    return {
        id: "rubric-version-2",
        version: 2,
        rubricDigest: "sha256:rubric",
        rubric,
    }
}

function evidenceCatalog() {
    return {
        schemaVersion: "rolling-skill-evidence-catalog/v1",
        entries: [
            {id: "response", source: "response", kind: "response", kinds: ["response"], content: "answer"},
            {
                id: "trace:scope",
                source: "trace",
                kind: "trace_scope",
                kinds: ["trace_scope"],
                semanticCoverageComplete: true,
                samplingStrategy: "semantic-v1",
                omittedImportantEntries: 0,
            },
            {id: "trace:L1", source: "trace", kind: "skill_read", kinds: ["skill_read"], record: {sequence: 1}},
            {id: "trace:L2", source: "trace", kind: "tool_call", kinds: ["tool_call"], record: {sequence: 2}},
            {id: "skill:SKILL.md", source: "skill", kind: "skill_definition", kinds: ["skill_definition"], content: "Skill contents"},
        ],
    }
}

function scoreContract(options = {}) {
    return buildScoreContract(curatedCase(), {
        rubricVersion: rubricVersion(),
        evidenceRefs: ["response"],
        ...options,
    })
}

function passingJudge(contract = scoreContract()) {
    return {
        schemaVersion: JUDGE_RESULT_SCHEMA,
        contractDigest: contract.digest,
        assessments: contract.criteria.map((criterion) => ({
            criterionId: criterion.id,
            status: "scored",
            rating: 10,
            confidence: 0.8,
            verificationStatus: "verified",
            verifiableFields: ["业务范围", "成本数字"],
            crossChecks: ["回答与参考答案一致"],
            evidenceRefs: ["response"],
            rationale: "回答与可用证据一致。",
        })),
    }
}

describe("unified evaluation grading contract", () => {
    it("builds one 100-point criterion list from the frozen Skill rubric and Case addenda", () => {
        const contract = scoreContract()

        assert.equal(contract.schemaVersion, SCORE_CONTRACT_SCHEMA)
        assert.equal(contract.calculatorVersion, CALCULATOR_VERSION)
        assert.deepEqual(contract.policy, {
            maxScore: 100,
            passThreshold: PASS_THRESHOLD,
            usableThreshold: USABLE_THRESHOLD,
            criticalRatingThreshold: 5,
        })
        assert.deepEqual(
            contract.criteria.map((entry) => [entry.id, entry.source, entry.mode ?? "criterion"]),
            [
                ["R1", "dataset_rubric", "criterion"],
                ["R2", "dataset_rubric", "criterion"],
                ["RF1", "dataset_rubric_failure", "automatic_failure"],
                ["C1", "case_specific", "criterion"],
                ["CF1", "case_automatic_failure", "automatic_failure"],
            ],
        )
        assert.match(contract.criteria[0].criterion, /0: The workflow was absent/)
        assert.match(contract.criteria[1].criterion, /按 7 月账期/)
        assert.equal(contract.criteria[1].criticalFailure, true)
        assert.equal("a" in contract, false)
        assert.equal("b" in contract, false)
        assert.match(contract.digest, /^sha256:[a-f0-9]{64}$/)
        assert.equal(Object.isFrozen(contract), true)
    })

    it("refuses to score a v2 Case with a legacy split-layer rubric", () => {
        assert.throws(
            () => buildScoreContract(curatedCase(), {
                rubricVersion: rubricVersion(datasetRubric({scoringModel: null})),
                evidenceRefs: ["response"],
            }),
            /unified.*rubric|rubric.*unified/i,
        )
    })

    it("maps legacy curated Cases into the same unified contract without A or B", () => {
        const contract = buildScoreContract(legacyCuratedCase(), {evidenceRefs: ["response"]})

        assert.deepEqual(
            contract.criteria.map((entry) => [entry.id, entry.mode ?? "criterion", entry.criticalFailure ?? false]),
            [
                ["H1", "criterion", true],
                ["AF1", "automatic_failure", true],
                ["S1", "criterion", false],
            ],
        )
        assert.equal("a" in contract, false)
        assert.equal("b" in contract, false)
    })

    it("turns badcase recurrence rules into deductions on the unified score", () => {
        const input = curatedCase()
        input.issueDescription = "The historical answer repeated a failed query."
        input.curated.badCaseAnalysis = {
            deductionRules: [{
                id: "D1",
                errorPattern: "Undiagnosed retry loop",
                matchCondition: "Equivalent failed calls repeat without diagnosis",
                deduction: 8,
                evidenceBasis: "Frozen badcase Trace",
            }],
        }
        const contract = buildScoreContract(input, {
            rubricVersion: rubricVersion(),
            evidenceRefs: ["response"],
        })
        const judged = passingJudge(contract)
        judged.assessments.find((entry) => entry.criterionId === "D1").rating = 0
        const computed = calculateScore(contract, judged)

        assert.equal(computed.totalScore, 92)
        assert.deepEqual(
            computed.criterionScores.find((entry) => entry.id === "D1"),
            {
                id: "D1",
                status: "scored",
                rating: 0,
                confidence: 0.8,
                verificationStatus: "verified",
                verifiableFields: ["业务范围", "成本数字"],
                crossChecks: ["回答与参考答案一致"],
                points: -8,
                deduction: 8,
                criticalFailureTriggered: false,
            },
        )
    })

    it("freezes only compact typed Evidence Catalog metadata", () => {
        const catalog = evidenceCatalog()
        const contract = scoreContract({evidenceCatalog: catalog})

        assert.deepEqual(contract.evidence.allowedRefs, catalog.entries.map((entry) => entry.id))
        assert.equal(contract.evidence.typed, true)
        assert.deepEqual(contract.evidence.entries[2], {
            id: "trace:L1",
            source: "trace",
            kind: "skill_read",
            kinds: ["skill_read"],
            sequence: 1,
        })
        assert.equal(JSON.stringify(contract).includes("Skill contents"), false)
        assert.equal(JSON.stringify(contract).includes('"record"'), false)
    })

    it("requires real execution Trace citations before a workflow criterion can receive a passing rating", () => {
        const contract = scoreContract({evidenceCatalog: evidenceCatalog()})
        const workflow = contract.criteria.find((entry) => entry.id === "R1")
        assert.deepEqual(workflow.requiredEvidenceGroups, [
            {
                id: "skill_execution",
                kinds: ["skill_read"],
            },
            {
                id: "runtime_execution",
                kinds: ["command", "tool_call"],
            },
            {
                id: "agent_response",
                kinds: ["response"],
            },
        ])

        const responseOnly = passingJudge(contract)
        assert.throws(
            () => validateJudgeResult(responseOnly, contract),
            /R1.*skill_execution.*typed evidence/i,
        )

        const activationOnlyCatalog = evidenceCatalog()
        activationOnlyCatalog.entries[2] = {
            id: "trace:L1",
            source: "trace",
            kind: "skill_activation",
            kinds: ["skill_activation"],
            sequence: 1,
        }
        const activationOnlyContract = scoreContract({evidenceCatalog: activationOnlyCatalog})
        const activationOnly = passingJudge(activationOnlyContract)
        activationOnly.assessments.find((entry) => entry.criterionId === "R1").evidenceRefs = [
            "response",
            "trace:L1",
            "trace:L2",
        ]
        assert.throws(
            () => validateJudgeResult(activationOnly, activationOnlyContract),
            /R1.*skill_execution.*skill_read/i,
        )

        const traceBacked = passingJudge(contract)
        traceBacked.assessments.find((entry) => entry.criterionId === "R1").evidenceRefs = [
            "response",
            "trace:L1",
            "trace:L2",
        ]
        assert.doesNotThrow(() => validateJudgeResult(traceBacked, contract))
    })

    it("proves a no-tool policy with a complete Case Trace without requiring an artificial tool call", () => {
        const rubric = datasetRubric()
        Object.assign(rubric.criteria[0], {
            title: "No-tool execution policy",
            criterion: "Apart from loading the Skill itself, the assistant issues no tool calls.",
            evidenceRequirements: ["Tool-call record shows at most the Skill load; no operational tool invocations", "Agent response"],
        })
        const input = curatedCase()
        input.curated.rubricCoverage[0].expectation = "No tool calls other than the skill load."
        input.curated.rubricCoverage[0].evidenceBasis = "Historical toolActivity records the skill load."
        const catalog = evidenceCatalog()
        catalog.entries = catalog.entries.filter((entry) => !["skill_read", "tool_call"].includes(entry.kind))
        const contract = buildScoreContract(input, {rubricVersion: rubricVersion(rubric), evidenceCatalog: catalog})
        assert.deepEqual(contract.criteria[0].requiredEvidenceGroups, [
            {id: "agent_response", kinds: ["response"]}, {id: "complete_trace", kinds: ["trace_scope"]},
        ])
        const judgment = passingJudge(contract)
        judgment.assessments[0].evidenceRefs = ["response", "trace:scope"]
        assert.doesNotThrow(() => validateJudgeResult(judgment, contract))
        catalog.entries.find((entry) => entry.kind === "trace_scope").semanticCoverageComplete = false
        const incomplete = buildScoreContract(input, {rubricVersion: rubricVersion(rubric), evidenceCatalog: catalog})
        judgment.contractDigest = incomplete.digest
        assert.throws(() => validateJudgeResult(judgment, incomplete), /complete.*Trace/i)
    })

    it("does not mistake description or prescribed wording for a script execution requirement", () => {
        const rubric = datasetRubric()
        rubric.criteria[1].criterion = "Evidence grounded in the supplied description, following the prescribed format."
        const contract = buildScoreContract(curatedCase(), {rubricVersion: {id: "rubric-v1", rubric}})
        assert.ok(!contract.criteria.find((entry) => entry.id === "R2").requiredEvidenceGroups.some((group) => group.id === "runtime_execution"))
    })

    it("requires scoped applicability evidence instead of positive operations for an inapplicable rubric criterion", () => {
        const input = curatedCase()
        input.curated.rubricCoverage[0] = {criterionId: "R1", applicability: "not_applicable", expectation: "No evidence field is expected; the only factual output is pwd, produced by the commanded tool call rather than an incident description.", evidenceBasis: "Historical tool result"}
        const contract = buildScoreContract(input, {rubricVersion: {id: "rubric-v1", rubric: datasetRubric()}})
        assert.deepEqual(contract.criteria.find((entry) => entry.id === "R1").requiredEvidenceGroups, [
            {id: "agent_response", kinds: ["response"]},
            {id: "complete_trace", kinds: ["trace_scope"]},
        ])
        assert.equal(contract.criteria.find((entry) => entry.id === "R1").weight, 2, "do not alter published rubric weights")
    })

    it("does not turn historical evidence descriptions into new execution requirements", () => {
        const input = curatedCase()
        input.curated.rubricCoverage[1].evidenceBasis = "Earlier tool calls and deterministic scripts supported the reference answer."
        const contract = buildScoreContract(input, {rubricVersion: rubricVersion()})
        assert.deepEqual(contract.criteria.find((entry) => entry.id === "R2").requiredEvidenceGroups, [
            {id: "agent_response", kinds: ["response"]},
        ])
    })

    it("still requires positive script execution evidence beside a prohibition on external tools", () => {
        const rubric = datasetRubric()
        rubric.criteria[0].criterion = "Run the calculator script; do not issue external tool calls."
        const contract = scoreContract({rubricVersion: rubricVersion(rubric), evidenceCatalog: evidenceCatalog()})
        assert.ok(contract.criteria[0].requiredEvidenceGroups.some((group) => group.id === "runtime_execution"))
        assert.throws(() => validateJudgeResult(passingJudge(contract), contract), /typed evidence/)
    })

    it("requires a typed reference-read event when the published rubric makes that read mandatory", () => {
        const rubric = datasetRubric()
        rubric.criteria[0].evidenceRequirements.push(
            "Read the required reference before the dependent operation.",
        )
        const catalog = evidenceCatalog()
        catalog.entries.push({
            id: "trace:L3",
            source: "trace",
            kind: "reference_read",
            kinds: ["reference_read"],
            sequence: 3,
        })
        const contract = scoreContract({
            rubricVersion: rubricVersion(rubric),
            evidenceCatalog: catalog,
        })
        assert.deepEqual(
            contract.criteria.find((entry) => entry.id === "R1").requiredEvidenceGroups,
            [
                {id: "skill_execution", kinds: ["skill_read"]},
                {id: "required_references", kinds: ["reference_read"]},
                {id: "runtime_execution", kinds: ["command", "tool_call"]},
                {id: "agent_response", kinds: ["response"]},
            ],
        )

        const missingReferenceRead = passingJudge(contract)
        missingReferenceRead.assessments.find((entry) => entry.criterionId === "R1").evidenceRefs = [
            "response",
            "trace:L1",
            "trace:L2",
        ]
        assert.throws(
            () => validateJudgeResult(missingReferenceRead, contract),
            /R1.*required_references.*reference_read/i,
        )

        missingReferenceRead.assessments.find((entry) => entry.criterionId === "R1").evidenceRefs.push(
            "trace:L3",
        )
        assert.doesNotThrow(() => validateJudgeResult(missingReferenceRead, contract))
    })

    it("asks the Judge for one assessment list and never for A/B or scores", () => {
        const catalog = evidenceCatalog()
        const contract = scoreContract({evidenceCatalog: catalog})
        const prompt = buildJudgePrompt({
            contract,
            question: curatedCase().question,
            response: "回答",
            traceEvidence: {semanticCoverageComplete: true},
            skillEvidence: {files: [{id: "skill:SKILL.md", content: "Skill contents"}]},
            evidenceCatalog: catalog,
        })

        for (const criterion of contract.criteria) assert.match(prompt, new RegExp(criterion.id))
        assert.match(prompt, /"assessments":\[\]/)
        assert.doesNotMatch(prompt, /aAssessments|bAssessments|A assessment|B assessment/)
        assert.match(prompt, /Do not return any score or verdict field/)
        assert.match(prompt, /automatic_failure[\s\S]*rating must be either 0 or 10/i)
        assert.match(prompt, /point-in-time numeric facts/i)
        assert.match(prompt, /do not penalize a different live value/i)
        assert.match(prompt, /response description cannot prove that an execution happened/i)
        assert.equal(prompt.split("Skill contents").length - 1, 1)
    })

    it("parses fenced JSON and requires exact criterion coverage", () => {
        const contract = scoreContract()
        const result = passingJudge(contract)
        const parsed = parseJudgeResult(`review\n\`\`\`json\n${JSON.stringify(result)}\n\`\`\``, contract)
        assert.equal(parsed.contractDigest, contract.digest)

        const missing = passingJudge(contract)
        missing.assessments.pop()
        assert.throws(() => validateJudgeResult(missing, contract), /exactly cover.*criteria/i)

        const extra = passingJudge(contract)
        extra.assessments.push({...extra.assessments[0], criterionId: "extra"})
        assert.throws(() => validateJudgeResult(extra, contract), /exactly cover.*criteria/i)
    })

    it("rejects Judge scores, invalid ratings, invented evidence, and non-binary automatic failures", () => {
        const contract = scoreContract()
        assert.throws(
            () => validateJudgeResult({...passingJudge(contract), totalScore: 100}, contract),
            /must not provide score or verdict/i,
        )

        const invalidRating = passingJudge(contract)
        invalidRating.assessments[0].rating = 11
        assert.throws(() => validateJudgeResult(invalidRating, contract), /rating must be from 0 to 10/i)

        const inventedEvidence = passingJudge(contract)
        inventedEvidence.assessments[0].evidenceRefs = ["trace:L999"]
        assert.throws(() => validateJudgeResult(inventedEvidence, contract), /unknown evidence reference/i)

        const ambiguousFailure = passingJudge(contract)
        ambiguousFailure.assessments.find((entry) => entry.criterionId === "RF1").rating = 5
        assert.throws(() => validateJudgeResult(ambiguousFailure, contract), /automatic.failure.*0 or 10/i)
    })

    it("rejects a mutated fixed policy or contract digest", () => {
        const contract = JSON.parse(JSON.stringify(scoreContract()))
        contract.policy.passThreshold = 47
        assert.throws(() => validateJudgeResult(passingJudge(scoreContract()), contract), /fixed unified policy/i)

        const mutated = JSON.parse(JSON.stringify(scoreContract()))
        mutated.criteria[0].weight = 100
        assert.throws(() => validateJudgeResult(passingJudge(scoreContract()), mutated), /digest does not match/i)
    })
})

describe("unified 100-point calculator", () => {
    it("calculates one total and passes a complete result", () => {
        const contract = scoreContract()
        const computed = calculateScore(contract, passingJudge(contract))

        assert.equal(computed.schemaVersion, COMPUTED_SCORE_SCHEMA)
        assert.equal(computed.totalScore, 100)
        assert.equal(computed.overallVerdict, "pass")
        assert.equal(computed.outcomeTier, "formal_pass")
        assert.equal("aScore" in computed, false)
        assert.equal("bScore" in computed, false)
    })

    it("uses relative criterion weights and classifies a 60-point result as usable", () => {
        const contract = scoreContract()
        const judged = passingJudge(contract)
        judged.assessments.find((entry) => entry.criterionId === "R1").rating = 0
        judged.assessments.find((entry) => entry.criterionId === "R2").rating = 10
        judged.assessments.find((entry) => entry.criterionId === "C1").rating = 0
        const computed = calculateScore(contract, judged)

        assert.equal(computed.totalScore, 50)
        assert.equal(computed.outcomeTier, "fail")

        judged.assessments.find((entry) => entry.criterionId === "C1").rating = 6
        const usable = calculateScore(contract, judged)
        assert.equal(usable.totalScore, 60)
        assert.equal(usable.outcomeTier, "usable_with_gaps")
    })

    it("applies published critical criteria and automatic failures as fixed gates", () => {
        const contract = scoreContract()
        const critical = passingJudge(contract)
        critical.assessments.find((entry) => entry.criterionId === "R2").rating = 4
        const criticalScore = calculateScore(contract, critical)
        assert.equal(criticalScore.outcomeTier, "fail")
        assert.deepEqual(criticalScore.criticalFailures, ["R2"])

        const automatic = passingJudge(contract)
        automatic.assessments.find((entry) => entry.criterionId === "RF1").rating = 0
        const automaticScore = calculateScore(contract, automatic)
        assert.equal(automaticScore.totalScore, 59.9)
        assert.equal(automaticScore.scoreCapApplied, true)
        assert.equal(automaticScore.outcomeTier, "fail")
        assert.deepEqual(automaticScore.criticalFailures, ["RF1"])
    })

    it("keeps diagnostic eligibility separate from the numerical total", () => {
        const contract = scoreContract()
        const explicit = calculateScore(contract, passingJudge(contract), {activationMode: "explicit"})
        assert.equal(explicit.totalScore, 100)
        assert.equal(explicit.overallVerdict, "diagnostic")
        assert.equal(explicit.outcomeTier, "diagnostic")

        const unverified = calculateScore(contract, passingJudge(contract), {
            skillEvidenceBinding: "unverified",
        })
        assert.equal(unverified.totalScore, 100)
        assert.equal(unverified.outcomeTier, "diagnostic")
        assert.deepEqual(unverified.diagnosticReasons, ["target_skill_binding_unverified"])
    })
})
