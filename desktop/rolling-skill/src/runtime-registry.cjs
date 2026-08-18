class RuntimeRegistry {
    constructor(providers) {
        this.providers = new Map()
        for (const provider of providers ?? []) {
            if (!provider?.id || typeof provider.discover !== "function") {
                throw new Error("Every runtime provider requires an id and discover function")
            }
            if (this.providers.has(provider.id)) {
                throw new Error(`Duplicate runtime provider: ${provider.id}`)
            }
            this.providers.set(provider.id, provider)
        }
    }

    discover(options = {}) {
        const available = []
        const seen = new Set()
        for (const provider of this.providers.values()) {
            const providerOptions = {
                ...(options.commonProviderOptions ?? {}),
                ...(options.providerOptions?.[provider.id] ?? {}),
            }
            for (const descriptor of provider.discover(providerOptions) ?? []) {
                if (!descriptor?.runtimeId || descriptor.providerId !== provider.id) continue
                if (seen.has(descriptor.runtimeId)) continue
                seen.add(descriptor.runtimeId)
                available.push(descriptor)
            }
        }

        const preferred = options.preferredRuntime
        const selected = preferred
            ? available.find(
                  (runtime) =>
                      (preferred.runtimeId && runtime.runtimeId === preferred.runtimeId) ||
                      (preferred.executablePath &&
                          runtime.executablePath === preferred.executablePath &&
                          (!preferred.providerId || runtime.providerId === preferred.providerId)),
              ) ?? available[0] ?? null
            : available[0] ?? null
        return {available, selected}
    }

    createClient(descriptor, options) {
        const provider = this.providers.get(descriptor?.providerId)
        if (!provider || typeof provider.createClient !== "function") {
            throw new Error(`No client provider is registered for ${descriptor?.providerId ?? "runtime"}`)
        }
        return provider.createClient(descriptor, options)
    }
}

module.exports = {RuntimeRegistry}
