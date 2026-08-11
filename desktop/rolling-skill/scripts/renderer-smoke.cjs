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
        width: 1_180,
        height: 800,
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

    await inspect(window, `(() => {
        window.rollingSkill.smokeFailNextCuration()
        document.querySelector("[data-save-case]")?.click()
    })()`)
    await waitFor(window, 'document.querySelector("#save-case-dialog")?.open')
    await inspect(window, `(() => {
        const skill = document.querySelector("#case-skill")
        skill.value = "/tmp/rolling-skill-renderer-smoke/billing-cost-management/SKILL.md"
        skill.dispatchEvent(new Event("change", {bubbles: true}))
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

    if (rendererErrors.length) throw new Error(`Renderer console errors: ${rendererErrors.join(" | ")}`)
    const screenshotPath = process.env.ROLLING_SKILL_RENDERER_SMOKE_SCREENSHOT
    if (screenshotPath) {
        await inspect(window, 'document.querySelector("[data-thread-view=current]").click()')
        await waitFor(window, 'document.querySelector("[data-thread-id=thread-a].active") && !document.querySelector(".loading-conversation")')
        await new Promise((resolve) => setTimeout(resolve, 50))
        await inspect(window, 'document.querySelector("#conversation-scroll").scrollTop = 0')
        await new Promise((resolve) => setTimeout(resolve, 25))
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
