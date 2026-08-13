const assert = require("node:assert/strict")
const {describe, it} = require("node:test")

const {
    A_DIMENSIONS,
    A_PASS_THRESHOLD,
    CALCULATOR_VERSION,
    JUDGE_RESULT_SCHEMA,
    SCORE_CONTRACT_SCHEMA,
    buildJudgePrompt,
    buildScoreContract,
    calculateScore,
    parseJudgeResult,
    validateJudgeResult,
} = require("../src/evaluation-grading.cjs")

function curatedCase() {
    return {
        id: "case-1",
        question: "查一下 7 月各业务成本",
        curated: {
            schemaVersion: "rolling-skill-curated-case/v1",
            referenceAnswer: {
                summary: "按业务列出成本并给出证据。",
                requiredFacts: ["覆盖全部业务"],
                requiredSteps: ["先读取 Skill，再查询并核验"],
                requiredOutputFormat: ["业务、成本、币种、证据"],
                evidence: [],
            },
            grading: {
                hardRequirements: [
                    {
                        id: "H1",
                        criterion: "覆盖全部业务",
                        passCondition: "没有遗漏查询结果中的业务",
                        evidenceBasis: "用户问题和 Skill 要求",
                    },
                ],
                softCriteria: [
                    {id: "S1", criterion: "数字与结论可信度", weight: 3},
                    {id: "S2", criterion: "表达清晰度", weight: 1},
                ],
                automaticFailures: ["未读取目标 Skill", "编造无证据数字"],
            },
        },
    }
}

function curatedBadCase() {
    const input = curatedCase()
    input.caseType = "badcase"
    input.issueDescription = "The historical answer repeated a failed query without diagnosis."
    input.curated.badCaseAnalysis = {
        failureMode: "Repeated a failed query without diagnosis.",
        firstDivergence: "The first failed command was retried unchanged.",
        rootCauses: ["No bounded recovery decision"],
        loopSummary: "The same command repeated.",
        expectedRecovery: "Diagnose once, then use the supported fallback.",
        deductionRules: [{
            id: "D1",
            errorPattern: "Undiagnosed identical retry loop",
            matchCondition: "At least two equivalent failed calls occur without an intervening diagnosis",
            deduction: 8,
            evidenceBasis: "Frozen badcase trace",
            sourceItemIds: ["trace:L1"],
        }],
    }
    return input
}

function evidenceCatalog() {
    return {
        schemaVersion: "rolling-skill-evidence-catalog/v1",
        entries: [
            {id: "response", source: "response", kind: "response", kinds: ["response"], content: "answer"},
            {id: "trace:scope", source: "trace", kind: "trace_scope", kinds: ["trace_scope"], reference: "trace://case#L1-L4"},
            {id: "trace:L1", source: "trace", kind: "skill_activation", kinds: ["skill_activation", "skill_read", "command"], record: {sequence: 1}},
            {id: "trace:L2", source: "trace", kind: "reference_read", kinds: ["reference_read", "command"], record: {sequence: 2}},
            {id: "trace:L3", source: "trace", kind: "tool_call", kinds: ["tool_call"], record: {sequence: 3}},
            {id: "trace:L4", source: "trace", kind: "file_change", kinds: ["file_change"], record: {sequence: 4}},
            {id: "skill:SKILL.md", source: "skill", kind: "skill_definition", kinds: ["skill_definition"], content: "Skill contents"},
        ],
    }
}

function scoreContract(options = {}) {
    return buildScoreContract(curatedCase(), {
        evidenceRefs: ["response", ...A_DIMENSIONS.map((_entry, index) => `trace:L${index + 1}`)],
        ...options,
    })
}

function passingJudge(contract = scoreContract()) {
    return {
        schemaVersion: JUDGE_RESULT_SCHEMA,
        contractDigest: contract.digest,
        aAssessments: contract.a.dimensions.map((dimension, index) => ({
            dimensionId: dimension.id,
            status: "scored",
            level: 4,
            evidenceRefs: [contract.evidence.allowedRefs[index + 1] ?? contract.evidence.allowedRefs[0]],
            rationale: "可从 Trace 和回答中观察到完整执行。",
        })),
        bAssessments: contract.b.criteria.map((criterion) => ({
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

describe("evaluation grading contract", () => {
    it("keeps A generic and maps all Case-specific grading into diagnostic B criteria", () => {
        const contract = scoreContract()

        assert.equal(contract.schemaVersion, SCORE_CONTRACT_SCHEMA)
        assert.equal(contract.calculatorVersion, CALCULATOR_VERSION)
        assert.equal(contract.a.maxScore, 60)
        assert.equal(contract.issueDescription, "")
        assert.equal(contract.a.passThreshold, A_PASS_THRESHOLD)
        assert.deepEqual(
            contract.a.dimensions.map(({id, weight}) => [id, weight]),
            [
                ["skill_activation", 10],
                ["required_references", 8],
                ["tool_policy", 8],
                ["workflow_order", 8],
                ["completeness_artifacts", 8],
                ["deterministic_processing", 6],
                ["evidence_output", 6],
                ["error_recovery", 6],
            ],
        )
        assert.equal(A_DIMENSIONS.reduce((sum, entry) => sum + entry.weight, 0), 60)
        assert.equal("hardRequirements" in contract.a, false)
        assert.equal("automaticFailures" in contract.a, false)
        assert.deepEqual(
            contract.b.criteria.map((entry) => [entry.id, entry.source]),
            [
                ["H1", "case_hard_requirement"],
                ["AF1", "case_automatic_failure"],
                ["AF2", "case_automatic_failure"],
                ["S1", "case_soft_criterion"],
                ["S2", "case_soft_criterion"],
            ],
        )
        assert.equal(contract.b.maxScore, 40)
        assert.match(contract.digest, /^sha256:[a-f0-9]{64}$/)
        assert.equal(Object.isFrozen(contract), true)
    })

    it("keeps legacy Case-specific requirements as B criteria when soft criteria are absent", () => {
        const input = curatedCase()
        input.curated.grading.softCriteria = []
        const contract = buildScoreContract(input)

        assert.deepEqual(contract.b.criteria.map((entry) => entry.id), ["H1", "AF1", "AF2"])
    })

    it("turns every badcase recurrence rule into a direct B deduction without changing A", () => {
        const contract = buildScoreContract(curatedBadCase(), {evidenceRefs: ["response"]})
        const deduction = contract.b.criteria.find((entry) => entry.id === "D1")

        assert.equal(contract.a.maxScore, 60)
        assert.equal(contract.issueDescription, curatedBadCase().issueDescription)
        assert.deepEqual(deduction, {
            id: "D1",
            criterion: "Avoid recurrence of this badcase error: Undiagnosed identical retry loop",
            source: "badcase_deduction",
            mode: "penalty",
            maximumDeduction: 8,
            errorPattern: "Undiagnosed identical retry loop",
            matchCondition: "At least two equivalent failed calls occur without an intervening diagnosis",
            evidenceBasis: "Frozen badcase trace",
        })

        const judge = passingJudge(contract)
        judge.bAssessments.find((entry) => entry.criterionId === "D1").rating = 0
        const computed = calculateScore(contract, judge)
        assert.equal(computed.aScore, 60)
        assert.equal(computed.bScore, 32)
        assert.deepEqual(
            computed.bCriterionScores.find((entry) => entry.id === "D1"),
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
            },
        )
    })

    it("freezes only compact typed Evidence Catalog metadata into the score contract", () => {
        const catalog = evidenceCatalog()
        const contract = buildScoreContract(curatedCase(), {evidenceCatalog: catalog})

        assert.deepEqual(contract.evidence.allowedRefs, catalog.entries.map((entry) => entry.id))
        assert.equal(contract.evidence.typed, true)
        assert.deepEqual(contract.evidence.entries[2], {
            id: "trace:L1",
            source: "trace",
            kind: "skill_activation",
            kinds: ["skill_activation", "skill_read", "command"],
        })
        assert.equal("catalog" in contract.evidence, false)
        assert.equal(JSON.stringify(contract).includes("Skill contents"), false)
        assert.equal(JSON.stringify(contract).includes('"record"'), false)

        const mutated = JSON.parse(JSON.stringify(contract))
        mutated.evidence.entries[2].kinds = ["response"]
        assert.throws(() => validateJudgeResult(passingJudge(scoreContract()), mutated), /catalog|digest/i)
    })

    it("builds a prompt that enumerates every required Judge decision without asking for scores", () => {
        const catalog = evidenceCatalog()
        const contract = buildScoreContract(curatedCase(), {evidenceCatalog: catalog})
        const prompt = buildJudgePrompt({
            contract,
            question: curatedCase().question,
            response: "回答",
            traceEvidence: {items: [{id: "trace-1", type: "commandExecution"}]},
            evidenceCatalog: catalog,
            activationMode: "automatic",
        })

        for (const dimension of contract.a.dimensions) assert.match(prompt, new RegExp(dimension.id))
        for (const criterion of contract.b.criteria) assert.match(prompt, new RegExp(criterion.id))
        assert.match(prompt, /Do not return any score or verdict field/)
        assert.match(prompt, new RegExp(JUDGE_RESULT_SCHEMA.replaceAll("/", "\\/")))
        assert.match(prompt, /<evidence-catalog>/)
        assert.match(prompt, /Reviewer issue description.*context only/is)
        assert.match(prompt, /Skill contents/)
        assert.match(prompt, /"kind":"skill_activation"/)
    })

    it("treats absence as observable non-compliance when semantic Trace coverage is complete", () => {
        const catalog = evidenceCatalog()
        Object.assign(catalog.entries.find((entry) => entry.id === "trace:scope"), {
            semanticCoverageComplete: true,
            samplingStrategy: "semantic-v1",
            omittedImportantEntries: 0,
        })
        const contract = buildScoreContract(curatedCase(), {evidenceCatalog: catalog})
        const prompt = buildJudgePrompt({
            contract,
            question: curatedCase().question,
            response: "回答",
            traceEvidence: {semanticCoverageComplete: true},
            evidenceCatalog: catalog,
        })
        assert.match(prompt, /semanticCoverageComplete=true[\s\S]*score.*0[\s\S]*not_observable/i)

        const judged = passingJudge(contract)
        judged.aAssessments[0] = {
            dimensionId: "skill_activation",
            status: "not_observable",
            evidenceRefs: ["trace:scope"],
            rationale: "没有看到 Skill 事件。",
        }
        assert.throws(
            () => validateJudgeResult(judged, contract),
            /not_observable.*semantic Trace coverage is complete/i,
        )
    })

    it("requires positive A levels to cite a related strong typed entry when one exists", () => {
        const contract = buildScoreContract(curatedCase(), {evidenceCatalog: evidenceCatalog()})
        const judged = passingJudge(contract)
        const evidenceByDimension = {
            skill_activation: "trace:L1",
            required_references: "trace:L2",
            tool_policy: "trace:L4",
            workflow_order: "trace:L3",
            completeness_artifacts: "trace:L4",
            deterministic_processing: "trace:L4",
            evidence_output: "response",
            error_recovery: "response",
        }
        for (const entry of judged.aAssessments) {
            entry.evidenceRefs = [evidenceByDimension[entry.dimensionId]]
        }
        assert.doesNotThrow(() => validateJudgeResult(judged, contract))

        judged.aAssessments.find((entry) => entry.dimensionId === "skill_activation").evidenceRefs = ["response"]
        assert.throws(
            () => validateJudgeResult(judged, contract),
            /skill_activation.*typed evidence|typed evidence.*skill_activation/i,
        )

        judged.aAssessments.find((entry) => entry.dimensionId === "skill_activation").level = 0
        assert.doesNotThrow(() => validateJudgeResult(judged, contract))
    })

    it("keeps legacy untyped contracts valid and does not demand a kind absent from the catalog", () => {
        assert.doesNotThrow(() => validateJudgeResult(passingJudge(scoreContract()), scoreContract()))

        const catalog = evidenceCatalog()
        catalog.entries = catalog.entries.filter((entry) => !entry.kinds.includes("reference_read"))
        const contract = buildScoreContract(curatedCase(), {evidenceCatalog: catalog})
        const judged = passingJudge(contract)
        const evidenceByDimension = {
            skill_activation: "trace:L1",
            required_references: "response",
            tool_policy: "trace:L3",
            workflow_order: "trace:L3",
            completeness_artifacts: "trace:L4",
            deterministic_processing: "trace:L1",
            evidence_output: "response",
            error_recovery: "response",
        }
        for (const entry of judged.aAssessments) {
            entry.evidenceRefs = [evidenceByDimension[entry.dimensionId]]
        }
        assert.doesNotThrow(() => validateJudgeResult(judged, contract))
    })

    it("parses fenced JSON and requires exact ID coverage", () => {
        const contract = scoreContract()
        const result = passingJudge(contract)
        const parsed = parseJudgeResult(`review\n\`\`\`json\n${JSON.stringify(result)}\n\`\`\``, contract)
        assert.equal(parsed.contractDigest, contract.digest)

        const missing = passingJudge(contract)
        missing.aAssessments.pop()
        assert.throws(() => validateJudgeResult(missing, contract), /exactly cover A dimensions/i)

        const extra = passingJudge(contract)
        extra.bAssessments.push({...extra.bAssessments[0], criterionId: "B-extra"})
        assert.throws(() => validateJudgeResult(extra, contract), /exactly cover B criteria/i)
    })

    it("rejects Judge-supplied score or verdict fields and invalid not_applicable decisions", () => {
        const contract = scoreContract()
        const withScore = {...passingJudge(contract), totalScore: 100}
        assert.throws(() => validateJudgeResult(withScore, contract), /must not provide score or verdict/i)

        const withVerdict = passingJudge(contract)
        withVerdict.aAssessments[0].verdict = "pass"
        assert.throws(() => validateJudgeResult(withVerdict, contract), /must not provide score or verdict/i)

        const invalidNA = passingJudge(contract)
        invalidNA.aAssessments[1] = {
            dimensionId: "required_references",
            status: "not_applicable",
            evidenceRefs: [],
            rationale: "N/A",
        }
        assert.throws(() => validateJudgeResult(invalidNA, contract), /every A assessment must be scored or not_observable/i)

        const missingBScore = passingJudge(contract)
        missingBScore.bAssessments[0] = {
            ...missingBScore.bAssessments[0],
            status: "not_observable",
        }
        delete missingBScore.bAssessments[0].rating
        delete missingBScore.bAssessments[0].confidence
        assert.throws(
            () => validateJudgeResult(missingBScore, contract),
            /every B assessment must be scored/i,
        )

        const inventedEvidence = passingJudge(contract)
        inventedEvidence.aAssessments[0].evidenceRefs = ["trace:L999999"]
        assert.throws(
            () => validateJudgeResult(inventedEvidence, contract),
            /unknown evidence reference/i,
        )
    })

    it("rejects a mutated policy or contract digest before judging", () => {
        const contract = JSON.parse(JSON.stringify(scoreContract()))
        contract.a.passThreshold = 47
        assert.throws(() => validateJudgeResult(passingJudge(scoreContract()), contract), /fixed A policy/i)

        const mutated = JSON.parse(JSON.stringify(scoreContract()))
        mutated.b.criteria[0].weight = 100
        assert.throws(() => validateJudgeResult(passingJudge(scoreContract()), mutated), /digest does not match/i)
    })
})

describe("fixed A60 plus B40 calculator", () => {
    it("calculates 100 and passes when A reaches its threshold with all gates clear", () => {
        const contract = scoreContract()
        const computed = calculateScore(contract, passingJudge(contract))

        assert.equal(computed.aScore, 60)
        assert.equal(computed.bScore, 40)
        assert.equal(computed.totalScore, 100)
        assert.equal(computed.aVerdict, "pass")
        assert.equal(computed.overallVerdict, "pass")
    })

    it("uses the inclusive A48 threshold and never lets B decide pass or fail", () => {
        const contract = scoreContract()
        const atThreshold = passingJudge(contract)
        for (const id of ["deterministic_processing", "error_recovery"]) {
            atThreshold.aAssessments.find((entry) => entry.dimensionId === id).level = 0
        }
        for (const assessment of atThreshold.bAssessments) assessment.rating = 0

        const passing = calculateScore(contract, atThreshold)
        assert.equal(passing.aScore, 48)
        assert.equal(passing.bScore, 0)
        assert.equal(passing.totalScore, 48)
        assert.equal(passing.overallVerdict, "pass")

        atThreshold.aAssessments.find((entry) => entry.dimensionId === "evidence_output").level = 3
        const failing = calculateScore(contract, atThreshold)
        assert.equal(failing.aScore, 46.5)
        assert.equal(failing.overallVerdict, "fail")
    })

    it("uses only generic A compliance for the hard verdict", () => {
        const contract = scoreContract()
        const lowActivation = passingJudge(contract)
        lowActivation.aAssessments[0].level = 1
        assert.equal(calculateScore(contract, lowActivation).overallVerdict, "fail")

        const badCaseSpecificQuality = passingJudge(contract)
        for (const entry of badCaseSpecificQuality.bAssessments) entry.rating = 0
        const computed = calculateScore(contract, badCaseSpecificQuality)
        assert.equal(computed.bScore, 0)
        assert.equal(computed.overallVerdict, "pass")
    })

    it("never permits an A item to be skipped and treats missing evidence as indeterminate", () => {
        const contract = scoreContract()
        const notApplicable = passingJudge(contract)
        const recovery = notApplicable.aAssessments.find(
            (entry) => entry.dimensionId === "error_recovery",
        )
        Object.assign(recovery, {status: "not_applicable", level: undefined})
        delete recovery.level
        assert.throws(
            () => calculateScore(contract, notApplicable),
            /every A assessment must be scored or not_observable/i,
        )

        const notObservable = passingJudge(contract)
        const evidence = notObservable.aAssessments.find(
            (entry) => entry.dimensionId === "evidence_output",
        )
        Object.assign(evidence, {status: "not_observable", level: undefined})
        delete evidence.level
        const computed = calculateScore(contract, notObservable)
        assert.equal(computed.aScore, null)
        assert.equal(computed.totalScore, null)
        assert.equal(computed.aVerdict, "pass")
        assert.deepEqual(computed.unknownDimensions, ["evidence_output"])
        assert.deepEqual(computed.aScoreRange, {min: 54, max: 60})
        assert.equal(computed.aVerdict, "pass")
    })

    it("keeps a known activation gate failure decisive when another A item is unobservable", () => {
        const contract = scoreContract()
        const result = passingJudge(contract)
        result.aAssessments.find((entry) => entry.dimensionId === "skill_activation").level = 0
        const evidence = result.aAssessments.find(
            (entry) => entry.dimensionId === "evidence_output",
        )
        Object.assign(evidence, {status: "not_observable", level: undefined})
        delete evidence.level

        const computed = calculateScore(contract, result)
        assert.equal(computed.aScore, null)
        assert.equal(computed.aVerdict, "fail")
        assert.equal(computed.overallVerdict, "fail")
        assert.deepEqual(computed.criticalFailures, ["skill_activation_below_level_2"])
    })

    it("uses the fixed A score range to decide a verdict when unknown items cannot cross the threshold", () => {
        const contract = scoreContract()
        const definitelyFailing = passingJudge(contract)
        for (const id of ["skill_activation", "tool_policy", "workflow_order"]) {
            definitelyFailing.aAssessments.find((entry) => entry.dimensionId === id).level = 0
        }
        const unknownRecovery = definitelyFailing.aAssessments.find(
            (entry) => entry.dimensionId === "error_recovery",
        )
        Object.assign(unknownRecovery, {status: "not_observable", level: undefined})
        delete unknownRecovery.level
        const failed = calculateScore(contract, definitelyFailing)
        assert.equal(failed.aScore, null)
        assert.equal(failed.aScoreRange.max < A_PASS_THRESHOLD, true)
        assert.equal(failed.aVerdict, "fail")

        const crossing = passingJudge(contract)
        crossing.aAssessments.find((entry) => entry.dimensionId === "workflow_order").level = 0
        const unknownToolPolicy = crossing.aAssessments.find(
            (entry) => entry.dimensionId === "tool_policy",
        )
        Object.assign(unknownToolPolicy, {status: "not_observable", level: undefined})
        delete unknownToolPolicy.level
        const indeterminate = calculateScore(contract, crossing)
        assert.equal(indeterminate.aScoreRange.min < A_PASS_THRESHOLD, true)
        assert.equal(indeterminate.aScoreRange.max >= A_PASS_THRESHOLD, true)
        assert.equal(indeterminate.aVerdict, "indeterminate")
    })

    it("marks explicit activation runs diagnostic without changing their computed points", () => {
        const contract = scoreContract()
        const computed = calculateScore(contract, passingJudge(contract), {
            activationMode: "explicit",
        })
        assert.equal(computed.aScore, 60)
        assert.equal(computed.totalScore, null)
        assert.equal(computed.aVerdict, "diagnostic")
        assert.equal(computed.overallVerdict, "diagnostic")
    })

    it("keeps an automatic run diagnostic when the target runtime cannot bind the frozen Skill path", () => {
        const contract = scoreContract()
        const computed = calculateScore(contract, passingJudge(contract), {
            activationMode: "automatic",
            skillEvidenceBinding: "unverified",
        })

        assert.equal(computed.aScore, 60)
        assert.equal(computed.bScore, 40)
        assert.equal(computed.totalScore, null)
        assert.equal(computed.aVerdict, "diagnostic")
        assert.equal(computed.overallVerdict, "diagnostic")
        assert.deepEqual(computed.diagnosticReasons, ["target_skill_binding_unverified"])
    })
})
