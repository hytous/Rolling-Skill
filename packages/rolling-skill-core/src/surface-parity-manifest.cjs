const FAMILIES = Object.freeze([
    {prefix: "SH", count: 12, family: "Shell and native conversation", dshOwner: "DSH native shell with additive Rolling Skill extensions"},
    {prefix: "CV", count: 11, family: "Native conversation curation", dshOwner: "DSH conversation slots and trusted Host evidence"},
    {prefix: "DC", count: 16, family: "Dataset, Case, and Raw Case", dshOwner: "Rolling Skill workbench and Shared Core"},
    {prefix: "CU", count: 12, family: "Curation Draft lifecycle", dshOwner: "Rolling Skill review workbench and CurationManager"},
    {prefix: "RB", count: 8, family: "Dataset Rubric", dshOwner: "Rolling Skill rubric workbench and RubricManager"},
    {prefix: "MS", count: 12, family: "Managed Skill and Installation", dshOwner: "Rolling Skill Skill workbench and Host managers"},
    {prefix: "EV", count: 11, family: "Skill Evaluation", dshOwner: "Rolling Skill evaluation workbench and EvaluationRunner"},
    {prefix: "AC", count: 11, family: "Automatic Capture", dshOwner: "Rolling Skill workbench, Host, and one-shot Worker"},
    {prefix: "OP", count: 9, family: "Operator", dshOwner: "Rolling Skill Operator workbench and control plane"},
    {prefix: "OZ", count: 7, family: "Optimization", dshOwner: "Rolling Skill Optimization workbench and control plane"},
    {prefix: "ST", count: 10, family: "Settings and distribution", dshOwner: "DSH Settings, sidebar workbench, and plugin package"},
    {prefix: "DS", count: 5, family: "DSH-specific integration", dshOwner: "DSH Host API and Agent tools"},
    {prefix: "QL", count: 12, family: "Cross-cutting quality", dshOwner: "Shared Core, DSH adapters, and native UI"},
])

const GREEN = new Set([
    "CV-01", "CV-02", "CV-03", "CV-04", "CV-05", "CV-06", "CV-07", "CV-08", "CV-09", "CV-10", "CV-11",
    "DC-01", "DC-03", "DC-04", "DC-05", "DC-06", "DC-07", "DC-08", "DC-11", "DC-12",
    "CU-01", "CU-03", "CU-04", "CU-05", "CU-06", "CU-07", "CU-08", "CU-09", "CU-10", "CU-11",
    "RB-01", "RB-03", "RB-04", "RB-05", "RB-06", "RB-07",
    "MS-01", "MS-02", "MS-03", "MS-04", "MS-05", "MS-07", "MS-08", "MS-09", "MS-11", "MS-12",
    "EV-01", "EV-02", "EV-03", "EV-04", "EV-05", "EV-06", "EV-08", "EV-09", "EV-10", "EV-11",
    "AC-01", "AC-02", "AC-03", "AC-04", "AC-05", "AC-06", "AC-07", "AC-08", "AC-09", "AC-10", "AC-11",
    "OP-01", "OP-02", "OP-03", "OP-04", "OP-05", "OP-06", "OP-07", "OP-08", "OP-09",
    "OZ-01", "OZ-02", "OZ-03", "OZ-04", "OZ-05", "OZ-06", "OZ-07",
    "ST-01", "ST-02", "ST-04", "ST-05", "ST-07", "ST-08",
    "DS-01", "DS-02", "DS-03", "DS-04", "DS-05",
    "QL-01", "QL-02", "QL-03", "QL-04", "QL-05", "QL-06", "QL-07", "QL-08", "QL-10", "QL-11", "QL-12",
])

const IMPLEMENTATION_BY_PREFIX = Object.freeze({
    SH: "DSH native shell; plugin registers only additive slots in packages/rolling-skill-dsh/src/client/index.tsx",
    CV: "packages/rolling-skill-dsh/src/client/conversation and packages/rolling-skill-dsh/src/host/session-evidence.cjs",
    DC: "packages/rolling-skill-dsh/src/client/workbench Dataset/Case/Raw Case panels and packages/rolling-skill-core/src/case-services.cjs",
    CU: "packages/rolling-skill-dsh/src/client/workbench/Curation*.tsx and desktop/rolling-skill/src/curation-manager.cjs",
    RB: "packages/rolling-skill-dsh/src/client/workbench/Rubric*.tsx and desktop/rolling-skill/src/rubric-manager.cjs",
    MS: "packages/rolling-skill-dsh/src/client/workbench/SkillsPanel.tsx and packages/rolling-skill-core/src/skill-services.cjs",
    EV: "packages/rolling-skill-dsh/src/client/workbench/EvaluationsPanel.tsx and packages/rolling-skill-core/src/evaluation-services.cjs",
    AC: "packages/rolling-skill-dsh/src/client/workbench/AutomaticCapturePanel.tsx and packages/rolling-skill-core/src/automatic-capture-service.cjs",
    OP: "packages/rolling-skill-dsh/src/client/workbench/OperatorPanel.tsx and packages/rolling-skill-core/src/operator-services.cjs",
    OZ: "packages/rolling-skill-dsh/src/client/workbench/OptimizationPanel.tsx and packages/rolling-skill-core/src/operator-services.cjs",
    ST: "packages/rolling-skill-dsh/src/client/settings, workbench launcher, package scripts, and manifest",
    DS: "packages/rolling-skill-dsh/src/host and packages/rolling-skill-dsh/src/tools.cjs",
    QL: "Shared Core validation, durable Stores, Host boundary, and DSH native client",
})

const TEST_BY_PREFIX = Object.freeze({
    SH: "real DSH browser acceptance is required; source contracts prevent replacement slots",
    CV: "session-evidence.test.cjs, conversation-markers.test.cjs, client-source.test.cjs",
    DC: "case-services.test.cjs and client-source.test.cjs",
    CU: "curation-manager.test.cjs, application.test.cjs, curation-client.test.cjs",
    RB: "rubric-manager.test.cjs, application.test.cjs, rubric-client.test.cjs",
    MS: "skill-services.test.cjs, skill-installation-store.test.cjs, client-source.test.cjs",
    EV: "evaluation-services.test.cjs, evaluation-runner.test.cjs, client-source.test.cjs",
    AC: "automatic-capture-service.test.cjs, worker.test.cjs, client-source.test.cjs",
    OP: "operator-services.test.cjs and operator control-plane desktop tests",
    OZ: "operator-services.test.cjs and optimization control-plane desktop tests",
    ST: "distribution-contract.test.cjs, manifest.test.cjs, client-source.test.cjs",
    DS: "host-api.test.cjs, host-plugin.test.cjs, tools.test.cjs",
    QL: "Shared Core and Electron complete regression suites",
})

const INTENTIONAL_DIFFERENCE = Object.freeze({
    "ST-06": "DSH owns plugin installation; Rolling Skill does not reproduce Electron Runtime-plugin management.",
    "ST-10": "The signed Electron .app remains a separately built archived-branch deliverable.",
})

const SURFACE_PARITY_MANIFEST = Object.freeze(FAMILIES.flatMap((definition) =>
    Array.from({length: definition.count}, (_, index) => {
        const id = `${definition.prefix}-${String(index + 1).padStart(2, "0")}`
        const status = GREEN.has(id)
            ? "green"
            : definition.prefix === "SH" || id === "ST-03"
                ? "baseline"
                : "red"
        return Object.freeze({
            id,
            family: definition.family,
            electronOwner: `Electron baseline capability ${id}`,
            dshOwner: definition.dshOwner,
            status,
            implementation: status === "red"
                ? `Gap tracked against ${IMPLEMENTATION_BY_PREFIX[definition.prefix]}`
                : IMPLEMENTATION_BY_PREFIX[definition.prefix],
            automatedEvidence: status === "red"
                ? `Pending exact gap coverage; family evidence: ${TEST_BY_PREFIX[definition.prefix]}`
                : TEST_BY_PREFIX[definition.prefix],
            uiEvidence: status === "ui-verified"
                ? "Verified in the installed DSH browser"
                : "Pending installed DSH browser verification",
            approvedDifference: INTENTIONAL_DIFFERENCE[id] ?? "None",
        })
    }),
))

function surfaceParityReport() {
    const byStatus = {baseline: 0, red: 0, green: 0, "ui-verified": 0}
    for (const entry of SURFACE_PARITY_MANIFEST) byStatus[entry.status] += 1
    return {
        total: SURFACE_PARITY_MANIFEST.length,
        byStatus,
        gaps: SURFACE_PARITY_MANIFEST
            .filter((entry) => entry.status === "red" || entry.status === "baseline")
            .map((entry) => entry.id),
    }
}

module.exports = {SURFACE_PARITY_MANIFEST, surfaceParityReport}
