const {MAX_BATCH_SIZE} = require("./raw-case-store.cjs")

function recoverySkill(dataset, entry) {
    const reference = entry.skillReference ?? dataset.skillReference ?? {}
    return {
        ...(reference.id ? {id: reference.id} : {}),
        name: reference.name,
        ...(reference.path ? {path: reference.path} : {}),
    }
}

function recoveryInput(dataset, entry, recoveredAt) {
    const caseType = entry.caseType === "badcase" ? "Badcase" : "Goodcase"
    return {
        question: entry.question,
        skill: recoverySkill(dataset, entry),
        note: `${dataset.name} · ${caseType} · recovered before deletion`,
        source: {
            kind: "deleted_case",
            datasetId: dataset.id,
            caseId: entry.id,
            caseType: entry.caseType,
            recoveredAt,
        },
    }
}

class CaseRecycleService {
    constructor({store, rawCaseStore, now = () => new Date().toISOString()}) {
        this.store = store
        this.rawCaseStore = rawCaseStore
        this.now = now
    }

    recover(snapshot) {
        const recoveredAt = this.now()
        const inputs = snapshot.cases.map((entry) =>
            recoveryInput(snapshot.dataset, entry, recoveredAt),
        )
        for (let offset = 0; offset < inputs.length; offset += MAX_BATCH_SIZE) {
            const result = this.rawCaseStore.addMany(inputs.slice(offset, offset + MAX_BATCH_SIZE))
            if (result.rejected.length) {
                throw new Error(`Raw Case recovery failed: ${result.rejected[0].error}`)
            }
        }
    }

    deleteCase({datasetId, caseId, recoverQuestions = true}) {
        const snapshot = this.store.prepareCaseDeletion(datasetId, caseId)
        if (recoverQuestions) this.recover(snapshot)
        return this.store.deleteCase(datasetId, caseId)
    }

    deleteDataset({datasetId, recoverQuestions = true}) {
        const snapshot = this.store.prepareDatasetDeletion(datasetId)
        if (recoverQuestions) this.recover(snapshot)
        return this.store.deleteDataset(datasetId)
    }
}

module.exports = {CaseRecycleService, recoveryInput}
