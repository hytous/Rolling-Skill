const {app, BrowserWindow} = require("electron")
const {mkdtempSync, rmSync, writeFileSync} = require("node:fs")
const {tmpdir} = require("node:os")
const {join} = require("node:path")

const temporaryDirectory = mkdtempSync(join(tmpdir(), "rolling-skill-renderer-smoke-"))
app.setPath("userData", join(temporaryDirectory, "profile"))

async function waitFor(window, expression, timeoutMs = 5_000) {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
        try {
            if (await window.webContents.executeJavaScript(`Boolean(${expression})`)) return
        } catch (error) {
            throw new Error(`Renderer wait expression failed: ${expression}`, {cause: error})
        }
        await new Promise((resolve) => setTimeout(resolve, 25))
    }
    throw new Error(`Timed out waiting for: ${expression}`)
}

async function inspect(window, expression) {
    try {
        return await window.webContents.executeJavaScript(`(${expression})`)
    } catch (error) {
        throw new Error(`Renderer expression failed: ${expression}`, {cause: error})
    }
}

async function run() {
    await app.whenReady()
    const rendererErrors = []
    const window = new BrowserWindow({
        width: Number(process.env.ROLLING_SKILL_RENDERER_SMOKE_WIDTH) || 1_180,
        height: Number(process.env.ROLLING_SKILL_RENDERER_SMOKE_HEIGHT) || 800,
        show: false,
        webPreferences: {
            preload: join(__dirname, "renderer-smoke-preload.cjs"),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
            partition: `temp:rolling-skill-renderer-smoke-${Date.now()}`,
        },
    })
    window.webContents.on("console-message", (_event, details) => {
        const level = typeof details === "object" ? details.level : null
        const message = typeof details === "object" ? details.message : String(details ?? "")
        if (level === "error") rendererErrors.push(message)
    })
    await window.loadFile(join(__dirname, "..", "renderer", "index.html"))
    await waitFor(
        window,
        'document.querySelector("[data-thread-id=thread-a].active") && !document.querySelector(".loading-conversation") && document.querySelector(".message-body h2")',
    )

    const markdownAndActivity = await inspect(
        window,
        `(() => ({
            heading: document.querySelector(".message-body h2")?.textContent,
            tableCells: document.querySelectorAll(".message-body table td").length,
            code: document.querySelector(".message-body pre code")?.textContent,
            activity: [...document.querySelectorAll(".activity-card")].map((entry) => entry.textContent),
            scrollBehavior: getComputedStyle(document.querySelector("#conversation-scroll")).scrollBehavior,
            anchors: [...document.querySelectorAll(".message-body a")].map((entry) => ({
                external: entry.dataset.externalUrl || null,
                local: entry.dataset.localPath || null,
            })),
            images: document.querySelectorAll(".message-body img").length,
            scripts: document.querySelectorAll(".message-body script").length,
            codeLinks: document.querySelectorAll(".message-body code a").length,
            text: document.querySelector(".message.assistant .message-body")?.textContent,
            rightAligned: getComputedStyle(document.querySelector(".message-body td[data-align=right]")).textAlign,
        }))()`,
    )
    if (markdownAndActivity.heading !== "Alpha result") throw new Error("Markdown heading missing")
    if (markdownAndActivity.tableCells !== 2) throw new Error("Markdown table missing")
    if (markdownAndActivity.code !== "echo A/B") throw new Error("Markdown code block missing")
    if (markdownAndActivity.images || markdownAndActivity.scripts || markdownAndActivity.codeLinks) {
        throw new Error("Unsafe or code-contained Markdown created active DOM")
    }
    if (!markdownAndActivity.anchors.some((entry) => entry.external === "https://example.com/docs")) {
        throw new Error("Safe external Markdown link missing")
    }
    if (!markdownAndActivity.anchors.some((entry) => entry.local === "/tmp/rolling-skill-renderer-smoke/report.md")) {
        throw new Error("Safe local Markdown link missing")
    }
    if (markdownAndActivity.anchors.length !== 2) throw new Error("Rejected links became active")
    if (!markdownAndActivity.text.includes("[route](/v1/responses)")) {
        throw new Error("Rejected route link did not remain text")
    }
    if (markdownAndActivity.rightAligned !== "right") throw new Error("GFM table alignment missing")
    for (const expected of ["billing-cli cost query", "billing/query_cost", "/root/reviewer", "上下文已压缩"]) {
        if (!markdownAndActivity.activity.some((entry) => entry.includes(expected))) {
            throw new Error(`Activity card missing: ${expected}`)
        }
    }
    if (markdownAndActivity.activity.some((entry) => entry.includes("huge-noisy-shell-output"))) {
        throw new Error("Command activity exposed shell output")
    }
    if (markdownAndActivity.scrollBehavior !== "auto") {
        throw new Error(`Conversation scrolling is animated: ${markdownAndActivity.scrollBehavior}`)
    }

    await inspect(window, 'document.querySelector("[data-surface=evaluation]").click()')
    await waitFor(window, 'document.querySelector("[data-evaluation-case-id=case-smoke] strong")')
    const caseCard = await inspect(window, `(() => ({
        title: document.querySelector("[data-evaluation-case-id=case-smoke] strong")?.textContent,
        text: document.querySelector("[data-evaluation-case-id=case-smoke]")?.textContent,
    }))()`)
    if (caseCard.title !== "查一下7月份账单，各业务混元3多少成本？") {
        throw new Error(`Case card did not use the first source question: ${caseCard.title}`)
    }
    if (caseCard.title.includes("用户后来对这个 Case 的评价")) {
        throw new Error("Case card used the later user review as its title")
    }
    await inspect(window, 'document.querySelector("[data-calibrate-evaluation-case=case-smoke]").click()')
    await waitFor(
        window,
        'document.querySelector("#curation-drawer").classList.contains("visible") && document.querySelector("[data-curation-id=curation-calibration-smoke].active")',
    )
    const calibrationDrawer = await inspect(window, `(() => ({
        text: document.querySelector("#curation-drawer")?.textContent,
        input: window.rollingSkill.smokeLastCalibrationInput(),
    }))()`)
    if (
        calibrationDrawer.input?.datasetId !== "dataset-smoke" ||
        calibrationDrawer.input?.caseId !== "case-smoke"
    ) {
        throw new Error("Case calibration did not inherit the selected dataset and Case")
    }
    if (
        !calibrationDrawer.text.includes("Case 校准") ||
        !calibrationDrawer.text.includes("当前已保存总结") ||
        !calibrationDrawer.text.includes("Verified case summary")
    ) {
        throw new Error(`Case calibration drawer is missing frozen context: ${calibrationDrawer.text}`)
    }
    await inspect(window, 'document.querySelector("[data-discard-curation=curation-calibration-smoke]").click()')
    await waitFor(window, 'document.querySelector("#discard-curation-dialog").open')
    await inspect(window, 'document.querySelector("#confirm-discard").click()')
    await waitFor(window, '!document.querySelector("[data-curation-id=curation-calibration-smoke]")')
    await inspect(window, 'document.querySelector("#close-curations").click()')
    await inspect(window, 'window.rollingSkill.smokeResetCalibrationCases()')

    await waitFor(window, 'document.querySelector("[data-start-calibration-batch]")')
    await inspect(window, 'document.querySelector("[data-start-calibration-batch]").click()')
    await waitFor(window, `window.rollingSkill.smokeCalibrationMetrics().created.join(",") === "case-smoke"`)
    await waitFor(window, 'document.querySelector("#curation-drawer").classList.contains("visible") && document.querySelector("[data-stop-calibration-batch]")')
    await inspect(window, 'window.rollingSkill.smokeEmitCalibrationReady("case-smoke")')
    await waitFor(window, `window.rollingSkill.smokeCalibrationMetrics().archived.join(",") === "case-smoke"`)
    await waitFor(window, `window.rollingSkill.smokeCalibrationMetrics().created.join(",") === "case-smoke,case-smoke-2"`)
    await inspect(window, 'window.rollingSkill.smokeEmitCalibrationReady("case-smoke-2")')
    await waitFor(window, `window.rollingSkill.smokeCalibrationMetrics().archived.join(",") === "case-smoke,case-smoke-2"`)
    await waitFor(window, '!document.querySelector(".case-calibration")')
    const automaticCalibration = await inspect(window, `window.rollingSkill.smokeCalibrationMetrics()`)
    if (automaticCalibration.created.join(",") !== "case-smoke,case-smoke-2" ||
        automaticCalibration.archived.join(",") !== "case-smoke,case-smoke-2") {
        throw new Error(`Automatic calibration was not serialized and saved: ${JSON.stringify(automaticCalibration)}`)
    }

    await inspect(window, 'window.rollingSkill.smokeResetCalibrationCases()')
    await inspect(window, 'document.querySelector("#refresh-evaluation").click()')
    await waitFor(window, 'document.querySelector("[data-start-calibration-batch]")')
    await inspect(window, 'document.querySelector("[data-start-calibration-batch]").click()')
    await waitFor(window, `window.rollingSkill.smokeCalibrationMetrics().created.join(",") === "case-smoke"`)
    await inspect(window, 'document.querySelector("#curation-detail [data-stop-calibration-batch]").click()')
    await waitFor(window, `window.rollingSkill.smokeCalibrationMetrics().discarded.join(",") === "case-smoke"`)
    await new Promise((resolve) => setTimeout(resolve, 100))
    const stoppedCalibration = await inspect(window, `window.rollingSkill.smokeCalibrationMetrics()`)
    if (stoppedCalibration.created.includes("case-smoke-2")) {
        throw new Error(`Stopping calibration started another Case: ${JSON.stringify(stoppedCalibration)}`)
    }
    await inspect(window, 'document.querySelector("#close-curations").click()')
    const datasetBinding = await inspect(window, `(() => ({
        operationSkill: Boolean(document.querySelector("#evaluation-skill")),
        status: document.querySelector("#evaluation-dataset-skill-status")?.textContent,
        createSkill: document.querySelector("#evaluation-new-dataset-skill")?.value,
    }))()`)
    if (datasetBinding.operationSkill || !datasetBinding.status.includes("billing-cost-management")) {
        throw new Error("Evaluation did not inherit and display the dataset Skill binding")
    }
    if (!datasetBinding.createSkill) {
        throw new Error("Dataset creation did not require an enabled Skill")
    }
    await inspect(window, 'document.querySelector("#export-evaluation-dataset").click()')
    await waitFor(window, 'document.querySelector("#export-dataset-dialog").open')
    const exportDialog = await inspect(window, `(() => ({
        caseScopes: [...document.querySelectorAll("#export-case-scope option")].map((option) => option.value),
        outputModes: [...document.querySelectorAll("#export-output-mode option")].map((option) => option.value),
        help: document.querySelector("#export-dataset-dialog .field-help")?.textContent,
    }))()`)
    if (!exportDialog.caseScopes.includes("goodcase") || !exportDialog.outputModes.includes("original")) {
        throw new Error("Dataset export choices are missing")
    }
    if (!exportDialog.help.includes("Assistant") || !exportDialog.help.includes("工具输出")) {
        throw new Error(`Original-output export explanation is unclear: ${exportDialog.help}`)
    }
    await inspect(window, 'document.querySelector("#close-export-dataset-dialog").click()')
    const rubricStatus = await inspect(
        window,
        'document.querySelector("#evaluation-dataset-rubric-status")?.textContent',
    )
    if (!rubricStatus.includes("账单结果质量标准") || !rubricStatus.includes("评分标准草稿已就绪")) {
        throw new Error(`Reviewable dataset rubric draft status missing: ${rubricStatus}`)
    }
    await inspect(window, 'document.querySelector("#manage-dataset-rubric").click()')
    await waitFor(
        window,
        'document.querySelector("#rubric-drawer").classList.contains("visible") && document.querySelector("[data-publish-rubric=rubric-session-smoke]")',
    )
    const rubricDrawer = await inspect(window, `(() => ({
        text: document.querySelector("#rubric-drawer")?.textContent,
        effort: document.querySelector("[data-rubric-effort=rubric-session-smoke]")?.value,
        modelOptions: document.querySelectorAll("[data-rubric-model=rubric-session-smoke] option").length,
    }))()`)
    for (const expected of ["v1", "账单结果质量标准", "R1", "RF1", "把跨业务线归因写得更清楚。", "发布评分标准"]) {
        if (!rubricDrawer.text.includes(expected)) {
            throw new Error(`Rubric drawer missing: ${expected}`)
        }
    }
    if (rubricDrawer.effort !== "high" || !rubricDrawer.modelOptions) {
        throw new Error("Rubric Agent model or reasoning controls are missing")
    }
    await inspect(window, `window.rollingSkill.smokeEmitRubricChanged({
        status: "running",
        rubricAgent: {currentTurnId: "rubric-turn-running"},
    })`)
    await waitFor(window, 'document.querySelector("[data-rubric-activity=rubric-session-smoke]")')
    await inspect(window, 'window.__rubricConversationBeforeActivity = document.querySelector("#rubric-detail .curator-conversation")')
    await inspect(window, `window.rollingSkill.smokeEmitRubricActivity({
        sessionId: "rubric-session-smoke",
        stage: "command",
        summary: "sed -n 1,400p billing-cost-management/SKILL.md",
        startedAt: Date.now() - 1000,
        lastActivityAt: Date.now(),
        terminal: false,
    })`)
    await waitFor(window, 'document.querySelector("[data-rubric-activity=rubric-session-smoke]")?.textContent.includes("sed -n 1,400p")')
    const rubricActivityPatched = await inspect(
        window,
        'window.__rubricConversationBeforeActivity === document.querySelector("#rubric-detail .curator-conversation")',
    )
    if (!rubricActivityPatched) {
        throw new Error("Rubric activity rebuilt the complete drawer instead of patching its status card")
    }
    await inspect(window, `window.rollingSkill.smokeEmitRubricActivity({
        sessionId: "rubric-session-smoke",
        terminal: true,
    })`)
    await inspect(window, `window.rollingSkill.smokeEmitRubricChanged({
        status: "needs_review",
        rubricAgent: {currentTurnId: null},
    })`)
    await waitFor(window, 'document.querySelector("[data-publish-rubric=rubric-session-smoke]")')
    await inspect(window, 'document.querySelector("#close-rubric-drawer").click()')
    await waitFor(window, '!document.querySelector("#rubric-drawer").classList.contains("visible")')
    await inspect(window, 'document.querySelector("[data-evaluation-view=runs]").click()')
    await waitFor(window, 'document.querySelector("[data-evaluation-run-id=run-smoke]")')
    const evaluationDuration = await inspect(
        window,
        'document.querySelector("#evaluation-run-detail")?.textContent',
    )
    if (!evaluationDuration.includes("1:05") || evaluationDuration.includes("65000 ms")) {
        throw new Error(`Evaluation duration did not use minute-second format: ${evaluationDuration}`)
    }
    await inspect(window, 'document.querySelector("[data-surface=chat]").click()')

    await inspect(window, 'document.querySelector("#topbar-curations").click()')
    await waitFor(window, 'document.querySelector("#curation-drawer").classList.contains("visible")')
    await inspect(window, 'document.querySelector("[data-curation-id=curation-live-smoke]").click()')
    await waitFor(window, 'document.querySelector(".curation-live-activity")')
    await inspect(window, `window.rollingSkill.smokeEmitCurationActivity({
        sessionId: "curation-live-smoke",
        stage: "command",
        summary: "sed -n 1,632p billing-cost-management/SKILL.md",
        startedAt: Date.now() - 2_000,
        lastActivityAt: Date.now(),
        noisyOutput: "huge-noisy-curator-output",
    })`)
    const liveCuration = await inspect(window, `(() => ({
        text: document.querySelector(".curation-live-activity")?.textContent,
        effort: document.querySelector("[data-curation-effort=curation-live-smoke] option[value='']")?.textContent,
        referenceOpen: document.querySelector(".curation-reference-card")?.open,
        referenceBeforeConversation:
            Boolean(document.querySelector(".curation-reference-card")?.compareDocumentPosition(
                document.querySelector(".curator-conversation"),
            ) & Node.DOCUMENT_POSITION_FOLLOWING),
        conversation: document.querySelector(".curator-conversation")?.textContent,
    }))()`)
    if (!liveCuration.text.includes("sed -n 1,632p billing-cost-management/SKILL.md")) {
        throw new Error("Curator live command summary missing")
    }
    if (!liveCuration.text.includes("已用时") || liveCuration.text.includes("huge-noisy-curator-output")) {
        throw new Error("Curator live activity timing or output filtering is incorrect")
    }
    if (!liveCuration.effort.includes("本轮实际：xhigh") || liveCuration.effort.includes("low")) {
        throw new Error(`Curator effective effort label is incorrect: ${liveCuration.effort}`)
    }
    if (liveCuration.referenceOpen || !liveCuration.referenceBeforeConversation) {
        throw new Error("Curator reference answer is not collapsed above the conversation")
    }
    if (liveCuration.conversation.includes("rolling-skill-curated-case/v1")) {
        throw new Error("Structured reference JSON was repeated in the Curator conversation")
    }

    await inspect(window, `window.rollingSkill.smokeEmitCurationChanged({
        status: "needs_review",
        curator: {
            modelId: null,
            effort: null,
            effectiveModelId: "gpt-5.6-sol",
            effectiveEffort: "xhigh",
            threadId: "curator-live-thread",
            currentTurnId: null,
        },
        draft: {
            schemaVersion: "rolling-skill-curated-case/v1",
            referenceAnswer: {
                summary: "Updated verified reference",
                requiredFacts: ["July is the billing period."],
                requiredSteps: ["Query and verify the billing source."],
                requiredOutputFormat: ["State amount and currency."],
                evidence: [{claim: "The question asks for July.", sourceItemIds: ["thread-a-user-0"]}],
            },
            grading: {
                hardRequirements: [{
                    id: "H1",
                    criterion: "Uses July billing data",
                    passCondition: "The answer explicitly identifies July.",
                    evidenceBasis: "The source question asks for July.",
                }],
                softCriteria: [{id: "S1", criterion: "Concise", weight: 1}],
                automaticFailures: ["Invents an unverified amount"],
            },
            badCaseAnalysis: null,
        },
        revisions: [{createdAt: "2026-08-12T10:00:00.000Z"}, {createdAt: "2026-08-12T10:02:00.000Z"}],
        conversation: [
            {role: "assistant", text: "Initial review note.", turnId: "curator-initial-turn"},
            {role: "user", text: "请解释一下查询计划"},
            {role: "assistant", text: "查询计划已包含语义定位和账期校验。", turnId: "curator-followup-turn"},
        ],
        error: null,
    })`)
    await waitFor(window, 'document.querySelector(".curation-reference-card.just-updated") && document.querySelector("[data-archive-curation=curation-live-smoke]")')
    const reviewedCuration = await inspect(window, `(() => ({
        reference: document.querySelector(".curation-reference-card")?.textContent,
        conversation: document.querySelector(".curator-conversation")?.textContent,
        done: document.querySelector("[data-archive-curation=curation-live-smoke]")?.textContent,
    }))()`)
    if (!reviewedCuration.reference.includes("Updated verified reference")) {
        throw new Error("Updated Curator reference answer missing")
    }
    if (!reviewedCuration.conversation.includes("查询计划已包含语义定位和账期校验。")) {
        throw new Error("Conversational Curator follow-up missing")
    }
    if (!reviewedCuration.done.includes("完成并保存")) {
        throw new Error("Valid Curator draft lost its Done and save action")
    }
    await inspect(window, `(() => {
        const input = document.querySelector("[data-curation-input=curation-live-smoke]")
        input.value = "unsent curator follow-up"
        input.dispatchEvent(new Event("input", {bubbles: true}))
        const effort = document.querySelector("[data-curation-effort=curation-live-smoke]")
        effort.value = "high"
        effort.dispatchEvent(new Event("change", {bubbles: true}))
    })()`)
    await waitFor(window, 'document.querySelector("[data-curation-effort=curation-live-smoke]")?.value === "high"')
    if ((await inspect(window, 'document.querySelector("[data-curation-input=curation-live-smoke]")?.value')) !== "unsent curator follow-up") {
        throw new Error("Changing Curator effort cleared the unsent follow-up draft")
    }
    await inspect(window, `window.rollingSkill.smokeEmitCurationChanged({
        caseType: "badcase",
        draft: {
            schemaVersion: "rolling-skill-curated-case/v1",
            referenceAnswer: {
                summary: "Stop the identical retry and diagnose the failure.",
                requiredFacts: [],
                requiredSteps: [],
                requiredOutputFormat: ["State recovery evidence."],
                evidence: [{claim: "The retry failed.", sourceItemIds: ["thread-a-user-0"]}],
            },
            grading: {
                hardRequirements: [{
                    id: "H1",
                    criterion: "Diagnose before retrying",
                    passCondition: "A diagnosis precedes a changed recovery action.",
                    evidenceBasis: "The frozen badcase repeated unchanged.",
                }],
                softCriteria: [],
                automaticFailures: [],
            },
            badCaseAnalysis: {
                failureMode: "Repeated a failed query without diagnosis.",
                firstDivergence: "The first failed query was retried unchanged.",
                rootCauses: ["No bounded recovery decision."],
                loopSummary: "Equivalent failed calls repeated.",
                expectedRecovery: "Diagnose once and use a supported fallback.",
                deductionRules: [{
                    id: "D1",
                    errorPattern: "Undiagnosed identical retry loop",
                    matchCondition: "Two equivalent failures occur without diagnosis.",
                    deduction: 8,
                    evidenceBasis: "Frozen retry trace",
                    sourceItemIds: ["thread-a-user-0"],
                }],
            },
        },
    })`)
    await waitFor(window, 'document.querySelector(".deduction-rule")')
    const badcaseDraft = await inspect(window, `(() => ({
        heading: document.querySelector(".curation-reference-card summary")?.textContent,
        body: document.querySelector(".curation-draft")?.textContent,
    }))()`)
    if (!badcaseDraft.heading.includes("Bad Case 问题分析") ||
        !badcaseDraft.body.includes("首次偏离") ||
        !badcaseDraft.body.includes("D1 · Undiagnosed identical retry loop") ||
        !badcaseDraft.body.includes("最多扣 8 分") ||
        badcaseDraft.body.includes("参考答案")) {
        throw new Error("Badcase draft did not render as failure analysis with a recurrence deduction")
    }
    await inspect(window, 'document.querySelector("#topbar-curations").click()')

    await inspect(window, `(() => {
        window.rollingSkill.smokeFailNextCuration()
        document.querySelector("[data-save-case]")?.click()
    })()`)
    await waitFor(window, 'document.querySelector("#save-case-dialog")?.open')
    if ((await inspect(window, 'document.querySelector("#case-issue-description")?.value')) !== "") {
        throw new Error("The optional issue description was prefilled from the source question")
    }
    await inspect(window, `(() => {
        const issue = document.querySelector("#case-issue-description")
        issue.value = "  \\n\\t"
        issue.dispatchEvent(new Event("input", {bubbles: true}))
        document.querySelector("#confirm-save-case")?.click()
    })()`)
    await waitFor(window, 'document.querySelector("#confirm-save-case")?.disabled')
    const curationCloseLocked = await inspect(window, `(() => ({
        close: document.querySelector("#close-case-dialog")?.disabled,
        cancel: document.querySelector("#cancel-save-case")?.disabled,
    }))()`)
    if (!curationCloseLocked.close || !curationCloseLocked.cancel) {
        throw new Error("Case dialog can close while curation creation is pending")
    }
    await waitFor(window, '!document.querySelector("#case-create-error")?.classList.contains("hidden")')
    const curationFailure = await inspect(window, `(() => ({
        dialogOpen: document.querySelector("#save-case-dialog")?.open,
        inlineError: document.querySelector("#case-create-error")?.textContent,
        globalErrorHidden: document.querySelector("#error-banner")?.classList.contains("hidden"),
        input: window.rollingSkill.smokeLastCurationInput(),
    }))()`)
    if (!curationFailure.dialogOpen || !curationFailure.inlineError.includes("smoke curation failure")) {
        throw new Error("Curation failure was not kept inside the open Case dialog")
    }
    if (!curationFailure.globalErrorHidden) throw new Error("Curation failure leaked to global banner")
    for (const [key, expected] of Object.entries({
        sourceThreadId: "thread-a",
        startTurnId: "thread-a-turn-0",
        startMessageOrdinal: 0,
        endTurnId: "thread-a-turn-0",
        endMessageOrdinal: 0,
    })) {
        if (curationFailure.input?.[key] !== expected) {
            throw new Error(`Curation locator mismatch for ${key}`)
        }
    }
    if ("issueDescription" in curationFailure.input || "datasetQuestion" in curationFailure.input) {
        throw new Error("A blank optional issue description was sent or confused with the evaluation question")
    }
    if ("skillPath" in curationFailure.input || "skillReference" in curationFailure.input) {
        throw new Error("Case capture sent an operation-level Skill override")
    }
    await inspect(window, 'document.querySelector("#close-case-dialog")?.click()')
    await waitFor(window, '!document.querySelector("#save-case-dialog")?.open')

    const alphaPosition = await inspect(
        window,
        `(() => {
            const scroll = document.querySelector("#conversation-scroll")
            scroll.scrollTop = Math.min(420, scroll.scrollHeight - scroll.clientHeight)
            scroll.dispatchEvent(new Event("scroll"))
            const input = document.querySelector("#composer-input")
            input.value = "draft-alpha"
            input.dispatchEvent(new Event("input", {bubbles: true}))
            return scroll.scrollTop
        })()`,
    )
    await new Promise((resolve) => setTimeout(resolve, 50))
    await inspect(
        window,
        `window.rollingSkill.smokeEmitNotification({
            method: "item/agentMessage/delta",
            params: {
                threadId: "thread-a",
                turnId: "thread-a-turn-17",
                itemId: "thread-a-agent-17",
                delta: " streaming",
            },
        })`,
    )
    await new Promise((resolve) => setTimeout(resolve, 50))
    const positionAfterStreamingDelta = await inspect(
        window,
        'document.querySelector("#conversation-scroll").scrollTop',
    )
    if (Math.abs(positionAfterStreamingDelta - alphaPosition) > 2) {
        throw new Error("A streaming delta pulled the reader away from their position")
    }
    await inspect(window, 'document.querySelector("[data-thread-id=thread-b]").click()')
    await waitFor(
        window,
        'document.querySelector("[data-thread-id=thread-b].active") && document.querySelector(".loading-conversation") && document.querySelector("#composer-input").disabled',
    )
    await waitFor(window, '!document.querySelector(".loading-conversation")')
    if ((await inspect(window, 'document.querySelector("#composer-input").value')) !== "") {
        throw new Error("Thread B inherited Thread A's draft")
    }
    await inspect(
        window,
        `(() => {
            const input = document.querySelector("#composer-input")
            input.value = "draft-beta"
            input.dispatchEvent(new Event("input", {bubbles: true}))
        })()`,
    )

    await inspect(window, 'document.querySelector("[data-thread-id=thread-a]").click()')
    await waitFor(
        window,
        'document.querySelector("[data-thread-id=thread-a].active") && !document.querySelector(".loading-conversation") && document.querySelector("#composer-input").value === "draft-alpha"',
    )
    await new Promise((resolve) => setTimeout(resolve, 50))
    const restoredAlphaPosition = await inspect(
        window,
        'document.querySelector("#conversation-scroll").scrollTop',
    )
    if (Math.abs(restoredAlphaPosition - alphaPosition) > 2) {
        throw new Error(
            `Thread A reading position changed: ${alphaPosition} -> ${restoredAlphaPosition}`,
        )
    }

    await inspect(window, 'document.querySelector("[data-thread-id=thread-b]").click()')
    await waitFor(
        window,
        'document.querySelector("[data-thread-id=thread-b].active") && !document.querySelector(".loading-conversation") && document.querySelector("#composer-input").value === "draft-beta"',
    )
    await inspect(window, 'document.querySelector("#new-task").click()')
    await waitFor(window, 'document.querySelector("#active-title").textContent === "新任务"')
    await inspect(
        window,
        `(() => {
            const input = document.querySelector("#composer-input")
            input.value = "draft-new-task"
            input.dispatchEvent(new Event("input", {bubbles: true}))
        })()`,
    )
    await inspect(window, 'document.querySelector("[data-thread-id=thread-a]").click()')
    await waitFor(window, 'document.querySelector("[data-thread-id=thread-a].active") && !document.querySelector(".loading-conversation")')
    await inspect(window, 'document.querySelector("#new-task").click()')
    await waitFor(
        window,
        'document.querySelector("#active-title").textContent === "新任务" && document.querySelector("#composer-input").value === "draft-new-task"',
    )

    await inspect(window, 'document.querySelector("[data-thread-id=thread-b]").click()')
    await waitFor(window, 'document.querySelector("[data-thread-id=thread-b].active") && !document.querySelector(".loading-conversation")')
    await inspect(window, 'window.rollingSkill.smokeFailNextRead("thread-a")')
    await inspect(window, 'document.querySelector("[data-thread-id=thread-a]").click()')
    await waitFor(
        window,
        'document.querySelector(".thread-load-failed") && document.querySelector("#composer-input").disabled',
    )
    if ((await inspect(window, 'document.querySelector("#composer-input").value')) !== "draft-alpha") {
        throw new Error("A failed read lost the conversation draft")
    }
    await inspect(window, 'document.querySelector("[data-thread-id=thread-b]").click()')
    await waitFor(window, 'document.querySelector("[data-thread-id=thread-b].active") && !document.querySelector(".loading-conversation")')
    await inspect(window, 'document.querySelector("[data-thread-id=thread-a]").click()')
    await waitFor(window, 'document.querySelector("[data-thread-id=thread-a].active") && !document.querySelector(".loading-conversation")')
    await new Promise((resolve) => setTimeout(resolve, 50))
    const positionAfterReadFailure = await inspect(
        window,
        'document.querySelector("#conversation-scroll").scrollTop',
    )
    if (Math.abs(positionAfterReadFailure - alphaPosition) > 2) {
        throw new Error(
            `A failed read changed the saved position: ${alphaPosition} -> ${positionAfterReadFailure}`,
        )
    }

    await inspect(window, 'document.querySelector("[data-thread-id=thread-b]").click()')
    await waitFor(window, 'document.querySelector("[data-thread-id=thread-b].active") && document.querySelector(".loading-conversation")')
    await inspect(window, 'document.querySelector("[data-thread-view=archived]").click()')
    await waitFor(
        window,
        'document.querySelector("[data-thread-view=archived][aria-selected=true]") && !document.querySelector(".loading-conversation") && !document.querySelector("#composer-input").disabled',
    )
    await new Promise((resolve) => setTimeout(resolve, 100))
    if (!(await inspect(window, 'document.querySelector("[data-thread-view=archived][aria-selected=true]") && !document.querySelector(".loading-conversation")'))) {
        throw new Error("A stale thread read replaced the empty archived view")
    }

    await inspect(window, 'window.rollingSkill.smokeEmitRuntimeState("codex:slow", 160)')
    await new Promise((resolve) => setTimeout(resolve, 10))
    await inspect(window, 'window.rollingSkill.smokeEmitRuntimeState("codex:fast", 0)')
    await waitFor(
        window,
        'document.querySelector("#composer-model option[value=model-fast]") && !document.querySelector(".loading-conversation")',
    )
    await new Promise((resolve) => setTimeout(resolve, 200))
    if (await inspect(window, 'Boolean(document.querySelector("#composer-model option[value=model-slow]"))')) {
        throw new Error("A stale Runtime model response replaced the active Runtime catalog")
    }

    window.setSize(760, 480)
    await inspect(window, 'document.querySelector("#settings-button").click()')
    await waitFor(window, 'document.querySelector("#settings-dialog").open')
    const settingsLayoutBeforeScroll = await inspect(window, `(() => {
        const dialog = document.querySelector("#settings-dialog")
        const body = dialog.querySelector(".settings-dialog-body")
        const actions = dialog.querySelector(".settings-actions")
        const save = dialog.querySelector("#save-settings")
        if (!body || !actions || !save) return null
        const dialogRect = dialog.getBoundingClientRect()
        const actionsRect = actions.getBoundingClientRect()
        const saveRect = save.getBoundingClientRect()
        return {
            bodyScrollable: body.scrollHeight > body.clientHeight,
            bodyScrollTop: body.scrollTop,
            actionsTop: actionsRect.top,
            actionsBottom: actionsRect.bottom,
            dialogTop: dialogRect.top,
            dialogBottom: dialogRect.bottom,
            saveRight: saveRect.right,
            actionsRight: actionsRect.right,
        }
    })()`)
    if (
        !settingsLayoutBeforeScroll?.bodyScrollable ||
        settingsLayoutBeforeScroll.actionsTop < settingsLayoutBeforeScroll.dialogTop ||
        settingsLayoutBeforeScroll.actionsBottom > settingsLayoutBeforeScroll.dialogBottom + 1 ||
        Math.abs(settingsLayoutBeforeScroll.actionsRight - settingsLayoutBeforeScroll.saveRight) > 21
    ) {
        throw new Error(`Settings actions are not persistently visible at the lower right: ${JSON.stringify(settingsLayoutBeforeScroll)}`)
    }
    await inspect(window, `(() => {
        const body = document.querySelector("#settings-dialog .settings-dialog-body")
        body.scrollTop = body.scrollHeight
    })()`)
    const settingsLayoutAfterScroll = await inspect(window, `(() => {
        const dialog = document.querySelector("#settings-dialog")
        const body = dialog.querySelector(".settings-dialog-body")
        const actions = dialog.querySelector(".settings-actions")
        const dialogRect = dialog.getBoundingClientRect()
        const actionsRect = actions.getBoundingClientRect()
        return {
            bodyScrollTop: body.scrollTop,
            actionsTop: actionsRect.top,
            actionsBottom: actionsRect.bottom,
            dialogTop: dialogRect.top,
            dialogBottom: dialogRect.bottom,
        }
    })()`)
    if (
        settingsLayoutAfterScroll.bodyScrollTop <= 0 ||
        settingsLayoutAfterScroll.actionsTop !== settingsLayoutBeforeScroll.actionsTop ||
        settingsLayoutAfterScroll.actionsBottom !== settingsLayoutBeforeScroll.actionsBottom
    ) {
        throw new Error(`Settings actions moved with the scrolling content: ${JSON.stringify(settingsLayoutAfterScroll)}`)
    }
    await inspect(window, 'document.querySelector("#cancel-settings").click()')

    if (rendererErrors.length) throw new Error(`Renderer console errors: ${rendererErrors.join(" | ")}`)
    const screenshotPath = process.env.ROLLING_SKILL_RENDERER_SMOKE_SCREENSHOT
    if (screenshotPath) {
        if (process.env.ROLLING_SKILL_RENDERER_SMOKE_SCREENSHOT_SURFACE === "rubric") {
            await inspect(window, 'document.querySelector("[data-surface=evaluation]").click()')
            await inspect(window, 'document.querySelector("[data-evaluation-view=cases]").click()')
            await waitFor(window, 'document.querySelector("[data-evaluation-case-id=case-smoke]")')
            await inspect(window, 'document.querySelector("#manage-dataset-rubric").click()')
            await waitFor(window, 'document.querySelector("#rubric-drawer").classList.contains("visible")')
            await inspect(window, 'document.querySelector("#rubric-drawer .curation-reference-card")?.setAttribute("open", "")')
        } else if (process.env.ROLLING_SKILL_RENDERER_SMOKE_SCREENSHOT_SURFACE === "export") {
            await inspect(window, 'document.querySelector("[data-surface=evaluation]").click()')
            await inspect(window, 'document.querySelector("[data-evaluation-view=cases]").click()')
            await waitFor(window, 'document.querySelector("[data-evaluation-case-id=case-smoke]")')
            await inspect(window, 'document.querySelector("#export-evaluation-dataset").click()')
            await waitFor(window, 'document.querySelector("#export-dataset-dialog").open')
            await inspect(window, 'document.querySelector("#export-case-scope").value = "goodcase"')
            await inspect(window, 'document.querySelector("#export-output-mode").value = "original"')
        } else {
            await inspect(window, 'document.querySelector("[data-thread-view=current]").click()')
            await waitFor(window, 'document.querySelector("[data-thread-id=thread-a].active") && !document.querySelector(".loading-conversation")')
            await inspect(window, 'document.querySelector("#conversation-scroll").scrollTop = 0')
        }
        await new Promise((resolve) => setTimeout(resolve, 200))
        writeFileSync(screenshotPath, (await window.capturePage()).toPNG())
    }
    process.stdout.write(
        `${JSON.stringify({
            markdown: true,
            activityCards: markdownAndActivity.activity.length,
            perThreadDrafts: true,
            newTaskDraft: true,
            restoredScrollTop: restoredAlphaPosition,
            streamingPositionHeld: true,
            readFailureRecovered: true,
            emptyArchiveLoadCancelled: true,
            staleRuntimeModelsIgnored: true,
            inlineCurationFailure: true,
            caseCardUsesInitialQuestion: true,
            caseCalibrationDrawer: true,
            automaticCalibrationDone: true,
            automaticCalibrationStop: true,
            datasetExportChoices: true,
            datasetRubric: true,
            rubricActivityPatched: true,
            evaluationDurationMinuteSecond: true,
            curatorLiveActivity: true,
            curatorReferenceCard: true,
            curatorDraftRemainsSaveable: true,
            curatorDraftPreservedOnEffortChange: true,
            badcaseFailureLed: true,
            settingsActionsPinned: true,
            rendererErrors: 0,
        })}\n`,
    )
    window.destroy()
}

run()
    .then(() => {
        rmSync(temporaryDirectory, {recursive: true, force: true})
        app.quit()
    })
    .catch((error) => {
        process.stderr.write(`${error.stack || error.message}\n`)
        rmSync(temporaryDirectory, {recursive: true, force: true})
        app.exit(1)
    })
