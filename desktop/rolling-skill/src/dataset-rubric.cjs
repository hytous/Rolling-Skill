const {createHash} = require("node:crypto")

const DATASET_RUBRIC_SCHEMA = "rolling-skill-dataset-rubric/v1"
const RUBRIC_PROMPT_VERSION = "dataset-rubric-agent/v1"
const RUBRIC_ANCHOR_KEYS = Object.freeze(["0", "2", "5", "8", "10"])
const FORBIDDEN_AGENT_FIELD = /^(?:score|scores|totalScore|verdict|pass|passed|points|grade)$/iu

function copy(value) {
    return JSON.parse(JSON.stringify(value))
}

function deepFreeze(value) {
    if (!value || typeof value !== "object" || Object.isFrozen(value)) return value
    Object.freeze(value)
    for (const child of Object.values(value)) deepFreeze(child)
    return value
}

function canonicalJson(value) {
    if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`
    if (value && typeof value === "object") {
        return `{${Object.keys(value)
            .sort()
            .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
            .join(",")}}`
    }
    return JSON.stringify(value)
}

function datasetRubricDigest(value) {
    const normalized = validateDatasetRubric(value)
    return `sha256:${createHash("sha256").update(canonicalJson(normalized)).digest("hex")}`
}

function requireObject(value, label) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw new Error(`${label} must be an object`)
    }
    return value
}

function requireString(value, label) {
    const normalized = String(value ?? "").trim()
    if (!normalized) throw new Error(`${label} is required`)
    if (normalized.length > 20_000) throw new Error(`${label} is too long`)
    return normalized
}

function requireStringArray(value, label, {nonEmpty = false} = {}) {
    if (!Array.isArray(value)) throw new Error(`${label} must be an array`)
    const normalized = value.map((entry, index) => requireString(entry, `${label}[${index}]`))
    if (nonEmpty && !normalized.length) throw new Error(`${label} requires evidence entries`)
    return normalized
}

function rejectForbiddenFields(value, path = "Dataset rubric") {
    if (!value || typeof value !== "object") return
    for (const [key, child] of Object.entries(value)) {
        if (FORBIDDEN_AGENT_FIELD.test(key)) {
            throw new Error(`${path} must not provide score or verdict fields (${key})`)
        }
        rejectForbiddenFields(child, `${path}.${key}`)
    }
}

function requireAllowedKeys(value, keys, label) {
    const allowed = new Set(keys)
    const unknown = Object.keys(value).find((key) => !allowed.has(key))
    if (unknown) throw new Error(`${label} contains unsupported field ${unknown}`)
}

function validateDatasetRubric(value) {
    const source = copy(requireObject(value, "Dataset rubric"))
    rejectForbiddenFields(source)
    requireAllowedKeys(
        source,
        ["schemaVersion", "title", "summary", "criteria", "automaticFailures"],
        "Dataset rubric",
    )
    if (source.schemaVersion !== DATASET_RUBRIC_SCHEMA) {
        throw new Error(`Dataset rubric must use ${DATASET_RUBRIC_SCHEMA}`)
    }
    const title = requireString(source.title, "Dataset rubric title")
    const summary = requireString(source.summary, "Dataset rubric summary")
    if (!Array.isArray(source.criteria) || !source.criteria.length) {
        throw new Error("Dataset rubric requires at least one criterion")
    }
    const ids = new Set()
    const criteria = source.criteria.map((candidate, index) => {
        const entry = requireObject(candidate, `Dataset rubric criterion ${index + 1}`)
        requireAllowedKeys(
            entry,
            [
                "id",
                "title",
                "criterion",
                "weight",
                "evidenceRequirements",
                "scoringAnchors",
                "criticalFailure",
            ],
            `Dataset rubric criterion ${index + 1}`,
        )
        const id = requireString(entry.id, `Dataset rubric criterion ${index + 1} id`)
        if (!/^[A-Za-z][A-Za-z0-9_-]{0,63}$/u.test(id)) {
            throw new Error(`Dataset rubric criterion ${id} has an invalid id`)
        }
        if (ids.has(id)) throw new Error("Dataset rubric criterion ids must be unique")
        ids.add(id)
        const weight = Number(entry.weight)
        if (!Number.isFinite(weight) || weight <= 0 || weight > 1_000) {
            throw new Error(`Dataset rubric criterion ${id} weight must be positive`)
        }
        const scoringAnchors = requireObject(
            entry.scoringAnchors,
            `Dataset rubric criterion ${id} scoring anchors`,
        )
        if (
            Object.keys(scoringAnchors).length !== RUBRIC_ANCHOR_KEYS.length ||
            RUBRIC_ANCHOR_KEYS.some((key) => !(key in scoringAnchors))
        ) {
            throw new Error(
                `Dataset rubric criterion ${id} scoring anchors must cover ${RUBRIC_ANCHOR_KEYS.join(", ")}`,
            )
        }
        const normalizedAnchors = Object.fromEntries(
            RUBRIC_ANCHOR_KEYS.map((key) => [
                key,
                requireString(
                    scoringAnchors[key],
                    `Dataset rubric criterion ${id} anchor ${key}`,
                ),
            ]),
        )
        return {
            id,
            title: requireString(entry.title, `Dataset rubric criterion ${id} title`),
            criterion: requireString(entry.criterion, `Dataset rubric criterion ${id}`),
            weight,
            evidenceRequirements: requireStringArray(
                entry.evidenceRequirements,
                `Dataset rubric criterion ${id} evidence requirements`,
                {nonEmpty: true},
            ),
            scoringAnchors: normalizedAnchors,
            criticalFailure: Boolean(entry.criticalFailure),
        }
    })
    if (!Array.isArray(source.automaticFailures)) {
        throw new Error("Dataset rubric automaticFailures must be an array")
    }
    const automaticFailures = source.automaticFailures.map((candidate, index) => {
        const entry = requireObject(candidate, `Dataset rubric automatic failure ${index + 1}`)
        requireAllowedKeys(
            entry,
            ["id", "condition", "rationale"],
            `Dataset rubric automatic failure ${index + 1}`,
        )
        const id = requireString(entry.id, `Dataset rubric automatic failure ${index + 1} id`)
        if (!/^[A-Za-z][A-Za-z0-9_-]{0,63}$/u.test(id)) {
            throw new Error(`Dataset rubric automatic failure ${id} has an invalid id`)
        }
        if (ids.has(id)) throw new Error("Dataset rubric ids must be unique")
        ids.add(id)
        return {
            id,
            condition: requireString(entry.condition, `Dataset rubric automatic failure ${id}`),
            rationale: requireString(
                entry.rationale,
                `Dataset rubric automatic failure ${id} rationale`,
            ),
        }
    })
    return deepFreeze({
        schemaVersion: DATASET_RUBRIC_SCHEMA,
        title,
        summary,
        criteria,
        automaticFailures,
    })
}

function extractJson(text) {
    const source = String(text ?? "")
    const blocks = [...source.matchAll(/```(?:json)?\s*([\s\S]*?)```/giu)]
    for (const match of blocks.reverse()) {
        try {
            return JSON.parse(match[1].trim())
        } catch {
            // Try an earlier fenced object before falling back to a bare JSON object.
        }
    }
    const start = source.indexOf("{")
    const end = source.lastIndexOf("}")
    if (start >= 0 && end > start) return JSON.parse(source.slice(start, end + 1))
    throw new Error("Rubric Agent response does not contain a JSON rubric")
}

function parseDatasetRubric(text) {
    return validateDatasetRubric(extractJson(text))
}

function buildDatasetRubricPrompt({datasetName, skillReference, skillEvidence, baseVersion = null} = {}) {
    const baseRubric = baseVersion?.rubric ? validateDatasetRubric(baseVersion.rubric) : null
    return `You are the Rubric Agent for one Skill evaluation dataset. Design or revise the single
dataset-level result-quality rubric that every future Case Curator and Judge will inherit.

The application already owns an immutable 40-point generic Skill-compliance layer covering Skill
activation, required references, tool policy, workflow order, completeness/artifacts, deterministic
processing, evidence/output, and error recovery. Do not duplicate that generic layer unless the
selected Skill adds a concrete, Skill-specific obligation. Your rubric supplies the flexible
60-point layer. The application, not you, computes all scores and verdicts.

Read the frozen Skill and linked reference contents below. Derive stable criteria that apply across
the dataset, including Skill-specific execution obligations, result-quality dimensions, required
evidence, observable anchors, and truly critical result failures. Do not invent business truth or
Case-specific facts. Keep criterion ids stable when revising an existing rubric. Criteria weights
are relative positive weights and are normalized by the fixed calculator.

Return a short review note followed by exactly one complete JSON code block. Never return a score,
points, pass/fail decision, or verdict. The JSON must use this exact shape:
{
  "schemaVersion": "${DATASET_RUBRIC_SCHEMA}",
  "title": "short rubric title",
  "summary": "scope of this dataset rubric",
  "criteria": [{
    "id": "R1",
    "title": "short criterion title",
    "criterion": "observable Skill-specific quality requirement",
    "weight": 1,
    "evidenceRequirements": ["evidence the Judge should seek"],
    "scoringAnchors": {
      "0": "absent or contrary",
      "2": "minimal quality",
      "5": "materially incomplete",
      "8": "substantially complete with minor gaps",
      "10": "complete and well evidenced"
    },
    "criticalFailure": false
  }],
  "automaticFailures": [{
    "id": "RF1",
    "condition": "narrow observable failure condition",
    "rationale": "why this invalidates Skill-specific result quality"
  }]
}

Dataset: ${String(datasetName ?? "")}
Selected Skill: ${String(skillReference?.name ?? "")}
Frozen Skill evidence (authoritative source for this rubric):
<skill-evidence>${JSON.stringify(skillEvidence ?? null)}</skill-evidence>
${baseRubric ? `Published base rubric to revise while preserving compatible ids:\n<base-rubric>${JSON.stringify(baseRubric)}</base-rubric>` : "This dataset has no published rubric yet."}`
}

function buildRubricFollowUpPrompt(text) {
    return `Respond to the user's Rubric review message below.

If the user asks a question, answer conversationally and do not return JSON. If the user requests a
change, return a short review note followed by exactly one complete ${DATASET_RUBRIC_SCHEMA} JSON
code block. Never return a partial fragment. Preserve existing criterion ids unless their meaning is
being intentionally removed. Never provide scores, points, verdicts, or pass/fail decisions.

<user-review-message>${String(text ?? "").trim()}</user-review-message>`
}

module.exports = {
    DATASET_RUBRIC_SCHEMA,
    RUBRIC_ANCHOR_KEYS,
    RUBRIC_PROMPT_VERSION,
    buildDatasetRubricPrompt,
    buildRubricFollowUpPrompt,
    datasetRubricDigest,
    parseDatasetRubric,
    validateDatasetRubric,
}
