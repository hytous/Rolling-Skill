function visibleCurationSelection(currentId, items = []) {
    return items.some((entry) => entry.id === currentId)
        ? currentId
        : items[0]?.id || ""
}

module.exports = {visibleCurationSelection}
