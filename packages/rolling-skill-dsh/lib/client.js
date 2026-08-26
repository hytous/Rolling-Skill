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
var import_dsh_client_ui_primitives = require("@deepseek-ai/dsh-client-ui-primitives");
var import_react = require("react");

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

// src/client/workbench/Workbench.tsx
var import_jsx_runtime = require("react/jsx-runtime");
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
  (0, import_react.useSyncExternalStore)(
    (listener) => locale.subscribe(listener),
    () => locale.getSnapshot().revision,
    () => 0
  );
  const [activeTab, setActiveTab] = (0, import_react.useState)("overview");
  const [reloadRevision, setReloadRevision] = (0, import_react.useState)(0);
  const [state, setState] = (0, import_react.useState)({ status: "loading" });
  (0, import_react.useEffect)(() => {
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
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", { className: "rolling-skill-workbench", "aria-labelledby": "rolling-skill-title", children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("header", { className: "rolling-skill-header", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", { id: "rolling-skill-title", children: t("title") }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { children: t("subtitle") })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_dsh_client_ui_primitives.Button, { variant: "outline", size: "sm", onClick: reload, disabled: state.status === "loading", children: t("refresh") })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("nav", { className: "rolling-skill-tabs", "aria-label": t("title"), children: TABS.map((tab) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
      import_dsh_client_ui_primitives.Button,
      {
        variant: activeTab === tab.id ? "outline" : "ghost",
        size: "sm",
        "aria-pressed": activeTab === tab.id,
        onClick: () => setActiveTab(tab.id),
        children: t(tab.label)
      },
      tab.id
    )) }),
    state.status === "loading" ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "rolling-skill-state", role: "status", children: t("loading") }) : state.status === "error" ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "rolling-skill-state rolling-skill-error", role: "alert", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("strong", { children: t("loadError") }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: state.message }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_dsh_client_ui_primitives.Button, { variant: "outline", size: "sm", onClick: reload, children: t("retry") })
    ] }) : activeTab !== "overview" ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "rolling-skill-panel", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("h3", { children: t(TABS.find((tab) => tab.id === activeTab)?.label ?? "overview") }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { children: t("comingSoon") })
    ] }) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Overview, { dashboard: state.dashboard, t })
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
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "rolling-skill-overview", children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "rolling-skill-counts", children: counts.map((count) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "rolling-skill-count", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("strong", { children: dashboard.counts[count.key] }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: t(count.label) })
    ] }, count.key)) }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "rolling-skill-grid", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", { className: "rolling-skill-panel", children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("h3", { children: t("automaticStatus") }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("dl", { children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("dt", { children: t("nextRun") }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("dd", { children: t("notAvailable") })
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("dt", { children: t("lastSuccess") }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("dd", { children: dateTime(dashboard.automaticCapture.lastSuccessAt, t("notAvailable")) })
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("dt", { children: t("lastError") }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("dd", { children: dashboard.automaticCapture.lastError?.message ?? t("noError") })
          ] })
        ] })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", { className: "rolling-skill-panel", children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("h3", { children: t("runtime") }),
        runtime ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "rolling-skill-runtime", children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("strong", { children: [runtime.displayName ?? runtime.runtimeId, runtime.version].filter(Boolean).join(" ") }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("code", { children: runtime.executablePath })
        ] }) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { children: t("noRuntime") })
      ] })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", { className: "rolling-skill-panel rolling-skill-path", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("h3", { children: t("dataDirectory") }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("code", { children: dashboard.dataRoot })
    ] })
  ] });
}

// src/client/workbench/workbench.css
var workbench_default = ".rolling-skill-workbench {\n    box-sizing: border-box;\n    color: var(--dsw-alias-label-primary);\n    display: grid;\n    gap: 20px;\n    min-width: 0;\n    padding: 4px 0 24px;\n}\n\n.rolling-skill-header {\n    align-items: flex-start;\n    display: flex;\n    gap: 16px;\n    justify-content: space-between;\n}\n\n.rolling-skill-header h2,\n.rolling-skill-panel h3 {\n    margin: 0;\n}\n\n.rolling-skill-header p,\n.rolling-skill-panel p {\n    color: var(--dsw-alias-label-secondary);\n    margin: 6px 0 0;\n}\n\n.rolling-skill-tabs {\n    align-items: center;\n    border-bottom: 1px solid var(--dsw-alias-border-l2);\n    display: flex;\n    flex-wrap: wrap;\n    gap: 4px;\n    padding-bottom: 10px;\n}\n\n.rolling-skill-counts {\n    display: grid;\n    gap: 10px;\n    grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));\n}\n\n.rolling-skill-count,\n.rolling-skill-panel,\n.rolling-skill-state {\n    background: var(--dsw-alias-bg-layer-2);\n    border: 1px solid var(--dsw-alias-border-l2);\n    border-radius: 10px;\n}\n\n.rolling-skill-count {\n    display: grid;\n    gap: 4px;\n    padding: 14px;\n}\n\n.rolling-skill-count strong {\n    font-size: 22px;\n    line-height: 28px;\n}\n\n.rolling-skill-count span,\n.rolling-skill-panel dt {\n    color: var(--dsw-alias-label-secondary);\n    font-size: 12px;\n}\n\n.rolling-skill-overview {\n    display: grid;\n    gap: 12px;\n}\n\n.rolling-skill-grid {\n    display: grid;\n    gap: 12px;\n    grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));\n}\n\n.rolling-skill-panel,\n.rolling-skill-state {\n    min-width: 0;\n    padding: 16px;\n}\n\n.rolling-skill-panel dl {\n    display: grid;\n    gap: 10px;\n    margin: 14px 0 0;\n}\n\n.rolling-skill-panel dl > div {\n    align-items: baseline;\n    display: flex;\n    gap: 12px;\n    justify-content: space-between;\n}\n\n.rolling-skill-panel dd {\n    margin: 0;\n    max-width: 68%;\n    overflow-wrap: anywhere;\n    text-align: right;\n}\n\n.rolling-skill-runtime,\n.rolling-skill-state {\n    display: grid;\n    gap: 8px;\n}\n\n.rolling-skill-runtime {\n    margin-top: 14px;\n}\n\n.rolling-skill-runtime code,\n.rolling-skill-path code {\n    color: var(--dsw-alias-label-secondary);\n    font-family: ui-monospace, monospace;\n    font-size: 12px;\n    overflow-wrap: anywhere;\n}\n\n.rolling-skill-path code {\n    display: block;\n    margin-top: 10px;\n}\n\n.rolling-skill-error {\n    border-color: var(--dsw-alias-state-error-primary);\n    color: var(--dsw-alias-label-error);\n}\n\n@media (max-width: 640px) {\n    .rolling-skill-header {\n        align-items: stretch;\n        flex-direction: column;\n    }\n}\n";

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
  comingSoon: "\u6B64\u6A21\u5757\u5C06\u5728\u63A5\u4E0B\u6765\u7684\u63D2\u4EF6\u5316\u6B65\u9AA4\u4E2D\u63A5\u5165\u5171\u4EAB Core\u3002"
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
  comingSoon: "This module will connect to the shared Core in the next pluginization steps."
};
var DICTIONARIES = { zh, en };

// src/client/index.tsx
var import_jsx_runtime2 = require("react/jsx-runtime");
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
  const RollingSkillSection = () => /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(Workbench, { locale: ctx.locale, t });
  ctx.slots.inject("settings.section", () => ctx.slots.register({
    name: "settings.section",
    id: "rolling-skill",
    order: 20,
    label: () => t("nav"),
    locale: LOCALE_NAMESPACE
  }, RollingSkillSection));
}
return module.exports;}});
