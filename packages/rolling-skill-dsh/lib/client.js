window.__ModuleLoader__.load({id:'@rolling-skill/dsh-plugin',factory:(require)=>{var module={exports:{}};var exports=module.exports;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/client/index.tsx
var index_exports = {};
__export(index_exports, {
  apply: () => apply,
  inject: () => inject
});
module.exports = __toCommonJS(index_exports);

// src/client/workbench/Workbench.tsx
var import_dsh_client_ui_primitives6 = require("@deepseek-ai/dsh-client-ui-primitives");
var import_react6 = require("react");

// src/client/api.ts
var ROLLING_SKILL_API_PATH = "/rolling-skill/api";
var RollingSkillApiError = class extends Error {
  code;
  status;
  constructor(code, message, status) {
    super(message);
    this.name = "RollingSkillApiError";
    this.code = code;
    this.status = status;
  }
};
async function requestRollingSkill(method, input = {}, signal) {
  const response = await fetch(ROLLING_SKILL_API_PATH, {
    method: "POST",
    credentials: "same-origin",
    headers: { accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify({ method, input }),
    signal
  });
  let envelope;
  try {
    envelope = await response.json();
  } catch {
    throw new RollingSkillApiError(
      "INVALID_RESPONSE",
      "Rolling Skill returned an invalid response",
      response.status
    );
  }
  if (!response.ok || !envelope.ok) {
    const failure = envelope;
    throw new RollingSkillApiError(
      failure.error?.code ?? "REQUEST_FAILED",
      failure.error?.message ?? "Rolling Skill request failed",
      response.status
    );
  }
  return envelope.value;
}

// src/client/workbench/CasesPanel.tsx
var import_dsh_client_ui_primitives = require("@deepseek-ai/dsh-client-ui-primitives");
var import_react = require("react");

// src/client/workbench/RuntimeSelect.tsx
var import_jsx_runtime = require("react/jsx-runtime");
function RuntimeSelect({
  t,
  runtimes,
  value,
  onChange,
  label
}) {
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("fieldset", { className: "rolling-skill-runtime-select", children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("legend", { children: label }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "rolling-skill-runtime-list", children: [
      runtimes.map((runtime) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { className: "rolling-skill-runtime-option", children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
          "input",
          {
            type: "radio",
            name: label,
            value: runtime.runtimeId,
            checked: value === runtime.runtimeId,
            onChange: () => onChange(runtime.runtimeId)
          }
        ),
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("strong", { children: [
            runtime.displayName,
            " ",
            runtime.version
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("code", { children: runtime.executablePath })
        ] })
      ] }, runtime.runtimeId)),
      runtimes.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { children: t("noRuntimes") }) : null
    ] })
  ] });
}

// src/client/workbench/CasesPanel.tsx
var import_jsx_runtime2 = require("react/jsx-runtime");
function CasesPanel({ t, revision, onChanged }) {
  const [datasets, setDatasets] = (0, import_react.useState)([]);
  const [runtimes, setRuntimes] = (0, import_react.useState)([]);
  const [runtimeId, setRuntimeId] = (0, import_react.useState)("");
  const [datasetId, setDatasetId] = (0, import_react.useState)("");
  const [entries, setEntries] = (0, import_react.useState)([]);
  const [deleting, setDeleting] = (0, import_react.useState)(null);
  const [recoverQuestions, setRecoverQuestions] = (0, import_react.useState)(true);
  const [busy, setBusy] = (0, import_react.useState)(false);
  const [error, setError] = (0, import_react.useState)(null);
  (0, import_react.useEffect)(() => {
    const controller = new AbortController();
    Promise.all([
      requestRollingSkill("datasets.list", {}, controller.signal),
      requestRollingSkill("runtimes.list", {}, controller.signal)
    ]).then(([value, runtimeItems]) => {
      setDatasets(value);
      setRuntimes(runtimeItems);
      setRuntimeId((current) => current || runtimeItems[0]?.runtimeId || "");
      setDatasetId((current) => current && value.some((entry) => entry.id === current) ? current : value[0]?.id ?? "");
    }).catch((reason) => {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : t("loadError"));
    });
    return () => controller.abort();
  }, [revision]);
  (0, import_react.useEffect)(() => {
    if (!datasetId) {
      setEntries([]);
      return;
    }
    const controller = new AbortController();
    requestRollingSkill("cases.list", { datasetId, pageSize: 200 }, controller.signal).then((page) => setEntries(page.items)).catch((reason) => {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : t("loadError"));
    });
    return () => controller.abort();
  }, [datasetId, revision]);
  const mutate = async (operation) => {
    setBusy(true);
    setError(null);
    try {
      await operation();
      onChanged();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t("loadError"));
    } finally {
      setBusy(false);
    }
  };
  const refreshOne = (entry) => mutate(() => requestRollingSkill("cases.refresh", {
    datasetId,
    caseId: entry.id,
    expectedUpdatedAt: entry.updatedAt,
    idempotencyKey: crypto.randomUUID(),
    runtimeId
  }));
  const refreshBatch = (scope) => mutate(() => requestRollingSkill("cases.refreshBatch", {
    datasetId,
    scope,
    idempotencyKey: crypto.randomUUID(),
    runtimeId
  }));
  const remove = () => {
    const entry = deleting;
    if (!entry) return;
    void mutate(async () => {
      await requestRollingSkill("cases.delete", {
        datasetId,
        caseId: entry.id,
        expectedUpdatedAt: entry.updatedAt,
        recoverQuestions,
        idempotencyKey: crypto.randomUUID()
      });
      setDeleting(null);
    });
  };
  return /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("section", { className: "rolling-skill-panel rolling-skill-data-panel", children: [
    /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "rolling-skill-panel-header", children: [
      /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { children: [
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("h3", { children: t("casesTitle") }),
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("p", { children: t("casesDescription") })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "rolling-skill-actions", children: [
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(import_dsh_client_ui_primitives.Button, { variant: "outline", size: "sm", disabled: !datasetId || busy, onClick: () => void refreshBatch("goodcase"), children: t("refreshGoodCases") }),
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(import_dsh_client_ui_primitives.Button, { variant: "outline", size: "sm", disabled: !datasetId || busy, onClick: () => void refreshBatch("all"), children: t("refreshAllCases") })
      ] })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("select", { className: "rolling-skill-select", "aria-label": t("selectDataset"), value: datasetId, onChange: (event) => setDatasetId(event.target.value), children: datasets.map((dataset) => /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("option", { value: dataset.id, children: dataset.name }, dataset.id)) }),
    /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(RuntimeSelect, { t, runtimes, value: runtimeId, onChange: setRuntimeId, label: t("refreshRuntime") }),
    error ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("p", { className: "rolling-skill-inline-error", role: "alert", children: error }) : null,
    /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "rolling-skill-list", children: [
      entries.map((entry) => /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("article", { className: "rolling-skill-case-row", children: [
        /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "rolling-skill-case-copy", children: [
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: "rolling-skill-badge", children: entry.caseType === "goodcase" ? t("goodcase") : t("badcase") }),
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("strong", { children: entry.question }),
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("p", { children: entry.answer })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "rolling-skill-actions", children: [
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(import_dsh_client_ui_primitives.Button, { variant: "ghost", size: "sm", disabled: busy, onClick: () => void refreshOne(entry), children: t("refreshCase") }),
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(import_dsh_client_ui_primitives.Button, { variant: "ghost", size: "sm", disabled: busy, onClick: () => setDeleting(entry), children: t("delete") })
        ] })
      ] }, entry.id)),
      entries.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("p", { children: t("emptyCases") }) : null
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)(
      import_dsh_client_ui_primitives.Modal,
      {
        open: deleting !== null,
        onClose: () => setDeleting(null),
        title: t("deleteCaseTitle"),
        closeLabel: t("cancel"),
        footer: /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)(import_jsx_runtime2.Fragment, { children: [
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(import_dsh_client_ui_primitives.Button, { variant: "outline", onClick: () => setDeleting(null), children: t("cancel") }),
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(import_dsh_client_ui_primitives.Button, { variant: "outline", disabled: busy, onClick: remove, children: t("confirmDelete") })
        ] }),
        children: [
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("p", { children: t("deleteRecoveryPrompt") }),
          /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("label", { className: "rolling-skill-check", children: [
            /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("input", { type: "checkbox", checked: recoverQuestions, onChange: (event) => setRecoverQuestions(event.target.checked) }),
            /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { children: t("recoverToRawCases") })
          ] })
        ]
      }
    )
  ] });
}

// src/client/workbench/DatasetsPanel.tsx
var import_dsh_client_ui_primitives2 = require("@deepseek-ai/dsh-client-ui-primitives");
var import_react2 = require("react");
var import_jsx_runtime3 = require("react/jsx-runtime");
function DatasetsPanel({ t, onChanged }) {
  const [datasets, setDatasets] = (0, import_react2.useState)([]);
  const [name, setName] = (0, import_react2.useState)("");
  const [deleting, setDeleting] = (0, import_react2.useState)(null);
  const [recoverQuestions, setRecoverQuestions] = (0, import_react2.useState)(true);
  const [busy, setBusy] = (0, import_react2.useState)(false);
  const [error, setError] = (0, import_react2.useState)(null);
  const [revision, setRevision] = (0, import_react2.useState)(0);
  (0, import_react2.useEffect)(() => {
    const controller = new AbortController();
    requestRollingSkill("datasets.list", {}, controller.signal).then(setDatasets).catch((reason) => {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : t("loadError"));
    });
    return () => controller.abort();
  }, [revision]);
  const reload = () => setRevision((value) => value + 1);
  const mutate = async (operation) => {
    setBusy(true);
    setError(null);
    try {
      await operation();
      reload();
      onChanged();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t("loadError"));
    } finally {
      setBusy(false);
    }
  };
  const create = () => mutate(async () => {
    await requestRollingSkill("datasets.create", { name });
    setName("");
  });
  const remove = () => {
    const dataset = deleting;
    if (!dataset) return;
    void mutate(async () => {
      await requestRollingSkill("datasets.delete", {
        datasetId: dataset.id,
        expectedCreatedAt: dataset.createdAt,
        recoverQuestions,
        idempotencyKey: crypto.randomUUID()
      });
      setDeleting(null);
    });
  };
  const exportCsv = async (datasetId) => {
    setError(null);
    try {
      const exported = await requestRollingSkill("datasets.exportCsv", { datasetId });
      const url = URL.createObjectURL(new Blob([exported.content], { type: "text/csv;charset=utf-8" }));
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = exported.filename;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t("loadError"));
    }
  };
  return /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("section", { className: "rolling-skill-panel rolling-skill-data-panel", children: [
    /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "rolling-skill-panel-header", children: [
      /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { children: [
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("h3", { children: t("datasetsTitle") }),
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("p", { children: t("datasetsDescription") })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(import_dsh_client_ui_primitives2.Button, { variant: "ghost", size: "sm", onClick: reload, children: t("refresh") })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "rolling-skill-form-row", children: [
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
        import_dsh_client_ui_primitives2.Input,
        {
          value: name,
          placeholder: t("datasetName"),
          "aria-label": t("datasetName"),
          onChange: (event) => setName(event.target.value)
        }
      ),
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(import_dsh_client_ui_primitives2.Button, { variant: "outline", size: "sm", disabled: busy || !name.trim(), onClick: create, children: t("createDataset") })
    ] }),
    error ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("p", { className: "rolling-skill-inline-error", role: "alert", children: error }) : null,
    /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "rolling-skill-list", children: [
      datasets.map((dataset) => /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("article", { className: "rolling-skill-list-row", children: [
        /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { children: [
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("strong", { children: dataset.name }),
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { children: t("caseBreakdown").replace("{all}", String(dataset.caseCount)).replace("{good}", String(dataset.goodcaseCount)).replace("{bad}", String(dataset.badcaseCount)) })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "rolling-skill-actions", children: [
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(import_dsh_client_ui_primitives2.Button, { variant: "ghost", size: "sm", onClick: () => void exportCsv(dataset.id), children: t("exportCsv") }),
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(import_dsh_client_ui_primitives2.Button, { variant: "ghost", size: "sm", onClick: () => setDeleting(dataset), children: t("delete") })
        ] })
      ] }, dataset.id)),
      datasets.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("p", { children: t("emptyDatasets") }) : null
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)(
      import_dsh_client_ui_primitives2.Modal,
      {
        open: deleting !== null,
        onClose: () => setDeleting(null),
        title: t("deleteDatasetTitle"),
        closeLabel: t("cancel"),
        footer: /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)(import_jsx_runtime3.Fragment, { children: [
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(import_dsh_client_ui_primitives2.Button, { variant: "outline", onClick: () => setDeleting(null), children: t("cancel") }),
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(import_dsh_client_ui_primitives2.Button, { variant: "outline", disabled: busy, onClick: remove, children: t("confirmDelete") })
        ] }),
        children: [
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("p", { children: t("deleteRecoveryPrompt") }),
          /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("label", { className: "rolling-skill-check", children: [
            /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("input", { type: "checkbox", checked: recoverQuestions, onChange: (event) => setRecoverQuestions(event.target.checked) }),
            /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { children: t("recoverToRawCases") })
          ] })
        ]
      }
    )
  ] });
}

// src/client/workbench/EvaluationsPanel.tsx
var import_dsh_client_ui_primitives3 = require("@deepseek-ai/dsh-client-ui-primitives");
var import_react3 = require("react");
var import_jsx_runtime4 = require("react/jsx-runtime");
function EvaluationsPanel({ t }) {
  const [runtimes, setRuntimes] = (0, import_react3.useState)([]);
  const [datasets, setDatasets] = (0, import_react3.useState)([]);
  const [runs, setRuns] = (0, import_react3.useState)([]);
  const [targetRuntimeId, setTargetRuntimeId] = (0, import_react3.useState)("");
  const [judgeRuntimeId, setJudgeRuntimeId] = (0, import_react3.useState)("");
  const [datasetId, setDatasetId] = (0, import_react3.useState)("");
  const [targetModels, setTargetModels] = (0, import_react3.useState)([]);
  const [judgeModels, setJudgeModels] = (0, import_react3.useState)([]);
  const [targetModelId, setTargetModelId] = (0, import_react3.useState)("");
  const [judgeModelId, setJudgeModelId] = (0, import_react3.useState)("");
  const [effort, setEffort] = (0, import_react3.useState)("high");
  const [detail, setDetail] = (0, import_react3.useState)(null);
  const [busy, setBusy] = (0, import_react3.useState)(false);
  const [error, setError] = (0, import_react3.useState)(null);
  const [revision, setRevision] = (0, import_react3.useState)(0);
  (0, import_react3.useEffect)(() => {
    const controller = new AbortController();
    Promise.all([
      requestRollingSkill("runtimes.list", {}, controller.signal),
      requestRollingSkill("datasets.list", {}, controller.signal),
      requestRollingSkill("evaluations.list", {}, controller.signal)
    ]).then(([runtimeItems, datasetItems, runItems]) => {
      setRuntimes(runtimeItems);
      setDatasets(datasetItems);
      setRuns(runItems);
      setTargetRuntimeId((current) => current || runtimeItems[0]?.runtimeId || "");
      setJudgeRuntimeId((current) => current || runtimeItems[0]?.runtimeId || "");
      setDatasetId((current) => current || datasetItems[0]?.id || "");
    }).catch((reason) => {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : t("loadError"));
    });
    return () => controller.abort();
  }, [revision]);
  (0, import_react3.useEffect)(() => {
    if (!targetRuntimeId) return;
    const controller = new AbortController();
    requestRollingSkill("runtimes.models", { runtimeId: targetRuntimeId }, controller.signal).then((models) => {
      setTargetModels(models);
      setTargetModelId(models[0]?.id ?? models[0]?.model ?? "");
    }).catch((reason) => {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : t("loadError"));
    });
    return () => controller.abort();
  }, [targetRuntimeId]);
  (0, import_react3.useEffect)(() => {
    if (!judgeRuntimeId) return;
    const controller = new AbortController();
    requestRollingSkill("runtimes.models", { runtimeId: judgeRuntimeId }, controller.signal).then((models) => {
      setJudgeModels(models);
      setJudgeModelId(models[0]?.id ?? models[0]?.model ?? "");
    }).catch((reason) => {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : t("loadError"));
    });
    return () => controller.abort();
  }, [judgeRuntimeId]);
  const mutate = async (operation) => {
    setBusy(true);
    setError(null);
    try {
      await operation();
      setRevision((value) => value + 1);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t("loadError"));
    } finally {
      setBusy(false);
    }
  };
  const start = () => mutate(() => requestRollingSkill("evaluations.start", {
    datasetId,
    selectionMode: "dataset",
    activationMode: "explicit",
    targets: [{ runtimeId: targetRuntimeId, modelId: targetModelId || null, effort }],
    judge: { runtimeId: judgeRuntimeId, modelId: judgeModelId || null, effort }
  }));
  const inspect = async (runId) => {
    setError(null);
    try {
      setDetail(await requestRollingSkill("evaluations.get", { runId }));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t("loadError"));
    }
  };
  return /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { className: "rolling-skill-data-stack", children: [
    /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("section", { className: "rolling-skill-panel", children: [
      /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("div", { className: "rolling-skill-panel-header", children: /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { children: [
        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("h3", { children: t("evaluationStartTitle") }),
        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("p", { children: t("evaluationStartDescription") })
      ] }) }),
      /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("label", { className: "rolling-skill-field", children: [
        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("span", { children: t("selectDataset") }),
        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("select", { className: "rolling-skill-select", value: datasetId, onChange: (event) => setDatasetId(event.target.value), children: datasets.map((dataset) => /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("option", { value: dataset.id, children: [
          dataset.name,
          " \xB7 ",
          dataset.caseCount
        ] }, dataset.id)) })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(RuntimeSelect, { t, runtimes, value: targetRuntimeId, onChange: setTargetRuntimeId, label: t("evaluationRuntime") }),
      /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { className: "rolling-skill-grid", children: [
        /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("label", { className: "rolling-skill-field", children: [
          /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("span", { children: t("model") }),
          /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("select", { className: "rolling-skill-select", value: targetModelId, onChange: (event) => setTargetModelId(event.target.value), children: targetModels.map((model) => {
            const id = model.id ?? model.model ?? "";
            return /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("option", { value: id, children: model.displayName ?? id }, id);
          }) })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("label", { className: "rolling-skill-field", children: [
          /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("span", { children: t("effort") }),
          /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("select", { className: "rolling-skill-select", value: effort, onChange: (event) => setEffort(event.target.value), children: ["low", "medium", "high", "xhigh", "max"].map((item) => /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("option", { value: item, children: item }, item)) })
        ] })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(RuntimeSelect, { t, runtimes, value: judgeRuntimeId, onChange: setJudgeRuntimeId, label: t("judgeRuntime") }),
      /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("label", { className: "rolling-skill-field", children: [
        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("span", { children: t("judgeModel") }),
        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("select", { className: "rolling-skill-select", value: judgeModelId, onChange: (event) => setJudgeModelId(event.target.value), children: judgeModels.map((model) => {
          const id = model.id ?? model.model ?? "";
          return /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("option", { value: id, children: model.displayName ?? id }, id);
        }) })
      ] }),
      error ? /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("p", { className: "rolling-skill-inline-error", role: "alert", children: error }) : null,
      /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(import_dsh_client_ui_primitives3.Button, { variant: "outline", disabled: busy || !datasetId || !targetRuntimeId || !judgeRuntimeId, onClick: () => void start(), children: t("startEvaluation") })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("section", { className: "rolling-skill-panel", children: [
      /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { className: "rolling-skill-panel-header", children: [
        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("div", { children: /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("h3", { children: t("evaluationRuns") }) }),
        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(import_dsh_client_ui_primitives3.Button, { variant: "ghost", size: "sm", onClick: () => setRevision((value) => value + 1), children: t("refresh") })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { className: "rolling-skill-list", children: [
        runs.map((run) => /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("article", { className: "rolling-skill-list-row", children: [
          /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { children: [
            /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("strong", { children: run.status }),
            /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("span", { children: [
              run.id,
              " \xB7 ",
              run.caseCount ?? 0,
              " Cases \xB7 ",
              run.runtimeCount ?? 0,
              " Runtimes"
            ] })
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { className: "rolling-skill-actions", children: [
            /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(import_dsh_client_ui_primitives3.Button, { variant: "ghost", size: "sm", onClick: () => void inspect(run.id), children: t("details") }),
            ["queued", "running"].includes(run.status) ? /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(import_dsh_client_ui_primitives3.Button, { variant: "ghost", size: "sm", disabled: busy, onClick: () => void mutate(() => requestRollingSkill("evaluations.cancel", { runId: run.id })), children: t("cancelRun") }) : null
          ] })
        ] }, run.id)),
        runs.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("p", { children: t("emptyEvaluations") }) : null
      ] })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(import_dsh_client_ui_primitives3.Modal, { open: detail !== null, onClose: () => setDetail(null), title: t("evaluationDetail"), closeLabel: t("cancel"), footer: /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(import_dsh_client_ui_primitives3.Button, { variant: "outline", onClick: () => setDetail(null), children: t("close") }), children: /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("div", { className: "rolling-skill-list", children: detail?.results.map((result) => /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("article", { className: "rolling-skill-list-row", children: /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { children: [
      /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("strong", { children: result.status }),
      /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("span", { children: result.response || result.error || result.id })
    ] }) }, result.id)) }) })
  ] });
}

// src/client/workbench/RawCasesPanel.tsx
var import_dsh_client_ui_primitives4 = require("@deepseek-ai/dsh-client-ui-primitives");
var import_react4 = require("react");
var import_jsx_runtime5 = require("react/jsx-runtime");
function RawCasesPanel({ t, revision, onChanged }) {
  const [entries, setEntries] = (0, import_react4.useState)([]);
  const [editing, setEditing] = (0, import_react4.useState)(null);
  const [question, setQuestion] = (0, import_react4.useState)("");
  const [note, setNote] = (0, import_react4.useState)("");
  const [deleting, setDeleting] = (0, import_react4.useState)(null);
  const [busy, setBusy] = (0, import_react4.useState)(false);
  const [error, setError] = (0, import_react4.useState)(null);
  (0, import_react4.useEffect)(() => {
    const controller = new AbortController();
    requestRollingSkill("rawCases.list", {}, controller.signal).then(setEntries).catch((reason) => {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : t("loadError"));
    });
    return () => controller.abort();
  }, [revision]);
  const mutate = async (operation) => {
    setBusy(true);
    setError(null);
    try {
      await operation();
      onChanged();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t("loadError"));
    } finally {
      setBusy(false);
    }
  };
  const beginEdit = (entry) => {
    setEditing(entry);
    setQuestion(entry.question);
    setNote(entry.note ?? "");
  };
  const save = () => {
    const entry = editing;
    if (!entry) return;
    void mutate(async () => {
      await requestRollingSkill("rawCases.update", {
        id: entry.id,
        expectedRevision: entry.revision,
        expectedSkillName: entry.skill.name,
        changes: { question, note },
        idempotencyKey: crypto.randomUUID()
      });
      setEditing(null);
    });
  };
  const recycle = () => {
    const entry = deleting;
    if (!entry) return;
    void mutate(async () => {
      await requestRollingSkill("rawCases.recycle", {
        id: entry.id,
        idempotencyKey: crypto.randomUUID()
      });
      setDeleting(null);
    });
  };
  return /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("section", { className: "rolling-skill-panel rolling-skill-data-panel", children: [
    /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("div", { className: "rolling-skill-panel-header", children: /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("div", { children: [
      /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("h3", { children: t("rawCasesTitle") }),
      /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("p", { children: t("rawCasesDescription") })
    ] }) }),
    error ? /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("p", { className: "rolling-skill-inline-error", role: "alert", children: error }) : null,
    /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("div", { className: "rolling-skill-list", children: [
      entries.map((entry) => /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("article", { className: "rolling-skill-list-row", children: [
        /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("div", { children: [
          /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("strong", { children: entry.question }),
          /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("span", { children: [
            entry.skill.name,
            entry.note ? ` \xB7 ${entry.note}` : ""
          ] })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("div", { className: "rolling-skill-actions", children: [
          /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(import_dsh_client_ui_primitives4.Button, { variant: "ghost", size: "sm", onClick: () => beginEdit(entry), children: t("edit") }),
          /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(import_dsh_client_ui_primitives4.Button, { variant: "ghost", size: "sm", onClick: () => setDeleting(entry), children: t("delete") })
        ] })
      ] }, entry.id)),
      entries.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("p", { children: t("emptyRawCases") }) : null
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(
      import_dsh_client_ui_primitives4.Modal,
      {
        open: editing !== null,
        onClose: () => setEditing(null),
        title: t("editRawCaseTitle"),
        closeLabel: t("cancel"),
        footer: /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)(import_jsx_runtime5.Fragment, { children: [
          /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(import_dsh_client_ui_primitives4.Button, { variant: "outline", onClick: () => setEditing(null), children: t("cancel") }),
          /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(import_dsh_client_ui_primitives4.Button, { variant: "outline", disabled: busy || !question.trim(), onClick: save, children: t("save") })
        ] }),
        children: /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("div", { className: "rolling-skill-form-stack", children: [
          /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("label", { children: [
            /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("span", { children: t("question") }),
            /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("textarea", { value: question, onChange: (event) => setQuestion(event.target.value) })
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("label", { children: [
            /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("span", { children: t("note") }),
            /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(import_dsh_client_ui_primitives4.Input, { value: note, onChange: (event) => setNote(event.target.value) })
          ] })
        ] })
      }
    ),
    /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(
      import_dsh_client_ui_primitives4.Modal,
      {
        open: deleting !== null,
        onClose: () => setDeleting(null),
        title: t("deleteRawCaseTitle"),
        closeLabel: t("cancel"),
        footer: /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)(import_jsx_runtime5.Fragment, { children: [
          /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(import_dsh_client_ui_primitives4.Button, { variant: "outline", onClick: () => setDeleting(null), children: t("cancel") }),
          /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(import_dsh_client_ui_primitives4.Button, { variant: "outline", disabled: busy, onClick: recycle, children: t("confirmDelete") })
        ] }),
        children: /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("p", { children: t("deleteRawCasePrompt") })
      }
    )
  ] });
}

// src/client/workbench/SkillsPanel.tsx
var import_dsh_client_ui_primitives5 = require("@deepseek-ai/dsh-client-ui-primitives");
var import_react5 = require("react");
var import_jsx_runtime6 = require("react/jsx-runtime");
function SkillsPanel({ t }) {
  const [catalog, setCatalog] = (0, import_react5.useState)({ repositories: [], skills: [] });
  const [detail, setDetail] = (0, import_react5.useState)(null);
  const [runtimes, setRuntimes] = (0, import_react5.useState)([]);
  const [runtimeId, setRuntimeId] = (0, import_react5.useState)("");
  const [sourceKind, setSourceKind] = (0, import_react5.useState)("folder");
  const [sourceLocation, setSourceLocation] = (0, import_react5.useState)("");
  const [candidateMessage, setCandidateMessage] = (0, import_react5.useState)("Update Skill workflow");
  const [releaseLabel, setReleaseLabel] = (0, import_react5.useState)("");
  const [installations, setInstallations] = (0, import_react5.useState)({ jobs: [] });
  const [busy, setBusy] = (0, import_react5.useState)(false);
  const [error, setError] = (0, import_react5.useState)(null);
  const [revision, setRevision] = (0, import_react5.useState)(0);
  (0, import_react5.useEffect)(() => {
    const controller = new AbortController();
    Promise.all([
      requestRollingSkill("skills.catalog", {}, controller.signal),
      requestRollingSkill("installations.targets", {}, controller.signal),
      requestRollingSkill("installations.list", {}, controller.signal)
    ]).then(([nextCatalog, runtimeItems, jobs]) => {
      setCatalog(nextCatalog);
      setRuntimes(runtimeItems);
      setRuntimeId((current) => current || runtimeItems[0]?.runtimeId || "");
      setInstallations(jobs);
      if (!detail && nextCatalog.skills[0]) void loadSkill(nextCatalog.skills[0].id, controller.signal);
    }).catch((reason) => {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : t("loadError"));
    });
    return () => controller.abort();
  }, [revision]);
  const loadSkill = async (skillId, signal) => {
    const next = await requestRollingSkill("skills.get", { skillId }, signal);
    setDetail(next);
    setInstallations(await requestRollingSkill("installations.list", { skillId }, signal));
  };
  const mutate = async (operation) => {
    setBusy(true);
    setError(null);
    try {
      await operation();
      setRevision((value) => value + 1);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t("loadError"));
    } finally {
      setBusy(false);
    }
  };
  const candidate = detail?.versions.find((version) => version.state === "candidate") ?? null;
  const released = (0, import_react5.useMemo)(() => detail?.versions.find((version) => version.state === "released" && !version.versionLabel?.startsWith("deprecated")) ?? null, [detail]);
  const createCandidate = () => mutate(async () => {
    if (!detail) return;
    const expectedBase = await requestRollingSkill("skills.candidateBase", { skillId: detail.skill.id });
    await requestRollingSkill("skills.createCandidate", { skillId: detail.skill.id, message: candidateMessage, expectedBase });
  });
  const release = () => mutate(() => requestRollingSkill("skills.release", {
    versionId: candidate?.id,
    versionLabel: releaseLabel,
    expectedCandidate: candidate ? {
      commit: candidate.commit,
      contentDigest: candidate.contentDigest,
      state: candidate.state,
      versionLabel: releaseLabel
    } : null
  }));
  const install = () => mutate(() => requestRollingSkill("installations.start", {
    skillId: detail?.skill.id,
    versionId: released?.id,
    targets: [{ runtimeId, modelId: null, effort: "high", permissionMode: null }]
  }));
  return /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("div", { className: "rolling-skill-data-stack", children: [
    /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("section", { className: "rolling-skill-panel", children: [
      /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("div", { className: "rolling-skill-panel-header", children: [
        /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("div", { children: [
          /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("h3", { children: t("skillRepositories") }),
          /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("p", { children: t("skillRepositoriesDescription") })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(import_dsh_client_ui_primitives5.Button, { variant: "ghost", size: "sm", disabled: busy, onClick: () => void mutate(() => requestRollingSkill("skills.rescan", {})), children: t("rescan") })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("div", { className: "rolling-skill-form-row", children: [
        /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("select", { className: "rolling-skill-select", value: sourceKind, onChange: (event) => setSourceKind(event.target.value), children: [
          /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("option", { value: "folder", children: "folder" }),
          /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("option", { value: "local-git", children: "local-git" }),
          /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("option", { value: "git-url", children: "git-url" }),
          /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("option", { value: "zip", children: "zip" })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(import_dsh_client_ui_primitives5.Input, { value: sourceLocation, placeholder: t("skillSourceLocation"), onChange: (event) => setSourceLocation(event.target.value) }),
        /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(import_dsh_client_ui_primitives5.Button, { variant: "outline", size: "sm", disabled: busy || !sourceLocation.trim(), onClick: () => void mutate(() => requestRollingSkill("skills.import", { kind: sourceKind, location: sourceLocation })), children: t("importSkill") })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("div", { className: "rolling-skill-list", children: [
        catalog.skills.map((skill) => /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("button", { type: "button", className: "rolling-skill-skill-row", onClick: () => void loadSkill(skill.id), children: [
          /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("strong", { children: skill.name }),
          /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("span", { children: skill.description || skill.status })
        ] }, skill.id)),
        catalog.skills.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("p", { children: t("emptySkills") }) : null
      ] })
    ] }),
    detail ? /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("section", { className: "rolling-skill-panel", children: [
      /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("div", { className: "rolling-skill-panel-header", children: /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("div", { children: [
        /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("h3", { children: detail.skill.name }),
        /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("p", { children: detail.skill.description || detail.skill.status })
      ] }) }),
      /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("pre", { className: "rolling-skill-manifest", children: detail.manifest }),
      /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("div", { className: "rolling-skill-grid", children: [
        /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("div", { className: "rolling-skill-subpanel", children: [
          /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("h4", { children: t("candidateVersion") }),
          /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(import_dsh_client_ui_primitives5.Input, { value: candidateMessage, onChange: (event) => setCandidateMessage(event.target.value) }),
          /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(import_dsh_client_ui_primitives5.Button, { variant: "outline", size: "sm", disabled: busy, onClick: () => void createCandidate(), children: t("createCandidate") })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("div", { className: "rolling-skill-subpanel", children: [
          /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("h4", { children: t("releaseVersion") }),
          /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(import_dsh_client_ui_primitives5.Input, { value: releaseLabel, placeholder: "1.0.0", onChange: (event) => setReleaseLabel(event.target.value) }),
          /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(import_dsh_client_ui_primitives5.Button, { variant: "outline", size: "sm", disabled: busy || !candidate || !releaseLabel.trim(), onClick: () => void release(), children: t("release") })
        ] })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(RuntimeSelect, { t, runtimes, value: runtimeId, onChange: setRuntimeId, label: t("installationRuntime") }),
      /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(import_dsh_client_ui_primitives5.Button, { variant: "outline", disabled: busy || !released || !runtimeId, onClick: () => void install(), children: t("installReleased") })
    ] }) : null,
    /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("section", { className: "rolling-skill-panel", children: [
      /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("h3", { children: t("installationJobs") }),
      error ? /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("p", { className: "rolling-skill-inline-error", role: "alert", children: error }) : null,
      /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("div", { className: "rolling-skill-list", children: installations.jobs.map((job) => /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("article", { className: "rolling-skill-list-row", children: [
        /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("div", { children: [
          /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("strong", { children: job.status }),
          /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("span", { children: [
            job.runtime.displayName,
            " ",
            job.runtime.version || "",
            " \xB7 ",
            job.id
          ] })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("div", { className: "rolling-skill-actions", children: [
          /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(import_dsh_client_ui_primitives5.Button, { variant: "ghost", size: "sm", disabled: busy, onClick: () => void mutate(() => requestRollingSkill("installations.inspect", { jobId: job.id })), children: t("inspect") }),
          ["queued", "running", "awaiting_permission", "awaiting_confirmation"].includes(job.status) ? /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(import_dsh_client_ui_primitives5.Button, { variant: "ghost", size: "sm", disabled: busy, onClick: () => void mutate(() => requestRollingSkill("installations.cancel", { jobId: job.id })), children: t("cancelRun") }) : null
        ] })
      ] }, job.id)) })
    ] })
  ] });
}

// src/client/workbench/Workbench.tsx
var import_jsx_runtime7 = require("react/jsx-runtime");
var TABS = [
  { id: "overview", label: "overview" },
  { id: "cases", label: "cases" },
  { id: "skills", label: "skills" },
  { id: "evaluations", label: "evaluations" },
  { id: "automatic", label: "automatic" },
  { id: "operator", label: "operator" },
  { id: "settings", label: "settings" }
];
function dateTime(value, fallback) {
  if (!value) return fallback;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleString() : fallback;
}
function Workbench({ locale, t }) {
  (0, import_react6.useSyncExternalStore)(
    (listener) => locale.subscribe(listener),
    () => locale.getSnapshot().revision,
    () => 0
  );
  const [activeTab, setActiveTab] = (0, import_react6.useState)("overview");
  const [reloadRevision, setReloadRevision] = (0, import_react6.useState)(0);
  const [dataRevision, setDataRevision] = (0, import_react6.useState)(0);
  const [state, setState] = (0, import_react6.useState)({ status: "loading" });
  (0, import_react6.useEffect)(() => {
    const controller = new AbortController();
    setState({ status: "loading" });
    requestRollingSkill("dashboard.get", {}, controller.signal).then((dashboard) => setState({ status: "ready", dashboard })).catch((error) => {
      if (controller.signal.aborted) return;
      setState({
        status: "error",
        message: error instanceof Error ? error.message : t("loadError")
      });
    });
    return () => controller.abort();
  }, [reloadRevision]);
  const reload = () => setReloadRevision((revision) => revision + 1);
  return /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("section", { className: "rolling-skill-workbench", "aria-labelledby": "rolling-skill-title", children: [
    /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("header", { className: "rolling-skill-header", children: [
      /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("div", { children: [
        /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("h2", { id: "rolling-skill-title", children: t("title") }),
        /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("p", { children: t("subtitle") })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(import_dsh_client_ui_primitives6.Button, { variant: "outline", size: "sm", onClick: reload, disabled: state.status === "loading", children: t("refresh") })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("nav", { className: "rolling-skill-tabs", "aria-label": t("title"), children: TABS.map((tab) => /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(
      import_dsh_client_ui_primitives6.Button,
      {
        variant: activeTab === tab.id ? "outline" : "ghost",
        size: "sm",
        "aria-pressed": activeTab === tab.id,
        onClick: () => setActiveTab(tab.id),
        children: t(tab.label)
      },
      tab.id
    )) }),
    state.status === "loading" ? /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("div", { className: "rolling-skill-state", role: "status", children: t("loading") }) : state.status === "error" ? /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("div", { className: "rolling-skill-state rolling-skill-error", role: "alert", children: [
      /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("strong", { children: t("loadError") }),
      /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("span", { children: state.message }),
      /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(import_dsh_client_ui_primitives6.Button, { variant: "outline", size: "sm", onClick: reload, children: t("retry") })
    ] }) : activeTab === "cases" ? /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("div", { className: "rolling-skill-data-stack", children: [
      /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(DatasetsPanel, { t, onChanged: () => setDataRevision((value) => value + 1) }),
      /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(CasesPanel, { t, revision: dataRevision, onChanged: () => setDataRevision((value) => value + 1) }),
      /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(RawCasesPanel, { t, revision: dataRevision, onChanged: () => setDataRevision((value) => value + 1) })
    ] }) : activeTab === "evaluations" ? /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(EvaluationsPanel, { t }) : activeTab === "skills" ? /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(SkillsPanel, { t }) : activeTab !== "overview" ? /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("div", { className: "rolling-skill-panel", children: [
      /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("h3", { children: t(TABS.find((tab) => tab.id === activeTab)?.label ?? "overview") }),
      /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("p", { children: t("comingSoon") })
    ] }) : /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(Overview, { dashboard: state.dashboard, t })
  ] });
}
function Overview({ dashboard, t }) {
  const counts = [
    { key: "datasets", label: "datasetsCount" },
    { key: "cases", label: "casesCount" },
    { key: "rawCases", label: "rawCasesCount" },
    { key: "evaluations", label: "evaluationsCount" },
    { key: "managedSkills", label: "managedSkillsCount" }
  ];
  const runtime = dashboard.settings.plugin.runtime;
  return /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("div", { className: "rolling-skill-overview", children: [
    /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("div", { className: "rolling-skill-counts", children: counts.map((count) => /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("div", { className: "rolling-skill-count", children: [
      /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("strong", { children: dashboard.counts[count.key] }),
      /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("span", { children: t(count.label) })
    ] }, count.key)) }),
    /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("div", { className: "rolling-skill-grid", children: [
      /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("section", { className: "rolling-skill-panel", children: [
        /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("h3", { children: t("automaticStatus") }),
        /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("dl", { children: [
          /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("div", { children: [
            /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("dt", { children: t("nextRun") }),
            /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("dd", { children: t("notAvailable") })
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("div", { children: [
            /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("dt", { children: t("lastSuccess") }),
            /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("dd", { children: dateTime(dashboard.automaticCapture.lastSuccessAt, t("notAvailable")) })
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("div", { children: [
            /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("dt", { children: t("lastError") }),
            /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("dd", { children: dashboard.automaticCapture.lastError?.message ?? t("noError") })
          ] })
        ] })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("section", { className: "rolling-skill-panel", children: [
        /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("h3", { children: t("runtime") }),
        runtime ? /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("div", { className: "rolling-skill-runtime", children: [
          /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("strong", { children: [runtime.displayName ?? runtime.runtimeId, runtime.version].filter(Boolean).join(" ") }),
          /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("code", { children: runtime.executablePath })
        ] }) : /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("p", { children: t("noRuntime") })
      ] })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("section", { className: "rolling-skill-panel rolling-skill-path", children: [
      /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("h3", { children: t("dataDirectory") }),
      /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("code", { children: dashboard.dataRoot })
    ] })
  ] });
}

// src/client/workbench/workbench.css
var workbench_default = ".rolling-skill-workbench {\n    box-sizing: border-box;\n    color: var(--dsw-alias-label-primary);\n    display: grid;\n    gap: 20px;\n    min-width: 0;\n    padding: 4px 0 24px;\n}\n\n.rolling-skill-header {\n    align-items: flex-start;\n    display: flex;\n    gap: 16px;\n    justify-content: space-between;\n}\n\n.rolling-skill-header h2,\n.rolling-skill-panel h3 {\n    margin: 0;\n}\n\n.rolling-skill-header p,\n.rolling-skill-panel p {\n    color: var(--dsw-alias-label-secondary);\n    margin: 6px 0 0;\n}\n\n.rolling-skill-tabs {\n    align-items: center;\n    border-bottom: 1px solid var(--dsw-alias-border-l2);\n    display: flex;\n    flex-wrap: wrap;\n    gap: 4px;\n    padding-bottom: 10px;\n}\n\n.rolling-skill-counts {\n    display: grid;\n    gap: 10px;\n    grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));\n}\n\n.rolling-skill-count,\n.rolling-skill-panel,\n.rolling-skill-state {\n    background: var(--dsw-alias-bg-layer-2);\n    border: 1px solid var(--dsw-alias-border-l2);\n    border-radius: 10px;\n}\n\n.rolling-skill-count {\n    display: grid;\n    gap: 4px;\n    padding: 14px;\n}\n\n.rolling-skill-count strong {\n    font-size: 22px;\n    line-height: 28px;\n}\n\n.rolling-skill-count span,\n.rolling-skill-panel dt {\n    color: var(--dsw-alias-label-secondary);\n    font-size: 12px;\n}\n\n.rolling-skill-overview {\n    display: grid;\n    gap: 12px;\n}\n\n.rolling-skill-grid {\n    display: grid;\n    gap: 12px;\n    grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));\n}\n\n.rolling-skill-panel,\n.rolling-skill-state {\n    min-width: 0;\n    padding: 16px;\n}\n\n.rolling-skill-panel dl {\n    display: grid;\n    gap: 10px;\n    margin: 14px 0 0;\n}\n\n.rolling-skill-panel dl > div {\n    align-items: baseline;\n    display: flex;\n    gap: 12px;\n    justify-content: space-between;\n}\n\n.rolling-skill-panel dd {\n    margin: 0;\n    max-width: 68%;\n    overflow-wrap: anywhere;\n    text-align: right;\n}\n\n.rolling-skill-runtime,\n.rolling-skill-state {\n    display: grid;\n    gap: 8px;\n}\n\n.rolling-skill-runtime {\n    margin-top: 14px;\n}\n\n.rolling-skill-runtime code,\n.rolling-skill-path code {\n    color: var(--dsw-alias-label-secondary);\n    font-family: ui-monospace, monospace;\n    font-size: 12px;\n    overflow-wrap: anywhere;\n}\n\n.rolling-skill-path code {\n    display: block;\n    margin-top: 10px;\n}\n\n.rolling-skill-error {\n    border-color: var(--dsw-alias-state-error-primary);\n    color: var(--dsw-alias-label-error);\n}\n\n.rolling-skill-data-stack,\n.rolling-skill-form-stack,\n.rolling-skill-list {\n    display: grid;\n    gap: 12px;\n}\n\n.rolling-skill-panel-header,\n.rolling-skill-list-row,\n.rolling-skill-case-row,\n.rolling-skill-form-row,\n.rolling-skill-actions {\n    align-items: center;\n    display: flex;\n    gap: 10px;\n}\n\n.rolling-skill-panel-header,\n.rolling-skill-list-row,\n.rolling-skill-case-row {\n    justify-content: space-between;\n}\n\n.rolling-skill-form-row,\n.rolling-skill-list {\n    margin-top: 14px;\n}\n\n.rolling-skill-form-row > :first-child {\n    flex: 1;\n}\n\n.rolling-skill-list-row,\n.rolling-skill-case-row {\n    background: var(--dsw-alias-bg-layer-1);\n    border: 1px solid var(--dsw-alias-border-l3);\n    border-radius: 8px;\n    min-width: 0;\n    padding: 12px;\n}\n\n.rolling-skill-list-row > div:first-child,\n.rolling-skill-case-copy {\n    display: grid;\n    gap: 5px;\n    min-width: 0;\n}\n\n.rolling-skill-list-row span,\n.rolling-skill-case-copy p {\n    color: var(--dsw-alias-label-secondary);\n    font-size: 12px;\n    overflow-wrap: anywhere;\n}\n\n.rolling-skill-case-copy p {\n    margin: 0;\n    white-space: pre-wrap;\n}\n\n.rolling-skill-select,\n.rolling-skill-form-stack textarea {\n    background: var(--dsw-alias-bg-layer-1);\n    border: 1px solid var(--dsw-alias-border-l2);\n    border-radius: 7px;\n    color: var(--dsw-alias-label-primary);\n    font: inherit;\n    padding: 8px 10px;\n}\n\n.rolling-skill-select {\n    margin-top: 14px;\n    max-width: 360px;\n    width: 100%;\n}\n\n.rolling-skill-form-stack label {\n    display: grid;\n    gap: 6px;\n}\n\n.rolling-skill-form-stack textarea {\n    min-height: 120px;\n    resize: vertical;\n}\n\n.rolling-skill-check {\n    align-items: center;\n    display: flex;\n    gap: 8px;\n    margin-top: 12px;\n}\n\n.rolling-skill-badge {\n    color: var(--dsw-alias-state-business-primary);\n    font-size: 11px;\n    font-weight: 600;\n}\n\n.rolling-skill-inline-error {\n    color: var(--dsw-alias-label-error) !important;\n}\n\n.rolling-skill-runtime-select {\n    border: 0;\n    display: grid;\n    gap: 8px;\n    margin: 16px 0;\n    min-width: 0;\n    padding: 0;\n}\n\n.rolling-skill-runtime-select legend,\n.rolling-skill-field > span {\n    color: var(--dsw-alias-label-secondary);\n    font-size: 12px;\n    font-weight: 600;\n}\n\n.rolling-skill-runtime-list {\n    display: grid;\n    gap: 8px;\n    grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));\n}\n\n.rolling-skill-runtime-option {\n    align-items: flex-start;\n    background: var(--dsw-alias-bg-layer-1);\n    border: 1px solid var(--dsw-alias-border-l2);\n    border-radius: 8px;\n    display: flex;\n    gap: 9px;\n    min-width: 0;\n    padding: 10px;\n}\n\n.rolling-skill-runtime-option:has(input:checked) {\n    border-color: var(--dsw-alias-state-business-primary);\n}\n\n.rolling-skill-runtime-option > span,\n.rolling-skill-field {\n    display: grid;\n    gap: 5px;\n    min-width: 0;\n}\n\n.rolling-skill-runtime-option code {\n    color: var(--dsw-alias-label-secondary);\n    font-family: ui-monospace, monospace;\n    font-size: 11px;\n    overflow-wrap: anywhere;\n}\n\n.rolling-skill-field .rolling-skill-select {\n    margin-top: 0;\n}\n\n.rolling-skill-skill-row {\n    background: var(--dsw-alias-bg-layer-1);\n    border: 1px solid var(--dsw-alias-border-l3);\n    border-radius: 8px;\n    color: var(--dsw-alias-label-primary);\n    cursor: pointer;\n    display: grid;\n    gap: 4px;\n    padding: 11px;\n    text-align: left;\n}\n\n.rolling-skill-skill-row span {\n    color: var(--dsw-alias-label-secondary);\n    font-size: 12px;\n}\n\n.rolling-skill-manifest {\n    background: var(--dsw-alias-bg-layer-1);\n    border: 1px solid var(--dsw-alias-border-l3);\n    border-radius: 8px;\n    color: var(--dsw-alias-label-secondary);\n    max-height: 240px;\n    overflow: auto;\n    padding: 12px;\n    white-space: pre-wrap;\n}\n\n.rolling-skill-subpanel {\n    display: grid;\n    gap: 9px;\n}\n\n.rolling-skill-subpanel h4 {\n    margin: 0;\n}\n\n@media (max-width: 760px) {\n    .rolling-skill-panel-header,\n    .rolling-skill-list-row,\n    .rolling-skill-case-row,\n    .rolling-skill-form-row {\n        align-items: stretch;\n        flex-direction: column;\n    }\n}\n\n@media (max-width: 640px) {\n    .rolling-skill-header {\n        align-items: stretch;\n        flex-direction: column;\n    }\n}\n";

// src/client/locale.ts
var LOCALE_NAMESPACE = "rolling-skill";
var zh = {
  nav: "Rolling Skill",
  title: "Rolling Skill \u5DE5\u4F5C\u53F0",
  subtitle: "\u6301\u7EED\u6C89\u6DC0\u3001\u66F4\u65B0\u5E76\u8BC4\u6D4B\u771F\u5B9E Case",
  refresh: "\u5237\u65B0",
  loading: "\u6B63\u5728\u8BFB\u53D6 Rolling Skill \u6570\u636E\u2026",
  loadError: "\u65E0\u6CD5\u8BFB\u53D6 Rolling Skill \u6570\u636E",
  retry: "\u91CD\u8BD5",
  overview: "\u6982\u89C8",
  cases: "Case \u4E0E\u6570\u636E\u96C6",
  skills: "Skill \u7BA1\u7406",
  evaluations: "Skill \u8BC4\u6D4B",
  automatic: "\u81EA\u52A8\u6C89\u6DC0",
  operator: "\u81EA\u64CD\u4F5C\u4E0E\u4F18\u5316",
  settings: "\u63D2\u4EF6\u8BBE\u7F6E",
  datasetsCount: "\u6570\u636E\u96C6",
  casesCount: "Case",
  rawCasesCount: "Raw Case",
  evaluationsCount: "\u8BC4\u6D4B\u8FD0\u884C",
  managedSkillsCount: "Managed Skill",
  automaticStatus: "\u81EA\u52A8\u6C89\u6DC0\u72B6\u6001",
  nextRun: "\u4E0B\u6B21\u8FD0\u884C",
  lastSuccess: "\u4E0A\u6B21\u6210\u529F",
  lastError: "\u4E0A\u6B21\u9519\u8BEF",
  notAvailable: "\u2014",
  noError: "\u65E0",
  runtime: "\u76EE\u6807 Runtime",
  noRuntime: "\u5C1A\u672A\u9009\u62E9 Runtime",
  dataDirectory: "\u6570\u636E\u76EE\u5F55",
  comingSoon: "\u6B64\u6A21\u5757\u5C06\u5728\u63A5\u4E0B\u6765\u7684\u63D2\u4EF6\u5316\u6B65\u9AA4\u4E2D\u63A5\u5165\u5171\u4EAB Core\u3002",
  datasetsTitle: "\u6570\u636E\u96C6",
  datasetsDescription: "\u7EC4\u7EC7 Case\uFF0C\u5E76\u5BFC\u51FA\u53EF\u79FB\u690D\u7684 CSV \u6570\u636E\u3002",
  datasetName: "\u6570\u636E\u96C6\u540D\u79F0",
  createDataset: "\u65B0\u5EFA\u6570\u636E\u96C6",
  caseBreakdown: "\u5171 {all} \xB7 Good {good} \xB7 Bad {bad}",
  exportCsv: "\u5BFC\u51FA CSV",
  delete: "\u5220\u9664",
  emptyDatasets: "\u6682\u65E0\u6570\u636E\u96C6",
  deleteDatasetTitle: "\u5220\u9664\u6570\u636E\u96C6",
  deleteCaseTitle: "\u5220\u9664 Case",
  deleteRecoveryPrompt: "\u5220\u9664\u524D\u53EF\u4EE5\u628A\u6709\u4EF7\u503C\u7684\u95EE\u9898\u653E\u56DE Raw Case\uFF0C\u4E4B\u540E\u4ECD\u53EF\u91CD\u65B0\u6C89\u6DC0\u3002",
  recoverToRawCases: "\u5C06\u95EE\u9898\u4FDD\u5B58\u5230 Raw Case",
  cancel: "\u53D6\u6D88",
  confirmDelete: "\u786E\u8BA4\u5220\u9664",
  casesTitle: "Case",
  casesDescription: "\u67E5\u770B\u5F53\u524D\u7B54\u6848\uFF0C\u5355\u4E2A\u66F4\u65B0\u6216\u6309\u8303\u56F4\u6279\u91CF\u66F4\u65B0\u3002",
  selectDataset: "\u9009\u62E9\u6570\u636E\u96C6",
  refreshGoodCases: "\u66F4\u65B0 Good Case",
  refreshAllCases: "\u66F4\u65B0\u5168\u90E8",
  refreshCase: "\u66F4\u65B0",
  goodcase: "Good Case",
  badcase: "Bad Case",
  emptyCases: "\u6B64\u6570\u636E\u96C6\u6682\u65E0 Case",
  rawCasesTitle: "Raw Case",
  rawCasesDescription: "\u7F16\u8F91\u5F85\u6C89\u6DC0\u7684\u95EE\u9898\uFF0C\u6216\u79FB\u9664\u4E0D\u518D\u9700\u8981\u7684\u6761\u76EE\u3002",
  edit: "\u7F16\u8F91",
  save: "\u4FDD\u5B58",
  question: "\u95EE\u9898",
  note: "\u5907\u6CE8",
  emptyRawCases: "\u6682\u65E0 Raw Case",
  editRawCaseTitle: "\u7F16\u8F91 Raw Case",
  deleteRawCaseTitle: "\u5220\u9664 Raw Case",
  deleteRawCasePrompt: "\u6B64\u64CD\u4F5C\u4F1A\u4ECE\u5F85\u5904\u7406\u5217\u8868\u4E2D\u79FB\u9664\u8BE5\u95EE\u9898\u3002",
  noRuntimes: "\u672A\u53D1\u73B0\u517C\u5BB9\u7684 Runtime",
  refreshRuntime: "Case \u66F4\u65B0 Runtime",
  evaluationStartTitle: "\u5F00\u59CB\u8BC4\u6D4B",
  evaluationStartDescription: "\u76EE\u6807\u548C Judge \u90FD\u6309\u5B8C\u6574 Runtime \u8EAB\u4EFD\u8FD0\u884C\u3002",
  evaluationRuntime: "\u76EE\u6807 Runtime",
  judgeRuntime: "Judge Runtime",
  model: "\u6A21\u578B",
  judgeModel: "Judge \u6A21\u578B",
  effort: "\u63A8\u7406\u5F3A\u5EA6",
  startEvaluation: "\u5F00\u59CB\u8BC4\u6D4B",
  evaluationRuns: "\u8BC4\u6D4B\u8BB0\u5F55",
  details: "\u8BE6\u60C5",
  cancelRun: "\u53D6\u6D88\u8FD0\u884C",
  emptyEvaluations: "\u6682\u65E0\u8BC4\u6D4B\u8BB0\u5F55",
  evaluationDetail: "\u8BC4\u6D4B\u8BE6\u60C5",
  close: "\u5173\u95ED",
  skillRepositories: "Managed Skill",
  skillRepositoriesDescription: "\u5BFC\u5165\u3001\u53D1\u5E03\u5E76\u5B89\u88C5\u4E0D\u53EF\u53D8 Skill \u7248\u672C\u3002",
  rescan: "\u91CD\u65B0\u626B\u63CF",
  skillSourceLocation: "\u7EDD\u5BF9\u8DEF\u5F84\u6216 Git URL",
  importSkill: "\u5BFC\u5165",
  emptySkills: "\u6682\u65E0 Managed Skill",
  candidateVersion: "Candidate",
  createCandidate: "\u521B\u5EFA Candidate",
  releaseVersion: "Release",
  release: "\u53D1\u5E03",
  installationRuntime: "\u5B89\u88C5\u76EE\u6807 Runtime",
  installReleased: "\u5B89\u88C5\u5DF2\u53D1\u5E03\u7248\u672C",
  installationJobs: "\u5B89\u88C5 Job",
  inspect: "\u68C0\u67E5"
};
var en = {
  nav: "Rolling Skill",
  title: "Rolling Skill Workbench",
  subtitle: "Continuously curate, refresh, and evaluate real Cases",
  refresh: "Refresh",
  loading: "Loading Rolling Skill data\u2026",
  loadError: "Could not load Rolling Skill data",
  retry: "Retry",
  overview: "Overview",
  cases: "Cases & Datasets",
  skills: "Skill Management",
  evaluations: "Skill Evaluations",
  automatic: "Automatic Capture",
  operator: "Operator & Optimization",
  settings: "Plugin Settings",
  datasetsCount: "Datasets",
  casesCount: "Cases",
  rawCasesCount: "Raw Cases",
  evaluationsCount: "Evaluation Runs",
  managedSkillsCount: "Managed Skills",
  automaticStatus: "Automatic Capture Status",
  nextRun: "Next Run",
  lastSuccess: "Last Success",
  lastError: "Last Error",
  notAvailable: "\u2014",
  noError: "None",
  runtime: "Target Runtime",
  noRuntime: "No Runtime selected",
  dataDirectory: "Data Directory",
  comingSoon: "This module will connect to the shared Core in the next pluginization steps.",
  datasetsTitle: "Datasets",
  datasetsDescription: "Organize Cases and export portable CSV data.",
  datasetName: "Dataset name",
  createDataset: "Create Dataset",
  caseBreakdown: "{all} total \xB7 {good} Good \xB7 {bad} Bad",
  exportCsv: "Export CSV",
  delete: "Delete",
  emptyDatasets: "No datasets yet",
  deleteDatasetTitle: "Delete Dataset",
  deleteCaseTitle: "Delete Case",
  deleteRecoveryPrompt: "Before deletion, valuable questions can be returned to Raw Cases for later curation.",
  recoverToRawCases: "Save questions to Raw Cases",
  cancel: "Cancel",
  confirmDelete: "Confirm Delete",
  casesTitle: "Cases",
  casesDescription: "Review current answers, refresh one Case, or refresh a selected scope.",
  selectDataset: "Select Dataset",
  refreshGoodCases: "Refresh Good Cases",
  refreshAllCases: "Refresh All",
  refreshCase: "Refresh",
  goodcase: "Good Case",
  badcase: "Bad Case",
  emptyCases: "This dataset has no Cases",
  rawCasesTitle: "Raw Cases",
  rawCasesDescription: "Edit pending questions or remove entries that are no longer useful.",
  edit: "Edit",
  save: "Save",
  question: "Question",
  note: "Note",
  emptyRawCases: "No Raw Cases",
  editRawCaseTitle: "Edit Raw Case",
  deleteRawCaseTitle: "Delete Raw Case",
  deleteRawCasePrompt: "This removes the question from the pending list.",
  noRuntimes: "No compatible Runtimes found",
  refreshRuntime: "Case Refresh Runtime",
  evaluationStartTitle: "Start Evaluation",
  evaluationStartDescription: "Targets and the Judge run against exact Runtime identities.",
  evaluationRuntime: "Target Runtime",
  judgeRuntime: "Judge Runtime",
  model: "Model",
  judgeModel: "Judge Model",
  effort: "Reasoning Effort",
  startEvaluation: "Start Evaluation",
  evaluationRuns: "Evaluation Runs",
  details: "Details",
  cancelRun: "Cancel Run",
  emptyEvaluations: "No evaluation runs",
  evaluationDetail: "Evaluation Detail",
  close: "Close",
  skillRepositories: "Managed Skills",
  skillRepositoriesDescription: "Import, release, and install immutable Skill versions.",
  rescan: "Rescan",
  skillSourceLocation: "Absolute path or Git URL",
  importSkill: "Import",
  emptySkills: "No Managed Skills",
  candidateVersion: "Candidate",
  createCandidate: "Create Candidate",
  releaseVersion: "Release",
  release: "Release",
  installationRuntime: "Installation Target Runtime",
  installReleased: "Install Released Version",
  installationJobs: "Installation Jobs",
  inspect: "Inspect"
};
var DICTIONARIES = { zh, en };

// src/client/index.tsx
var import_jsx_runtime8 = require("react/jsx-runtime");
var inject = ["slots", "locale"];
function apply(ctx) {
  ctx.effect(
    () => ctx.locale.register(LOCALE_NAMESPACE, DICTIONARIES),
    "rolling-skill: dictionaries"
  );
  const t = ctx.locale.bind(LOCALE_NAMESPACE);
  ctx.effect(() => {
    const style = document.createElement("style");
    style.dataset.plugin = "@rolling-skill/dsh-plugin";
    style.textContent = workbench_default;
    document.head.appendChild(style);
    return () => style.remove();
  }, "rolling-skill: workbench styles");
  const RollingSkillSection = () => /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(Workbench, { locale: ctx.locale, t });
  ctx.slots.inject("settings.section", () => ctx.slots.register({
    name: "settings.section",
    id: "rolling-skill",
    order: 20,
    label: () => t("nav"),
    locale: LOCALE_NAMESPACE
  }, RollingSkillSection));
}
return module.exports;}});
