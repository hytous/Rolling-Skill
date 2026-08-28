function runtimeReportsSkill(response, skillReference, {
    allowNameOnly = false,
    expectedContentDigest = null,
} = {}) {
    for (const entry of response?.data ?? []) {
        for (const skill of entry.skills ?? []) {
            if (!skill?.enabled || skill.name !== skillReference.name) continue
            if (skill.path === skillReference.path) {
                if (!expectedContentDigest || skill.contentDigest === expectedContentDigest) return true
                continue
            }
            if (
                !expectedContentDigest &&
                allowNameOnly &&
                skill.evidencePrecision === "name-only" &&
                !skill.path
            ) return true
        }
    }
    return false
}

function dshInjectedSkillDigest(event, expectedName) {
    if (
        event?.type !== "user/message" ||
        event.data?.source?.kind !== "skill-invocation" ||
        String(event.data.source.name ?? "") !== expectedName
    ) return null
    for (const block of event.data?.content ?? []) {
        if (block?.type !== "text") continue
        const text = String(block.text ?? "")
        const opening = text.match(/<skill_content\s+name=(["'])([^"']+)\1[^>]*>/u)
        if (!opening || opening[2] !== expectedName) continue
        const instructions = text.match(
            /<skill_instructions>\r?\n?([\s\S]*?)\r?\n?<\/skill_instructions>/u,
        )
        if (instructions) return skillContentDigest(instructions[1])
    }
    return null
}

async function resolveSkillEvidenceBinding({
    descriptor,
    selectedRuntimeId,
    getSelectedRuntime,
    createClient,
    clientOptions,
    skillReference,
    expectedContentDigest = null,
}) {
    let temporaryClient = null
    try {
        const runtime = descriptor.runtimeId === selectedRuntimeId
            ? await getSelectedRuntime()
            : (temporaryClient = createClient(descriptor, clientOptions))
        if (temporaryClient) await temporaryClient.start()
        if (typeof runtime.listSkills !== "function") return "unverified"
        const response = await runtime.listSkills({forceReload: true})
        return runtimeReportsSkill(response, skillReference, {expectedContentDigest})
            ? "verified"
            : "unverified"
    } catch {
        return "unverified"
    } finally {
        if (temporaryClient) await temporaryClient.stop().catch(() => {})
    }
}

function resolveExecutedSkillEvidenceBinding({
    declaredBinding = "unverified",
    skillReference,
    skillEvidence,
    traceEvidence,
    expectedContentDigest = null,
    verifyContentDigest = true,
}) {
    const frozenSkill = skillEvidence?.files?.find((entry) => entry.path === "SKILL.md")
    expectedContentDigest = verifyContentDigest
        ? expectedContentDigest ?? (
            frozenSkill?.content === undefined ? null : skillContentDigest(frozenSkill.content)
        )
        : null
    const skillName = String(skillReference?.name ?? skillEvidence?.name ?? "")
    const observed = []
    for (const entry of traceEvidence?.entries ?? []) {
        const update = entry?.message?.params?.update ?? {}
        const event = entry?.message?.params?.event ?? {}
        const dshExplicitSkill =
            event.type === "user/message" &&
            event.data?.source?.kind === "skill-invocation"
                ? String(event.data.source.name ?? "")
                : ""
        const dshToolSkill = event.type === "tool/call" && event.data?.name === "skill"
            ? (() => {
                  try {
                      return String(JSON.parse(event.data.arguments ?? "{}").name ?? "")
                  } catch {
                      return ""
                  }
              })()
            : ""
        const observedSkill = update.rawInput?.skill ?? (dshExplicitSkill || dshToolSkill)
        if (String(observedSkill ?? "") !== skillName) continue
        observed.push({
            sequence: entry.sequence,
            contentDigest:
                update.skillContentDigest ?? dshInjectedSkillDigest(event, skillName),
        })
    }
    const matching = verifyContentDigest
        ? observed.find((entry) =>
            expectedContentDigest && entry.contentDigest === expectedContentDigest,
        )
        : null
    const observedDigests = observed.map((entry) => entry.contentDigest).filter(Boolean)
    const observedBinding = !verifyContentDigest
        ? observed.length ? "name_only" : "not_observed"
        : matching
          ? "matched"
          : observedDigests.length
            ? "mismatched"
            : observed.length
              ? "name_only"
              : "not_observed"
    const effectiveBinding = verifyContentDigest && observedBinding === "matched"
        ? "verified-by-trace"
        : verifyContentDigest && observedBinding === "mismatched"
          ? "unverified"
          : declaredBinding === "verified"
            ? "verified"
            : "unverified"
    return {
        declaredBinding: declaredBinding === "verified" ? "verified" : "unverified",
        observedBinding,
        effectiveBinding,
        skillName,
        expectedContentDigest,
        observedContentDigest: matching?.contentDigest ?? observedDigests.at(-1) ?? null,
        evidenceSequences: observed.map((entry) => entry.sequence),
    }
}

module.exports = {
    resolveExecutedSkillEvidenceBinding,
    resolveSkillEvidenceBinding,
    runtimeReportsSkill,
}
const {skillContentDigest} = require("./skill-content.cjs")
