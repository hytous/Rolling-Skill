function nodeFor(nodes, key) {
    if (nodes && typeof nodes.get === "function") return nodes.get(key)
    return nodes?.[key]
}

function projectSequenceRange(snapshot, startSeq, endSeq) {
    if (
        !Number.isSafeInteger(startSeq) ||
        !Number.isSafeInteger(endSeq) ||
        startSeq > endSeq
    ) return []
    const order = Array.isArray(snapshot?.chat?.order) ? snapshot.chat.order : []
    return order.filter((key) => {
        const node = nodeFor(snapshot?.chat?.nodes, key)
        return Boolean(
            node &&
            Number.isSafeInteger(node.anchorSeq) &&
            node.anchorSeq >= startSeq &&
            node.anchorSeq <= endSeq
        )
    })
}

function projectMarkers(snapshot, markers) {
    const projection = new Map()
    const order = Array.isArray(snapshot?.chat?.order) ? snapshot.chat.order : []
    const validMarkers = Array.isArray(markers)
        ? markers.filter((marker) =>
            Number.isSafeInteger(marker?.startSeq) &&
            Number.isSafeInteger(marker?.endSeq) &&
            marker.startSeq <= marker.endSeq &&
            (marker.status === "draft" || marker.status === "saved"),
        )
        : []
    for (const key of order) {
        const node = nodeFor(snapshot?.chat?.nodes, key)
        if (!node || !Number.isSafeInteger(node.anchorSeq)) continue
        let status = null
        for (const marker of validMarkers) {
            if (node.anchorSeq < marker.startSeq || node.anchorSeq > marker.endSeq) continue
            if (marker.status === "saved") {
                status = "saved"
                break
            }
            status = status ?? "draft"
        }
        if (status) projection.set(key, status)
    }
    return projection
}

module.exports = {projectMarkers, projectSequenceRange}
