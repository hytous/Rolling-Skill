"use strict"

const {createHash} = require("node:crypto")

const OPTIMIZATION_PLAYBOOK_ID = "rolling-skill-optimization"
const OPTIMIZATION_PLAYBOOK_VERSION = 1

const PLAYBOOK_CONTENT = `# Rolling Skill Optimization Playbook v1

## 1. 从用户视角理解完整 Skill

- 阅读 SKILL.md，以及它实际引用的 references、scripts 和 assets。
- 明确 Skill 的触发场景、用户目标、输入输出、工具依赖、权限前提和失败恢复路径。
- 按真实用户旅程检查完整功能，不要把优化缩小成几个断言、一个局部文案补丁或单次工具调用。

## 2. 建立证据矩阵

- 对照基线、上一候选和本轮结果，逐 Case 查看执行与评分证据。
- 记录失败断言、Judge 理由、Runtime 错误、可用 Trace 中的实际行为和用户反馈。
- 区分 Skill 缺陷、Runtime 或服务故障、数据缺失和 Judge 证据不足；不要把偶发基础设施故障当成 Skill 质量退化。
- 先寻找跨 Case 的共同原因，再决定修改点；没有证据时明确标注未知，不虚构结论。

## 3. 形成可泛化修改

- 修复共同原因，不复制 Case 问题、参考答案、金额、ID 或其他测试专属数据。
- 检查 description 与触发条件、工作流完整性、Tool 参数与分页、数据校验、错误恢复、输出格式和可复查性。
- 适合程序化验证的步骤优先使用确定性脚本；主 Skill 保持精简，细节放入按需读取的 reference 或脚本。
- 保留有效能力，不为迎合单个 Case 删除功能；不要因有效执行路径与示例顺序不同而机械改写。

## 4. 自检候选版本

- 检查修改文件、引用关系、脚本入口和用户可见行为。
- 运行与修改直接相关的确定性测试和静态检查，并从用户入口完成必要的手动检查。
- 确认候选确有变化、没有无关文件污染、没有明显功能删减，也没有按测试答案写死。
- 用简洁摘要说明改了什么、依据什么证据、预期影响是什么，再调用控制器要求的 Candidate Tool；版本创建、安装和评测由控制器完成。

## 5. 根据完整回归决定下一步

- 比较基线、上一轮和本轮的逐 Case 结果，检查新增通过、持续失败、明显回归、证据缺失和跨 Runtime 差异。
- 只根据真实回归证据决策，不虚构缺失分数，也不把 Runtime 或服务失败解释为 Skill 退化。
- 有明确且可泛化的下一步时继续；已经充分改善且没有值得继续的证据时结束；无法安全推进时暂停并说明事实原因。
- 最终结论必须同时考虑用户优化方向、完整用户体验和固定评测回归，而不是只看单一总分。`

const PLAYBOOK_SOURCES = [
    {
        title: "Agent Skills: Evaluating skills",
        url: "https://agentskills.io/skill-creation/evaluating-skills",
        retrievedAt: "2026-08-14T03:38:30.000Z",
    },
    {
        title: "Agent Skills: Optimizing descriptions",
        url: "https://agentskills.io/skill-creation/optimizing-descriptions",
        retrievedAt: "2026-08-14T03:38:30.000Z",
    },
    {
        title: "OpenAI: Agent evals",
        url: "https://developers.openai.com/api/docs/guides/agent-evals",
        retrievedAt: "2026-08-14T03:38:30.000Z",
    },
    {
        title: "OpenAI: Prompt optimizer",
        url: "https://developers.openai.com/api/docs/guides/prompt-optimizer",
        retrievedAt: "2026-08-14T03:38:30.000Z",
    },
    {
        title: "Anthropic: Demystifying evals for AI agents",
        url: "https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents",
        retrievedAt: "2026-08-14T03:38:30.000Z",
    },
    {
        title: "DSPy: GEPA optimization",
        url: "https://dspy.ai/getting-started/gepa-optimization/",
        retrievedAt: "2026-08-14T03:38:30.000Z",
    },
]

const DANGEROUS_KEYS = new Set(["__proto__", "prototype", "constructor"])

function isPlainObject(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false
    const prototype = Object.getPrototypeOf(value)
    return prototype === Object.prototype || prototype === null
}

function exactKeys(value, expected, label) {
    if (!isPlainObject(value)) throw new Error(`${label} must be a plain object`)
    const actual = Object.keys(value)
    for (const key of actual) {
        if (DANGEROUS_KEYS.has(key)) throw new Error(`${label} contains an unsafe field`)
        if (!expected.includes(key)) throw new Error(`${label} contains unsupported field ${key}`)
    }
    for (const key of expected) {
        if (!Object.hasOwn(value, key)) throw new Error(`${label} is missing field ${key}`)
    }
}

function normalizedText(value, label, maximum) {
    const normalized = typeof value === "string" ? value.trim() : ""
    if (!normalized) throw new Error(`${label} is required`)
    if (normalized.length > maximum) throw new Error(`${label} is too long`)
    if (/\u0000/u.test(normalized)) throw new Error(`${label} contains unsupported characters`)
    return normalized
}

function canonicalJson(value) {
    if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`
    if (value !== null && typeof value === "object") {
        return `{${Object.keys(value).sort().map((key) => (
            `${JSON.stringify(key)}:${canonicalJson(value[key])}`
        )).join(",")}}`
    }
    return JSON.stringify(value)
}

function playbookDigest(value) {
    return `sha256:${createHash("sha256").update(canonicalJson(value), "utf8").digest("hex")}`
}

function deepFreeze(value) {
    if (!value || typeof value !== "object" || Object.isFrozen(value)) return value
    for (const child of Object.values(value)) deepFreeze(child)
    return Object.freeze(value)
}

function validateSource(value, index) {
    const label = `Optimization Playbook source ${index + 1}`
    exactKeys(value, ["title", "url", "retrievedAt"], label)
    const title = normalizedText(value.title, `${label} title`, 300)
    const url = normalizedText(value.url, `${label} URL`, 2_048)
    let parsedUrl
    try {
        parsedUrl = new URL(url)
    } catch {
        throw new Error(`${label} URL must be valid HTTPS`)
    }
    if (parsedUrl.protocol !== "https:" || parsedUrl.username || parsedUrl.password) {
        throw new Error(`${label} URL must be valid HTTPS`)
    }
    const retrievedAt = normalizedText(value.retrievedAt, `${label} retrievedAt`, 100)
    if (
        !Number.isFinite(Date.parse(retrievedAt)) ||
        new Date(retrievedAt).toISOString() !== retrievedAt
    ) {
        throw new Error(`${label} retrievedAt must be a canonical timestamp`)
    }
    return {title, url: parsedUrl.toString(), retrievedAt}
}

function validateOptimizationPlaybook(value) {
    exactKeys(value, ["id", "version", "digest", "content", "sources"], "Optimization Playbook")
    const id = normalizedText(value.id, "Optimization Playbook id", 200)
    if (!Number.isSafeInteger(value.version) || value.version < 1) {
        throw new Error("Optimization Playbook version must be a positive integer")
    }
    const content = normalizedText(value.content, "Optimization Playbook content", 64 * 1_024)
    if (!Array.isArray(value.sources) || value.sources.length === 0 || value.sources.length > 64) {
        throw new Error("Optimization Playbook sources must be a bounded non-empty array")
    }
    const sources = value.sources.map(validateSource)
    const digest = normalizedText(value.digest, "Optimization Playbook digest", 80)
    if (!/^sha256:[a-f0-9]{64}$/u.test(digest)) {
        throw new Error("Optimization Playbook digest must be SHA-256")
    }
    const body = {id, version: value.version, content, sources}
    if (playbookDigest(body) !== digest) {
        throw new Error("Optimization Playbook digest does not match its immutable content")
    }
    return deepFreeze({...body, digest})
}

const PLAYBOOK_BODY = {
    id: OPTIMIZATION_PLAYBOOK_ID,
    version: OPTIMIZATION_PLAYBOOK_VERSION,
    content: PLAYBOOK_CONTENT,
    sources: PLAYBOOK_SOURCES,
}
const CURRENT_PLAYBOOK = validateOptimizationPlaybook({
    ...PLAYBOOK_BODY,
    digest: playbookDigest(PLAYBOOK_BODY),
})

function currentOptimizationPlaybook() {
    return CURRENT_PLAYBOOK
}

module.exports = {
    OPTIMIZATION_PLAYBOOK_ID,
    OPTIMIZATION_PLAYBOOK_VERSION,
    currentOptimizationPlaybook,
    validateOptimizationPlaybook,
}
