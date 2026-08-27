window.__ModuleLoader__.load({id:'@rolling-skill/dsh-plugin',factory:(require)=>{var module={exports:{}};var exports=module.exports;
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __commonJS = (cb, mod) => function __require() {
  return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
};
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
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/client/conversation/curation-markers.cjs
var require_curation_markers = __commonJS({
  "src/client/conversation/curation-markers.cjs"(exports, module2) {
    function nodeFor(nodes, key) {
      if (nodes && typeof nodes.get === "function") return nodes.get(key);
      return nodes?.[key];
    }
    function projectMarkers2(snapshot, markers) {
      const projection = /* @__PURE__ */ new Map();
      const order2 = Array.isArray(snapshot?.chat?.order) ? snapshot.chat.order : [];
      const validMarkers = Array.isArray(markers) ? markers.filter(
        (marker) => Number.isSafeInteger(marker?.startSeq) && Number.isSafeInteger(marker?.endSeq) && marker.startSeq <= marker.endSeq && (marker.status === "draft" || marker.status === "saved")
      ) : [];
      for (const key of order2) {
        const node = nodeFor(snapshot?.chat?.nodes, key);
        if (!node || !Number.isSafeInteger(node.anchorSeq)) continue;
        let status = null;
        for (const marker of validMarkers) {
          if (node.anchorSeq < marker.startSeq || node.anchorSeq > marker.endSeq) continue;
          if (marker.status === "saved") {
            status = "saved";
            break;
          }
          status = status ?? "draft";
        }
        if (status) projection.set(key, status);
      }
      return projection;
    }
    module2.exports = { projectMarkers: projectMarkers2 };
  }
});

// src/client/index.tsx
var index_exports = {};
__export(index_exports, {
  apply: () => apply,
  inject: () => inject
});
module.exports = __toCommonJS(index_exports);

// src/client/workbench/workbench.css
var workbench_default = '.rolling-skill-workbench {\n    box-sizing: border-box;\n    color: var(--dsw-alias-label-primary);\n    display: grid;\n    gap: 20px;\n    min-width: 0;\n    padding: 4px 0 24px;\n}\n\n.rolling-skill-workbench-backdrop {\n    background: var(--dsw-alias-bg-mask-1);\n    display: flex;\n    inset: 0;\n    padding: 20px;\n    position: fixed;\n    z-index: 900;\n}\n\n.rolling-skill-workbench-overlay {\n    background: var(--dsw-alias-bg-base);\n    border: 1px solid var(--dsw-alias-border-l2);\n    border-radius: 14px;\n    color: var(--dsw-alias-label-primary);\n    margin: auto;\n    max-height: calc(100vh - 40px);\n    max-width: 1440px;\n    min-height: min(780px, calc(100vh - 40px));\n    overflow: auto;\n    padding: 24px;\n    position: relative;\n    width: 100%;\n}\n\n.rolling-skill-workbench-close {\n    position: absolute;\n    right: 12px;\n    top: 12px;\n    z-index: 1;\n}\n\n.rolling-skill-settings {\n    display: grid;\n    gap: 16px;\n    padding-bottom: 24px;\n}\n\n.rolling-skill-header {\n    align-items: flex-start;\n    display: flex;\n    gap: 16px;\n    justify-content: space-between;\n}\n\n.rolling-skill-header h2,\n.rolling-skill-panel h3 {\n    margin: 0;\n}\n\n.rolling-skill-header p,\n.rolling-skill-panel p {\n    color: var(--dsw-alias-label-secondary);\n    margin: 6px 0 0;\n}\n\n.rolling-skill-tabs {\n    align-items: center;\n    border-bottom: 1px solid var(--dsw-alias-border-l2);\n    display: flex;\n    flex-wrap: wrap;\n    gap: 4px;\n    padding-bottom: 10px;\n}\n\n.rolling-skill-counts {\n    display: grid;\n    gap: 10px;\n    grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));\n}\n\n.rolling-skill-count,\n.rolling-skill-panel,\n.rolling-skill-state {\n    background: var(--dsw-alias-bg-layer-2);\n    border: 1px solid var(--dsw-alias-border-l2);\n    border-radius: 10px;\n}\n\n.rolling-skill-count {\n    display: grid;\n    gap: 4px;\n    padding: 14px;\n}\n\n.rolling-skill-count strong {\n    font-size: 22px;\n    line-height: 28px;\n}\n\n.rolling-skill-count span,\n.rolling-skill-panel dt {\n    color: var(--dsw-alias-label-secondary);\n    font-size: 12px;\n}\n\n.rolling-skill-overview {\n    display: grid;\n    gap: 12px;\n}\n\n.rolling-skill-grid {\n    display: grid;\n    gap: 12px;\n    grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));\n}\n\n.rolling-skill-panel,\n.rolling-skill-state {\n    min-width: 0;\n    padding: 16px;\n}\n\n.rolling-skill-panel dl {\n    display: grid;\n    gap: 10px;\n    margin: 14px 0 0;\n}\n\n.rolling-skill-panel dl > div {\n    align-items: baseline;\n    display: flex;\n    gap: 12px;\n    justify-content: space-between;\n}\n\n.rolling-skill-panel dd {\n    margin: 0;\n    max-width: 68%;\n    overflow-wrap: anywhere;\n    text-align: right;\n}\n\n.rolling-skill-runtime,\n.rolling-skill-state {\n    display: grid;\n    gap: 8px;\n}\n\n.rolling-skill-runtime {\n    margin-top: 14px;\n}\n\n.rolling-skill-runtime code,\n.rolling-skill-path code {\n    color: var(--dsw-alias-label-secondary);\n    font-family: ui-monospace, monospace;\n    font-size: 12px;\n    overflow-wrap: anywhere;\n}\n\n.rolling-skill-path code {\n    display: block;\n    margin-top: 10px;\n}\n\n.rolling-skill-error {\n    border-color: var(--dsw-alias-state-error-primary);\n    color: var(--dsw-alias-label-error);\n}\n\n.rolling-skill-data-stack,\n.rolling-skill-form-stack,\n.rolling-skill-list {\n    display: grid;\n    gap: 12px;\n}\n\n.rolling-skill-panel-header,\n.rolling-skill-list-row,\n.rolling-skill-case-row,\n.rolling-skill-form-row,\n.rolling-skill-actions {\n    align-items: center;\n    display: flex;\n    gap: 10px;\n}\n\n.rolling-skill-panel-header,\n.rolling-skill-list-row,\n.rolling-skill-case-row {\n    justify-content: space-between;\n}\n\n.rolling-skill-form-row,\n.rolling-skill-list {\n    margin-top: 14px;\n}\n\n.rolling-skill-form-row > :first-child {\n    flex: 1;\n}\n\n.rolling-skill-list-row,\n.rolling-skill-case-row {\n    background: var(--dsw-alias-bg-layer-1);\n    border: 1px solid var(--dsw-alias-border-l3);\n    border-radius: 8px;\n    min-width: 0;\n    padding: 12px;\n}\n\n.rolling-skill-list-row > div:first-child,\n.rolling-skill-case-copy {\n    display: grid;\n    gap: 5px;\n    min-width: 0;\n}\n\n.rolling-skill-list-row span,\n.rolling-skill-case-copy p {\n    color: var(--dsw-alias-label-secondary);\n    font-size: 12px;\n    overflow-wrap: anywhere;\n}\n\n.rolling-skill-pagination {\n    align-items: center;\n    color: var(--dsw-alias-label-secondary);\n    display: flex;\n    gap: 10px;\n    justify-content: center;\n    margin-top: 14px;\n}\n\n.rolling-skill-group-list,\n.rolling-skill-raw-group,\n.rolling-skill-detail-stack {\n    display: grid;\n    gap: 12px;\n}\n\n.rolling-skill-group-list {\n    margin-top: 14px;\n}\n\n.rolling-skill-raw-group h4 {\n    align-items: center;\n    display: flex;\n    gap: 8px;\n    margin: 0;\n}\n\n.rolling-skill-raw-group h4 span {\n    color: var(--dsw-alias-label-secondary);\n    font-size: 12px;\n}\n\n.rolling-skill-verbatim {\n    overflow-wrap: anywhere;\n    white-space: pre-wrap;\n}\n\n.rolling-skill-detail-stack h4,\n.rolling-skill-detail-stack p {\n    margin: 0;\n}\n\n.rolling-skill-detail-stack pre {\n    background: var(--dsw-alias-bg-layer-1);\n    border: 1px solid var(--dsw-alias-border-l3);\n    border-radius: 8px;\n    max-height: 320px;\n    overflow: auto;\n    padding: 10px;\n    white-space: pre-wrap;\n}\n\n.rolling-skill-case-copy p {\n    margin: 0;\n    white-space: pre-wrap;\n}\n\n.rolling-skill-select,\n.rolling-skill-form-stack input,\n.rolling-skill-field input,\n.rolling-skill-form-stack textarea {\n    background: var(--dsw-alias-bg-layer-1);\n    border: 1px solid var(--dsw-alias-border-l2);\n    border-radius: 7px;\n    color: var(--dsw-alias-label-primary);\n    font: inherit;\n    padding: 8px 10px;\n}\n\n.rolling-skill-review-layout {\n    display: grid;\n    gap: 14px;\n    grid-template-columns: minmax(260px, 360px) minmax(0, 1fr);\n    min-height: 560px;\n}\n\n.rolling-skill-review-list,\n.rolling-skill-review-detail,\n.rolling-skill-session-view {\n    min-width: 0;\n}\n\n.rolling-skill-review-list-button {\n    background: var(--dsw-alias-bg-layer-1);\n    border: 1px solid var(--dsw-alias-border-l3);\n    border-radius: 8px;\n    color: var(--dsw-alias-label-primary);\n    cursor: pointer;\n    display: grid;\n    font: inherit;\n    gap: 5px;\n    padding: 10px;\n    text-align: left;\n    width: 100%;\n}\n\n.rolling-skill-review-list-button[data-selected="true"] {\n    border-color: var(--dsw-alias-state-business-primary);\n}\n\n.rolling-skill-review-list-button span {\n    color: var(--dsw-alias-label-secondary);\n    font-size: 12px;\n}\n\n.rolling-skill-session-view,\n.rolling-skill-evidence-card,\n.rolling-skill-conversation-log,\n.rolling-skill-rubric-draft {\n    display: grid;\n    gap: 12px;\n}\n\n.rolling-skill-session-view h4,\n.rolling-skill-review-list h4 {\n    margin: 8px 0 0;\n}\n\n.rolling-skill-session-view pre,\n.rolling-skill-evidence-card pre {\n    background: var(--dsw-alias-bg-layer-1);\n    border: 1px solid var(--dsw-alias-border-l3);\n    border-radius: 8px;\n    max-height: 340px;\n    overflow: auto;\n    padding: 12px;\n    white-space: pre-wrap;\n}\n\n.rolling-skill-conversation-log > div,\n.rolling-skill-rubric-draft article {\n    background: var(--dsw-alias-bg-layer-1);\n    border: 1px solid var(--dsw-alias-border-l3);\n    border-radius: 8px;\n    padding: 10px;\n}\n\n.rolling-skill-conversation-log p,\n.rolling-skill-rubric-draft p {\n    margin: 6px 0 0;\n    white-space: pre-wrap;\n}\n\n.rolling-skill-create-rubric {\n    border-bottom: 1px solid var(--dsw-alias-border-l2);\n    padding-bottom: 14px;\n}\n\n.rolling-skill-select {\n    margin-top: 14px;\n    max-width: 360px;\n    width: 100%;\n}\n\n.rolling-skill-form-stack label {\n    display: grid;\n    gap: 6px;\n}\n\n.rolling-skill-form-stack textarea {\n    min-height: 120px;\n    resize: vertical;\n}\n\n.rolling-skill-check {\n    align-items: center;\n    display: flex;\n    gap: 8px;\n    margin-top: 12px;\n}\n\n.rolling-skill-badge {\n    color: var(--dsw-alias-state-business-primary);\n    font-size: 11px;\n    font-weight: 600;\n}\n\n.rolling-skill-inline-error {\n    color: var(--dsw-alias-label-error) !important;\n}\n\n.rolling-skill-dialog-backdrop {\n    align-items: center;\n    background: var(--dsw-alias-bg-mask-1);\n    display: flex;\n    inset: 0;\n    justify-content: center;\n    padding: 20px;\n    position: fixed;\n    z-index: 1000;\n}\n\n.rolling-skill-dialog {\n    background: var(--dsw-alias-bg-layer-2);\n    border: 1px solid var(--dsw-alias-border-l2);\n    border-radius: 12px;\n    color: var(--dsw-alias-label-primary);\n    display: grid;\n    gap: 18px;\n    max-height: min(760px, calc(100vh - 40px));\n    max-width: 620px;\n    min-width: 0;\n    overflow: auto;\n    padding: 20px;\n    width: 100%;\n}\n\n.rolling-skill-dialog-header {\n    align-items: flex-start;\n    display: flex;\n    gap: 16px;\n    justify-content: space-between;\n}\n\n.rolling-skill-dialog-header h2,\n.rolling-skill-dialog-header p {\n    margin: 0;\n}\n\n.rolling-skill-dialog-header p {\n    color: var(--dsw-alias-label-secondary);\n    margin-top: 6px;\n}\n\n.rolling-skill-dialog .rolling-skill-select {\n    margin-top: 0;\n    max-width: none;\n}\n\n.rolling-skill-label-fieldset {\n    border: 0;\n    display: flex;\n    gap: 16px;\n    margin: 0;\n    padding: 0;\n}\n\n.rolling-skill-label-fieldset legend {\n    color: var(--dsw-alias-label-secondary);\n    font-size: 12px;\n    font-weight: 600;\n    margin-bottom: 8px;\n}\n\n.rolling-skill-label-fieldset label {\n    align-items: center;\n    display: flex;\n    gap: 6px;\n}\n\n.rolling-skill-blockers {\n    background: var(--dsw-alias-bg-layer-1);\n    border: 1px solid var(--dsw-alias-state-warning-primary);\n    border-radius: 8px;\n    color: var(--dsw-alias-label-primary);\n    padding: 12px;\n}\n\n.rolling-skill-blockers ul {\n    margin: 8px 0 0;\n    padding-left: 20px;\n}\n\n.rolling-skill-dialog-actions {\n    justify-content: flex-end;\n}\n\n@media (max-width: 640px) {\n    .rolling-skill-workbench-backdrop {\n        padding: 0;\n    }\n\n    .rolling-skill-workbench-overlay {\n        border-radius: 0;\n        max-height: 100vh;\n        min-height: 100vh;\n        padding: 16px;\n    }\n\n    .rolling-skill-review-layout {\n        grid-template-columns: 1fr;\n    }\n\n    .rolling-skill-dialog-backdrop {\n        align-items: flex-end;\n        padding: 0;\n    }\n\n    .rolling-skill-dialog {\n        border-radius: 12px 12px 0 0;\n        max-height: 90vh;\n    }\n}\n\n[data-chat-flow-key].rolling-skill-curation-draft {\n    background: var(--dsw-alias-state-warn-tertiary);\n    box-shadow: inset 3px 0 var(--dsw-alias-state-warn-primary);\n}\n\n[data-chat-flow-key].rolling-skill-curation-saved {\n    background: var(--dsw-alias-state-success-tertiary);\n    box-shadow: inset 3px 0 var(--dsw-alias-state-success-primary);\n}\n\n.rolling-skill-marker-legend {\n    align-items: center;\n    display: flex;\n    flex-wrap: wrap;\n    gap: 6px;\n}\n\n.rolling-skill-marker-chip,\n.rolling-skill-marker-compatibility {\n    border: 1px solid var(--dsw-alias-border-l2);\n    border-radius: 999px;\n    color: var(--dsw-alias-label-secondary);\n    font-size: 11px;\n    padding: 3px 7px;\n}\n\n.rolling-skill-marker-chip-draft {\n    border-color: var(--dsw-alias-state-warn-primary);\n}\n\n.rolling-skill-marker-chip-saved {\n    border-color: var(--dsw-alias-state-success-primary);\n}\n\n.rolling-skill-runtime-select {\n    border: 0;\n    display: grid;\n    gap: 8px;\n    margin: 16px 0;\n    min-width: 0;\n    padding: 0;\n}\n\n.rolling-skill-runtime-select legend,\n.rolling-skill-field > span {\n    color: var(--dsw-alias-label-secondary);\n    font-size: 12px;\n    font-weight: 600;\n}\n\n.rolling-skill-runtime-list {\n    display: grid;\n    gap: 8px;\n    grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));\n}\n\n.rolling-skill-runtime-option {\n    align-items: flex-start;\n    background: var(--dsw-alias-bg-layer-1);\n    border: 1px solid var(--dsw-alias-border-l2);\n    border-radius: 8px;\n    display: flex;\n    gap: 9px;\n    min-width: 0;\n    padding: 10px;\n}\n\n.rolling-skill-runtime-option:has(input:checked) {\n    border-color: var(--dsw-alias-state-business-primary);\n}\n\n.rolling-skill-runtime-option > span,\n.rolling-skill-field {\n    display: grid;\n    gap: 5px;\n    min-width: 0;\n}\n\n.rolling-skill-runtime-option code {\n    color: var(--dsw-alias-label-secondary);\n    font-family: ui-monospace, monospace;\n    font-size: 11px;\n    overflow-wrap: anywhere;\n}\n\n.rolling-skill-link-button {\n    background: transparent;\n    border: 0;\n    color: var(--dsw-alias-state-business-primary);\n    cursor: pointer;\n    padding: 0;\n    text-align: left;\n}\n\n.rolling-skill-field .rolling-skill-select {\n    margin-top: 0;\n}\n\n.rolling-skill-skill-row {\n    background: var(--dsw-alias-bg-layer-1);\n    border: 1px solid var(--dsw-alias-border-l3);\n    border-radius: 8px;\n    color: var(--dsw-alias-label-primary);\n    cursor: pointer;\n    display: grid;\n    gap: 4px;\n    padding: 11px;\n    text-align: left;\n}\n\n.rolling-skill-skill-row span {\n    color: var(--dsw-alias-label-secondary);\n    font-size: 12px;\n}\n\n.rolling-skill-manifest {\n    background: var(--dsw-alias-bg-layer-1);\n    border: 1px solid var(--dsw-alias-border-l3);\n    border-radius: 8px;\n    color: var(--dsw-alias-label-secondary);\n    max-height: 240px;\n    overflow: auto;\n    padding: 12px;\n    white-space: pre-wrap;\n}\n\n.rolling-skill-subpanel {\n    display: grid;\n    gap: 9px;\n}\n\n.rolling-skill-subpanel h4 {\n    margin: 0;\n}\n\n.rolling-skill-section-gap {\n    margin-top: 14px;\n}\n\n.rolling-skill-list-row small {\n    color: var(--dsw-alias-label-secondary);\n    overflow-wrap: anywhere;\n}\n\n@media (max-width: 760px) {\n    .rolling-skill-panel-header,\n    .rolling-skill-list-row,\n    .rolling-skill-case-row,\n    .rolling-skill-form-row {\n        align-items: stretch;\n        flex-direction: column;\n    }\n}\n\n@media (max-width: 640px) {\n    .rolling-skill-header {\n        align-items: stretch;\n        flex-direction: column;\n    }\n}\n';

// src/client/locale.ts
var LOCALE_NAMESPACE = "rolling-skill";
var zh = {
  nav: "Rolling Skill",
  title: "Rolling Skill \u5DE5\u4F5C\u53F0",
  subtitle: "\u6301\u7EED\u6C89\u6DC0\u3001\u66F4\u65B0\u5E76\u8BC4\u6D4B\u771F\u5B9E Case",
  openWorkbench: "\u6253\u5F00 Rolling Skill \u5DE5\u4F5C\u53F0",
  refresh: "\u5237\u65B0",
  loading: "\u6B63\u5728\u8BFB\u53D6 Rolling Skill \u6570\u636E\u2026",
  loadError: "\u65E0\u6CD5\u8BFB\u53D6 Rolling Skill \u6570\u636E",
  retry: "\u91CD\u8BD5",
  captureAction: "\u6C89\u6DC0 Case",
  captureChecking: "\u68C0\u67E5\u4E2D\u2026",
  captureDraft: "Case \u8349\u7A3F",
  captureSaved: "\u5DF2\u6C89\u6DC0 Case",
  captureTitle: "\u4ECE\u5F53\u524D\u5BF9\u8BDD\u6C89\u6DC0 Case",
  captureDescription: "\u9009\u62E9\u95EE\u9898\u8D77\u70B9\u548C\u53D7\u7BA1\u6570\u636E\u96C6\u3002\u5BF9\u8BDD\u8BC1\u636E\u3001Skill \u7248\u672C\u4E0E\u5B89\u88C5\u4FE1\u606F\u7531 Harness \u6821\u9A8C\u5E76\u51BB\u7ED3\u3002",
  captureLoading: "\u6B63\u5728\u6821\u9A8C\u5BF9\u8BDD\u8FB9\u754C\u548C\u6570\u636E\u96C6\u2026",
  captureLoadError: "\u65E0\u6CD5\u8BFB\u53D6\u5F53\u524D\u5BF9\u8BDD\u7684\u6C89\u6DC0\u6761\u4EF6",
  captureStart: "\u95EE\u9898\u8D77\u70B9",
  captureDataset: "\u76EE\u6807\u6570\u636E\u96C6",
  captureBlocked: "\u6682\u4E0D\u53EF\u6C89\u6DC0",
  captureLabel: "Case \u7C7B\u578B",
  captureGood: "Good",
  captureBad: "Bad",
  captureCreate: "\u751F\u6210 Draft",
  captureCreating: "\u6B63\u5728\u751F\u6210\u2026",
  captureCreateError: "\u751F\u6210 Case Draft \u5931\u8D25",
  captureDraftCreated: "Case Draft \u5DF2\u521B\u5EFA",
  captureDraftDescription: "\u6E90\u5BF9\u8BDD\u8303\u56F4\u5DF2\u51BB\u7ED3\uFF0C\u53EF\u4EE5\u5728 Rolling Skill \u5DE5\u4F5C\u53F0\u7EE7\u7EED\u8C03\u6574\u5E76\u4FDD\u5B58\u3002",
  captureViewDraft: "\u67E5\u770B Draft",
  markerLegend: "\u5BF9\u8BDD\u6C89\u6DC0\u72B6\u6001",
  markerDraftLegend: "Draft \u8303\u56F4",
  markerSavedLegend: "\u5DF2\u6C89\u6DC0\u8303\u56F4",
  markerCompatibility: "\u90E8\u5206\u65E7\u6D88\u606F\u7F3A\u5C11\u7A33\u5B9A\u6E32\u67D3\u6807\u8BC6\uFF0C\u72B6\u6001\u5DF2\u4FDD\u7559\u4F46\u6CA1\u6709\u731C\u6D4B\u7740\u8272\u3002",
  markerCompatibilityShort: "\u90E8\u5206\u8303\u56F4\u672A\u7740\u8272",
  overview: "\u6982\u89C8",
  cases: "Case \u4E0E\u6570\u636E\u96C6",
  skills: "Skill \u7BA1\u7406",
  evaluations: "Skill \u8BC4\u6D4B",
  automatic: "\u81EA\u52A8\u6C89\u6DC0",
  automaticTitle: "\u81EA\u52A8\u6C89\u6DC0",
  automaticDescription: "\u5B9A\u65F6\u68C0\u67E5\u65B0\u5BF9\u8BDD\uFF0C\u8BC6\u522B\u5B8C\u6574\u95EE\u9898\uFF0C\u5E76\u6309\u6A21\u5F0F\u751F\u6210 Raw Case \u6216\u81EA\u52A8\u4FDD\u5B58 Case\u3002",
  automaticMode: "\u6C89\u6DC0\u6A21\u5F0F",
  automaticOff: "\u5173\u95ED",
  automaticScheduled: "\u5B9A\u65F6\u63D0\u53D6",
  automaticFull: "\u5B8C\u5168\u81EA\u52A8",
  executionLocation: "\u8FD0\u884C\u4F4D\u7F6E",
  whileHarnessRunning: "\u4EC5\u5728 Harness \u8FD0\u884C\u65F6",
  alwaysRunning: "Harness \u5173\u95ED\u540E\u4ECD\u8FD0\u884C",
  cadence: "\u6267\u884C\u5468\u671F",
  daily: "\u6BCF\u5929",
  weekly: "\u6BCF\u5468",
  captureTime: "\u6267\u884C\u65F6\u95F4",
  weekday: "\u661F\u671F",
  weekday0: "\u661F\u671F\u65E5",
  weekday1: "\u661F\u671F\u4E00",
  weekday2: "\u661F\u671F\u4E8C",
  weekday3: "\u661F\u671F\u4E09",
  weekday4: "\u661F\u671F\u56DB",
  weekday5: "\u661F\u671F\u4E94",
  weekday6: "\u661F\u671F\u516D",
  automaticRuntime: "\u81EA\u52A8\u6C89\u6DC0 Runtime",
  automaticDataset: "\u76EE\u6807\u6570\u636E\u96C6",
  automaticDatasetMatch: "\u7531 Skill \u81EA\u52A8\u5339\u914D",
  scheduledBehavior: "\u53EA\u63D0\u53D6\u5019\u9009\u95EE\u9898\u5E76\u4FDD\u5B58\u4E3A\u5F85\u5BA1\u6838 Raw Case\uFF0C\u4E0D\u4F1A\u81EA\u52A8\u5199\u5165\u6570\u636E\u96C6\u3002",
  automaticBehavior: "\u5019\u9009\u901A\u8FC7\u7F6E\u4FE1\u5EA6\u3001Skill\u3001\u6570\u636E\u96C6\u3001Rubric \u548C Draft \u95F8\u95E8\u540E\u81EA\u52A8\u4FDD\u5B58\u4E3A Case\u3002",
  offBehavior: "\u5173\u95ED\u540E\u4E0D\u4F1A\u626B\u63CF\u65B0\u5BF9\u8BDD\u6216\u521B\u5EFA\u5019\u9009\u3002",
  saveAutomatic: "\u4FDD\u5B58\u81EA\u52A8\u6C89\u6DC0\u8BBE\u7F6E",
  runOnce: "\u7ACB\u5373\u8FD0\u884C\u4E00\u6B21",
  pendingRawCases: "\u5F85\u5BA1\u6838 Raw Case",
  schedulerStatus: "\u8C03\u5EA6\u72B6\u6001",
  installed: "\u7CFB\u7EDF\u8C03\u5EA6\u5668\u5DF2\u5B89\u88C5",
  notInstalled: "\u7CFB\u7EDF\u8C03\u5EA6\u5668\u672A\u5B89\u88C5",
  harnessTimer: "\u7531 Harness \u5185\u7F6E\u5B9A\u65F6\u5668\u8FD0\u884C",
  enableScheduler: "\u5B89\u88C5\u7CFB\u7EDF\u8C03\u5EA6\u5668",
  disableScheduler: "\u79FB\u9664\u7CFB\u7EDF\u8C03\u5EA6\u5668",
  operator: "\u81EA\u64CD\u4F5C\u4E0E\u4F18\u5316",
  settings: "\u63D2\u4EF6\u8BBE\u7F6E",
  settingsDescription: "\u7BA1\u7406\u9ED8\u8BA4 Runtime\u3001\u6570\u636E\u76EE\u5F55\u3001\u65E7\u7248\u5BFC\u5165\u548C\u8BCA\u65AD\u3002\u4E1A\u52A1\u64CD\u4F5C\u8BF7\u4ECE\u4FA7\u8FB9\u680F\u6253\u5F00\u5DE5\u4F5C\u53F0\u3002",
  agentDefaults: "Agent \u9ED8\u8BA4\u914D\u7F6E",
  defaultRuntime: "\u9ED8\u8BA4 Runtime",
  curatorDefault: "Curator",
  rubricDefault: "Rubric Agent",
  judgeDefault: "Judge",
  runtimeDefault: "\u8DDF\u968F Runtime \u9ED8\u8BA4\u503C",
  saveDefaults: "\u4FDD\u5B58\u9ED8\u8BA4\u914D\u7F6E",
  diagnostics: "\u8BCA\u65AD",
  curation: "Draft \u5BA1\u6838",
  datasets: "\u6570\u636E\u96C6",
  rawCases: "Raw Case",
  rubrics: "\u8BC4\u5206\u6807\u51C6",
  installations: "\u5B89\u88C5\u4EFB\u52A1",
  curationDescription: "\u5BA1\u6838 Agent \u751F\u6210\u7684\u7ED3\u6784\u5316 Case Draft\uFF0C\u5E76\u7EE7\u7EED\u5BF9\u8BDD\u4FEE\u8BA2\u3002",
  activeDrafts: "\u8FDB\u884C\u4E2D",
  archivedDrafts: "\u5DF2\u4FDD\u5B58",
  emptyDrafts: "\u6682\u65E0 Draft",
  selectDraft: "\u9009\u62E9\u4E00\u4E2A Draft \u67E5\u770B\u8BE6\u60C5",
  frozenEvidence: "\u51BB\u7ED3\u8BC1\u636E",
  sourceRange: "\u6765\u6E90\u533A\u95F4",
  curatorConversation: "Curator \u5BF9\u8BDD",
  latestDraft: "\u6700\u65B0\u6709\u6548 Draft",
  noValidDraft: "\u5C1A\u672A\u751F\u6210\u6709\u6548 Draft",
  reviewMessage: "\u4FEE\u8BA2\u8981\u6C42",
  sendRevision: "\u53D1\u9001\u4FEE\u8BA2",
  saveCase: "\u4FDD\u5B58\u4E3A Case",
  discardDraft: "\u4E22\u5F03 Draft",
  discardDraftConfirm: "\u786E\u8BA4\u4E22\u5F03\u8FD9\u4E2A Draft\uFF1F\u4E0D\u4F1A\u4FDD\u5B58 Case\u3002",
  rubricDescription: "\u4E3A\u6570\u636E\u96C6\u751F\u6210\u3001\u4FEE\u8BA2\u5E76\u53D1\u5E03\u7EDF\u4E00 100 \u5206\u8BC4\u5206\u6807\u51C6\u3002",
  createRubric: "\u751F\u6210\u8BC4\u5206\u6807\u51C6",
  rubricSessions: "\u751F\u6210\u4E0E\u4FEE\u8BA2\u4EFB\u52A1",
  rubricHistory: "\u5DF2\u53D1\u5E03\u7248\u672C",
  activeRubric: "\u5F53\u524D\u8BC4\u5206\u6807\u51C6",
  noActiveRubric: "\u5C1A\u672A\u53D1\u5E03\u8BC4\u5206\u6807\u51C6",
  selectRubricSession: "\u9009\u62E9\u4E00\u4E2A\u8BC4\u5206\u6807\u51C6\u4EFB\u52A1\u67E5\u770B\u8BE6\u60C5",
  rubricReview: "\u8BC4\u5206\u6807\u51C6\u5BA1\u6838",
  rubricAgentConversation: "Rubric Agent \u5BF9\u8BDD",
  latestRubricDraft: "\u6700\u65B0\u8BC4\u5206\u6807\u51C6 Draft",
  publishRubric: "\u53D1\u5E03\u8BC4\u5206\u6807\u51C6",
  discardRubricConfirm: "\u786E\u8BA4\u4E22\u5F03\u8FD9\u4E2A\u8BC4\u5206\u6807\u51C6 Draft\uFF1F",
  legacyImportTitle: "\u5BFC\u5165\u65E7\u7248 Electron \u6570\u636E",
  legacyImportDescription: "\u5C06\u5F52\u6863\u7248 Rolling Skill \u7684 Case\u3001Raw Case\u3001Managed Skill\u3001\u8FD0\u884C\u8BB0\u5F55\u548C Trace \u8FC1\u79FB\u5230 DSH\u3002",
  legacySource: "\u65E7\u7248\u6570\u636E\u76EE\u5F55",
  legacyDestination: "DSH \u6570\u636E\u76EE\u5F55",
  legacyCopyOnly: "\u5BFC\u5165\u53EA\u4F1A\u590D\u5236\u5E76\u6821\u9A8C\u6570\u636E\uFF0C\u4E0D\u4F1A\u4FEE\u6539\u6216\u5220\u9664\u65E7\u7248\u76EE\u5F55\u3002\u6210\u529F\u540E\u9700\u8981\u91CD\u542F Harness\u3002",
  legacyImportedRestart: "\u65E7\u7248\u6570\u636E\u5DF2\u5BFC\u5165\u3002\u8BF7\u91CD\u542F Harness \u4EE5\u52A0\u8F7D\u65B0\u6570\u636E\u3002",
  legacyNotFound: "\u672A\u68C0\u6D4B\u5230\u65E7\u7248 Rolling Skill \u6570\u636E\u3002",
  legacyBlocked: "\u5F53\u524D\u6570\u636E\u76EE\u5F55\u65E0\u6CD5\u5B89\u5168\u5BFC\u5165\u65E7\u7248\u6570\u636E\u3002",
  legacyConfirmPrompt: "\u786E\u8BA4\u590D\u5236\u65E7\u7248\u6570\u636E\u5230\u5F53\u524D DSH \u6570\u636E\u76EE\u5F55\uFF1F\u65E7\u7248\u6570\u636E\u4F1A\u539F\u6837\u4FDD\u7559\u3002",
  startImport: "\u5BFC\u5165\u65E7\u7248\u6570\u636E",
  confirmImport: "\u786E\u8BA4\u5BFC\u5165",
  datasetsCount: "\u6570\u636E\u96C6",
  casesCount: "Case",
  rawCasesCount: "Raw Case",
  evaluationsCount: "\u8BC4\u6D4B\u8FD0\u884C",
  managedSkillsCount: "Managed Skill",
  operatorSessionsCount: "Operator \u4F1A\u8BDD",
  optimizationsCount: "\u4F18\u5316\u8FD0\u884C",
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
  datasetSkill: "\u53D7\u7BA1 Skill",
  unboundManagedSkill: "\u5C1A\u672A\u7ED1\u5B9A\u53D7\u7BA1 Skill",
  noManagedSkills: "\u8BF7\u5148\u5BFC\u5165\u4E00\u4E2A\u6709\u6548\u7684\u53D7\u7BA1 Skill",
  changeManagedSkill: "\u66F4\u6362 Skill",
  bindManagedSkillTitle: "\u7ED1\u5B9A\u53D7\u7BA1 Skill",
  bindManagedSkillDescription: "\u6570\u636E\u96C6\u53EA\u4FDD\u5B58\u53D7\u7BA1 Skill \u8EAB\u4EFD\uFF1BRuntime\u3001\u7248\u672C\u548C\u5B89\u88C5\u4F1A\u5728\u6BCF\u6B21\u64CD\u4F5C\u65F6\u5355\u72EC\u51BB\u7ED3\u3002\u66F4\u6362 Skill \u4F1A\u6E05\u9664\u5F53\u524D\u8BC4\u5206\u6807\u51C6\u3002",
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
  caseFilter: "Case \u7C7B\u578B\u7B5B\u9009",
  allCases: "\u5168\u90E8 Case",
  casePages: "Case \u5206\u9875",
  previousPage: "\u4E0A\u4E00\u9875",
  nextPage: "\u4E0B\u4E00\u9875",
  pageStatus: "\u7B2C {page}/{pages} \u9875 \xB7 \u5171 {total} \u6761",
  caseDetailTitle: "Case \u8BE6\u60C5",
  caseAnswer: "\u7B54\u6848",
  caseIssue: "\u95EE\u9898\u8BF4\u660E",
  caseEvidence: "\u6765\u6E90\u4E0E\u8BC4\u5206\u8BC1\u636E",
  goodcase: "Good Case",
  badcase: "Bad Case",
  emptyCases: "\u6B64\u6570\u636E\u96C6\u6682\u65E0 Case",
  caseNeedsCalibration: "\u9700\u6309\u5F53\u524D\u8BC4\u5206\u6807\u51C6\u6821\u51C6",
  calibrateCase: "\u6821\u51C6 Case",
  calibrateAllCases: "\u5168\u90E8\u81EA\u52A8\u6821\u51C6",
  stopCalibrationBatch: "\u505C\u6B62\u6279\u91CF\u6821\u51C6",
  calibrationBatchProgress: "\u81EA\u52A8\u6821\u51C6 \xB7 \u5DF2\u4FDD\u5B58 {completed}/{total}",
  reviewCalibration: "\u5BA1\u9605\u5F53\u524D\u6821\u51C6",
  rawCasesTitle: "Raw Case",
  rawCasesDescription: "\u7F16\u8F91\u5F85\u6C89\u6DC0\u7684\u95EE\u9898\uFF0C\u6216\u79FB\u9664\u4E0D\u518D\u9700\u8981\u7684\u6761\u76EE\u3002",
  addRawCase: "\u65B0\u589E Raw Case",
  addRawCaseTitle: "\u624B\u5DE5\u65B0\u589E Raw Case",
  searchRawCases: "\u641C\u7D22\u95EE\u9898\u3001\u5907\u6CE8\u6216 Skill",
  manualSource: "\u624B\u5DE5\u6765\u6E90",
  rawCaseEvidence: "Raw Case \u6765\u6E90\u8BC1\u636E",
  createCaseDraft: "\u751F\u6210 Case Draft",
  rawCaseDraftDescription: "\u53EA\u663E\u793A\u4E0E Raw Case \u7684\u53D7\u7BA1 Skill \u4E00\u81F4\u3001\u4E14\u5DF2\u53D1\u5E03\u8BC4\u5206\u6807\u51C6\u7684\u6570\u636E\u96C6\u3002Runtime\u3001\u7248\u672C\u4E0E\u5B89\u88C5\u7531\u540E\u7AEF\u6821\u9A8C\u5E76\u51BB\u7ED3\u3002",
  validateInNewSession: "\u5728\u65B0\u4F1A\u8BDD\u9A8C\u8BC1",
  validateInCurrentSession: "\u5728\u5F53\u524D\u4F1A\u8BDD\u9A8C\u8BC1",
  rawCaseDispatched: "\u5DF2\u6D3E\u53D1\u5230 DSH \u539F\u751F\u4F1A\u8BDD\uFF0C\u8BF7\u5728\u4FA7\u680F\u6253\u5F00\uFF1A",
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
  evaluationCaseScope: "Case \u8303\u56F4",
  activationMode: "Skill \u6FC0\u6D3B\u65B9\u5F0F",
  explicitActivation: "\u663E\u5F0F\u6FC0\u6D3B",
  automaticActivation: "\u81EA\u52A8\u6FC0\u6D3B",
  primaryRuntime: "\u4E3B\u8981\u914D\u7F6E Runtime",
  makePrimaryRuntime: "\u8BBE\u4E3A\u4E3B\u8981\u914D\u7F6E",
  evaluationVersion: "\u8BC4\u6D4B\u7248\u672C",
  installationReady: "\u6240\u9009\u7248\u672C\u5DF2\u5B89\u88C5\u5230\u76EE\u6807 Runtime",
  installationMissing: "\u6240\u9009\u7248\u672C\u5C1A\u672A\u5B89\u88C5\u5230\u76EE\u6807 Runtime\uFF0C\u8BF7\u5148\u524D\u5F80 Skill \u7BA1\u7406\u5B89\u88C5\u3002",
  judgeRuntime: "Judge Runtime",
  model: "\u6A21\u578B",
  judgeModel: "Judge \u6A21\u578B",
  effort: "\u63A8\u7406\u5F3A\u5EA6",
  startEvaluation: "\u5F00\u59CB\u8BC4\u6D4B",
  evaluationRuns: "\u8BC4\u6D4B\u8BB0\u5F55",
  details: "\u8BE6\u60C5",
  cancelRun: "\u53D6\u6D88\u8FD0\u884C",
  emptyEvaluations: "\u6682\u65E0\u8BC4\u6D4B\u8BB0\u5F55",
  deleteEvaluationConfirm: "\u786E\u8BA4\u5220\u9664\u8FD9\u6761\u5DF2\u7ED3\u675F\u7684\u8BC4\u6D4B\u8BB0\u5F55\uFF1F",
  evaluationDetail: "\u8BC4\u6D4B\u8BE6\u60C5",
  close: "\u5173\u95ED",
  skillRepositories: "Managed Skill",
  skillRepositoriesDescription: "\u5BFC\u5165\u3001\u53D1\u5E03\u5E76\u5B89\u88C5\u4E0D\u53EF\u53D8 Skill \u7248\u672C\u3002",
  rescan: "\u91CD\u65B0\u626B\u63CF",
  skillSourceLocation: "\u7EDD\u5BF9\u8DEF\u5F84\u6216 Git URL",
  importSkill: "\u5BFC\u5165",
  revealRepository: "\u5728\u8BBF\u8FBE\u4E2D\u663E\u793A",
  emptySkills: "\u6682\u65E0 Managed Skill",
  candidateVersion: "Candidate",
  createCandidate: "\u521B\u5EFA Candidate",
  releaseVersion: "Release",
  release: "\u53D1\u5E03",
  installationRuntime: "\u5B89\u88C5\u76EE\u6807 Runtime",
  installReleased: "\u5B89\u88C5\u5DF2\u53D1\u5E03\u7248\u672C",
  installationJobs: "\u5B89\u88C5 Job",
  inspect: "\u68C0\u67E5",
  deprecateVersion: "\u5E9F\u5F03\u7248\u672C",
  deprecatedVersion: "\u5DF2\u5E9F\u5F03",
  installationDetail: "\u5B89\u88C5\u4EFB\u52A1\u8BE6\u60C5",
  installationVerification: "\u5B89\u88C5\u6821\u9A8C",
  installerConversation: "Installer \u5BF9\u8BDD",
  installerActivity: "\u5B89\u88C5\u6D3B\u52A8",
  installerFollowUp: "\u7EE7\u7EED\u8FFD\u95EE\u6216\u8981\u6C42\u4FEE\u590D",
  runtimeInteractions: "Runtime \u7B49\u5F85\u7528\u6237\u5904\u7406",
  runtimePermissionRequest: "\u6743\u9650\u8BF7\u6C42",
  runtimeQuestionRequest: "Runtime \u63D0\u95EE",
  submitAnswers: "\u63D0\u4EA4\u56DE\u7B54",
  operatorTitle: "\u81EA\u64CD\u4F5C",
  operatorDescription: "\u8BA9\u9009\u5B9A Runtime Agent \u5728\u53D7\u9650\u80FD\u529B\u548C\u9884\u7B97\u5185\u64CD\u4F5C Rolling Skill\u3002",
  operatorRuntime: "\u81EA\u64CD\u4F5C Runtime",
  operatorObjective: "\u76EE\u6807",
  operatorObjectivePlaceholder: "\u4F8B\u5982\uFF1A\u68C0\u67E5\u5E76\u66F4\u65B0\u5931\u6548\u7684 Good Case",
  startOperator: "\u5F00\u59CB\u81EA\u64CD\u4F5C",
  emptyOperators: "\u6682\u65E0\u81EA\u64CD\u4F5C\u4F1A\u8BDD",
  pause: "\u6682\u505C",
  resume: "\u7EE7\u7EED",
  pendingApprovals: "\u5F85\u786E\u8BA4\u64CD\u4F5C",
  approve: "\u5141\u8BB8\u4E00\u6B21",
  reject: "\u62D2\u7EDD",
  operatorDetail: "\u81EA\u64CD\u4F5C\u4F1A\u8BDD\u8BE6\u60C5",
  operatorTranscript: "\u4F1A\u8BDD\u8BB0\u5F55",
  emptyOperatorTranscript: "\u6682\u65E0\u4F1A\u8BDD\u8BB0\u5F55",
  operatorArtifacts: "Job \u4EA7\u7269",
  emptyOperatorArtifacts: "\u6682\u65E0 Job \u4EA7\u7269",
  operatorFollowUp: "\u7EE7\u7EED\u8FFD\u95EE\u6216\u8865\u5145\u8981\u6C42",
  send: "\u53D1\u9001",
  optimizationTitle: "\u81EA\u52A8\u4F18\u5316",
  optimizationDescription: "\u51BB\u7ED3 Skill\u3001\u6570\u636E\u96C6\u548C Runtime \u8EAB\u4EFD\u540E\uFF0C\u8FD0\u884C\u53EF\u6062\u590D\u7684\u591A\u8F6E\u4F18\u5316\u3002",
  optimizationSkill: "\u76EE\u6807 Skill",
  optimizationBaseline: "\u57FA\u7EBF Release",
  optimizationTargetRuntime: "\u9A8C\u8BC1\u76EE\u6807 Runtime",
  optimizationPreflight: "\u8FD0\u884C\u9884\u68C0",
  optimizationPreflightResult: "\u9884\u68C0\u51BB\u7ED3\u7ED3\u679C",
  startOptimization: "\u5F00\u59CB\u4F18\u5316",
  emptyOptimizations: "\u6682\u65E0\u4F18\u5316\u8FD0\u884C",
  optimizationDetail: "\u4F18\u5316\u8FD0\u884C\u8BE6\u60C5",
  optimizationTimeline: "Epoch \u65F6\u95F4\u7EBF",
  emptyOptimizationTimeline: "\u5C1A\u672A\u4EA7\u751F Epoch",
  generateOptimizationReport: "\u751F\u6210\u62A5\u544A",
  optimizationReport: "\u4F18\u5316\u62A5\u544A",
  legacyRubricNotice: "\u5F53\u524D\u8BC4\u5206\u6807\u51C6\u6765\u81EA\u65E7\u7248\u5206\u5C42\u8BA1\u5206 contract\u3002\u8FC1\u79FB\u53EA\u5347\u7EA7\u8BA1\u5206 contract\uFF0C\u4E0D\u6539\u5199\u8BC4\u5206\u5185\u5BB9\u6216\u5386\u53F2 Case\u3002",
  migrateLegacyRubric: "\u8FC1\u79FB\u65E7\u7248\u8BA1\u5206 contract"
};
var en = {
  nav: "Rolling Skill",
  title: "Rolling Skill Workbench",
  subtitle: "Continuously curate, refresh, and evaluate real Cases",
  openWorkbench: "Open Rolling Skill Workbench",
  refresh: "Refresh",
  loading: "Loading Rolling Skill data\u2026",
  loadError: "Could not load Rolling Skill data",
  retry: "Retry",
  captureAction: "Curate Case",
  captureChecking: "Checking\u2026",
  captureDraft: "Case Draft",
  captureSaved: "Case Saved",
  captureTitle: "Curate a Case from this conversation",
  captureDescription: "Choose the question boundary and Managed Dataset. Harness validates and freezes the conversation, Skill version, and installation evidence.",
  captureLoading: "Validating conversation boundaries and Datasets\u2026",
  captureLoadError: "Could not inspect this conversation for curation",
  captureStart: "Question starts at",
  captureDataset: "Target Dataset",
  captureBlocked: "Not ready",
  captureLabel: "Case type",
  captureGood: "Good",
  captureBad: "Bad",
  captureCreate: "Create Draft",
  captureCreating: "Creating\u2026",
  captureCreateError: "Could not create the Case Draft",
  captureDraftCreated: "Case Draft created",
  captureDraftDescription: "The source range is frozen. Continue reviewing and save it from the Rolling Skill workbench.",
  captureViewDraft: "View Draft",
  markerLegend: "Conversation curation status",
  markerDraftLegend: "Draft range",
  markerSavedLegend: "Saved range",
  markerCompatibility: "Some older messages lack stable render keys. Their status is preserved without guessed coloring.",
  markerCompatibilityShort: "Some ranges not colored",
  overview: "Overview",
  cases: "Cases & Datasets",
  skills: "Skill Management",
  evaluations: "Skill Evaluations",
  automatic: "Automatic Capture",
  automaticTitle: "Automatic Capture",
  automaticDescription: "Inspect new conversations on schedule, identify complete problems, and create Raw Cases or save Cases according to the selected mode.",
  automaticMode: "Capture Mode",
  automaticOff: "Off",
  automaticScheduled: "Scheduled Discovery",
  automaticFull: "Fully Automatic",
  executionLocation: "Execution Location",
  whileHarnessRunning: "Only while Harness is running",
  alwaysRunning: "Keep running after Harness closes",
  cadence: "Cadence",
  daily: "Daily",
  weekly: "Weekly",
  captureTime: "Capture Time",
  weekday: "Weekday",
  weekday0: "Sunday",
  weekday1: "Monday",
  weekday2: "Tuesday",
  weekday3: "Wednesday",
  weekday4: "Thursday",
  weekday5: "Friday",
  weekday6: "Saturday",
  automaticRuntime: "Automatic Capture Runtime",
  automaticDataset: "Target Dataset",
  automaticDatasetMatch: "Match automatically from the Skill",
  scheduledBehavior: "Only discovers candidates and stores reviewable Raw Cases; it does not write to a Dataset automatically.",
  automaticBehavior: "Candidates are saved as Cases only after confidence, Skill, Dataset, Rubric, and Draft gates pass.",
  offBehavior: "No conversations are scanned and no candidates are created while capture is off.",
  saveAutomatic: "Save Automatic Capture",
  runOnce: "Run Once Now",
  pendingRawCases: "Pending Raw Cases",
  schedulerStatus: "Scheduler Status",
  installed: "System scheduler installed",
  notInstalled: "System scheduler not installed",
  harnessTimer: "Runs from the Harness timer",
  enableScheduler: "Install System Scheduler",
  disableScheduler: "Remove System Scheduler",
  operator: "Operator & Optimization",
  settings: "Plugin Settings",
  settingsDescription: "Manage the default Runtime, data directory, legacy import, and diagnostics. Open the workbench from the sidebar for business workflows.",
  agentDefaults: "Agent Defaults",
  defaultRuntime: "Default Runtime",
  curatorDefault: "Curator",
  rubricDefault: "Rubric Agent",
  judgeDefault: "Judge",
  runtimeDefault: "Use Runtime default",
  saveDefaults: "Save Defaults",
  diagnostics: "Diagnostics",
  curation: "Draft Review",
  datasets: "Datasets",
  rawCases: "Raw Cases",
  rubrics: "Rubrics",
  installations: "Installations",
  curationDescription: "Review structured Case Drafts from the Agent and continue revising them in conversation.",
  activeDrafts: "Active",
  archivedDrafts: "Saved",
  emptyDrafts: "No Drafts",
  selectDraft: "Select a Draft to inspect",
  frozenEvidence: "Frozen Evidence",
  sourceRange: "Source Range",
  curatorConversation: "Curator Conversation",
  latestDraft: "Latest Valid Draft",
  noValidDraft: "No valid Draft yet",
  reviewMessage: "Revision request",
  sendRevision: "Send Revision",
  saveCase: "Save as Case",
  discardDraft: "Discard Draft",
  discardDraftConfirm: "Discard this Draft without saving a Case?",
  rubricDescription: "Generate, revise, and publish a unified 100-point Dataset rubric.",
  createRubric: "Generate Rubric",
  rubricSessions: "Generation and Review Sessions",
  rubricHistory: "Published Versions",
  activeRubric: "Active Rubric",
  noActiveRubric: "No published Rubric",
  selectRubricSession: "Select a Rubric session to inspect",
  rubricReview: "Rubric Review",
  rubricAgentConversation: "Rubric Agent Conversation",
  latestRubricDraft: "Latest Rubric Draft",
  publishRubric: "Publish Rubric",
  discardRubricConfirm: "Discard this Rubric Draft?",
  legacyImportTitle: "Import Legacy Electron Data",
  legacyImportDescription: "Migrate Cases, Raw Cases, Managed Skills, run records, and traces from the archived Rolling Skill app into DSH.",
  legacySource: "Legacy Data Directory",
  legacyDestination: "DSH Data Directory",
  legacyCopyOnly: "Import copies and validates data only. It never changes or deletes the legacy directory. Restart Harness after a successful import.",
  legacyImportedRestart: "Legacy data was imported. Restart Harness to load it.",
  legacyNotFound: "No legacy Rolling Skill data was detected.",
  legacyBlocked: "The current data directory cannot safely import legacy data.",
  legacyConfirmPrompt: "Copy the legacy data into the current DSH data directory? The legacy data will remain unchanged.",
  startImport: "Import Legacy Data",
  confirmImport: "Confirm Import",
  datasetsCount: "Datasets",
  casesCount: "Cases",
  rawCasesCount: "Raw Cases",
  evaluationsCount: "Evaluation Runs",
  managedSkillsCount: "Managed Skills",
  operatorSessionsCount: "Operator Sessions",
  optimizationsCount: "Optimization Runs",
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
  datasetSkill: "Managed Skill",
  unboundManagedSkill: "Managed Skill is not bound",
  noManagedSkills: "Import a valid managed Skill first",
  changeManagedSkill: "Change Skill",
  bindManagedSkillTitle: "Bind Managed Skill",
  bindManagedSkillDescription: "The Dataset stores only Managed Skill identity. Runtime, version, and installation are frozen per operation. Changing the Skill clears the active Rubric.",
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
  caseFilter: "Case type filter",
  allCases: "All Cases",
  casePages: "Case pages",
  previousPage: "Previous",
  nextPage: "Next",
  pageStatus: "Page {page}/{pages} \xB7 {total} total",
  caseDetailTitle: "Case Detail",
  caseAnswer: "Answer",
  caseIssue: "Issue Description",
  caseEvidence: "Source and Rubric Evidence",
  goodcase: "Good Case",
  badcase: "Bad Case",
  emptyCases: "This dataset has no Cases",
  caseNeedsCalibration: "Needs current Rubric calibration",
  calibrateCase: "Calibrate Case",
  calibrateAllCases: "Auto-calibrate All",
  stopCalibrationBatch: "Stop Calibration Batch",
  calibrationBatchProgress: "Auto calibration \xB7 {completed}/{total} saved",
  reviewCalibration: "Review Current Calibration",
  rawCasesTitle: "Raw Cases",
  rawCasesDescription: "Edit pending questions or remove entries that are no longer useful.",
  addRawCase: "Add Raw Case",
  addRawCaseTitle: "Add Manual Raw Case",
  searchRawCases: "Search questions, notes, or Skills",
  manualSource: "Manual source",
  rawCaseEvidence: "Raw Case Provenance",
  createCaseDraft: "Create Case Draft",
  rawCaseDraftDescription: "Only Datasets with the same Managed Skill and a published Rubric are shown. Runtime, version, and installation are validated and frozen by the Host.",
  validateInNewSession: "Validate in New Session",
  validateInCurrentSession: "Validate in Current Session",
  rawCaseDispatched: "Dispatched to a native DSH Session. Open it from the sidebar:",
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
  evaluationCaseScope: "Case Scope",
  activationMode: "Skill Activation",
  explicitActivation: "Explicit activation",
  automaticActivation: "Automatic activation",
  primaryRuntime: "Primary configured Runtime",
  makePrimaryRuntime: "Make primary",
  evaluationVersion: "Evaluation Version",
  installationReady: "The selected version is installed on the target Runtime",
  installationMissing: "The selected version is not installed on the target Runtime. Install it in Skill Management first.",
  judgeRuntime: "Judge Runtime",
  model: "Model",
  judgeModel: "Judge Model",
  effort: "Reasoning Effort",
  startEvaluation: "Start Evaluation",
  evaluationRuns: "Evaluation Runs",
  details: "Details",
  cancelRun: "Cancel Run",
  emptyEvaluations: "No evaluation runs",
  deleteEvaluationConfirm: "Delete this completed evaluation run?",
  evaluationDetail: "Evaluation Detail",
  close: "Close",
  skillRepositories: "Managed Skills",
  skillRepositoriesDescription: "Import, release, and install immutable Skill versions.",
  rescan: "Rescan",
  skillSourceLocation: "Absolute path or Git URL",
  importSkill: "Import",
  revealRepository: "Reveal in File Manager",
  emptySkills: "No Managed Skills",
  candidateVersion: "Candidate",
  createCandidate: "Create Candidate",
  releaseVersion: "Release",
  release: "Release",
  installationRuntime: "Installation Target Runtime",
  installReleased: "Install Released Version",
  installationJobs: "Installation Jobs",
  inspect: "Inspect",
  deprecateVersion: "Deprecate Version",
  deprecatedVersion: "Deprecated",
  installationDetail: "Installation Job Detail",
  installationVerification: "Installation Verification",
  installerConversation: "Installer Conversation",
  installerActivity: "Installation Activity",
  installerFollowUp: "Follow up or request a fix",
  runtimeInteractions: "Runtime Needs User Input",
  runtimePermissionRequest: "Permission Request",
  runtimeQuestionRequest: "Runtime Question",
  submitAnswers: "Submit Answers",
  operatorTitle: "Operator",
  operatorDescription: "Let the selected Runtime Agent operate Rolling Skill within bounded capabilities and budgets.",
  operatorRuntime: "Operator Runtime",
  operatorObjective: "Objective",
  operatorObjectivePlaceholder: "For example: inspect and refresh stale Good Cases",
  startOperator: "Start Operator",
  emptyOperators: "No Operator sessions",
  pause: "Pause",
  resume: "Resume",
  pendingApprovals: "Pending Approvals",
  approve: "Approve Once",
  reject: "Reject",
  operatorDetail: "Operator Session Detail",
  operatorTranscript: "Session Transcript",
  emptyOperatorTranscript: "No transcript entries",
  operatorArtifacts: "Job Artifacts",
  emptyOperatorArtifacts: "No Job artifacts",
  operatorFollowUp: "Follow up or add requirements",
  send: "Send",
  optimizationTitle: "Automatic Optimization",
  optimizationDescription: "Run recoverable multi-epoch optimization over frozen Skill, Dataset, and Runtime identities.",
  optimizationSkill: "Target Skill",
  optimizationBaseline: "Baseline Release",
  optimizationTargetRuntime: "Validation Target Runtime",
  optimizationPreflight: "Run Preflight",
  optimizationPreflightResult: "Frozen Preflight Result",
  startOptimization: "Start Optimization",
  emptyOptimizations: "No Optimization runs",
  optimizationDetail: "Optimization Run Detail",
  optimizationTimeline: "Epoch Timeline",
  emptyOptimizationTimeline: "No Epochs yet",
  generateOptimizationReport: "Generate Report",
  optimizationReport: "Optimization Report",
  legacyRubricNotice: "The active Rubric uses the retired split scoring contract. Migration upgrades only the contract without rewriting content or historical Cases.",
  migrateLegacyRubric: "Migrate Legacy Scoring Contract"
};
var DICTIONARIES = { zh, en };

// src/client/conversation/CaseCaptureAction.tsx
var import_dsh_client_ui_primitives2 = require("@deepseek-ai/dsh-client-ui-primitives");
var import_react2 = require("react");

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

// src/client/conversation/CaseCaptureDialog.tsx
var import_dsh_client_ui_primitives = require("@deepseek-ai/dsh-client-ui-primitives");
var import_react = require("react");
var import_jsx_runtime = require("react/jsx-runtime");
function openDraft(sessionId) {
  window.dispatchEvent(new CustomEvent("rolling-skill:open-workbench", {
    detail: { route: { page: "curation", sessionId } }
  }));
}
function CaseCaptureDialog({
  sessionId,
  endMessageId,
  t,
  onClose,
  onCreated
}) {
  const dialogRef = (0, import_react.useRef)(null);
  const [loadRevision, setLoadRevision] = (0, import_react.useState)(0);
  const [loadState, setLoadState] = (0, import_react.useState)({ status: "loading" });
  const [startSeq, setStartSeq] = (0, import_react.useState)(null);
  const [datasetId, setDatasetId] = (0, import_react.useState)("");
  const [label, setLabel] = (0, import_react.useState)("good");
  const [note, setNote] = (0, import_react.useState)("");
  const [submitting, setSubmitting] = (0, import_react.useState)(false);
  const [submitError, setSubmitError] = (0, import_react.useState)(null);
  const [created, setCreated] = (0, import_react.useState)(null);
  (0, import_react.useEffect)(() => {
    const controller = new AbortController();
    setLoadState({ status: "loading" });
    requestRollingSkill(
      "conversationCuration.inspect",
      { sessionId, endMessageId },
      controller.signal
    ).then((inspection2) => {
      setLoadState({ status: "ready", inspection: inspection2 });
      const latest = inspection2.startCandidates.at(-1);
      setStartSeq((current) => current ?? latest?.seq ?? null);
      const firstReady = inspection2.datasets.find((dataset) => dataset.ready);
      setDatasetId((current) => current || firstReady?.datasetId || inspection2.datasets[0]?.datasetId || "");
    }).catch((error) => {
      if (controller.signal.aborted) return;
      setLoadState({
        status: "error",
        message: error instanceof Error ? error.message : t("captureLoadError")
      });
    });
    return () => controller.abort();
  }, [sessionId, endMessageId, loadRevision]);
  (0, import_react.useEffect)(() => {
    const dialog = dialogRef.current;
    const first = dialog?.querySelector(
      "button:not([disabled]), select:not([disabled]), textarea:not([disabled])"
    );
    first?.focus();
    const onKeyDown = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab" || !dialog) return;
      const focusable = Array.from(dialog.querySelectorAll(
        "button:not([disabled]), select:not([disabled]), textarea:not([disabled])"
      ));
      if (focusable.length === 0) return;
      const current = focusable.indexOf(document.activeElement);
      const next = event.shiftKey ? current <= 0 ? focusable.length - 1 : current - 1 : current < 0 || current === focusable.length - 1 ? 0 : current + 1;
      event.preventDefault();
      focusable[next].focus();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);
  const inspection = loadState.status === "ready" ? loadState.inspection : null;
  const selectedDataset = (0, import_react.useMemo)(
    () => inspection?.datasets.find((dataset) => dataset.datasetId === datasetId) ?? null,
    [inspection, datasetId]
  );
  const canSubmit = Boolean(
    inspection && startSeq !== null && selectedDataset?.ready && !submitting && !created
  );
  const create = async () => {
    if (!canSubmit || startSeq === null) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const curation = await requestRollingSkill(
        "conversationCuration.create",
        {
          sessionId,
          endMessageId,
          startSeq,
          datasetId,
          label,
          note,
          idempotencyKey: `dsh:${sessionId}:${endMessageId}:${startSeq}:${datasetId}`
        }
      );
      setCreated(curation);
      onCreated(curation);
      window.dispatchEvent(new CustomEvent("rolling-skill:curation-markers-changed", {
        detail: { sessionId }
      }));
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : t("captureCreateError"));
    } finally {
      setSubmitting(false);
    }
  };
  return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "rolling-skill-dialog-backdrop", onMouseDown: (event) => {
    if (event.currentTarget === event.target) onClose();
  }, children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
    "div",
    {
      ref: dialogRef,
      className: "rolling-skill-dialog",
      role: "dialog",
      "aria-modal": "true",
      "aria-labelledby": "rolling-skill-capture-title",
      children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("header", { className: "rolling-skill-dialog-header", children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", { id: "rolling-skill-capture-title", children: t("captureTitle") }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { children: t("captureDescription") })
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_dsh_client_ui_primitives.Button, { variant: "ghost", size: "sm", onClick: onClose, "aria-label": t("close"), children: "\xD7" })
        ] }),
        loadState.status === "loading" ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "rolling-skill-state", role: "status", children: t("captureLoading") }) : loadState.status === "error" ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "rolling-skill-state rolling-skill-error", role: "alert", children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: loadState.message }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_dsh_client_ui_primitives.Button, { variant: "outline", size: "sm", onClick: () => setLoadRevision((value) => value + 1), children: t("retry") })
        ] }) : created ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "rolling-skill-form-stack", role: "status", children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("strong", { children: t("captureDraftCreated") }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { children: t("captureDraftDescription") }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "rolling-skill-actions", children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_dsh_client_ui_primitives.Button, { onClick: () => openDraft(created.id), children: t("captureViewDraft") }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_dsh_client_ui_primitives.Button, { variant: "outline", onClick: onClose, children: t("close") })
          ] })
        ] }) : /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "rolling-skill-form-stack", children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { className: "rolling-skill-field", children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: t("captureStart") }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
              "select",
              {
                className: "rolling-skill-select",
                value: startSeq ?? "",
                onChange: (event) => setStartSeq(Number(event.target.value)),
                children: loadState.inspection.startCandidates.map((candidate) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", { value: candidate.seq, children: candidate.text || `${t("question")} #${candidate.seq}` }, candidate.seq))
              }
            )
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { className: "rolling-skill-field", children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: t("captureDataset") }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
              "select",
              {
                className: "rolling-skill-select",
                value: datasetId,
                onChange: (event) => setDatasetId(event.target.value),
                children: loadState.inspection.datasets.map((dataset) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("option", { value: dataset.datasetId, children: [
                  dataset.name,
                  dataset.ready ? "" : ` \u2014 ${t("captureBlocked")}`
                ] }, dataset.datasetId))
              }
            )
          ] }),
          selectedDataset && !selectedDataset.ready ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "rolling-skill-blockers", role: "alert", children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("strong", { children: t("captureBlocked") }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("ul", { children: selectedDataset.blockers.map((blocker) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("li", { children: blocker.message }, `${blocker.code}:${blocker.message}`)) })
          ] }) : null,
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("fieldset", { className: "rolling-skill-label-fieldset", children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("legend", { children: t("captureLabel") }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { children: [
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", { type: "radio", name: "rolling-skill-label", checked: label === "good", onChange: () => setLabel("good") }),
              t("captureGood")
            ] }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { children: [
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", { type: "radio", name: "rolling-skill-label", checked: label === "bad", onChange: () => setLabel("bad") }),
              t("captureBad")
            ] })
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { className: "rolling-skill-field", children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: t("note") }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("textarea", { value: note, maxLength: 12e4, onChange: (event) => setNote(event.target.value) })
          ] }),
          submitError ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "rolling-skill-inline-error", role: "alert", children: submitError }) : null,
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "rolling-skill-actions rolling-skill-dialog-actions", children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_dsh_client_ui_primitives.Button, { variant: "outline", onClick: onClose, disabled: submitting, children: t("cancel") }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_dsh_client_ui_primitives.Button, { onClick: create, disabled: !canSubmit, children: submitting ? t("captureCreating") : t("captureCreate") })
          ] })
        ] })
      ]
    }
  ) });
}

// src/client/conversation/active-session.ts
var counts = /* @__PURE__ */ new Map();
var order = [];
var listeners = /* @__PURE__ */ new Set();
var lastObservedSessionId = null;
function notify() {
  for (const listener of listeners) listener();
}
function registerActiveConversationSession(sessionId) {
  if (!sessionId) return () => {
  };
  lastObservedSessionId = sessionId;
  counts.set(sessionId, (counts.get(sessionId) ?? 0) + 1);
  const previous = order.indexOf(sessionId);
  if (previous >= 0) order.splice(previous, 1);
  order.push(sessionId);
  notify();
  return () => {
    const remaining = (counts.get(sessionId) ?? 1) - 1;
    if (remaining > 0) counts.set(sessionId, remaining);
    else {
      counts.delete(sessionId);
      const index = order.indexOf(sessionId);
      if (index >= 0) order.splice(index, 1);
    }
    notify();
  };
}
function activeConversationSessionSnapshot() {
  return order.at(-1) ?? lastObservedSessionId;
}
function subscribeActiveConversationSession(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// src/client/conversation/CaseCaptureAction.tsx
var import_jsx_runtime2 = require("react/jsx-runtime");
function openWorkbench(sessionId) {
  window.dispatchEvent(new CustomEvent("rolling-skill:open-workbench", {
    detail: { route: { page: "curation", sessionId } }
  }));
}
function CaseCaptureAction({ messageId, sessionId, t }) {
  const [open, setOpen] = (0, import_react2.useState)(false);
  const [loading, setLoading] = (0, import_react2.useState)(true);
  const [marker, setMarker] = (0, import_react2.useState)(null);
  (0, import_react2.useEffect)(() => registerActiveConversationSession(sessionId), [sessionId]);
  (0, import_react2.useEffect)(() => {
    const controller = new AbortController();
    setLoading(true);
    requestRollingSkill(
      "conversationCuration.markers",
      { sessionId },
      controller.signal
    ).then((markers) => {
      setMarker(markers.find((entry) => entry.endMessageId === messageId) ?? null);
    }).catch(() => {
      if (!controller.signal.aborted) setMarker(null);
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false);
    });
    return () => controller.abort();
  }, [messageId, sessionId]);
  const label = loading ? t("captureChecking") : marker?.status === "saved" ? t("captureSaved") : marker?.status === "draft" ? t("captureDraft") : t("captureAction");
  const activate = () => {
    if (marker?.curationSessionId) {
      openWorkbench(marker.curationSessionId);
      return;
    }
    setOpen(true);
  };
  return /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)(import_jsx_runtime2.Fragment, { children: [
    /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
      import_dsh_client_ui_primitives2.Button,
      {
        variant: "ghost",
        size: "sm",
        onClick: activate,
        disabled: loading,
        "aria-label": label,
        "data-rolling-skill-curation-status": marker?.status ?? "available",
        children: label
      }
    ),
    open ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
      CaseCaptureDialog,
      {
        sessionId,
        endMessageId: messageId,
        t,
        onClose: () => setOpen(false),
        onCreated: (curation) => setMarker({
          endMessageId: messageId,
          curationSessionId: curation.id,
          caseId: curation.caseId,
          status: curation.caseId ? "saved" : "draft"
        })
      }
    ) : null
  ] });
}

// src/client/conversation/ConversationCurationMarkers.tsx
var import_react3 = require("react");

// src/client/conversation/curation-markers.ts
var import_curation_markers = __toESM(require_curation_markers(), 1);
var projectMarkers = import_curation_markers.default.projectMarkers;

// src/client/conversation/ConversationCurationMarkers.tsx
var import_jsx_runtime3 = require("react/jsx-runtime");
var MARKER_CLASSES = ["rolling-skill-curation-draft", "rolling-skill-curation-saved"];
function ConversationCurationMarkers({ sessionId, useSession, t }) {
  const snapshot = useSession((value) => value);
  const [markers, setMarkers] = (0, import_react3.useState)([]);
  const [revision, setRevision] = (0, import_react3.useState)(0);
  const [compatibilityMissing, setCompatibilityMissing] = (0, import_react3.useState)(false);
  const applied = (0, import_react3.useRef)(/* @__PURE__ */ new Set());
  (0, import_react3.useEffect)(() => {
    const controller = new AbortController();
    requestRollingSkill(
      "conversationCuration.markers",
      { sessionId },
      controller.signal
    ).then(setMarkers).catch(() => {
      if (!controller.signal.aborted) setMarkers([]);
    });
    return () => controller.abort();
  }, [sessionId, revision]);
  (0, import_react3.useEffect)(() => {
    const refresh = (event) => {
      const detailSessionId = event.detail?.sessionId;
      if (!detailSessionId || detailSessionId === sessionId) {
        setRevision((value) => value + 1);
      }
    };
    window.addEventListener("rolling-skill:curation-markers-changed", refresh);
    return () => window.removeEventListener("rolling-skill:curation-markers-changed", refresh);
  }, [sessionId]);
  (0, import_react3.useEffect)(() => {
    const clear = () => {
      for (const row of applied.current) {
        row.classList.remove(...MARKER_CLASSES);
        row.removeAttribute("data-rolling-skill-curation-marker");
      }
      applied.current.clear();
    };
    const render = () => {
      clear();
      const projection = projectMarkers(snapshot, markers);
      let missing = false;
      for (const [key, status] of projection) {
        const selector = `[data-chat-flow-key="${CSS.escape(key)}"]`;
        const rows = document.querySelectorAll(selector);
        if (rows.length === 0) missing = true;
        for (const row of rows) {
          row.classList.add(`rolling-skill-curation-${status}`);
          row.dataset.rollingSkillCurationMarker = status;
          applied.current.add(row);
        }
      }
      setCompatibilityMissing((current) => current === missing ? current : missing);
    };
    render();
    const observer = new MutationObserver(render);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
      clear();
    };
  }, [snapshot, markers]);
  const totals = markers.reduce((result, marker) => {
    result[marker.status] += 1;
    return result;
  }, { draft: 0, saved: 0 });
  if (markers.length === 0) return null;
  return /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "rolling-skill-marker-legend", "aria-label": t("markerLegend"), children: [
    totals.draft > 0 ? /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("span", { className: "rolling-skill-marker-chip rolling-skill-marker-chip-draft", children: [
      t("markerDraftLegend"),
      " \xB7 ",
      totals.draft
    ] }) : null,
    totals.saved > 0 ? /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("span", { className: "rolling-skill-marker-chip rolling-skill-marker-chip-saved", children: [
      t("markerSavedLegend"),
      " \xB7 ",
      totals.saved
    ] }) : null,
    compatibilityMissing ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: "rolling-skill-marker-compatibility", role: "status", title: t("markerCompatibility"), children: t("markerCompatibilityShort") }) : null
  ] });
}

// src/client/workbench/WorkbenchLauncher.tsx
var import_dsh_client_ui_primitives19 = require("@deepseek-ai/dsh-client-ui-primitives");
var import_react20 = require("react");

// src/client/workbench/WorkbenchOverlay.tsx
var import_dsh_client_ui_primitives18 = require("@deepseek-ai/dsh-client-ui-primitives");
var import_react19 = require("react");

// src/client/workbench/Workbench.tsx
var import_dsh_client_ui_primitives17 = require("@deepseek-ai/dsh-client-ui-primitives");
var import_react18 = require("react");

// src/client/workbench/AutomaticCapturePanel.tsx
var import_dsh_client_ui_primitives3 = require("@deepseek-ai/dsh-client-ui-primitives");
var import_react4 = require("react");

// src/client/workbench/RuntimeSelect.tsx
var import_jsx_runtime4 = require("react/jsx-runtime");
function RuntimeSelect({
  t,
  runtimes,
  value,
  onChange,
  label
}) {
  return /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("fieldset", { className: "rolling-skill-runtime-select", children: [
    /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("legend", { children: label }),
    /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { className: "rolling-skill-runtime-list", children: [
      runtimes.map((runtime) => /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("label", { className: "rolling-skill-runtime-option", children: [
        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(
          "input",
          {
            type: "radio",
            name: label,
            value: runtime.runtimeId,
            checked: value === runtime.runtimeId,
            onChange: () => onChange(runtime.runtimeId)
          }
        ),
        /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("span", { children: [
          /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("strong", { children: [
            runtime.displayName,
            " ",
            runtime.version
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("code", { children: runtime.executablePath })
        ] })
      ] }, runtime.runtimeId)),
      runtimes.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("p", { children: t("noRuntimes") }) : null
    ] })
  ] });
}

// src/client/workbench/AutomaticCapturePanel.tsx
var import_jsx_runtime5 = require("react/jsx-runtime");
var WEEKDAY_KEYS = [
  "weekday0",
  "weekday1",
  "weekday2",
  "weekday3",
  "weekday4",
  "weekday5",
  "weekday6"
];
function displayTime(value, fallback) {
  if (!value) return fallback;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleString() : fallback;
}
function AutomaticCapturePanel({ t }) {
  const [status, setStatus] = (0, import_react4.useState)(null);
  const [runtimes, setRuntimes] = (0, import_react4.useState)([]);
  const [datasets, setDatasets] = (0, import_react4.useState)([]);
  const [models, setModels] = (0, import_react4.useState)([]);
  const [mode, setMode] = (0, import_react4.useState)("off");
  const [executionLocation, setExecutionLocation] = (0, import_react4.useState)("while-harness-running");
  const [cadence, setCadence] = (0, import_react4.useState)("daily");
  const [time, setTime] = (0, import_react4.useState)("09:00");
  const [weekday, setWeekday] = (0, import_react4.useState)(1);
  const [runtimeId, setRuntimeId] = (0, import_react4.useState)("");
  const [modelId, setModelId] = (0, import_react4.useState)("");
  const [effort, setEffort] = (0, import_react4.useState)("low");
  const [datasetId, setDatasetId] = (0, import_react4.useState)("");
  const [busy, setBusy] = (0, import_react4.useState)(false);
  const [error, setError] = (0, import_react4.useState)(null);
  const [revision, setRevision] = (0, import_react4.useState)(0);
  (0, import_react4.useEffect)(() => {
    const controller = new AbortController();
    Promise.all([
      requestRollingSkill("automatic.status", {}, controller.signal),
      requestRollingSkill("runtimes.list", {}, controller.signal),
      requestRollingSkill("datasets.list", {}, controller.signal)
    ]).then(([nextStatus, runtimeItems, datasetItems]) => {
      setStatus(nextStatus);
      setRuntimes(runtimeItems);
      setDatasets(datasetItems);
      setMode(nextStatus.mode);
      setExecutionLocation(nextStatus.executionLocation);
      setCadence(nextStatus.schedule.cadence);
      setTime(nextStatus.schedule.time);
      setWeekday(nextStatus.schedule.weekday);
      setRuntimeId(nextStatus.runtime?.runtimeId || runtimeItems[0]?.runtimeId || "");
      setModelId(nextStatus.modelId || "");
      setEffort(nextStatus.effort || "low");
      setDatasetId(nextStatus.datasetId || "");
    }).catch((reason) => {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : t("loadError"));
    });
    return () => controller.abort();
  }, [revision]);
  (0, import_react4.useEffect)(() => {
    if (!runtimeId) return;
    const controller = new AbortController();
    requestRollingSkill("runtimes.models", { runtimeId }, controller.signal).then((items) => {
      setModels(items);
      setModelId((current) => current || items[0]?.id || items[0]?.model || "");
    }).catch((reason) => {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : t("loadError"));
    });
    return () => controller.abort();
  }, [runtimeId]);
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
  const save = () => mutate(async () => {
    await requestRollingSkill("automatic.update", {
      mode,
      executionLocation,
      cadence,
      time,
      weekday,
      runtimeId: runtimeId || null,
      modelId: modelId || null,
      effort: effort || null,
      datasetId: datasetId || null
    });
    if (status?.worker.installed) {
      await requestRollingSkill(
        executionLocation === "always" ? "scheduler.enable" : "scheduler.disable",
        {}
      );
    }
  });
  const runOnce = () => mutate(() => requestRollingSkill("automatic.runOnce", { slot: "manual" }));
  const enableScheduler = () => mutate(() => requestRollingSkill("scheduler.enable", {}));
  const disableScheduler = () => mutate(() => requestRollingSkill("scheduler.disable", {}));
  const requiresRuntime = mode !== "off";
  const schedulerInstalled = status?.scheduler.installed ?? status?.worker.installed ?? false;
  return /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("div", { className: "rolling-skill-data-stack", children: [
    /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("section", { className: "rolling-skill-panel", children: [
      /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("div", { className: "rolling-skill-panel-header", children: [
        /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("div", { children: [
          /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("h3", { children: t("automaticTitle") }),
          /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("p", { children: t("automaticDescription") })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(import_dsh_client_ui_primitives3.Button, { variant: "ghost", size: "sm", onClick: () => setRevision((value) => value + 1), children: t("refresh") })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("div", { className: "rolling-skill-grid", children: [
        /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("label", { className: "rolling-skill-field", children: [
          /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("span", { children: t("automaticMode") }),
          /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("select", { className: "rolling-skill-select", value: mode, onChange: (event) => setMode(event.target.value), children: [
            /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("option", { value: "off", children: t("automaticOff") }),
            /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("option", { value: "scheduled", children: t("automaticScheduled") }),
            /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("option", { value: "automatic", children: t("automaticFull") })
          ] })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("label", { className: "rolling-skill-field", children: [
          /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("span", { children: t("executionLocation") }),
          /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("select", { className: "rolling-skill-select", value: executionLocation, onChange: (event) => setExecutionLocation(event.target.value), children: [
            /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("option", { value: "while-harness-running", children: t("whileHarnessRunning") }),
            /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("option", { value: "always", children: t("alwaysRunning") })
          ] })
        ] })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("div", { className: "rolling-skill-grid", children: [
        /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("label", { className: "rolling-skill-field", children: [
          /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("span", { children: t("cadence") }),
          /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("select", { className: "rolling-skill-select", value: cadence, onChange: (event) => setCadence(event.target.value), children: [
            /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("option", { value: "daily", children: t("daily") }),
            /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("option", { value: "weekly", children: t("weekly") })
          ] })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("label", { className: "rolling-skill-field", children: [
          /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("span", { children: t("captureTime") }),
          /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("input", { className: "rolling-skill-select", type: "time", value: time, onChange: (event) => setTime(event.target.value) })
        ] }),
        cadence === "weekly" ? /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("label", { className: "rolling-skill-field", children: [
          /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("span", { children: t("weekday") }),
          /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("select", { className: "rolling-skill-select", value: weekday, onChange: (event) => setWeekday(Number(event.target.value)), children: WEEKDAY_KEYS.map((key, day) => /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("option", { value: day, children: t(key) }, key)) })
        ] }) : null
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(RuntimeSelect, { t, runtimes, value: runtimeId, onChange: setRuntimeId, label: t("automaticRuntime") }),
      /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("div", { className: "rolling-skill-grid", children: [
        /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("label", { className: "rolling-skill-field", children: [
          /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("span", { children: t("model") }),
          /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("select", { className: "rolling-skill-select", value: modelId, onChange: (event) => setModelId(event.target.value), children: models.map((model) => {
            const id = model.id ?? model.model ?? "";
            return /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("option", { value: id, children: model.displayName ?? id }, id);
          }) })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("label", { className: "rolling-skill-field", children: [
          /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("span", { children: t("effort") }),
          /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("select", { className: "rolling-skill-select", value: effort, onChange: (event) => setEffort(event.target.value), children: ["low", "medium", "high", "xhigh", "max"].map((item) => /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("option", { value: item, children: item }, item)) })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("label", { className: "rolling-skill-field", children: [
          /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("span", { children: t("automaticDataset") }),
          /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("select", { className: "rolling-skill-select", value: datasetId, onChange: (event) => setDatasetId(event.target.value), children: [
            /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("option", { value: "", children: t("automaticDatasetMatch") }),
            datasets.map((dataset) => /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("option", { value: dataset.id, children: dataset.name }, dataset.id))
          ] })
        ] })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("p", { className: "rolling-skill-help", children: mode === "scheduled" ? t("scheduledBehavior") : mode === "automatic" ? t("automaticBehavior") : t("offBehavior") }),
      error ? /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("p", { className: "rolling-skill-inline-error", role: "alert", children: error }) : null,
      /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("div", { className: "rolling-skill-actions", children: [
        /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(import_dsh_client_ui_primitives3.Button, { variant: "outline", disabled: busy || requiresRuntime && !runtimeId, onClick: () => void save(), children: t("saveAutomatic") }),
        /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(import_dsh_client_ui_primitives3.Button, { variant: "ghost", disabled: busy || mode === "off" || !runtimeId, onClick: () => void runOnce(), children: t("runOnce") }),
        executionLocation === "always" ? schedulerInstalled ? /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(import_dsh_client_ui_primitives3.Button, { variant: "ghost", disabled: busy, onClick: () => void disableScheduler(), children: t("disableScheduler") }) : /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(import_dsh_client_ui_primitives3.Button, { variant: "outline", disabled: busy || status?.executionLocation !== "always" || status?.mode === "off" || !status?.scheduler.supported, onClick: () => void enableScheduler(), children: t("enableScheduler") }) : null
      ] })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("section", { className: "rolling-skill-panel", children: [
      /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("h3", { children: t("automaticStatus") }),
      /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("dl", { children: [
        /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("div", { children: [
          /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("dt", { children: t("nextRun") }),
          /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("dd", { children: displayTime(status?.nextRunAt ?? null, t("notAvailable")) })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("div", { children: [
          /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("dt", { children: t("lastSuccess") }),
          /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("dd", { children: displayTime(status?.lastSuccessAt ?? null, t("notAvailable")) })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("div", { children: [
          /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("dt", { children: t("pendingRawCases") }),
          /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("dd", { children: status?.pendingCount ?? 0 })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("div", { children: [
          /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("dt", { children: t("schedulerStatus") }),
          /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("dd", { children: executionLocation === "always" ? schedulerInstalled ? t("installed") : t("notInstalled") : t("harnessTimer") })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("div", { children: [
          /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("dt", { children: t("lastError") }),
          /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("dd", { children: status?.error || status?.scheduler.error || status?.worker.lastRegistrationError || t("noError") })
        ] })
      ] })
    ] })
  ] });
}

// src/client/workbench/CasesPanel.tsx
var import_dsh_client_ui_primitives4 = require("@deepseek-ai/dsh-client-ui-primitives");
var import_react5 = require("react");
var import_jsx_runtime6 = require("react/jsx-runtime");
function CasesPanel({ t, revision, onChanged, initialDatasetId, initialCaseId, onNavigate }) {
  const [datasets, setDatasets] = (0, import_react5.useState)([]);
  const [runtimes, setRuntimes] = (0, import_react5.useState)([]);
  const [runtimeId, setRuntimeId] = (0, import_react5.useState)("");
  const [datasetId, setDatasetId] = (0, import_react5.useState)(initialDatasetId ?? "");
  const [entries, setEntries] = (0, import_react5.useState)([]);
  const [caseScope, setCaseScope] = (0, import_react5.useState)("all");
  const [page, setPage] = (0, import_react5.useState)(1);
  const [pageResult, setPageResult] = (0, import_react5.useState)({ items: [], total: 0, page: 1, pageSize: 20, pageCount: 0 });
  const [detail, setDetail] = (0, import_react5.useState)(null);
  const [deleting, setDeleting] = (0, import_react5.useState)(null);
  const [recoverQuestions, setRecoverQuestions] = (0, import_react5.useState)(true);
  const [busy, setBusy] = (0, import_react5.useState)(false);
  const [error, setError] = (0, import_react5.useState)(null);
  const [calibrationBatch, setCalibrationBatch] = (0, import_react5.useState)(null);
  const stopCalibration = (0, import_react5.useRef)(false);
  (0, import_react5.useEffect)(() => () => {
    stopCalibration.current = true;
  }, []);
  (0, import_react5.useEffect)(() => {
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
  (0, import_react5.useEffect)(() => {
    if (!datasetId) {
      setEntries([]);
      return;
    }
    const controller = new AbortController();
    requestRollingSkill("cases.list", { datasetId, caseScope, page, pageSize: 20 }, controller.signal).then((result) => {
      setPageResult(result);
      setEntries(result.items);
      if (result.pageCount > 0 && result.page > result.pageCount) setPage(result.pageCount);
    }).catch((reason) => {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : t("loadError"));
    });
    return () => controller.abort();
  }, [datasetId, caseScope, page, revision]);
  (0, import_react5.useEffect)(() => {
    if (!initialCaseId || !datasetId) return;
    const controller = new AbortController();
    requestRollingSkill("cases.get", { datasetId, caseId: initialCaseId }, controller.signal).then(setDetail).catch((reason) => {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : t("loadError"));
    });
    return () => controller.abort();
  }, [datasetId, initialCaseId]);
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
  const inspect = async (entry) => {
    setError(null);
    try {
      setDetail(await requestRollingSkill("cases.get", { datasetId, caseId: entry.id }));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t("loadError"));
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
  const calibrate = (entry) => mutate(async () => {
    const session = await requestRollingSkill("curation.createCalibration", {
      datasetId,
      caseId: entry.id,
      idempotencyKey: crypto.randomUUID()
    });
    onNavigate({ page: "curation", sessionId: session.id });
  });
  const waitForCalibrationDraft = async (sessionId) => {
    while (!stopCalibration.current) {
      const session = await requestRollingSkill("curation.get", { sessionId });
      if (session.status === "needs_review" && session.draft) return session;
      if (["failed", "cancelled", "archived"].includes(session.status)) {
        throw new Error(session.error?.message ?? `Calibration stopped while ${session.status}`);
      }
      await new Promise((resolve) => window.setTimeout(resolve, 1200));
    }
    throw new Error("CALIBRATION_BATCH_STOPPED");
  };
  const startCalibrationBatch = async () => {
    if (!datasetId || calibrationBatch?.status === "running") return;
    stopCalibration.current = false;
    setError(null);
    let currentSessionId;
    try {
      const all = [];
      let nextPage = 1;
      while (true) {
        const result = await requestRollingSkill("cases.list", { datasetId, caseScope: "all", page: nextPage, pageSize: 200 });
        all.push(...result.items);
        if (nextPage >= result.pageCount) break;
        nextPage += 1;
      }
      const pending = all.filter((entry) => entry.rubricCalibration?.status !== "current");
      setCalibrationBatch({ status: "running", completed: 0, total: pending.length });
      let completed = 0;
      for (const entry of pending) {
        if (stopCalibration.current) throw new Error("CALIBRATION_BATCH_STOPPED");
        const session = await requestRollingSkill("curation.createCalibration", {
          datasetId,
          caseId: entry.id,
          idempotencyKey: crypto.randomUUID()
        });
        currentSessionId = session.id;
        setCalibrationBatch({ status: "running", completed, total: pending.length, currentSessionId });
        const ready = await waitForCalibrationDraft(session.id);
        await requestRollingSkill("curation.save", {
          sessionId: ready.id,
          expectedRevision: ready.revision,
          idempotencyKey: crypto.randomUUID()
        });
        completed += 1;
        setCalibrationBatch({ status: "running", completed, total: pending.length });
        onChanged();
      }
      setCalibrationBatch({ status: "completed", completed, total: pending.length });
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : t("loadError");
      setCalibrationBatch((current) => ({
        status: message === "CALIBRATION_BATCH_STOPPED" ? "stopped" : "failed",
        completed: current?.completed ?? 0,
        total: current?.total ?? 0,
        ...currentSessionId ? { currentSessionId } : {},
        ...message === "CALIBRATION_BATCH_STOPPED" ? {} : { error: message }
      }));
    }
  };
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
      setDetail((current) => current?.id === entry.id ? null : current);
    });
  };
  return /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("section", { className: "rolling-skill-panel rolling-skill-data-panel", children: [
    /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("div", { className: "rolling-skill-panel-header", children: [
      /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("div", { children: [
        /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("h3", { children: t("casesTitle") }),
        /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("p", { children: t("casesDescription") })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("div", { className: "rolling-skill-actions", children: [
        /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(import_dsh_client_ui_primitives4.Button, { variant: "outline", size: "sm", disabled: !datasetId || busy, onClick: () => void refreshBatch("goodcase"), children: t("refreshGoodCases") }),
        /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(import_dsh_client_ui_primitives4.Button, { variant: "outline", size: "sm", disabled: !datasetId || busy, onClick: () => void refreshBatch("all"), children: t("refreshAllCases") }),
        calibrationBatch?.status === "running" ? /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(import_dsh_client_ui_primitives4.Button, { variant: "outline", size: "sm", onClick: () => {
          stopCalibration.current = true;
        }, children: t("stopCalibrationBatch") }) : /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(import_dsh_client_ui_primitives4.Button, { variant: "outline", size: "sm", disabled: !datasetId || busy, onClick: () => void startCalibrationBatch(), children: t("calibrateAllCases") })
      ] })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("div", { className: "rolling-skill-form-row", children: [
      /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("select", { className: "rolling-skill-select", "aria-label": t("selectDataset"), value: datasetId, onChange: (event) => {
        setDatasetId(event.target.value);
        setPage(1);
      }, children: datasets.map((dataset) => /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("option", { value: dataset.id, children: dataset.name }, dataset.id)) }),
      /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("select", { className: "rolling-skill-select", "aria-label": t("caseFilter"), value: caseScope, onChange: (event) => {
        setCaseScope(event.target.value);
        setPage(1);
      }, children: [
        /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("option", { value: "all", children: t("allCases") }),
        /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("option", { value: "goodcase", children: t("goodcase") }),
        /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("option", { value: "badcase", children: t("badcase") })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(RuntimeSelect, { t, runtimes, value: runtimeId, onChange: setRuntimeId, label: t("refreshRuntime") })
    ] }),
    error ? /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("p", { className: "rolling-skill-inline-error", role: "alert", children: error }) : null,
    calibrationBatch ? /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("section", { className: "rolling-skill-subpanel", children: [
      /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("p", { children: [
        t("calibrationBatchProgress").replace("{completed}", String(calibrationBatch.completed)).replace("{total}", String(calibrationBatch.total)),
        " \xB7 ",
        calibrationBatch.status
      ] }),
      calibrationBatch.error ? /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("p", { className: "rolling-skill-inline-error", children: calibrationBatch.error }) : null,
      calibrationBatch.currentSessionId ? /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(import_dsh_client_ui_primitives4.Button, { variant: "ghost", size: "sm", onClick: () => onNavigate({ page: "curation", sessionId: calibrationBatch.currentSessionId }), children: t("reviewCalibration") }) : null
    ] }) : null,
    /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("div", { className: "rolling-skill-list", children: [
      entries.map((entry) => /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("article", { className: "rolling-skill-case-row", children: [
        /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("div", { className: "rolling-skill-case-copy", children: [
          /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("span", { className: "rolling-skill-badge", children: entry.caseType === "goodcase" ? t("goodcase") : t("badcase") }),
          entry.rubricCalibration?.status !== "current" ? /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("span", { className: "rolling-skill-badge", children: t("caseNeedsCalibration") }) : null,
          /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("strong", { children: entry.question }),
          /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("p", { children: entry.answer })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("div", { className: "rolling-skill-actions", children: [
          /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(import_dsh_client_ui_primitives4.Button, { variant: "ghost", size: "sm", onClick: () => void inspect(entry), children: t("details") }),
          /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(import_dsh_client_ui_primitives4.Button, { variant: "ghost", size: "sm", disabled: busy, onClick: () => void refreshOne(entry), children: t("refreshCase") }),
          entry.rubricCalibration?.status !== "current" ? /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(import_dsh_client_ui_primitives4.Button, { variant: "ghost", size: "sm", disabled: busy, onClick: () => void calibrate(entry), children: t("calibrateCase") }) : null,
          /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(import_dsh_client_ui_primitives4.Button, { variant: "ghost", size: "sm", disabled: busy, onClick: () => setDeleting(entry), children: t("delete") })
        ] })
      ] }, entry.id)),
      entries.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("p", { children: t("emptyCases") }) : null
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("div", { className: "rolling-skill-pagination", "aria-label": t("casePages"), children: [
      /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(import_dsh_client_ui_primitives4.Button, { variant: "ghost", size: "sm", disabled: page <= 1, onClick: () => setPage((value) => value - 1), children: t("previousPage") }),
      /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("span", { children: t("pageStatus").replace("{page}", String(pageResult.page)).replace("{pages}", String(pageResult.pageCount || 1)).replace("{total}", String(pageResult.total)) }),
      /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(import_dsh_client_ui_primitives4.Button, { variant: "ghost", size: "sm", disabled: pageResult.pageCount === 0 || page >= pageResult.pageCount, onClick: () => setPage((value) => value + 1), children: t("nextPage") })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(import_dsh_client_ui_primitives4.Modal, { open: detail !== null, onClose: () => setDetail(null), title: t("caseDetailTitle"), closeLabel: t("close"), footer: /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(import_dsh_client_ui_primitives4.Button, { variant: "outline", onClick: () => setDetail(null), children: t("close") }), children: detail ? /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("div", { className: "rolling-skill-detail-stack", children: [
      /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("span", { className: "rolling-skill-badge", children: detail.caseType === "goodcase" ? t("goodcase") : t("badcase") }),
      /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("h4", { children: t("question") }),
      /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("p", { className: "rolling-skill-verbatim", children: detail.question }),
      /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("h4", { children: t("caseAnswer") }),
      /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("p", { children: detail.answer }),
      detail.issueDescription ? /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)(import_jsx_runtime6.Fragment, { children: [
        /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("h4", { children: t("caseIssue") }),
        /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("p", { children: detail.issueDescription })
      ] }) : null,
      /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("h4", { children: t("caseEvidence") }),
      /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("pre", { children: JSON.stringify({ rubric: detail.rubric ?? null, operationEvidence: detail.operationEvidence ?? null, source: detail.episode?.source ?? null }, null, 2) })
    ] }) : null }),
    /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)(import_dsh_client_ui_primitives4.Modal, { open: deleting !== null, onClose: () => setDeleting(null), title: t("deleteCaseTitle"), closeLabel: t("cancel"), footer: /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)(import_jsx_runtime6.Fragment, { children: [
      /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(import_dsh_client_ui_primitives4.Button, { variant: "outline", onClick: () => setDeleting(null), children: t("cancel") }),
      /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(import_dsh_client_ui_primitives4.Button, { variant: "outline", disabled: busy, onClick: remove, children: t("confirmDelete") })
    ] }), children: [
      /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("p", { children: t("deleteRecoveryPrompt") }),
      /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("label", { className: "rolling-skill-check", children: [
        /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("input", { type: "checkbox", checked: recoverQuestions, onChange: (event) => setRecoverQuestions(event.target.checked) }),
        /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("span", { children: t("recoverToRawCases") })
      ] })
    ] })
  ] });
}

// src/client/workbench/DatasetsPanel.tsx
var import_dsh_client_ui_primitives5 = require("@deepseek-ai/dsh-client-ui-primitives");
var import_react6 = require("react");
var import_jsx_runtime7 = require("react/jsx-runtime");
function DatasetsPanel({ t, onChanged }) {
  const [datasets, setDatasets] = (0, import_react6.useState)([]);
  const [catalog, setCatalog] = (0, import_react6.useState)({ repositories: [], skills: [] });
  const [name, setName] = (0, import_react6.useState)("");
  const [skillId, setSkillId] = (0, import_react6.useState)("");
  const [deleting, setDeleting] = (0, import_react6.useState)(null);
  const [binding, setBinding] = (0, import_react6.useState)(null);
  const [bindingSkillId, setBindingSkillId] = (0, import_react6.useState)("");
  const [recoverQuestions, setRecoverQuestions] = (0, import_react6.useState)(true);
  const [busy, setBusy] = (0, import_react6.useState)(false);
  const [error, setError] = (0, import_react6.useState)(null);
  const [revision, setRevision] = (0, import_react6.useState)(0);
  (0, import_react6.useEffect)(() => {
    const controller = new AbortController();
    Promise.all([
      requestRollingSkill("datasets.list", {}, controller.signal),
      requestRollingSkill("skills.catalog", {}, controller.signal)
    ]).then(([datasetItems, nextCatalog]) => {
      setDatasets(datasetItems);
      setCatalog(nextCatalog);
      const validSkills = nextCatalog.skills.filter((skill) => skill.status === "valid");
      setSkillId((current) => validSkills.some((skill) => skill.id === current) ? current : validSkills[0]?.id ?? "");
    }).catch((reason) => {
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
    const selectedSkill = catalog.skills.find((skill) => skill.id === skillId);
    if (!selectedSkill) throw new Error(t("noManagedSkills"));
    await requestRollingSkill("datasets.create", {
      name,
      repositoryId: selectedSkill.repositoryId,
      skillId: selectedSkill.id
    });
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
  const beginBinding = (dataset) => {
    const validSkills = catalog.skills.filter((skill) => skill.status === "valid");
    setBinding(dataset);
    setBindingSkillId(validSkills.some((skill) => skill.id === dataset.skillReference?.id) ? dataset.skillReference?.id ?? "" : validSkills[0]?.id ?? "");
  };
  const bindSkill = () => {
    const dataset = binding;
    const selectedSkill = catalog.skills.find((skill) => skill.id === bindingSkillId);
    if (!dataset || !selectedSkill) return;
    void mutate(async () => {
      await requestRollingSkill("datasets.bindSkill", {
        datasetId: dataset.id,
        repositoryId: selectedSkill.repositoryId,
        skillId: selectedSkill.id,
        expectedCreatedAt: dataset.createdAt,
        idempotencyKey: crypto.randomUUID()
      });
      setBinding(null);
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
  return /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("section", { className: "rolling-skill-panel rolling-skill-data-panel", children: [
    /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("div", { className: "rolling-skill-panel-header", children: [
      /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("div", { children: [
        /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("h3", { children: t("datasetsTitle") }),
        /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("p", { children: t("datasetsDescription") })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(import_dsh_client_ui_primitives5.Button, { variant: "ghost", size: "sm", onClick: reload, children: t("refresh") })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("div", { className: "rolling-skill-form-row", children: [
      /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(
        import_dsh_client_ui_primitives5.Input,
        {
          value: name,
          placeholder: t("datasetName"),
          "aria-label": t("datasetName"),
          onChange: (event) => setName(event.target.value)
        }
      ),
      /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(
        "select",
        {
          className: "rolling-skill-select",
          "aria-label": t("datasetSkill"),
          value: skillId,
          onChange: (event) => setSkillId(event.target.value),
          children: catalog.skills.filter((skill) => skill.status === "valid").map((skill) => {
            const repository = catalog.repositories.find((entry) => entry.id === skill.repositoryId);
            return /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("option", { value: skill.id, children: [
              skill.name,
              " \xB7 ",
              repository?.displayName ?? skill.repositoryId
            ] }, skill.id);
          })
        }
      ),
      /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(import_dsh_client_ui_primitives5.Button, { variant: "outline", size: "sm", disabled: busy || !name.trim() || !skillId, onClick: create, children: t("createDataset") })
    ] }),
    error ? /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("p", { className: "rolling-skill-inline-error", role: "alert", children: error }) : null,
    /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("div", { className: "rolling-skill-list", children: [
      datasets.map((dataset) => /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("article", { className: "rolling-skill-list-row", children: [
        /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("div", { children: [
          /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("strong", { children: dataset.name }),
          /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("span", { children: dataset.skillReference?.evidencePrecision === "managed" ? `${t("datasetSkill")}: ${dataset.skillReference.name}` : t("unboundManagedSkill") }),
          /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("span", { children: t("caseBreakdown").replace("{all}", String(dataset.caseCount)).replace("{good}", String(dataset.goodcaseCount)).replace("{bad}", String(dataset.badcaseCount)) })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("div", { className: "rolling-skill-actions", children: [
          /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(import_dsh_client_ui_primitives5.Button, { variant: "ghost", size: "sm", onClick: () => beginBinding(dataset), children: t("changeManagedSkill") }),
          /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(import_dsh_client_ui_primitives5.Button, { variant: "ghost", size: "sm", onClick: () => void exportCsv(dataset.id), children: t("exportCsv") }),
          /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(import_dsh_client_ui_primitives5.Button, { variant: "ghost", size: "sm", onClick: () => setDeleting(dataset), children: t("delete") })
        ] })
      ] }, dataset.id)),
      datasets.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("p", { children: t("emptyDatasets") }) : null
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)(
      import_dsh_client_ui_primitives5.Modal,
      {
        open: deleting !== null,
        onClose: () => setDeleting(null),
        title: t("deleteDatasetTitle"),
        closeLabel: t("cancel"),
        footer: /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)(import_jsx_runtime7.Fragment, { children: [
          /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(import_dsh_client_ui_primitives5.Button, { variant: "outline", onClick: () => setDeleting(null), children: t("cancel") }),
          /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(import_dsh_client_ui_primitives5.Button, { variant: "outline", disabled: busy, onClick: remove, children: t("confirmDelete") })
        ] }),
        children: [
          /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("p", { children: t("deleteRecoveryPrompt") }),
          /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("label", { className: "rolling-skill-check", children: [
            /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("input", { type: "checkbox", checked: recoverQuestions, onChange: (event) => setRecoverQuestions(event.target.checked) }),
            /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("span", { children: t("recoverToRawCases") })
          ] })
        ]
      }
    ),
    /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)(
      import_dsh_client_ui_primitives5.Modal,
      {
        open: binding !== null,
        onClose: () => setBinding(null),
        title: t("bindManagedSkillTitle"),
        closeLabel: t("cancel"),
        footer: /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)(import_jsx_runtime7.Fragment, { children: [
          /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(import_dsh_client_ui_primitives5.Button, { variant: "outline", onClick: () => setBinding(null), children: t("cancel") }),
          /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(import_dsh_client_ui_primitives5.Button, { variant: "outline", disabled: busy || !bindingSkillId, onClick: bindSkill, children: t("save") })
        ] }),
        children: [
          /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("p", { children: t("bindManagedSkillDescription") }),
          /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("select", { className: "rolling-skill-select", value: bindingSkillId, onChange: (event) => setBindingSkillId(event.target.value), children: catalog.skills.filter((skill) => skill.status === "valid").map((skill) => {
            const repository = catalog.repositories.find((entry) => entry.id === skill.repositoryId);
            return /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("option", { value: skill.id, children: [
              skill.name,
              " \xB7 ",
              repository?.displayName ?? skill.repositoryId
            ] }, skill.id);
          }) })
        ]
      }
    )
  ] });
}

// src/client/workbench/EvaluationsPanel.tsx
var import_dsh_client_ui_primitives6 = require("@deepseek-ai/dsh-client-ui-primitives");
var import_react7 = require("react");
var import_jsx_runtime8 = require("react/jsx-runtime");
function EvaluationsPanel({ t, initialRunId }) {
  const [runtimes, setRuntimes] = (0, import_react7.useState)([]);
  const [datasets, setDatasets] = (0, import_react7.useState)([]);
  const [runs, setRuns] = (0, import_react7.useState)([]);
  const [targetRuntimeId, setTargetRuntimeId] = (0, import_react7.useState)("");
  const [targetRuntimeIds, setTargetRuntimeIds] = (0, import_react7.useState)([]);
  const [judgeRuntimeId, setJudgeRuntimeId] = (0, import_react7.useState)("");
  const [datasetId, setDatasetId] = (0, import_react7.useState)("");
  const [versions, setVersions] = (0, import_react7.useState)([]);
  const [versionId, setVersionId] = (0, import_react7.useState)("");
  const [installations, setInstallations] = (0, import_react7.useState)([]);
  const [targetModels, setTargetModels] = (0, import_react7.useState)([]);
  const [judgeModels, setJudgeModels] = (0, import_react7.useState)([]);
  const [targetModelId, setTargetModelId] = (0, import_react7.useState)("");
  const [judgeModelId, setJudgeModelId] = (0, import_react7.useState)("");
  const [effort, setEffort] = (0, import_react7.useState)("high");
  const [judgeEffort, setJudgeEffort] = (0, import_react7.useState)("high");
  const [activationMode, setActivationMode] = (0, import_react7.useState)("explicit");
  const [caseScope, setCaseScope] = (0, import_react7.useState)("all");
  const [caseIds, setCaseIds] = (0, import_react7.useState)([]);
  const [detail, setDetail] = (0, import_react7.useState)(null);
  const [busy, setBusy] = (0, import_react7.useState)(false);
  const [error, setError] = (0, import_react7.useState)(null);
  const [revision, setRevision] = (0, import_react7.useState)(0);
  (0, import_react7.useEffect)(() => {
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
      setTargetRuntimeIds((current) => current.length ? current : runtimeItems[0]?.runtimeId ? [runtimeItems[0].runtimeId] : []);
      setJudgeRuntimeId((current) => current || runtimeItems[0]?.runtimeId || "");
      setDatasetId((current) => current || datasetItems[0]?.id || "");
      if (initialRunId) void inspect(initialRunId);
    }).catch((reason) => {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : t("loadError"));
    });
    return () => controller.abort();
  }, [revision, initialRunId]);
  const selectedDataset = (0, import_react7.useMemo)(
    () => datasets.find((dataset) => dataset.id === datasetId) ?? null,
    [datasets, datasetId]
  );
  (0, import_react7.useEffect)(() => {
    const skillId = selectedDataset?.skillReference?.evidencePrecision === "managed" ? selectedDataset.skillReference.id : null;
    if (!skillId) {
      setVersions([]);
      setVersionId("");
      setInstallations([]);
      return;
    }
    const controller = new AbortController();
    Promise.all([
      requestRollingSkill("skills.versions", {
        skillIds: [skillId],
        skillId,
        limit: 100
      }, controller.signal),
      requestRollingSkill("installations.list", { skillId }, controller.signal)
    ]).then(([page, overview]) => {
      const released = page.versions.filter(
        (version) => version.state === "released" && !version.deprecatedAt
      );
      setVersions(released);
      setVersionId((current) => released.some((version) => version.id === current) ? current : released[0]?.id ?? "");
      setInstallations(overview.matrix);
    }).catch((reason) => {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : t("loadError"));
    });
    return () => controller.abort();
  }, [selectedDataset, revision]);
  (0, import_react7.useEffect)(() => {
    if (!datasetId) return;
    const controller = new AbortController();
    requestRollingSkill("cases.list", { datasetId, caseScope, pageSize: 200 }, controller.signal).then((page) => setCaseIds(page.items.map((entry) => entry.id))).catch((reason) => {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : t("loadError"));
    });
    return () => controller.abort();
  }, [datasetId, caseScope, revision]);
  (0, import_react7.useEffect)(() => {
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
  (0, import_react7.useEffect)(() => {
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
  const selectedInstallations = targetRuntimeIds.map((selectedRuntimeId) => installations.find(
    (installation) => installation.runtimeId === selectedRuntimeId && installation.versionId === versionId && installation.verification !== "none"
  ) ?? null);
  const installationsReady = targetRuntimeIds.length > 0 && selectedInstallations.every(Boolean);
  const start = () => mutate(() => requestRollingSkill("evaluations.start", {
    datasetId,
    versionId,
    caseIds: caseScope === "all" ? [] : caseIds,
    selectionMode: caseScope === "all" ? "dataset" : "selected",
    activationMode,
    targets: targetRuntimeIds.map((runtimeId) => ({ runtimeId, modelId: runtimeId === targetRuntimeId ? targetModelId || null : null, effort })),
    judge: { runtimeId: judgeRuntimeId, modelId: judgeModelId || null, effort: judgeEffort }
  }));
  const inspect = async (runId) => {
    setError(null);
    try {
      setDetail(await requestRollingSkill("evaluations.get", { runId }));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t("loadError"));
    }
  };
  (0, import_react7.useEffect)(() => {
    if (!runs.some((run) => ["queued", "running"].includes(run.status))) return;
    const timer = window.setInterval(() => setRevision((value) => value + 1), 1500);
    return () => window.clearInterval(timer);
  }, [runs]);
  return /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)("div", { className: "rolling-skill-data-stack", children: [
    /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)("section", { className: "rolling-skill-panel", children: [
      /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("div", { className: "rolling-skill-panel-header", children: /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)("div", { children: [
        /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("h3", { children: t("evaluationStartTitle") }),
        /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("p", { children: t("evaluationStartDescription") })
      ] }) }),
      /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)("label", { className: "rolling-skill-field", children: [
        /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("span", { children: t("selectDataset") }),
        /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("select", { className: "rolling-skill-select", value: datasetId, onChange: (event) => setDatasetId(event.target.value), children: datasets.map((dataset) => /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)("option", { value: dataset.id, children: [
          dataset.name,
          " \xB7 ",
          dataset.caseCount
        ] }, dataset.id)) })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)("label", { className: "rolling-skill-field", children: [
        /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("span", { children: t("evaluationVersion") }),
        /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("select", { className: "rolling-skill-select", value: versionId, onChange: (event) => setVersionId(event.target.value), children: versions.map((version) => /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("option", { value: version.id, children: version.versionLabel ?? version.id }, version.id)) })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)("label", { className: "rolling-skill-field", children: [
        /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("span", { children: t("evaluationCaseScope") }),
        /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)("select", { className: "rolling-skill-select", value: caseScope, onChange: (event) => setCaseScope(event.target.value), children: [
          /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("option", { value: "all", children: t("allCases") }),
          /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("option", { value: "goodcase", children: t("goodcase") }),
          /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("option", { value: "badcase", children: t("badcase") })
        ] })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)("label", { className: "rolling-skill-field", children: [
        /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("span", { children: t("activationMode") }),
        /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)("select", { className: "rolling-skill-select", value: activationMode, onChange: (event) => setActivationMode(event.target.value), children: [
          /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("option", { value: "explicit", children: t("explicitActivation") }),
          /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("option", { value: "automatic", children: t("automaticActivation") })
        ] })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(EvaluationRuntimeMatrix, { t, runtimes, values: targetRuntimeIds, primary: targetRuntimeId, onChange: (values) => {
        setTargetRuntimeIds(values);
        setTargetRuntimeId((current) => values.includes(current) ? current : values[0] ?? "");
      }, onPrimary: setTargetRuntimeId }),
      /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("p", { className: installationsReady ? "rolling-skill-inline-success" : "rolling-skill-inline-error", children: installationsReady ? t("installationReady") : t("installationMissing") }),
      /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)("div", { className: "rolling-skill-grid", children: [
        /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)("label", { className: "rolling-skill-field", children: [
          /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("span", { children: t("model") }),
          /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("select", { className: "rolling-skill-select", value: targetModelId, onChange: (event) => setTargetModelId(event.target.value), children: targetModels.map((model) => {
            const id = model.id ?? model.model ?? "";
            return /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("option", { value: id, children: model.displayName ?? id }, id);
          }) })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)("label", { className: "rolling-skill-field", children: [
          /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("span", { children: t("effort") }),
          /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("select", { className: "rolling-skill-select", value: effort, onChange: (event) => setEffort(event.target.value), children: ["low", "medium", "high", "xhigh", "max"].map((item) => /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("option", { value: item, children: item }, item)) })
        ] })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(RuntimeSelect, { t, runtimes, value: judgeRuntimeId, onChange: setJudgeRuntimeId, label: t("judgeRuntime") }),
      /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)("div", { className: "rolling-skill-grid", children: [
        /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)("label", { className: "rolling-skill-field", children: [
          /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("span", { children: t("judgeModel") }),
          /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("select", { className: "rolling-skill-select", value: judgeModelId, onChange: (event) => setJudgeModelId(event.target.value), children: judgeModels.map((model) => {
            const id = model.id ?? model.model ?? "";
            return /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("option", { value: id, children: model.displayName ?? id }, id);
          }) })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)("label", { className: "rolling-skill-field", children: [
          /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("span", { children: t("effort") }),
          /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("select", { className: "rolling-skill-select", value: judgeEffort, onChange: (event) => setJudgeEffort(event.target.value), children: ["low", "medium", "high", "xhigh", "max"].map((item) => /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("option", { value: item, children: item }, item)) })
        ] })
      ] }),
      error ? /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("p", { className: "rolling-skill-inline-error", role: "alert", children: error }) : null,
      /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(import_dsh_client_ui_primitives6.Button, { variant: "outline", disabled: busy || !datasetId || !versionId || !targetRuntimeId || !judgeRuntimeId || !installationsReady || caseScope !== "all" && caseIds.length === 0, onClick: () => void start(), children: t("startEvaluation") })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)("section", { className: "rolling-skill-panel", children: [
      /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)("div", { className: "rolling-skill-panel-header", children: [
        /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("div", { children: /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("h3", { children: t("evaluationRuns") }) }),
        /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(import_dsh_client_ui_primitives6.Button, { variant: "ghost", size: "sm", onClick: () => setRevision((value) => value + 1), children: t("refresh") })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)("div", { className: "rolling-skill-list", children: [
        runs.map((run) => /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)("article", { className: "rolling-skill-list-row", children: [
          /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)("div", { children: [
            /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("strong", { children: run.status }),
            /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)("span", { children: [
              run.id,
              " \xB7 ",
              run.caseCount ?? 0,
              " Cases \xB7 ",
              run.runtimeCount ?? 0,
              " Runtimes"
            ] })
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)("div", { className: "rolling-skill-actions", children: [
            /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(import_dsh_client_ui_primitives6.Button, { variant: "ghost", size: "sm", onClick: () => void inspect(run.id), children: t("details") }),
            ["queued", "running"].includes(run.status) ? /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(import_dsh_client_ui_primitives6.Button, { variant: "ghost", size: "sm", disabled: busy, onClick: () => void mutate(() => requestRollingSkill("evaluations.cancel", { runId: run.id })), children: t("cancelRun") }) : /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(import_dsh_client_ui_primitives6.Button, { variant: "ghost", size: "sm", disabled: busy, onClick: () => {
              if (window.confirm(t("deleteEvaluationConfirm"))) void mutate(() => requestRollingSkill("evaluations.delete", { runId: run.id }));
            }, children: t("delete") })
          ] })
        ] }, run.id)),
        runs.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("p", { children: t("emptyEvaluations") }) : null
      ] })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(import_dsh_client_ui_primitives6.Modal, { open: detail !== null, onClose: () => setDetail(null), title: t("evaluationDetail"), closeLabel: t("cancel"), footer: /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(import_dsh_client_ui_primitives6.Button, { variant: "outline", onClick: () => setDetail(null), children: t("close") }), children: detail ? /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)("div", { className: "rolling-skill-detail-stack", children: [
      /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("pre", { children: JSON.stringify({ skillEvidence: detail.skillEvidence, runtimeConfigurations: detail.runtimeConfigurations, judgeConfiguration: detail.judgeConfiguration }, null, 2) }),
      /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("div", { className: "rolling-skill-list", children: detail.results.map((result) => /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("article", { className: "rolling-skill-list-row", children: /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)("div", { children: [
        /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)("strong", { children: [
          result.computedScore?.totalScore ?? t("notAvailable"),
          " \xB7 ",
          result.status,
          " / ",
          result.gradingStatus ?? t("notAvailable")
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("span", { className: "rolling-skill-verbatim", children: result.question }),
        /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("span", { children: result.response || result.error || result.gradingError || result.id }),
        /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("small", { children: result.durationMs !== void 0 ? `${result.durationMs} ms` : "" }),
        /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("pre", { children: JSON.stringify({ computedScore: result.computedScore ?? null, judgment: result.judgment ?? null, traceEvidence: result.traceEvidence ?? null }, null, 2) })
      ] }) }, result.id)) })
    ] }) : null })
  ] });
}
function EvaluationRuntimeMatrix({ t, runtimes, values, primary, onChange, onPrimary }) {
  return /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)("fieldset", { className: "rolling-skill-runtime-select", children: [
    /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("legend", { children: t("evaluationRuntime") }),
    /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)("div", { className: "rolling-skill-runtime-list", children: [
      runtimes.map((runtime) => /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)("label", { className: "rolling-skill-runtime-option", children: [
        /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("input", { type: "checkbox", checked: values.includes(runtime.runtimeId), onChange: (event) => onChange(event.target.checked ? [...values, runtime.runtimeId] : values.filter((value) => value !== runtime.runtimeId)) }),
        /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)("span", { children: [
          /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)("strong", { children: [
            runtime.displayName,
            " ",
            runtime.version
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("code", { children: runtime.executablePath }),
          values.includes(runtime.runtimeId) ? /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("button", { type: "button", className: "rolling-skill-link-button", "aria-pressed": primary === runtime.runtimeId, onClick: (event) => {
            event.preventDefault();
            onPrimary(runtime.runtimeId);
          }, children: primary === runtime.runtimeId ? t("primaryRuntime") : t("makePrimaryRuntime") }) : null
        ] })
      ] }, runtime.runtimeId)),
      runtimes.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("p", { children: t("noRuntimes") }) : null
    ] })
  ] });
}

// src/client/workbench/ImportPanel.tsx
var import_dsh_client_ui_primitives7 = require("@deepseek-ai/dsh-client-ui-primitives");
var import_react8 = require("react");
var import_jsx_runtime9 = require("react/jsx-runtime");
function ImportPanel({ t }) {
  const [state, setState] = (0, import_react8.useState)({ kind: "loading" });
  const [confirming, setConfirming] = (0, import_react8.useState)(false);
  const [busy, setBusy] = (0, import_react8.useState)(false);
  const [imported, setImported] = (0, import_react8.useState)(false);
  const [revision, setRevision] = (0, import_react8.useState)(0);
  (0, import_react8.useEffect)(() => {
    const controller = new AbortController();
    setState({ kind: "loading" });
    requestRollingSkill("legacyImport.status", {}, controller.signal).then((value) => setState({ kind: "ready", value })).catch((reason) => {
      if (controller.signal.aborted) return;
      setState({ kind: "error", message: reason instanceof Error ? reason.message : t("loadError") });
    });
    return () => controller.abort();
  }, [revision]);
  const runImport = async () => {
    setBusy(true);
    try {
      await requestRollingSkill("legacyImport.run", { confirmed: true });
      setImported(true);
      setConfirming(false);
      setRevision((value) => value + 1);
    } catch (reason) {
      setState({ kind: "error", message: reason instanceof Error ? reason.message : t("loadError") });
    } finally {
      setBusy(false);
    }
  };
  return /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("div", { className: "rolling-skill-data-stack", children: /* @__PURE__ */ (0, import_jsx_runtime9.jsxs)("section", { className: "rolling-skill-panel", children: [
    /* @__PURE__ */ (0, import_jsx_runtime9.jsxs)("div", { className: "rolling-skill-panel-header", children: [
      /* @__PURE__ */ (0, import_jsx_runtime9.jsxs)("div", { children: [
        /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("h3", { children: t("legacyImportTitle") }),
        /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("p", { children: t("legacyImportDescription") })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime9.jsx)(import_dsh_client_ui_primitives7.Button, { variant: "ghost", size: "sm", disabled: busy, onClick: () => setRevision((value) => value + 1), children: t("refresh") })
    ] }),
    state.kind === "loading" ? /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("p", { children: t("loading") }) : state.kind === "error" ? /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("p", { className: "rolling-skill-inline-error", role: "alert", children: state.message }) : /* @__PURE__ */ (0, import_jsx_runtime9.jsxs)(import_jsx_runtime9.Fragment, { children: [
      /* @__PURE__ */ (0, import_jsx_runtime9.jsxs)("dl", { children: [
        /* @__PURE__ */ (0, import_jsx_runtime9.jsxs)("div", { children: [
          /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("dt", { children: t("legacySource") }),
          /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("dd", { children: /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("code", { children: state.value.sourceRoot }) })
        ] }),
        state.value.destinationRoot ? /* @__PURE__ */ (0, import_jsx_runtime9.jsxs)("div", { children: [
          /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("dt", { children: t("legacyDestination") }),
          /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("dd", { children: /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("code", { children: state.value.destinationRoot }) })
        ] }) : null
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("p", { className: "rolling-skill-help", children: t("legacyCopyOnly") }),
      imported || state.value.status === "already-imported" ? /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("p", { children: t("legacyImportedRestart") }) : state.value.status === "not-found" ? /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("p", { children: t("legacyNotFound") }) : state.value.status === "blocked" ? /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("p", { className: "rolling-skill-inline-error", children: state.value.error ?? t("legacyBlocked") }) : confirming ? /* @__PURE__ */ (0, import_jsx_runtime9.jsxs)("div", { className: "rolling-skill-confirm", children: [
        /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("p", { children: t("legacyConfirmPrompt") }),
        /* @__PURE__ */ (0, import_jsx_runtime9.jsxs)("div", { className: "rolling-skill-actions", children: [
          /* @__PURE__ */ (0, import_jsx_runtime9.jsx)(import_dsh_client_ui_primitives7.Button, { variant: "ghost", disabled: busy, onClick: () => setConfirming(false), children: t("cancel") }),
          /* @__PURE__ */ (0, import_jsx_runtime9.jsx)(import_dsh_client_ui_primitives7.Button, { variant: "outline", disabled: busy, onClick: () => void runImport(), children: t("confirmImport") })
        ] })
      ] }) : /* @__PURE__ */ (0, import_jsx_runtime9.jsx)(import_dsh_client_ui_primitives7.Button, { variant: "outline", disabled: busy || !state.value.available, onClick: () => setConfirming(true), children: t("startImport") })
    ] })
  ] }) });
}

// src/client/workbench/OperatorPanel.tsx
var import_dsh_client_ui_primitives9 = require("@deepseek-ai/dsh-client-ui-primitives");
var import_react10 = require("react");

// src/client/workbench/RuntimeInteractions.tsx
var import_dsh_client_ui_primitives8 = require("@deepseek-ai/dsh-client-ui-primitives");
var import_react9 = require("react");
var import_jsx_runtime10 = require("react/jsx-runtime");
function RuntimeInteractions({
  t,
  ownerKind,
  ownerId
}) {
  const [items, setItems] = (0, import_react9.useState)([]);
  const [answers, setAnswers] = (0, import_react9.useState)({});
  const [busyId, setBusyId] = (0, import_react9.useState)(null);
  const [error, setError] = (0, import_react9.useState)(null);
  const [revision, setRevision] = (0, import_react9.useState)(0);
  (0, import_react9.useEffect)(() => {
    const controller = new AbortController();
    requestRollingSkill("interactions.list", {
      ownerKind,
      ...ownerId ? { ownerId } : {}
    }, controller.signal).then(setItems).catch((reason) => {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : t("loadError"));
    });
    return () => controller.abort();
  }, [ownerKind, ownerId, revision]);
  (0, import_react9.useEffect)(() => {
    const timer = window.setInterval(() => setRevision((value) => value + 1), 1500);
    return () => window.clearInterval(timer);
  }, []);
  const resolve = async (interaction, input) => {
    setBusyId(interaction.id);
    setError(null);
    try {
      await requestRollingSkill("interactions.resolve", { interactionId: interaction.id, ...input });
      setRevision((value) => value + 1);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t("loadError"));
    } finally {
      setBusyId(null);
    }
  };
  if (!items.length && !error) return null;
  return /* @__PURE__ */ (0, import_jsx_runtime10.jsxs)("section", { className: "rolling-skill-subpanel rolling-skill-section-gap", children: [
    /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("h4", { children: t("runtimeInteractions") }),
    error ? /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("p", { className: "rolling-skill-inline-error", role: "alert", children: error }) : null,
    /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("div", { className: "rolling-skill-list", children: items.map((interaction) => /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("article", { className: "rolling-skill-list-row", children: /* @__PURE__ */ (0, import_jsx_runtime10.jsxs)("div", { children: [
      /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("strong", { children: interaction.kind === "permission" ? t("runtimePermissionRequest") : t("runtimeQuestionRequest") }),
      /* @__PURE__ */ (0, import_jsx_runtime10.jsxs)("span", { children: [
        interaction.runtime?.displayName ?? interaction.ownerId,
        " ",
        interaction.runtime?.version ?? "",
        " \xB7 ",
        interaction.jobId ?? interaction.ownerId
      ] }),
      interaction.kind === "permission" ? /* @__PURE__ */ (0, import_jsx_runtime10.jsxs)("div", { className: "rolling-skill-actions", children: [
        (interaction.options ?? []).map((option) => {
          const decision = option.optionId ?? option.id ?? option.value ?? "";
          return /* @__PURE__ */ (0, import_jsx_runtime10.jsx)(import_dsh_client_ui_primitives8.Button, { variant: "outline", size: "sm", disabled: busyId === interaction.id || !decision, onClick: () => void resolve(interaction, { decision }), children: option.label ?? option.name ?? decision }, decision);
        }),
        /* @__PURE__ */ (0, import_jsx_runtime10.jsx)(import_dsh_client_ui_primitives8.Button, { variant: "ghost", size: "sm", disabled: busyId === interaction.id, onClick: () => void resolve(interaction, { decision: "decline" }), children: t("reject") })
      ] }) : /* @__PURE__ */ (0, import_jsx_runtime10.jsxs)("div", { className: "rolling-skill-detail-stack", children: [
        (interaction.questions ?? []).map((question, index) => {
          const questionId = question.id ?? question.questionId ?? `question-${index}`;
          const key = `${interaction.id}:${questionId}`;
          return /* @__PURE__ */ (0, import_jsx_runtime10.jsxs)("label", { className: "rolling-skill-field", children: [
            /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("span", { children: question.prompt ?? question.question ?? questionId }),
            /* @__PURE__ */ (0, import_jsx_runtime10.jsx)(import_dsh_client_ui_primitives8.Input, { value: answers[key] ?? "", onChange: (event) => setAnswers((current) => ({ ...current, [key]: event.target.value })) })
          ] }, questionId);
        }),
        /* @__PURE__ */ (0, import_jsx_runtime10.jsx)(import_dsh_client_ui_primitives8.Button, { variant: "outline", size: "sm", disabled: busyId === interaction.id, onClick: () => void resolve(interaction, { answers: (interaction.questions ?? []).map((question, index) => {
          const questionId = question.id ?? question.questionId ?? `question-${index}`;
          return { questionId, answer: answers[`${interaction.id}:${questionId}`] ?? "" };
        }) }), children: t("submitAnswers") })
      ] })
    ] }) }, interaction.id)) })
  ] });
}

// src/client/workbench/OperatorPanel.tsx
var import_jsx_runtime11 = require("react/jsx-runtime");
function OperatorPanel({ t, initialSessionId }) {
  const [runtimes, setRuntimes] = (0, import_react10.useState)([]);
  const [runtimeId, setRuntimeId] = (0, import_react10.useState)("");
  const [models, setModels] = (0, import_react10.useState)([]);
  const [modelId, setModelId] = (0, import_react10.useState)("");
  const [effort, setEffort] = (0, import_react10.useState)("high");
  const [objective, setObjective] = (0, import_react10.useState)("");
  const [datasets, setDatasets] = (0, import_react10.useState)([]);
  const [catalog, setCatalog] = (0, import_react10.useState)({ skills: [], repositories: [] });
  const [summary, setSummary] = (0, import_react10.useState)({
    sessions: [],
    jobs: [],
    approvals: [],
    totals: { sessions: 0, jobs: 0, approvals: 0 }
  });
  const [detail, setDetail] = (0, import_react10.useState)(null);
  const [artifacts, setArtifacts] = (0, import_react10.useState)([]);
  const [message, setMessage] = (0, import_react10.useState)("");
  const [busy, setBusy] = (0, import_react10.useState)(false);
  const [error, setError] = (0, import_react10.useState)(null);
  const [revision, setRevision] = (0, import_react10.useState)(0);
  (0, import_react10.useEffect)(() => {
    const controller = new AbortController();
    Promise.all([
      requestRollingSkill("runtimes.list", {}, controller.signal),
      requestRollingSkill("datasets.list", {}, controller.signal),
      requestRollingSkill("skills.catalog", {}, controller.signal),
      requestRollingSkill("operators.summary", { limit: 100 }, controller.signal)
    ]).then(([runtimeItems, datasetItems, nextCatalog, nextSummary]) => {
      setRuntimes(runtimeItems);
      setRuntimeId((current) => current || runtimeItems[0]?.runtimeId || "");
      setDatasets(datasetItems);
      setCatalog(nextCatalog);
      setSummary(nextSummary);
      if (initialSessionId) void inspect(initialSessionId);
    }).catch((reason) => {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : t("loadError"));
    });
    return () => controller.abort();
  }, [revision, initialSessionId]);
  (0, import_react10.useEffect)(() => {
    if (!runtimeId) return;
    const controller = new AbortController();
    requestRollingSkill("runtimes.models", { runtimeId }, controller.signal).then((items) => {
      setModels(items);
      setModelId((current) => current || items[0]?.id || items[0]?.model || "");
    }).catch((reason) => {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : t("loadError"));
    });
    return () => controller.abort();
  }, [runtimeId]);
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
  const start = () => mutate(() => requestRollingSkill("operators.start", {
    runtimeId,
    modelId: modelId || null,
    effort,
    objective,
    actions: [
      "raw_cases.read",
      "raw_cases.write",
      "runtimes.read",
      "datasets.read",
      "evaluations.read",
      "evaluations.execute",
      "skills.read",
      "approvals.resolve",
      "jobs.control",
      "optimizations.read",
      "optimizations.execute"
    ],
    scopes: {
      skillIds: catalog.skills.map((skill) => skill.id),
      datasetIds: datasets.map((dataset) => dataset.id),
      runtimeIds: runtimes.map((runtime) => runtime.runtimeId),
      repositoryIds: catalog.repositories.map((repository) => repository.id)
    },
    budget: {
      maxDurationMs: 60 * 60 * 1e3,
      maxRuntimeTurns: 100,
      maxEvaluations: 20,
      maxTargetExecutions: 200,
      maxJudgeExecutions: 40,
      maxTokens: null,
      maxReportedCost: null
    }
  }));
  const inspect = async (sessionId) => {
    setError(null);
    try {
      const next = await requestRollingSkill("operators.get", { sessionId });
      setDetail(next);
      setArtifacts(await requestRollingSkill("operators.artifacts", { jobId: next.parentJob.id }));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t("loadError"));
    }
  };
  const send = async () => {
    if (!detail || !message.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await requestRollingSkill("operators.send", { sessionId: detail.session.id, text: message });
      setMessage("");
      await inspect(detail.session.id);
      setRevision((value) => value + 1);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t("loadError"));
    } finally {
      setBusy(false);
    }
  };
  const parentJob = (sessionId) => summary.jobs.find((job) => job.sessionId === sessionId);
  const pendingApprovals = summary.approvals.filter((approval) => approval.status === "pending");
  (0, import_react10.useEffect)(() => {
    if (!summary.jobs.some((job) => !["cancelled", "failed", "succeeded"].includes(job.status))) return;
    const timer = window.setInterval(() => {
      setRevision((value) => value + 1);
      if (detail) void inspect(detail.session.id);
    }, 1500);
    return () => window.clearInterval(timer);
  }, [summary.jobs, detail?.session.id]);
  return /* @__PURE__ */ (0, import_jsx_runtime11.jsxs)("section", { className: "rolling-skill-panel", children: [
    /* @__PURE__ */ (0, import_jsx_runtime11.jsxs)("div", { className: "rolling-skill-panel-header", children: [
      /* @__PURE__ */ (0, import_jsx_runtime11.jsxs)("div", { children: [
        /* @__PURE__ */ (0, import_jsx_runtime11.jsx)("h3", { children: t("operatorTitle") }),
        /* @__PURE__ */ (0, import_jsx_runtime11.jsx)("p", { children: t("operatorDescription") })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime11.jsx)(import_dsh_client_ui_primitives9.Button, { variant: "ghost", size: "sm", onClick: () => setRevision((value) => value + 1), children: t("refresh") })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime11.jsx)(RuntimeSelect, { t, runtimes, value: runtimeId, onChange: setRuntimeId, label: t("operatorRuntime") }),
    /* @__PURE__ */ (0, import_jsx_runtime11.jsxs)("div", { className: "rolling-skill-grid", children: [
      /* @__PURE__ */ (0, import_jsx_runtime11.jsxs)("label", { className: "rolling-skill-field", children: [
        /* @__PURE__ */ (0, import_jsx_runtime11.jsx)("span", { children: t("model") }),
        /* @__PURE__ */ (0, import_jsx_runtime11.jsx)("select", { className: "rolling-skill-select", value: modelId, onChange: (event) => setModelId(event.target.value), children: models.map((model) => {
          const id = model.id ?? model.model ?? "";
          return /* @__PURE__ */ (0, import_jsx_runtime11.jsx)("option", { value: id, children: model.displayName ?? id }, id);
        }) })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime11.jsxs)("label", { className: "rolling-skill-field", children: [
        /* @__PURE__ */ (0, import_jsx_runtime11.jsx)("span", { children: t("effort") }),
        /* @__PURE__ */ (0, import_jsx_runtime11.jsx)("select", { className: "rolling-skill-select", value: effort, onChange: (event) => setEffort(event.target.value), children: ["low", "medium", "high", "xhigh", "max"].map((item) => /* @__PURE__ */ (0, import_jsx_runtime11.jsx)("option", { value: item, children: item }, item)) })
      ] })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime11.jsxs)("label", { className: "rolling-skill-field", children: [
      /* @__PURE__ */ (0, import_jsx_runtime11.jsx)("span", { children: t("operatorObjective") }),
      /* @__PURE__ */ (0, import_jsx_runtime11.jsx)(import_dsh_client_ui_primitives9.Input, { value: objective, placeholder: t("operatorObjectivePlaceholder"), onChange: (event) => setObjective(event.target.value) })
    ] }),
    error ? /* @__PURE__ */ (0, import_jsx_runtime11.jsx)("p", { className: "rolling-skill-inline-error", role: "alert", children: error }) : null,
    /* @__PURE__ */ (0, import_jsx_runtime11.jsx)(import_dsh_client_ui_primitives9.Button, { variant: "outline", disabled: busy || !runtimeId || !objective.trim(), onClick: () => void start(), children: t("startOperator") }),
    /* @__PURE__ */ (0, import_jsx_runtime11.jsxs)("div", { className: "rolling-skill-list rolling-skill-section-gap", children: [
      summary.sessions.map((session) => {
        const job = parentJob(session.id);
        return /* @__PURE__ */ (0, import_jsx_runtime11.jsxs)("article", { className: "rolling-skill-list-row", children: [
          /* @__PURE__ */ (0, import_jsx_runtime11.jsxs)("div", { children: [
            /* @__PURE__ */ (0, import_jsx_runtime11.jsx)("strong", { children: job?.status ?? t("notAvailable") }),
            /* @__PURE__ */ (0, import_jsx_runtime11.jsxs)("span", { children: [
              session.runtime.displayName,
              " ",
              session.runtime.version || "",
              " \xB7 ",
              session.modelId || session.id
            ] }),
            /* @__PURE__ */ (0, import_jsx_runtime11.jsx)("small", { children: job?.objective })
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime11.jsxs)("div", { className: "rolling-skill-actions", children: [
            /* @__PURE__ */ (0, import_jsx_runtime11.jsx)(import_dsh_client_ui_primitives9.Button, { variant: "ghost", size: "sm", onClick: () => void inspect(session.id), children: t("details") }),
            job?.status === "running" ? /* @__PURE__ */ (0, import_jsx_runtime11.jsx)(import_dsh_client_ui_primitives9.Button, { variant: "ghost", size: "sm", disabled: busy, onClick: () => void mutate(() => requestRollingSkill("operators.pause", { sessionId: session.id })), children: t("pause") }) : null,
            ["paused", "needs_recovery"].includes(job?.status ?? "") ? /* @__PURE__ */ (0, import_jsx_runtime11.jsx)(import_dsh_client_ui_primitives9.Button, { variant: "ghost", size: "sm", disabled: busy, onClick: () => void mutate(() => requestRollingSkill("operators.resume", { sessionId: session.id })), children: t("resume") }) : null,
            !["cancelled", "failed", "succeeded"].includes(job?.status ?? "") ? /* @__PURE__ */ (0, import_jsx_runtime11.jsx)(import_dsh_client_ui_primitives9.Button, { variant: "ghost", size: "sm", disabled: busy, onClick: () => void mutate(() => requestRollingSkill("operators.cancel", { sessionId: session.id })), children: t("cancelRun") }) : null
          ] })
        ] }, session.id);
      }),
      summary.sessions.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime11.jsx)("p", { children: t("emptyOperators") }) : null
    ] }),
    pendingApprovals.length ? /* @__PURE__ */ (0, import_jsx_runtime11.jsxs)("div", { className: "rolling-skill-subpanel rolling-skill-section-gap", children: [
      /* @__PURE__ */ (0, import_jsx_runtime11.jsx)("h4", { children: t("pendingApprovals") }),
      pendingApprovals.map((approval) => {
        const job = summary.jobs.find((item) => item.id === approval.jobId);
        return /* @__PURE__ */ (0, import_jsx_runtime11.jsxs)("article", { className: "rolling-skill-list-row", children: [
          /* @__PURE__ */ (0, import_jsx_runtime11.jsxs)("div", { children: [
            /* @__PURE__ */ (0, import_jsx_runtime11.jsx)("strong", { children: approval.action }),
            /* @__PURE__ */ (0, import_jsx_runtime11.jsx)("span", { children: approval.risk })
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime11.jsxs)("div", { className: "rolling-skill-actions", children: [
            /* @__PURE__ */ (0, import_jsx_runtime11.jsx)(import_dsh_client_ui_primitives9.Button, { variant: "outline", size: "sm", disabled: busy || !job, onClick: () => void mutate(() => requestRollingSkill("operators.approve", { sessionId: job?.sessionId, approvalId: approval.id, decision: "approve", scope: "once" })), children: t("approve") }),
            /* @__PURE__ */ (0, import_jsx_runtime11.jsx)(import_dsh_client_ui_primitives9.Button, { variant: "ghost", size: "sm", disabled: busy || !job, onClick: () => void mutate(() => requestRollingSkill("operators.approve", { sessionId: job?.sessionId, approvalId: approval.id, decision: "reject", scope: "once" })), children: t("reject") })
          ] })
        ] }, approval.id);
      })
    ] }) : null,
    /* @__PURE__ */ (0, import_jsx_runtime11.jsx)(RuntimeInteractions, { t, ownerKind: "operator" }),
    /* @__PURE__ */ (0, import_jsx_runtime11.jsx)(import_dsh_client_ui_primitives9.Modal, { open: detail !== null, onClose: () => setDetail(null), title: t("operatorDetail"), closeLabel: t("close"), footer: /* @__PURE__ */ (0, import_jsx_runtime11.jsx)(import_dsh_client_ui_primitives9.Button, { variant: "outline", onClick: () => setDetail(null), children: t("close") }), children: detail ? /* @__PURE__ */ (0, import_jsx_runtime11.jsxs)("div", { className: "rolling-skill-detail-stack", children: [
      /* @__PURE__ */ (0, import_jsx_runtime11.jsxs)("p", { children: [
        /* @__PURE__ */ (0, import_jsx_runtime11.jsx)("strong", { children: detail.state }),
        " \xB7 ",
        detail.session.runtime.displayName,
        " \xB7 ",
        detail.parentJob.objective
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime11.jsxs)("section", { className: "rolling-skill-subpanel", children: [
        /* @__PURE__ */ (0, import_jsx_runtime11.jsx)("h4", { children: t("operatorTranscript") }),
        /* @__PURE__ */ (0, import_jsx_runtime11.jsxs)("div", { className: "rolling-skill-list", children: [
          (detail.session.transcript ?? []).map((entry, index) => /* @__PURE__ */ (0, import_jsx_runtime11.jsx)("article", { className: "rolling-skill-list-row", children: /* @__PURE__ */ (0, import_jsx_runtime11.jsxs)("div", { children: [
            /* @__PURE__ */ (0, import_jsx_runtime11.jsx)("strong", { children: String(entry.kind ?? t("notAvailable")) }),
            /* @__PURE__ */ (0, import_jsx_runtime11.jsx)("pre", { children: JSON.stringify(entry, null, 2) })
          ] }) }, String(entry.id ?? index))),
          !detail.session.transcript?.length ? /* @__PURE__ */ (0, import_jsx_runtime11.jsx)("p", { children: t("emptyOperatorTranscript") }) : null
        ] })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime11.jsxs)("section", { className: "rolling-skill-subpanel", children: [
        /* @__PURE__ */ (0, import_jsx_runtime11.jsx)("h4", { children: t("operatorArtifacts") }),
        /* @__PURE__ */ (0, import_jsx_runtime11.jsxs)("div", { className: "rolling-skill-list", children: [
          artifacts.map((artifact) => /* @__PURE__ */ (0, import_jsx_runtime11.jsx)("article", { className: "rolling-skill-list-row", children: /* @__PURE__ */ (0, import_jsx_runtime11.jsxs)("div", { children: [
            /* @__PURE__ */ (0, import_jsx_runtime11.jsx)("strong", { children: artifact.name ?? artifact.id }),
            /* @__PURE__ */ (0, import_jsx_runtime11.jsxs)("span", { children: [
              artifact.mediaType ?? "",
              " ",
              artifact.byteLength === void 0 ? "" : `\xB7 ${artifact.byteLength} B`
            ] })
          ] }) }, artifact.id)),
          artifacts.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime11.jsx)("p", { children: t("emptyOperatorArtifacts") }) : null
        ] })
      ] }),
      !["cancelled", "failed", "succeeded"].includes(detail.parentJob.status) ? /* @__PURE__ */ (0, import_jsx_runtime11.jsxs)("div", { className: "rolling-skill-actions", children: [
        /* @__PURE__ */ (0, import_jsx_runtime11.jsx)(import_dsh_client_ui_primitives9.Input, { value: message, placeholder: t("operatorFollowUp"), onChange: (event) => setMessage(event.target.value) }),
        /* @__PURE__ */ (0, import_jsx_runtime11.jsx)(import_dsh_client_ui_primitives9.Button, { variant: "outline", disabled: busy || !message.trim(), onClick: () => void send(), children: t("send") })
      ] }) : null
    ] }) : null })
  ] });
}

// src/client/workbench/OptimizationPanel.tsx
var import_dsh_client_ui_primitives10 = require("@deepseek-ai/dsh-client-ui-primitives");
var import_react11 = require("react");
var import_jsx_runtime12 = require("react/jsx-runtime");
function OptimizationPanel({ t, initialRunId }) {
  const [runtimes, setRuntimes] = (0, import_react11.useState)([]);
  const [datasets, setDatasets] = (0, import_react11.useState)([]);
  const [catalog, setCatalog] = (0, import_react11.useState)({ skills: [] });
  const [detail, setDetail] = (0, import_react11.useState)(null);
  const [runs, setRuns] = (0, import_react11.useState)([]);
  const [skillId, setSkillId] = (0, import_react11.useState)("");
  const [versionId, setVersionId] = (0, import_react11.useState)("");
  const [datasetId, setDatasetId] = (0, import_react11.useState)("");
  const [operatorRuntimeId, setOperatorRuntimeId] = (0, import_react11.useState)("");
  const [targetRuntimeId, setTargetRuntimeId] = (0, import_react11.useState)("");
  const [judgeRuntimeId, setJudgeRuntimeId] = (0, import_react11.useState)("");
  const [preflightReady, setPreflightReady] = (0, import_react11.useState)(false);
  const [preflightResult, setPreflightResult] = (0, import_react11.useState)(null);
  const [runDetail, setRunDetail] = (0, import_react11.useState)(null);
  const [report, setReport] = (0, import_react11.useState)(null);
  const [busy, setBusy] = (0, import_react11.useState)(false);
  const [error, setError] = (0, import_react11.useState)(null);
  const [revision, setRevision] = (0, import_react11.useState)(0);
  (0, import_react11.useEffect)(() => {
    const controller = new AbortController();
    Promise.all([
      requestRollingSkill("runtimes.list", {}, controller.signal),
      requestRollingSkill("datasets.list", {}, controller.signal),
      requestRollingSkill("skills.catalog", {}, controller.signal),
      requestRollingSkill("optimizations.list", {}, controller.signal)
    ]).then(([runtimeItems, datasetItems, nextCatalog, nextRuns]) => {
      setRuntimes(runtimeItems);
      setDatasets(datasetItems);
      setCatalog(nextCatalog);
      setRuns(nextRuns);
      setOperatorRuntimeId((current) => current || runtimeItems[0]?.runtimeId || "");
      setTargetRuntimeId((current) => current || runtimeItems[0]?.runtimeId || "");
      setJudgeRuntimeId((current) => current || runtimeItems[0]?.runtimeId || "");
      setSkillId((current) => current || nextCatalog.skills[0]?.id || "");
      if (initialRunId) void inspect(initialRunId);
    }).catch((reason) => {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : t("loadError"));
    });
    return () => controller.abort();
  }, [revision, initialRunId]);
  (0, import_react11.useEffect)(() => {
    if (!skillId) {
      setDetail(null);
      return;
    }
    const controller = new AbortController();
    requestRollingSkill("skills.get", { skillId }, controller.signal).then((next) => {
      setDetail(next);
      const released2 = next.versions.find((version) => version.state === "released");
      setVersionId(released2?.id ?? "");
      const matching = datasets.find((dataset) => dataset.skillReference?.id === next.skill.id && dataset.skillReference?.repositoryId === next.skill.repositoryId);
      setDatasetId(matching?.id ?? "");
      setPreflightReady(false);
      setPreflightResult(null);
    }).catch((reason) => {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : t("loadError"));
    });
    return () => controller.abort();
  }, [skillId, datasets]);
  const released = (0, import_react11.useMemo)(() => detail?.versions.filter((version) => version.state === "released") ?? [], [detail]);
  const compatibleDatasets = (0, import_react11.useMemo)(() => datasets.filter((dataset) => dataset.skillReference?.id === detail?.skill.id && dataset.skillReference?.repositoryId === detail?.skill.repositoryId && Boolean(dataset.activeRubricVersionId)), [datasets, detail]);
  const configuration = () => ({
    skillId,
    baselineVersionId: versionId,
    datasetId,
    operator: { runtimeId: operatorRuntimeId, effort: "high" },
    targets: [{ runtimeId: targetRuntimeId, effort: "high" }],
    judge: { runtimeId: judgeRuntimeId, effort: "high" },
    activationMode: "explicit",
    mode: "adaptive",
    limits: {
      maxEpochs: 3,
      maxDurationMs: 60 * 60 * 1e3,
      patience: 2,
      minimumImprovement: 0.5,
      maxTurns: 100,
      maxTokens: null,
      maxCostMicros: null
    },
    target: { minimumScore: 90, minimumPassRate: 0.9, requireCriticalCases: true },
    telemetry: { tokens: false, cost: false }
  });
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
  const preflight = () => mutate(async () => {
    setPreflightResult(await requestRollingSkill("optimizations.preflight", configuration()));
    setPreflightReady(true);
  });
  const start = () => mutate(async () => {
    await requestRollingSkill("optimizations.start", {
      ...configuration(),
      idempotencyKey: `dsh-${Date.now()}`
    });
    setPreflightReady(false);
    setPreflightResult(null);
  });
  const inspect = async (runId) => {
    setError(null);
    try {
      const next = await requestRollingSkill("optimizations.get", { runId });
      setRunDetail(next.run);
      setReport(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t("loadError"));
    }
  };
  const generateReport = async () => {
    if (!runDetail) return;
    setBusy(true);
    setError(null);
    try {
      const result = await requestRollingSkill("optimizations.report", { runId: runDetail.id });
      setReport(result.report);
      const next = await requestRollingSkill("optimizations.get", { runId: runDetail.id });
      setRunDetail(next.run);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t("loadError"));
    } finally {
      setBusy(false);
    }
  };
  const ready = Boolean(
    skillId && versionId && datasetId && operatorRuntimeId && targetRuntimeId && judgeRuntimeId
  );
  (0, import_react11.useEffect)(() => {
    if (!runs.some((run) => !["completed", "failed", "cancelled"].includes(run.state))) return;
    const timer = window.setInterval(() => {
      setRevision((value) => value + 1);
      if (runDetail) void inspect(runDetail.id);
    }, 1500);
    return () => window.clearInterval(timer);
  }, [runs, runDetail?.id]);
  return /* @__PURE__ */ (0, import_jsx_runtime12.jsxs)("section", { className: "rolling-skill-panel", children: [
    /* @__PURE__ */ (0, import_jsx_runtime12.jsxs)("div", { className: "rolling-skill-panel-header", children: [
      /* @__PURE__ */ (0, import_jsx_runtime12.jsxs)("div", { children: [
        /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("h3", { children: t("optimizationTitle") }),
        /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("p", { children: t("optimizationDescription") })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime12.jsx)(import_dsh_client_ui_primitives10.Button, { variant: "ghost", size: "sm", onClick: () => setRevision((value) => value + 1), children: t("refresh") })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime12.jsxs)("div", { className: "rolling-skill-grid", children: [
      /* @__PURE__ */ (0, import_jsx_runtime12.jsxs)("label", { className: "rolling-skill-field", children: [
        /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("span", { children: t("optimizationSkill") }),
        /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("select", { className: "rolling-skill-select", value: skillId, onChange: (event) => setSkillId(event.target.value), children: catalog.skills.map((skill) => /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("option", { value: skill.id, children: skill.name }, skill.id)) })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime12.jsxs)("label", { className: "rolling-skill-field", children: [
        /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("span", { children: t("optimizationBaseline") }),
        /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("select", { className: "rolling-skill-select", value: versionId, onChange: (event) => {
          setVersionId(event.target.value);
          setPreflightReady(false);
        }, children: released.map((version) => /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("option", { value: version.id, children: version.versionLabel || version.id }, version.id)) })
      ] })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime12.jsxs)("label", { className: "rolling-skill-field", children: [
      /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("span", { children: t("selectDataset") }),
      /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("select", { className: "rolling-skill-select", value: datasetId, onChange: (event) => {
        setDatasetId(event.target.value);
        setPreflightReady(false);
      }, children: compatibleDatasets.map((dataset) => /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("option", { value: dataset.id, children: dataset.name }, dataset.id)) })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime12.jsx)(RuntimeSelect, { t, runtimes, value: operatorRuntimeId, onChange: (value) => {
      setOperatorRuntimeId(value);
      setPreflightReady(false);
    }, label: t("operatorRuntime") }),
    /* @__PURE__ */ (0, import_jsx_runtime12.jsx)(RuntimeSelect, { t, runtimes, value: targetRuntimeId, onChange: (value) => {
      setTargetRuntimeId(value);
      setPreflightReady(false);
    }, label: t("optimizationTargetRuntime") }),
    /* @__PURE__ */ (0, import_jsx_runtime12.jsx)(RuntimeSelect, { t, runtimes, value: judgeRuntimeId, onChange: (value) => {
      setJudgeRuntimeId(value);
      setPreflightReady(false);
    }, label: t("judgeRuntime") }),
    error ? /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("p", { className: "rolling-skill-inline-error", role: "alert", children: error }) : null,
    /* @__PURE__ */ (0, import_jsx_runtime12.jsxs)("div", { className: "rolling-skill-actions", children: [
      /* @__PURE__ */ (0, import_jsx_runtime12.jsx)(import_dsh_client_ui_primitives10.Button, { variant: "outline", disabled: busy || !ready, onClick: () => void preflight(), children: t("optimizationPreflight") }),
      /* @__PURE__ */ (0, import_jsx_runtime12.jsx)(import_dsh_client_ui_primitives10.Button, { variant: "outline", disabled: busy || !preflightReady, onClick: () => void start(), children: t("startOptimization") })
    ] }),
    preflightResult ? /* @__PURE__ */ (0, import_jsx_runtime12.jsxs)("section", { className: "rolling-skill-subpanel rolling-skill-section-gap", children: [
      /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("h4", { children: t("optimizationPreflightResult") }),
      /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("pre", { children: JSON.stringify(preflightResult, null, 2) })
    ] }) : null,
    /* @__PURE__ */ (0, import_jsx_runtime12.jsxs)("div", { className: "rolling-skill-list rolling-skill-section-gap", children: [
      runs.map((run) => /* @__PURE__ */ (0, import_jsx_runtime12.jsxs)("article", { className: "rolling-skill-list-row", children: [
        /* @__PURE__ */ (0, import_jsx_runtime12.jsxs)("div", { children: [
          /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("strong", { children: run.state }),
          /* @__PURE__ */ (0, import_jsx_runtime12.jsxs)("span", { children: [
            run.id,
            " \xB7 Epoch ",
            run.currentEpoch ?? 0
          ] }),
          run.error?.message ? /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("small", { children: run.error.message }) : null
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime12.jsxs)("div", { className: "rolling-skill-actions", children: [
          /* @__PURE__ */ (0, import_jsx_runtime12.jsx)(import_dsh_client_ui_primitives10.Button, { variant: "ghost", size: "sm", onClick: () => void inspect(run.id), children: t("details") }),
          !["paused", "completed", "failed", "cancelled"].includes(run.state) ? /* @__PURE__ */ (0, import_jsx_runtime12.jsx)(import_dsh_client_ui_primitives10.Button, { variant: "ghost", size: "sm", disabled: busy, onClick: () => void mutate(() => requestRollingSkill("optimizations.pause", { runId: run.id })), children: t("pause") }) : null,
          ["paused", "needs_recovery"].includes(run.state) ? /* @__PURE__ */ (0, import_jsx_runtime12.jsx)(import_dsh_client_ui_primitives10.Button, { variant: "ghost", size: "sm", disabled: busy, onClick: () => void mutate(() => requestRollingSkill("optimizations.resume", { runId: run.id })), children: t("resume") }) : null,
          !["completed", "failed", "cancelled"].includes(run.state) ? /* @__PURE__ */ (0, import_jsx_runtime12.jsx)(import_dsh_client_ui_primitives10.Button, { variant: "ghost", size: "sm", disabled: busy, onClick: () => void mutate(() => requestRollingSkill("optimizations.cancel", { runId: run.id })), children: t("cancelRun") }) : null
        ] })
      ] }, run.id)),
      runs.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("p", { children: t("emptyOptimizations") }) : null
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime12.jsx)(import_dsh_client_ui_primitives10.Modal, { open: runDetail !== null, onClose: () => setRunDetail(null), title: t("optimizationDetail"), closeLabel: t("close"), footer: /* @__PURE__ */ (0, import_jsx_runtime12.jsxs)(import_jsx_runtime12.Fragment, { children: [
      /* @__PURE__ */ (0, import_jsx_runtime12.jsx)(import_dsh_client_ui_primitives10.Button, { variant: "outline", disabled: busy, onClick: () => void generateReport(), children: t("generateOptimizationReport") }),
      /* @__PURE__ */ (0, import_jsx_runtime12.jsx)(import_dsh_client_ui_primitives10.Button, { variant: "outline", onClick: () => setRunDetail(null), children: t("close") })
    ] }), children: runDetail ? /* @__PURE__ */ (0, import_jsx_runtime12.jsxs)("div", { className: "rolling-skill-detail-stack", children: [
      /* @__PURE__ */ (0, import_jsx_runtime12.jsxs)("p", { children: [
        /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("strong", { children: runDetail.state }),
        " \xB7 ",
        runDetail.id,
        " \xB7 Epoch ",
        runDetail.currentEpoch ?? 0
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("pre", { children: JSON.stringify({ snapshotDigest: runDetail.snapshotDigest, baseline: runDetail.baseline, dataset: runDetail.dataset, rubric: runDetail.rubric, operator: runDetail.operator, targets: runDetail.targets, judge: runDetail.judge, checkpoint: runDetail.checkpoint, error: runDetail.error }, null, 2) }),
      /* @__PURE__ */ (0, import_jsx_runtime12.jsxs)("section", { className: "rolling-skill-subpanel", children: [
        /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("h4", { children: t("optimizationTimeline") }),
        /* @__PURE__ */ (0, import_jsx_runtime12.jsxs)("div", { className: "rolling-skill-list", children: [
          (runDetail.epochs ?? []).map((epoch) => /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("article", { className: "rolling-skill-list-row", children: /* @__PURE__ */ (0, import_jsx_runtime12.jsxs)("div", { children: [
            /* @__PURE__ */ (0, import_jsx_runtime12.jsxs)("strong", { children: [
              "Epoch ",
              epoch.number,
              " \xB7 ",
              epoch.status
            ] }),
            /* @__PURE__ */ (0, import_jsx_runtime12.jsxs)("span", { children: [
              epoch.candidate?.versionId ?? t("notAvailable"),
              " \xB7 ",
              epoch.analysis?.score ?? t("notAvailable"),
              " / \u0394 ",
              epoch.analysis?.scoreDelta ?? t("notAvailable")
            ] }),
            /* @__PURE__ */ (0, import_jsx_runtime12.jsxs)("small", { children: [
              epoch.decision?.action,
              " ",
              epoch.decision?.rationale
            ] }),
            /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("pre", { children: JSON.stringify({ candidate: epoch.candidate ?? null, installations: epoch.installations ?? [], analysis: epoch.analysis ?? null, decision: epoch.decision ?? null }, null, 2) })
          ] }) }, epoch.number)),
          !runDetail.epochs?.length ? /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("p", { children: t("emptyOptimizationTimeline") }) : null
        ] })
      ] }),
      report ? /* @__PURE__ */ (0, import_jsx_runtime12.jsxs)("section", { className: "rolling-skill-subpanel", children: [
        /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("h4", { children: t("optimizationReport") }),
        /* @__PURE__ */ (0, import_jsx_runtime12.jsxs)("p", { children: [
          /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("code", { children: report.artifactId }),
          " \xB7 ",
          /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("code", { children: report.digest })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("pre", { className: "rolling-skill-verbatim", children: report.preview ?? t("notAvailable") })
      ] }) : null
    ] }) : null })
  ] });
}

// src/client/workbench/RawCasesPanel.tsx
var import_dsh_client_ui_primitives11 = require("@deepseek-ai/dsh-client-ui-primitives");
var import_react12 = require("react");
var import_jsx_runtime13 = require("react/jsx-runtime");
function RawCasesPanel({ t, revision, onChanged, initialRawCaseId, onNavigate }) {
  const [entries, setEntries] = (0, import_react12.useState)([]);
  const [catalog, setCatalog] = (0, import_react12.useState)({ repositories: [], skills: [] });
  const [datasets, setDatasets] = (0, import_react12.useState)([]);
  const [search, setSearch] = (0, import_react12.useState)("");
  const [adding, setAdding] = (0, import_react12.useState)(false);
  const [editing, setEditing] = (0, import_react12.useState)(null);
  const [question, setQuestion] = (0, import_react12.useState)("");
  const [note, setNote] = (0, import_react12.useState)("");
  const [skillId, setSkillId] = (0, import_react12.useState)("");
  const [deleting, setDeleting] = (0, import_react12.useState)(null);
  const [inspecting, setInspecting] = (0, import_react12.useState)(null);
  const [drafting, setDrafting] = (0, import_react12.useState)(null);
  const [draftDatasetId, setDraftDatasetId] = (0, import_react12.useState)("");
  const [busy, setBusy] = (0, import_react12.useState)(false);
  const [error, setError] = (0, import_react12.useState)(null);
  const [dispatchedSessionId, setDispatchedSessionId] = (0, import_react12.useState)(null);
  const activeSessionId = (0, import_react12.useSyncExternalStore)(
    subscribeActiveConversationSession,
    activeConversationSessionSnapshot,
    () => null
  );
  (0, import_react12.useEffect)(() => {
    const controller = new AbortController();
    Promise.all([
      requestRollingSkill("rawCases.list", {}, controller.signal),
      requestRollingSkill("skills.catalog", {}, controller.signal),
      requestRollingSkill("datasets.list", {}, controller.signal)
    ]).then(([rawCases, nextCatalog, datasetItems]) => {
      setEntries(rawCases);
      setCatalog(nextCatalog);
      setDatasets(datasetItems);
      const valid = nextCatalog.skills.filter((skill) => skill.status === "valid");
      setSkillId((current) => valid.some((skill) => skill.id === current) ? current : valid[0]?.id ?? "");
      if (initialRawCaseId) setInspecting(rawCases.find((entry) => entry.id === initialRawCaseId) ?? null);
    }).catch((reason) => {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : t("loadError"));
    });
    return () => controller.abort();
  }, [revision, initialRawCaseId]);
  const filteredGroups = (0, import_react12.useMemo)(() => {
    const query = search.trim().toLocaleLowerCase();
    const filtered = entries.filter((entry) => !query || `${entry.question}
${entry.note}
${entry.skill.name}`.toLocaleLowerCase().includes(query));
    const groups = /* @__PURE__ */ new Map();
    for (const entry of filtered) {
      const key = entry.skill.id ?? `legacy:${entry.skill.name}`;
      groups.set(key, [...groups.get(key) ?? [], entry]);
    }
    return [...groups.entries()].map(([key, items]) => ({ key, name: items[0].skill.name, items }));
  }, [entries, search]);
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
  const selectedSkill = () => catalog.skills.find((skill) => skill.id === skillId);
  const beginAdd = () => {
    setAdding(true);
    setEditing(null);
    setQuestion("");
    setNote("");
  };
  const beginEdit = (entry) => {
    setAdding(false);
    setEditing(entry);
    setQuestion(entry.question);
    setNote(entry.note ?? "");
    const exact = catalog.skills.find((skill) => skill.id === entry.skill.id) ?? catalog.skills.find((skill) => skill.name === entry.skill.name && skill.status === "valid");
    setSkillId(exact?.id ?? catalog.skills.find((skill) => skill.status === "valid")?.id ?? "");
  };
  const add = () => {
    const skill = selectedSkill();
    if (!skill) return;
    void mutate(async () => {
      await requestRollingSkill("rawCases.add", {
        question,
        note,
        repositoryId: skill.repositoryId,
        skillId: skill.id
      });
      setAdding(false);
    });
  };
  const save = () => {
    const entry = editing;
    const skill = selectedSkill();
    if (!entry || !skill) return;
    void mutate(async () => {
      await requestRollingSkill("rawCases.updateManaged", {
        id: entry.id,
        expectedRevision: entry.revision,
        expectedSkillName: entry.skill.name,
        question,
        note,
        repositoryId: skill.repositoryId,
        skillId: skill.id,
        idempotencyKey: crypto.randomUUID()
      });
      setEditing(null);
    });
  };
  const recycle = () => {
    const entry = deleting;
    if (!entry) return;
    void mutate(async () => {
      await requestRollingSkill("rawCases.recycle", { id: entry.id, idempotencyKey: crypto.randomUUID() });
      setDeleting(null);
    });
  };
  const compatibleDatasets = (entry) => datasets.filter(
    (dataset) => Boolean(entry?.skill.id) && dataset.skillReference?.evidencePrecision === "managed" && dataset.skillReference.id === entry?.skill.id && Boolean(dataset.activeRubricVersionId)
  );
  const beginDraft = (entry) => {
    const compatible = compatibleDatasets(entry);
    setDrafting(entry);
    setDraftDatasetId(compatible[0]?.id ?? "");
  };
  const createDraft = () => {
    const entry = drafting;
    if (!entry || !draftDatasetId) return;
    void mutate(async () => {
      const session = await requestRollingSkill("rawCases.createDraft", {
        id: entry.id,
        datasetId: draftDatasetId,
        idempotencyKey: crypto.randomUUID()
      });
      setDrafting(null);
      onNavigate({ page: "curation", sessionId: session.id });
    });
  };
  const hasCompleteEpisode = (entry) => {
    const observation = entry.source?.observations?.at(-1);
    return Boolean(observation && observation.outcome !== "uncertain");
  };
  const dispatchToSession = (entry, target) => void mutate(async () => {
    const result = await requestRollingSkill("rawCases.dispatch", {
      id: entry.id,
      target,
      ...target === "current" ? { sessionId: activeSessionId } : {},
      idempotencyKey: crypto.randomUUID()
    });
    setDispatchedSessionId(result.sessionId);
  });
  const form = /* @__PURE__ */ (0, import_jsx_runtime13.jsxs)("div", { className: "rolling-skill-form-stack", children: [
    /* @__PURE__ */ (0, import_jsx_runtime13.jsxs)("label", { children: [
      /* @__PURE__ */ (0, import_jsx_runtime13.jsx)("span", { children: t("question") }),
      /* @__PURE__ */ (0, import_jsx_runtime13.jsx)("textarea", { value: question, onChange: (event) => setQuestion(event.target.value) })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime13.jsxs)("label", { children: [
      /* @__PURE__ */ (0, import_jsx_runtime13.jsx)("span", { children: t("datasetSkill") }),
      /* @__PURE__ */ (0, import_jsx_runtime13.jsx)("select", { className: "rolling-skill-select", value: skillId, onChange: (event) => setSkillId(event.target.value), children: catalog.skills.filter((skill) => skill.status === "valid").map((skill) => {
        const repository = catalog.repositories.find((entry) => entry.id === skill.repositoryId);
        return /* @__PURE__ */ (0, import_jsx_runtime13.jsxs)("option", { value: skill.id, children: [
          skill.name,
          " \xB7 ",
          repository?.displayName ?? skill.repositoryId
        ] }, skill.id);
      }) })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime13.jsxs)("label", { children: [
      /* @__PURE__ */ (0, import_jsx_runtime13.jsx)("span", { children: t("note") }),
      /* @__PURE__ */ (0, import_jsx_runtime13.jsx)(import_dsh_client_ui_primitives11.Input, { value: note, onChange: (event) => setNote(event.target.value) })
    ] })
  ] });
  return /* @__PURE__ */ (0, import_jsx_runtime13.jsxs)("section", { className: "rolling-skill-panel rolling-skill-data-panel", children: [
    /* @__PURE__ */ (0, import_jsx_runtime13.jsxs)("div", { className: "rolling-skill-panel-header", children: [
      /* @__PURE__ */ (0, import_jsx_runtime13.jsxs)("div", { children: [
        /* @__PURE__ */ (0, import_jsx_runtime13.jsx)("h3", { children: t("rawCasesTitle") }),
        /* @__PURE__ */ (0, import_jsx_runtime13.jsx)("p", { children: t("rawCasesDescription") })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime13.jsx)(import_dsh_client_ui_primitives11.Button, { variant: "outline", size: "sm", disabled: !catalog.skills.some((skill) => skill.status === "valid"), onClick: beginAdd, children: t("addRawCase") })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime13.jsx)(import_dsh_client_ui_primitives11.Input, { value: search, placeholder: t("searchRawCases"), "aria-label": t("searchRawCases"), onChange: (event) => setSearch(event.target.value) }),
    error ? /* @__PURE__ */ (0, import_jsx_runtime13.jsx)("p", { className: "rolling-skill-inline-error", role: "alert", children: error }) : null,
    dispatchedSessionId ? /* @__PURE__ */ (0, import_jsx_runtime13.jsxs)("p", { className: "rolling-skill-inline-success", children: [
      t("rawCaseDispatched"),
      " ",
      /* @__PURE__ */ (0, import_jsx_runtime13.jsx)("code", { children: dispatchedSessionId })
    ] }) : null,
    /* @__PURE__ */ (0, import_jsx_runtime13.jsxs)("div", { className: "rolling-skill-group-list", children: [
      filteredGroups.map((group) => /* @__PURE__ */ (0, import_jsx_runtime13.jsxs)("section", { className: "rolling-skill-raw-group", children: [
        /* @__PURE__ */ (0, import_jsx_runtime13.jsxs)("h4", { children: [
          group.name,
          " ",
          /* @__PURE__ */ (0, import_jsx_runtime13.jsx)("span", { children: group.items.length })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime13.jsx)("div", { className: "rolling-skill-list", children: group.items.map((entry) => /* @__PURE__ */ (0, import_jsx_runtime13.jsxs)("article", { className: "rolling-skill-list-row", children: [
          /* @__PURE__ */ (0, import_jsx_runtime13.jsxs)("div", { children: [
            /* @__PURE__ */ (0, import_jsx_runtime13.jsx)("strong", { className: "rolling-skill-verbatim", children: entry.question }),
            /* @__PURE__ */ (0, import_jsx_runtime13.jsxs)("span", { children: [
              entry.source?.kind ?? t("manualSource"),
              entry.note ? ` \xB7 ${entry.note}` : ""
            ] })
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime13.jsxs)("div", { className: "rolling-skill-actions", children: [
            /* @__PURE__ */ (0, import_jsx_runtime13.jsx)(import_dsh_client_ui_primitives11.Button, { variant: "ghost", size: "sm", onClick: () => setInspecting(entry), children: t("details") }),
            hasCompleteEpisode(entry) ? /* @__PURE__ */ (0, import_jsx_runtime13.jsx)(import_dsh_client_ui_primitives11.Button, { variant: "ghost", size: "sm", disabled: compatibleDatasets(entry).length === 0, onClick: () => beginDraft(entry), children: t("createCaseDraft") }) : /* @__PURE__ */ (0, import_jsx_runtime13.jsxs)(import_jsx_runtime13.Fragment, { children: [
              activeSessionId ? /* @__PURE__ */ (0, import_jsx_runtime13.jsx)(import_dsh_client_ui_primitives11.Button, { variant: "ghost", size: "sm", disabled: busy, onClick: () => dispatchToSession(entry, "current"), children: t("validateInCurrentSession") }) : null,
              /* @__PURE__ */ (0, import_jsx_runtime13.jsx)(import_dsh_client_ui_primitives11.Button, { variant: "ghost", size: "sm", disabled: busy, onClick: () => dispatchToSession(entry, "new"), children: t("validateInNewSession") })
            ] }),
            /* @__PURE__ */ (0, import_jsx_runtime13.jsx)(import_dsh_client_ui_primitives11.Button, { variant: "ghost", size: "sm", onClick: () => beginEdit(entry), children: t("edit") }),
            /* @__PURE__ */ (0, import_jsx_runtime13.jsx)(import_dsh_client_ui_primitives11.Button, { variant: "ghost", size: "sm", onClick: () => setDeleting(entry), children: t("delete") })
          ] })
        ] }, entry.id)) })
      ] }, group.key)),
      filteredGroups.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime13.jsx)("p", { children: t("emptyRawCases") }) : null
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime13.jsx)(import_dsh_client_ui_primitives11.Modal, { open: adding, onClose: () => setAdding(false), title: t("addRawCaseTitle"), closeLabel: t("cancel"), footer: /* @__PURE__ */ (0, import_jsx_runtime13.jsxs)(import_jsx_runtime13.Fragment, { children: [
      /* @__PURE__ */ (0, import_jsx_runtime13.jsx)(import_dsh_client_ui_primitives11.Button, { variant: "outline", onClick: () => setAdding(false), children: t("cancel") }),
      /* @__PURE__ */ (0, import_jsx_runtime13.jsx)(import_dsh_client_ui_primitives11.Button, { variant: "outline", disabled: busy || !question.trim() || !skillId, onClick: add, children: t("save") })
    ] }), children: form }),
    /* @__PURE__ */ (0, import_jsx_runtime13.jsx)(import_dsh_client_ui_primitives11.Modal, { open: editing !== null, onClose: () => setEditing(null), title: t("editRawCaseTitle"), closeLabel: t("cancel"), footer: /* @__PURE__ */ (0, import_jsx_runtime13.jsxs)(import_jsx_runtime13.Fragment, { children: [
      /* @__PURE__ */ (0, import_jsx_runtime13.jsx)(import_dsh_client_ui_primitives11.Button, { variant: "outline", onClick: () => setEditing(null), children: t("cancel") }),
      /* @__PURE__ */ (0, import_jsx_runtime13.jsx)(import_dsh_client_ui_primitives11.Button, { variant: "outline", disabled: busy || !question.trim() || !skillId, onClick: save, children: t("save") })
    ] }), children: form }),
    /* @__PURE__ */ (0, import_jsx_runtime13.jsx)(import_dsh_client_ui_primitives11.Modal, { open: inspecting !== null, onClose: () => setInspecting(null), title: t("rawCaseEvidence"), closeLabel: t("close"), footer: /* @__PURE__ */ (0, import_jsx_runtime13.jsx)(import_dsh_client_ui_primitives11.Button, { variant: "outline", onClick: () => setInspecting(null), children: t("close") }), children: inspecting ? /* @__PURE__ */ (0, import_jsx_runtime13.jsxs)("div", { className: "rolling-skill-detail-stack", children: [
      /* @__PURE__ */ (0, import_jsx_runtime13.jsx)("h4", { children: t("question") }),
      /* @__PURE__ */ (0, import_jsx_runtime13.jsx)("p", { className: "rolling-skill-verbatim", children: inspecting.question }),
      /* @__PURE__ */ (0, import_jsx_runtime13.jsx)("h4", { children: t("caseEvidence") }),
      /* @__PURE__ */ (0, import_jsx_runtime13.jsx)("pre", { children: JSON.stringify(inspecting.source ?? { kind: "manual" }, null, 2) })
    ] }) : null }),
    /* @__PURE__ */ (0, import_jsx_runtime13.jsxs)(import_dsh_client_ui_primitives11.Modal, { open: drafting !== null, onClose: () => setDrafting(null), title: t("createCaseDraft"), closeLabel: t("cancel"), footer: /* @__PURE__ */ (0, import_jsx_runtime13.jsxs)(import_jsx_runtime13.Fragment, { children: [
      /* @__PURE__ */ (0, import_jsx_runtime13.jsx)(import_dsh_client_ui_primitives11.Button, { variant: "outline", onClick: () => setDrafting(null), children: t("cancel") }),
      /* @__PURE__ */ (0, import_jsx_runtime13.jsx)(import_dsh_client_ui_primitives11.Button, { variant: "outline", disabled: busy || !draftDatasetId, onClick: createDraft, children: t("captureCreate") })
    ] }), children: [
      /* @__PURE__ */ (0, import_jsx_runtime13.jsx)("p", { children: t("rawCaseDraftDescription") }),
      /* @__PURE__ */ (0, import_jsx_runtime13.jsx)("select", { className: "rolling-skill-select", value: draftDatasetId, onChange: (event) => setDraftDatasetId(event.target.value), children: compatibleDatasets(drafting).map((dataset) => /* @__PURE__ */ (0, import_jsx_runtime13.jsx)("option", { value: dataset.id, children: dataset.name }, dataset.id)) })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime13.jsx)(import_dsh_client_ui_primitives11.Modal, { open: deleting !== null, onClose: () => setDeleting(null), title: t("deleteRawCaseTitle"), closeLabel: t("cancel"), footer: /* @__PURE__ */ (0, import_jsx_runtime13.jsxs)(import_jsx_runtime13.Fragment, { children: [
      /* @__PURE__ */ (0, import_jsx_runtime13.jsx)(import_dsh_client_ui_primitives11.Button, { variant: "outline", onClick: () => setDeleting(null), children: t("cancel") }),
      /* @__PURE__ */ (0, import_jsx_runtime13.jsx)(import_dsh_client_ui_primitives11.Button, { variant: "outline", disabled: busy, onClick: recycle, children: t("confirmDelete") })
    ] }), children: /* @__PURE__ */ (0, import_jsx_runtime13.jsx)("p", { children: t("deleteRawCasePrompt") }) })
  ] });
}

// src/client/workbench/SkillsPanel.tsx
var import_dsh_client_ui_primitives12 = require("@deepseek-ai/dsh-client-ui-primitives");
var import_react13 = require("react");
var import_jsx_runtime14 = require("react/jsx-runtime");
function SkillsPanel({ t, initialSkillId, initialJobId }) {
  const [catalog, setCatalog] = (0, import_react13.useState)({ repositories: [], skills: [] });
  const [detail, setDetail] = (0, import_react13.useState)(null);
  const [runtimes, setRuntimes] = (0, import_react13.useState)([]);
  const [runtimeIds, setRuntimeIds] = (0, import_react13.useState)([]);
  const [sourceKind, setSourceKind] = (0, import_react13.useState)("folder");
  const [sourceLocation, setSourceLocation] = (0, import_react13.useState)("");
  const [candidateMessage, setCandidateMessage] = (0, import_react13.useState)("Update Skill workflow");
  const [releaseLabel, setReleaseLabel] = (0, import_react13.useState)("");
  const [installations, setInstallations] = (0, import_react13.useState)({ jobs: [] });
  const [selectedJob, setSelectedJob] = (0, import_react13.useState)(null);
  const [followUp, setFollowUp] = (0, import_react13.useState)("");
  const [busy, setBusy] = (0, import_react13.useState)(false);
  const [error, setError] = (0, import_react13.useState)(null);
  const [revision, setRevision] = (0, import_react13.useState)(0);
  (0, import_react13.useEffect)(() => {
    const controller = new AbortController();
    Promise.all([
      requestRollingSkill("skills.catalog", {}, controller.signal),
      requestRollingSkill("installations.targets", {}, controller.signal),
      requestRollingSkill("installations.list", {}, controller.signal)
    ]).then(([nextCatalog, runtimeItems, jobs]) => {
      setCatalog(nextCatalog);
      setRuntimes(runtimeItems);
      setRuntimeIds((current) => current.length ? current : runtimeItems[0]?.runtimeId ? [runtimeItems[0].runtimeId] : []);
      setInstallations(jobs);
      const requestedSkill = nextCatalog.skills.find((skill) => skill.id === initialSkillId) ?? nextCatalog.skills[0];
      if (!detail && requestedSkill) void loadSkill(requestedSkill.id, controller.signal);
      if (initialJobId) void loadJob(initialJobId, controller.signal);
    }).catch((reason) => {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : t("loadError"));
    });
    return () => controller.abort();
  }, [revision, initialSkillId, initialJobId]);
  const loadSkill = async (skillId, signal) => {
    const next = await requestRollingSkill("skills.get", { skillId }, signal);
    setDetail(next);
    setInstallations(await requestRollingSkill("installations.list", { skillId }, signal));
  };
  const loadJob = async (jobId, signal) => {
    setSelectedJob(await requestRollingSkill("installations.get", { jobId }, signal));
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
  const releasedVersions = (0, import_react13.useMemo)(() => detail?.versions.filter((version) => version.state === "released" && !version.deprecatedAt) ?? [], [detail]);
  const released = releasedVersions[0] ?? null;
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
    targets: runtimeIds.map((selectedRuntimeId) => ({ runtimeId: selectedRuntimeId, modelId: null, effort: "high", permissionMode: null }))
  }));
  const deprecate = (version) => mutate(() => requestRollingSkill("skills.deprecate", { versionId: version.id }));
  const revealRepository = (repositoryId) => mutate(() => requestRollingSkill("skills.reveal", { repositoryId }));
  const inspectInstallation = (jobId) => mutate(async () => {
    const created = await requestRollingSkill("installations.inspect", { jobId });
    await loadJob(created.id);
  });
  const sendFollowUp = () => {
    const job = selectedJob;
    if (!job || !followUp.trim()) return;
    void mutate(async () => {
      setSelectedJob(await requestRollingSkill("installations.send", { jobId: job.id, text: followUp.trim() }));
      setFollowUp("");
    });
  };
  (0, import_react13.useEffect)(() => {
    if (!installations.jobs.some((job) => ["queued", "running", "verifying", "awaiting_permission", "awaiting_confirmation"].includes(job.status))) return;
    const timer = window.setInterval(() => setRevision((value) => value + 1), 1500);
    return () => window.clearInterval(timer);
  }, [installations.jobs]);
  return /* @__PURE__ */ (0, import_jsx_runtime14.jsxs)("div", { className: "rolling-skill-data-stack", children: [
    /* @__PURE__ */ (0, import_jsx_runtime14.jsxs)("section", { className: "rolling-skill-panel", children: [
      /* @__PURE__ */ (0, import_jsx_runtime14.jsxs)("div", { className: "rolling-skill-panel-header", children: [
        /* @__PURE__ */ (0, import_jsx_runtime14.jsxs)("div", { children: [
          /* @__PURE__ */ (0, import_jsx_runtime14.jsx)("h3", { children: t("skillRepositories") }),
          /* @__PURE__ */ (0, import_jsx_runtime14.jsx)("p", { children: t("skillRepositoriesDescription") })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime14.jsx)(import_dsh_client_ui_primitives12.Button, { variant: "ghost", size: "sm", disabled: busy, onClick: () => void mutate(() => requestRollingSkill("skills.rescan", {})), children: t("rescan") })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime14.jsxs)("div", { className: "rolling-skill-form-row", children: [
        /* @__PURE__ */ (0, import_jsx_runtime14.jsxs)("select", { className: "rolling-skill-select", value: sourceKind, onChange: (event) => setSourceKind(event.target.value), children: [
          /* @__PURE__ */ (0, import_jsx_runtime14.jsx)("option", { value: "folder", children: "folder" }),
          /* @__PURE__ */ (0, import_jsx_runtime14.jsx)("option", { value: "local-git", children: "local-git" }),
          /* @__PURE__ */ (0, import_jsx_runtime14.jsx)("option", { value: "git-url", children: "git-url" }),
          /* @__PURE__ */ (0, import_jsx_runtime14.jsx)("option", { value: "zip", children: "zip" })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime14.jsx)(import_dsh_client_ui_primitives12.Input, { value: sourceLocation, placeholder: t("skillSourceLocation"), onChange: (event) => setSourceLocation(event.target.value) }),
        /* @__PURE__ */ (0, import_jsx_runtime14.jsx)(import_dsh_client_ui_primitives12.Button, { variant: "outline", size: "sm", disabled: busy || !sourceLocation.trim(), onClick: () => void mutate(() => requestRollingSkill("skills.import", { kind: sourceKind, location: sourceLocation })), children: t("importSkill") })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime14.jsx)("div", { className: "rolling-skill-list", children: catalog.repositories.map((repository) => /* @__PURE__ */ (0, import_jsx_runtime14.jsxs)("article", { className: "rolling-skill-list-row", children: [
        /* @__PURE__ */ (0, import_jsx_runtime14.jsxs)("div", { children: [
          /* @__PURE__ */ (0, import_jsx_runtime14.jsx)("strong", { children: repository.displayName }),
          /* @__PURE__ */ (0, import_jsx_runtime14.jsx)("span", { children: repository.id })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime14.jsx)(import_dsh_client_ui_primitives12.Button, { variant: "ghost", size: "sm", disabled: busy, onClick: () => void revealRepository(repository.id), children: t("revealRepository") })
      ] }, repository.id)) }),
      /* @__PURE__ */ (0, import_jsx_runtime14.jsxs)("div", { className: "rolling-skill-list", children: [
        catalog.skills.map((skill) => /* @__PURE__ */ (0, import_jsx_runtime14.jsxs)("button", { type: "button", className: "rolling-skill-skill-row", onClick: () => void loadSkill(skill.id), children: [
          /* @__PURE__ */ (0, import_jsx_runtime14.jsx)("strong", { children: skill.name }),
          /* @__PURE__ */ (0, import_jsx_runtime14.jsx)("span", { children: skill.description || skill.status })
        ] }, skill.id)),
        catalog.skills.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime14.jsx)("p", { children: t("emptySkills") }) : null
      ] })
    ] }),
    detail ? /* @__PURE__ */ (0, import_jsx_runtime14.jsxs)("section", { className: "rolling-skill-panel", children: [
      /* @__PURE__ */ (0, import_jsx_runtime14.jsx)("div", { className: "rolling-skill-panel-header", children: /* @__PURE__ */ (0, import_jsx_runtime14.jsxs)("div", { children: [
        /* @__PURE__ */ (0, import_jsx_runtime14.jsx)("h3", { children: detail.skill.name }),
        /* @__PURE__ */ (0, import_jsx_runtime14.jsx)("p", { children: detail.skill.description || detail.skill.status })
      ] }) }),
      /* @__PURE__ */ (0, import_jsx_runtime14.jsx)("pre", { className: "rolling-skill-manifest", children: detail.manifest }),
      /* @__PURE__ */ (0, import_jsx_runtime14.jsx)("div", { className: "rolling-skill-list", children: detail.versions.map((version) => /* @__PURE__ */ (0, import_jsx_runtime14.jsxs)("article", { className: "rolling-skill-list-row", children: [
        /* @__PURE__ */ (0, import_jsx_runtime14.jsxs)("div", { children: [
          /* @__PURE__ */ (0, import_jsx_runtime14.jsx)("strong", { children: version.versionLabel ?? t("candidateVersion") }),
          /* @__PURE__ */ (0, import_jsx_runtime14.jsxs)("span", { children: [
            version.state,
            " \xB7 ",
            version.commit.slice(0, 12),
            " \xB7 ",
            version.contentDigest
          ] })
        ] }),
        version.state === "released" && !version.deprecatedAt ? /* @__PURE__ */ (0, import_jsx_runtime14.jsx)(import_dsh_client_ui_primitives12.Button, { variant: "ghost", size: "sm", disabled: busy, onClick: () => void deprecate(version), children: t("deprecateVersion") }) : version.deprecatedAt ? /* @__PURE__ */ (0, import_jsx_runtime14.jsx)("span", { children: t("deprecatedVersion") }) : null
      ] }, version.id)) }),
      /* @__PURE__ */ (0, import_jsx_runtime14.jsxs)("div", { className: "rolling-skill-grid", children: [
        /* @__PURE__ */ (0, import_jsx_runtime14.jsxs)("div", { className: "rolling-skill-subpanel", children: [
          /* @__PURE__ */ (0, import_jsx_runtime14.jsx)("h4", { children: t("candidateVersion") }),
          /* @__PURE__ */ (0, import_jsx_runtime14.jsx)(import_dsh_client_ui_primitives12.Input, { value: candidateMessage, onChange: (event) => setCandidateMessage(event.target.value) }),
          /* @__PURE__ */ (0, import_jsx_runtime14.jsx)(import_dsh_client_ui_primitives12.Button, { variant: "outline", size: "sm", disabled: busy, onClick: () => void createCandidate(), children: t("createCandidate") })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime14.jsxs)("div", { className: "rolling-skill-subpanel", children: [
          /* @__PURE__ */ (0, import_jsx_runtime14.jsx)("h4", { children: t("releaseVersion") }),
          /* @__PURE__ */ (0, import_jsx_runtime14.jsx)(import_dsh_client_ui_primitives12.Input, { value: releaseLabel, placeholder: "1.0.0", onChange: (event) => setReleaseLabel(event.target.value) }),
          /* @__PURE__ */ (0, import_jsx_runtime14.jsx)(import_dsh_client_ui_primitives12.Button, { variant: "outline", size: "sm", disabled: busy || !candidate || !releaseLabel.trim(), onClick: () => void release(), children: t("release") })
        ] })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime14.jsx)(RuntimeSelectionGrid, { t, runtimes, values: runtimeIds, onChange: setRuntimeIds }),
      /* @__PURE__ */ (0, import_jsx_runtime14.jsx)(import_dsh_client_ui_primitives12.Button, { variant: "outline", disabled: busy || !released || runtimeIds.length === 0, onClick: () => void install(), children: t("installReleased") })
    ] }) : null,
    /* @__PURE__ */ (0, import_jsx_runtime14.jsxs)("section", { className: "rolling-skill-panel", children: [
      /* @__PURE__ */ (0, import_jsx_runtime14.jsx)("h3", { children: t("installationJobs") }),
      error ? /* @__PURE__ */ (0, import_jsx_runtime14.jsx)("p", { className: "rolling-skill-inline-error", role: "alert", children: error }) : null,
      /* @__PURE__ */ (0, import_jsx_runtime14.jsx)("div", { className: "rolling-skill-list", children: installations.jobs.map((job) => /* @__PURE__ */ (0, import_jsx_runtime14.jsxs)("article", { className: "rolling-skill-list-row", children: [
        /* @__PURE__ */ (0, import_jsx_runtime14.jsxs)("div", { children: [
          /* @__PURE__ */ (0, import_jsx_runtime14.jsx)("strong", { children: job.status }),
          /* @__PURE__ */ (0, import_jsx_runtime14.jsxs)("span", { children: [
            job.runtime.displayName,
            " ",
            job.runtime.version || "",
            " \xB7 ",
            job.request.versionLabel ?? job.id
          ] })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime14.jsxs)("div", { className: "rolling-skill-actions", children: [
          /* @__PURE__ */ (0, import_jsx_runtime14.jsx)(import_dsh_client_ui_primitives12.Button, { variant: "ghost", size: "sm", onClick: () => void loadJob(job.id), children: t("details") }),
          /* @__PURE__ */ (0, import_jsx_runtime14.jsx)(import_dsh_client_ui_primitives12.Button, { variant: "ghost", size: "sm", disabled: busy, onClick: () => void inspectInstallation(job.id), children: t("inspect") }),
          ["queued", "running", "verifying", "awaiting_permission", "awaiting_confirmation"].includes(job.status) ? /* @__PURE__ */ (0, import_jsx_runtime14.jsx)(import_dsh_client_ui_primitives12.Button, { variant: "ghost", size: "sm", disabled: busy, onClick: () => void mutate(() => requestRollingSkill("installations.cancel", { jobId: job.id })), children: t("cancelRun") }) : null
        ] })
      ] }, job.id)) })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime14.jsx)(RuntimeInteractions, { t, ownerKind: "installation" }),
    /* @__PURE__ */ (0, import_jsx_runtime14.jsx)(import_dsh_client_ui_primitives12.Modal, { open: selectedJob !== null, onClose: () => setSelectedJob(null), title: t("installationDetail"), closeLabel: t("close"), footer: /* @__PURE__ */ (0, import_jsx_runtime14.jsx)(import_dsh_client_ui_primitives12.Button, { variant: "outline", onClick: () => setSelectedJob(null), children: t("close") }), children: selectedJob ? /* @__PURE__ */ (0, import_jsx_runtime14.jsxs)("div", { className: "rolling-skill-detail-stack", children: [
      /* @__PURE__ */ (0, import_jsx_runtime14.jsxs)("p", { children: [
        selectedJob.status,
        " \xB7 ",
        selectedJob.runtime.displayName,
        " ",
        selectedJob.runtime.version ?? ""
      ] }),
      selectedJob.parsedResult ? /* @__PURE__ */ (0, import_jsx_runtime14.jsxs)("p", { children: [
        t("installationVerification"),
        ": ",
        selectedJob.parsedResult.verification ?? t("notAvailable")
      ] }) : null,
      selectedJob.error ? /* @__PURE__ */ (0, import_jsx_runtime14.jsxs)("p", { className: "rolling-skill-inline-error", children: [
        selectedJob.error.code,
        " \xB7 ",
        selectedJob.error.message
      ] }) : null,
      /* @__PURE__ */ (0, import_jsx_runtime14.jsx)("h4", { children: t("installerConversation") }),
      /* @__PURE__ */ (0, import_jsx_runtime14.jsx)("div", { className: "rolling-skill-conversation-log", children: selectedJob.messages?.map((message, index) => /* @__PURE__ */ (0, import_jsx_runtime14.jsxs)("div", { "data-role": message.role, children: [
        /* @__PURE__ */ (0, import_jsx_runtime14.jsx)("strong", { children: message.role }),
        /* @__PURE__ */ (0, import_jsx_runtime14.jsx)("p", { children: message.content })
      ] }, `${message.recordedAt ?? index}`)) }),
      /* @__PURE__ */ (0, import_jsx_runtime14.jsx)("h4", { children: t("installerActivity") }),
      /* @__PURE__ */ (0, import_jsx_runtime14.jsx)("div", { className: "rolling-skill-list", children: selectedJob.activities?.map((activity, index) => /* @__PURE__ */ (0, import_jsx_runtime14.jsx)("div", { className: "rolling-skill-list-row", children: /* @__PURE__ */ (0, import_jsx_runtime14.jsxs)("div", { children: [
        /* @__PURE__ */ (0, import_jsx_runtime14.jsx)("strong", { children: activity.title ?? activity.type }),
        /* @__PURE__ */ (0, import_jsx_runtime14.jsx)("span", { children: activity.summary })
      ] }) }, `${activity.recordedAt ?? index}`)) }),
      selectedJob.canFollowUp ? /* @__PURE__ */ (0, import_jsx_runtime14.jsxs)("div", { className: "rolling-skill-form-row", children: [
        /* @__PURE__ */ (0, import_jsx_runtime14.jsx)(import_dsh_client_ui_primitives12.Input, { value: followUp, placeholder: t("installerFollowUp"), onChange: (event) => setFollowUp(event.target.value) }),
        /* @__PURE__ */ (0, import_jsx_runtime14.jsx)(import_dsh_client_ui_primitives12.Button, { variant: "outline", disabled: busy || !followUp.trim(), onClick: sendFollowUp, children: t("sendRevision") })
      ] }) : null
    ] }) : null })
  ] });
}
function RuntimeSelectionGrid({ t, runtimes, values, onChange }) {
  return /* @__PURE__ */ (0, import_jsx_runtime14.jsxs)("fieldset", { className: "rolling-skill-runtime-select", children: [
    /* @__PURE__ */ (0, import_jsx_runtime14.jsx)("legend", { children: t("installationRuntime") }),
    /* @__PURE__ */ (0, import_jsx_runtime14.jsxs)("div", { className: "rolling-skill-runtime-list", children: [
      runtimes.map((runtime) => /* @__PURE__ */ (0, import_jsx_runtime14.jsxs)("label", { className: "rolling-skill-runtime-option", children: [
        /* @__PURE__ */ (0, import_jsx_runtime14.jsx)("input", { type: "checkbox", checked: values.includes(runtime.runtimeId), onChange: (event) => onChange(event.target.checked ? [...values, runtime.runtimeId] : values.filter((value) => value !== runtime.runtimeId)) }),
        /* @__PURE__ */ (0, import_jsx_runtime14.jsxs)("span", { children: [
          /* @__PURE__ */ (0, import_jsx_runtime14.jsxs)("strong", { children: [
            runtime.displayName,
            " ",
            runtime.version
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime14.jsx)("code", { children: runtime.executablePath })
        ] })
      ] }, runtime.runtimeId)),
      runtimes.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime14.jsx)("p", { children: t("noRuntimes") }) : null
    ] })
  ] });
}

// src/client/workbench/CurationPanel.tsx
var import_dsh_client_ui_primitives14 = require("@deepseek-ai/dsh-client-ui-primitives");
var import_react15 = require("react");

// src/client/workbench/CurationSessionView.tsx
var import_dsh_client_ui_primitives13 = require("@deepseek-ai/dsh-client-ui-primitives");
var import_react14 = require("react");
var import_jsx_runtime15 = require("react/jsx-runtime");
function newKey(prefix) {
  return `${prefix}:${globalThis.crypto.randomUUID()}`;
}
function CurationSessionView({
  sessionId,
  t,
  onChanged,
  onNavigate
}) {
  const [revision, setRevision] = (0, import_react14.useState)(0);
  const [session, setSession] = (0, import_react14.useState)(null);
  const [error, setError] = (0, import_react14.useState)(null);
  const [message, setMessage] = (0, import_react14.useState)("");
  const [busy, setBusy] = (0, import_react14.useState)(false);
  const keys = (0, import_react14.useRef)(/* @__PURE__ */ new Map());
  (0, import_react14.useEffect)(() => {
    const controller = new AbortController();
    requestRollingSkill("curation.get", { sessionId }, controller.signal).then((value) => {
      setSession(value);
      setError(null);
    }).catch((reason) => {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : t("loadError"));
    });
    return () => controller.abort();
  }, [sessionId, revision]);
  (0, import_react14.useEffect)(() => {
    if (!session || !["queued", "running"].includes(session.status)) return;
    const timer = window.setTimeout(() => setRevision((value) => value + 1), 1500);
    return () => window.clearTimeout(timer);
  }, [session?.status, session?.revision]);
  const mutate = async (method, extra = {}) => {
    if (!session || busy) return;
    const signature = `${method}:${session.revision}:${JSON.stringify(extra)}`;
    let idempotencyKey = keys.current.get(signature);
    if (!idempotencyKey) {
      idempotencyKey = newKey(method);
      keys.current.set(signature, idempotencyKey);
    }
    setBusy(true);
    setError(null);
    try {
      const result = await requestRollingSkill(method, {
        sessionId: session.id,
        expectedRevision: session.revision,
        idempotencyKey,
        ...extra
      });
      keys.current.delete(signature);
      const updated = result.session ?? result;
      if (updated?.id) setSession(updated);
      if (method === "curation.save" || method === "curation.discard") {
        window.dispatchEvent(new CustomEvent("rolling-skill:curation-markers-changed", {
          detail: { sessionId: session.episode?.source.sessionId }
        }));
        onChanged();
      }
      if (method === "curation.save" && result.caseRecord?.id) {
        onNavigate({ page: "cases", datasetId: session.datasetId, caseId: result.caseRecord.id });
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t("loadError"));
    } finally {
      setBusy(false);
    }
  };
  if (!session && !error) return /* @__PURE__ */ (0, import_jsx_runtime15.jsx)("div", { className: "rolling-skill-state", role: "status", children: t("loading") });
  if (!session) return /* @__PURE__ */ (0, import_jsx_runtime15.jsx)("div", { className: "rolling-skill-state rolling-skill-error", role: "alert", children: error });
  const editable = !["archived", "cancelled"].includes(session.status);
  return /* @__PURE__ */ (0, import_jsx_runtime15.jsxs)("section", { className: "rolling-skill-panel rolling-skill-session-view", children: [
    /* @__PURE__ */ (0, import_jsx_runtime15.jsxs)("div", { className: "rolling-skill-panel-header", children: [
      /* @__PURE__ */ (0, import_jsx_runtime15.jsxs)("div", { children: [
        /* @__PURE__ */ (0, import_jsx_runtime15.jsx)("h3", { children: session.episode?.originalQuestion ?? session.id }),
        /* @__PURE__ */ (0, import_jsx_runtime15.jsxs)("p", { children: [
          session.caseType,
          " \xB7 ",
          session.status
        ] })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime15.jsx)(import_dsh_client_ui_primitives13.Button, { variant: "outline", size: "sm", onClick: () => setRevision((value) => value + 1), children: t("refresh") })
    ] }),
    session.error || error ? /* @__PURE__ */ (0, import_jsx_runtime15.jsx)("p", { className: "rolling-skill-inline-error", role: "alert", children: error ?? session.error }) : null,
    /* @__PURE__ */ (0, import_jsx_runtime15.jsxs)("section", { className: "rolling-skill-evidence-card", children: [
      /* @__PURE__ */ (0, import_jsx_runtime15.jsx)("h4", { children: t("frozenEvidence") }),
      /* @__PURE__ */ (0, import_jsx_runtime15.jsxs)("dl", { children: [
        /* @__PURE__ */ (0, import_jsx_runtime15.jsxs)("div", { children: [
          /* @__PURE__ */ (0, import_jsx_runtime15.jsx)("dt", { children: t("sourceRange") }),
          /* @__PURE__ */ (0, import_jsx_runtime15.jsxs)("dd", { children: [
            session.episode?.source.startSeq,
            "\u2013",
            session.episode?.source.endSeq
          ] })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime15.jsxs)("div", { children: [
          /* @__PURE__ */ (0, import_jsx_runtime15.jsx)("dt", { children: "Digest" }),
          /* @__PURE__ */ (0, import_jsx_runtime15.jsx)("dd", { children: /* @__PURE__ */ (0, import_jsx_runtime15.jsx)("code", { children: session.episode?.source.digest }) })
        ] })
      ] }),
      session.episode?.source.observedSkills.map((skill) => /* @__PURE__ */ (0, import_jsx_runtime15.jsxs)("p", { children: [
        skill.name,
        " \xB7 ",
        skill.provider,
        " \xB7 #",
        skill.callSeq,
        "\u2013",
        skill.resultSeq
      ] }, `${skill.name}:${skill.callSeq}`)),
      session.operationEvidence ? /* @__PURE__ */ (0, import_jsx_runtime15.jsx)("pre", { children: JSON.stringify(session.operationEvidence, null, 2) }) : null
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime15.jsxs)("section", { children: [
      /* @__PURE__ */ (0, import_jsx_runtime15.jsx)("h4", { children: t("curatorConversation") }),
      /* @__PURE__ */ (0, import_jsx_runtime15.jsx)("div", { className: "rolling-skill-conversation-log", children: session.conversation.map((entry) => /* @__PURE__ */ (0, import_jsx_runtime15.jsxs)("div", { "data-role": entry.role, children: [
        /* @__PURE__ */ (0, import_jsx_runtime15.jsx)("strong", { children: entry.role }),
        /* @__PURE__ */ (0, import_jsx_runtime15.jsx)("p", { children: entry.text })
      ] }, entry.id)) })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime15.jsxs)("section", { children: [
      /* @__PURE__ */ (0, import_jsx_runtime15.jsx)("h4", { children: t("latestDraft") }),
      session.draft ? /* @__PURE__ */ (0, import_jsx_runtime15.jsx)("pre", { children: JSON.stringify(session.draft, null, 2) }) : /* @__PURE__ */ (0, import_jsx_runtime15.jsx)("p", { children: t("noValidDraft") })
    ] }),
    editable ? /* @__PURE__ */ (0, import_jsx_runtime15.jsxs)("div", { className: "rolling-skill-form-stack", children: [
      /* @__PURE__ */ (0, import_jsx_runtime15.jsxs)("label", { className: "rolling-skill-field", children: [
        /* @__PURE__ */ (0, import_jsx_runtime15.jsx)("span", { children: t("model") }),
        /* @__PURE__ */ (0, import_jsx_runtime15.jsx)("input", { value: session.curator?.modelId ?? "", onChange: (event) => setSession({ ...session, curator: { ...session.curator, modelId: event.target.value } }), onBlur: () => mutate("curation.model", { modelId: session.curator?.modelId || null }) })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime15.jsxs)("label", { className: "rolling-skill-field", children: [
        /* @__PURE__ */ (0, import_jsx_runtime15.jsx)("span", { children: t("effort") }),
        /* @__PURE__ */ (0, import_jsx_runtime15.jsxs)("select", { className: "rolling-skill-select", value: session.curator?.effort ?? "", onChange: (event) => mutate("curation.effort", { effort: event.target.value || null }), children: [
          /* @__PURE__ */ (0, import_jsx_runtime15.jsx)("option", { value: "", children: "\u2014" }),
          /* @__PURE__ */ (0, import_jsx_runtime15.jsx)("option", { value: "low", children: "low" }),
          /* @__PURE__ */ (0, import_jsx_runtime15.jsx)("option", { value: "medium", children: "medium" }),
          /* @__PURE__ */ (0, import_jsx_runtime15.jsx)("option", { value: "high", children: "high" }),
          /* @__PURE__ */ (0, import_jsx_runtime15.jsx)("option", { value: "xhigh", children: "xhigh" })
        ] })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime15.jsxs)("label", { className: "rolling-skill-field", children: [
        /* @__PURE__ */ (0, import_jsx_runtime15.jsx)("span", { children: t("reviewMessage") }),
        /* @__PURE__ */ (0, import_jsx_runtime15.jsx)("textarea", { value: message, onChange: (event) => setMessage(event.target.value) })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime15.jsxs)("div", { className: "rolling-skill-actions", children: [
        /* @__PURE__ */ (0, import_jsx_runtime15.jsx)(import_dsh_client_ui_primitives13.Button, { disabled: busy || !message.trim(), onClick: () => mutate("curation.send", { text: message.trim() }).then(() => setMessage("")), children: t("sendRevision") }),
        session.status === "failed" ? /* @__PURE__ */ (0, import_jsx_runtime15.jsx)(import_dsh_client_ui_primitives13.Button, { variant: "outline", disabled: busy, onClick: () => mutate("curation.retry"), children: t("retry") }) : null,
        /* @__PURE__ */ (0, import_jsx_runtime15.jsx)(import_dsh_client_ui_primitives13.Button, { variant: "outline", disabled: busy || session.status !== "needs_review" || !session.draft, onClick: () => mutate("curation.save"), children: t("saveCase") }),
        /* @__PURE__ */ (0, import_jsx_runtime15.jsx)(import_dsh_client_ui_primitives13.Button, { variant: "outline", disabled: busy, onClick: () => {
          if (window.confirm(t("discardDraftConfirm"))) mutate("curation.discard");
        }, children: t("discardDraft") })
      ] })
    ] }) : null
  ] });
}

// src/client/workbench/CurationPanel.tsx
var import_jsx_runtime16 = require("react/jsx-runtime");
function CurationPanel({ t, initialSessionId, onNavigate }) {
  const [selectedId, setSelectedId] = (0, import_react15.useState)(initialSessionId ?? "");
  const [revision, setRevision] = (0, import_react15.useState)(0);
  const [showArchived, setShowArchived] = (0, import_react15.useState)(false);
  const [state, setState] = (0, import_react15.useState)({ status: "loading" });
  (0, import_react15.useEffect)(() => {
    if (initialSessionId) setSelectedId(initialSessionId);
  }, [initialSessionId]);
  (0, import_react15.useEffect)(() => {
    const controller = new AbortController();
    Promise.all([
      requestRollingSkill("curation.list", {}, controller.signal),
      requestRollingSkill("curation.list", { archived: true }, controller.signal)
    ]).then(([active, archived]) => {
      setState({ status: "ready", active: active.items, archived: archived.items });
      setSelectedId((current) => current || active.items[0]?.id || archived.items[0]?.id || "");
    }).catch((error) => {
      if (!controller.signal.aborted) {
        setState({ status: "error", message: error instanceof Error ? error.message : t("loadError") });
      }
    });
    return () => controller.abort();
  }, [revision]);
  if (state.status === "loading") return /* @__PURE__ */ (0, import_jsx_runtime16.jsx)("div", { className: "rolling-skill-state", role: "status", children: t("loading") });
  if (state.status === "error") return /* @__PURE__ */ (0, import_jsx_runtime16.jsxs)("div", { className: "rolling-skill-state rolling-skill-error", role: "alert", children: [
    /* @__PURE__ */ (0, import_jsx_runtime16.jsx)("span", { children: state.message }),
    /* @__PURE__ */ (0, import_jsx_runtime16.jsx)(import_dsh_client_ui_primitives14.Button, { variant: "outline", size: "sm", onClick: () => setRevision((value) => value + 1), children: t("retry") })
  ] });
  const items = showArchived ? state.archived : state.active;
  return /* @__PURE__ */ (0, import_jsx_runtime16.jsxs)("div", { className: "rolling-skill-review-layout", children: [
    /* @__PURE__ */ (0, import_jsx_runtime16.jsxs)("aside", { className: "rolling-skill-panel rolling-skill-review-list", children: [
      /* @__PURE__ */ (0, import_jsx_runtime16.jsxs)("div", { className: "rolling-skill-panel-header", children: [
        /* @__PURE__ */ (0, import_jsx_runtime16.jsxs)("div", { children: [
          /* @__PURE__ */ (0, import_jsx_runtime16.jsx)("h3", { children: t("curation") }),
          /* @__PURE__ */ (0, import_jsx_runtime16.jsx)("p", { children: t("curationDescription") })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime16.jsx)(import_dsh_client_ui_primitives14.Button, { variant: "outline", size: "sm", onClick: () => setRevision((value) => value + 1), children: t("refresh") })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime16.jsxs)("div", { className: "rolling-skill-actions", children: [
        /* @__PURE__ */ (0, import_jsx_runtime16.jsx)(import_dsh_client_ui_primitives14.Button, { size: "sm", variant: !showArchived ? "outline" : "ghost", onClick: () => setShowArchived(false), children: t("activeDrafts") }),
        /* @__PURE__ */ (0, import_jsx_runtime16.jsx)(import_dsh_client_ui_primitives14.Button, { size: "sm", variant: showArchived ? "outline" : "ghost", onClick: () => setShowArchived(true), children: t("archivedDrafts") })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime16.jsx)("div", { className: "rolling-skill-list", children: items.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime16.jsx)("p", { children: t("emptyDrafts") }) : items.map((session) => /* @__PURE__ */ (0, import_jsx_runtime16.jsxs)(
        "button",
        {
          type: "button",
          className: "rolling-skill-review-list-button",
          "data-selected": selectedId === session.id,
          onClick: () => {
            setSelectedId(session.id);
            onNavigate({ page: "curation", sessionId: session.id });
          },
          children: [
            /* @__PURE__ */ (0, import_jsx_runtime16.jsx)("strong", { children: session.episode?.originalQuestion || session.id }),
            /* @__PURE__ */ (0, import_jsx_runtime16.jsxs)("span", { children: [
              session.caseType,
              " \xB7 ",
              session.status
            ] })
          ]
        },
        session.id
      )) })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime16.jsx)("main", { className: "rolling-skill-review-detail", children: selectedId ? /* @__PURE__ */ (0, import_jsx_runtime16.jsx)(
      CurationSessionView,
      {
        sessionId: selectedId,
        t,
        onChanged: () => setRevision((value) => value + 1),
        onNavigate
      }
    ) : /* @__PURE__ */ (0, import_jsx_runtime16.jsx)("div", { className: "rolling-skill-state", children: t("selectDraft") }) })
  ] });
}

// src/client/workbench/RubricPanel.tsx
var import_dsh_client_ui_primitives16 = require("@deepseek-ai/dsh-client-ui-primitives");
var import_react17 = require("react");

// src/client/workbench/RubricSessionView.tsx
var import_dsh_client_ui_primitives15 = require("@deepseek-ai/dsh-client-ui-primitives");
var import_react16 = require("react");
var import_jsx_runtime17 = require("react/jsx-runtime");
function RubricSessionView({ sessionId, t, onChanged }) {
  const [revision, setRevision] = (0, import_react16.useState)(0);
  const [session, setSession] = (0, import_react16.useState)(null);
  const [message, setMessage] = (0, import_react16.useState)("");
  const [error, setError] = (0, import_react16.useState)(null);
  const [busy, setBusy] = (0, import_react16.useState)(false);
  const keys = (0, import_react16.useRef)(/* @__PURE__ */ new Map());
  (0, import_react16.useEffect)(() => {
    const controller = new AbortController();
    requestRollingSkill("rubrics.get", { sessionId }, controller.signal).then((value) => {
      setSession(value);
      setError(null);
    }).catch((reason) => {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : t("loadError"));
    });
    return () => controller.abort();
  }, [sessionId, revision]);
  (0, import_react16.useEffect)(() => {
    if (!session || !["queued", "running"].includes(session.status)) return;
    const timer = window.setTimeout(() => setRevision((value) => value + 1), 1500);
    return () => window.clearTimeout(timer);
  }, [session?.status, session?.revision]);
  const mutate = async (method, extra = {}) => {
    if (!session || busy) return;
    const signature = `${method}:${session.revision}:${JSON.stringify(extra)}`;
    let idempotencyKey = keys.current.get(signature);
    if (!idempotencyKey) {
      idempotencyKey = `${method}:${globalThis.crypto.randomUUID()}`;
      keys.current.set(signature, idempotencyKey);
    }
    setBusy(true);
    setError(null);
    try {
      const result = await requestRollingSkill(method, { sessionId: session.id, expectedRevision: session.revision, idempotencyKey, ...extra });
      keys.current.delete(signature);
      const updated = result.session ?? result;
      if (updated?.id) setSession(updated);
      if (method === "rubrics.publish" || method === "rubrics.discard") onChanged();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t("loadError"));
    } finally {
      setBusy(false);
    }
  };
  if (!session && !error) return /* @__PURE__ */ (0, import_jsx_runtime17.jsx)("div", { className: "rolling-skill-state", role: "status", children: t("loading") });
  if (!session) return /* @__PURE__ */ (0, import_jsx_runtime17.jsx)("div", { className: "rolling-skill-state rolling-skill-error", role: "alert", children: error });
  const editable = !["archived", "cancelled"].includes(session.status);
  return /* @__PURE__ */ (0, import_jsx_runtime17.jsxs)("section", { className: "rolling-skill-panel rolling-skill-session-view", children: [
    /* @__PURE__ */ (0, import_jsx_runtime17.jsxs)("div", { className: "rolling-skill-panel-header", children: [
      /* @__PURE__ */ (0, import_jsx_runtime17.jsxs)("div", { children: [
        /* @__PURE__ */ (0, import_jsx_runtime17.jsx)("h3", { children: t("rubricReview") }),
        /* @__PURE__ */ (0, import_jsx_runtime17.jsx)("p", { children: session.status })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime17.jsx)(import_dsh_client_ui_primitives15.Button, { variant: "outline", size: "sm", onClick: () => setRevision((value) => value + 1), children: t("refresh") })
    ] }),
    session.error || error ? /* @__PURE__ */ (0, import_jsx_runtime17.jsx)("p", { className: "rolling-skill-inline-error", role: "alert", children: error ?? session.error }) : null,
    session.operationEvidence ? /* @__PURE__ */ (0, import_jsx_runtime17.jsxs)("section", { className: "rolling-skill-evidence-card", children: [
      /* @__PURE__ */ (0, import_jsx_runtime17.jsx)("h4", { children: t("frozenEvidence") }),
      /* @__PURE__ */ (0, import_jsx_runtime17.jsx)("pre", { children: JSON.stringify(session.operationEvidence, null, 2) })
    ] }) : null,
    /* @__PURE__ */ (0, import_jsx_runtime17.jsxs)("section", { children: [
      /* @__PURE__ */ (0, import_jsx_runtime17.jsx)("h4", { children: t("rubricAgentConversation") }),
      /* @__PURE__ */ (0, import_jsx_runtime17.jsx)("div", { className: "rolling-skill-conversation-log", children: session.conversation.map((entry) => /* @__PURE__ */ (0, import_jsx_runtime17.jsxs)("div", { "data-role": entry.role, children: [
        /* @__PURE__ */ (0, import_jsx_runtime17.jsx)("strong", { children: entry.role }),
        /* @__PURE__ */ (0, import_jsx_runtime17.jsx)("p", { children: entry.text })
      ] }, entry.id)) })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime17.jsxs)("section", { children: [
      /* @__PURE__ */ (0, import_jsx_runtime17.jsx)("h4", { children: t("latestRubricDraft") }),
      session.draft ? /* @__PURE__ */ (0, import_jsx_runtime17.jsxs)("div", { className: "rolling-skill-rubric-draft", children: [
        /* @__PURE__ */ (0, import_jsx_runtime17.jsx)("h3", { children: session.draft.title }),
        /* @__PURE__ */ (0, import_jsx_runtime17.jsx)("p", { children: session.draft.summary }),
        /* @__PURE__ */ (0, import_jsx_runtime17.jsx)("p", { children: session.draft.scoringModel }),
        session.draft.criteria?.map((criterion) => /* @__PURE__ */ (0, import_jsx_runtime17.jsxs)("article", { children: [
          /* @__PURE__ */ (0, import_jsx_runtime17.jsxs)("strong", { children: [
            criterion.id,
            " \xB7 ",
            criterion.title,
            " \xB7 ",
            criterion.weight
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime17.jsx)("p", { children: criterion.criterion })
        ] }, criterion.id))
      ] }) : /* @__PURE__ */ (0, import_jsx_runtime17.jsx)("p", { children: t("noValidDraft") })
    ] }),
    editable ? /* @__PURE__ */ (0, import_jsx_runtime17.jsxs)("div", { className: "rolling-skill-form-stack", children: [
      /* @__PURE__ */ (0, import_jsx_runtime17.jsxs)("label", { className: "rolling-skill-field", children: [
        /* @__PURE__ */ (0, import_jsx_runtime17.jsx)("span", { children: t("model") }),
        /* @__PURE__ */ (0, import_jsx_runtime17.jsx)("input", { value: session.rubricAgent?.modelId ?? "", onChange: (event) => setSession({ ...session, rubricAgent: { ...session.rubricAgent, modelId: event.target.value } }), onBlur: () => mutate("rubrics.model", { modelId: session.rubricAgent?.modelId || null }) })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime17.jsxs)("label", { className: "rolling-skill-field", children: [
        /* @__PURE__ */ (0, import_jsx_runtime17.jsx)("span", { children: t("effort") }),
        /* @__PURE__ */ (0, import_jsx_runtime17.jsxs)("select", { className: "rolling-skill-select", value: session.rubricAgent?.effort ?? "", onChange: (event) => mutate("rubrics.effort", { effort: event.target.value || null }), children: [
          /* @__PURE__ */ (0, import_jsx_runtime17.jsx)("option", { value: "", children: "\u2014" }),
          /* @__PURE__ */ (0, import_jsx_runtime17.jsx)("option", { value: "low", children: "low" }),
          /* @__PURE__ */ (0, import_jsx_runtime17.jsx)("option", { value: "medium", children: "medium" }),
          /* @__PURE__ */ (0, import_jsx_runtime17.jsx)("option", { value: "high", children: "high" }),
          /* @__PURE__ */ (0, import_jsx_runtime17.jsx)("option", { value: "xhigh", children: "xhigh" })
        ] })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime17.jsxs)("label", { className: "rolling-skill-field", children: [
        /* @__PURE__ */ (0, import_jsx_runtime17.jsx)("span", { children: t("reviewMessage") }),
        /* @__PURE__ */ (0, import_jsx_runtime17.jsx)("textarea", { value: message, onChange: (event) => setMessage(event.target.value) })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime17.jsxs)("div", { className: "rolling-skill-actions", children: [
        /* @__PURE__ */ (0, import_jsx_runtime17.jsx)(import_dsh_client_ui_primitives15.Button, { disabled: busy || !message.trim(), onClick: () => mutate("rubrics.send", { text: message.trim() }).then(() => setMessage("")), children: t("sendRevision") }),
        session.status === "failed" ? /* @__PURE__ */ (0, import_jsx_runtime17.jsx)(import_dsh_client_ui_primitives15.Button, { variant: "outline", disabled: busy, onClick: () => mutate("rubrics.retry"), children: t("retry") }) : null,
        /* @__PURE__ */ (0, import_jsx_runtime17.jsx)(import_dsh_client_ui_primitives15.Button, { variant: "outline", disabled: busy || session.status !== "needs_review" || !session.draft, onClick: () => mutate("rubrics.publish"), children: t("publishRubric") }),
        /* @__PURE__ */ (0, import_jsx_runtime17.jsx)(import_dsh_client_ui_primitives15.Button, { variant: "outline", disabled: busy, onClick: () => {
          if (window.confirm(t("discardRubricConfirm"))) mutate("rubrics.discard");
        }, children: t("discardDraft") })
      ] })
    ] }) : null
  ] });
}

// src/client/workbench/RubricPanel.tsx
var import_jsx_runtime18 = require("react/jsx-runtime");
function RubricPanel({
  t,
  initialDatasetId,
  initialSessionId,
  onNavigate
}) {
  const [datasets, setDatasets] = (0, import_react17.useState)([]);
  const [datasetId, setDatasetId] = (0, import_react17.useState)(initialDatasetId ?? "");
  const [selectedSessionId, setSelectedSessionId] = (0, import_react17.useState)(initialSessionId ?? "");
  const [sessions, setSessions] = (0, import_react17.useState)([]);
  const [versions, setVersions] = (0, import_react17.useState)([]);
  const [active, setActive] = (0, import_react17.useState)(null);
  const [modelId, setModelId] = (0, import_react17.useState)("");
  const [effort, setEffort] = (0, import_react17.useState)("");
  const [revision, setRevision] = (0, import_react17.useState)(0);
  const [busy, setBusy] = (0, import_react17.useState)(false);
  const [error, setError] = (0, import_react17.useState)(null);
  (0, import_react17.useEffect)(() => {
    const controller = new AbortController();
    requestRollingSkill("datasets.list", {}, controller.signal).then((rows) => {
      setDatasets(rows);
      setDatasetId((current) => current || rows[0]?.id || "");
    }).catch((reason) => {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : t("loadError"));
    });
    return () => controller.abort();
  }, []);
  (0, import_react17.useEffect)(() => {
    if (!datasetId) return;
    const controller = new AbortController();
    requestRollingSkill(
      "rubrics.list",
      { datasetId },
      controller.signal
    ).then((result) => {
      setSessions(result.sessions);
      setVersions(result.versions);
      setActive(result.active);
      setSelectedSessionId((current) => current || result.sessions[0]?.id || "");
      setError(null);
    }).catch((reason) => {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : t("loadError"));
    });
    return () => controller.abort();
  }, [datasetId, revision]);
  const create = async () => {
    if (!datasetId || busy) return;
    setBusy(true);
    setError(null);
    try {
      const session = await requestRollingSkill("rubrics.create", {
        datasetId,
        modelId: modelId || null,
        effort: effort || null,
        idempotencyKey: `rubric-create:${datasetId}:${globalThis.crypto.randomUUID()}`
      });
      setSelectedSessionId(session.id);
      onNavigate({ page: "rubrics", datasetId, sessionId: session.id });
      setRevision((value) => value + 1);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t("loadError"));
    } finally {
      setBusy(false);
    }
  };
  const migrateLegacy = async () => {
    if (!datasetId || busy) return;
    setBusy(true);
    setError(null);
    try {
      await requestRollingSkill("rubrics.migrateLegacy", {
        datasetId,
        idempotencyKey: crypto.randomUUID()
      });
      setRevision((value) => value + 1);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t("loadError"));
    } finally {
      setBusy(false);
    }
  };
  return /* @__PURE__ */ (0, import_jsx_runtime18.jsxs)("div", { className: "rolling-skill-review-layout", children: [
    /* @__PURE__ */ (0, import_jsx_runtime18.jsxs)("aside", { className: "rolling-skill-panel rolling-skill-review-list", children: [
      /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("div", { className: "rolling-skill-panel-header", children: /* @__PURE__ */ (0, import_jsx_runtime18.jsxs)("div", { children: [
        /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("h3", { children: t("rubrics") }),
        /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("p", { children: t("rubricDescription") })
      ] }) }),
      /* @__PURE__ */ (0, import_jsx_runtime18.jsxs)("label", { className: "rolling-skill-field", children: [
        /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("span", { children: t("selectDataset") }),
        /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("select", { className: "rolling-skill-select", value: datasetId, onChange: (event) => {
          setDatasetId(event.target.value);
          setSelectedSessionId("");
        }, children: datasets.map((dataset) => /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("option", { value: dataset.id, children: dataset.name }, dataset.id)) })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime18.jsxs)("div", { className: "rolling-skill-form-stack rolling-skill-create-rubric", children: [
        /* @__PURE__ */ (0, import_jsx_runtime18.jsxs)("label", { className: "rolling-skill-field", children: [
          /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("span", { children: t("model") }),
          /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("input", { value: modelId, onChange: (event) => setModelId(event.target.value) })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime18.jsxs)("label", { className: "rolling-skill-field", children: [
          /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("span", { children: t("effort") }),
          /* @__PURE__ */ (0, import_jsx_runtime18.jsxs)("select", { className: "rolling-skill-select", value: effort, onChange: (event) => setEffort(event.target.value), children: [
            /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("option", { value: "", children: "\u2014" }),
            /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("option", { value: "low", children: "low" }),
            /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("option", { value: "medium", children: "medium" }),
            /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("option", { value: "high", children: "high" }),
            /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("option", { value: "xhigh", children: "xhigh" })
          ] })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime18.jsx)(import_dsh_client_ui_primitives16.Button, { disabled: !datasetId || busy, onClick: create, children: t("createRubric") })
      ] }),
      error ? /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("p", { className: "rolling-skill-inline-error", role: "alert", children: error }) : null,
      /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("h4", { children: t("rubricSessions") }),
      /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("div", { className: "rolling-skill-list", children: sessions.map((session) => /* @__PURE__ */ (0, import_jsx_runtime18.jsxs)("button", { type: "button", className: "rolling-skill-review-list-button", "data-selected": selectedSessionId === session.id, onClick: () => {
        setSelectedSessionId(session.id);
        onNavigate({ page: "rubrics", datasetId, sessionId: session.id });
      }, children: [
        /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("strong", { children: session.status }),
        /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("span", { children: session.updatedAt })
      ] }, session.id)) }),
      /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("h4", { children: t("rubricHistory") }),
      active ? /* @__PURE__ */ (0, import_jsx_runtime18.jsxs)("p", { className: "rolling-skill-badge", children: [
        t("activeRubric"),
        " \xB7 v",
        active.version
      ] }) : /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("p", { children: t("noActiveRubric") }),
      active && active.rubric.scoringModel !== "unified-100/v1" ? /* @__PURE__ */ (0, import_jsx_runtime18.jsxs)("section", { className: "rolling-skill-subpanel", children: [
        /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("p", { children: t("legacyRubricNotice") }),
        /* @__PURE__ */ (0, import_jsx_runtime18.jsx)(import_dsh_client_ui_primitives16.Button, { variant: "outline", size: "sm", disabled: busy, onClick: () => void migrateLegacy(), children: t("migrateLegacyRubric") })
      ] }) : null,
      /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("div", { className: "rolling-skill-list", children: versions.map((version) => /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("div", { className: "rolling-skill-list-row", children: /* @__PURE__ */ (0, import_jsx_runtime18.jsxs)("div", { children: [
        /* @__PURE__ */ (0, import_jsx_runtime18.jsxs)("strong", { children: [
          "v",
          version.version,
          " \xB7 ",
          version.rubric.title
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("span", { children: version.createdAt })
      ] }) }, version.id)) })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("main", { className: "rolling-skill-review-detail", children: selectedSessionId ? /* @__PURE__ */ (0, import_jsx_runtime18.jsx)(RubricSessionView, { sessionId: selectedSessionId, t, onChanged: () => setRevision((value) => value + 1) }) : /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("div", { className: "rolling-skill-state", children: t("selectRubricSession") }) })
  ] });
}

// src/client/workbench/Workbench.tsx
var import_jsx_runtime19 = require("react/jsx-runtime");
var TABS = [
  { id: "overview", label: "overview" },
  { id: "curation", label: "curation" },
  { id: "datasets", label: "datasets" },
  { id: "cases", label: "cases" },
  { id: "raw-cases", label: "rawCases" },
  { id: "rubrics", label: "rubrics" },
  { id: "skills", label: "skills" },
  { id: "installations", label: "installations" },
  { id: "evaluations", label: "evaluations" },
  { id: "automatic", label: "automatic" },
  { id: "operator", label: "operator" },
  { id: "optimization", label: "optimizationTitle" },
  { id: "import", label: "legacyImportTitle" },
  { id: "diagnostics", label: "diagnostics" }
];
function dateTime(value, fallback) {
  if (!value) return fallback;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleString() : fallback;
}
function Workbench({ locale, t, initialRoute = { page: "overview" }, onRouteChange }) {
  (0, import_react18.useSyncExternalStore)(
    (listener) => locale.subscribe(listener),
    () => locale.getSnapshot().revision,
    () => 0
  );
  const [route, setRoute] = (0, import_react18.useState)(initialRoute);
  const [reloadRevision, setReloadRevision] = (0, import_react18.useState)(0);
  const [dataRevision, setDataRevision] = (0, import_react18.useState)(0);
  const [state, setState] = (0, import_react18.useState)({ status: "loading" });
  (0, import_react18.useEffect)(() => {
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
  const navigate = (next) => {
    setRoute(next);
    onRouteChange?.(next);
  };
  (0, import_react18.useEffect)(() => {
    setRoute(initialRoute);
  }, [JSON.stringify(initialRoute)]);
  return /* @__PURE__ */ (0, import_jsx_runtime19.jsxs)("section", { className: "rolling-skill-workbench", "aria-labelledby": "rolling-skill-title", children: [
    /* @__PURE__ */ (0, import_jsx_runtime19.jsxs)("header", { className: "rolling-skill-header", children: [
      /* @__PURE__ */ (0, import_jsx_runtime19.jsxs)("div", { children: [
        /* @__PURE__ */ (0, import_jsx_runtime19.jsx)("h2", { id: "rolling-skill-title", children: t("title") }),
        /* @__PURE__ */ (0, import_jsx_runtime19.jsx)("p", { children: t("subtitle") })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime19.jsx)(import_dsh_client_ui_primitives17.Button, { variant: "outline", size: "sm", onClick: reload, disabled: state.status === "loading", children: t("refresh") })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime19.jsx)("nav", { className: "rolling-skill-tabs", "aria-label": t("title"), children: TABS.map((tab) => /* @__PURE__ */ (0, import_jsx_runtime19.jsx)(
      import_dsh_client_ui_primitives17.Button,
      {
        variant: route.page === tab.id ? "outline" : "ghost",
        size: "sm",
        "aria-pressed": route.page === tab.id,
        onClick: () => navigate({ page: tab.id }),
        children: t(tab.label)
      },
      tab.id
    )) }),
    state.status === "loading" ? /* @__PURE__ */ (0, import_jsx_runtime19.jsx)("div", { className: "rolling-skill-state", role: "status", children: t("loading") }) : state.status === "error" ? /* @__PURE__ */ (0, import_jsx_runtime19.jsxs)("div", { className: "rolling-skill-state rolling-skill-error", role: "alert", children: [
      /* @__PURE__ */ (0, import_jsx_runtime19.jsx)("strong", { children: t("loadError") }),
      /* @__PURE__ */ (0, import_jsx_runtime19.jsx)("span", { children: state.message }),
      /* @__PURE__ */ (0, import_jsx_runtime19.jsx)(import_dsh_client_ui_primitives17.Button, { variant: "outline", size: "sm", onClick: reload, children: t("retry") })
    ] }) : route.page === "curation" ? /* @__PURE__ */ (0, import_jsx_runtime19.jsx)(CurationPanel, { t, initialSessionId: route.sessionId, onNavigate: navigate }) : route.page === "datasets" ? /* @__PURE__ */ (0, import_jsx_runtime19.jsx)(DatasetsPanel, { t, onChanged: () => setDataRevision((value) => value + 1) }) : route.page === "cases" ? /* @__PURE__ */ (0, import_jsx_runtime19.jsx)(CasesPanel, { t, revision: dataRevision, initialDatasetId: route.datasetId, initialCaseId: route.caseId, onNavigate: navigate, onChanged: () => setDataRevision((value) => value + 1) }) : route.page === "raw-cases" ? /* @__PURE__ */ (0, import_jsx_runtime19.jsx)(RawCasesPanel, { t, revision: dataRevision, initialRawCaseId: route.rawCaseId, onNavigate: navigate, onChanged: () => setDataRevision((value) => value + 1) }) : route.page === "rubrics" ? /* @__PURE__ */ (0, import_jsx_runtime19.jsx)(
      RubricPanel,
      {
        t,
        initialDatasetId: route.datasetId,
        initialSessionId: route.sessionId,
        onNavigate: navigate
      }
    ) : route.page === "evaluations" ? /* @__PURE__ */ (0, import_jsx_runtime19.jsx)(EvaluationsPanel, { t, initialRunId: route.runId }) : route.page === "skills" || route.page === "installations" ? /* @__PURE__ */ (0, import_jsx_runtime19.jsx)(SkillsPanel, { t, initialSkillId: route.page === "skills" ? route.skillId : void 0, initialJobId: route.page === "installations" ? route.jobId : void 0 }) : route.page === "automatic" ? /* @__PURE__ */ (0, import_jsx_runtime19.jsx)(AutomaticCapturePanel, { t }) : route.page === "operator" ? /* @__PURE__ */ (0, import_jsx_runtime19.jsx)(OperatorPanel, { t, initialSessionId: route.sessionId }) : route.page === "optimization" ? /* @__PURE__ */ (0, import_jsx_runtime19.jsx)(OptimizationPanel, { t, initialRunId: route.runId }) : route.page === "import" ? /* @__PURE__ */ (0, import_jsx_runtime19.jsx)(ImportPanel, { t }) : route.page === "diagnostics" ? /* @__PURE__ */ (0, import_jsx_runtime19.jsx)(Overview, { dashboard: state.dashboard, t }) : route.page !== "overview" ? /* @__PURE__ */ (0, import_jsx_runtime19.jsxs)("div", { className: "rolling-skill-panel", children: [
      /* @__PURE__ */ (0, import_jsx_runtime19.jsx)("h3", { children: t(TABS.find((tab) => tab.id === route.page)?.label ?? "overview") }),
      /* @__PURE__ */ (0, import_jsx_runtime19.jsx)("p", { children: t("comingSoon") })
    ] }) : /* @__PURE__ */ (0, import_jsx_runtime19.jsx)(Overview, { dashboard: state.dashboard, t })
  ] });
}
function Overview({ dashboard, t }) {
  const counts2 = [
    { key: "datasets", label: "datasetsCount" },
    { key: "cases", label: "casesCount" },
    { key: "rawCases", label: "rawCasesCount" },
    { key: "evaluations", label: "evaluationsCount" },
    { key: "managedSkills", label: "managedSkillsCount" },
    { key: "operatorSessions", label: "operatorSessionsCount" },
    { key: "optimizations", label: "optimizationsCount" }
  ];
  const runtime = dashboard.settings.plugin.runtime;
  return /* @__PURE__ */ (0, import_jsx_runtime19.jsxs)("div", { className: "rolling-skill-overview", children: [
    /* @__PURE__ */ (0, import_jsx_runtime19.jsx)("div", { className: "rolling-skill-counts", children: counts2.map((count) => /* @__PURE__ */ (0, import_jsx_runtime19.jsxs)("div", { className: "rolling-skill-count", children: [
      /* @__PURE__ */ (0, import_jsx_runtime19.jsx)("strong", { children: dashboard.counts[count.key] }),
      /* @__PURE__ */ (0, import_jsx_runtime19.jsx)("span", { children: t(count.label) })
    ] }, count.key)) }),
    /* @__PURE__ */ (0, import_jsx_runtime19.jsxs)("div", { className: "rolling-skill-grid", children: [
      /* @__PURE__ */ (0, import_jsx_runtime19.jsxs)("section", { className: "rolling-skill-panel", children: [
        /* @__PURE__ */ (0, import_jsx_runtime19.jsx)("h3", { children: t("automaticStatus") }),
        /* @__PURE__ */ (0, import_jsx_runtime19.jsxs)("dl", { children: [
          /* @__PURE__ */ (0, import_jsx_runtime19.jsxs)("div", { children: [
            /* @__PURE__ */ (0, import_jsx_runtime19.jsx)("dt", { children: t("nextRun") }),
            /* @__PURE__ */ (0, import_jsx_runtime19.jsx)("dd", { children: dateTime(dashboard.automaticCapture.nextRunAt, t("notAvailable")) })
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime19.jsxs)("div", { children: [
            /* @__PURE__ */ (0, import_jsx_runtime19.jsx)("dt", { children: t("lastSuccess") }),
            /* @__PURE__ */ (0, import_jsx_runtime19.jsx)("dd", { children: dateTime(dashboard.automaticCapture.lastSuccessAt, t("notAvailable")) })
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime19.jsxs)("div", { children: [
            /* @__PURE__ */ (0, import_jsx_runtime19.jsx)("dt", { children: t("lastError") }),
            /* @__PURE__ */ (0, import_jsx_runtime19.jsx)("dd", { children: dashboard.automaticCapture.error ?? t("noError") })
          ] })
        ] })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime19.jsxs)("section", { className: "rolling-skill-panel", children: [
        /* @__PURE__ */ (0, import_jsx_runtime19.jsx)("h3", { children: t("runtime") }),
        runtime ? /* @__PURE__ */ (0, import_jsx_runtime19.jsxs)("div", { className: "rolling-skill-runtime", children: [
          /* @__PURE__ */ (0, import_jsx_runtime19.jsx)("strong", { children: [runtime.displayName ?? runtime.runtimeId, runtime.version].filter(Boolean).join(" ") }),
          /* @__PURE__ */ (0, import_jsx_runtime19.jsx)("code", { children: runtime.executablePath })
        ] }) : /* @__PURE__ */ (0, import_jsx_runtime19.jsx)("p", { children: t("noRuntime") })
      ] })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime19.jsxs)("section", { className: "rolling-skill-panel rolling-skill-path", children: [
      /* @__PURE__ */ (0, import_jsx_runtime19.jsx)("h3", { children: t("dataDirectory") }),
      /* @__PURE__ */ (0, import_jsx_runtime19.jsx)("code", { children: dashboard.dataRoot })
    ] })
  ] });
}

// src/client/workbench/WorkbenchOverlay.tsx
var import_jsx_runtime20 = require("react/jsx-runtime");
function WorkbenchOverlay({ locale, route, t, onClose, onRouteChange }) {
  const overlayRef = (0, import_react19.useRef)(null);
  (0, import_react19.useEffect)(() => {
    const overlay = overlayRef.current;
    overlay?.querySelector("button:not([disabled])")?.focus();
    const onKeyDown = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab" || !overlay) return;
      const focusable = Array.from(overlay.querySelectorAll(
        "button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href]"
      ));
      if (focusable.length === 0) return;
      const current = focusable.indexOf(document.activeElement);
      const next = event.shiftKey ? current <= 0 ? focusable.length - 1 : current - 1 : current < 0 || current === focusable.length - 1 ? 0 : current + 1;
      event.preventDefault();
      focusable[next].focus();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);
  return /* @__PURE__ */ (0, import_jsx_runtime20.jsx)("div", { className: "rolling-skill-workbench-backdrop", onMouseDown: (event) => {
    if (event.currentTarget === event.target) onClose();
  }, children: /* @__PURE__ */ (0, import_jsx_runtime20.jsxs)(
    "div",
    {
      ref: overlayRef,
      className: "rolling-skill-workbench-overlay",
      role: "dialog",
      "aria-modal": "true",
      "aria-label": t("title"),
      children: [
        /* @__PURE__ */ (0, import_jsx_runtime20.jsx)(
          import_dsh_client_ui_primitives18.Button,
          {
            className: "rolling-skill-workbench-close",
            variant: "ghost",
            size: "sm",
            onClick: onClose,
            "aria-label": t("close"),
            children: "\xD7"
          }
        ),
        /* @__PURE__ */ (0, import_jsx_runtime20.jsx)(Workbench, { locale, t, initialRoute: route, onRouteChange })
      ]
    }
  ) });
}

// src/client/workbench/WorkbenchLauncher.tsx
var import_jsx_runtime21 = require("react/jsx-runtime");
var ROUTE_KEY = "rolling-skill:last-workbench-route";
function savedRoute() {
  try {
    const value = JSON.parse(localStorage.getItem(ROUTE_KEY) ?? "null");
    if (value && typeof value === "object" && typeof value.page === "string") return value;
  } catch {
  }
  return { page: "overview" };
}
function persistRoute(route) {
  try {
    localStorage.setItem(ROUTE_KEY, JSON.stringify(route));
  } catch {
  }
}
function WorkbenchLauncher({ wide, locale, t }) {
  const [open, setOpen] = (0, import_react20.useState)(false);
  const [route, setRoute] = (0, import_react20.useState)(savedRoute);
  const changeRoute = (0, import_react20.useCallback)((next) => {
    setRoute(next);
    persistRoute(next);
  }, []);
  (0, import_react20.useEffect)(() => {
    const openWorkbench2 = (event) => {
      const next = event.detail?.route;
      if (next?.page) changeRoute(next);
      setOpen(true);
    };
    window.addEventListener("rolling-skill:open-workbench", openWorkbench2);
    return () => window.removeEventListener("rolling-skill:open-workbench", openWorkbench2);
  }, [changeRoute]);
  return /* @__PURE__ */ (0, import_jsx_runtime21.jsxs)(import_jsx_runtime21.Fragment, { children: [
    /* @__PURE__ */ (0, import_jsx_runtime21.jsx)(
      import_dsh_client_ui_primitives19.Button,
      {
        variant: "ghost",
        size: "sm",
        onClick: () => setOpen(true),
        "aria-label": t("openWorkbench"),
        title: t("openWorkbench"),
        children: wide ? t("nav") : "RS"
      }
    ),
    open ? /* @__PURE__ */ (0, import_jsx_runtime21.jsx)(
      WorkbenchOverlay,
      {
        locale,
        route,
        t,
        onClose: () => setOpen(false),
        onRouteChange: changeRoute
      }
    ) : null
  ] });
}

// src/client/settings/RollingSkillSettings.tsx
var import_dsh_client_ui_primitives20 = require("@deepseek-ai/dsh-client-ui-primitives");
var import_react21 = require("react");
var import_jsx_runtime22 = require("react/jsx-runtime");
function RollingSkillSettings({ t }) {
  const [revision, setRevision] = (0, import_react21.useState)(0);
  const [runtimes, setRuntimes] = (0, import_react21.useState)([]);
  const [models, setModels] = (0, import_react21.useState)([]);
  const [runtimeId, setRuntimeId] = (0, import_react21.useState)("");
  const [profiles, setProfiles] = (0, import_react21.useState)({
    curator: { modelId: null, effort: null },
    rubric: { modelId: null, effort: null },
    judge: { modelId: null, effort: null }
  });
  const [busy, setBusy] = (0, import_react21.useState)(false);
  const [saveError, setSaveError] = (0, import_react21.useState)(null);
  const [state, setState] = (0, import_react21.useState)({ status: "loading" });
  (0, import_react21.useEffect)(() => {
    const controller = new AbortController();
    Promise.all([
      requestRollingSkill("dashboard.get", {}, controller.signal),
      requestRollingSkill("settings.get", {}, controller.signal),
      requestRollingSkill("runtimes.list", {}, controller.signal)
    ]).then(([dashboard, settings, runtimeItems]) => {
      setState({ status: "ready", dashboard });
      setRuntimes(runtimeItems);
      setRuntimeId(settings.plugin.runtime?.runtimeId ?? runtimeItems[0]?.runtimeId ?? "");
      setProfiles({
        curator: settings.rollingSkill.curatorProfile,
        rubric: settings.rollingSkill.rubricProfile,
        judge: settings.rollingSkill.judgeProfile
      });
    }).catch((error) => {
      if (controller.signal.aborted) return;
      setState({ status: "error", message: error instanceof Error ? error.message : t("loadError") });
    });
    return () => controller.abort();
  }, [revision]);
  (0, import_react21.useEffect)(() => {
    if (!runtimeId) {
      setModels([]);
      return;
    }
    const controller = new AbortController();
    requestRollingSkill("runtimes.models", { runtimeId }, controller.signal).then(setModels).catch((error) => {
      if (!controller.signal.aborted) setSaveError(error instanceof Error ? error.message : t("loadError"));
    });
    return () => controller.abort();
  }, [runtimeId]);
  const updateProfile = (kind, patch) => {
    setProfiles((current) => ({ ...current, [kind]: { ...current[kind], ...patch } }));
  };
  const save = async () => {
    if (!runtimeId) return;
    setBusy(true);
    setSaveError(null);
    try {
      await requestRollingSkill("settings.selectRuntime", { runtimeId });
      await requestRollingSkill("settings.update", { rollingSkill: {
        curatorModelId: profiles.curator.modelId,
        curatorEffort: profiles.curator.effort,
        rubricModelId: profiles.rubric.modelId,
        rubricEffort: profiles.rubric.effort,
        judgeModelId: profiles.judge.modelId,
        judgeEffort: profiles.judge.effort
      } });
      setRevision((value) => value + 1);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : t("loadError"));
    } finally {
      setBusy(false);
    }
  };
  const runtime = state.status === "ready" ? state.dashboard.settings.plugin.runtime : null;
  return /* @__PURE__ */ (0, import_jsx_runtime22.jsxs)("section", { className: "rolling-skill-settings", "aria-labelledby": "rolling-skill-settings-title", children: [
    /* @__PURE__ */ (0, import_jsx_runtime22.jsxs)("header", { className: "rolling-skill-header", children: [
      /* @__PURE__ */ (0, import_jsx_runtime22.jsxs)("div", { children: [
        /* @__PURE__ */ (0, import_jsx_runtime22.jsx)("h2", { id: "rolling-skill-settings-title", children: t("settings") }),
        /* @__PURE__ */ (0, import_jsx_runtime22.jsx)("p", { children: t("settingsDescription") })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime22.jsx)(import_dsh_client_ui_primitives20.Button, { variant: "outline", size: "sm", onClick: () => setRevision((value) => value + 1), children: t("refresh") })
    ] }),
    state.status === "loading" ? /* @__PURE__ */ (0, import_jsx_runtime22.jsx)("div", { className: "rolling-skill-state", role: "status", children: t("loading") }) : state.status === "error" ? /* @__PURE__ */ (0, import_jsx_runtime22.jsx)("div", { className: "rolling-skill-state rolling-skill-error", role: "alert", children: state.message }) : /* @__PURE__ */ (0, import_jsx_runtime22.jsxs)("div", { className: "rolling-skill-data-stack", children: [
      /* @__PURE__ */ (0, import_jsx_runtime22.jsxs)("section", { className: "rolling-skill-panel", children: [
        /* @__PURE__ */ (0, import_jsx_runtime22.jsx)("h3", { children: t("agentDefaults") }),
        /* @__PURE__ */ (0, import_jsx_runtime22.jsxs)("label", { className: "rolling-skill-field", children: [
          /* @__PURE__ */ (0, import_jsx_runtime22.jsx)("span", { children: t("defaultRuntime") }),
          /* @__PURE__ */ (0, import_jsx_runtime22.jsx)("select", { className: "rolling-skill-select", value: runtimeId, onChange: (event) => setRuntimeId(event.target.value), children: runtimes.map((item) => /* @__PURE__ */ (0, import_jsx_runtime22.jsxs)("option", { value: item.runtimeId, children: [
            item.displayName,
            " ",
            item.version ?? ""
          ] }, item.runtimeId)) })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime22.jsx)("div", { className: "rolling-skill-grid", children: ["curator", "rubric", "judge"].map((kind) => /* @__PURE__ */ (0, import_jsx_runtime22.jsxs)("section", { className: "rolling-skill-subpanel", children: [
          /* @__PURE__ */ (0, import_jsx_runtime22.jsx)("h4", { children: t(kind === "curator" ? "curatorDefault" : kind === "rubric" ? "rubricDefault" : "judgeDefault") }),
          /* @__PURE__ */ (0, import_jsx_runtime22.jsxs)("label", { className: "rolling-skill-field", children: [
            /* @__PURE__ */ (0, import_jsx_runtime22.jsx)("span", { children: t("model") }),
            /* @__PURE__ */ (0, import_jsx_runtime22.jsxs)("select", { className: "rolling-skill-select", value: profiles[kind].modelId ?? "", onChange: (event) => updateProfile(kind, { modelId: event.target.value || null }), children: [
              /* @__PURE__ */ (0, import_jsx_runtime22.jsx)("option", { value: "", children: t("runtimeDefault") }),
              models.map((model) => {
                const id = model.id ?? model.model ?? "";
                return /* @__PURE__ */ (0, import_jsx_runtime22.jsx)("option", { value: id, children: model.displayName ?? id }, id);
              })
            ] })
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime22.jsxs)("label", { className: "rolling-skill-field", children: [
            /* @__PURE__ */ (0, import_jsx_runtime22.jsx)("span", { children: t("effort") }),
            /* @__PURE__ */ (0, import_jsx_runtime22.jsxs)("select", { className: "rolling-skill-select", value: profiles[kind].effort ?? "", onChange: (event) => updateProfile(kind, { effort: event.target.value || null }), children: [
              /* @__PURE__ */ (0, import_jsx_runtime22.jsx)("option", { value: "", children: t("runtimeDefault") }),
              ["low", "medium", "high", "xhigh", "max"].map((value) => /* @__PURE__ */ (0, import_jsx_runtime22.jsx)("option", { value, children: value }, value))
            ] })
          ] })
        ] }, kind)) }),
        saveError ? /* @__PURE__ */ (0, import_jsx_runtime22.jsx)("p", { className: "rolling-skill-inline-error", role: "alert", children: saveError }) : null,
        /* @__PURE__ */ (0, import_jsx_runtime22.jsx)(import_dsh_client_ui_primitives20.Button, { variant: "outline", disabled: busy || !runtimeId, onClick: () => void save(), children: t("saveDefaults") })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime22.jsxs)("section", { className: "rolling-skill-panel", children: [
        /* @__PURE__ */ (0, import_jsx_runtime22.jsx)("h3", { children: t("diagnostics") }),
        /* @__PURE__ */ (0, import_jsx_runtime22.jsxs)("dl", { children: [
          /* @__PURE__ */ (0, import_jsx_runtime22.jsxs)("div", { children: [
            /* @__PURE__ */ (0, import_jsx_runtime22.jsx)("dt", { children: t("dataDirectory") }),
            /* @__PURE__ */ (0, import_jsx_runtime22.jsx)("dd", { children: /* @__PURE__ */ (0, import_jsx_runtime22.jsx)("code", { children: state.dashboard.dataRoot }) })
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime22.jsxs)("div", { children: [
            /* @__PURE__ */ (0, import_jsx_runtime22.jsx)("dt", { children: t("runtime") }),
            /* @__PURE__ */ (0, import_jsx_runtime22.jsx)("dd", { children: runtime ? [runtime.displayName ?? runtime.runtimeId, runtime.version].filter(Boolean).join(" ") : t("noRuntime") })
          ] })
        ] })
      ] })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime22.jsx)(ImportPanel, { t })
  ] });
}

// src/client/index.tsx
var import_jsx_runtime23 = require("react/jsx-runtime");
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
  const RollingSkillSection = () => /* @__PURE__ */ (0, import_jsx_runtime23.jsx)(RollingSkillSettings, { t });
  ctx.slots.inject("settings.section", () => ctx.slots.register({
    name: "settings.section",
    id: "rolling-skill",
    order: 20,
    label: () => t("nav"),
    locale: LOCALE_NAMESPACE
  }, RollingSkillSection));
  const RollingSkillWorkbenchLauncher = (props) => /* @__PURE__ */ (0, import_jsx_runtime23.jsx)(WorkbenchLauncher, { wide: Boolean(props.wide), locale: ctx.locale, t });
  ctx.slots.inject("sidebar.footer.action", () => ctx.slots.register({
    name: "sidebar.footer.action",
    id: "rolling-skill-workbench",
    order: 20,
    label: () => t("nav"),
    locale: LOCALE_NAMESPACE
  }, RollingSkillWorkbenchLauncher));
  const RollingSkillCaseCaptureAction = (props) => /* @__PURE__ */ (0, import_jsx_runtime23.jsx)(
    CaseCaptureAction,
    {
      ...props,
      messageId: String(props.messageId ?? ""),
      sessionId: String(props.sessionId ?? ""),
      t
    }
  );
  ctx.slots.inject("conversation.chat.assistant-actions", () => ctx.slots.register({
    name: "conversation.chat.assistant-actions",
    id: "rolling-skill-case-capture",
    order: 20,
    locale: LOCALE_NAMESPACE
  }, RollingSkillCaseCaptureAction));
  const RollingSkillConversationMarkers = (props) => /* @__PURE__ */ (0, import_jsx_runtime23.jsx)(
    ConversationCurationMarkers,
    {
      sessionId: String(props.sessionId ?? ""),
      useSession: props.useSession,
      t
    }
  );
  ctx.slots.inject("conversation.session.header.utilities", () => ctx.slots.register({
    name: "conversation.session.header.utilities",
    id: "rolling-skill-curation-markers",
    order: 20,
    locale: LOCALE_NAMESPACE
  }, RollingSkillConversationMarkers));
}
return module.exports;}});
