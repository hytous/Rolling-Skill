const phases = [
    {id: "repository", label: "Locate checkout"},
    {id: "credentials", label: "Isolate Codex credentials"},
    {id: "docker", label: "Check Docker Desktop"},
    {id: "compose", label: "Build and start runtime"},
    {id: "web", label: "Open local workbench"},
]

const phaseProgress = {
    "needs-repository": -1,
    idle: 0,
    checking: 0,
    preparing: 1,
    "needs-login": 1,
    "checking-docker": 2,
    "starting-docker": 2,
    "starting-runtime": 3,
    "waiting-for-web": 4,
    ready: 5,
    stopping: 3,
    stopped: 0,
    error: -1,
}

const activePhases = new Set([
    "checking",
    "preparing",
    "checking-docker",
    "starting-docker",
    "starting-runtime",
    "waiting-for-web",
    "stopping",
])

const elements = {
    phasePill: document.querySelector("#phase-pill"),
    symbol: document.querySelector("#status-symbol"),
    title: document.querySelector("#status-title"),
    detail: document.querySelector("#status-detail"),
    repository: document.querySelector("#repository"),
    steps: document.querySelector("#steps"),
    logs: document.querySelector("#logs"),
    retry: document.querySelector("#retry"),
    login: document.querySelector("#login"),
    chooseRepository: document.querySelector("#choose-repository"),
    openWorkbench: document.querySelector("#open-workbench"),
    stop: document.querySelector("#stop"),
    openLogs: document.querySelector("#open-logs"),
    revealRepository: document.querySelector("#reveal-repository"),
}

function setVisible(element, visible) {
    element.classList.toggle("hidden", !visible)
}

function renderSteps(state) {
    const progress = phaseProgress[state.phase] ?? -1
    elements.steps.replaceChildren(
        ...phases.map((phase, index) => {
            const item = document.createElement("li")
            const complete = progress > index
            const active = progress === index
            item.className = `step${complete ? " done" : ""}${active ? " active" : ""}`

            const dot = document.createElement("span")
            dot.className = "step-dot"
            dot.textContent = complete ? "✓" : active ? "•" : ""
            const label = document.createElement("span")
            label.textContent = phase.label
            const status = document.createElement("span")
            status.className = "step-state"
            status.textContent = complete ? "done" : active ? "active" : "waiting"
            item.append(dot, label, status)
            return item
        }),
    )
}

function phaseLabel(phase) {
    return phase
        .split("-")
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(" ")
}

function render(state) {
    elements.phasePill.textContent = phaseLabel(state.phase)
    elements.title.textContent = state.title
    elements.detail.textContent = state.detail
    elements.repository.textContent = state.repositoryRoot ?? "No checkout selected"
    elements.logs.textContent = state.logs.length
        ? state.logs.slice(-180).join("\n")
        : "Waiting for runtime output…"
    elements.logs.scrollTop = elements.logs.scrollHeight

    elements.symbol.className = "status-symbol"
    if (state.phase === "ready") elements.symbol.classList.add("ready")
    if (state.phase === "needs-login") elements.symbol.classList.add("warning")
    if (state.phase === "error") elements.symbol.classList.add("error")

    renderSteps(state)
    const busy = activePhases.has(state.phase)
    elements.retry.disabled = busy
    elements.chooseRepository.disabled = busy
    setVisible(elements.retry, !busy && state.phase !== "needs-repository" && state.phase !== "ready")
    setVisible(elements.login, state.phase === "needs-login")
    setVisible(elements.chooseRepository, state.phase === "needs-repository" || state.phase === "error")
    setVisible(elements.openWorkbench, Boolean(state.workbenchAvailable))
    setVisible(elements.stop, busy || state.phase === "ready")
}

elements.retry.addEventListener("click", () => window.rollingSkill.retry())
elements.login.addEventListener("click", () => window.rollingSkill.openLoginTerminal())
elements.chooseRepository.addEventListener("click", () => window.rollingSkill.chooseRepository())
elements.openWorkbench.addEventListener("click", () => window.rollingSkill.openWorkbench())
elements.stop.addEventListener("click", () => window.rollingSkill.stop())
elements.openLogs.addEventListener("click", () => window.rollingSkill.openLogs())
elements.revealRepository.addEventListener("click", () => window.rollingSkill.revealRepository())

window.rollingSkill.onState(render)
window.rollingSkill.getState().then(render)
