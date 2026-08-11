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
    runtimeOperationInProgress: false,
    runtimeEpoch: 0,
    caseSelection: null,
    curationSessions: [],
    activeCurationId: null,
    curationOpen: false,
    curatorProfile: {runtimePolicy: "active", modelId: null},
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
    runtimeContextName: document.querySelector("#runtime-context-name"),
    showLocalData: document.querySelector("#show-local-data"),
    chooseRuntime: document.querySelector("#choose-runtime"),
    openTrace: document.querySelector("#open-trace"),
    topbarCurations: document.querySelector("#topbar-curations"),
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
    curationDrawer: document.querySelector("#curation-drawer"),
    closeCurations: document.querySelector("#close-curations"),
    curationList: document.querySelector("#curation-list"),
    curationDetail: document.querySelector("#curation-detail"),
    curatorModelId: document.querySelector("#curator-model-id"),
    saveCuratorProfile: document.querySelector("#save-curator-profile"),
    runtimeDialog: document.querySelector("#runtime-dialog"),
    closeRuntimeDialog: document.querySelector("#close-runtime-dialog"),
    runtimeOptions: document.querySelector("#runtime-options"),
    detectRuntimes: document.querySelector("#detect-runtimes"),
    automaticRuntime: document.querySelector("#automatic-runtime"),
    chooseRuntimeFile: document.querySelector("#choose-runtime-file"),
    confirmRuntime: document.querySelector("#confirm-runtime"),
    caseDialog: document.querySelector("#save-case-dialog"),
    caseForm: document.querySelector("#save-case-form"),
    caseDataset: document.querySelector("#case-dataset"),
    newDatasetName: document.querySelector("#new-dataset-name"),
    createDataset: document.querySelector("#create-dataset"),
    caseStartItem: document.querySelector("#case-start-item"),
    caseQuestion: document.querySelector("#case-question"),
    caseScope: document.querySelector("#case-scope"),
    caseEndPreview: document.querySelector("#case-end-preview"),
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
    const runtime = state.runtime?.runtime
    elements.runtimeStatus.className = `runtime-status ${status}`
    const labels = {
        ready: runtime ? `${runtime.displayName} ${runtime.version}` : "Local runtime ready",
        starting: runtime ? `Starting ${runtime.displayName}` : "Detecting local runtimes",
        stopped: "Local runtime stopped",
        error: "Local runtime error",
        unavailable: "No local runtime",
    }
    elements.runtimeLabel.textContent = labels[status] || status
    elements.runtimeContextName.textContent = runtime
        ? `${runtime.displayName} ${runtime.version}`
        : "No agent runtime selected"
    elements.runtimeStatus.title =
        status === "ready"
            ? `${runtime?.executablePath || "Local runtime"} · ${runtime?.source || "detected"}`
            : "Rescan compatible local runtimes"

    const runtimeError = state.runtimeErrorDismissed ? null : state.runtime?.error
    const message = state.error || runtimeError
    elements.errorBanner.classList.toggle("hidden", !message)
    elements.errorMessage.textContent = message || ""
}

function renderRuntimeOptions() {
    elements.runtimeOptions.replaceChildren()
    elements.detectRuntimes.disabled = state.runtimeOperationInProgress
    elements.automaticRuntime.disabled = state.runtimeOperationInProgress
    elements.chooseRuntimeFile.disabled = state.runtimeOperationInProgress
    elements.confirmRuntime.disabled = state.runtimeOperationInProgress
    const runtimes = state.runtime?.availableRuntimes ?? []
    if (runtimes.length === 0) {
        elements.runtimeOptions.append(
            node(
                "div",
                "sidebar-placeholder",
                "No compatible local runtime was detected. Rescan or choose an executable.",
            ),
        )
        return
    }
    for (const runtime of runtimes) {
        const button = node("button", "runtime-option")
        button.type = "button"
        button.disabled = state.runtimeOperationInProgress
        button.dataset.runtimeId = runtime.runtimeId
        const selected = runtime.runtimeId === state.runtime?.runtime?.runtimeId
        if (selected) button.classList.add("selected")
        const copy = node("span")
        const title = node("span", "runtime-option-title")
        title.append(
            node("span", "", `${runtime.displayName} ${runtime.version}`),
            node("small", "", runtime.source),
        )
        copy.append(title, node("span", "runtime-option-path", runtime.executablePath))
        button.append(copy, node("span", "runtime-option-state", selected ? "Active" : "Use"))
        elements.runtimeOptions.append(button)
    }
}

function openRuntimeDialog() {
    renderRuntimeOptions()
    elements.runtimeDialog.showModal()
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
        "Run a task through a compatible local agent runtime, then curate a complete problem-solving episode into a reviewable goodcase or badcase.",
    )
    const chips = node("div", "welcome-chips")
    for (const label of ["Runtime auto-discovery", "Episode curation", "Local trace evidence"]) {
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
            const save = node("button", "save-case-button", "Curate case")
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

const curationStatusLabels = {
    queued: "Queued",
    running: "Running",
    needs_review: "Needs review",
    failed: "Failed",
    archived: "Archived",
    cancelled: "Cancelled",
}

function activeCuration() {
    return state.curationSessions.find((session) => session.id === state.activeCurationId) ?? null
}

function appendStringList(container, values, empty = "None") {
    if (!values?.length) {
        container.append(node("div", "curation-empty", empty))
        return
    }
    const list = node("ul", "curation-value-list")
    for (const value of values) list.append(node("li", "", value))
    container.append(list)
}

function draftSection(title, values) {
    const section = node("section", "draft-section")
    section.append(node("h4", "", title))
    appendStringList(section, values)
    return section
}

function renderDraft(draft) {
    const wrapper = node("div", "curation-draft")
    wrapper.append(node("h3", "", "Structured reference"))
    const summary = node("section", "draft-section")
    summary.append(
        node("h4", "", "Reference answer"),
        node("div", "draft-summary", draft.referenceAnswer.summary),
    )
    wrapper.append(
        summary,
        draftSection("Required facts", draft.referenceAnswer.requiredFacts),
        draftSection("Required steps", draft.referenceAnswer.requiredSteps),
        draftSection("Required output format", draft.referenceAnswer.requiredOutputFormat),
    )

    const hard = node("section", "draft-section hard-requirements")
    hard.append(node("h4", "", "Hard requirements"))
    for (const requirement of draft.grading.hardRequirements) {
        const card = node("article", "requirement-card")
        card.append(
            node("strong", "", `${requirement.id} · ${requirement.criterion}`),
            node("span", "", `Pass: ${requirement.passCondition}`),
            node("small", "", `Basis: ${requirement.evidenceBasis}`),
        )
        hard.append(card)
    }
    wrapper.append(
        hard,
        draftSection(
            "Soft criteria",
            draft.grading.softCriteria.map(
                (criterion) => `${criterion.id} · ${criterion.criterion} (weight ${criterion.weight})`,
            ),
        ),
        draftSection("Automatic failures", draft.grading.automaticFailures),
    )
    if (draft.badCaseAnalysis) {
        wrapper.append(
            draftSection("Root causes", draft.badCaseAnalysis.rootCauses),
            draftSection("Expected recovery", [draft.badCaseAnalysis.expectedRecovery]),
        )
    }
    return wrapper
}

function renderCurations() {
    elements.curationDrawer.classList.toggle("visible", state.curationOpen)
    elements.curationList.replaceChildren()
    elements.curatorModelId.value = state.curatorProfile?.modelId ?? ""
    if (!state.curationSessions.length) {
        elements.curationList.append(
            node("div", "sidebar-placeholder", "No drafts yet. Use Curate case under an assistant response."),
        )
    } else {
        for (const session of state.curationSessions) {
            const button = node("button", "curation-list-item")
            button.type = "button"
            button.dataset.curationId = session.id
            if (session.id === state.activeCurationId) button.classList.add("active")
            const title = String(session.episode?.originalQuestion ?? "Untitled case").trim()
            button.append(
                node("span", "curation-list-title", title || "Untitled case"),
                node(
                    "span",
                    `curation-status ${session.status}`,
                    curationStatusLabels[session.status] ?? session.status,
                ),
            )
            elements.curationList.append(button)
        }
    }

    elements.curationDetail.replaceChildren()
    const scroll = node("div", "curation-detail-scroll")
    elements.curationDetail.append(scroll)
    const session = activeCuration()
    if (!session) {
        scroll.append(node("div", "sidebar-placeholder", "Select a case draft to review it."))
        return
    }

    const overview = node("div", "curation-overview")
    overview.append(
        node("span", `case-kind ${session.caseType}`, session.caseType),
        node("span", `curation-status ${session.status}`, curationStatusLabels[session.status]),
    )
    const question = node("section", "frozen-question")
    question.append(
        node("span", "curation-label", "Verbatim question"),
        node("div", "", session.episode.originalQuestion),
    )
    const provenance = node(
        "div",
        "curation-provenance",
        `${session.episode.items.length} episode items · ${session.episode.toolActivity.length} tool signatures · ${session.curator.modelId || "runtime default model"}`,
    )
    scroll.append(overview, question, provenance)

    const conversation = node("section", "curator-conversation")
    conversation.append(node("h3", "", "Curator conversation"))
    for (const message of session.conversation) {
        const bubble = node("article", `curator-message ${message.role}`)
        bubble.append(node("span", "curator-role", message.role === "assistant" ? "Curator" : "You"))
        bubble.append(node("div", "", message.text))
        conversation.append(bubble)
    }
    if (session.status === "queued" || session.status === "running") {
        conversation.append(node("div", "curator-working", "Curator is working…"))
    }
    if (session.error) {
        const error = node("div", "curation-error")
        error.append(node("span", "", session.error))
        if (session.status === "failed") {
            const retry = node("button", "", "Retry")
            retry.type = "button"
            retry.dataset.retryCuration = session.id
            error.append(retry)
        }
        conversation.append(error)
    }
    scroll.append(conversation)
    if (session.draft) scroll.append(renderDraft(session.draft))

    if (session.status !== "archived" && session.status !== "cancelled") {
        const composerWrap = node("div", "curation-composer-wrap")
        const form = node("form", "curation-followup")
        form.dataset.curationForm = session.id
        const input = node("textarea")
        input.rows = 3
        input.maxLength = 120000
        input.placeholder = "Ask Curator to explain or revise this draft"
        input.disabled = session.status === "queued" || session.status === "running"
        input.dataset.curationInput = session.id
        const send = node("button", "", "Send")
        send.type = "submit"
        send.disabled = input.disabled
        form.append(input, send)
        composerWrap.append(form)
        if (session.status === "needs_review" && session.draft) {
            const done = node("button", "curation-done primary", "Done · save case")
            done.type = "button"
            done.dataset.archiveCuration = session.id
            composerWrap.append(done)
        }
        elements.curationDetail.append(composerWrap)
    }
}

function renderAll(options) {
    renderWorkspace()
    renderRuntime()
    renderThreads()
    renderTitle()
    renderConversation(options)
    renderComposer()
    renderRuntimeOptions()
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
    const runtimeEpoch = state.runtimeEpoch
    state.loadingThreads = true
    renderThreads()
    try {
        const response = await window.rollingSkill.listThreads()
        if (runtimeEpoch !== state.runtimeEpoch) return false
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
        return true
    } catch (error) {
        if (runtimeEpoch !== state.runtimeEpoch) return false
        state.loadingThreads = false
        showError(error)
        renderThreads()
        return false
    }
}

async function loadThread(threadId) {
    if (!threadId) return
    const runtimeEpoch = state.runtimeEpoch
    state.activeThreadId = threadId
    state.newTaskMode = false
    state.loadingThread = true
    state.error = null
    state.activeTurnId = null
    renderAll()
    try {
        const response = await window.rollingSkill.readThread(threadId)
        if (runtimeEpoch !== state.runtimeEpoch || state.activeThreadId !== threadId) return
        state.activeThread = response.thread
        state.activeTurnId =
            response.thread.turns?.find((turn) => turn.status === "inProgress")?.id ?? null
        state.loadingThread = false
        upsertThreadSummary(response.thread)
        renderAll({forceBottom: true})
    } catch (error) {
        if (runtimeEpoch !== state.runtimeEpoch || state.activeThreadId !== threadId) return
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

function flattenedActiveItems() {
    const items = []
    for (const turn of getTurns()) {
        for (const item of turn.items ?? []) items.push({turnId: turn.id, item})
    }
    return items
}

function updateEpisodeStartPreview() {
    const selection = state.caseSelection
    if (!selection) return
    const selected = selection.startCandidates.find(
        (candidate) => candidate.item.id === elements.caseStartItem.value,
    )
    if (!selected) return
    selection.startItemId = selected.item.id
    elements.caseQuestion.value = textFromUserInput(selected.item.content)
    const flattened = flattenedActiveItems()
    const startIndex = flattened.findIndex(({item}) => item.id === selected.item.id)
    const endIndex = flattened.findIndex(({item}) => item.id === selection.itemId)
    elements.caseScope.textContent = `Frozen range: ${Math.max(0, endIndex - startIndex + 1)} conversation and tool items. New messages in the original task are not included.`
}

function openCaseDialog(turnId, itemId) {
    const turn = findTurn(turnId)
    const item = turn?.items?.find((entry) => entry.id === itemId)
    if (!turn || !item || item.type !== "agentMessage") return
    const flattened = flattenedActiveItems()
    const endIndex = flattened.findIndex(({item: entry}) => entry.id === itemId)
    const startCandidates = flattened
        .slice(0, endIndex + 1)
        .filter(({item: entry}) => entry.type === "userMessage")
    if (!startCandidates.length) {
        showError(new Error("No source question was found before this response"))
        return
    }
    state.caseSelection = {turnId, itemId, startCandidates, startItemId: startCandidates.at(-1).item.id}
    elements.caseStartItem.replaceChildren()
    for (const candidate of [...startCandidates].reverse()) {
        const question = textFromUserInput(candidate.item.content)
        const option = node("option", "", question.replace(/\s+/g, " ").slice(0, 110))
        option.value = candidate.item.id
        elements.caseStartItem.append(option)
    }
    elements.caseStartItem.value = state.caseSelection.startItemId
    elements.caseEndPreview.value = item.text || ""
    updateEpisodeStartPreview()
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

async function createCuration() {
    const selection = state.caseSelection
    if (!selection) return
    const caseType = new FormData(elements.caseForm).get("case-type")
    elements.confirmSaveCase.disabled = true
    elements.caseDialog.close()
    try {
        const session = await window.rollingSkill.createCuration({
            datasetId: elements.caseDataset.value,
            caseType,
            sourceThreadId: state.activeThreadId,
            startItemId: selection.startItemId,
            endItemId: selection.itemId,
        })
        upsertCuration(session)
        state.activeCurationId = session.id
        setCurationOpen(true)
        showToast("Frozen episode sent to Curator")
    } catch (error) {
        showError(error)
    } finally {
        elements.confirmSaveCase.disabled = false
        state.caseSelection = null
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
    if (open) {
        state.curationOpen = false
        elements.curationDrawer.classList.remove("visible")
    }
    elements.traceDrawer.classList.toggle("visible", open)
    if (open) void loadTrace()
}

function setCurationOpen(open) {
    state.curationOpen = open
    if (open) {
        state.traceOpen = false
        elements.traceDrawer.classList.remove("visible")
        if (!state.activeCurationId && state.curationSessions.length) {
            state.activeCurationId = state.curationSessions[0].id
        }
    }
    renderCurations()
}

function upsertCuration(session) {
    const index = state.curationSessions.findIndex((entry) => entry.id === session.id)
    if (index >= 0) state.curationSessions[index] = session
    else state.curationSessions.unshift(session)
    state.curationSessions.sort((left, right) =>
        String(right.updatedAt).localeCompare(String(left.updatedAt)),
    )
}

async function sendCurationMessage(sessionId, text) {
    if (!String(text).trim()) return
    try {
        const session = await window.rollingSkill.sendCurationMessage(sessionId, text)
        upsertCuration(session)
        renderCurations()
    } catch (error) {
        showError(error)
    }
}

async function retryCuration(sessionId) {
    try {
        const session = await window.rollingSkill.retryCuration(sessionId)
        upsertCuration(session)
        renderCurations()
    } catch (error) {
        showError(error)
    }
}

async function archiveCuration(sessionId) {
    try {
        await window.rollingSkill.archiveCuration(sessionId)
        const session = await window.rollingSkill.getCuration(sessionId)
        upsertCuration(session)
        state.datasets = await window.rollingSkill.listDatasets()
        renderCurations()
        showToast("Case saved and Curator archived")
    } catch (error) {
        showError(error)
    }
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

function clearRuntimeTaskState() {
    state.threads = []
    state.activeThreadId = null
    state.activeThread = null
    state.activeTurnId = null
    state.loadingThread = false
    state.loadingThreads = true
    state.sending = false
    state.newTaskMode = false
}

async function changeRuntime(operation, {markStarting = true, clearBefore = true} = {}) {
    if (state.runtimeOperationInProgress) return
    state.runtimeOperationInProgress = true
    state.runtimeEpoch += 1
    state.error = null
    if (clearBefore) clearRuntimeTaskState()
    if (markStarting) state.runtime = {...state.runtime, status: "starting", error: null}
    renderAll()
    try {
        const runtime = await operation()
        if (!runtime) return
        if (!clearBefore) clearRuntimeTaskState()
        state.runtime = runtime
        state.runtimeErrorDismissed = false
        if (runtime.status === "ready") {
            const refreshed = await refreshThreads(true)
            if (refreshed) state.error = null
        } else {
            state.loadingThreads = false
        }
    } catch (error) {
        state.loadingThreads = false
        showError(error)
    } finally {
        state.runtimeOperationInProgress = false
        renderAll()
    }
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
elements.chooseRuntime.addEventListener("click", openRuntimeDialog)
elements.openTrace.addEventListener("click", () => setTraceOpen(true))
elements.topbarCurations.addEventListener("click", () => setCurationOpen(true))
elements.topbarTrace.addEventListener("click", () => setTraceOpen(true))
elements.closeTrace.addEventListener("click", () => setTraceOpen(false))
elements.closeCurations.addEventListener("click", () => setCurationOpen(false))
elements.refreshTrace.addEventListener("click", loadTrace)
elements.openTraceFolder.addEventListener("click", () => window.rollingSkill.openTraceFolder())
elements.runtimeStatus.addEventListener("click", async () => {
    openRuntimeDialog()
})
elements.closeRuntimeDialog.addEventListener("click", () => elements.runtimeDialog.close())
elements.confirmRuntime.addEventListener("click", () => elements.runtimeDialog.close())
elements.runtimeOptions.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-runtime-id]")
    if (!button || button.dataset.runtimeId === state.runtime?.runtime?.runtimeId) return
    await changeRuntime(() => window.rollingSkill.selectRuntime(button.dataset.runtimeId))
})
elements.detectRuntimes.addEventListener("click", async () => {
    await changeRuntime(() => window.rollingSkill.detectRuntimes())
})
elements.automaticRuntime.addEventListener("click", async () => {
    await changeRuntime(() => window.rollingSkill.useAutomaticRuntime())
})
elements.chooseRuntimeFile.addEventListener("click", async () => {
    await changeRuntime(() => window.rollingSkill.chooseRuntime(), {
        markStarting: false,
        clearBefore: false,
    })
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
elements.caseStartItem.addEventListener("change", updateEpisodeStartPreview)
elements.createDataset.addEventListener("click", createDataset)
elements.caseForm.addEventListener("submit", (event) => {
    event.preventDefault()
    void createCuration()
})
elements.curationList.addEventListener("click", (event) => {
    const button = event.target.closest("[data-curation-id]")
    if (!button) return
    state.activeCurationId = button.dataset.curationId
    renderCurations()
})
elements.curationDetail.addEventListener("click", (event) => {
    const retry = event.target.closest("[data-retry-curation]")
    if (retry) void retryCuration(retry.dataset.retryCuration)
    const archive = event.target.closest("[data-archive-curation]")
    if (archive) void archiveCuration(archive.dataset.archiveCuration)
})
elements.curationDetail.addEventListener("submit", (event) => {
    const form = event.target.closest("[data-curation-form]")
    if (!form) return
    event.preventDefault()
    const input = form.querySelector("[data-curation-input]")
    const text = input?.value ?? ""
    if (input) input.value = ""
    void sendCurationMessage(form.dataset.curationForm, text)
})
elements.saveCuratorProfile.addEventListener("click", async () => {
    elements.saveCuratorProfile.disabled = true
    try {
        state.curatorProfile = await window.rollingSkill.updateCuratorProfile({
            modelId: elements.curatorModelId.value,
        })
        showToast(
            state.curatorProfile.modelId
                ? `Curator model set to ${state.curatorProfile.modelId}`
                : "Curator will follow the source/runtime model",
        )
    } catch (error) {
        showError(error)
    } finally {
        elements.saveCuratorProfile.disabled = false
        renderCurations()
    }
})

window.rollingSkill.onRuntimeState((runtime) => {
    state.runtime = runtime
    state.runtimeErrorDismissed = false
    renderRuntime()
    renderComposer()
})
window.rollingSkill.onRuntimeNotification(handleNotification)
window.rollingSkill.onCurationChanged((session) => {
    upsertCuration(session)
    if (!state.activeCurationId) state.activeCurationId = session.id
    renderCurations()
})
window.rollingSkill.onWorkspaceChanged(async ({workspaceRoot}) => {
    state.workspaceRoot = workspaceRoot
    state.activeThread = null
    state.activeThreadId = null
    state.activeTurnId = null
    state.newTaskMode = false
    renderAll()
    if (state.runtime?.status === "ready") await refreshThreads(true)
    else {
        state.loadingThreads = false
        renderThreads()
    }
})
window.rollingSkill.onNewTask(beginNewTask)
async function bootstrap() {
    try {
        const initial = await window.rollingSkill.bootstrap()
        state.runtime = initial.runtime
        state.workspaceRoot = initial.workspaceRoot
        state.datasets = initial.datasets ?? []
        state.curationSessions = initial.curationSessions ?? []
        state.curatorProfile = initial.curatorProfile ?? state.curatorProfile
        state.activeCurationId = state.curationSessions[0]?.id ?? null
        renderAll()
        renderCurations()
        if (state.runtime?.status !== "unavailable") {
            await refreshThreads(true)
        } else {
            state.loadingThreads = false
            renderThreads()
        }
    } catch (error) {
        state.loadingThreads = false
        showError(error)
        renderAll()
    }
}

resizeComposer()
void bootstrap()
