const assert = require("node:assert/strict")
const {it} = require("node:test")
const React = require("react")
const {act, create} = require("react-test-renderer")
const {loadView, textOf} = require("./tsx-harness.cjs")

it("updates the original capture button after Draft save and discard without reloading the conversation", async (t) => {
    const previous = {fetch: global.fetch, window: global.window}
    const events = new EventTarget()
    global.window = events
    let markers = [{endMessageId: "answer", curationSessionId: "draft", caseId: null, status: "draft"}]
    global.fetch = async () => ({ok: true, json: async () => ({ok: true, value: markers})})
    const {CaseCaptureAction} = loadView("../conversation/CaseCaptureAction.tsx")
    let view
    await act(async () => {view = create(React.createElement(CaseCaptureAction, {sessionId: "native", messageId: "answer", t: (key) => key}))})
    t.after(() => {act(() => view.unmount()); Object.assign(global, previous)})
    assert.equal(textOf(view.root), "captureDraft")
    assert.equal(view.root.findByType("button").props.className, "rolling-skill-capture-action")
    const update = () => act(async () => events.dispatchEvent(new CustomEvent("rolling-skill:curation-markers-changed", {detail: {sessionId: "native"}})))
    markers = [{...markers[0], caseId: "case", status: "saved"}]
    await update()
    assert.equal(textOf(view.root), "captureSaved")
    markers = []
    await update()
    assert.equal(textOf(view.root), "captureAction")
    assert.equal(view.root.findByType("button").props["data-rolling-skill-curation-status"], "available")
})

it("closes the capture modal before opening the created Draft workbench", async (t) => {
    const previous = {fetch: global.fetch, document: global.document, window: global.window}
    const navigation = []
    global.document = {addEventListener() {}, removeEventListener() {}}
    global.window = {dispatchEvent: (event) => {if (event.type === "rolling-skill:open-workbench") navigation.push(event.detail.route)}}
    global.fetch = async (_url, options) => {
        const {method} = JSON.parse(options.body)
        return {ok: true, status: 200, json: async () => ({ok: true, value: method === "conversationCuration.inspect"
            ? {startCandidates: [{seq: 1, text: "Question"}], datasets: [{datasetId: "dataset", name: "Dataset", ready: true, blockers: []}]}
            : {id: "draft", datasetId: "dataset", status: "queued"}})}
    }
    const {CaseCaptureDialog} = loadView("../conversation/CaseCaptureDialog.tsx")
    let view
    await act(async () => {view = create(React.createElement(CaseCaptureDialog, {
        sessionId: "native", endMessageId: "answer", t: (key) => key,
        onCreated() {}, onClose: () => navigation.push("closed"),
    }))})
    t.after(() => {act(() => view.unmount()); Object.assign(global, previous)})
    const button = (key) => view.root.findAllByType("button").find((node) => textOf(node) === key)
    await act(async () => button("captureCreate").props.onClick())
    await act(async () => button("captureViewDraft").props.onClick())
    assert.deepEqual(navigation, ["closed", {page: "curation", sessionId: "draft"}])
})
