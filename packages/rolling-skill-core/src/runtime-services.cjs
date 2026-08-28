const {
    CodexRuntimeProvider,
} = require("../../../desktop/rolling-skill/src/codex-runtime-provider.cjs")
const {
    CodeBuddyRuntimeProvider,
} = require("../../../desktop/rolling-skill/src/codebuddy-runtime-provider.cjs")
const {
    DeepSeekHarnessRuntimeProvider,
} = require("../../../desktop/rolling-skill/src/deepseek-harness-runtime-provider.cjs")
const {
    RuntimeRegistry,
} = require("../../../desktop/rolling-skill/src/runtime-registry.cjs")

function copy(value) {
    return JSON.parse(JSON.stringify(value))
}

function createDefaultRuntimeRegistry() {
    return new RuntimeRegistry([
        new CodexRuntimeProvider(),
        new CodeBuddyRuntimeProvider(),
        new DeepSeekHarnessRuntimeProvider(),
    ])
}

function publicDescriptor(descriptor) {
    const displayName = String(descriptor.displayName ?? descriptor.providerId ?? "Runtime")
    const version = String(descriptor.version ?? "unknown")
    const executablePath = String(descriptor.executablePath ?? "")
    return copy({
        ...descriptor,
        displayName,
        version,
        executablePath,
        label: `${displayName} ${version} · ${executablePath}`,
    })
}

function modelItems(response) {
    if (Array.isArray(response)) return response
    if (Array.isArray(response?.data)) return response.data
    return []
}

function createRuntimeServices({
    registry = createDefaultRuntimeRegistry(),
    configStore = null,
    workspaceRoot = process.cwd(),
    traceDirectory = null,
    clientOptions = {},
    onNotification = null,
} = {}) {
    let available = null
    const activeClients = new Map()
    const notificationListeners = new Map()

    function observeNotifications(client) {
        if (
            typeof onNotification !== "function" ||
            typeof client?.on !== "function" ||
            notificationListeners.has(client)
        ) return
        const listener = (message) => onNotification(message)
        client.on("notification", listener)
        notificationListeners.set(client, listener)
    }

    function discoveryOptions() {
        const selected = configStore?.read?.().runtime ?? null
        return {
            ...(selected ? {preferredRuntime: selected} : {}),
            ...(selected?.providerId && selected?.executablePath ? {
                providerOptions: {
                    [selected.providerId]: {configuredPath: selected.executablePath},
                },
            } : {}),
        }
    }

    function refresh() {
        const discovered = registry.discover(discoveryOptions()) ?? {available: []}
        available = [...(discovered.available ?? [])]
        return list()
    }

    function current() {
        if (available === null) refresh()
        return available
    }

    function list() {
        return current().map(publicDescriptor)
    }

    function descriptor(runtimeId) {
        const normalized = String(runtimeId ?? "").trim()
        const selected = current().find((entry) => entry.runtimeId === normalized)
        if (!selected) throw new Error(`Runtime ${normalized || "selection"} is no longer available`)
        return copy(selected)
    }

    function createClient(runtimeId, options = {}) {
        const selected = descriptor(runtimeId)
        return registry.createClient(selected, {
            workspaceRoot,
            ...(traceDirectory ? {traceDirectory} : {}),
            ...clientOptions,
            ...options,
        })
    }

    async function models(runtimeId) {
        const client = createClient(runtimeId, {nonInteractive: true})
        try {
            await client.start?.()
            if (typeof client.listModels !== "function") {
                return copy(descriptor(runtimeId).models ?? [])
            }
            return copy(modelItems(await client.listModels()))
        } finally {
            await client.stop?.()
        }
    }

    async function getClient(runtimeId, options = {}) {
        const selected = descriptor(runtimeId)
        const existing = activeClients.get(selected.runtimeId)
        if (existing) return existing
        const client = registry.createClient(selected, {
            workspaceRoot,
            ...(traceDirectory ? {traceDirectory} : {}),
            ...clientOptions,
            ...options,
        })
        observeNotifications(client)
        try {
            await client.start?.()
            activeClients.set(selected.runtimeId, client)
            return client
        } catch (error) {
            try {
                await client.stop?.()
            } catch {}
            throw error
        }
    }

    async function close() {
        const clients = [...activeClients.values()]
        activeClients.clear()
        for (const [client, listener] of notificationListeners) {
            client.off?.("notification", listener)
        }
        notificationListeners.clear()
        await Promise.allSettled(clients.map((client) => client.stop?.()))
    }

    return Object.freeze({close, createClient, descriptor, getClient, list, models, refresh})
}

module.exports = {createDefaultRuntimeRegistry, createRuntimeServices, publicDescriptor}
