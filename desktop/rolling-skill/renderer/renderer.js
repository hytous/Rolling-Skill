const state = {
    runtime: {status: "starting"},
    workspaceRoot: "",
    threads: [],
    activeThreadId: null,
    activeThread: null,
    activeTurnId: null,
    datasets: [],
    loadingThreads: true,
    loadingThread: false,
    sending: false,
    newTaskMode: false,
    error: null,
    runtimeErrorDismissed: false,
    caseSelection: null,
    traceOpen: false,
    renderQueued: false,
}

const elements = {
    newTask: document.querySelector("#new-task"),
    refreshThreads: document.querySelector("#refresh-threads"),
    threadList: document.querySelector("#thread-list"),
    workspaceButton: document.querySelector("#workspace-button"),
    workspaceName: document.querySelector("#workspace-name"),
    workspacePath: document.querySelector("#workspace-path"),
    activeTitle: document.querySelector("#active-title"),
    runtimeStatus: document.querySelector("#runtime-status"),
    runtimeLabel: document.querySelector("#runtime-label"),
    showLocalData: document.querySelector("#show-local-data"),
    openTrace: document.querySelector("#open-trace"),
    topbarTrace: document.querySelector("#topbar-trace"),
    errorBanner: document.querySelector("#error-banner"),
    errorMessage: document.querySelector("#error-message"),
    dismissError: document.querySelector("#dismiss-error"),
    conversationScroll: document.querySelector("#conversation-scroll"),
    conversation: document.querySelector("#conversation"),
    composer: document.querySelector("#composer"),
    composerInput: document.querySelector("#composer-input"),
    sendTurn: document.querySelector("#send-turn"),
    stopTurn: document.querySelector("#stop-turn"),
    traceDrawer: document.querySelector("#trace-drawer"),
    closeTrace: document.querySelector("#close-trace"),
    refreshTrace: document.querySelector("#refresh-trace"),
    openTraceFolder: document.querySelector("#open-trace-folder"),
    traceMeta: document.querySelector("#trace-meta"),
    traceEvents: document.querySelector("#trace-events"),
    caseDialog: document.querySelector("#save-case-dialog"),
    caseForm: document.querySelector("#save-case-form"),
    caseDataset: document.querySelector("#case-dataset"),
    newDatasetName: document.querySelector("#new-dataset-name"),
    createDataset: document.querySelector("#create-dataset"),
    caseQuestion: document.querySelector("#case-question"),
    caseAnswer: document.querySelector("#case-answer"),
    closeCaseDialog: document.querySelector("#close-case-dialog"),
    cancelSaveCase: document.querySelector("#cancel-save-case"),
    confirmSaveCase: document.querySelector("#confirm-save-case"),
    toast: document.querySelector("#toast"),
}

function node(tag, className, text) {
    const element = document.createElement(tag)
    if (className) element.className = className
    if (text !== undefined) element.textContent = text
    return element
}

function baseName(path) {
    const value = String(path ?? "").replace(/\/+$/, "")
    return value.split("/").filter(Boolean).at(-1) || value || "Home"
}

function titleForThread(thread) {
    return String(thread?.name || thread?.preview || "New task").trim() || "New task"
}

function statusType(status) {
    return typeof status === "string" ? status : status?.type
}

function relativeTime(timestamp) {
    if (!timestamp) return ""
    const seconds = Math.max(0, Date.now() / 1000 - timestamp)
    if (seconds < 60) return "now"
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m`
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`
    if (seconds < 604800) return `${Math.floor(seconds / 86400)}d`
    return new Date(timestamp * 1000).toLocaleDateString(undefined, {month: "short", day: "numeric"})
}

function textFromUserInput(content) {
    return (content ?? [])
        .map((part) => {
            if (part.type === "text") return part.text
            if (part.type === "skill") return `$${part.name}`
            if (part.type === "mention") return `@${part.name}`
            if (part.type === "image" || part.type === "localImage") return "[Image]"
            if (part.type === "audio" || part.type === "localAudio") return "[Audio]"
            return ""
        })
        .filter(Boolean)
        .join("\n")
}

function getTurns() {
    return state.activeThread?.turns ?? []
}

function findTurn(turnId) {
    return getTurns().find((turn) => turn.id === turnId)
}

function ensureTurn(turnId) {
    if (!state.activeThread) return null
    if (!Array.isArray(state.activeThread.turns)) state.activeThread.turns = []
    let turn = findTurn(turnId)
    if (!turn) {
        turn = {id: turnId, items: [], status: "inProgress", error: null}
        state.activeThread.turns.push(turn)
    }
    return turn
}

function upsertTurn(nextTurn) {
    if (!state.activeThread || !nextTurn?.id) return
    if (!Array.isArray(state.activeThread.turns)) state.activeThread.turns = []
    const index = state.activeThread.turns.findIndex((turn) => turn.id === nextTurn.id)
    if (index >= 0) {
        const current = state.activeThread.turns[index]
        const mergedItems = [...(current.items ?? [])]
        for (const nextItem of nextTurn.items ?? []) {
            const itemIndex = mergedItems.findIndex((item) => item.id === nextItem.id)
            if (itemIndex >= 0) mergedItems[itemIndex] = {...mergedItems[itemIndex], ...nextItem}
            else mergedItems.push(nextItem)
        }
        state.activeThread.turns[index] = {
            ...current,
            ...nextTurn,
            items: mergedItems,
        }
    } else {
        state.activeThread.turns.push({...nextTurn, items: nextTurn.items ?? []})
    }
}

function upsertItem(turnId, nextItem) {
    if (!nextItem?.id) return
    const turn = ensureTurn(turnId)
    if (!turn) return
    const index = turn.items.findIndex((item) => item.id === nextItem.id)
    if (index >= 0) turn.items[index] = {...turn.items[index], ...nextItem}
    else turn.items.push(nextItem)
}

function upsertThreadSummary(thread) {
    if (!thread?.id) return
    const index = state.threads.findIndex((entry) => entry.id === thread.id)
    if (index >= 0) state.threads[index] = {...state.threads[index], ...thread}
    else state.threads.unshift(thread)
    state.threads.sort((left, right) => (right.updatedAt ?? 0) - (left.updatedAt ?? 0))
}

function renderWorkspace() {
    elements.workspaceName.textContent = baseName(state.workspaceRoot)
    elements.workspacePath.textContent = state.workspaceRoot
    elements.workspaceButton.title = state.workspaceRoot || "Choose workspace"
}

function renderRuntime() {
    const status = state.runtime?.status || "starting"
    elements.runtimeStatus.className = `runtime-status ${status}`
    const labels = {
        ready: "Local runtime ready",
        starting: "Starting local runtime",
        stopped: "Local runtime stopped",
        error: "Local runtime error",
    }
    elements.runtimeLabel.textContent = labels[status] || status
    elements.runtimeStatus.title =
        status === "ready" ? "Open the runtime trace" : "Restart the local runtime"

    const runtimeError = state.runtimeErrorDismissed ? null : state.runtime?.error
    const message = state.error || runtimeError
    elements.errorBanner.classList.toggle("hidden", !message)
    elements.errorMessage.textContent = message || ""
}

function renderThreads() {
    elements.threadList.replaceChildren()
    if (state.loadingThreads) {
        elements.threadList.append(node("div", "sidebar-placeholder", "Loading local tasks…"))
        return
    }
    if (state.threads.length === 0) {
        elements.threadList.append(
            node("div", "sidebar-placeholder", "No tasks in this workspace yet. Start one below."),
        )
        return
    }

    for (const thread of state.threads) {
        const button = node("button", "thread-button")
        button.type = "button"
        button.dataset.threadId = thread.id
        if (thread.id === state.activeThreadId && !state.newTaskMode) button.classList.add("active")

        button.append(
            node("span", "thread-title", titleForThread(thread)),
            node("span", "thread-time", relativeTime(thread.recencyAt ?? thread.updatedAt)),
            node("span", "thread-preview", thread.preview || baseName(thread.cwd)),
        )
        if (statusType(thread.status) === "active") button.append(node("span", "thread-status"))
        elements.threadList.append(button)
    }
}

function renderWelcome() {
    const welcome = node("div", "welcome")
    const inner = node("div", "welcome-inner")
    const mark = node("div", "welcome-mark")
    const image = node("img")
    image.src = "logo.svg"
    image.alt = ""
    mark.append(image)
    const heading = node("h1", "", "What should we evaluate?")
    const copy = node(
        "p",
        "",
        "Run a task through the bundled Codex runtime, inspect its local trace, then save the useful response as a goodcase or badcase.",
    )
    const chips = node("div", "welcome-chips")
    for (const label of ["No server required", "Manual case curation", "Local trace evidence"]) {
        chips.append(node("span", "welcome-chip", label))
    }
    inner.append(mark, heading, copy, chips)
    welcome.append(inner)
    elements.conversation.append(welcome)
}

function activityText(item) {
    if (item.type === "reasoning") {
        return `Reasoning · ${(item.summary ?? []).join(" ") || "working"}`
    }
    if (item.type === "commandExecution") {
        return `${item.status || "running"} · ${item.command || "command"}`
    }
    if (item.type === "fileChange") return `${item.status || "working"} · file changes`
    if (item.type === "mcpToolCall") return `${item.status || "running"} · ${item.server}/${item.tool}`
    if (item.type === "dynamicToolCall") return `${item.status || "running"} · ${item.tool}`
    if (item.type === "collabAgentToolCall") return `${item.status || "running"} · ${item.tool}`
    if (item.type === "plan") return item.text || "Plan updated"
    return null
}

function renderItem(item, turn) {
    if (item.type === "userMessage") {
        const wrapper = node("article", "message user")
        wrapper.append(node("div", "message-body", textFromUserInput(item.content)))
        return wrapper
    }
    if (item.type === "agentMessage") {
        const wrapper = node("article", "message assistant")
        const avatar = node("span", "assistant-avatar")
        const image = node("img")
        image.src = "logo.svg"
        image.alt = ""
        avatar.append(image)
        const body = node("div", "message-body", item.text || "")
        wrapper.append(avatar, body)
        if (turn.status !== "inProgress") {
            const actions = node("div", "message-actions")
            const save = node("button", "save-case-button", "Save case")
            save.type = "button"
            save.dataset.saveCase = "true"
            save.dataset.turnId = turn.id
            save.dataset.itemId = item.id
            actions.append(save)
            wrapper.append(actions)
        }
        return wrapper
    }
    const text = activityText(item)
    return text ? node("div", "activity-card", text) : null
}

function renderConversation(options = {}) {
    const wasNearBottom =
        elements.conversationScroll.scrollHeight -
            elements.conversationScroll.scrollTop -
            elements.conversationScroll.clientHeight <
        90
    elements.conversation.replaceChildren()
    if (state.loadingThread) {
        elements.conversation.append(node("div", "loading-conversation", "Loading task…"))
        return
    }
    if (!state.activeThread || getTurns().length === 0) {
        renderWelcome()
        return
    }

    for (const turn of getTurns()) {
        const block = node("section", "turn-block")
        for (const item of turn.items ?? []) {
            const rendered = renderItem(item, turn)
            if (rendered) block.append(rendered)
        }
        if (turn.error?.message) block.append(node("div", "turn-error", turn.error.message))
        elements.conversation.append(block)
    }

    if (options.forceBottom || wasNearBottom) {
        requestAnimationFrame(() => {
            elements.conversationScroll.scrollTop = elements.conversationScroll.scrollHeight
        })
    }
}

function renderComposer() {
    const running = Boolean(state.activeTurnId) || state.sending
    elements.stopTurn.classList.toggle("hidden", !running)
    elements.sendTurn.classList.toggle("hidden", running)
    elements.sendTurn.disabled = state.runtime?.status !== "ready" || !elements.composerInput.value.trim()
    elements.composerInput.disabled = state.sending
}

function renderTitle() {
    elements.activeTitle.textContent = state.newTaskMode
        ? "New task"
        : titleForThread(state.activeThread || state.threads.find((item) => item.id === state.activeThreadId))
}

function renderAll(options) {
    renderWorkspace()
    renderRuntime()
    renderThreads()
    renderTitle()
    renderConversation(options)
    renderComposer()
}

function queueRender(options = {}) {
    if (state.renderQueued) return
    state.renderQueued = true
    requestAnimationFrame(() => {
        state.renderQueued = false
        renderAll(options)
    })
}

function showError(error) {
    state.error = error?.message || String(error)
    renderRuntime()
}

let toastTimer = null
function showToast(message) {
    clearTimeout(toastTimer)
    elements.toast.textContent = message
    elements.toast.classList.remove("hidden")
    toastTimer = setTimeout(() => elements.toast.classList.add("hidden"), 2600)
}

async function refreshThreads(selectFirst = false) {
    state.loadingThreads = true
    renderThreads()
    try {
        const response = await window.rollingSkill.listThreads()
        state.threads = response.data ?? []
        state.loadingThreads = false
        renderThreads()
        if (
            selectFirst &&
            !state.newTaskMode &&
            !state.activeThreadId &&
            state.threads.length > 0
        ) {
            await loadThread(state.threads[0].id)
        }
    } catch (error) {
        state.loadingThreads = false
        showError(error)
        renderThreads()
    }
}

async function loadThread(threadId) {
    if (!threadId) return
    state.activeThreadId = threadId
    state.newTaskMode = false
    state.loadingThread = true
    state.error = null
    state.activeTurnId = null
    renderAll()
    try {
        const response = await window.rollingSkill.readThread(threadId)
        if (state.activeThreadId !== threadId) return
        state.activeThread = response.thread
        state.activeTurnId =
            response.thread.turns?.find((turn) => turn.status === "inProgress")?.id ?? null
        state.loadingThread = false
        upsertThreadSummary(response.thread)
        renderAll({forceBottom: true})
    } catch (error) {
        if (state.activeThreadId !== threadId) return
        state.loadingThread = false
        showError(error)
        renderConversation()
    }
}

function beginNewTask() {
    state.activeThreadId = null
    state.activeThread = null
    state.activeTurnId = null
    state.loadingThread = false
    state.newTaskMode = true
    state.error = null
    renderAll()
    elements.composerInput.focus()
}

function resizeComposer() {
    elements.composerInput.style.height = "auto"
    elements.composerInput.style.height = `${Math.min(elements.composerInput.scrollHeight, 220)}px`
    renderComposer()
}

async function submitTurn() {
    const text = elements.composerInput.value.trim()
    if (!text || state.sending || state.activeTurnId) return
    state.sending = true
    state.error = null
    renderAll()
    try {
        if (!state.activeThread) {
            const response = await window.rollingSkill.startThread()
            state.activeThread = response.thread
            state.activeThreadId = response.thread.id
            state.newTaskMode = false
            upsertThreadSummary(response.thread)
        }
        const response = await window.rollingSkill.startTurn(state.activeThreadId, text)
        state.activeTurnId = response.turn.id
        upsertTurn(response.turn)
        elements.composerInput.value = ""
        resizeComposer()
        state.sending = false
        renderAll({forceBottom: true})
    } catch (error) {
        state.sending = false
        showError(error)
        renderComposer()
    }
}

async function stopTurn() {
    if (!state.activeThreadId || !state.activeTurnId) return
    const turnId = state.activeTurnId
    try {
        await window.rollingSkill.interruptTurn(state.activeThreadId, turnId)
    } catch (error) {
        showError(error)
    }
}

function updateDatasetOptions(selectedId) {
    elements.caseDataset.replaceChildren()
    for (const dataset of state.datasets) {
        const option = node("option", "", `${dataset.name} (${dataset.caseCount ?? 0})`)
        option.value = dataset.id
        if (dataset.id === selectedId) option.selected = true
        elements.caseDataset.append(option)
    }
}

function openCaseDialog(turnId, itemId) {
    const turn = findTurn(turnId)
    const item = turn?.items?.find((entry) => entry.id === itemId)
    if (!turn || !item || item.type !== "agentMessage") return
    const question = [...(turn.items ?? [])]
        .filter((entry) => entry.type === "userMessage")
        .map((entry) => textFromUserInput(entry.content))
        .filter(Boolean)
        .join("\n\n")
    state.caseSelection = {turnId, itemId}
    elements.caseQuestion.value = question
    elements.caseAnswer.value = item.text || ""
    updateDatasetOptions(state.datasets[0]?.id)
    elements.caseDialog.showModal()
}

async function createDataset() {
    const name = elements.newDatasetName.value.trim()
    if (!name) return
    elements.createDataset.disabled = true
    try {
        const created = await window.rollingSkill.createDataset(name)
        state.datasets = await window.rollingSkill.listDatasets()
        updateDatasetOptions(created.id)
        elements.newDatasetName.value = ""
        showToast(`Created dataset “${created.name}”`)
    } catch (error) {
        showError(error)
    } finally {
        elements.createDataset.disabled = false
    }
}

async function saveCase() {
    const selection = state.caseSelection
    if (!selection) return
    const caseType = new FormData(elements.caseForm).get("case-type")
    elements.confirmSaveCase.disabled = true
    try {
        await window.rollingSkill.saveCase({
            datasetId: elements.caseDataset.value,
            caseType,
            question: elements.caseQuestion.value,
            answer: elements.caseAnswer.value,
            threadId: state.activeThreadId,
            turnId: selection.turnId,
            itemId: selection.itemId,
        })
        state.datasets = await window.rollingSkill.listDatasets()
        elements.caseDialog.close()
        showToast(`Saved as ${caseType}`)
    } catch (error) {
        showError(error)
    } finally {
        elements.confirmSaveCase.disabled = false
    }
}

async function loadTrace() {
    elements.traceEvents.replaceChildren(node("div", "sidebar-placeholder", "Reading local trace…"))
    try {
        const trace = await window.rollingSkill.getTrace(160)
        elements.traceMeta.textContent = trace.path
            ? `${trace.reference || "No events yet"}\n${trace.path}`
            : "Trace begins when the local runtime starts."
        elements.traceEvents.replaceChildren()
        if (!trace.events.length) {
            elements.traceEvents.append(node("div", "sidebar-placeholder", "No trace events yet."))
            return
        }
        for (const event of [...trace.events].reverse()) {
            const card = node("article", "trace-event")
            const head = node("div", "trace-event-head")
            head.append(
                node("span", "trace-event-direction", event.direction),
                node("span", "", `#${event.sequence} · ${new Date(event.recordedAt).toLocaleTimeString()}`),
            )
            const serialized = JSON.stringify(event.message, null, 2)
            card.append(head, node("pre", "", serialized.length > 12000 ? `${serialized.slice(0, 12000)}\n…` : serialized))
            elements.traceEvents.append(card)
        }
    } catch (error) {
        elements.traceEvents.replaceChildren(node("div", "sidebar-placeholder", error.message))
    }
}

function setTraceOpen(open) {
    state.traceOpen = open
    elements.traceDrawer.classList.toggle("visible", open)
    if (open) void loadTrace()
}

function handleNotification(message) {
    const {method, params = {}} = message ?? {}
    if (method === "thread/started") {
        upsertThreadSummary(params.thread)
    } else if (method === "thread/name/updated") {
        const thread = state.threads.find((entry) => entry.id === params.threadId)
        if (thread) thread.name = params.threadName
        if (state.activeThread?.id === params.threadId) state.activeThread.name = params.threadName
    } else if (method === "thread/status/changed") {
        const thread = state.threads.find((entry) => entry.id === params.threadId)
        if (thread) thread.status = params.status
    } else if (method === "turn/started" && params.threadId === state.activeThreadId) {
        state.activeTurnId = params.turn.id
        state.sending = false
        upsertTurn(params.turn)
    } else if (method === "item/started" && params.threadId === state.activeThreadId) {
        upsertItem(params.turnId, params.item)
    } else if (method === "item/agentMessage/delta" && params.threadId === state.activeThreadId) {
        const turn = ensureTurn(params.turnId)
        let item = turn?.items.find((entry) => entry.id === params.itemId)
        if (!item) {
            item = {type: "agentMessage", id: params.itemId, text: ""}
            turn?.items.push(item)
        }
        item.text = `${item.text || ""}${params.delta || ""}`
    } else if (method === "item/completed" && params.threadId === state.activeThreadId) {
        upsertItem(params.turnId, params.item)
    } else if (method === "turn/completed" && params.threadId === state.activeThreadId) {
        upsertTurn(params.turn)
        if (state.activeTurnId === params.turn.id) state.activeTurnId = null
        state.sending = false
        const summary = state.threads.find((entry) => entry.id === params.threadId)
        if (summary) summary.updatedAt = Date.now() / 1000
        void refreshThreads(false)
    } else if (method === "error" && params.threadId === state.activeThreadId) {
        state.error = params.error?.message || "The task failed"
        if (!params.willRetry) {
            state.activeTurnId = null
            state.sending = false
        }
    }
    queueRender({forceBottom: method === "item/agentMessage/delta"})
}

elements.newTask.addEventListener("click", beginNewTask)
elements.refreshThreads.addEventListener("click", () => refreshThreads(false))
elements.threadList.addEventListener("click", (event) => {
    const button = event.target.closest("[data-thread-id]")
    if (button) void loadThread(button.dataset.threadId)
})
elements.workspaceButton.addEventListener("click", async () => {
    try {
        await window.rollingSkill.chooseWorkspace()
    } catch (error) {
        showError(error)
    }
})
elements.showLocalData.addEventListener("click", () => window.rollingSkill.revealLocalData())
elements.openTrace.addEventListener("click", () => setTraceOpen(true))
elements.topbarTrace.addEventListener("click", () => setTraceOpen(true))
elements.closeTrace.addEventListener("click", () => setTraceOpen(false))
elements.refreshTrace.addEventListener("click", loadTrace)
elements.openTraceFolder.addEventListener("click", () => window.rollingSkill.openTraceFolder())
elements.runtimeStatus.addEventListener("click", async () => {
    if (state.runtime?.status === "ready") {
        setTraceOpen(true)
        return
    }
    try {
        state.runtime = {status: "starting", workspaceRoot: state.workspaceRoot}
        renderRuntime()
        state.runtime = await window.rollingSkill.restartRuntime()
        state.runtimeErrorDismissed = false
        await refreshThreads(false)
        renderAll()
    } catch (error) {
        showError(error)
    }
})
elements.dismissError.addEventListener("click", () => {
    state.error = null
    state.runtimeErrorDismissed = true
    renderRuntime()
})
elements.composer.addEventListener("submit", (event) => {
    event.preventDefault()
    void submitTurn()
})
elements.composerInput.addEventListener("input", resizeComposer)
elements.composerInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
        event.preventDefault()
        void submitTurn()
    }
})
elements.stopTurn.addEventListener("click", stopTurn)
elements.conversation.addEventListener("click", (event) => {
    const button = event.target.closest("[data-save-case]")
    if (button) openCaseDialog(button.dataset.turnId, button.dataset.itemId)
})
elements.closeCaseDialog.addEventListener("click", () => elements.caseDialog.close())
elements.cancelSaveCase.addEventListener("click", () => elements.caseDialog.close())
elements.createDataset.addEventListener("click", createDataset)
elements.caseForm.addEventListener("submit", (event) => {
    event.preventDefault()
    void saveCase()
})

window.rollingSkill.onRuntimeState((runtime) => {
    state.runtime = runtime
    state.runtimeErrorDismissed = false
    renderRuntime()
    renderComposer()
})
window.rollingSkill.onCodexNotification(handleNotification)
window.rollingSkill.onWorkspaceChanged(async ({workspaceRoot}) => {
    state.workspaceRoot = workspaceRoot
    state.activeThread = null
    state.activeThreadId = null
    state.activeTurnId = null
    state.newTaskMode = false
    renderAll()
    await refreshThreads(true)
})
window.rollingSkill.onNewTask(beginNewTask)
async function bootstrap() {
    try {
        const initial = await window.rollingSkill.bootstrap()
        state.runtime = initial.runtime
        state.workspaceRoot = initial.workspaceRoot
        state.datasets = initial.datasets ?? []
        renderAll()
        await refreshThreads(true)
    } catch (error) {
        state.loadingThreads = false
        showError(error)
        renderAll()
    }
}

resizeComposer()
void bootstrap()
