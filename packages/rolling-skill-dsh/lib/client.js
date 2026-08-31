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
var __export = (target, all2) => {
  for (var name2 in all2)
    __defProp(target, name2, { get: all2[name2], enumerable: true });
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
    function projectSequenceRange2(snapshot, startSeq, endSeq) {
      if (!Number.isSafeInteger(startSeq) || !Number.isSafeInteger(endSeq) || startSeq > endSeq) return [];
      const order3 = Array.isArray(snapshot?.chat?.order) ? snapshot.chat.order : [];
      return order3.filter((key) => {
        const node2 = nodeFor(snapshot?.chat?.nodes, key);
        return Boolean(
          node2 && Number.isSafeInteger(node2.anchorSeq) && node2.anchorSeq >= startSeq && node2.anchorSeq <= endSeq
        );
      });
    }
    function projectMarkers2(snapshot, markers) {
      const projection = /* @__PURE__ */ new Map();
      const order3 = Array.isArray(snapshot?.chat?.order) ? snapshot.chat.order : [];
      const validMarkers = Array.isArray(markers) ? markers.filter(
        (marker) => Number.isSafeInteger(marker?.startSeq) && Number.isSafeInteger(marker?.endSeq) && marker.startSeq <= marker.endSeq && (marker.status === "draft" || marker.status === "saved")
      ) : [];
      for (const key of order3) {
        const node2 = nodeFor(snapshot?.chat?.nodes, key);
        if (!node2 || !Number.isSafeInteger(node2.anchorSeq)) continue;
        let status = null;
        for (const marker of validMarkers) {
          if (node2.anchorSeq < marker.startSeq || node2.anchorSeq > marker.endSeq) continue;
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
    module2.exports = { projectMarkers: projectMarkers2, projectSequenceRange: projectSequenceRange2 };
  }
});

// src/client/workbench/model-catalog.cjs
var require_model_catalog = __commonJS({
  "src/client/workbench/model-catalog.cjs"(exports, module2) {
    function modelId(model) {
      return model?.id ?? model?.model ?? "";
    }
    function resolveModelId2(models, requested) {
      const requestedId = requested ?? "";
      if (!Array.isArray(models) || models.length === 0) return "";
      return models.some((model) => modelId(model) === requestedId) ? requestedId : modelId(models[0]);
    }
    function normalizeEffort(value) {
      if (typeof value === "string") return { id: value, label: value };
      const id = value?.reasoningEffort ?? value?.effort ?? value?.id ?? value?.value ?? "";
      return { id, label: value?.displayName ?? id };
    }
    function reasoningEffortsFor2(models, selectedModelId) {
      const selected = (Array.isArray(models) ? models : []).find((model) => modelId(model) === selectedModelId);
      const values = [
        ...Array.isArray(selected?.reasoningEfforts) ? selected.reasoningEfforts : [],
        ...Array.isArray(selected?.supportedReasoningEfforts) ? selected.supportedReasoningEfforts : []
      ];
      const found = /* @__PURE__ */ new Map();
      for (const value of values) {
        const effort = normalizeEffort(value);
        if (effort.id && !found.has(effort.id)) found.set(effort.id, effort);
      }
      return [...found.values()];
    }
    function resolveReasoningEffort2(models, selectedModelId, requested) {
      const requestedId = requested ?? "";
      return reasoningEffortsFor2(models, selectedModelId).some((effort) => effort.id === requestedId) ? requestedId : "";
    }
    module2.exports = { reasoningEffortsFor: reasoningEffortsFor2, resolveModelId: resolveModelId2, resolveReasoningEffort: resolveReasoningEffort2 };
  }
});

// src/client/workbench/automatic-capture-view-model.cjs
var require_automatic_capture_view_model = __commonJS({
  "src/client/workbench/automatic-capture-view-model.cjs"(exports, module2) {
    function candidateSkillRows2(skills, targets) {
      const rows = (Array.isArray(skills) ? skills : []).filter((skill) => skill?.status === "valid").map((skill) => ({ ...skill }));
      const visible = new Set(rows.map((skill) => skill.id));
      for (const target of Array.isArray(targets) ? targets : []) {
        const skillId = String(target?.skillId ?? "").trim();
        if (!skillId || visible.has(skillId)) continue;
        rows.push({ id: skillId, name: skillId, status: "unavailable" });
        visible.add(skillId);
      }
      return rows;
    }
    function candidateDatasetOptions2(datasets, skillId, mode) {
      return (Array.isArray(datasets) ? datasets : []).filter((dataset) => dataset?.skillReference?.id === skillId).map((dataset) => ({
        ...dataset,
        disabled: mode === "automatic" && !dataset.activeRubricVersionId
      }));
    }
    module2.exports = { candidateDatasetOptions: candidateDatasetOptions2, candidateSkillRows: candidateSkillRows2 };
  }
});

// ../../node_modules/inline-style-parser/cjs/index.js
var require_cjs = __commonJS({
  "../../node_modules/inline-style-parser/cjs/index.js"(exports, module2) {
    "use strict";
    var COMMENT_REGEX = /\/\*[^*]*\*+([^/*][^*]*\*+)*\//g;
    var NEWLINE_REGEX = /\n/g;
    var WHITESPACE_REGEX = /^\s*/;
    var PROPERTY_REGEX = /^(\*?[-#/*\\\w]+(\[[0-9a-z_-]+\])?)\s*/;
    var COLON_REGEX = /^:\s*/;
    var VALUE_REGEX = /^((?:'(?:\\'|.)*?'|"(?:\\"|.)*?"|\([^)]*?\)|[^};])+)/;
    var SEMICOLON_REGEX = /^[;\s]*/;
    var TRIM_REGEX = /^\s+|\s+$/g;
    var NEWLINE = "\n";
    var FORWARD_SLASH = "/";
    var ASTERISK = "*";
    var EMPTY_STRING = "";
    var TYPE_COMMENT = "comment";
    var TYPE_DECLARATION = "declaration";
    function index2(style, options) {
      if (typeof style !== "string") {
        throw new TypeError("First argument must be a string");
      }
      if (!style) return [];
      options = options || {};
      var lineno = 1;
      var column = 1;
      function updatePosition(str) {
        var lines = str.match(NEWLINE_REGEX);
        if (lines) lineno += lines.length;
        var i = str.lastIndexOf(NEWLINE);
        column = ~i ? str.length - i : column + str.length;
      }
      function position3() {
        var start2 = { line: lineno, column };
        return function(node2) {
          node2.position = new Position(start2);
          whitespace2();
          return node2;
        };
      }
      function Position(start2) {
        this.start = start2;
        this.end = { line: lineno, column };
        this.source = options.source;
      }
      Position.prototype.content = style;
      function error(msg) {
        var err = new Error(
          options.source + ":" + lineno + ":" + column + ": " + msg
        );
        err.reason = msg;
        err.filename = options.source;
        err.line = lineno;
        err.column = column;
        err.source = style;
        if (options.silent) ;
        else {
          throw err;
        }
      }
      function match(re2) {
        var m = re2.exec(style);
        if (!m) return;
        var str = m[0];
        updatePosition(str);
        style = style.slice(str.length);
        return m;
      }
      function whitespace2() {
        match(WHITESPACE_REGEX);
      }
      function comments(rules) {
        var c;
        rules = rules || [];
        while (c = comment()) {
          if (c !== false) {
            rules.push(c);
          }
        }
        return rules;
      }
      function comment() {
        var pos = position3();
        if (FORWARD_SLASH != style.charAt(0) || ASTERISK != style.charAt(1)) return;
        var i = 2;
        while (EMPTY_STRING != style.charAt(i) && (ASTERISK != style.charAt(i) || FORWARD_SLASH != style.charAt(i + 1))) {
          ++i;
        }
        i += 2;
        if (EMPTY_STRING === style.charAt(i - 1)) {
          return error("End of comment missing");
        }
        var str = style.slice(2, i - 2);
        column += 2;
        updatePosition(str);
        style = style.slice(i);
        column += 2;
        return pos({
          type: TYPE_COMMENT,
          comment: str
        });
      }
      function declaration() {
        var pos = position3();
        var prop = match(PROPERTY_REGEX);
        if (!prop) return;
        comment();
        if (!match(COLON_REGEX)) return error("property missing ':'");
        var val = match(VALUE_REGEX);
        var ret = pos({
          type: TYPE_DECLARATION,
          property: trim(prop[0].replace(COMMENT_REGEX, EMPTY_STRING)),
          value: val ? trim(val[0].replace(COMMENT_REGEX, EMPTY_STRING)) : EMPTY_STRING
        });
        match(SEMICOLON_REGEX);
        return ret;
      }
      function declarations() {
        var decls = [];
        comments(decls);
        var decl;
        while (decl = declaration()) {
          if (decl !== false) {
            decls.push(decl);
            comments(decls);
          }
        }
        return decls;
      }
      whitespace2();
      return declarations();
    }
    function trim(str) {
      return str ? str.replace(TRIM_REGEX, EMPTY_STRING) : EMPTY_STRING;
    }
    module2.exports = index2;
  }
});

// ../../node_modules/style-to-object/cjs/index.js
var require_cjs2 = __commonJS({
  "../../node_modules/style-to-object/cjs/index.js"(exports) {
    "use strict";
    var __importDefault = exports && exports.__importDefault || function(mod) {
      return mod && mod.__esModule ? mod : { "default": mod };
    };
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.default = StyleToObject;
    var inline_style_parser_1 = __importDefault(require_cjs());
    function StyleToObject(style, iterator) {
      let styleObject = null;
      if (!style || typeof style !== "string") {
        return styleObject;
      }
      const declarations = (0, inline_style_parser_1.default)(style);
      const hasIterator = typeof iterator === "function";
      declarations.forEach((declaration) => {
        if (declaration.type !== "declaration") {
          return;
        }
        const { property, value } = declaration;
        if (hasIterator) {
          iterator(property, value, declaration);
        } else if (value) {
          styleObject = styleObject || {};
          styleObject[property] = value;
        }
      });
      return styleObject;
    }
  }
});

// ../../node_modules/style-to-js/cjs/utilities.js
var require_utilities = __commonJS({
  "../../node_modules/style-to-js/cjs/utilities.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.camelCase = void 0;
    var CUSTOM_PROPERTY_REGEX = /^--[a-zA-Z0-9_-]+$/;
    var HYPHEN_REGEX = /-([a-z])/g;
    var NO_HYPHEN_REGEX = /^[^-]+$/;
    var VENDOR_PREFIX_REGEX = /^-(webkit|moz|ms|o|khtml)-/;
    var MS_VENDOR_PREFIX_REGEX = /^-(ms)-/;
    var skipCamelCase = function(property) {
      return !property || NO_HYPHEN_REGEX.test(property) || CUSTOM_PROPERTY_REGEX.test(property);
    };
    var capitalize = function(match, character) {
      return character.toUpperCase();
    };
    var trimHyphen = function(match, prefix) {
      return "".concat(prefix, "-");
    };
    var camelCase = function(property, options) {
      if (options === void 0) {
        options = {};
      }
      if (skipCamelCase(property)) {
        return property;
      }
      property = property.toLowerCase();
      if (options.reactCompat) {
        property = property.replace(MS_VENDOR_PREFIX_REGEX, trimHyphen);
      } else {
        property = property.replace(VENDOR_PREFIX_REGEX, trimHyphen);
      }
      return property.replace(HYPHEN_REGEX, capitalize);
    };
    exports.camelCase = camelCase;
  }
});

// ../../node_modules/style-to-js/cjs/index.js
var require_cjs3 = __commonJS({
  "../../node_modules/style-to-js/cjs/index.js"(exports, module2) {
    "use strict";
    var __importDefault = exports && exports.__importDefault || function(mod) {
      return mod && mod.__esModule ? mod : { "default": mod };
    };
    var style_to_object_1 = __importDefault(require_cjs2());
    var utilities_1 = require_utilities();
    function StyleToJS(style, options) {
      var output = {};
      if (!style || typeof style !== "string") {
        return output;
      }
      (0, style_to_object_1.default)(style, function(property, value) {
        if (property && value) {
          output[(0, utilities_1.camelCase)(property, options)] = value;
        }
      });
      return output;
    }
    StyleToJS.default = StyleToJS;
    module2.exports = StyleToJS;
  }
});

// ../../node_modules/extend/index.js
var require_extend = __commonJS({
  "../../node_modules/extend/index.js"(exports, module2) {
    "use strict";
    var hasOwn = Object.prototype.hasOwnProperty;
    var toStr = Object.prototype.toString;
    var defineProperty2 = Object.defineProperty;
    var gOPD = Object.getOwnPropertyDescriptor;
    var isArray = function isArray2(arr) {
      if (typeof Array.isArray === "function") {
        return Array.isArray(arr);
      }
      return toStr.call(arr) === "[object Array]";
    };
    var isPlainObject2 = function isPlainObject3(obj) {
      if (!obj || toStr.call(obj) !== "[object Object]") {
        return false;
      }
      var hasOwnConstructor = hasOwn.call(obj, "constructor");
      var hasIsPrototypeOf = obj.constructor && obj.constructor.prototype && hasOwn.call(obj.constructor.prototype, "isPrototypeOf");
      if (obj.constructor && !hasOwnConstructor && !hasIsPrototypeOf) {
        return false;
      }
      var key;
      for (key in obj) {
      }
      return typeof key === "undefined" || hasOwn.call(obj, key);
    };
    var setProperty = function setProperty2(target, options) {
      if (defineProperty2 && options.name === "__proto__") {
        defineProperty2(target, options.name, {
          enumerable: true,
          configurable: true,
          value: options.newValue,
          writable: true
        });
      } else {
        target[options.name] = options.newValue;
      }
    };
    var getProperty = function getProperty2(obj, name2) {
      if (name2 === "__proto__") {
        if (!hasOwn.call(obj, name2)) {
          return void 0;
        } else if (gOPD) {
          return gOPD(obj, name2).value;
        }
      }
      return obj[name2];
    };
    module2.exports = function extend2() {
      var options, name2, src, copy, copyIsArray, clone;
      var target = arguments[0];
      var i = 1;
      var length = arguments.length;
      var deep = false;
      if (typeof target === "boolean") {
        deep = target;
        target = arguments[1] || {};
        i = 2;
      }
      if (target == null || typeof target !== "object" && typeof target !== "function") {
        target = {};
      }
      for (; i < length; ++i) {
        options = arguments[i];
        if (options != null) {
          for (name2 in options) {
            src = getProperty(target, name2);
            copy = getProperty(options, name2);
            if (target !== copy) {
              if (deep && copy && (isPlainObject2(copy) || (copyIsArray = isArray(copy)))) {
                if (copyIsArray) {
                  copyIsArray = false;
                  clone = src && isArray(src) ? src : [];
                } else {
                  clone = src && isPlainObject2(src) ? src : {};
                }
                setProperty(target, { name: name2, newValue: extend2(deep, clone, copy) });
              } else if (typeof copy !== "undefined") {
                setProperty(target, { name: name2, newValue: copy });
              }
            }
          }
        }
      }
      return target;
    };
  }
});

// src/client/workbench/markdown-policy.cjs
var require_markdown_policy = __commonJS({
  "src/client/workbench/markdown-policy.cjs"(exports, module2) {
    function safeMarkdownLink2(value) {
      const link2 = typeof value === "string" ? value.trim() : "";
      return /^(?:https?:|mailto:)/iu.test(link2) || link2.startsWith("#") ? link2 : null;
    }
    module2.exports = { safeMarkdownLink: safeMarkdownLink2 };
  }
});

// src/client/workbench/raw-case-evidence.cjs
var require_raw_case_evidence = __commonJS({
  "src/client/workbench/raw-case-evidence.cjs"(exports, module2) {
    function latestObservation(source) {
      if (Array.isArray(source?.observations)) return source.observations.at(-1) ?? null;
      return source?.kind === "automatic_capture" ? source : null;
    }
    function dshSequence(itemId, sessionId) {
      const id = typeof itemId === "string" ? itemId : "";
      const prefix = `dsh:${sessionId}:`;
      if (!sessionId || !id.startsWith(prefix)) return null;
      const value = Number(id.slice(prefix.length));
      return Number.isSafeInteger(value) && value >= 0 ? value : null;
    }
    function rawCaseEvidence2(source, activeSessionId) {
      const observation = latestObservation(source);
      if (!observation) {
        return {
          kind: source?.kind ?? "manual",
          observation: null,
          startSeq: null,
          endSeq: null,
          canRevealRange: false
        };
      }
      const startSeq = dshSequence(observation.startItemId, observation.threadId);
      const endSeq = dshSequence(observation.endItemId, observation.threadId);
      return {
        kind: source?.kind ?? observation.kind ?? "automatic_capture",
        observation,
        startSeq,
        endSeq,
        canRevealRange: Boolean(
          activeSessionId && activeSessionId === observation.threadId && startSeq !== null && endSeq !== null && startSeq <= endSeq
        )
      };
    }
    function evidenceTimeline2(episode) {
      const items = Array.isArray(episode?.items) ? episode.items : [];
      const firstUser = items.findIndex((item) => item?.type === "userMessage");
      let lastAssistant = -1;
      for (let index2 = items.length - 1; index2 >= 0; index2 -= 1) {
        if (items[index2]?.type === "agentMessage") {
          lastAssistant = index2;
          break;
        }
      }
      return items.map((item, index2) => {
        const kind = item?.type === "userMessage" ? item?.sourceKind && item.sourceKind !== "user" ? "context" : "user" : item?.type === "agentMessage" ? "assistant" : "tool";
        return {
          ...item,
          kind,
          label: kind === "tool" ? item?.toolName ?? item?.type ?? "tool" : kind === "context" ? item?.sourceKind : kind,
          boundary: index2 === firstUser ? "start" : index2 === lastAssistant ? "end" : null,
          collapsible: kind === "tool" || kind === "context"
        };
      });
    }
    module2.exports = { evidenceTimeline: evidenceTimeline2, latestObservation, rawCaseEvidence: rawCaseEvidence2 };
  }
});

// src/client/workbench/raw-case-skill-filter.cjs
var require_raw_case_skill_filter = __commonJS({
  "src/client/workbench/raw-case-skill-filter.cjs"(exports, module2) {
    function skillKey(entry) {
      return entry?.skill?.id || `legacy:${entry?.skill?.name || "unknown"}`;
    }
    function rawCaseSkillOptions2(entries = []) {
      const options = /* @__PURE__ */ new Map();
      for (const entry of entries) {
        const key = skillKey(entry);
        const current = options.get(key) || {
          key,
          name: entry?.skill?.name || "Unknown Skill",
          count: 0
        };
        current.count += 1;
        options.set(key, current);
      }
      return [...options.values()].sort((left, right) => left.name.localeCompare(right.name));
    }
    function rawCaseSkillGroups2(entries = [], search2 = "", scope = "all") {
      const query = String(search2).trim().toLocaleLowerCase();
      const groups = /* @__PURE__ */ new Map();
      for (const entry of entries) {
        const key = skillKey(entry);
        if (scope !== "all" && key !== scope) continue;
        const haystack = `${entry?.question || ""}
${entry?.note || ""}
${entry?.skill?.name || ""}`.toLocaleLowerCase();
        if (query && !haystack.includes(query)) continue;
        const group = groups.get(key) || {
          key,
          name: entry?.skill?.name || "Unknown Skill",
          items: []
        };
        group.items.push(entry);
        groups.set(key, group);
      }
      return [...groups.values()].sort((left, right) => left.name.localeCompare(right.name));
    }
    function resolveRawCaseSkillScope2(scope, entries = []) {
      return scope === "all" || rawCaseSkillOptions2(entries).some((entry) => entry.key === scope) ? scope : "all";
    }
    module2.exports = {
      rawCaseSkillGroups: rawCaseSkillGroups2,
      rawCaseSkillOptions: rawCaseSkillOptions2,
      resolveRawCaseSkillScope: resolveRawCaseSkillScope2
    };
  }
});

// src/client/workbench/curation-selection.cjs
var require_curation_selection = __commonJS({
  "src/client/workbench/curation-selection.cjs"(exports, module2) {
    function visibleCurationSelection2(currentId, items = []) {
      return items.some((entry) => entry.id === currentId) ? currentId : items[0]?.id || "";
    }
    module2.exports = { visibleCurationSelection: visibleCurationSelection2 };
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
var workbench_default = '.rolling-skill-workbench {\n    box-sizing: border-box;\n    color: var(--dsw-alias-label-primary);\n    display: grid;\n    gap: 20px;\n    min-width: 0;\n    padding: 4px 0 24px;\n}\n\n.rolling-skill-workbench-backdrop {\n    background: var(--dsw-alias-bg-mask-1);\n    display: flex;\n    inset: 0;\n    padding: 20px;\n    position: fixed;\n    z-index: 900;\n}\n\n.rolling-skill-workbench-overlay {\n    background: var(--dsw-alias-bg-base);\n    border: 1px solid var(--dsw-alias-border-l2);\n    border-radius: 14px;\n    color: var(--dsw-alias-label-primary);\n    margin: auto;\n    max-height: calc(100vh - 40px);\n    max-width: 1440px;\n    min-height: min(780px, calc(100vh - 40px));\n    overflow: auto;\n    padding: 24px;\n    position: relative;\n    width: 100%;\n}\n\n.rolling-skill-workbench-close {\n    position: absolute;\n    right: 12px;\n    top: 12px;\n    z-index: 1;\n}\n\n.rolling-skill-settings {\n    display: grid;\n    gap: 16px;\n    padding-bottom: 24px;\n}\n\n.rolling-skill-header {\n    align-items: flex-start;\n    display: flex;\n    gap: 16px;\n    justify-content: space-between;\n}\n\n.rolling-skill-header h2,\n.rolling-skill-panel h3 {\n    margin: 0;\n}\n\n.rolling-skill-header p,\n.rolling-skill-panel p {\n    color: var(--dsw-alias-label-secondary);\n    margin: 6px 0 0;\n}\n\n.rolling-skill-tabs {\n    align-items: center;\n    border-bottom: 1px solid var(--dsw-alias-border-l2);\n    display: flex;\n    flex-wrap: wrap;\n    gap: 4px;\n    padding-bottom: 10px;\n}\n\n.rolling-skill-primary-tabs {\n    gap: 8px;\n    padding-bottom: 12px;\n}\n\n.rolling-skill-primary-tabs [aria-pressed="true"] {\n    background: var(--dsw-alias-bg-layer-2);\n    font-weight: 600;\n}\n\n.rolling-skill-secondary-tabs {\n    background: var(--dsw-alias-bg-layer-1);\n    border: 1px solid var(--dsw-alias-border-l3);\n    border-radius: 10px;\n    gap: 4px;\n    margin-top: -12px;\n    padding: 6px 8px;\n}\n\n.rolling-skill-secondary-tabs [aria-pressed="true"] {\n    background: var(--dsw-alias-bg-layer-2);\n    font-weight: 600;\n}\n\n.rolling-skill-current-skill {\n    align-items: center;\n    display: grid;\n    gap: 10px;\n    grid-template-columns: auto minmax(180px, 360px);\n}\n\n.rolling-skill-current-skill > span {\n    color: var(--dsw-alias-label-secondary);\n    font-size: 13px;\n}\n\n.rolling-skill-counts {\n    display: grid;\n    gap: 10px;\n    grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));\n}\n\n.rolling-skill-count,\n.rolling-skill-panel,\n.rolling-skill-state {\n    background: var(--dsw-alias-bg-layer-2);\n    border: 1px solid var(--dsw-alias-border-l2);\n    border-radius: 10px;\n}\n\n.rolling-skill-count {\n    display: grid;\n    gap: 4px;\n    padding: 14px;\n}\n\n.rolling-skill-count strong {\n    font-size: 22px;\n    line-height: 28px;\n}\n\n.rolling-skill-count span,\n.rolling-skill-panel dt {\n    color: var(--dsw-alias-label-secondary);\n    font-size: 12px;\n}\n\n.rolling-skill-overview {\n    display: grid;\n    gap: 12px;\n}\n\n.rolling-skill-grid {\n    display: grid;\n    gap: 12px;\n    grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));\n}\n\n.rolling-skill-time-selects {\n    align-items: center;\n    display: grid;\n    gap: 8px;\n    grid-template-columns: repeat(2, minmax(0, 1fr));\n}\n\n.rolling-skill-time-selects label {\n    align-items: center;\n    display: grid;\n    gap: 6px;\n    grid-template-columns: minmax(0, 1fr) auto;\n    min-width: 0;\n}\n\n.rolling-skill-time-selects label > span {\n    color: var(--dsw-alias-label-secondary);\n    font-size: 12px;\n}\n\n.rolling-skill-automatic-flow-summary {\n    color: var(--dsw-alias-label-secondary);\n    font-size: 12px;\n    line-height: 1.5;\n    margin: 10px 0;\n}\n\n.rolling-skill-automatic-flow-summary strong {\n    color: var(--dsw-alias-label-primary);\n    font-weight: 600;\n}\n\n.rolling-skill-scheduler-explanation {\n    margin-top: 8px;\n}\n\n.rolling-skill-candidate-targets {\n    background: var(--dsw-alias-bg-layer-1);\n    border: 1px solid var(--dsw-alias-border-l3);\n    border-radius: 8px;\n    display: grid;\n    gap: 10px;\n    margin: 14px 0 0;\n    min-width: 0;\n    padding: 12px;\n}\n\n.rolling-skill-candidate-targets legend {\n    font-size: 13px;\n    font-weight: 600;\n    padding: 0 4px;\n}\n\n.rolling-skill-candidate-targets > p {\n    margin: 0;\n}\n\n.rolling-skill-candidate-target-list {\n    display: grid;\n    gap: 8px;\n    max-height: min(420px, 52vh);\n    overflow-y: auto;\n    padding-right: 4px;\n    scrollbar-gutter: stable;\n}\n\n.rolling-skill-candidate-target {\n    align-items: center;\n    border-top: 1px solid var(--dsw-alias-border-l3);\n    display: grid;\n    gap: 10px;\n    grid-template-columns: minmax(180px, 1fr) minmax(180px, 360px);\n    min-width: 0;\n    padding-top: 10px;\n}\n\n.rolling-skill-candidate-skill {\n    align-items: flex-start;\n    display: grid;\n    gap: 10px;\n    grid-template-columns: auto minmax(0, 1fr);\n    min-width: 0;\n}\n\n.rolling-skill-candidate-skill > span {\n    display: grid;\n    gap: 3px;\n    min-width: 0;\n}\n\n.rolling-skill-candidate-skill strong {\n    overflow-wrap: anywhere;\n}\n\n.rolling-skill-candidate-target small {\n    color: var(--dsw-alias-label-secondary);\n    overflow-wrap: anywhere;\n}\n\n.rolling-skill-candidate-dataset {\n    display: grid;\n    gap: 4px;\n    min-width: 0;\n}\n\n.rolling-skill-candidate-target .rolling-skill-select {\n    margin-top: 0;\n    max-width: none;\n    min-width: 0;\n    width: 100%;\n}\n\n.rolling-skill-form-actions {\n    align-items: center;\n    display: flex;\n    flex-wrap: wrap;\n    gap: 10px;\n    justify-content: space-between;\n    margin-top: 14px;\n    min-width: 0;\n}\n\n.rolling-skill-panel,\n.rolling-skill-state {\n    min-width: 0;\n    padding: 16px;\n}\n\n.rolling-skill-panel dl {\n    display: grid;\n    gap: 10px;\n    margin: 14px 0 0;\n}\n\n.rolling-skill-panel dl > div {\n    align-items: baseline;\n    display: flex;\n    gap: 12px;\n    justify-content: space-between;\n}\n\n.rolling-skill-panel dd {\n    margin: 0;\n    max-width: 68%;\n    overflow-wrap: anywhere;\n    text-align: right;\n}\n\n.rolling-skill-runtime,\n.rolling-skill-state {\n    display: grid;\n    gap: 8px;\n}\n\n.rolling-skill-runtime {\n    margin-top: 14px;\n}\n\n.rolling-skill-runtime code,\n.rolling-skill-path code {\n    color: var(--dsw-alias-label-secondary);\n    font-family: ui-monospace, monospace;\n    font-size: 12px;\n    overflow-wrap: anywhere;\n}\n\n.rolling-skill-path code {\n    display: block;\n    margin-top: 10px;\n}\n\n.rolling-skill-error {\n    border-color: var(--dsw-alias-state-error-primary);\n    color: var(--dsw-alias-label-error);\n}\n\n.rolling-skill-data-stack,\n.rolling-skill-form-stack,\n.rolling-skill-list {\n    display: grid;\n    gap: 12px;\n}\n\n.rolling-skill-panel-header,\n.rolling-skill-list-row,\n.rolling-skill-case-row,\n.rolling-skill-form-row,\n.rolling-skill-actions {\n    align-items: center;\n    display: flex;\n    gap: 10px;\n}\n\n.rolling-skill-action-button {\n    flex: 0 0 auto;\n    max-width: 100%;\n    overflow: hidden;\n    text-overflow: ellipsis;\n    white-space: nowrap;\n}\n\n.rolling-skill-action-button[data-rolling-skill-tone="secondary"] {\n    background: var(--dsw-alias-bg-layer-1);\n}\n\n.rolling-skill-action-button[data-rolling-skill-tone="secondary"]:hover:not(:disabled) {\n    background: var(--dsw-alias-interactive-bg-hover);\n}\n\n.rolling-skill-action-button[data-rolling-skill-tone="secondary"]:active:not(:disabled) {\n    background: var(--dsw-alias-interactive-bg-active);\n}\n\n.rolling-skill-actions {\n    flex-wrap: wrap;\n    min-width: 0;\n}\n\n.rolling-skill-panel-header {\n    min-width: 0;\n}\n\n.rolling-skill-panel-header,\n.rolling-skill-list-row,\n.rolling-skill-case-row {\n    justify-content: space-between;\n}\n\n.rolling-skill-form-row,\n.rolling-skill-list {\n    margin-top: 14px;\n}\n\n.rolling-skill-form-row > :first-child {\n    flex: 1 1 0;\n    min-width: 0;\n}\n\n.rolling-skill-skill-import {\n    align-items: end;\n    display: grid;\n    gap: 10px;\n    grid-template-columns: minmax(150px, 220px) minmax(0, 1fr) auto;\n    margin-top: 14px;\n}\n\n.rolling-skill-skill-source-picker {\n    align-items: end;\n    display: grid;\n    gap: 10px;\n    grid-template-columns: auto minmax(0, 1fr);\n    min-width: 0;\n}\n\n.rolling-skill-selected-source {\n    background: var(--dsw-alias-bg-layer-1);\n    border: 1px solid var(--dsw-alias-border-l3);\n    border-radius: 7px;\n    display: grid;\n    gap: 3px;\n    min-width: 0;\n    padding: 7px 10px;\n}\n\n.rolling-skill-selected-source span {\n    color: var(--dsw-alias-label-secondary);\n    font-size: 12px;\n}\n\n.rolling-skill-selected-source code {\n    overflow: hidden;\n    text-overflow: ellipsis;\n    white-space: nowrap;\n}\n\n.rolling-skill-list-row,\n.rolling-skill-case-row {\n    background: var(--dsw-alias-bg-layer-1);\n    border: 1px solid var(--dsw-alias-border-l3);\n    border-radius: 8px;\n    min-width: 0;\n    padding: 12px;\n}\n\n.rolling-skill-list-row > div:first-child,\n.rolling-skill-case-copy {\n    display: grid;\n    gap: 5px;\n    min-width: 0;\n}\n\n.rolling-skill-list-row span,\n.rolling-skill-case-copy p {\n    color: var(--dsw-alias-label-secondary);\n    font-size: 12px;\n    overflow-wrap: anywhere;\n}\n\n.rolling-skill-managed-skill-row .rolling-skill-skill-row {\n    flex: 1;\n    min-width: 0;\n}\n\n.rolling-skill-version-card {\n    background: var(--dsw-alias-bg-layer-1);\n    border: 1px solid var(--dsw-alias-border-l3);\n    border-radius: 8px;\n    min-width: 0;\n    padding: 12px;\n}\n\n.rolling-skill-version-card header,\n.rolling-skill-version-card header > div {\n    align-items: center;\n    display: flex;\n    gap: 8px;\n    justify-content: space-between;\n}\n\n.rolling-skill-version-card code {\n    overflow-wrap: anywhere;\n}\n\n.rolling-skill-manifest-details {\n    background: var(--dsw-alias-bg-layer-1);\n    border: 1px solid var(--dsw-alias-border-l3);\n    border-radius: 8px;\n    margin-top: 14px;\n    padding: 10px 12px;\n}\n\n.rolling-skill-manifest-details > summary {\n    cursor: pointer;\n    font-size: 13px;\n    font-weight: 600;\n}\n\n.rolling-skill-manifest-details .rolling-skill-manifest {\n    border: 0;\n    border-radius: 0;\n    border-top: 1px solid var(--dsw-alias-border-l3);\n    margin: 10px 0 0;\n    padding: 10px 0 0;\n}\n\n.rolling-skill-version-heading {\n    margin: 18px 0 0;\n}\n\n.rolling-skill-managed-path {\n    align-items: center;\n    background: var(--dsw-alias-bg-layer-1);\n    border: 1px solid var(--dsw-alias-border-l3);\n    border-radius: 8px;\n    display: grid;\n    gap: 8px;\n    grid-template-columns: auto minmax(0, 1fr) auto;\n    margin-top: 14px;\n    min-width: 0;\n    padding: 9px 10px;\n}\n\n.rolling-skill-managed-path > span {\n    color: var(--dsw-alias-label-secondary);\n    font-size: 12px;\n}\n\n.rolling-skill-managed-path code {\n    min-width: 0;\n    overflow: hidden;\n    text-overflow: ellipsis;\n    white-space: nowrap;\n}\n\n.rolling-skill-skill-edit-modal {\n    box-sizing: border-box;\n    max-height: min(72vh, 860px);\n    max-width: 1120px;\n    min-width: 0;\n    overflow: auto;\n    width: min(80vw, 1120px);\n}\n\n.rolling-skill-textarea {\n    background: var(--dsw-alias-bg-layer-1);\n    border: 1px solid var(--dsw-alias-border-l3);\n    border-radius: 8px;\n    box-sizing: border-box;\n    color: var(--dsw-alias-label-primary);\n    font: inherit;\n    line-height: 1.5;\n    min-height: 92px;\n    padding: 9px 10px;\n    resize: vertical;\n    width: 100%;\n}\n\n.rolling-skill-skill-edit-status {\n    align-items: center;\n    background: var(--dsw-alias-bg-layer-1);\n    border: 1px solid var(--dsw-alias-border-l3);\n    border-radius: 8px;\n    display: flex;\n    gap: 12px;\n    justify-content: space-between;\n    min-width: 0;\n    padding: 10px 12px;\n}\n\n.rolling-skill-skill-edit-status > div {\n    display: grid;\n    gap: 3px;\n    min-width: 0;\n}\n\n.rolling-skill-skill-edit-status span {\n    color: var(--dsw-alias-label-secondary);\n    font-size: 12px;\n    overflow-wrap: anywhere;\n}\n\n.rolling-skill-skill-edit-layout {\n    display: grid;\n    gap: 12px;\n    grid-template-columns: minmax(0, 0.9fr) minmax(0, 1.1fr);\n    min-width: 0;\n}\n\n.rolling-skill-skill-edit-conversation,\n.rolling-skill-skill-edit-diff {\n    background: var(--dsw-alias-bg-layer-1);\n    border: 1px solid var(--dsw-alias-border-l3);\n    border-radius: 8px;\n    min-width: 0;\n    padding: 12px;\n}\n\n.rolling-skill-skill-edit-messages,\n.rolling-skill-skill-edit-files {\n    display: grid;\n    gap: 8px;\n    max-height: 430px;\n    min-width: 0;\n    overflow: auto;\n}\n\n.rolling-skill-skill-edit-messages article,\n.rolling-skill-skill-edit-files article {\n    border: 1px solid var(--dsw-alias-border-l3);\n    border-radius: 8px;\n    display: grid;\n    gap: 6px;\n    min-width: 0;\n    padding: 10px;\n}\n\n.rolling-skill-skill-edit-messages article[data-role="assistant"] {\n    background: var(--dsw-alias-bg-layer-2);\n}\n\n.rolling-skill-skill-edit-messages p {\n    color: var(--dsw-alias-label-primary);\n    margin: 0;\n    overflow-wrap: anywhere;\n    white-space: pre-wrap;\n}\n\n.rolling-skill-skill-edit-follow-up {\n    display: grid;\n    gap: 8px;\n    grid-template-columns: minmax(0, 1fr) auto;\n    margin-top: 10px;\n    min-width: 0;\n}\n\n.rolling-skill-skill-edit-follow-up .rolling-skill-textarea {\n    min-height: 72px;\n}\n\n.rolling-skill-skill-edit-files article header {\n    align-items: center;\n    display: flex;\n    gap: 8px;\n    justify-content: space-between;\n    min-width: 0;\n}\n\n.rolling-skill-skill-edit-files article header strong,\n.rolling-skill-skill-edit-files article header span {\n    overflow-wrap: anywhere;\n}\n\n.rolling-skill-skill-edit-files article header span,\n.rolling-skill-skill-edit-files article small {\n    color: var(--dsw-alias-label-secondary);\n    font-size: 12px;\n}\n\n.rolling-skill-skill-edit-files pre {\n    font-size: 12px;\n    margin: 0;\n    max-height: 320px;\n    overflow: auto;\n    white-space: pre;\n}\n\n.rolling-skill-version-workflow {\n    background: var(--dsw-alias-bg-layer-1);\n    border: 1px solid var(--dsw-alias-border-l2);\n    border-radius: 8px;\n    display: grid;\n    gap: 12px;\n    margin-top: 18px;\n    padding: 14px;\n}\n\n.rolling-skill-version-workflow h4,\n.rolling-skill-version-workflow p {\n    margin: 0;\n}\n\n.rolling-skill-version-workflow p {\n    color: var(--dsw-alias-label-secondary);\n    font-size: 13px;\n}\n\n.rolling-skill-version-workflow .rolling-skill-form-row {\n    margin-top: 0;\n}\n\n.rolling-skill-pagination {\n    align-items: center;\n    color: var(--dsw-alias-label-secondary);\n    display: flex;\n    gap: 10px;\n    justify-content: center;\n    margin-top: 14px;\n}\n\n.rolling-skill-group-list,\n.rolling-skill-raw-group,\n.rolling-skill-detail-stack {\n    display: grid;\n    gap: 12px;\n}\n\n.rolling-skill-group-list {\n    margin-top: 14px;\n}\n\n.rolling-skill-raw-filter-toolbar {\n    align-items: end;\n    display: grid;\n    gap: 10px;\n    grid-template-columns: minmax(0, 1fr) minmax(190px, 280px);\n}\n\n.rolling-skill-raw-skill-select {\n    color: var(--dsw-alias-label-secondary);\n    display: grid;\n    font-size: 12px;\n    gap: 5px;\n}\n\n.rolling-skill-raw-skill-select .rolling-skill-select {\n    margin-top: 0;\n    max-width: none;\n}\n\n.rolling-skill-raw-group-filter {\n    align-items: center;\n    background: var(--dsw-alias-bg-layer-1);\n    border: 1px solid var(--dsw-alias-border-l3);\n    border-radius: 7px;\n    color: var(--dsw-alias-label-primary);\n    cursor: pointer;\n    display: flex;\n    font: inherit;\n    gap: 8px;\n    justify-content: space-between;\n    max-width: 100%;\n    min-width: 0;\n    padding: 7px 10px;\n    text-align: left;\n    width: fit-content;\n}\n\n.rolling-skill-raw-group-filter[aria-pressed="true"] {\n    background: var(--dsw-alias-bg-layer-2);\n    border-color: var(--dsw-alias-state-business-primary);\n}\n\n.rolling-skill-raw-group-filter strong {\n    overflow-wrap: anywhere;\n}\n\n.rolling-skill-raw-group-filter span {\n    color: var(--dsw-alias-label-secondary);\n    font-size: 12px;\n}\n\n.rolling-skill-verbatim {\n    overflow-wrap: anywhere;\n    white-space: pre-wrap;\n}\n\n.rolling-skill-detail-stack h4,\n.rolling-skill-detail-stack p {\n    margin: 0;\n}\n\n.rolling-skill-detail-stack pre {\n    background: var(--dsw-alias-bg-layer-1);\n    border: 1px solid var(--dsw-alias-border-l3);\n    border-radius: 8px;\n    max-height: 320px;\n    overflow: auto;\n    padding: 10px;\n    white-space: pre-wrap;\n}\n\n.rolling-skill-muted,\n.rolling-skill-range-hint {\n    color: var(--dsw-alias-label-secondary);\n}\n\n.rolling-skill-evidence-summary {\n    display: grid;\n    gap: 8px;\n    grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));\n    margin: 0;\n}\n\n.rolling-skill-evidence-summary > div {\n    background: var(--dsw-alias-bg-layer-1);\n    border: 1px solid var(--dsw-alias-border-l3);\n    border-radius: 8px;\n    display: grid;\n    gap: 4px;\n    min-width: 0;\n    padding: 10px;\n}\n\n.rolling-skill-evidence-summary dt {\n    color: var(--dsw-alias-label-secondary);\n    font-size: 12px;\n}\n\n.rolling-skill-evidence-summary dd {\n    margin: 0;\n    overflow-wrap: anywhere;\n}\n\n.rolling-skill-capture-range-card {\n    background: var(--dsw-alias-bg-layer-1);\n    border: 1px solid var(--dsw-alias-border-l2);\n    border-radius: 10px;\n    display: grid;\n    gap: 10px;\n    padding: 12px;\n}\n\n.rolling-skill-capture-evidence-timeline {\n    display: grid;\n    gap: 8px;\n    list-style: none;\n    margin: 0;\n    padding: 0;\n}\n\n.rolling-skill-capture-evidence-timeline > li {\n    border: 1px solid var(--dsw-alias-border-l3);\n    border-inline-start: 3px solid var(--dsw-alias-border-l2);\n    border-radius: 8px;\n    min-width: 0;\n    overflow: hidden;\n}\n\n.rolling-skill-capture-evidence-timeline > li[data-kind="user"] {\n    background: var(--dsw-alias-bg-layer-2);\n}\n\n.rolling-skill-capture-evidence-timeline > li[data-kind="assistant"] {\n    background: var(--dsw-alias-bg-layer-1);\n}\n\n.rolling-skill-capture-evidence-timeline > li[data-boundary="start"],\n.rolling-skill-capture-evidence-timeline > li[data-boundary="end"] {\n    border-inline-start-color: var(--dsw-alias-state-business-primary);\n}\n\n.rolling-skill-capture-evidence-timeline article {\n    display: grid;\n    gap: 8px;\n    padding: 10px 12px;\n}\n\n.rolling-skill-capture-evidence-timeline article header,\n.rolling-skill-capture-tool summary {\n    align-items: center;\n    display: flex;\n    gap: 8px;\n    justify-content: space-between;\n}\n\n.rolling-skill-capture-context summary {\n    color: var(--dsw-alias-label-secondary);\n    cursor: pointer;\n    padding: 10px 12px;\n}\n\n.rolling-skill-capture-context p {\n    border-top: 1px solid var(--dsw-alias-border-l3);\n    margin: 0;\n    max-height: 240px;\n    overflow: auto;\n    padding: 10px 12px;\n    white-space: pre-wrap;\n}\n\n.rolling-skill-capture-evidence-timeline article header span,\n.rolling-skill-capture-tool summary span {\n    color: var(--dsw-alias-label-secondary);\n    font-size: 12px;\n}\n\n.rolling-skill-capture-evidence-timeline article p {\n    margin: 0;\n    overflow-wrap: anywhere;\n    white-space: pre-wrap;\n}\n\n.rolling-skill-capture-tool summary {\n    cursor: pointer;\n    padding: 10px 12px;\n}\n\n.rolling-skill-capture-tool-details {\n    border-top: 1px solid var(--dsw-alias-border-l3);\n    display: grid;\n    gap: 10px;\n    padding: 10px 12px;\n}\n\n.rolling-skill-capture-tool-details > div {\n    display: grid;\n    gap: 5px;\n    min-width: 0;\n}\n\n.rolling-skill-capture-tool-details pre {\n    background: var(--dsw-alias-bg-layer-2);\n    border-radius: 6px;\n    margin: 0;\n    max-height: 240px;\n    overflow: auto;\n    padding: 8px;\n    white-space: pre-wrap;\n}\n\n.rolling-skill-capture-evidence-error {\n    align-items: flex-start;\n    border: 1px solid var(--dsw-alias-state-error-primary);\n    border-radius: 8px;\n    display: grid;\n    gap: 6px;\n    padding: 10px;\n}\n\n.rolling-skill-capture-evidence-error p,\n.rolling-skill-capture-evidence-error small {\n    margin: 0;\n}\n\n.rolling-skill-capture-boundaries {\n    display: grid;\n    gap: 8px;\n}\n\n.rolling-skill-capture-boundaries article {\n    align-items: flex-start;\n    background: var(--dsw-alias-bg-layer-2);\n    border: 1px solid var(--dsw-alias-border-l3);\n    border-radius: 8px;\n    display: grid;\n    gap: 10px;\n    grid-template-columns: 26px minmax(0, 1fr);\n    padding: 10px;\n}\n\n.rolling-skill-capture-boundaries article > div {\n    display: grid;\n    gap: 5px;\n    min-width: 0;\n}\n\n.rolling-skill-capture-boundaries p,\n.rolling-skill-capture-boundaries code,\n.rolling-skill-range-hint {\n    margin: 0;\n    overflow-wrap: anywhere;\n}\n\n.rolling-skill-capture-boundaries code {\n    color: var(--dsw-alias-label-secondary);\n    font-size: 11px;\n}\n\n.rolling-skill-range-index {\n    align-items: center;\n    border: 1px solid var(--dsw-alias-state-business-primary);\n    border-radius: 50%;\n    color: var(--dsw-alias-state-business-primary);\n    display: inline-flex;\n    font-size: 12px;\n    height: 24px;\n    justify-content: center;\n    width: 24px;\n}\n\n.rolling-skill-advanced-evidence {\n    border-top: 1px solid var(--dsw-alias-border-l3);\n    padding-top: 10px;\n}\n\n.rolling-skill-advanced-evidence > summary {\n    color: var(--dsw-alias-label-secondary);\n    cursor: pointer;\n}\n\n[role="dialog"]:has(> div > div > .rolling-skill-capture-evidence) {\n    max-height: calc(100vh - 32px);\n}\n\n[role="dialog"]:has(> div > div > .rolling-skill-capture-evidence) > div:first-child {\n    min-height: 0;\n    overflow: hidden;\n}\n\n[role="dialog"]:has(> div > div > .rolling-skill-capture-evidence) > div:first-child > div:last-child {\n    min-height: 0;\n    overflow-y: auto;\n}\n\n.rolling-skill-case-copy p {\n    margin: 0;\n    white-space: pre-wrap;\n}\n\n.rolling-skill-markdown {\n    line-height: 1.55;\n    min-width: 0;\n    overflow-wrap: anywhere;\n}\n\n.rolling-skill-markdown > :first-child {\n    margin-top: 0;\n}\n\n.rolling-skill-markdown > :last-child {\n    margin-bottom: 0;\n}\n\n.rolling-skill-case-copy .rolling-skill-markdown p,\n.rolling-skill-detail-stack .rolling-skill-markdown p {\n    margin: 0 0 8px;\n    white-space: normal;\n}\n\n.rolling-skill-markdown h1,\n.rolling-skill-markdown h2,\n.rolling-skill-markdown h3,\n.rolling-skill-markdown h4,\n.rolling-skill-markdown h5,\n.rolling-skill-markdown h6 {\n    line-height: 1.3;\n    margin: 12px 0 7px;\n}\n\n.rolling-skill-markdown ul,\n.rolling-skill-markdown ol {\n    margin: 7px 0;\n    padding-inline-start: 22px;\n}\n\n.rolling-skill-markdown li + li {\n    margin-top: 3px;\n}\n\n.rolling-skill-markdown blockquote {\n    border-inline-start: 3px solid var(--dsw-alias-border-l2);\n    color: var(--dsw-alias-label-secondary);\n    margin: 8px 0;\n    padding-inline-start: 10px;\n}\n\n.rolling-skill-markdown code {\n    background: var(--dsw-alias-bg-layer-1);\n    border: 1px solid var(--dsw-alias-border-l3);\n    border-radius: 4px;\n    font-family: ui-monospace, monospace;\n    font-size: 0.92em;\n    padding: 1px 4px;\n}\n\n.rolling-skill-markdown pre {\n    background: var(--dsw-alias-bg-layer-1);\n    border: 1px solid var(--dsw-alias-border-l3);\n    border-radius: 8px;\n    max-width: 100%;\n    overflow: auto;\n    padding: 10px;\n    white-space: pre;\n}\n\n.rolling-skill-markdown pre code {\n    background: transparent;\n    border: 0;\n    padding: 0;\n}\n\n.rolling-skill-markdown a {\n    color: var(--dsw-alias-state-business-primary);\n}\n\n.rolling-skill-markdown-image-placeholder {\n    color: var(--dsw-alias-label-secondary);\n    font-style: italic;\n}\n\n.rolling-skill-markdown-compact {\n    max-height: 9.5em;\n    overflow: hidden;\n}\n\n.rolling-skill-case-question .rolling-skill-markdown {\n    color: var(--dsw-alias-label-primary);\n    font-weight: 600;\n}\n\n.rolling-skill-select,\n.rolling-skill-form-stack input,\n.rolling-skill-field input,\n.rolling-skill-form-stack textarea {\n    background: var(--dsw-alias-bg-layer-1);\n    border: 1px solid var(--dsw-alias-border-l2);\n    border-radius: 7px;\n    color: var(--dsw-alias-label-primary);\n    font: inherit;\n    padding: 8px 10px;\n}\n\n.rolling-skill-review-layout {\n    display: grid;\n    gap: 14px;\n    grid-template-columns: minmax(260px, 360px) minmax(0, 1fr);\n    min-height: 560px;\n}\n\n.rolling-skill-review-list,\n.rolling-skill-review-detail,\n.rolling-skill-session-view {\n    min-width: 0;\n}\n\n.rolling-skill-review-list-button {\n    background: var(--dsw-alias-bg-layer-1);\n    border: 1px solid var(--dsw-alias-border-l3);\n    border-radius: 8px;\n    color: var(--dsw-alias-label-primary);\n    cursor: pointer;\n    display: grid;\n    font: inherit;\n    gap: 5px;\n    padding: 10px;\n    text-align: left;\n    width: 100%;\n}\n\n.rolling-skill-review-list-button[data-selected="true"] {\n    border-color: var(--dsw-alias-state-business-primary);\n}\n\n.rolling-skill-review-list-button span {\n    color: var(--dsw-alias-label-secondary);\n    font-size: 12px;\n}\n\n.rolling-skill-review-scope {\n    background: var(--dsw-alias-bg-layer-1);\n    border: 1px solid var(--dsw-alias-border-l3);\n    border-radius: 9px;\n    display: grid;\n    gap: 3px;\n    grid-template-columns: repeat(2, minmax(0, 1fr));\n    margin-top: 12px;\n    padding: 3px;\n}\n\n.rolling-skill-review-scope button {\n    background: transparent;\n    border: 1px solid transparent;\n    border-radius: 7px;\n    color: var(--dsw-alias-label-secondary);\n    cursor: pointer;\n    font: inherit;\n    min-width: 0;\n    padding: 7px 9px;\n}\n\n.rolling-skill-review-scope button[aria-pressed="true"] {\n    background: var(--dsw-alias-bg-layer-2);\n    border-color: var(--dsw-alias-border-l2);\n    color: var(--dsw-alias-label-primary);\n    font-weight: 600;\n}\n\n.rolling-skill-review-scope span {\n    color: var(--dsw-alias-label-secondary);\n    font-size: 11px;\n}\n\n.rolling-skill-session-view,\n.rolling-skill-evidence-card,\n.rolling-skill-conversation-log,\n.rolling-skill-rubric-draft {\n    display: grid;\n    gap: 12px;\n}\n\n.rolling-skill-curation-draft-card {\n    background: var(--dsw-alias-bg-layer-1);\n    border: 1px solid var(--dsw-alias-border-l3);\n    border-radius: 8px;\n    display: grid;\n    gap: 12px;\n    padding: 12px;\n}\n\n.rolling-skill-curation-draft-card > header {\n    align-items: flex-start;\n    display: flex;\n    gap: 10px;\n    justify-content: space-between;\n}\n\n.rolling-skill-curation-draft-card h4,\n.rolling-skill-curation-draft-card p {\n    margin: 0;\n}\n\n.rolling-skill-curation-draft-details {\n    border-top: 1px solid var(--dsw-alias-border-l3);\n    padding-top: 9px;\n}\n\n.rolling-skill-curation-draft-details > summary {\n    color: var(--dsw-alias-label-secondary);\n    cursor: pointer;\n}\n\n.rolling-skill-curation-draft-details > div {\n    display: grid;\n    gap: 12px;\n    margin-top: 10px;\n}\n\n.rolling-skill-curation-primary,\n.rolling-skill-curation-composer,\n.rolling-skill-curation-runtime-details > .rolling-skill-evidence-card {\n    display: grid;\n    gap: 10px;\n}\n\n.rolling-skill-curation-composer {\n    background: var(--dsw-alias-bg-layer-1);\n    border: 1px solid var(--dsw-alias-state-business-primary);\n    border-radius: 10px;\n    padding: 12px;\n}\n\n.rolling-skill-curation-composer h4,\n.rolling-skill-curation-composer p {\n    margin: 0;\n}\n\n.rolling-skill-curation-composer > div:first-child p {\n    color: var(--dsw-alias-label-secondary);\n    font-size: 12px;\n    margin-top: 4px;\n}\n\n.rolling-skill-curation-composer textarea {\n    background: var(--dsw-alias-bg-layer-2);\n    border: 1px solid var(--dsw-alias-border-l2);\n    border-radius: 8px;\n    color: var(--dsw-alias-label-primary);\n    font: inherit;\n    min-height: 104px;\n    padding: 10px;\n    resize: vertical;\n}\n\n.rolling-skill-curation-runtime-details {\n    border-top: 1px solid var(--dsw-alias-border-l3);\n    padding-top: 10px;\n}\n\n.rolling-skill-curation-runtime-details > summary {\n    color: var(--dsw-alias-label-secondary);\n    cursor: pointer;\n}\n\n.rolling-skill-curation-runtime-details > .rolling-skill-evidence-card {\n    margin-top: 10px;\n}\n\n.rolling-skill-curation-model-controls {\n    display: grid;\n    gap: 10px;\n    grid-template-columns: repeat(2, minmax(0, 1fr));\n}\n\n.rolling-skill-session-view h4,\n.rolling-skill-review-list h4 {\n    margin: 8px 0 0;\n}\n\n.rolling-skill-session-view pre,\n.rolling-skill-evidence-card pre {\n    background: var(--dsw-alias-bg-layer-1);\n    border: 1px solid var(--dsw-alias-border-l3);\n    border-radius: 8px;\n    max-height: 340px;\n    overflow: auto;\n    padding: 12px;\n    white-space: pre-wrap;\n}\n\n.rolling-skill-conversation-log > div,\n.rolling-skill-rubric-draft article {\n    background: var(--dsw-alias-bg-layer-1);\n    border: 1px solid var(--dsw-alias-border-l3);\n    border-radius: 8px;\n    padding: 10px;\n}\n\n.rolling-skill-conversation-log p,\n.rolling-skill-rubric-draft p {\n    margin: 6px 0 0;\n    white-space: pre-wrap;\n}\n\n.rolling-skill-create-rubric {\n    border-bottom: 1px solid var(--dsw-alias-border-l2);\n    padding-bottom: 14px;\n}\n\n.rolling-skill-select {\n    margin-top: 14px;\n    max-width: 360px;\n    width: 100%;\n}\n\n.rolling-skill-form-stack label {\n    display: grid;\n    gap: 6px;\n}\n\n.rolling-skill-form-stack textarea {\n    min-height: 120px;\n    resize: vertical;\n}\n\n.rolling-skill-check {\n    align-items: center;\n    display: flex;\n    gap: 8px;\n    margin-top: 12px;\n}\n\n.rolling-skill-badge {\n    color: var(--dsw-alias-state-business-primary);\n    font-size: 11px;\n    font-weight: 600;\n}\n\n.rolling-skill-audit-grid,\n.rolling-skill-rubric-criteria,\n.rolling-skill-evaluation-results,\n.rolling-skill-score-list {\n    display: grid;\n    gap: 10px;\n}\n\n.rolling-skill-audit-grid {\n    grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));\n    margin-top: 12px;\n}\n\n.rolling-skill-audit-card,\n.rolling-skill-rubric-version,\n.rolling-skill-evaluation-result,\n.rolling-skill-score-item {\n    background: var(--dsw-alias-bg-layer-1);\n    border: 1px solid var(--dsw-alias-border-l3);\n    border-radius: 8px;\n    min-width: 0;\n    padding: 12px;\n}\n\n.rolling-skill-audit-card header,\n.rolling-skill-rubric-version > summary,\n.rolling-skill-rubric-criteria article header,\n.rolling-skill-evaluation-result > header,\n.rolling-skill-score-item > header {\n    align-items: flex-start;\n    display: flex;\n    gap: 10px;\n    justify-content: space-between;\n}\n\n.rolling-skill-audit-card > button {\n    margin-top: 10px;\n}\n\n.rolling-skill-audit-card code,\n.rolling-skill-rubric-version code,\n.rolling-skill-evidence-card code {\n    overflow-wrap: anywhere;\n}\n\n.rolling-skill-rubric-version > summary {\n    cursor: pointer;\n}\n\n.rolling-skill-rubric-version > summary > span:first-child,\n.rolling-skill-evaluation-result > header > div,\n.rolling-skill-score-item > header + small {\n    display: grid;\n    gap: 4px;\n}\n\n.rolling-skill-rubric-version-body {\n    border-top: 1px solid var(--dsw-alias-border-l3);\n    display: grid;\n    gap: 12px;\n    margin-top: 12px;\n    padding-top: 12px;\n}\n\n.rolling-skill-rubric-version-body h4 {\n    margin: 4px 0 0;\n}\n\n.rolling-skill-rubric-criteria article {\n    background: var(--dsw-alias-bg-layer-2);\n    border: 1px solid var(--dsw-alias-border-l3);\n    border-radius: 8px;\n    padding: 10px;\n}\n\n.rolling-skill-evaluation-result {\n    display: grid;\n    gap: 12px;\n}\n\n.rolling-skill-score-total {\n    color: var(--dsw-alias-state-business-primary);\n    font-size: 24px;\n    font-weight: 700;\n    white-space: nowrap;\n}\n\n.rolling-skill-score-total small {\n    color: var(--dsw-alias-label-secondary);\n    font-size: 12px;\n}\n\n.rolling-skill-score-breakdown,\n.rolling-skill-trace,\n.rolling-skill-evaluation-result > details {\n    border-top: 1px solid var(--dsw-alias-border-l3);\n    padding-top: 10px;\n}\n\n.rolling-skill-score-breakdown > summary,\n.rolling-skill-trace > summary,\n.rolling-skill-evaluation-result > details > summary {\n    cursor: pointer;\n    font-weight: 600;\n}\n\n.rolling-skill-score-list,\n.rolling-skill-trace-list {\n    margin-top: 10px;\n}\n\n.rolling-skill-score-item p {\n    margin: 6px 0 0;\n}\n\n.rolling-skill-score-critical {\n    border-color: var(--dsw-alias-state-error-primary);\n}\n\n.rolling-skill-judge-meta,\n.rolling-skill-trace-summary {\n    color: var(--dsw-alias-label-secondary);\n    font-size: 12px;\n}\n\n.rolling-skill-trace-summary {\n    align-items: center;\n    display: flex;\n    flex-wrap: wrap;\n    gap: 8px;\n    margin-top: 10px;\n}\n\n.rolling-skill-trace-list {\n    display: grid;\n    gap: 6px;\n    max-height: 360px;\n    overflow: auto;\n    padding-left: 0;\n}\n\n.rolling-skill-trace-list li {\n    align-items: flex-start;\n    background: var(--dsw-alias-bg-layer-2);\n    border: 1px solid var(--dsw-alias-border-l3);\n    border-radius: 7px;\n    display: grid;\n    gap: 8px;\n    grid-template-columns: minmax(48px, auto) 1fr;\n    list-style: none;\n    padding: 8px;\n}\n\n.rolling-skill-trace-list li > span {\n    display: grid;\n    gap: 4px;\n    min-width: 0;\n}\n\n.rolling-skill-inline-error {\n    color: var(--dsw-alias-label-error) !important;\n}\n\n.rolling-skill-dialog-backdrop {\n    align-items: center;\n    background: var(--dsw-alias-bg-mask-1);\n    display: flex;\n    inset: 0;\n    justify-content: center;\n    padding: 20px;\n    position: fixed;\n    z-index: 1000;\n}\n\n.rolling-skill-dialog {\n    background: var(--dsw-alias-bg-layer-2);\n    border: 1px solid var(--dsw-alias-border-l2);\n    border-radius: 12px;\n    color: var(--dsw-alias-label-primary);\n    display: grid;\n    gap: 18px;\n    max-height: min(760px, calc(100vh - 40px));\n    max-width: 620px;\n    min-width: 0;\n    overflow: auto;\n    padding: 20px;\n    width: 100%;\n}\n\n.rolling-skill-dialog-header {\n    align-items: flex-start;\n    display: flex;\n    gap: 16px;\n    justify-content: space-between;\n}\n\n.rolling-skill-dialog-header h2,\n.rolling-skill-dialog-header p {\n    margin: 0;\n}\n\n.rolling-skill-dialog-header p {\n    color: var(--dsw-alias-label-secondary);\n    margin-top: 6px;\n}\n\n.rolling-skill-dialog .rolling-skill-select {\n    margin-top: 0;\n    max-width: none;\n}\n\n.rolling-skill-label-fieldset {\n    border: 0;\n    display: flex;\n    gap: 16px;\n    margin: 0;\n    padding: 0;\n}\n\n.rolling-skill-label-fieldset legend {\n    color: var(--dsw-alias-label-secondary);\n    font-size: 12px;\n    font-weight: 600;\n    margin-bottom: 8px;\n}\n\n.rolling-skill-label-fieldset label {\n    align-items: center;\n    display: flex;\n    gap: 6px;\n}\n\n.rolling-skill-blockers {\n    background: var(--dsw-alias-bg-layer-1);\n    border: 1px solid var(--dsw-alias-state-warning-primary);\n    border-radius: 8px;\n    color: var(--dsw-alias-label-primary);\n    padding: 12px;\n}\n\n.rolling-skill-blockers ul {\n    margin: 8px 0 0;\n    padding-left: 20px;\n}\n\n.rolling-skill-dialog-actions {\n    justify-content: flex-end;\n}\n\n@media (max-width: 640px) {\n    .rolling-skill-workbench-backdrop {\n        padding: 0;\n    }\n\n    .rolling-skill-workbench-overlay {\n        border-radius: 0;\n        max-height: 100vh;\n        min-height: 100vh;\n        padding: 16px;\n    }\n\n    .rolling-skill-review-layout {\n        grid-template-columns: 1fr;\n    }\n\n    .rolling-skill-raw-filter-toolbar,\n    .rolling-skill-curation-model-controls {\n        grid-template-columns: 1fr;\n    }\n\n    .rolling-skill-dialog-backdrop {\n        align-items: flex-end;\n        padding: 0;\n    }\n\n    .rolling-skill-dialog {\n        border-radius: 12px 12px 0 0;\n        max-height: 90vh;\n    }\n}\n\n[data-chat-flow-key].rolling-skill-curation-draft {\n    background: var(--dsw-alias-state-warn-tertiary);\n    border-inline-start: 3px solid var(--dsw-alias-state-warn-primary);\n    box-shadow: inset 3px 0 var(--dsw-alias-state-warn-primary);\n}\n\n[data-chat-flow-key].rolling-skill-curation-saved {\n    background: var(--dsw-alias-state-success-tertiary);\n    border-inline-start: 3px solid var(--dsw-alias-state-success-primary);\n    box-shadow: inset 3px 0 var(--dsw-alias-state-success-primary);\n}\n\n[data-chat-flow-key].rolling-skill-capture-range {\n    background: var(--dsw-alias-interactive-bg-active);\n    border-inline-start: 3px solid var(--dsw-alias-state-business-primary);\n    box-shadow: inset 3px 0 var(--dsw-alias-state-business-primary);\n    scroll-margin-block: 96px;\n}\n\n[data-rolling-skill-curation-status="draft"] {\n    background: var(--dsw-alias-state-warn-tertiary);\n    border-color: var(--dsw-alias-state-warn-primary);\n    color: var(--dsw-alias-state-warn-primary);\n}\n\n[data-rolling-skill-curation-status="saved"] {\n    background: var(--dsw-alias-state-success-tertiary);\n    border-color: var(--dsw-alias-state-success-primary);\n    color: var(--dsw-alias-state-success-primary);\n}\n\n.rolling-skill-marker-legend {\n    align-items: center;\n    display: flex;\n    flex-wrap: wrap;\n    gap: 6px;\n}\n\n.rolling-skill-marker-chip,\n.rolling-skill-marker-compatibility {\n    border: 1px solid var(--dsw-alias-border-l2);\n    border-radius: 999px;\n    color: var(--dsw-alias-label-secondary);\n    font-size: 11px;\n    padding: 3px 7px;\n}\n\n.rolling-skill-marker-chip-draft {\n    border-color: var(--dsw-alias-state-warn-primary);\n}\n\n.rolling-skill-marker-chip-saved {\n    border-color: var(--dsw-alias-state-success-primary);\n}\n\n.rolling-skill-runtime-select {\n    border: 0;\n    display: grid;\n    gap: 8px;\n    margin: 16px 0;\n    min-width: 0;\n    padding: 0;\n}\n\n.rolling-skill-runtime-select legend,\n.rolling-skill-field > span {\n    color: var(--dsw-alias-label-secondary);\n    font-size: 12px;\n    font-weight: 600;\n}\n\n.rolling-skill-runtime-list {\n    display: grid;\n    gap: 8px;\n    grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));\n}\n\n.rolling-skill-runtime-option {\n    align-items: flex-start;\n    background: var(--dsw-alias-bg-layer-1);\n    border: 1px solid var(--dsw-alias-border-l2);\n    border-radius: 8px;\n    display: flex;\n    gap: 9px;\n    min-width: 0;\n    padding: 10px;\n}\n\n.rolling-skill-runtime-option:has(input:checked) {\n    border-color: var(--dsw-alias-state-business-primary);\n}\n\n.rolling-skill-runtime-option > span,\n.rolling-skill-field {\n    display: grid;\n    gap: 5px;\n    min-width: 0;\n}\n\n.rolling-skill-runtime-option code {\n    color: var(--dsw-alias-label-secondary);\n    font-family: ui-monospace, monospace;\n    font-size: 11px;\n    overflow-wrap: anywhere;\n}\n\n.rolling-skill-link-button {\n    background: transparent;\n    border: 0;\n    color: var(--dsw-alias-state-business-primary);\n    cursor: pointer;\n    padding: 0;\n    text-align: left;\n}\n\n.rolling-skill-field .rolling-skill-select {\n    margin-top: 0;\n}\n\n.rolling-skill-skill-row {\n    background: var(--dsw-alias-bg-layer-1);\n    border: 1px solid var(--dsw-alias-border-l3);\n    border-radius: 8px;\n    color: var(--dsw-alias-label-primary);\n    cursor: pointer;\n    display: grid;\n    gap: 4px;\n    padding: 11px;\n    text-align: left;\n}\n\n.rolling-skill-skill-row span {\n    color: var(--dsw-alias-label-secondary);\n    font-size: 12px;\n}\n\n.rolling-skill-manifest {\n    background: var(--dsw-alias-bg-layer-1);\n    border: 1px solid var(--dsw-alias-border-l3);\n    border-radius: 8px;\n    color: var(--dsw-alias-label-secondary);\n    max-height: 240px;\n    overflow: auto;\n    padding: 12px;\n    white-space: pre-wrap;\n}\n\n.rolling-skill-subpanel {\n    display: grid;\n    gap: 9px;\n}\n\n.rolling-skill-subpanel h4 {\n    margin: 0;\n}\n\n.rolling-skill-section-gap {\n    margin-top: 14px;\n}\n\n.rolling-skill-list-row small {\n    color: var(--dsw-alias-label-secondary);\n    overflow-wrap: anywhere;\n}\n\n@media (max-width: 760px) {\n    .rolling-skill-panel-header,\n    .rolling-skill-list-row,\n    .rolling-skill-case-row,\n    .rolling-skill-form-row {\n        align-items: flex-start;\n        flex-direction: column;\n    }\n\n    .rolling-skill-panel-header > :first-child,\n    .rolling-skill-list-row > :first-child,\n    .rolling-skill-case-row > :first-child,\n    .rolling-skill-form-row > :first-child:not(.rolling-skill-action-button),\n    .rolling-skill-list-row > .rolling-skill-actions,\n    .rolling-skill-case-row > .rolling-skill-actions {\n        box-sizing: border-box;\n        max-width: 100%;\n        width: 100%;\n    }\n\n    .rolling-skill-review-layout {\n        grid-template-columns: 1fr;\n    }\n\n    .rolling-skill-candidate-target {\n        grid-template-columns: minmax(0, 1fr);\n    }\n\n    .rolling-skill-skill-import {\n        align-items: stretch;\n        grid-template-columns: minmax(0, 1fr);\n    }\n\n    .rolling-skill-skill-source-picker {\n        grid-template-columns: auto minmax(0, 1fr);\n    }\n\n    .rolling-skill-current-skill {\n        align-items: stretch;\n        grid-template-columns: minmax(0, 1fr);\n    }\n\n    .rolling-skill-candidate-target .rolling-skill-select {\n        grid-column: 1;\n    }\n}\n\n@media (max-width: 960px) {\n    .rolling-skill-skill-edit-layout {\n        grid-template-columns: minmax(0, 1fr);\n    }\n\n    .rolling-skill-skill-edit-modal {\n        width: min(88vw, 760px);\n    }\n}\n\n@media (max-width: 640px) {\n    .rolling-skill-header {\n        align-items: flex-start;\n        flex-direction: column;\n    }\n\n    .rolling-skill-header > :first-child {\n        width: 100%;\n    }\n\n    .rolling-skill-managed-path,\n    .rolling-skill-skill-edit-follow-up {\n        align-items: stretch;\n        grid-template-columns: minmax(0, 1fr);\n    }\n\n    .rolling-skill-skill-edit-modal {\n        width: 100%;\n    }\n}\n';

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
  caseManagement: "Case \u6C89\u6DC0\u4E0E\u7BA1\u7406",
  skillAndInstallation: "Skill \u4E0E\u5B89\u88C5",
  evaluationAndOptimization: "\u8BC4\u6D4B\u4E0E\u4F18\u5316",
  workbenchSections: "\u5DE5\u4F5C\u53F0\u529F\u80FD\u5206\u7EC4",
  workbenchPages: "\u5F53\u524D\u5206\u7EC4\u9875\u9762",
  cases: "Case \u4E0E\u6570\u636E\u96C6",
  evaluations: "Skill \u8BC4\u6D4B",
  automatic: "\u81EA\u52A8\u6C89\u6DC0",
  automaticTitle: "\u81EA\u52A8\u6C89\u6DC0",
  automaticDescription: "\u5B9A\u65F6\u68C0\u67E5\u65B0\u5BF9\u8BDD\uFF0C\u8BC6\u522B\u5B8C\u6574\u95EE\u9898\uFF0C\u5E76\u6309\u6A21\u5F0F\u751F\u6210 Raw Case \u6216\u81EA\u52A8\u4FDD\u5B58 Case\u3002",
  automaticMode: "\u6C89\u6DC0\u6A21\u5F0F",
  automaticOff: "\u5173\u95ED",
  automaticScheduled: "\u5B9A\u65F6\u63D0\u53D6",
  automaticFull: "\u5B8C\u5168\u81EA\u52A8",
  executionLocation: "\u8FD0\u884C\u4F4D\u7F6E",
  whileHarnessRunning: "\u4EC5\u5728 Harness \u6253\u5F00\u65F6\u8FD0\u884C",
  alwaysRunning: "Harness \u5173\u95ED\u540E\u4E5F\u6309\u8BA1\u5212\u8FD0\u884C",
  cadence: "\u6267\u884C\u5468\u671F",
  daily: "\u6BCF\u5929",
  weekly: "\u6BCF\u5468",
  captureTime: "\u6267\u884C\u65F6\u95F4",
  captureHour: "\u6267\u884C\u5C0F\u65F6",
  captureMinute: "\u6267\u884C\u5206\u949F",
  hourUnit: "\u65F6",
  minuteUnit: "\u5206",
  weekday: "\u661F\u671F",
  weekday0: "\u661F\u671F\u65E5",
  weekday1: "\u661F\u671F\u4E00",
  weekday2: "\u661F\u671F\u4E8C",
  weekday3: "\u661F\u671F\u4E09",
  weekday4: "\u661F\u671F\u56DB",
  weekday5: "\u661F\u671F\u4E94",
  weekday6: "\u661F\u671F\u516D",
  automaticRuntime: "Case \u68C0\u6D4B Runtime",
  automaticDataset: "\u76EE\u6807\u6570\u636E\u96C6",
  automaticDatasetMatch: "\u7531 Skill \u81EA\u52A8\u5339\u914D",
  candidateSkills: "\u5019\u9009 Skill \u4E0E\u6570\u636E\u96C6",
  candidateSkillsDescription: "\u53EA\u68C0\u6D4B\u52FE\u9009\u7684\u53D7\u7BA1 Skill\uFF0C\u5E76\u5C06\u547D\u4E2D\u7684 Case \u9001\u5230\u65C1\u8FB9\u9009\u62E9\u7684\u6570\u636E\u96C6\uFF1B\u4E0D\u52FE\u9009\u65F6\u68C0\u6D4B Runtime \u4E2D\u6240\u6709\u5DF2\u542F\u7528 Skill\uFF0C\u5E76\u81EA\u52A8\u5339\u914D\u552F\u4E00\u6570\u636E\u96C6\u3002",
  candidateSkillNoDataset: "\u6CA1\u6709\u53EF\u7528\u7684\u7ED1\u5B9A\u6570\u636E\u96C6\uFF1B\u5B8C\u5168\u81EA\u52A8\u6A21\u5F0F\u8FD8\u8981\u6C42\u6570\u636E\u96C6\u5DF2\u53D1\u5E03\u8BC4\u5206\u6807\u51C6\u3002",
  candidateSkillUnavailable: "\u8FD9\u4E2A\u5DF2\u4FDD\u5B58\u7684\u5019\u9009 Skill \u5F53\u524D\u4E0D\u53EF\u7528\uFF1B\u53D6\u6D88\u52FE\u9009\u540E\u5373\u53EF\u79FB\u9664\u65E7\u6620\u5C04\u3002",
  candidateDatasetOnlyOne: "\u5F53\u524D\u53EA\u6709 1 \u4E2A\u53EF\u7528\u6570\u636E\u96C6\uFF1B\u5982\u9700\u66F4\u591A\u9009\u9879\uFF0C\u8BF7\u5148\u5230\u201C\u6570\u636E\u96C6\u201D\u9875\u521B\u5EFA\u5E76\u7ED1\u5B9A\u5230\u5F53\u524D Skill\u3002",
  datasetRubricRequiredSuffix: "\uFF08\u672A\u53D1\u5E03\u8BC4\u5206\u6807\u51C6\uFF09",
  noCandidateSkills: "\u6682\u65E0\u53EF\u9009\u7684\u53D7\u7BA1 Skill\u3002",
  automaticFlowSummaryPrefix: "\u68C0\u6D4B\u6A21\u578B\u8BC6\u522B\u5B8C\u6574 Case \u5E76\u5224\u65AD\u5F52\u5C5E\uFF1B\u5B8C\u5168\u81EA\u52A8\u6A21\u5F0F\u7531 Curator\uFF08",
  automaticFlowSummarySuffix: "\uFF09\u6574\u7406\uFF0C\u6821\u9A8C\u901A\u8FC7\u540E\u4FDD\u5B58\u4E3A Case\uFF0C\u4E0D\u8FD0\u884C Judge\u3002",
  automaticDetectionModel: "Case \u68C0\u6D4B\u6A21\u578B",
  automaticDetectionEffort: "\u68C0\u6D4B\u63A8\u7406\u5F3A\u5EA6",
  scheduledBehavior: "\u53EA\u63D0\u53D6\u5019\u9009\u95EE\u9898\u5E76\u4FDD\u5B58\u4E3A\u5F85\u5BA1\u6838 Raw Case\uFF0C\u4E0D\u4F1A\u81EA\u52A8\u5199\u5165\u6570\u636E\u96C6\u3002",
  automaticBehavior: "\u68C0\u6D4B\u6A21\u578B\u8BC6\u522B\u5019\u9009\uFF0CCurator \u751F\u6210 Draft\uFF0C\u7A0B\u5E8F\u6821\u9A8C\u901A\u8FC7\u540E\u81EA\u52A8\u4FDD\u5B58\u4E3A Case\u3002",
  offBehavior: "\u5173\u95ED\u540E\u4E0D\u4F1A\u626B\u63CF\u65B0\u5BF9\u8BDD\u6216\u521B\u5EFA\u5019\u9009\u3002",
  saveAutomatic: "\u4FDD\u5B58\u81EA\u52A8\u6C89\u6DC0\u8BBE\u7F6E",
  runOnce: "\u7ACB\u5373\u8FD0\u884C\u4E00\u6B21",
  pendingRawCases: "\u5F85\u5BA1\u6838 Raw Case",
  schedulerStatus: "\u8C03\u5EA6\u72B6\u6001",
  installed: "\u5173\u95ED\u540E\u5B9A\u65F6\u8FD0\u884C\u5DF2\u542F\u7528",
  notInstalled: "\u5173\u95ED\u540E\u5B9A\u65F6\u8FD0\u884C\u672A\u542F\u7528",
  harnessTimer: "\u4EC5\u5728 Harness \u6253\u5F00\u65F6\u8FD0\u884C",
  schedulerExplanation: "\u9700\u8981\u5728\u5F53\u524D\u7528\u6237\u4E0B\u521B\u5EFA\u7CFB\u7EDF\u5B9A\u65F6\u4EFB\u52A1\uFF0C\u5230\u8BA1\u5212\u65F6\u95F4\u542F\u52A8\u4E00\u6B21\u81EA\u52A8\u6C89\u6DC0\u540E\u9000\u51FA\uFF1B\u4E0D\u4F1A\u5B89\u88C5\u65B0\u8F6F\u4EF6\u3002",
  enableScheduler: "\u542F\u7528\u540E\u53F0\u5B9A\u65F6\u8FD0\u884C",
  disableScheduler: "\u505C\u6B62\u5173\u95ED\u540E\u5B9A\u65F6\u8FD0\u884C",
  operator: "\u81EA\u64CD\u4F5C\u4E0E\u4F18\u5316",
  settings: "\u63D2\u4EF6\u8BBE\u7F6E",
  settingsDescription: "\u7BA1\u7406\u9ED8\u8BA4 Runtime\uFF0C\u4EE5\u53CA Curator\u3001Rubric Agent \u548C Judge \u7684\u6A21\u578B\u914D\u7F6E\u3002\u4E1A\u52A1\u64CD\u4F5C\u8BF7\u4ECE\u4FA7\u8FB9\u680F\u6253\u5F00\u5DE5\u4F5C\u53F0\u3002",
  agentDefaults: "Agent \u9ED8\u8BA4\u914D\u7F6E",
  defaultRuntime: "\u9ED8\u8BA4 Runtime",
  curatorDefault: "Curator",
  rubricDefault: "Rubric Agent",
  judgeDefault: "Judge",
  runtimeDefault: "\u8DDF\u968F Runtime \u9ED8\u8BA4\u503C",
  configuredDefault: "\u4F7F\u7528\u63D2\u4EF6\u8BBE\u7F6E",
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
  draftStatusFilter: "Draft \u72B6\u6001",
  emptyDrafts: "\u6682\u65E0 Draft",
  selectDraft: "\u9009\u62E9\u4E00\u4E2A Draft \u67E5\u770B\u8BE6\u60C5",
  frozenEvidence: "\u51BB\u7ED3\u8BC1\u636E",
  sourceRange: "\u6765\u6E90\u533A\u95F4",
  curatorConversation: "Curator \u5BF9\u8BDD",
  latestDraft: "\u6700\u65B0\u6709\u6548 Draft",
  draftDetails: "\u8BC4\u5206\u4E0E\u8BC1\u636E\u8BE6\u60C5",
  requiredFacts: "\u5FC5\u8981\u4E8B\u5B9E",
  requiredSteps: "\u5FC5\u8981\u6B65\u9AA4",
  requiredOutputFormat: "\u8F93\u51FA\u683C\u5F0F",
  rubricCoverage: "\u8BC4\u5206\u6807\u51C6\u8986\u76D6",
  caseSpecificCriteria: "Case \u4E13\u5C5E\u8BC4\u5206\u9879",
  badCaseAnalysis: "Bad Case \u5206\u6790",
  rootCauses: "\u6839\u56E0",
  improvements: "\u6539\u8FDB\u5EFA\u8BAE",
  noValidDraft: "\u5C1A\u672A\u751F\u6210\u6709\u6548 Draft",
  reviewMessage: "\u4FEE\u8BA2\u8981\u6C42",
  sendRevision: "\u53D1\u9001\u4FEE\u8BA2",
  reviewMessagePlaceholder: "\u544A\u8BC9 Curator \u54EA\u4E9B\u5185\u5BB9\u9700\u8981\u4FEE\u6539\uFF0C\u4F8B\u5982\u9057\u6F0F\u7684\u4E8B\u5B9E\u3001\u6B65\u9AA4\u6216\u8F93\u51FA\u683C\u5F0F\u3002",
  revisionComposerTitle: "\u4FEE\u6539 Draft",
  revisionComposerDescription: "\u76F4\u63A5\u63CF\u8FF0\u9700\u8981\u4FEE\u6539\u7684\u5730\u65B9\uFF0CCurator \u4F1A\u57FA\u4E8E\u5F53\u524D Draft \u751F\u6210\u65B0\u7248\u672C\u3002",
  generateRevision: "\u751F\u6210\u4FEE\u8BA2\u7248",
  curationWorking: "Curator \u6B63\u5728\u751F\u6210\u4FEE\u8BA2\u7248\u2026",
  runtimeInformation: "\u8FD0\u884C\u4FE1\u606F",
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
  rawCaseSkillFilter: "\u6309 Skill \u7B5B\u9009",
  allSkills: "\u5168\u90E8 Skill",
  manualSource: "\u624B\u5DE5\u6765\u6E90",
  captureEvidence: "\u6355\u83B7\u8BC1\u636E",
  rawCaseEvidence: "Raw Case \u6355\u83B7\u8BC1\u636E",
  captureEvidenceDescription: "\u8FD9\u91CC\u8BB0\u5F55\u81EA\u52A8\u68C0\u6D4B\u4E3A\u4EC0\u4E48\u628A\u8FD9\u6BB5\u5BF9\u8BDD\u8BC6\u522B\u4E3A\u5019\u9009 Case\uFF0C\u4EE5\u53CA\u540E\u7EED\u751F\u6210 Draft \u65F6\u91C7\u7528\u7684\u539F\u4F1A\u8BDD\u8BC1\u636E\u8303\u56F4\u3002",
  captureEvidenceLoading: "\u6B63\u5728\u8BFB\u53D6\u539F\u4F1A\u8BDD\u7247\u6BB5\u2026",
  captureEvidenceLoadError: "\u65E0\u6CD5\u8BFB\u53D6\u539F\u4F1A\u8BDD\u7247\u6BB5",
  captureEvidenceEmpty: "\u8FD9\u6BB5\u8BC1\u636E\u4E2D\u6CA1\u6709\u53EF\u663E\u793A\u7684\u6D88\u606F\u3002",
  captureUser: "\u7528\u6237",
  captureAssistant: "Assistant",
  captureContext: "\u8FD0\u884C\u4E0A\u4E0B\u6587",
  captureToolArguments: "\u8C03\u7528\u53C2\u6570",
  captureToolResult: "\u8C03\u7528\u7ED3\u679C",
  captureToolError: "\u9519\u8BEF",
  captureStartTag: "\u95EE\u9898\u8D77\u70B9",
  captureEndTag: "\u56DE\u590D\u7EC8\u70B9",
  sourceConversation: "\u6765\u6E90\u4F1A\u8BDD",
  captureClassification: "Case \u7C7B\u578B",
  captureOutcome: "\u5904\u7406\u7ED3\u679C",
  captureInspectedAt: "\u68C0\u6D4B\u65F6\u95F4",
  resolved: "\u5DF2\u89E3\u51B3",
  unresolved: "\u672A\u89E3\u51B3",
  unknown: "\u672A\u77E5",
  messageRange: "\u539F\u4F1A\u8BDD\u8BC1\u636E\u8303\u56F4",
  rangeMeaning: "\u4ECE\u95EE\u9898\u8D77\u70B9\u5230\u7ED3\u675F\u56DE\u590D\u4E4B\u95F4\u7684\u6D88\u606F\u3001\u5DE5\u5177\u8C03\u7528\u548C\u4E2D\u95F4\u7ED3\u679C\uFF0C\u90FD\u4F1A\u4F5C\u4E3A\u8FD9\u6761 Case \u7684\u8BC1\u636E\u3002",
  rangeStart: "\u8D77\u70B9 \xB7 \u7528\u6237\u95EE\u9898",
  rangeEnd: "\u7EC8\u70B9 \xB7 Assistant \u56DE\u590D",
  finalAssistantReply: "\u68C0\u6D4B\u6A21\u578B\u8BA4\u5B9A\u5B8C\u6210\u672C\u6B21\u95EE\u9898\u5904\u7406\u7684\u6700\u7EC8\u56DE\u590D",
  viewCaptureRange: "\u5728\u5F53\u524D\u4F1A\u8BDD\u4E2D\u67E5\u770B\u8303\u56F4",
  captureSummary: "\u68C0\u6D4B\u5230\u7684\u95EE\u9898\u8303\u56F4",
  captureReason: "\u5165\u9009\u539F\u56E0",
  manualEvidenceDescription: "\u8FD9\u662F\u624B\u5DE5\u65B0\u589E\u7684 Raw Case\uFF0C\u6CA1\u6709\u81EA\u52A8\u68C0\u6D4B\u4EA7\u751F\u7684\u539F\u4F1A\u8BDD\u8303\u56F4\u3002",
  rawCaseEvidenceAdvanced: "\u9AD8\u7EA7\u4FE1\u606F \xB7 \u539F\u59CB\u8BC1\u636E\u5B57\u6BB5",
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
  emptyRawCaseFilter: "\u5F53\u524D Skill \u6216\u641C\u7D22\u6761\u4EF6\u4E0B\u6CA1\u6709 Raw Case",
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
  evaluationRunEvidence: "\u672C\u6B21\u8FD0\u884C\u51BB\u7ED3\u8BC1\u636E",
  frozenRubric: "\u51BB\u7ED3\u8BC4\u5206\u6807\u51C6",
  targetRuntimeConfiguration: "\u76EE\u6807 Runtime \u914D\u7F6E\u4E0E\u5B89\u88C5\u8BB0\u5F55",
  judgeConfiguration: "Judge \u914D\u7F6E",
  evaluationResponse: "\u76EE\u6807 Runtime \u56DE\u7B54",
  scoreBreakdown: "\u8BC4\u5206\u4E0E Judge \u4F9D\u636E",
  judgeAttempts: "\u5C1D\u8BD5\u6B21\u6570",
  judgeRationale: "Judge \u7406\u7531",
  evidenceReferences: "\u8BC1\u636E\u5F15\u7528",
  verificationStatus: "\u6838\u9A8C\u72B6\u6001",
  rating: "\u8BC4\u5206\u6863\u4F4D",
  confidence: "\u7F6E\u4FE1\u5EA6",
  emptyScoreBreakdown: "\u6682\u65E0\u53EF\u5C55\u793A\u7684\u9010\u9879\u8BC4\u5206",
  evaluationTrace: "Case Trace",
  traceScopeCase: "\u4EC5\u5F53\u524D Case \u7684\u6267\u884C\u8303\u56F4",
  traceComplete: "\u8BED\u4E49\u4E8B\u4EF6\u8986\u76D6\u5B8C\u6574",
  traceCompacted: "Trace \u5DF2\u538B\u7F29\u91C7\u6837",
  traceOmitted: "\u7701\u7565\u4E8B\u4EF6",
  emptyTrace: "\u5F53\u524D Case \u6CA1\u6709\u53EF\u5C55\u793A\u7684 Trace",
  close: "\u5173\u95ED",
  skillImportTab: "\u5BFC\u5165",
  skillVersionsTab: "\u7248\u672C\u7BA1\u7406",
  skillInstallTab: "\u5B89\u88C5",
  currentManagedSkill: "\u5F53\u524D Skill",
  skillRepositories: "Managed Skill",
  skillRepositoriesDescription: "\u5BFC\u5165\u3001\u53D1\u5E03\u5E76\u5B89\u88C5\u4E0D\u53EF\u53D8 Skill \u7248\u672C\u3002",
  rescan: "\u91CD\u65B0\u626B\u63CF",
  skillSourceKind: "Skill \u6765\u6E90\u7C7B\u578B",
  skillSourceFolder: "\u6587\u4EF6\u5939",
  skillSourceLocalGit: "\u672C\u5730 Git \u4ED3\u5E93",
  skillSourceGitUrl: "Git URL",
  skillSourceZip: "ZIP \u538B\u7F29\u5305",
  skillSourceLocation: "\u7EDD\u5BF9\u8DEF\u5F84\u6216 Git URL",
  skillGitUrlPlaceholder: "https://example.com/skill-repository.git",
  chooseSkillFolder: "\u9009\u62E9\u6587\u4EF6\u5939",
  chooseSkillZip: "\u9009\u62E9 ZIP \u6587\u4EF6",
  selectedSkillSource: "\u5DF2\u9009\u6765\u6E90",
  noSkillSourceSelected: "\u5C1A\u672A\u9009\u62E9",
  importSkill: "\u5BFC\u5165",
  revealRepository: "\u6253\u5F00\u53D7\u7BA1 Skill \u6587\u4EF6\u5939",
  managedSkillPath: "\u53D7\u7BA1 Skill \u8DEF\u5F84",
  copyPath: "\u590D\u5236\u8DEF\u5F84",
  pathCopied: "\u5DF2\u590D\u5236",
  editSkillWithAgent: "\u8BA9 Agent \u7F16\u8F91",
  continueSkillEdit: "\u7EE7\u7EED Agent \u7F16\u8F91",
  skillEditTitle: "Agent \u7F16\u8F91 Skill",
  skillEditDescription: "Agent \u53EA\u4F1A\u4FEE\u6539\u5F53\u524D\u53D7\u7BA1 Skill \u7684\u9694\u79BB\u8349\u7A3F\u3002\u786E\u8BA4 Diff \u540E\uFF0C\u5E94\u7528\u4FEE\u6539\u4F1A\u81EA\u52A8\u53D1\u5E03\u4E0B\u4E00\u4E2A\u7248\u672C\u3002",
  skillEditRuntime: "\u7F16\u8F91 Runtime",
  selectSkillEditEffort: "\u8BF7\u9009\u62E9\u63A8\u7406\u5F3A\u5EA6",
  skillEditObjective: "\u5E0C\u671B\u600E\u4E48\u4FEE\u6539",
  skillEditObjectivePlaceholder: "\u4F8B\u5982\uFF1A\u8865\u5145\u89E6\u53D1\u6761\u4EF6\u3001\u6F84\u6E05\u8FB9\u754C\uFF0C\u5E76\u52A0\u5165\u4E00\u4E2A\u5B8C\u6574\u793A\u4F8B",
  startSkillEdit: "\u5F00\u59CB\u7F16\u8F91",
  applySkillEdit: "\u5E94\u7528\u4FEE\u6539\u5E76\u53D1\u5E03\u65B0\u7248\u672C",
  discardSkillEdit: "\u653E\u5F03\u8349\u7A3F",
  skillEditStateDraft: "\u6B63\u5728\u51C6\u5907\u8349\u7A3F",
  skillEditStateRunning: "Agent \u6B63\u5728\u7F16\u8F91",
  skillEditStateIdle: "\u7B49\u5F85\u786E\u8BA4",
  skillEditStateApplying: "\u6B63\u5728\u5E94\u7528\u5E76\u53D1\u5E03",
  skillEditStateRecovery: "\u9700\u8981\u6062\u590D",
  skillEditStatePublished: "\u5DF2\u5E94\u7528\u5E76\u53D1\u5E03",
  skillEditStateDiscarded: "\u8349\u7A3F\u5DF2\u653E\u5F03",
  skillEditStateFailed: "\u7F16\u8F91\u5931\u8D25",
  publishedVersionLabel: "\u65B0\u7248\u672C",
  skillEditConversation: "\u7F16\u8F91\u5BF9\u8BDD",
  emptySkillEditConversation: "Agent \u8FD8\u6CA1\u6709\u8FD4\u56DE\u6D88\u606F\u3002",
  skillEditFollowUp: "\u7EE7\u7EED\u544A\u8BC9 Agent \u8981\u8C03\u6574\u4EC0\u4E48",
  skillEditChanges: "\u6587\u4EF6\u53D8\u66F4",
  skillEditAdded: "\u65B0\u589E",
  skillEditDeleted: "\u5220\u9664",
  skillEditModified: "\u4FEE\u6539",
  skillEditBinaryFile: "\u4E8C\u8FDB\u5236\u6587\u4EF6\u5DF2\u53D8\u66F4\uFF0C\u65E0\u6CD5\u5C55\u793A\u6587\u672C Diff\u3002",
  skillEditDiffTruncated: "Diff \u5185\u5BB9\u8F83\u957F\uFF0C\u5DF2\u622A\u65AD\u5C55\u793A\u3002",
  skillEditWaitingForChanges: "Agent \u6B63\u5728\u5DE5\u4F5C\uFF0C\u5B8C\u6210\u540E\u4F1A\u5728\u8FD9\u91CC\u5C55\u793A\u53D8\u66F4\u3002",
  skillEditNoChanges: "\u5F53\u524D\u8349\u7A3F\u6CA1\u6709\u6587\u4EF6\u53D8\u66F4\u3002",
  agent: "Agent",
  you: "\u4F60",
  emptySkills: "\u6682\u65E0 Managed Skill",
  publishedVersions: "\u5DF2\u53D1\u5E03\u7248\u672C",
  emptyPublishedVersions: "\u8FD8\u6CA1\u6709\u5DF2\u53D1\u5E03\u7248\u672C",
  viewSkillContent: "\u67E5\u770B Skill \u5185\u5BB9",
  prepareVersion: "\u51C6\u5907\u53D1\u5E03",
  prepareVersionDescription: "\u68C0\u6D4B\u5230 Skill \u5185\u5BB9\u6709\u53D8\u66F4\u3002\u4FDD\u5B58\u540E\u4F1A\u751F\u6210\u4E00\u4E2A\u5F85\u53D1\u5E03\u5FEB\u7167\uFF0C\u4E0D\u4F1A\u7ACB\u5373\u53D1\u5E03\u6216\u5B89\u88C5\u3002",
  versionUnchanged: "\u5F53\u524D Skill \u5185\u5BB9\u4E0E\u5DF2\u8BB0\u5F55\u7248\u672C\u4E00\u81F4\uFF0C\u65E0\u9700\u518D\u6B21\u4FDD\u5B58\u3002\u4FEE\u6539 Skill \u540E\u5237\u65B0\u6B64\u9875\u5373\u53EF\u51C6\u5907\u65B0\u7248\u672C\u3002",
  versionReady: "\u5F53\u524D\u5185\u5BB9\u5DF2\u51C6\u5907\u597D\uFF0C\u586B\u5199\u7248\u672C\u53F7\u5373\u53EF\u53D1\u5E03\u3002",
  versionNumber: "\u7248\u672C\u53F7",
  saveVersionContent: "\u4FDD\u5B58\u4E3A\u5F85\u53D1\u5E03\u7248\u672C",
  releaseVersion: "\u53D1\u5E03\u65B0\u7248\u672C",
  release: "\u53D1\u5E03",
  installationRuntime: "\u5B89\u88C5\u76EE\u6807 Runtime",
  installReleased: "\u5B89\u88C5\u5DF2\u53D1\u5E03\u7248\u672C",
  installationJobs: "\u5B89\u88C5 Job",
  installationAudit: "\u5B89\u88C5\u5BA1\u8BA1",
  installationAuditDescription: "\u67E5\u770B\u6BCF\u4E2A Runtime \u5DF2\u63A5\u6536\u7684\u4E0D\u53EF\u53D8\u7248\u672C\u548C\u5B89\u88C5 Job \u8BC1\u636E\uFF1B\u6210\u529F\u4E0B\u53D1\u540E\u9ED8\u8BA4\u4FE1\u4EFB\u8BE5\u8BB0\u5F55\uFF0C\u4E0D\u505A\u5B9E\u65F6\u8DEF\u5F84 digest \u6821\u9A8C\u3002",
  trustedInstallations: "\u5F53\u524D\u53EF\u4FE1\u5B89\u88C5\u8BB0\u5F55",
  emptyInstallationAudit: "\u6682\u65E0\u53EF\u4FE1\u5B89\u88C5\u8BB0\u5F55",
  emptyInstallationJobs: "\u6682\u65E0\u5B89\u88C5 Job",
  installationSource: "\u5B89\u88C5\u6765\u6E90\u4E0E\u7ED3\u679C",
  installationVersion: "Skill \u7248\u672C",
  installationCommit: "Commit",
  installationDigest: "\u5185\u5BB9\u6458\u8981",
  installationJob: "\u5B89\u88C5 Job",
  installedAt: "\u5B89\u88C5\u65F6\u95F4",
  createdAt: "\u521B\u5EFA\u65F6\u95F4",
  status: "\u72B6\u6001",
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
  migrateLegacyRubric: "\u8FC1\u79FB\u65E7\u7248\u8BA1\u5206 contract",
  scoringModel: "\u8BA1\u5206\u6A21\u578B",
  rubricDigest: "\u8BC4\u5206\u6807\u51C6\u6458\u8981",
  rubricCriteria: "\u8BC4\u5206\u7EF4\u5EA6",
  rubricEvidenceRequirements: "\u8BC1\u636E\u8981\u6C42",
  scoringAnchors: "\u8BC4\u5206\u951A\u70B9",
  weight: "\u6743\u91CD",
  criticalFailure: "\u5173\u952E\u5931\u8D25\u95E8\u69DB",
  automaticFailures: "\u81EA\u52A8\u5931\u8D25\u6761\u4EF6"
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
  caseManagement: "Case Capture & Management",
  skillAndInstallation: "Skills & Installation",
  evaluationAndOptimization: "Evaluation & Optimization",
  workbenchSections: "Workbench sections",
  workbenchPages: "Pages in this section",
  cases: "Cases & Datasets",
  evaluations: "Skill Evaluations",
  automatic: "Automatic Capture",
  automaticTitle: "Automatic Capture",
  automaticDescription: "Inspect new conversations on schedule, identify complete problems, and create Raw Cases or save Cases according to the selected mode.",
  automaticMode: "Capture Mode",
  automaticOff: "Off",
  automaticScheduled: "Scheduled Discovery",
  automaticFull: "Fully Automatic",
  executionLocation: "Execution Location",
  whileHarnessRunning: "Only while Harness is open",
  alwaysRunning: "Run on schedule after Harness closes",
  cadence: "Cadence",
  daily: "Daily",
  weekly: "Weekly",
  captureTime: "Capture Time",
  captureHour: "Capture hour",
  captureMinute: "Capture minute",
  hourUnit: "hr",
  minuteUnit: "min",
  weekday: "Weekday",
  weekday0: "Sunday",
  weekday1: "Monday",
  weekday2: "Tuesday",
  weekday3: "Wednesday",
  weekday4: "Thursday",
  weekday5: "Friday",
  weekday6: "Saturday",
  automaticRuntime: "Case Detection Runtime",
  automaticDataset: "Target Dataset",
  automaticDatasetMatch: "Match automatically from the Skill",
  candidateSkills: "Candidate Skills and Datasets",
  candidateSkillsDescription: "Only selected managed Skills are detected, and each matched Case is sent to its selected Dataset. With no selection, all enabled Runtime Skills are considered and one unique Dataset is matched automatically.",
  candidateSkillNoDataset: "No compatible bound Dataset is available; fully automatic mode also requires a published Rubric.",
  candidateSkillUnavailable: "This saved candidate Skill is unavailable. Uncheck it to remove the stale route.",
  candidateDatasetOnlyOne: "Only one Dataset is available. Create and bind another Dataset to this Skill for more choices.",
  datasetRubricRequiredSuffix: " (no published Rubric)",
  noCandidateSkills: "No managed Skills are available.",
  automaticFlowSummaryPrefix: "The detection model finds complete Cases and routes them; in Fully Automatic mode, Curator (",
  automaticFlowSummarySuffix: ") prepares them and validated Drafts are saved as Cases without running Judge.",
  automaticDetectionModel: "Case Detection Model",
  automaticDetectionEffort: "Detection Reasoning Effort",
  scheduledBehavior: "Only discovers candidates and stores reviewable Raw Cases; it does not write to a Dataset automatically.",
  automaticBehavior: "The detection model finds candidates, Curator generates Drafts, and validated Drafts are saved as Cases.",
  offBehavior: "No conversations are scanned and no candidates are created while capture is off.",
  saveAutomatic: "Save Automatic Capture",
  runOnce: "Run Once Now",
  pendingRawCases: "Pending Raw Cases",
  schedulerStatus: "Scheduler Status",
  installed: "Scheduled runs after close are enabled",
  notInstalled: "Scheduled runs after close are not enabled",
  harnessTimer: "Runs only while Harness is open",
  schedulerExplanation: "Creates a scheduled task for the current user that starts one automatic capture run at the planned time and then exits; no new software is installed.",
  enableScheduler: "Enable Background Schedule",
  disableScheduler: "Stop Runs After Harness Closes",
  operator: "Operator & Optimization",
  settings: "Plugin Settings",
  settingsDescription: "Manage the default Runtime and the Curator, Rubric Agent, and Judge model profiles. Open the workbench from the sidebar for business workflows.",
  agentDefaults: "Agent Defaults",
  defaultRuntime: "Default Runtime",
  curatorDefault: "Curator",
  rubricDefault: "Rubric Agent",
  judgeDefault: "Judge",
  runtimeDefault: "Use Runtime default",
  configuredDefault: "Use plugin setting",
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
  draftStatusFilter: "Draft status",
  emptyDrafts: "No Drafts",
  selectDraft: "Select a Draft to inspect",
  frozenEvidence: "Frozen Evidence",
  sourceRange: "Source Range",
  curatorConversation: "Curator Conversation",
  latestDraft: "Latest Valid Draft",
  draftDetails: "Scoring and evidence details",
  requiredFacts: "Required Facts",
  requiredSteps: "Required Steps",
  requiredOutputFormat: "Required Output Format",
  rubricCoverage: "Rubric Coverage",
  caseSpecificCriteria: "Case-specific Criteria",
  badCaseAnalysis: "Bad Case Analysis",
  rootCauses: "Root Causes",
  improvements: "Improvements",
  noValidDraft: "No valid Draft yet",
  reviewMessage: "Revision request",
  sendRevision: "Send Revision",
  reviewMessagePlaceholder: "Tell Curator what to change, such as missing facts, steps, or output requirements.",
  revisionComposerTitle: "Revise Draft",
  revisionComposerDescription: "Describe the changes directly and Curator will produce a new version from the current Draft.",
  generateRevision: "Generate revision",
  curationWorking: "Curator is generating a revision\u2026",
  runtimeInformation: "Runtime information",
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
  rawCaseSkillFilter: "Filter by Skill",
  allSkills: "All Skills",
  manualSource: "Manual source",
  captureEvidence: "Capture Evidence",
  rawCaseEvidence: "Raw Case Capture Evidence",
  captureEvidenceDescription: "This records why automatic detection selected the conversation as a Case candidate and the source range used to create a Draft.",
  captureEvidenceLoading: "Loading the source conversation excerpt\u2026",
  captureEvidenceLoadError: "Could not load the source conversation excerpt",
  captureEvidenceEmpty: "This evidence range has no displayable messages.",
  captureUser: "User",
  captureAssistant: "Assistant",
  captureContext: "Runtime context",
  captureToolArguments: "Arguments",
  captureToolResult: "Result",
  captureToolError: "Error",
  captureStartTag: "Problem start",
  captureEndTag: "Response end",
  sourceConversation: "Source conversation",
  captureClassification: "Case type",
  captureOutcome: "Outcome",
  captureInspectedAt: "Inspected at",
  resolved: "Resolved",
  unresolved: "Unresolved",
  unknown: "Unknown",
  messageRange: "Source conversation range",
  rangeMeaning: "Messages, tool calls, and intermediate results between the starting question and ending response are evidence for this Case.",
  rangeStart: "Start \xB7 User question",
  rangeEnd: "End \xB7 Assistant response",
  finalAssistantReply: "The final response that detection treated as completing this task",
  viewCaptureRange: "View Range in Current Conversation",
  captureSummary: "Detected problem range",
  captureReason: "Selection reason",
  manualEvidenceDescription: "This Raw Case was added manually and has no automatically detected source-conversation range.",
  rawCaseEvidenceAdvanced: "Advanced \xB7 Raw evidence fields",
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
  emptyRawCaseFilter: "No Raw Cases match this Skill or search",
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
  evaluationRunEvidence: "Frozen Run Evidence",
  frozenRubric: "Frozen Rubric",
  targetRuntimeConfiguration: "Target Runtime and Installation Evidence",
  judgeConfiguration: "Judge Configuration",
  evaluationResponse: "Target Runtime Response",
  scoreBreakdown: "Score and Judge Evidence",
  judgeAttempts: "Attempts",
  judgeRationale: "Judge rationale",
  evidenceReferences: "Evidence references",
  verificationStatus: "Verification status",
  rating: "Rating",
  confidence: "Confidence",
  emptyScoreBreakdown: "No criterion score is available",
  evaluationTrace: "Case Trace",
  traceScopeCase: "Current Case execution range only",
  traceComplete: "Complete semantic event coverage",
  traceCompacted: "Trace was compacted",
  traceOmitted: "Omitted events",
  emptyTrace: "No Trace is available for this Case",
  close: "Close",
  skillImportTab: "Import",
  skillVersionsTab: "Version management",
  skillInstallTab: "Install",
  currentManagedSkill: "Current Skill",
  skillRepositories: "Managed Skills",
  skillRepositoriesDescription: "Import, release, and install immutable Skill versions.",
  rescan: "Rescan",
  skillSourceKind: "Skill source type",
  skillSourceFolder: "Folder",
  skillSourceLocalGit: "Local Git repository",
  skillSourceGitUrl: "Git URL",
  skillSourceZip: "ZIP archive",
  skillSourceLocation: "Absolute path or Git URL",
  skillGitUrlPlaceholder: "https://example.com/skill-repository.git",
  chooseSkillFolder: "Choose folder",
  chooseSkillZip: "Choose ZIP file",
  selectedSkillSource: "Selected source",
  noSkillSourceSelected: "Nothing selected",
  importSkill: "Import",
  revealRepository: "Open Managed Skill Folder",
  managedSkillPath: "Managed Skill path",
  copyPath: "Copy Path",
  pathCopied: "Copied",
  editSkillWithAgent: "Edit with Agent",
  continueSkillEdit: "Continue Agent Edit",
  skillEditTitle: "Agent Skill Editor",
  skillEditDescription: "The Agent edits an isolated draft of this managed Skill only. Applying a reviewed Diff automatically publishes the next version.",
  skillEditRuntime: "Editing Runtime",
  selectSkillEditEffort: "Select reasoning effort",
  skillEditObjective: "Requested changes",
  skillEditObjectivePlaceholder: "For example: clarify triggers and boundaries, then add one complete example",
  startSkillEdit: "Start Editing",
  applySkillEdit: "Apply Changes and Publish Version",
  discardSkillEdit: "Discard Draft",
  skillEditStateDraft: "Preparing Draft",
  skillEditStateRunning: "Agent Is Editing",
  skillEditStateIdle: "Awaiting Review",
  skillEditStateApplying: "Applying and Publishing",
  skillEditStateRecovery: "Recovery Required",
  skillEditStatePublished: "Applied and Published",
  skillEditStateDiscarded: "Draft Discarded",
  skillEditStateFailed: "Edit Failed",
  publishedVersionLabel: "New version",
  skillEditConversation: "Editing Conversation",
  emptySkillEditConversation: "The Agent has not returned a message yet.",
  skillEditFollowUp: "Tell the Agent what else to adjust",
  skillEditChanges: "File Changes",
  skillEditAdded: "Added",
  skillEditDeleted: "Deleted",
  skillEditModified: "Modified",
  skillEditBinaryFile: "This binary file changed, so a text Diff is unavailable.",
  skillEditDiffTruncated: "The Diff is long and has been truncated for display.",
  skillEditWaitingForChanges: "The Agent is working. Changes will appear here when ready.",
  skillEditNoChanges: "The current draft has no file changes.",
  agent: "Agent",
  you: "You",
  emptySkills: "No Managed Skills",
  publishedVersions: "Published Versions",
  emptyPublishedVersions: "No published versions yet",
  viewSkillContent: "View Skill Content",
  prepareVersion: "Prepare to Publish",
  prepareVersionDescription: "Skill content has changed. Saving creates a pending snapshot without publishing or installing it.",
  versionUnchanged: "The current Skill content matches a recorded version and does not need to be saved again. Refresh this page after changing the Skill to prepare a new version.",
  versionReady: "The current content is ready. Enter a version number to publish it.",
  versionNumber: "Version number",
  saveVersionContent: "Save as Pending Version",
  releaseVersion: "Publish New Version",
  release: "Release",
  installationRuntime: "Installation Target Runtime",
  installReleased: "Install Released Version",
  installationJobs: "Installation Jobs",
  installationAudit: "Installation Audit",
  installationAuditDescription: "Review immutable versions and installation Job evidence per Runtime. A successful dispatch is trusted without live path digest validation.",
  trustedInstallations: "Current Trusted Installations",
  emptyInstallationAudit: "No trusted installation records",
  emptyInstallationJobs: "No installation Jobs",
  installationSource: "Installation Source and Result",
  installationVersion: "Skill Version",
  installationCommit: "Commit",
  installationDigest: "Content Digest",
  installationJob: "Installation Job",
  installedAt: "Installed At",
  createdAt: "Created At",
  status: "Status",
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
  migrateLegacyRubric: "Migrate Legacy Scoring Contract",
  scoringModel: "Scoring Model",
  rubricDigest: "Rubric Digest",
  rubricCriteria: "Rubric Criteria",
  rubricEvidenceRequirements: "Evidence Requirements",
  scoringAnchors: "Scoring Anchors",
  weight: "Weight",
  criticalFailure: "Critical Failure Gate",
  automaticFailures: "Automatic Failures"
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
  constructor(code2, message, status) {
    super(message);
    this.name = "RollingSkillApiError";
    this.code = code2;
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
  const create2 = async () => {
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
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_dsh_client_ui_primitives.Button, { onClick: create2, disabled: !canSubmit, children: submitting ? t("captureCreating") : t("captureCreate") })
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
  const previous2 = order.indexOf(sessionId);
  if (previous2 >= 0) order.splice(previous2, 1);
  order.push(sessionId);
  notify();
  return () => {
    const remaining = (counts.get(sessionId) ?? 1) - 1;
    if (remaining > 0) counts.set(sessionId, remaining);
    else {
      counts.delete(sessionId);
      const index2 = order.indexOf(sessionId);
      if (index2 >= 0) order.splice(index2, 1);
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
var projectSequenceRange = import_curation_markers.default.projectSequenceRange;

// src/client/conversation/ConversationCurationMarkers.tsx
var import_jsx_runtime3 = require("react/jsx-runtime");
var MARKER_CLASSES = ["rolling-skill-curation-draft", "rolling-skill-curation-saved"];
var CAPTURE_RANGE_CLASS = "rolling-skill-capture-range";
function ConversationCurationMarkers({ sessionId, useSession, t }) {
  const snapshot = useSession((value) => value);
  const [markers, setMarkers] = (0, import_react3.useState)([]);
  const [revision, setRevision] = (0, import_react3.useState)(0);
  const [compatibilityMissing, setCompatibilityMissing] = (0, import_react3.useState)(false);
  const [captureRange, setCaptureRange] = (0, import_react3.useState)(null);
  const applied = (0, import_react3.useRef)(/* @__PURE__ */ new Set());
  const scrollToCaptureRange = (0, import_react3.useRef)(false);
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
    const reveal = (event) => {
      const detail = event.detail;
      if (detail?.sessionId !== sessionId || !Number.isSafeInteger(detail.startSeq) || !Number.isSafeInteger(detail.endSeq)) return;
      scrollToCaptureRange.current = true;
      setCaptureRange({ ...detail });
    };
    window.addEventListener("rolling-skill:reveal-capture-range", reveal);
    return () => window.removeEventListener("rolling-skill:reveal-capture-range", reveal);
  }, [sessionId]);
  (0, import_react3.useEffect)(() => {
    const clear = () => {
      for (const row of applied.current) {
        row.classList.remove(...MARKER_CLASSES, CAPTURE_RANGE_CLASS);
        row.removeAttribute("data-rolling-skill-curation-marker");
        row.removeAttribute("data-rolling-skill-capture-range");
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
      const captureKeys = captureRange ? projectSequenceRange(snapshot, captureRange.startSeq, captureRange.endSeq) : [];
      let firstCaptureRow = null;
      for (const key of captureKeys) {
        const selector = `[data-chat-flow-key="${CSS.escape(key)}"]`;
        for (const row of document.querySelectorAll(selector)) {
          row.classList.add(CAPTURE_RANGE_CLASS);
          row.dataset.rollingSkillCaptureRange = "true";
          firstCaptureRow ??= row;
          applied.current.add(row);
        }
      }
      if (firstCaptureRow && scrollToCaptureRange.current) {
        scrollToCaptureRange.current = false;
        window.setTimeout(() => firstCaptureRow?.scrollIntoView({ behavior: "smooth", block: "center" }), 0);
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
  }, [snapshot, markers, captureRange]);
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
var import_dsh_client_ui_primitives16 = require("@deepseek-ai/dsh-client-ui-primitives");
var import_react23 = require("react");

// src/client/workbench/WorkbenchOverlay.tsx
var import_dsh_client_ui_primitives15 = require("@deepseek-ai/dsh-client-ui-primitives");
var import_react22 = require("react");

// src/client/workbench/Workbench.tsx
var import_dsh_client_ui_primitives14 = require("@deepseek-ai/dsh-client-ui-primitives");
var import_react21 = require("react");

// src/client/workbench/ActionButton.tsx
var import_dsh_client_ui_primitives3 = require("@deepseek-ai/dsh-client-ui-primitives");
var import_jsx_runtime4 = require("react/jsx-runtime");
var VARIANTS = {
  primary: "primary",
  secondary: "outline",
  quiet: "ghost"
};
function ActionButton({ tone = "secondary", className, ...props }) {
  const classes = ["rolling-skill-action-button", className].filter(Boolean).join(" ");
  return /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(
    import_dsh_client_ui_primitives3.Button,
    {
      ...props,
      className: classes,
      "data-rolling-skill-tone": tone,
      variant: VARIANTS[tone]
    }
  );
}

// src/client/workbench/AutomaticCapturePanel.tsx
var import_react5 = require("react");

// src/client/workbench/ModelEffortSelect.tsx
var import_react4 = require("react");
var import_model_catalog = __toESM(require_model_catalog(), 1);
var import_jsx_runtime5 = require("react/jsx-runtime");
function ModelEffortSelect({
  label,
  runtimeDefaultLabel,
  models,
  modelId: selectedModelId,
  value,
  onChange
}) {
  const efforts = (0, import_model_catalog.reasoningEffortsFor)(models, selectedModelId);
  (0, import_react4.useEffect)(() => {
    if (value && !efforts.some((effort) => effort.id === value)) onChange("");
  }, [selectedModelId, value, efforts.map((effort) => effort.id).join("\0")]);
  return /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("label", { className: "rolling-skill-field", children: [
    /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("span", { children: label }),
    /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("select", { className: "rolling-skill-select", value, onChange: (event) => onChange(event.target.value), children: [
      /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("option", { value: "", children: runtimeDefaultLabel }),
      efforts.map((effort) => /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("option", { value: effort.id, children: effort.label }, effort.id))
    ] })
  ] });
}

// src/client/workbench/AutomaticCapturePanel.tsx
var import_model_catalog2 = __toESM(require_model_catalog(), 1);
var import_automatic_capture_view_model = __toESM(require_automatic_capture_view_model(), 1);

// src/client/workbench/RuntimeSelect.tsx
var import_jsx_runtime6 = require("react/jsx-runtime");
function RuntimeSelect({
  t,
  runtimes,
  value,
  onChange,
  label
}) {
  return /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("fieldset", { className: "rolling-skill-runtime-select", children: [
    /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("legend", { children: label }),
    /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("div", { className: "rolling-skill-runtime-list", children: [
      runtimes.map((runtime) => /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("label", { className: "rolling-skill-runtime-option", children: [
        /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(
          "input",
          {
            type: "radio",
            name: label,
            value: runtime.runtimeId,
            checked: value === runtime.runtimeId,
            onChange: () => onChange(runtime.runtimeId)
          }
        ),
        /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("span", { children: [
          /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("strong", { children: [
            runtime.displayName,
            " ",
            runtime.version
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("code", { children: runtime.executablePath })
        ] })
      ] }, runtime.runtimeId)),
      runtimes.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("p", { children: t("noRuntimes") }) : null
    ] })
  ] });
}

// src/client/workbench/AutomaticCapturePanel.tsx
var import_jsx_runtime7 = require("react/jsx-runtime");
var WEEKDAY_KEYS = [
  "weekday0",
  "weekday1",
  "weekday2",
  "weekday3",
  "weekday4",
  "weekday5",
  "weekday6"
];
var HOURS = Array.from({ length: 24 }, (_, value) => String(value).padStart(2, "0"));
var MINUTES = Array.from({ length: 60 }, (_, value) => String(value).padStart(2, "0"));
function displayTime(value, fallback) {
  if (!value) return fallback;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleString() : fallback;
}
function AutomaticCapturePanel({ t }) {
  const [status, setStatus] = (0, import_react5.useState)(null);
  const [runtimes, setRuntimes] = (0, import_react5.useState)([]);
  const [datasets, setDatasets] = (0, import_react5.useState)([]);
  const [catalog, setCatalog] = (0, import_react5.useState)({ skills: [] });
  const [models, setModels] = (0, import_react5.useState)([]);
  const [curatorProfile, setCuratorProfile] = (0, import_react5.useState)({ runtimePolicy: "active", modelId: null, effort: null });
  const [mode, setMode] = (0, import_react5.useState)("off");
  const [executionLocation, setExecutionLocation] = (0, import_react5.useState)("while-harness-running");
  const [cadence, setCadence] = (0, import_react5.useState)("daily");
  const [time, setTime] = (0, import_react5.useState)("09:00");
  const [weekday, setWeekday] = (0, import_react5.useState)(1);
  const [runtimeId, setRuntimeId] = (0, import_react5.useState)("");
  const [modelId, setModelId] = (0, import_react5.useState)("");
  const [effort, setEffort] = (0, import_react5.useState)("");
  const [configuredModelId, setConfiguredModelId] = (0, import_react5.useState)("");
  const [configuredEffort, setConfiguredEffort] = (0, import_react5.useState)("");
  const [modelCatalogRevision, setModelCatalogRevision] = (0, import_react5.useState)(0);
  const [candidateTargets, setCandidateTargets] = (0, import_react5.useState)([]);
  const [busy, setBusy] = (0, import_react5.useState)(false);
  const [error, setError] = (0, import_react5.useState)(null);
  const [revision, setRevision] = (0, import_react5.useState)(0);
  (0, import_react5.useEffect)(() => {
    const controller = new AbortController();
    Promise.all([
      requestRollingSkill("automatic.status", {}, controller.signal),
      requestRollingSkill("runtimes.list", {}, controller.signal),
      requestRollingSkill("datasets.list", {}, controller.signal),
      requestRollingSkill("skills.catalog", {}, controller.signal),
      requestRollingSkill("settings.get", {}, controller.signal)
    ]).then(([nextStatus, runtimeItems, datasetItems, nextCatalog, settings]) => {
      setStatus(nextStatus);
      setRuntimes(runtimeItems);
      setDatasets(datasetItems);
      setCatalog(nextCatalog);
      setCuratorProfile(settings.rollingSkill.curatorProfile);
      setMode(nextStatus.mode);
      setExecutionLocation(nextStatus.executionLocation);
      setCadence(nextStatus.schedule.cadence);
      setTime(nextStatus.schedule.time);
      setWeekday(nextStatus.schedule.weekday);
      setRuntimeId(nextStatus.runtime?.runtimeId || runtimeItems[0]?.runtimeId || "");
      setConfiguredModelId(nextStatus.modelId || "");
      setConfiguredEffort(nextStatus.effort || "");
      setModelCatalogRevision((value) => value + 1);
      const migratedTarget = nextStatus.datasetId ? datasetItems.find((dataset) => dataset.id === nextStatus.datasetId && dataset.skillReference?.id) : null;
      setCandidateTargets(nextStatus.targets?.length ? nextStatus.targets : migratedTarget?.skillReference?.id ? [{ skillId: migratedTarget.skillReference.id, datasetId: migratedTarget.id }] : []);
    }).catch((reason) => {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : t("loadError"));
    });
    return () => controller.abort();
  }, [revision]);
  (0, import_react5.useEffect)(() => {
    setModels([]);
    setModelId("");
    setEffort("");
    if (!runtimeId) return;
    const controller = new AbortController();
    requestRollingSkill("runtimes.models", { runtimeId }, controller.signal).then((items) => {
      const selectedModelId = (0, import_model_catalog2.resolveModelId)(items, configuredModelId);
      setModels(items);
      setModelId(selectedModelId);
      setEffort((0, import_model_catalog2.resolveReasoningEffort)(items, selectedModelId, configuredEffort));
    }).catch((reason) => {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : t("loadError"));
    });
    return () => controller.abort();
  }, [runtimeId, modelCatalogRevision]);
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
  const updateAutomaticSettings = () => requestRollingSkill("automatic.update", {
    mode,
    executionLocation,
    cadence,
    time,
    weekday,
    runtimeId: runtimeId || null,
    modelId: modelId || null,
    effort: effort || null,
    datasetId: null,
    targets: candidateTargets
  });
  const save = () => mutate(async () => {
    await updateAutomaticSettings();
    if (status?.worker.installed) {
      await requestRollingSkill(
        executionLocation === "always" ? "scheduler.enable" : "scheduler.disable",
        {}
      );
    }
  });
  const runOnce = () => mutate(async () => {
    await updateAutomaticSettings();
    await requestRollingSkill("automatic.runOnce", { slot: "manual" });
  });
  const enableScheduler = () => mutate(async () => {
    await updateAutomaticSettings();
    await requestRollingSkill("scheduler.enable", {});
  });
  const disableScheduler = () => mutate(() => requestRollingSkill("scheduler.disable", {}));
  const requiresRuntime = mode !== "off";
  const schedulerInstalled = status?.scheduler.installed ?? status?.worker.installed ?? false;
  const [hour = "09", minute = "00"] = time.split(":");
  const curatorProfileSummary = [
    curatorProfile.modelId || t("runtimeDefault"),
    curatorProfile.effort ? `${t("effort")}: ${curatorProfile.effort}` : null
  ].filter(Boolean).join(" \xB7 ");
  const datasetOptions = (skillId) => (0, import_automatic_capture_view_model.candidateDatasetOptions)(
    datasets,
    skillId,
    mode
  );
  const availableDatasets = (skillId) => datasetOptions(skillId).filter((dataset) => !dataset.disabled);
  const toggleCandidate = (skillId, checked) => {
    if (!checked) {
      setCandidateTargets((current) => current.filter((target) => target.skillId !== skillId));
      return;
    }
    const datasetId = availableDatasets(skillId)[0]?.id ?? "";
    setCandidateTargets((current) => [...current, { skillId, datasetId }]);
  };
  const selectCandidateDataset = (skillId, datasetId) => {
    setCandidateTargets((current) => current.map((target) => target.skillId === skillId ? { ...target, datasetId } : target));
  };
  const invalidCandidateTargets = candidateTargets.some((target) => !target.datasetId || !availableDatasets(target.skillId).some((dataset) => dataset.id === target.datasetId));
  const visibleCandidateSkills = (0, import_automatic_capture_view_model.candidateSkillRows)(catalog.skills, candidateTargets);
  return /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("div", { className: "rolling-skill-data-stack", children: [
    /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("section", { className: "rolling-skill-panel", children: [
      /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("div", { className: "rolling-skill-panel-header", children: [
        /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("div", { children: [
          /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("h3", { children: t("automaticTitle") }),
          /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("p", { children: t("automaticDescription") })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(ActionButton, { size: "sm", onClick: () => setRevision((value) => value + 1), children: t("refresh") })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("div", { className: "rolling-skill-grid", children: [
        /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("label", { className: "rolling-skill-field", children: [
          /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("span", { children: t("automaticMode") }),
          /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("select", { className: "rolling-skill-select", value: mode, onChange: (event) => setMode(event.target.value), children: [
            /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("option", { value: "off", children: t("automaticOff") }),
            /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("option", { value: "scheduled", children: t("automaticScheduled") }),
            /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("option", { value: "automatic", children: t("automaticFull") })
          ] })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("label", { className: "rolling-skill-field", children: [
          /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("span", { children: t("executionLocation") }),
          /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("select", { className: "rolling-skill-select", value: executionLocation, onChange: (event) => setExecutionLocation(event.target.value), children: [
            /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("option", { value: "while-harness-running", children: t("whileHarnessRunning") }),
            /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("option", { value: "always", children: t("alwaysRunning") })
          ] })
        ] })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("div", { className: "rolling-skill-grid", children: [
        /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("label", { className: "rolling-skill-field", children: [
          /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("span", { children: t("cadence") }),
          /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("select", { className: "rolling-skill-select", value: cadence, onChange: (event) => setCadence(event.target.value), children: [
            /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("option", { value: "daily", children: t("daily") }),
            /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("option", { value: "weekly", children: t("weekly") })
          ] })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("div", { className: "rolling-skill-field", children: [
          /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("span", { children: t("captureTime") }),
          /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("div", { className: "rolling-skill-time-selects", children: [
            /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("label", { children: [
              /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("select", { "aria-label": t("captureHour"), className: "rolling-skill-select", value: hour, onChange: (event) => setTime(`${event.target.value}:${minute}`), children: HOURS.map((value) => /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("option", { value, children: value }, value)) }),
              /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("span", { children: t("hourUnit") })
            ] }),
            /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("label", { children: [
              /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("select", { "aria-label": t("captureMinute"), className: "rolling-skill-select", value: minute, onChange: (event) => setTime(`${hour}:${event.target.value}`), children: MINUTES.map((value) => /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("option", { value, children: value }, value)) }),
              /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("span", { children: t("minuteUnit") })
            ] })
          ] })
        ] }),
        cadence === "weekly" ? /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("label", { className: "rolling-skill-field", children: [
          /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("span", { children: t("weekday") }),
          /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("select", { className: "rolling-skill-select", value: weekday, onChange: (event) => setWeekday(Number(event.target.value)), children: WEEKDAY_KEYS.map((key, day) => /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("option", { value: day, children: t(key) }, key)) })
        ] }) : null
      ] }),
      executionLocation === "always" ? /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("p", { className: "rolling-skill-help rolling-skill-scheduler-explanation", children: t("schedulerExplanation") }) : null,
      /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(RuntimeSelect, { t, runtimes, value: runtimeId, onChange: setRuntimeId, label: t("automaticRuntime") }),
      /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("p", { className: "rolling-skill-automatic-flow-summary", children: [
        t("automaticFlowSummaryPrefix"),
        /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("strong", { children: curatorProfileSummary }),
        t("automaticFlowSummarySuffix")
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("div", { className: "rolling-skill-grid", children: [
        /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("label", { className: "rolling-skill-field", children: [
          /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("span", { children: t("automaticDetectionModel") }),
          /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("select", { className: "rolling-skill-select", value: modelId, onChange: (event) => setModelId(event.target.value), children: models.map((model) => {
            const id = model.id ?? model.model ?? "";
            return /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("option", { value: id, children: model.displayName ?? id }, id);
          }) })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(ModelEffortSelect, { label: t("automaticDetectionEffort"), runtimeDefaultLabel: t("runtimeDefault"), models, modelId, value: effort, onChange: setEffort })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("fieldset", { className: "rolling-skill-candidate-targets", children: [
        /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("legend", { children: t("candidateSkills") }),
        /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("p", { className: "rolling-skill-help", children: t("candidateSkillsDescription") }),
        /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("div", { className: "rolling-skill-candidate-target-list", children: [
          visibleCandidateSkills.map((skill) => {
            const target = candidateTargets.find((entry) => entry.skillId === skill.id);
            const boundDatasets = datasetOptions(skill.id);
            const selectableDatasets = boundDatasets.filter((dataset) => !dataset.disabled);
            return /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("div", { className: "rolling-skill-candidate-target", children: [
              /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("label", { className: "rolling-skill-candidate-skill", children: [
                /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("input", { type: "checkbox", checked: Boolean(target), disabled: selectableDatasets.length === 0 && !target, onChange: (event) => toggleCandidate(skill.id, event.target.checked) }),
                /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("span", { children: [
                  /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("strong", { children: skill.name }),
                  /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("small", { children: skill.status !== "valid" ? t("candidateSkillUnavailable") : boundDatasets.length ? skill.description : t("candidateSkillNoDataset") })
                ] })
              ] }),
              /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("div", { className: "rolling-skill-candidate-dataset", children: [
                /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("select", { "aria-label": `${skill.name} ${t("automaticDataset")}`, className: "rolling-skill-select", disabled: !target || skill.status !== "valid", value: target?.datasetId ?? "", onChange: (event) => selectCandidateDataset(skill.id, event.target.value), children: [
                  /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("option", { value: "", children: t("selectDataset") }),
                  boundDatasets.map((option) => /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("option", { disabled: option.disabled, value: option.id, children: [
                    option.name,
                    option.disabled ? t("datasetRubricRequiredSuffix") : ""
                  ] }, option.id))
                ] }),
                skill.status === "valid" && selectableDatasets.length === 1 ? /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("small", { children: t("candidateDatasetOnlyOne") }) : null
              ] })
            ] }, skill.id);
          }),
          visibleCandidateSkills.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("p", { children: t("noCandidateSkills") }) : null
        ] })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("p", { className: "rolling-skill-help", children: mode === "scheduled" ? t("scheduledBehavior") : mode === "automatic" ? t("automaticBehavior") : t("offBehavior") }),
      error ? /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("p", { className: "rolling-skill-inline-error", role: "alert", children: error }) : null,
      /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("div", { className: "rolling-skill-form-actions", children: [
        /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("div", { className: "rolling-skill-actions", children: [
          /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(ActionButton, { disabled: busy || mode === "off" || !runtimeId || invalidCandidateTargets, onClick: () => void runOnce(), children: t("runOnce") }),
          executionLocation === "always" ? schedulerInstalled ? /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(ActionButton, { disabled: busy, onClick: () => void disableScheduler(), children: t("disableScheduler") }) : /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(ActionButton, { disabled: busy || mode === "off" || !runtimeId || invalidCandidateTargets || !status?.scheduler.supported, onClick: () => void enableScheduler(), children: t("enableScheduler") }) : null
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(ActionButton, { tone: "primary", disabled: busy || requiresRuntime && !runtimeId || invalidCandidateTargets, onClick: () => void save(), children: t("saveAutomatic") })
      ] })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("section", { className: "rolling-skill-panel", children: [
      /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("h3", { children: t("automaticStatus") }),
      /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("dl", { children: [
        /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("div", { children: [
          /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("dt", { children: t("nextRun") }),
          /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("dd", { children: displayTime(status?.nextRunAt ?? null, t("notAvailable")) })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("div", { children: [
          /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("dt", { children: t("lastSuccess") }),
          /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("dd", { children: displayTime(status?.lastSuccessAt ?? null, t("notAvailable")) })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("div", { children: [
          /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("dt", { children: t("pendingRawCases") }),
          /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("dd", { children: status?.pendingCount ?? 0 })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("div", { children: [
          /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("dt", { children: t("schedulerStatus") }),
          /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("dd", { children: executionLocation === "always" ? schedulerInstalled ? t("installed") : t("notInstalled") : t("harnessTimer") })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("div", { children: [
          /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("dt", { children: t("lastError") }),
          /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("dd", { children: status?.error || status?.scheduler.error || status?.worker.lastRegistrationError || t("noError") })
        ] })
      ] })
    ] })
  ] });
}

// src/client/workbench/CasesPanel.tsx
var import_dsh_client_ui_primitives4 = require("@deepseek-ai/dsh-client-ui-primitives");
var import_react7 = require("react");

// ../../node_modules/devlop/lib/default.js
function ok() {
}
function unreachable() {
}

// ../../node_modules/comma-separated-tokens/index.js
function stringify(values, options) {
  const settings = options || {};
  const input = values[values.length - 1] === "" ? [...values, ""] : values;
  return input.join(
    (settings.padRight ? " " : "") + "," + (settings.padLeft === false ? "" : " ")
  ).trim();
}

// ../../node_modules/estree-util-is-identifier-name/lib/index.js
var nameRe = /^[$_\p{ID_Start}][$_\u{200C}\u{200D}\p{ID_Continue}]*$/u;
var nameReJsx = /^[$_\p{ID_Start}][-$_\u{200C}\u{200D}\p{ID_Continue}]*$/u;
var emptyOptions = {};
function name(name2, options) {
  const settings = options || emptyOptions;
  const re2 = settings.jsx ? nameReJsx : nameRe;
  return re2.test(name2);
}

// ../../node_modules/hast-util-whitespace/lib/index.js
var re = /[ \t\n\f\r]/g;
function whitespace(thing) {
  return typeof thing === "object" ? thing.type === "text" ? empty(thing.value) : false : empty(thing);
}
function empty(value) {
  return value.replace(re, "") === "";
}

// ../../node_modules/property-information/lib/util/schema.js
var Schema = class {
  /**
   * @param {SchemaType['property']} property
   *   Property.
   * @param {SchemaType['normal']} normal
   *   Normal.
   * @param {Space | undefined} [space]
   *   Space.
   * @returns
   *   Schema.
   */
  constructor(property, normal, space2) {
    this.normal = normal;
    this.property = property;
    if (space2) {
      this.space = space2;
    }
  }
};
Schema.prototype.normal = {};
Schema.prototype.property = {};
Schema.prototype.space = void 0;

// ../../node_modules/property-information/lib/util/merge.js
function merge(definitions, space2) {
  const property = {};
  const normal = {};
  for (const definition2 of definitions) {
    Object.assign(property, definition2.property);
    Object.assign(normal, definition2.normal);
  }
  return new Schema(property, normal, space2);
}

// ../../node_modules/property-information/lib/normalize.js
function normalize(value) {
  return value.toLowerCase();
}

// ../../node_modules/property-information/lib/util/info.js
var Info = class {
  /**
   * @param {string} property
   *   Property.
   * @param {string} attribute
   *   Attribute.
   * @returns
   *   Info.
   */
  constructor(property, attribute) {
    this.attribute = attribute;
    this.property = property;
  }
};
Info.prototype.attribute = "";
Info.prototype.booleanish = false;
Info.prototype.boolean = false;
Info.prototype.commaOrSpaceSeparated = false;
Info.prototype.commaSeparated = false;
Info.prototype.defined = false;
Info.prototype.mustUseProperty = false;
Info.prototype.number = false;
Info.prototype.overloadedBoolean = false;
Info.prototype.property = "";
Info.prototype.spaceSeparated = false;
Info.prototype.space = void 0;

// ../../node_modules/property-information/lib/util/types.js
var types_exports = {};
__export(types_exports, {
  boolean: () => boolean,
  booleanish: () => booleanish,
  commaOrSpaceSeparated: () => commaOrSpaceSeparated,
  commaSeparated: () => commaSeparated,
  number: () => number,
  overloadedBoolean: () => overloadedBoolean,
  spaceSeparated: () => spaceSeparated
});
var powers = 0;
var boolean = increment();
var booleanish = increment();
var overloadedBoolean = increment();
var number = increment();
var spaceSeparated = increment();
var commaSeparated = increment();
var commaOrSpaceSeparated = increment();
function increment() {
  return 2 ** ++powers;
}

// ../../node_modules/property-information/lib/util/defined-info.js
var checks = (
  /** @type {ReadonlyArray<keyof typeof types>} */
  Object.keys(types_exports)
);
var DefinedInfo = class extends Info {
  /**
   * @constructor
   * @param {string} property
   *   Property.
   * @param {string} attribute
   *   Attribute.
   * @param {number | null | undefined} [mask]
   *   Mask.
   * @param {Space | undefined} [space]
   *   Space.
   * @returns
   *   Info.
   */
  constructor(property, attribute, mask, space2) {
    let index2 = -1;
    super(property, attribute);
    mark(this, "space", space2);
    if (typeof mask === "number") {
      while (++index2 < checks.length) {
        const check = checks[index2];
        mark(this, checks[index2], (mask & types_exports[check]) === types_exports[check]);
      }
    }
  }
};
DefinedInfo.prototype.defined = true;
function mark(values, key, value) {
  if (value) {
    values[key] = value;
  }
}

// ../../node_modules/property-information/lib/util/create.js
function create(definition2) {
  const properties = {};
  const normals = {};
  for (const [property, value] of Object.entries(definition2.properties)) {
    const info = new DefinedInfo(
      property,
      definition2.transform(definition2.attributes || {}, property),
      value,
      definition2.space
    );
    if (definition2.mustUseProperty && definition2.mustUseProperty.includes(property)) {
      info.mustUseProperty = true;
    }
    properties[property] = info;
    normals[normalize(property)] = property;
    normals[normalize(info.attribute)] = property;
  }
  return new Schema(properties, normals, definition2.space);
}

// ../../node_modules/property-information/lib/aria.js
var aria = create({
  properties: {
    ariaActiveDescendant: null,
    ariaAtomic: booleanish,
    ariaAutoComplete: null,
    ariaBusy: booleanish,
    ariaChecked: booleanish,
    ariaColCount: number,
    ariaColIndex: number,
    ariaColSpan: number,
    ariaControls: spaceSeparated,
    ariaCurrent: null,
    ariaDescribedBy: spaceSeparated,
    ariaDetails: null,
    ariaDisabled: booleanish,
    ariaDropEffect: spaceSeparated,
    ariaErrorMessage: null,
    ariaExpanded: booleanish,
    ariaFlowTo: spaceSeparated,
    ariaGrabbed: booleanish,
    ariaHasPopup: null,
    ariaHidden: booleanish,
    ariaInvalid: null,
    ariaKeyShortcuts: null,
    ariaLabel: null,
    ariaLabelledBy: spaceSeparated,
    ariaLevel: number,
    ariaLive: null,
    ariaModal: booleanish,
    ariaMultiLine: booleanish,
    ariaMultiSelectable: booleanish,
    ariaOrientation: null,
    ariaOwns: spaceSeparated,
    ariaPlaceholder: null,
    ariaPosInSet: number,
    ariaPressed: booleanish,
    ariaReadOnly: booleanish,
    ariaRelevant: null,
    ariaRequired: booleanish,
    ariaRoleDescription: spaceSeparated,
    ariaRowCount: number,
    ariaRowIndex: number,
    ariaRowSpan: number,
    ariaSelected: booleanish,
    ariaSetSize: number,
    ariaSort: null,
    ariaValueMax: number,
    ariaValueMin: number,
    ariaValueNow: number,
    ariaValueText: null,
    role: null
  },
  transform(_, property) {
    return property === "role" ? property : "aria-" + property.slice(4).toLowerCase();
  }
});

// ../../node_modules/property-information/lib/util/case-sensitive-transform.js
function caseSensitiveTransform(attributes, attribute) {
  return attribute in attributes ? attributes[attribute] : attribute;
}

// ../../node_modules/property-information/lib/util/case-insensitive-transform.js
function caseInsensitiveTransform(attributes, property) {
  return caseSensitiveTransform(attributes, property.toLowerCase());
}

// ../../node_modules/property-information/lib/html.js
var html = create({
  attributes: {
    acceptcharset: "accept-charset",
    classname: "class",
    htmlfor: "for",
    httpequiv: "http-equiv"
  },
  mustUseProperty: ["checked", "multiple", "muted", "selected"],
  properties: {
    // Standard Properties.
    abbr: null,
    accept: commaSeparated,
    acceptCharset: spaceSeparated,
    accessKey: spaceSeparated,
    action: null,
    allow: null,
    allowFullScreen: boolean,
    allowPaymentRequest: boolean,
    allowUserMedia: boolean,
    alpha: boolean,
    alt: null,
    as: null,
    async: boolean,
    autoCapitalize: null,
    autoComplete: spaceSeparated,
    autoFocus: boolean,
    autoPlay: boolean,
    blocking: spaceSeparated,
    capture: null,
    charSet: null,
    checked: boolean,
    cite: null,
    className: spaceSeparated,
    closedBy: null,
    colorSpace: null,
    cols: number,
    colSpan: number,
    command: null,
    commandFor: null,
    content: null,
    contentEditable: booleanish,
    controls: boolean,
    controlsList: spaceSeparated,
    coords: number | commaSeparated,
    crossOrigin: null,
    data: null,
    dateTime: null,
    decoding: null,
    default: boolean,
    defer: boolean,
    dir: null,
    dirName: null,
    disabled: boolean,
    download: overloadedBoolean,
    draggable: booleanish,
    encType: null,
    enterKeyHint: null,
    fetchPriority: null,
    form: null,
    formAction: null,
    formEncType: null,
    formMethod: null,
    formNoValidate: boolean,
    formTarget: null,
    headers: spaceSeparated,
    height: number,
    hidden: overloadedBoolean,
    high: number,
    href: null,
    hrefLang: null,
    htmlFor: spaceSeparated,
    httpEquiv: spaceSeparated,
    id: null,
    imageSizes: null,
    imageSrcSet: null,
    inert: boolean,
    inputMode: null,
    integrity: null,
    is: null,
    isMap: boolean,
    itemId: null,
    itemProp: spaceSeparated,
    itemRef: spaceSeparated,
    itemScope: boolean,
    itemType: spaceSeparated,
    kind: null,
    label: null,
    lang: null,
    language: null,
    list: null,
    loading: null,
    loop: boolean,
    low: number,
    manifest: null,
    max: null,
    maxLength: number,
    media: null,
    method: null,
    min: null,
    minLength: number,
    multiple: boolean,
    muted: boolean,
    name: null,
    nonce: null,
    noModule: boolean,
    noValidate: boolean,
    onAbort: null,
    onAfterPrint: null,
    onAuxClick: null,
    onBeforeMatch: null,
    onBeforePrint: null,
    onBeforeToggle: null,
    onBeforeUnload: null,
    onBlur: null,
    onCancel: null,
    onCanPlay: null,
    onCanPlayThrough: null,
    onChange: null,
    onClick: null,
    onClose: null,
    onContextLost: null,
    onContextMenu: null,
    onContextRestored: null,
    onCopy: null,
    onCueChange: null,
    onCut: null,
    onDblClick: null,
    onDrag: null,
    onDragEnd: null,
    onDragEnter: null,
    onDragExit: null,
    onDragLeave: null,
    onDragOver: null,
    onDragStart: null,
    onDrop: null,
    onDurationChange: null,
    onEmptied: null,
    onEnded: null,
    onError: null,
    onFocus: null,
    onFormData: null,
    onHashChange: null,
    onInput: null,
    onInvalid: null,
    onKeyDown: null,
    onKeyPress: null,
    onKeyUp: null,
    onLanguageChange: null,
    onLoad: null,
    onLoadedData: null,
    onLoadedMetadata: null,
    onLoadEnd: null,
    onLoadStart: null,
    onMessage: null,
    onMessageError: null,
    onMouseDown: null,
    onMouseEnter: null,
    onMouseLeave: null,
    onMouseMove: null,
    onMouseOut: null,
    onMouseOver: null,
    onMouseUp: null,
    onOffline: null,
    onOnline: null,
    onPageHide: null,
    onPageShow: null,
    onPaste: null,
    onPause: null,
    onPlay: null,
    onPlaying: null,
    onPopState: null,
    onProgress: null,
    onRateChange: null,
    onRejectionHandled: null,
    onReset: null,
    onResize: null,
    onScroll: null,
    onScrollEnd: null,
    onSecurityPolicyViolation: null,
    onSeeked: null,
    onSeeking: null,
    onSelect: null,
    onSlotChange: null,
    onStalled: null,
    onStorage: null,
    onSubmit: null,
    onSuspend: null,
    onTimeUpdate: null,
    onToggle: null,
    onUnhandledRejection: null,
    onUnload: null,
    onVolumeChange: null,
    onWaiting: null,
    onWheel: null,
    open: boolean,
    optimum: number,
    pattern: null,
    ping: spaceSeparated,
    placeholder: null,
    playsInline: boolean,
    popover: null,
    popoverTarget: null,
    popoverTargetAction: null,
    poster: null,
    preload: null,
    readOnly: boolean,
    referrerPolicy: null,
    rel: spaceSeparated,
    required: boolean,
    reversed: boolean,
    rows: number,
    rowSpan: number,
    sandbox: spaceSeparated,
    scope: null,
    scoped: boolean,
    seamless: boolean,
    selected: boolean,
    shadowRootClonable: boolean,
    shadowRootCustomElementRegistry: boolean,
    shadowRootDelegatesFocus: boolean,
    shadowRootMode: null,
    shadowRootSerializable: boolean,
    shape: null,
    size: number,
    sizes: null,
    slot: null,
    span: number,
    spellCheck: booleanish,
    src: null,
    srcDoc: null,
    srcLang: null,
    srcSet: null,
    start: number,
    step: null,
    style: null,
    tabIndex: number,
    target: null,
    title: null,
    translate: null,
    type: null,
    typeMustMatch: boolean,
    useMap: null,
    value: booleanish,
    width: number,
    wrap: null,
    writingSuggestions: null,
    // Legacy.
    // See: https://html.spec.whatwg.org/#other-elements,-attributes-and-apis
    align: null,
    // Several. Use CSS `text-align` instead,
    aLink: null,
    // `<body>`. Use CSS `a:active {color}` instead
    archive: spaceSeparated,
    // `<object>`. List of URIs to archives
    axis: null,
    // `<td>` and `<th>`. Use `scope` on `<th>`
    background: null,
    // `<body>`. Use CSS `background-image` instead
    bgColor: null,
    // `<body>` and table elements. Use CSS `background-color` instead
    border: number,
    // `<table>`. Use CSS `border-width` instead,
    borderColor: null,
    // `<table>`. Use CSS `border-color` instead,
    bottomMargin: number,
    // `<body>`
    cellPadding: null,
    // `<table>`
    cellSpacing: null,
    // `<table>`
    char: null,
    // Several table elements. When `align=char`, sets the character to align on
    charOff: null,
    // Several table elements. When `char`, offsets the alignment
    classId: null,
    // `<object>`
    clear: null,
    // `<br>`. Use CSS `clear` instead
    code: null,
    // `<object>`
    codeBase: null,
    // `<object>`
    codeType: null,
    // `<object>`
    color: null,
    // `<font>` and `<hr>`. Use CSS instead
    compact: boolean,
    // Lists. Use CSS to reduce space between items instead
    declare: boolean,
    // `<object>`
    event: null,
    // `<script>`
    face: null,
    // `<font>`. Use CSS instead
    frame: null,
    // `<table>`
    frameBorder: null,
    // `<iframe>`. Use CSS `border` instead
    hSpace: number,
    // `<img>` and `<object>`
    leftMargin: number,
    // `<body>`
    link: null,
    // `<body>`. Use CSS `a:link {color: *}` instead
    longDesc: null,
    // `<frame>`, `<iframe>`, and `<img>`. Use an `<a>`
    lowSrc: null,
    // `<img>`. Use a `<picture>`
    marginHeight: number,
    // `<body>`
    marginWidth: number,
    // `<body>`
    noResize: boolean,
    // `<frame>`
    noHref: boolean,
    // `<area>`. Use no href instead of an explicit `nohref`
    noShade: boolean,
    // `<hr>`. Use background-color and height instead of borders
    noWrap: boolean,
    // `<td>` and `<th>`
    object: null,
    // `<applet>`
    profile: null,
    // `<head>`
    prompt: null,
    // `<isindex>`
    rev: null,
    // `<link>`
    rightMargin: number,
    // `<body>`
    rules: null,
    // `<table>`
    scheme: null,
    // `<meta>`
    scrolling: booleanish,
    // `<frame>`. Use overflow in the child context
    standby: null,
    // `<object>`
    summary: null,
    // `<table>`
    text: null,
    // `<body>`. Use CSS `color` instead
    topMargin: number,
    // `<body>`
    valueType: null,
    // `<param>`
    version: null,
    // `<html>`. Use a doctype.
    vAlign: null,
    // Several. Use CSS `vertical-align` instead
    vLink: null,
    // `<body>`. Use CSS `a:visited {color}` instead
    vSpace: number,
    // `<img>` and `<object>`
    // Non-standard Properties.
    allowTransparency: null,
    autoCorrect: null,
    autoSave: null,
    credentialless: boolean,
    disablePictureInPicture: boolean,
    disableRemotePlayback: boolean,
    exportParts: commaSeparated,
    part: spaceSeparated,
    prefix: null,
    property: null,
    results: number,
    security: null,
    unselectable: null
  },
  space: "html",
  transform: caseInsensitiveTransform
});

// ../../node_modules/property-information/lib/svg.js
var svg = create({
  attributes: {
    accentHeight: "accent-height",
    alignmentBaseline: "alignment-baseline",
    arabicForm: "arabic-form",
    baselineShift: "baseline-shift",
    capHeight: "cap-height",
    className: "class",
    clipPath: "clip-path",
    clipRule: "clip-rule",
    colorInterpolation: "color-interpolation",
    colorInterpolationFilters: "color-interpolation-filters",
    colorProfile: "color-profile",
    colorRendering: "color-rendering",
    crossOrigin: "crossorigin",
    dataType: "datatype",
    dominantBaseline: "dominant-baseline",
    enableBackground: "enable-background",
    fillOpacity: "fill-opacity",
    fillRule: "fill-rule",
    floodColor: "flood-color",
    floodOpacity: "flood-opacity",
    fontFamily: "font-family",
    fontSize: "font-size",
    fontSizeAdjust: "font-size-adjust",
    fontStretch: "font-stretch",
    fontStyle: "font-style",
    fontVariant: "font-variant",
    fontWeight: "font-weight",
    glyphName: "glyph-name",
    glyphOrientationHorizontal: "glyph-orientation-horizontal",
    glyphOrientationVertical: "glyph-orientation-vertical",
    hrefLang: "hreflang",
    horizAdvX: "horiz-adv-x",
    horizOriginX: "horiz-origin-x",
    horizOriginY: "horiz-origin-y",
    imageRendering: "image-rendering",
    letterSpacing: "letter-spacing",
    lightingColor: "lighting-color",
    markerEnd: "marker-end",
    markerMid: "marker-mid",
    markerStart: "marker-start",
    maskType: "mask-type",
    navDown: "nav-down",
    navDownLeft: "nav-down-left",
    navDownRight: "nav-down-right",
    navLeft: "nav-left",
    navNext: "nav-next",
    navPrev: "nav-prev",
    navRight: "nav-right",
    navUp: "nav-up",
    navUpLeft: "nav-up-left",
    navUpRight: "nav-up-right",
    onAbort: "onabort",
    onActivate: "onactivate",
    onAfterPrint: "onafterprint",
    onBeforePrint: "onbeforeprint",
    onBegin: "onbegin",
    onCancel: "oncancel",
    onCanPlay: "oncanplay",
    onCanPlayThrough: "oncanplaythrough",
    onChange: "onchange",
    onClick: "onclick",
    onClose: "onclose",
    onCopy: "oncopy",
    onCueChange: "oncuechange",
    onCut: "oncut",
    onDblClick: "ondblclick",
    onDrag: "ondrag",
    onDragEnd: "ondragend",
    onDragEnter: "ondragenter",
    onDragExit: "ondragexit",
    onDragLeave: "ondragleave",
    onDragOver: "ondragover",
    onDragStart: "ondragstart",
    onDrop: "ondrop",
    onDurationChange: "ondurationchange",
    onEmptied: "onemptied",
    onEnd: "onend",
    onEnded: "onended",
    onError: "onerror",
    onFocus: "onfocus",
    onFocusIn: "onfocusin",
    onFocusOut: "onfocusout",
    onHashChange: "onhashchange",
    onInput: "oninput",
    onInvalid: "oninvalid",
    onKeyDown: "onkeydown",
    onKeyPress: "onkeypress",
    onKeyUp: "onkeyup",
    onLoad: "onload",
    onLoadedData: "onloadeddata",
    onLoadedMetadata: "onloadedmetadata",
    onLoadStart: "onloadstart",
    onMessage: "onmessage",
    onMouseDown: "onmousedown",
    onMouseEnter: "onmouseenter",
    onMouseLeave: "onmouseleave",
    onMouseMove: "onmousemove",
    onMouseOut: "onmouseout",
    onMouseOver: "onmouseover",
    onMouseUp: "onmouseup",
    onMouseWheel: "onmousewheel",
    onOffline: "onoffline",
    onOnline: "ononline",
    onPageHide: "onpagehide",
    onPageShow: "onpageshow",
    onPaste: "onpaste",
    onPause: "onpause",
    onPlay: "onplay",
    onPlaying: "onplaying",
    onPopState: "onpopstate",
    onProgress: "onprogress",
    onRateChange: "onratechange",
    onRepeat: "onrepeat",
    onReset: "onreset",
    onResize: "onresize",
    onScroll: "onscroll",
    onSeeked: "onseeked",
    onSeeking: "onseeking",
    onSelect: "onselect",
    onShow: "onshow",
    onStalled: "onstalled",
    onStorage: "onstorage",
    onSubmit: "onsubmit",
    onSuspend: "onsuspend",
    onTimeUpdate: "ontimeupdate",
    onToggle: "ontoggle",
    onUnload: "onunload",
    onVolumeChange: "onvolumechange",
    onWaiting: "onwaiting",
    onZoom: "onzoom",
    overlinePosition: "overline-position",
    overlineThickness: "overline-thickness",
    paintOrder: "paint-order",
    panose1: "panose-1",
    pointerEvents: "pointer-events",
    referrerPolicy: "referrerpolicy",
    renderingIntent: "rendering-intent",
    shapeRendering: "shape-rendering",
    stopColor: "stop-color",
    stopOpacity: "stop-opacity",
    strikethroughPosition: "strikethrough-position",
    strikethroughThickness: "strikethrough-thickness",
    strokeDashArray: "stroke-dasharray",
    strokeDashOffset: "stroke-dashoffset",
    strokeLineCap: "stroke-linecap",
    strokeLineJoin: "stroke-linejoin",
    strokeMiterLimit: "stroke-miterlimit",
    strokeOpacity: "stroke-opacity",
    strokeWidth: "stroke-width",
    tabIndex: "tabindex",
    textAnchor: "text-anchor",
    textDecoration: "text-decoration",
    textRendering: "text-rendering",
    transformOrigin: "transform-origin",
    typeOf: "typeof",
    underlinePosition: "underline-position",
    underlineThickness: "underline-thickness",
    unicodeBidi: "unicode-bidi",
    unicodeRange: "unicode-range",
    unitsPerEm: "units-per-em",
    vAlphabetic: "v-alphabetic",
    vHanging: "v-hanging",
    vIdeographic: "v-ideographic",
    vMathematical: "v-mathematical",
    vectorEffect: "vector-effect",
    vertAdvY: "vert-adv-y",
    vertOriginX: "vert-origin-x",
    vertOriginY: "vert-origin-y",
    wordSpacing: "word-spacing",
    writingMode: "writing-mode",
    xHeight: "x-height",
    // These were camelcased in Tiny. Now lowercased in SVG 2
    playbackOrder: "playbackorder",
    timelineBegin: "timelinebegin"
  },
  properties: {
    about: commaOrSpaceSeparated,
    accentHeight: number,
    accumulate: null,
    additive: null,
    alignmentBaseline: null,
    alphabetic: number,
    amplitude: number,
    arabicForm: null,
    ascent: number,
    attributeName: null,
    attributeType: null,
    azimuth: number,
    bandwidth: null,
    baselineShift: null,
    baseFrequency: null,
    baseProfile: null,
    bbox: null,
    begin: null,
    bias: number,
    by: null,
    calcMode: null,
    capHeight: number,
    className: spaceSeparated,
    clip: null,
    clipPath: null,
    clipPathUnits: null,
    clipRule: null,
    color: null,
    colorInterpolation: null,
    colorInterpolationFilters: null,
    colorProfile: null,
    colorRendering: null,
    content: null,
    contentScriptType: null,
    contentStyleType: null,
    crossOrigin: null,
    cursor: null,
    cx: null,
    cy: null,
    d: null,
    dataType: null,
    defaultAction: null,
    descent: number,
    diffuseConstant: number,
    direction: null,
    display: null,
    dur: null,
    divisor: number,
    dominantBaseline: null,
    download: boolean,
    dx: null,
    dy: null,
    edgeMode: null,
    editable: null,
    elevation: number,
    enableBackground: null,
    end: null,
    event: null,
    exponent: number,
    externalResourcesRequired: null,
    fill: null,
    fillOpacity: number,
    fillRule: null,
    filter: null,
    filterRes: null,
    filterUnits: null,
    floodColor: null,
    floodOpacity: null,
    focusable: null,
    focusHighlight: null,
    fontFamily: null,
    fontSize: null,
    fontSizeAdjust: null,
    fontStretch: null,
    fontStyle: null,
    fontVariant: null,
    fontWeight: null,
    format: null,
    fr: null,
    from: null,
    fx: null,
    fy: null,
    g1: commaSeparated,
    g2: commaSeparated,
    glyphName: commaSeparated,
    glyphOrientationHorizontal: null,
    glyphOrientationVertical: null,
    glyphRef: null,
    gradientTransform: null,
    gradientUnits: null,
    handler: null,
    hanging: number,
    hatchContentUnits: null,
    hatchUnits: null,
    height: null,
    href: null,
    hrefLang: null,
    horizAdvX: number,
    horizOriginX: number,
    horizOriginY: number,
    id: null,
    ideographic: number,
    imageRendering: null,
    initialVisibility: null,
    in: null,
    in2: null,
    intercept: number,
    k: number,
    k1: number,
    k2: number,
    k3: number,
    k4: number,
    kernelMatrix: commaOrSpaceSeparated,
    kernelUnitLength: null,
    keyPoints: null,
    // SEMI_COLON_SEPARATED
    keySplines: null,
    // SEMI_COLON_SEPARATED
    keyTimes: null,
    // SEMI_COLON_SEPARATED
    kerning: null,
    lang: null,
    lengthAdjust: null,
    letterSpacing: null,
    lightingColor: null,
    limitingConeAngle: number,
    local: null,
    markerEnd: null,
    markerMid: null,
    markerStart: null,
    markerHeight: null,
    markerUnits: null,
    markerWidth: null,
    mask: null,
    maskContentUnits: null,
    maskType: null,
    maskUnits: null,
    mathematical: null,
    max: null,
    media: null,
    mediaCharacterEncoding: null,
    mediaContentEncodings: null,
    mediaSize: number,
    mediaTime: null,
    method: null,
    min: null,
    mode: null,
    name: null,
    navDown: null,
    navDownLeft: null,
    navDownRight: null,
    navLeft: null,
    navNext: null,
    navPrev: null,
    navRight: null,
    navUp: null,
    navUpLeft: null,
    navUpRight: null,
    numOctaves: null,
    observer: null,
    offset: null,
    onAbort: null,
    onActivate: null,
    onAfterPrint: null,
    onBeforePrint: null,
    onBegin: null,
    onCancel: null,
    onCanPlay: null,
    onCanPlayThrough: null,
    onChange: null,
    onClick: null,
    onClose: null,
    onCopy: null,
    onCueChange: null,
    onCut: null,
    onDblClick: null,
    onDrag: null,
    onDragEnd: null,
    onDragEnter: null,
    onDragExit: null,
    onDragLeave: null,
    onDragOver: null,
    onDragStart: null,
    onDrop: null,
    onDurationChange: null,
    onEmptied: null,
    onEnd: null,
    onEnded: null,
    onError: null,
    onFocus: null,
    onFocusIn: null,
    onFocusOut: null,
    onHashChange: null,
    onInput: null,
    onInvalid: null,
    onKeyDown: null,
    onKeyPress: null,
    onKeyUp: null,
    onLoad: null,
    onLoadedData: null,
    onLoadedMetadata: null,
    onLoadStart: null,
    onMessage: null,
    onMouseDown: null,
    onMouseEnter: null,
    onMouseLeave: null,
    onMouseMove: null,
    onMouseOut: null,
    onMouseOver: null,
    onMouseUp: null,
    onMouseWheel: null,
    onOffline: null,
    onOnline: null,
    onPageHide: null,
    onPageShow: null,
    onPaste: null,
    onPause: null,
    onPlay: null,
    onPlaying: null,
    onPopState: null,
    onProgress: null,
    onRateChange: null,
    onRepeat: null,
    onReset: null,
    onResize: null,
    onScroll: null,
    onSeeked: null,
    onSeeking: null,
    onSelect: null,
    onShow: null,
    onStalled: null,
    onStorage: null,
    onSubmit: null,
    onSuspend: null,
    onTimeUpdate: null,
    onToggle: null,
    onUnload: null,
    onVolumeChange: null,
    onWaiting: null,
    onZoom: null,
    opacity: null,
    operator: null,
    order: null,
    orient: null,
    orientation: null,
    origin: null,
    overflow: null,
    overlay: null,
    overlinePosition: number,
    overlineThickness: number,
    paintOrder: null,
    panose1: null,
    path: null,
    pathLength: number,
    patternContentUnits: null,
    patternTransform: null,
    patternUnits: null,
    phase: null,
    ping: spaceSeparated,
    pitch: null,
    playbackOrder: null,
    pointerEvents: null,
    points: null,
    pointsAtX: number,
    pointsAtY: number,
    pointsAtZ: number,
    preserveAlpha: null,
    preserveAspectRatio: null,
    primitiveUnits: null,
    propagate: null,
    property: commaOrSpaceSeparated,
    r: null,
    radius: null,
    referrerPolicy: null,
    refX: null,
    refY: null,
    rel: commaOrSpaceSeparated,
    rev: commaOrSpaceSeparated,
    renderingIntent: null,
    repeatCount: null,
    repeatDur: null,
    requiredExtensions: commaOrSpaceSeparated,
    requiredFeatures: commaOrSpaceSeparated,
    requiredFonts: commaOrSpaceSeparated,
    requiredFormats: commaOrSpaceSeparated,
    resource: null,
    restart: null,
    result: null,
    rotate: null,
    rx: null,
    ry: null,
    scale: null,
    seed: null,
    shapeRendering: null,
    side: null,
    slope: null,
    snapshotTime: null,
    specularConstant: number,
    specularExponent: number,
    spreadMethod: null,
    spacing: null,
    startOffset: null,
    stdDeviation: null,
    stemh: null,
    stemv: null,
    stitchTiles: null,
    stopColor: null,
    stopOpacity: null,
    strikethroughPosition: number,
    strikethroughThickness: number,
    string: null,
    stroke: null,
    strokeDashArray: commaOrSpaceSeparated,
    strokeDashOffset: null,
    strokeLineCap: null,
    strokeLineJoin: null,
    strokeMiterLimit: number,
    strokeOpacity: number,
    strokeWidth: null,
    style: null,
    surfaceScale: number,
    syncBehavior: null,
    syncBehaviorDefault: null,
    syncMaster: null,
    syncTolerance: null,
    syncToleranceDefault: null,
    systemLanguage: commaOrSpaceSeparated,
    tabIndex: number,
    tableValues: null,
    target: null,
    targetX: number,
    targetY: number,
    textAnchor: null,
    textDecoration: null,
    textRendering: null,
    textLength: null,
    timelineBegin: null,
    title: null,
    transformBehavior: null,
    type: null,
    typeOf: commaOrSpaceSeparated,
    to: null,
    transform: null,
    transformOrigin: null,
    u1: null,
    u2: null,
    underlinePosition: number,
    underlineThickness: number,
    unicode: null,
    unicodeBidi: null,
    unicodeRange: null,
    unitsPerEm: number,
    values: null,
    vAlphabetic: number,
    vMathematical: number,
    vectorEffect: null,
    vHanging: number,
    vIdeographic: number,
    version: null,
    vertAdvY: number,
    vertOriginX: number,
    vertOriginY: number,
    viewBox: null,
    viewTarget: null,
    visibility: null,
    width: null,
    widths: null,
    wordSpacing: null,
    writingMode: null,
    x: null,
    x1: null,
    x2: null,
    xChannelSelector: null,
    xHeight: number,
    y: null,
    y1: null,
    y2: null,
    yChannelSelector: null,
    z: null,
    zoomAndPan: null
  },
  space: "svg",
  transform: caseSensitiveTransform
});

// ../../node_modules/property-information/lib/xlink.js
var xlink = create({
  properties: {
    xLinkActuate: null,
    xLinkArcRole: null,
    xLinkHref: null,
    xLinkRole: null,
    xLinkShow: null,
    xLinkTitle: null,
    xLinkType: null
  },
  space: "xlink",
  transform(_, property) {
    return "xlink:" + property.slice(5).toLowerCase();
  }
});

// ../../node_modules/property-information/lib/xmlns.js
var xmlns = create({
  attributes: { xmlnsxlink: "xmlns:xlink" },
  properties: { xmlnsXLink: null, xmlns: null },
  space: "xmlns",
  transform: caseInsensitiveTransform
});

// ../../node_modules/property-information/lib/xml.js
var xml = create({
  properties: { xmlBase: null, xmlLang: null, xmlSpace: null },
  space: "xml",
  transform(_, property) {
    return "xml:" + property.slice(3).toLowerCase();
  }
});

// ../../node_modules/property-information/lib/hast-to-react.js
var hastToReact = {
  classId: "classID",
  dataType: "datatype",
  itemId: "itemID",
  strokeDashArray: "strokeDasharray",
  strokeDashOffset: "strokeDashoffset",
  strokeLineCap: "strokeLinecap",
  strokeLineJoin: "strokeLinejoin",
  strokeMiterLimit: "strokeMiterlimit",
  typeOf: "typeof",
  xLinkActuate: "xlinkActuate",
  xLinkArcRole: "xlinkArcrole",
  xLinkHref: "xlinkHref",
  xLinkRole: "xlinkRole",
  xLinkShow: "xlinkShow",
  xLinkTitle: "xlinkTitle",
  xLinkType: "xlinkType",
  xmlnsXLink: "xmlnsXlink"
};

// ../../node_modules/property-information/lib/find.js
var cap = /[A-Z]/g;
var dash = /-[a-z]/g;
var valid = /^data[-\w.:]+$/i;
function find(schema, value) {
  const normal = normalize(value);
  let property = value;
  let Type = Info;
  if (normal in schema.normal) {
    return schema.property[schema.normal[normal]];
  }
  if (normal.length > 4 && normal.slice(0, 4) === "data" && valid.test(value)) {
    if (value.charAt(4) === "-") {
      const rest = value.slice(5).replace(dash, camelcase);
      property = "data" + rest.charAt(0).toUpperCase() + rest.slice(1);
    } else {
      const rest = value.slice(4);
      if (!dash.test(rest)) {
        let dashes = rest.replace(cap, kebab);
        if (dashes.charAt(0) !== "-") {
          dashes = "-" + dashes;
        }
        value = "data" + dashes;
      }
    }
    Type = DefinedInfo;
  }
  return new Type(property, value);
}
function kebab($0) {
  return "-" + $0.toLowerCase();
}
function camelcase($0) {
  return $0.charAt(1).toUpperCase();
}

// ../../node_modules/property-information/index.js
var html2 = merge([aria, html, xlink, xmlns, xml], "html");
var svg2 = merge([aria, svg, xlink, xmlns, xml], "svg");

// ../../node_modules/space-separated-tokens/index.js
function stringify2(values) {
  return values.join(" ").trim();
}

// ../../node_modules/hast-util-to-jsx-runtime/lib/index.js
var import_style_to_js = __toESM(require_cjs3(), 1);

// ../../node_modules/unist-util-position/lib/index.js
var pointEnd = point("end");
var pointStart = point("start");
function point(type) {
  return point4;
  function point4(node2) {
    const point5 = node2 && node2.position && node2.position[type] || {};
    if (typeof point5.line === "number" && point5.line > 0 && typeof point5.column === "number" && point5.column > 0) {
      return {
        line: point5.line,
        column: point5.column,
        offset: typeof point5.offset === "number" && point5.offset > -1 ? point5.offset : void 0
      };
    }
  }
}
function position(node2) {
  const start2 = pointStart(node2);
  const end = pointEnd(node2);
  if (start2 && end) {
    return { start: start2, end };
  }
}

// ../../node_modules/unist-util-stringify-position/lib/index.js
function stringifyPosition(value) {
  if (!value || typeof value !== "object") {
    return "";
  }
  if ("position" in value || "type" in value) {
    return position2(value.position);
  }
  if ("start" in value || "end" in value) {
    return position2(value);
  }
  if ("line" in value || "column" in value) {
    return point2(value);
  }
  return "";
}
function point2(point4) {
  return index(point4 && point4.line) + ":" + index(point4 && point4.column);
}
function position2(pos) {
  return point2(pos && pos.start) + "-" + point2(pos && pos.end);
}
function index(value) {
  return value && typeof value === "number" ? value : 1;
}

// ../../node_modules/vfile-message/lib/index.js
var VFileMessage = class extends Error {
  /**
   * Create a message for `reason`.
   *
   * > 🪦 **Note**: also has obsolete signatures.
   *
   * @overload
   * @param {string} reason
   * @param {Options | null | undefined} [options]
   * @returns
   *
   * @overload
   * @param {string} reason
   * @param {Node | NodeLike | null | undefined} parent
   * @param {string | null | undefined} [origin]
   * @returns
   *
   * @overload
   * @param {string} reason
   * @param {Point | Position | null | undefined} place
   * @param {string | null | undefined} [origin]
   * @returns
   *
   * @overload
   * @param {string} reason
   * @param {string | null | undefined} [origin]
   * @returns
   *
   * @overload
   * @param {Error | VFileMessage} cause
   * @param {Node | NodeLike | null | undefined} parent
   * @param {string | null | undefined} [origin]
   * @returns
   *
   * @overload
   * @param {Error | VFileMessage} cause
   * @param {Point | Position | null | undefined} place
   * @param {string | null | undefined} [origin]
   * @returns
   *
   * @overload
   * @param {Error | VFileMessage} cause
   * @param {string | null | undefined} [origin]
   * @returns
   *
   * @param {Error | VFileMessage | string} causeOrReason
   *   Reason for message, should use markdown.
   * @param {Node | NodeLike | Options | Point | Position | string | null | undefined} [optionsOrParentOrPlace]
   *   Configuration (optional).
   * @param {string | null | undefined} [origin]
   *   Place in code where the message originates (example:
   *   `'my-package:my-rule'` or `'my-rule'`).
   * @returns
   *   Instance of `VFileMessage`.
   */
  // eslint-disable-next-line complexity
  constructor(causeOrReason, optionsOrParentOrPlace, origin) {
    super();
    if (typeof optionsOrParentOrPlace === "string") {
      origin = optionsOrParentOrPlace;
      optionsOrParentOrPlace = void 0;
    }
    let reason = "";
    let options = {};
    let legacyCause = false;
    if (optionsOrParentOrPlace) {
      if ("line" in optionsOrParentOrPlace && "column" in optionsOrParentOrPlace) {
        options = { place: optionsOrParentOrPlace };
      } else if ("start" in optionsOrParentOrPlace && "end" in optionsOrParentOrPlace) {
        options = { place: optionsOrParentOrPlace };
      } else if ("type" in optionsOrParentOrPlace) {
        options = {
          ancestors: [optionsOrParentOrPlace],
          place: optionsOrParentOrPlace.position
        };
      } else {
        options = { ...optionsOrParentOrPlace };
      }
    }
    if (typeof causeOrReason === "string") {
      reason = causeOrReason;
    } else if (!options.cause && causeOrReason) {
      legacyCause = true;
      reason = causeOrReason.message;
      options.cause = causeOrReason;
    }
    if (!options.ruleId && !options.source && typeof origin === "string") {
      const index2 = origin.indexOf(":");
      if (index2 === -1) {
        options.ruleId = origin;
      } else {
        options.source = origin.slice(0, index2);
        options.ruleId = origin.slice(index2 + 1);
      }
    }
    if (!options.place && options.ancestors && options.ancestors) {
      const parent = options.ancestors[options.ancestors.length - 1];
      if (parent) {
        options.place = parent.position;
      }
    }
    const start2 = options.place && "start" in options.place ? options.place.start : options.place;
    this.ancestors = options.ancestors || void 0;
    this.cause = options.cause || void 0;
    this.column = start2 ? start2.column : void 0;
    this.fatal = void 0;
    this.file = "";
    this.message = reason;
    this.line = start2 ? start2.line : void 0;
    this.name = stringifyPosition(options.place) || "1:1";
    this.place = options.place || void 0;
    this.reason = this.message;
    this.ruleId = options.ruleId || void 0;
    this.source = options.source || void 0;
    this.stack = legacyCause && options.cause && typeof options.cause.stack === "string" ? options.cause.stack : "";
    this.actual = void 0;
    this.expected = void 0;
    this.note = void 0;
    this.url = void 0;
  }
};
VFileMessage.prototype.file = "";
VFileMessage.prototype.name = "";
VFileMessage.prototype.reason = "";
VFileMessage.prototype.message = "";
VFileMessage.prototype.stack = "";
VFileMessage.prototype.column = void 0;
VFileMessage.prototype.line = void 0;
VFileMessage.prototype.ancestors = void 0;
VFileMessage.prototype.cause = void 0;
VFileMessage.prototype.fatal = void 0;
VFileMessage.prototype.place = void 0;
VFileMessage.prototype.ruleId = void 0;
VFileMessage.prototype.source = void 0;

// ../../node_modules/hast-util-to-jsx-runtime/lib/index.js
var own = {}.hasOwnProperty;
var emptyMap = /* @__PURE__ */ new Map();
var cap2 = /[A-Z]/g;
var tableElements = /* @__PURE__ */ new Set(["table", "tbody", "thead", "tfoot", "tr"]);
var tableCellElement = /* @__PURE__ */ new Set(["td", "th"]);
var docs = "https://github.com/syntax-tree/hast-util-to-jsx-runtime";
function toJsxRuntime(tree, options) {
  if (!options || options.Fragment === void 0) {
    throw new TypeError("Expected `Fragment` in options");
  }
  const filePath = options.filePath || void 0;
  let create2;
  if (options.development) {
    if (typeof options.jsxDEV !== "function") {
      throw new TypeError(
        "Expected `jsxDEV` in options when `development: true`"
      );
    }
    create2 = developmentCreate(filePath, options.jsxDEV);
  } else {
    if (typeof options.jsx !== "function") {
      throw new TypeError("Expected `jsx` in production options");
    }
    if (typeof options.jsxs !== "function") {
      throw new TypeError("Expected `jsxs` in production options");
    }
    create2 = productionCreate(filePath, options.jsx, options.jsxs);
  }
  const state = {
    Fragment: options.Fragment,
    ancestors: [],
    components: options.components || {},
    create: create2,
    elementAttributeNameCase: options.elementAttributeNameCase || "react",
    evaluater: options.createEvaluater ? options.createEvaluater() : void 0,
    filePath,
    ignoreInvalidStyle: options.ignoreInvalidStyle || false,
    passKeys: options.passKeys !== false,
    passNode: options.passNode || false,
    schema: options.space === "svg" ? svg2 : html2,
    stylePropertyNameCase: options.stylePropertyNameCase || "dom",
    tableCellAlignToStyle: options.tableCellAlignToStyle !== false
  };
  const result = one(state, tree, void 0);
  if (result && typeof result !== "string") {
    return result;
  }
  return state.create(
    tree,
    state.Fragment,
    { children: result || void 0 },
    void 0
  );
}
function one(state, node2, key) {
  if (node2.type === "element") {
    return element(state, node2, key);
  }
  if (node2.type === "mdxFlowExpression" || node2.type === "mdxTextExpression") {
    return mdxExpression(state, node2);
  }
  if (node2.type === "mdxJsxFlowElement" || node2.type === "mdxJsxTextElement") {
    return mdxJsxElement(state, node2, key);
  }
  if (node2.type === "mdxjsEsm") {
    return mdxEsm(state, node2);
  }
  if (node2.type === "root") {
    return root(state, node2, key);
  }
  if (node2.type === "text") {
    return text(state, node2);
  }
}
function element(state, node2, key) {
  const parentSchema = state.schema;
  let schema = parentSchema;
  if (node2.tagName.toLowerCase() === "svg" && parentSchema.space === "html") {
    schema = svg2;
    state.schema = schema;
  }
  state.ancestors.push(node2);
  const type = findComponentFromName(state, node2.tagName, false);
  const props = createElementProps(state, node2);
  let children = createChildren(state, node2);
  if (tableElements.has(node2.tagName)) {
    children = children.filter(function(child) {
      return typeof child === "string" ? !whitespace(child) : true;
    });
  }
  addNode(state, props, type, node2);
  addChildren(props, children);
  state.ancestors.pop();
  state.schema = parentSchema;
  return state.create(node2, type, props, key);
}
function mdxExpression(state, node2) {
  if (node2.data && node2.data.estree && state.evaluater) {
    const program = node2.data.estree;
    const expression = program.body[0];
    ok(expression.type === "ExpressionStatement");
    return (
      /** @type {Child | undefined} */
      state.evaluater.evaluateExpression(expression.expression)
    );
  }
  crashEstree(state, node2.position);
}
function mdxEsm(state, node2) {
  if (node2.data && node2.data.estree && state.evaluater) {
    return (
      /** @type {Child | undefined} */
      state.evaluater.evaluateProgram(node2.data.estree)
    );
  }
  crashEstree(state, node2.position);
}
function mdxJsxElement(state, node2, key) {
  const parentSchema = state.schema;
  let schema = parentSchema;
  if (node2.name === "svg" && parentSchema.space === "html") {
    schema = svg2;
    state.schema = schema;
  }
  state.ancestors.push(node2);
  const type = node2.name === null ? state.Fragment : findComponentFromName(state, node2.name, true);
  const props = createJsxElementProps(state, node2);
  const children = createChildren(state, node2);
  addNode(state, props, type, node2);
  addChildren(props, children);
  state.ancestors.pop();
  state.schema = parentSchema;
  return state.create(node2, type, props, key);
}
function root(state, node2, key) {
  const props = {};
  addChildren(props, createChildren(state, node2));
  return state.create(node2, state.Fragment, props, key);
}
function text(_, node2) {
  return node2.value;
}
function addNode(state, props, type, node2) {
  if (typeof type !== "string" && type !== state.Fragment && state.passNode) {
    props.node = node2;
  }
}
function addChildren(props, children) {
  if (children.length > 0) {
    const value = children.length > 1 ? children : children[0];
    if (value) {
      props.children = value;
    }
  }
}
function productionCreate(_, jsx29, jsxs26) {
  return create2;
  function create2(_2, type, props, key) {
    const isStaticChildren = Array.isArray(props.children);
    const fn = isStaticChildren ? jsxs26 : jsx29;
    return key ? fn(type, props, key) : fn(type, props);
  }
}
function developmentCreate(filePath, jsxDEV) {
  return create2;
  function create2(node2, type, props, key) {
    const isStaticChildren = Array.isArray(props.children);
    const point4 = pointStart(node2);
    return jsxDEV(
      type,
      props,
      key,
      isStaticChildren,
      {
        columnNumber: point4 ? point4.column - 1 : void 0,
        fileName: filePath,
        lineNumber: point4 ? point4.line : void 0
      },
      void 0
    );
  }
}
function createElementProps(state, node2) {
  const props = {};
  let alignValue;
  let prop;
  for (prop in node2.properties) {
    if (prop !== "children" && own.call(node2.properties, prop)) {
      const result = createProperty(state, prop, node2.properties[prop]);
      if (result) {
        const [key, value] = result;
        if (state.tableCellAlignToStyle && key === "align" && typeof value === "string" && tableCellElement.has(node2.tagName)) {
          alignValue = value;
        } else {
          props[key] = value;
        }
      }
    }
  }
  if (alignValue) {
    const style = (
      /** @type {Style} */
      props.style || (props.style = {})
    );
    style[state.stylePropertyNameCase === "css" ? "text-align" : "textAlign"] = alignValue;
  }
  return props;
}
function createJsxElementProps(state, node2) {
  const props = {};
  for (const attribute of node2.attributes) {
    if (attribute.type === "mdxJsxExpressionAttribute") {
      if (attribute.data && attribute.data.estree && state.evaluater) {
        const program = attribute.data.estree;
        const expression = program.body[0];
        ok(expression.type === "ExpressionStatement");
        const objectExpression = expression.expression;
        ok(objectExpression.type === "ObjectExpression");
        const property = objectExpression.properties[0];
        ok(property.type === "SpreadElement");
        Object.assign(
          props,
          state.evaluater.evaluateExpression(property.argument)
        );
      } else {
        crashEstree(state, node2.position);
      }
    } else {
      const name2 = attribute.name;
      let value;
      if (attribute.value && typeof attribute.value === "object") {
        if (attribute.value.data && attribute.value.data.estree && state.evaluater) {
          const program = attribute.value.data.estree;
          const expression = program.body[0];
          ok(expression.type === "ExpressionStatement");
          value = state.evaluater.evaluateExpression(expression.expression);
        } else {
          crashEstree(state, node2.position);
        }
      } else {
        value = attribute.value === null ? true : attribute.value;
      }
      props[name2] = /** @type {Props[keyof Props]} */
      value;
    }
  }
  return props;
}
function createChildren(state, node2) {
  const children = [];
  let index2 = -1;
  const countsByName = state.passKeys ? /* @__PURE__ */ new Map() : emptyMap;
  while (++index2 < node2.children.length) {
    const child = node2.children[index2];
    let key;
    if (state.passKeys) {
      const name2 = child.type === "element" ? child.tagName : child.type === "mdxJsxFlowElement" || child.type === "mdxJsxTextElement" ? child.name : void 0;
      if (name2) {
        const count = countsByName.get(name2) || 0;
        key = name2 + "-" + count;
        countsByName.set(name2, count + 1);
      }
    }
    const result = one(state, child, key);
    if (result !== void 0) children.push(result);
  }
  return children;
}
function createProperty(state, prop, value) {
  const info = find(state.schema, prop);
  if (value === null || value === void 0 || typeof value === "number" && Number.isNaN(value)) {
    return;
  }
  if (Array.isArray(value)) {
    value = info.commaSeparated ? stringify(value) : stringify2(value);
  }
  if (info.property === "style") {
    let styleObject = typeof value === "object" ? value : parseStyle(state, String(value));
    if (state.stylePropertyNameCase === "css") {
      styleObject = transformStylesToCssCasing(styleObject);
    }
    return ["style", styleObject];
  }
  return [
    state.elementAttributeNameCase === "react" && info.space ? hastToReact[info.property] || info.property : info.attribute,
    value
  ];
}
function parseStyle(state, value) {
  try {
    return (0, import_style_to_js.default)(value, { reactCompat: true });
  } catch (error) {
    if (state.ignoreInvalidStyle) {
      return {};
    }
    const cause = (
      /** @type {Error} */
      error
    );
    const message = new VFileMessage("Cannot parse `style` attribute", {
      ancestors: state.ancestors,
      cause,
      ruleId: "style",
      source: "hast-util-to-jsx-runtime"
    });
    message.file = state.filePath || void 0;
    message.url = docs + "#cannot-parse-style-attribute";
    throw message;
  }
}
function findComponentFromName(state, name2, allowExpression) {
  let result;
  if (!allowExpression) {
    result = { type: "Literal", value: name2 };
  } else if (name2.includes(".")) {
    const identifiers = name2.split(".");
    let index2 = -1;
    let node2;
    while (++index2 < identifiers.length) {
      const prop = name(identifiers[index2]) ? { type: "Identifier", name: identifiers[index2] } : { type: "Literal", value: identifiers[index2] };
      node2 = node2 ? {
        type: "MemberExpression",
        object: node2,
        property: prop,
        computed: Boolean(index2 && prop.type === "Literal"),
        optional: false
      } : prop;
    }
    ok(node2, "always a result");
    result = node2;
  } else {
    result = name(name2) && !/^[a-z]/.test(name2) ? { type: "Identifier", name: name2 } : { type: "Literal", value: name2 };
  }
  if (result.type === "Literal") {
    const name3 = (
      /** @type {string | number} */
      result.value
    );
    return own.call(state.components, name3) ? state.components[name3] : name3;
  }
  if (state.evaluater) {
    return state.evaluater.evaluateExpression(result);
  }
  crashEstree(state);
}
function crashEstree(state, place) {
  const message = new VFileMessage(
    "Cannot handle MDX estrees without `createEvaluater`",
    {
      ancestors: state.ancestors,
      place,
      ruleId: "mdx-estree",
      source: "hast-util-to-jsx-runtime"
    }
  );
  message.file = state.filePath || void 0;
  message.url = docs + "#cannot-handle-mdx-estrees-without-createevaluater";
  throw message;
}
function transformStylesToCssCasing(domCasing) {
  const cssCasing = {};
  let from;
  for (from in domCasing) {
    if (own.call(domCasing, from)) {
      cssCasing[transformStyleToCssCasing(from)] = domCasing[from];
    }
  }
  return cssCasing;
}
function transformStyleToCssCasing(from) {
  let to = from.replace(cap2, toDash);
  if (to.slice(0, 3) === "ms-") to = "-" + to;
  return to;
}
function toDash($0) {
  return "-" + $0.toLowerCase();
}

// ../../node_modules/html-url-attributes/lib/index.js
var urlAttributes = {
  action: ["form"],
  cite: ["blockquote", "del", "ins", "q"],
  data: ["object"],
  formAction: ["button", "input"],
  href: ["a", "area", "base", "link"],
  icon: ["menuitem"],
  itemId: null,
  manifest: ["html"],
  ping: ["a", "area"],
  poster: ["video"],
  src: [
    "audio",
    "embed",
    "iframe",
    "img",
    "input",
    "script",
    "source",
    "track",
    "video"
  ]
};

// ../../node_modules/react-markdown/lib/index.js
var import_jsx_runtime8 = require("react/jsx-runtime");
var import_react6 = require("react");

// ../../node_modules/mdast-util-to-string/lib/index.js
var emptyOptions2 = {};
function toString(value, options) {
  const settings = options || emptyOptions2;
  const includeImageAlt = typeof settings.includeImageAlt === "boolean" ? settings.includeImageAlt : true;
  const includeHtml = typeof settings.includeHtml === "boolean" ? settings.includeHtml : true;
  return one2(value, includeImageAlt, includeHtml);
}
function one2(value, includeImageAlt, includeHtml) {
  if (node(value)) {
    if ("value" in value) {
      return value.type === "html" && !includeHtml ? "" : value.value;
    }
    if (includeImageAlt && "alt" in value && value.alt) {
      return value.alt;
    }
    if ("children" in value) {
      return all(value.children, includeImageAlt, includeHtml);
    }
  }
  if (Array.isArray(value)) {
    return all(value, includeImageAlt, includeHtml);
  }
  return "";
}
function all(values, includeImageAlt, includeHtml) {
  const result = [];
  let index2 = -1;
  while (++index2 < values.length) {
    result[index2] = one2(values[index2], includeImageAlt, includeHtml);
  }
  return result.join("");
}
function node(value) {
  return Boolean(value && typeof value === "object");
}

// ../../node_modules/decode-named-character-reference/index.dom.js
var element2 = document.createElement("i");
function decodeNamedCharacterReference(value) {
  const characterReference2 = "&" + value + ";";
  element2.innerHTML = characterReference2;
  const character = element2.textContent;
  if (character.charCodeAt(character.length - 1) === 59 && value !== "semi") {
    return false;
  }
  return character === characterReference2 ? false : character;
}

// ../../node_modules/micromark-util-chunked/index.js
function splice(list3, start2, remove, items) {
  const end = list3.length;
  let chunkStart = 0;
  let parameters;
  if (start2 < 0) {
    start2 = -start2 > end ? 0 : end + start2;
  } else {
    start2 = start2 > end ? end : start2;
  }
  remove = remove > 0 ? remove : 0;
  if (items.length < 1e4) {
    parameters = Array.from(items);
    parameters.unshift(start2, remove);
    list3.splice(...parameters);
  } else {
    if (remove) list3.splice(start2, remove);
    while (chunkStart < items.length) {
      parameters = items.slice(chunkStart, chunkStart + 1e4);
      parameters.unshift(start2, 0);
      list3.splice(...parameters);
      chunkStart += 1e4;
      start2 += 1e4;
    }
  }
}
function push(list3, items) {
  if (list3.length > 0) {
    splice(list3, list3.length, 0, items);
    return list3;
  }
  return items;
}

// ../../node_modules/micromark-util-combine-extensions/index.js
var hasOwnProperty = {}.hasOwnProperty;
function combineExtensions(extensions) {
  const all2 = {};
  let index2 = -1;
  while (++index2 < extensions.length) {
    syntaxExtension(all2, extensions[index2]);
  }
  return all2;
}
function syntaxExtension(all2, extension2) {
  let hook;
  for (hook in extension2) {
    const maybe = hasOwnProperty.call(all2, hook) ? all2[hook] : void 0;
    const left = maybe || (all2[hook] = {});
    const right = extension2[hook];
    let code2;
    if (right) {
      for (code2 in right) {
        if (!hasOwnProperty.call(left, code2)) left[code2] = [];
        const value = right[code2];
        constructs(
          // @ts-expect-error Looks like a list.
          left[code2],
          Array.isArray(value) ? value : value ? [value] : []
        );
      }
    }
  }
}
function constructs(existing, list3) {
  let index2 = -1;
  const before = [];
  while (++index2 < list3.length) {
    ;
    (list3[index2].add === "after" ? existing : before).push(list3[index2]);
  }
  splice(existing, 0, 0, before);
}

// ../../node_modules/micromark-util-decode-numeric-character-reference/index.js
function decodeNumericCharacterReference(value, base) {
  const code2 = Number.parseInt(value, base);
  if (
    // C0 except for HT, LF, FF, CR, space.
    code2 < 9 || code2 === 11 || code2 > 13 && code2 < 32 || // Control character (DEL) of C0, and C1 controls.
    code2 > 126 && code2 < 160 || // Lone high surrogates and low surrogates.
    code2 > 55295 && code2 < 57344 || // Noncharacters.
    code2 > 64975 && code2 < 65008 || /* eslint-disable no-bitwise */
    (code2 & 65535) === 65535 || (code2 & 65535) === 65534 || /* eslint-enable no-bitwise */
    // Out of range
    code2 > 1114111
  ) {
    return "\uFFFD";
  }
  return String.fromCodePoint(code2);
}

// ../../node_modules/micromark-util-normalize-identifier/index.js
function normalizeIdentifier(value) {
  return value.replace(/[\t\n\r ]+/g, " ").replace(/^ | $/g, "").toLowerCase().toUpperCase();
}

// ../../node_modules/micromark-util-character/index.js
var asciiAlpha = regexCheck(/[A-Za-z]/);
var asciiAlphanumeric = regexCheck(/[\dA-Za-z]/);
var asciiAtext = regexCheck(/[#-'*+\--9=?A-Z^-~]/);
function asciiControl(code2) {
  return (
    // Special whitespace codes (which have negative values), C0 and Control
    // character DEL
    code2 !== null && (code2 < 32 || code2 === 127)
  );
}
var asciiDigit = regexCheck(/\d/);
var asciiHexDigit = regexCheck(/[\dA-Fa-f]/);
var asciiPunctuation = regexCheck(/[!-/:-@[-`{-~]/);
function markdownLineEnding(code2) {
  return code2 !== null && code2 < -2;
}
function markdownLineEndingOrSpace(code2) {
  return code2 !== null && (code2 < 0 || code2 === 32);
}
function markdownSpace(code2) {
  return code2 === -2 || code2 === -1 || code2 === 32;
}
var unicodePunctuation = regexCheck(/\p{P}|\p{S}/u);
var unicodeWhitespace = regexCheck(/\s/);
function regexCheck(regex) {
  return check;
  function check(code2) {
    return code2 !== null && code2 > -1 && regex.test(String.fromCharCode(code2));
  }
}

// ../../node_modules/micromark-util-sanitize-uri/index.js
function normalizeUri(value) {
  const result = [];
  let index2 = -1;
  let start2 = 0;
  let skip = 0;
  while (++index2 < value.length) {
    const code2 = value.charCodeAt(index2);
    let replace = "";
    if (code2 === 37 && asciiAlphanumeric(value.charCodeAt(index2 + 1)) && asciiAlphanumeric(value.charCodeAt(index2 + 2))) {
      skip = 2;
    } else if (code2 < 128) {
      if (!/[!#$&-;=?-Z_a-z~]/.test(String.fromCharCode(code2))) {
        replace = String.fromCharCode(code2);
      }
    } else if (code2 > 55295 && code2 < 57344) {
      const next = value.charCodeAt(index2 + 1);
      if (code2 < 56320 && next > 56319 && next < 57344) {
        replace = String.fromCharCode(code2, next);
        skip = 1;
      } else {
        replace = "\uFFFD";
      }
    } else {
      replace = String.fromCharCode(code2);
    }
    if (replace) {
      result.push(value.slice(start2, index2), encodeURIComponent(replace));
      start2 = index2 + skip + 1;
      replace = "";
    }
    if (skip) {
      index2 += skip;
      skip = 0;
    }
  }
  return result.join("") + value.slice(start2);
}

// ../../node_modules/micromark-factory-space/index.js
function factorySpace(effects, ok3, type, max) {
  const limit = max ? max - 1 : Number.POSITIVE_INFINITY;
  let size = 0;
  return start2;
  function start2(code2) {
    if (markdownSpace(code2)) {
      effects.enter(type);
      return prefix(code2);
    }
    return ok3(code2);
  }
  function prefix(code2) {
    if (markdownSpace(code2) && size++ < limit) {
      effects.consume(code2);
      return prefix;
    }
    effects.exit(type);
    return ok3(code2);
  }
}

// ../../node_modules/micromark/lib/initialize/content.js
var content = {
  tokenize: initializeContent
};
function initializeContent(effects) {
  const contentStart = effects.attempt(this.parser.constructs.contentInitial, afterContentStartConstruct, paragraphInitial);
  let previous2;
  return contentStart;
  function afterContentStartConstruct(code2) {
    if (code2 === null) {
      effects.consume(code2);
      return;
    }
    effects.enter("lineEnding");
    effects.consume(code2);
    effects.exit("lineEnding");
    return factorySpace(effects, contentStart, "linePrefix");
  }
  function paragraphInitial(code2) {
    effects.enter("paragraph");
    return lineStart(code2);
  }
  function lineStart(code2) {
    const token = effects.enter("chunkText", {
      contentType: "text",
      previous: previous2
    });
    if (previous2) {
      previous2.next = token;
    }
    previous2 = token;
    return data(code2);
  }
  function data(code2) {
    if (code2 === null) {
      effects.exit("chunkText");
      effects.exit("paragraph");
      effects.consume(code2);
      return;
    }
    if (markdownLineEnding(code2)) {
      effects.consume(code2);
      effects.exit("chunkText");
      return lineStart;
    }
    effects.consume(code2);
    return data;
  }
}

// ../../node_modules/micromark/lib/initialize/document.js
var document2 = {
  tokenize: initializeDocument
};
var containerConstruct = {
  tokenize: tokenizeContainer
};
function initializeDocument(effects) {
  const self2 = this;
  const stack = [];
  let continued = 0;
  let childFlow;
  let childToken;
  let lineStartOffset;
  return start2;
  function start2(code2) {
    if (continued < stack.length) {
      const item = stack[continued];
      self2.containerState = item[1];
      return effects.attempt(item[0].continuation, documentContinue, checkNewContainers)(code2);
    }
    return checkNewContainers(code2);
  }
  function documentContinue(code2) {
    continued++;
    if (self2.containerState._closeFlow) {
      self2.containerState._closeFlow = void 0;
      if (childFlow) {
        closeFlow();
      }
      const indexBeforeExits = self2.events.length;
      let indexBeforeFlow = indexBeforeExits;
      let point4;
      while (indexBeforeFlow--) {
        if (self2.events[indexBeforeFlow][0] === "exit" && self2.events[indexBeforeFlow][1].type === "chunkFlow") {
          point4 = self2.events[indexBeforeFlow][1].end;
          break;
        }
      }
      exitContainers(continued);
      let index2 = indexBeforeExits;
      while (index2 < self2.events.length) {
        self2.events[index2][1].end = {
          ...point4
        };
        index2++;
      }
      splice(self2.events, indexBeforeFlow + 1, 0, self2.events.slice(indexBeforeExits));
      self2.events.length = index2;
      return checkNewContainers(code2);
    }
    return start2(code2);
  }
  function checkNewContainers(code2) {
    if (continued === stack.length) {
      if (!childFlow) {
        return documentContinued(code2);
      }
      if (childFlow.currentConstruct && childFlow.currentConstruct.concrete) {
        return flowStart(code2);
      }
      self2.interrupt = Boolean(childFlow.currentConstruct && !childFlow._gfmTableDynamicInterruptHack);
    }
    self2.containerState = {};
    return effects.check(containerConstruct, thereIsANewContainer, thereIsNoNewContainer)(code2);
  }
  function thereIsANewContainer(code2) {
    if (childFlow) closeFlow();
    exitContainers(continued);
    return documentContinued(code2);
  }
  function thereIsNoNewContainer(code2) {
    self2.parser.lazy[self2.now().line] = continued !== stack.length;
    lineStartOffset = self2.now().offset;
    return flowStart(code2);
  }
  function documentContinued(code2) {
    self2.containerState = {};
    return effects.attempt(containerConstruct, containerContinue, flowStart)(code2);
  }
  function containerContinue(code2) {
    continued++;
    stack.push([self2.currentConstruct, self2.containerState]);
    return documentContinued(code2);
  }
  function flowStart(code2) {
    if (code2 === null) {
      if (childFlow) closeFlow();
      exitContainers(0);
      effects.consume(code2);
      return;
    }
    childFlow = childFlow || self2.parser.flow(self2.now());
    effects.enter("chunkFlow", {
      _tokenizer: childFlow,
      contentType: "flow",
      previous: childToken
    });
    return flowContinue(code2);
  }
  function flowContinue(code2) {
    if (code2 === null) {
      writeToChild(effects.exit("chunkFlow"), true);
      exitContainers(0);
      effects.consume(code2);
      return;
    }
    if (markdownLineEnding(code2)) {
      effects.consume(code2);
      writeToChild(effects.exit("chunkFlow"));
      continued = 0;
      self2.interrupt = void 0;
      return start2;
    }
    effects.consume(code2);
    return flowContinue;
  }
  function writeToChild(token, endOfFile) {
    const stream = self2.sliceStream(token);
    if (endOfFile) stream.push(null);
    token.previous = childToken;
    if (childToken) childToken.next = token;
    childToken = token;
    childFlow.defineSkip(token.start);
    childFlow.write(stream);
    if (self2.parser.lazy[token.start.line]) {
      let index2 = childFlow.events.length;
      while (index2--) {
        if (
          // The token starts before the line ending…
          childFlow.events[index2][1].start.offset < lineStartOffset && // …and either is not ended yet…
          (!childFlow.events[index2][1].end || // …or ends after it.
          childFlow.events[index2][1].end.offset > lineStartOffset)
        ) {
          return;
        }
      }
      const indexBeforeExits = self2.events.length;
      let indexBeforeFlow = indexBeforeExits;
      let seen;
      let point4;
      while (indexBeforeFlow--) {
        if (self2.events[indexBeforeFlow][0] === "exit" && self2.events[indexBeforeFlow][1].type === "chunkFlow") {
          if (seen) {
            point4 = self2.events[indexBeforeFlow][1].end;
            break;
          }
          seen = true;
        }
      }
      exitContainers(continued);
      index2 = indexBeforeExits;
      while (index2 < self2.events.length) {
        self2.events[index2][1].end = {
          ...point4
        };
        index2++;
      }
      splice(self2.events, indexBeforeFlow + 1, 0, self2.events.slice(indexBeforeExits));
      self2.events.length = index2;
    }
  }
  function exitContainers(size) {
    let index2 = stack.length;
    while (index2-- > size) {
      const entry = stack[index2];
      self2.containerState = entry[1];
      entry[0].exit.call(self2, effects);
    }
    stack.length = size;
  }
  function closeFlow() {
    childFlow.write([null]);
    childToken = void 0;
    childFlow = void 0;
    self2.containerState._closeFlow = void 0;
  }
}
function tokenizeContainer(effects, ok3, nok) {
  return factorySpace(effects, effects.attempt(this.parser.constructs.document, ok3, nok), "linePrefix", this.parser.constructs.disable.null.includes("codeIndented") ? void 0 : 4);
}

// ../../node_modules/micromark-util-classify-character/index.js
function classifyCharacter(code2) {
  if (code2 === null || markdownLineEndingOrSpace(code2) || unicodeWhitespace(code2)) {
    return 1;
  }
  if (unicodePunctuation(code2)) {
    return 2;
  }
}

// ../../node_modules/micromark-util-resolve-all/index.js
function resolveAll(constructs2, events, context) {
  const called = [];
  let index2 = -1;
  while (++index2 < constructs2.length) {
    const resolve = constructs2[index2].resolveAll;
    if (resolve && !called.includes(resolve)) {
      events = resolve(events, context);
      called.push(resolve);
    }
  }
  return events;
}

// ../../node_modules/micromark-core-commonmark/lib/attention.js
var attention = {
  name: "attention",
  resolveAll: resolveAllAttention,
  tokenize: tokenizeAttention
};
function resolveAllAttention(events, context) {
  let index2 = -1;
  let open;
  let group;
  let text5;
  let openingSequence;
  let closingSequence;
  let use;
  let nextEvents;
  let offset;
  while (++index2 < events.length) {
    if (events[index2][0] === "enter" && events[index2][1].type === "attentionSequence" && events[index2][1]._close) {
      open = index2;
      while (open--) {
        if (events[open][0] === "exit" && events[open][1].type === "attentionSequence" && events[open][1]._open && // If the markers are the same:
        context.sliceSerialize(events[open][1]).charCodeAt(0) === context.sliceSerialize(events[index2][1]).charCodeAt(0)) {
          if ((events[open][1]._close || events[index2][1]._open) && (events[index2][1].end.offset - events[index2][1].start.offset) % 3 && !((events[open][1].end.offset - events[open][1].start.offset + events[index2][1].end.offset - events[index2][1].start.offset) % 3)) {
            continue;
          }
          use = events[open][1].end.offset - events[open][1].start.offset > 1 && events[index2][1].end.offset - events[index2][1].start.offset > 1 ? 2 : 1;
          const start2 = {
            ...events[open][1].end
          };
          const end = {
            ...events[index2][1].start
          };
          movePoint(start2, -use);
          movePoint(end, use);
          openingSequence = {
            type: use > 1 ? "strongSequence" : "emphasisSequence",
            start: start2,
            end: {
              ...events[open][1].end
            }
          };
          closingSequence = {
            type: use > 1 ? "strongSequence" : "emphasisSequence",
            start: {
              ...events[index2][1].start
            },
            end
          };
          text5 = {
            type: use > 1 ? "strongText" : "emphasisText",
            start: {
              ...events[open][1].end
            },
            end: {
              ...events[index2][1].start
            }
          };
          group = {
            type: use > 1 ? "strong" : "emphasis",
            start: {
              ...openingSequence.start
            },
            end: {
              ...closingSequence.end
            }
          };
          events[open][1].end = {
            ...openingSequence.start
          };
          events[index2][1].start = {
            ...closingSequence.end
          };
          nextEvents = [];
          if (events[open][1].end.offset - events[open][1].start.offset) {
            nextEvents = push(nextEvents, [["enter", events[open][1], context], ["exit", events[open][1], context]]);
          }
          nextEvents = push(nextEvents, [["enter", group, context], ["enter", openingSequence, context], ["exit", openingSequence, context], ["enter", text5, context]]);
          nextEvents = push(nextEvents, resolveAll(context.parser.constructs.insideSpan.null, events.slice(open + 1, index2), context));
          nextEvents = push(nextEvents, [["exit", text5, context], ["enter", closingSequence, context], ["exit", closingSequence, context], ["exit", group, context]]);
          if (events[index2][1].end.offset - events[index2][1].start.offset) {
            offset = 2;
            nextEvents = push(nextEvents, [["enter", events[index2][1], context], ["exit", events[index2][1], context]]);
          } else {
            offset = 0;
          }
          splice(events, open - 1, index2 - open + 3, nextEvents);
          index2 = open + nextEvents.length - offset - 2;
          break;
        }
      }
    }
  }
  index2 = -1;
  while (++index2 < events.length) {
    if (events[index2][1].type === "attentionSequence") {
      events[index2][1].type = "data";
    }
  }
  return events;
}
function tokenizeAttention(effects, ok3) {
  const attentionMarkers2 = this.parser.constructs.attentionMarkers.null;
  const previous2 = this.previous;
  const before = classifyCharacter(previous2);
  let marker;
  return start2;
  function start2(code2) {
    marker = code2;
    effects.enter("attentionSequence");
    return inside(code2);
  }
  function inside(code2) {
    if (code2 === marker) {
      effects.consume(code2);
      return inside;
    }
    const token = effects.exit("attentionSequence");
    const after = classifyCharacter(code2);
    const open = !after || after === 2 && before || attentionMarkers2.includes(code2);
    const close = !before || before === 2 && after || attentionMarkers2.includes(previous2);
    token._open = Boolean(marker === 42 ? open : open && (before || !close));
    token._close = Boolean(marker === 42 ? close : close && (after || !open));
    return ok3(code2);
  }
}
function movePoint(point4, offset) {
  point4.column += offset;
  point4.offset += offset;
  point4._bufferIndex += offset;
}

// ../../node_modules/micromark-core-commonmark/lib/autolink.js
var autolink = {
  name: "autolink",
  tokenize: tokenizeAutolink
};
function tokenizeAutolink(effects, ok3, nok) {
  let size = 0;
  return start2;
  function start2(code2) {
    effects.enter("autolink");
    effects.enter("autolinkMarker");
    effects.consume(code2);
    effects.exit("autolinkMarker");
    effects.enter("autolinkProtocol");
    return open;
  }
  function open(code2) {
    if (asciiAlpha(code2)) {
      effects.consume(code2);
      return schemeOrEmailAtext;
    }
    if (code2 === 64) {
      return nok(code2);
    }
    return emailAtext(code2);
  }
  function schemeOrEmailAtext(code2) {
    if (code2 === 43 || code2 === 45 || code2 === 46 || asciiAlphanumeric(code2)) {
      size = 1;
      return schemeInsideOrEmailAtext(code2);
    }
    return emailAtext(code2);
  }
  function schemeInsideOrEmailAtext(code2) {
    if (code2 === 58) {
      effects.consume(code2);
      size = 0;
      return urlInside;
    }
    if ((code2 === 43 || code2 === 45 || code2 === 46 || asciiAlphanumeric(code2)) && size++ < 32) {
      effects.consume(code2);
      return schemeInsideOrEmailAtext;
    }
    size = 0;
    return emailAtext(code2);
  }
  function urlInside(code2) {
    if (code2 === 62) {
      effects.exit("autolinkProtocol");
      effects.enter("autolinkMarker");
      effects.consume(code2);
      effects.exit("autolinkMarker");
      effects.exit("autolink");
      return ok3;
    }
    if (code2 === null || code2 === 32 || code2 === 60 || asciiControl(code2)) {
      return nok(code2);
    }
    effects.consume(code2);
    return urlInside;
  }
  function emailAtext(code2) {
    if (code2 === 64) {
      effects.consume(code2);
      return emailAtSignOrDot;
    }
    if (asciiAtext(code2)) {
      effects.consume(code2);
      return emailAtext;
    }
    return nok(code2);
  }
  function emailAtSignOrDot(code2) {
    return asciiAlphanumeric(code2) ? emailLabel(code2) : nok(code2);
  }
  function emailLabel(code2) {
    if (code2 === 46) {
      effects.consume(code2);
      size = 0;
      return emailAtSignOrDot;
    }
    if (code2 === 62) {
      effects.exit("autolinkProtocol").type = "autolinkEmail";
      effects.enter("autolinkMarker");
      effects.consume(code2);
      effects.exit("autolinkMarker");
      effects.exit("autolink");
      return ok3;
    }
    return emailValue(code2);
  }
  function emailValue(code2) {
    if ((code2 === 45 || asciiAlphanumeric(code2)) && size++ < 63) {
      const next = code2 === 45 ? emailValue : emailLabel;
      effects.consume(code2);
      return next;
    }
    return nok(code2);
  }
}

// ../../node_modules/micromark-core-commonmark/lib/blank-line.js
var blankLine = {
  partial: true,
  tokenize: tokenizeBlankLine
};
function tokenizeBlankLine(effects, ok3, nok) {
  return start2;
  function start2(code2) {
    return markdownSpace(code2) ? factorySpace(effects, after, "linePrefix")(code2) : after(code2);
  }
  function after(code2) {
    return code2 === null || markdownLineEnding(code2) ? ok3(code2) : nok(code2);
  }
}

// ../../node_modules/micromark-core-commonmark/lib/block-quote.js
var blockQuote = {
  continuation: {
    tokenize: tokenizeBlockQuoteContinuation
  },
  exit,
  name: "blockQuote",
  tokenize: tokenizeBlockQuoteStart
};
function tokenizeBlockQuoteStart(effects, ok3, nok) {
  const self2 = this;
  return start2;
  function start2(code2) {
    if (code2 === 62) {
      const state = self2.containerState;
      if (!state.open) {
        effects.enter("blockQuote", {
          _container: true
        });
        state.open = true;
      }
      effects.enter("blockQuotePrefix");
      effects.enter("blockQuoteMarker");
      effects.consume(code2);
      effects.exit("blockQuoteMarker");
      return after;
    }
    return nok(code2);
  }
  function after(code2) {
    if (markdownSpace(code2)) {
      effects.enter("blockQuotePrefixWhitespace");
      effects.consume(code2);
      effects.exit("blockQuotePrefixWhitespace");
      effects.exit("blockQuotePrefix");
      return ok3;
    }
    effects.exit("blockQuotePrefix");
    return ok3(code2);
  }
}
function tokenizeBlockQuoteContinuation(effects, ok3, nok) {
  const self2 = this;
  return contStart;
  function contStart(code2) {
    if (markdownSpace(code2)) {
      return factorySpace(effects, contBefore, "linePrefix", self2.parser.constructs.disable.null.includes("codeIndented") ? void 0 : 4)(code2);
    }
    return contBefore(code2);
  }
  function contBefore(code2) {
    return effects.attempt(blockQuote, ok3, nok)(code2);
  }
}
function exit(effects) {
  effects.exit("blockQuote");
}

// ../../node_modules/micromark-core-commonmark/lib/character-escape.js
var characterEscape = {
  name: "characterEscape",
  tokenize: tokenizeCharacterEscape
};
function tokenizeCharacterEscape(effects, ok3, nok) {
  return start2;
  function start2(code2) {
    effects.enter("characterEscape");
    effects.enter("escapeMarker");
    effects.consume(code2);
    effects.exit("escapeMarker");
    return inside;
  }
  function inside(code2) {
    if (asciiPunctuation(code2)) {
      effects.enter("characterEscapeValue");
      effects.consume(code2);
      effects.exit("characterEscapeValue");
      effects.exit("characterEscape");
      return ok3;
    }
    return nok(code2);
  }
}

// ../../node_modules/micromark-core-commonmark/lib/character-reference.js
var characterReference = {
  name: "characterReference",
  tokenize: tokenizeCharacterReference
};
function tokenizeCharacterReference(effects, ok3, nok) {
  const self2 = this;
  let size = 0;
  let max;
  let test;
  return start2;
  function start2(code2) {
    effects.enter("characterReference");
    effects.enter("characterReferenceMarker");
    effects.consume(code2);
    effects.exit("characterReferenceMarker");
    return open;
  }
  function open(code2) {
    if (code2 === 35) {
      effects.enter("characterReferenceMarkerNumeric");
      effects.consume(code2);
      effects.exit("characterReferenceMarkerNumeric");
      return numeric;
    }
    effects.enter("characterReferenceValue");
    max = 31;
    test = asciiAlphanumeric;
    return value(code2);
  }
  function numeric(code2) {
    if (code2 === 88 || code2 === 120) {
      effects.enter("characterReferenceMarkerHexadecimal");
      effects.consume(code2);
      effects.exit("characterReferenceMarkerHexadecimal");
      effects.enter("characterReferenceValue");
      max = 6;
      test = asciiHexDigit;
      return value;
    }
    effects.enter("characterReferenceValue");
    max = 7;
    test = asciiDigit;
    return value(code2);
  }
  function value(code2) {
    if (code2 === 59 && size) {
      const token = effects.exit("characterReferenceValue");
      if (test === asciiAlphanumeric && !decodeNamedCharacterReference(self2.sliceSerialize(token))) {
        return nok(code2);
      }
      effects.enter("characterReferenceMarker");
      effects.consume(code2);
      effects.exit("characterReferenceMarker");
      effects.exit("characterReference");
      return ok3;
    }
    if (test(code2) && size++ < max) {
      effects.consume(code2);
      return value;
    }
    return nok(code2);
  }
}

// ../../node_modules/micromark-core-commonmark/lib/code-fenced.js
var nonLazyContinuation = {
  partial: true,
  tokenize: tokenizeNonLazyContinuation
};
var codeFenced = {
  concrete: true,
  name: "codeFenced",
  tokenize: tokenizeCodeFenced
};
function tokenizeCodeFenced(effects, ok3, nok) {
  const self2 = this;
  const closeStart = {
    partial: true,
    tokenize: tokenizeCloseStart
  };
  let initialPrefix = 0;
  let sizeOpen = 0;
  let marker;
  return start2;
  function start2(code2) {
    return beforeSequenceOpen(code2);
  }
  function beforeSequenceOpen(code2) {
    const tail = self2.events[self2.events.length - 1];
    initialPrefix = tail && tail[1].type === "linePrefix" ? tail[2].sliceSerialize(tail[1], true).length : 0;
    marker = code2;
    effects.enter("codeFenced");
    effects.enter("codeFencedFence");
    effects.enter("codeFencedFenceSequence");
    return sequenceOpen(code2);
  }
  function sequenceOpen(code2) {
    if (code2 === marker) {
      sizeOpen++;
      effects.consume(code2);
      return sequenceOpen;
    }
    if (sizeOpen < 3) {
      return nok(code2);
    }
    effects.exit("codeFencedFenceSequence");
    return markdownSpace(code2) ? factorySpace(effects, infoBefore, "whitespace")(code2) : infoBefore(code2);
  }
  function infoBefore(code2) {
    if (code2 === null || markdownLineEnding(code2)) {
      effects.exit("codeFencedFence");
      return self2.interrupt ? ok3(code2) : effects.check(nonLazyContinuation, atNonLazyBreak, after)(code2);
    }
    effects.enter("codeFencedFenceInfo");
    effects.enter("chunkString", {
      contentType: "string"
    });
    return info(code2);
  }
  function info(code2) {
    if (code2 === null || markdownLineEnding(code2)) {
      effects.exit("chunkString");
      effects.exit("codeFencedFenceInfo");
      return infoBefore(code2);
    }
    if (markdownSpace(code2)) {
      effects.exit("chunkString");
      effects.exit("codeFencedFenceInfo");
      return factorySpace(effects, metaBefore, "whitespace")(code2);
    }
    if (code2 === 96 && code2 === marker) {
      return nok(code2);
    }
    effects.consume(code2);
    return info;
  }
  function metaBefore(code2) {
    if (code2 === null || markdownLineEnding(code2)) {
      return infoBefore(code2);
    }
    effects.enter("codeFencedFenceMeta");
    effects.enter("chunkString", {
      contentType: "string"
    });
    return meta(code2);
  }
  function meta(code2) {
    if (code2 === null || markdownLineEnding(code2)) {
      effects.exit("chunkString");
      effects.exit("codeFencedFenceMeta");
      return infoBefore(code2);
    }
    if (code2 === 96 && code2 === marker) {
      return nok(code2);
    }
    effects.consume(code2);
    return meta;
  }
  function atNonLazyBreak(code2) {
    return effects.attempt(closeStart, after, contentBefore)(code2);
  }
  function contentBefore(code2) {
    effects.enter("lineEnding");
    effects.consume(code2);
    effects.exit("lineEnding");
    return contentStart;
  }
  function contentStart(code2) {
    return initialPrefix > 0 && markdownSpace(code2) ? factorySpace(effects, beforeContentChunk, "linePrefix", initialPrefix + 1)(code2) : beforeContentChunk(code2);
  }
  function beforeContentChunk(code2) {
    if (code2 === null || markdownLineEnding(code2)) {
      return effects.check(nonLazyContinuation, atNonLazyBreak, after)(code2);
    }
    effects.enter("codeFlowValue");
    return contentChunk(code2);
  }
  function contentChunk(code2) {
    if (code2 === null || markdownLineEnding(code2)) {
      effects.exit("codeFlowValue");
      return beforeContentChunk(code2);
    }
    effects.consume(code2);
    return contentChunk;
  }
  function after(code2) {
    effects.exit("codeFenced");
    return ok3(code2);
  }
  function tokenizeCloseStart(effects2, ok4, nok2) {
    let size = 0;
    return startBefore;
    function startBefore(code2) {
      effects2.enter("lineEnding");
      effects2.consume(code2);
      effects2.exit("lineEnding");
      return start3;
    }
    function start3(code2) {
      effects2.enter("codeFencedFence");
      return markdownSpace(code2) ? factorySpace(effects2, beforeSequenceClose, "linePrefix", self2.parser.constructs.disable.null.includes("codeIndented") ? void 0 : 4)(code2) : beforeSequenceClose(code2);
    }
    function beforeSequenceClose(code2) {
      if (code2 === marker) {
        effects2.enter("codeFencedFenceSequence");
        return sequenceClose(code2);
      }
      return nok2(code2);
    }
    function sequenceClose(code2) {
      if (code2 === marker) {
        size++;
        effects2.consume(code2);
        return sequenceClose;
      }
      if (size >= sizeOpen) {
        effects2.exit("codeFencedFenceSequence");
        return markdownSpace(code2) ? factorySpace(effects2, sequenceCloseAfter, "whitespace")(code2) : sequenceCloseAfter(code2);
      }
      return nok2(code2);
    }
    function sequenceCloseAfter(code2) {
      if (code2 === null || markdownLineEnding(code2)) {
        effects2.exit("codeFencedFence");
        return ok4(code2);
      }
      return nok2(code2);
    }
  }
}
function tokenizeNonLazyContinuation(effects, ok3, nok) {
  const self2 = this;
  return start2;
  function start2(code2) {
    if (code2 === null) {
      return nok(code2);
    }
    effects.enter("lineEnding");
    effects.consume(code2);
    effects.exit("lineEnding");
    return lineStart;
  }
  function lineStart(code2) {
    return self2.parser.lazy[self2.now().line] ? nok(code2) : ok3(code2);
  }
}

// ../../node_modules/micromark-core-commonmark/lib/code-indented.js
var codeIndented = {
  name: "codeIndented",
  tokenize: tokenizeCodeIndented
};
var furtherStart = {
  partial: true,
  tokenize: tokenizeFurtherStart
};
function tokenizeCodeIndented(effects, ok3, nok) {
  const self2 = this;
  return start2;
  function start2(code2) {
    effects.enter("codeIndented");
    return factorySpace(effects, afterPrefix, "linePrefix", 4 + 1)(code2);
  }
  function afterPrefix(code2) {
    const tail = self2.events[self2.events.length - 1];
    return tail && tail[1].type === "linePrefix" && tail[2].sliceSerialize(tail[1], true).length >= 4 ? atBreak(code2) : nok(code2);
  }
  function atBreak(code2) {
    if (code2 === null) {
      return after(code2);
    }
    if (markdownLineEnding(code2)) {
      return effects.attempt(furtherStart, atBreak, after)(code2);
    }
    effects.enter("codeFlowValue");
    return inside(code2);
  }
  function inside(code2) {
    if (code2 === null || markdownLineEnding(code2)) {
      effects.exit("codeFlowValue");
      return atBreak(code2);
    }
    effects.consume(code2);
    return inside;
  }
  function after(code2) {
    effects.exit("codeIndented");
    return ok3(code2);
  }
}
function tokenizeFurtherStart(effects, ok3, nok) {
  const self2 = this;
  return furtherStart2;
  function furtherStart2(code2) {
    if (self2.parser.lazy[self2.now().line]) {
      return nok(code2);
    }
    if (markdownLineEnding(code2)) {
      effects.enter("lineEnding");
      effects.consume(code2);
      effects.exit("lineEnding");
      return furtherStart2;
    }
    return factorySpace(effects, afterPrefix, "linePrefix", 4 + 1)(code2);
  }
  function afterPrefix(code2) {
    const tail = self2.events[self2.events.length - 1];
    return tail && tail[1].type === "linePrefix" && tail[2].sliceSerialize(tail[1], true).length >= 4 ? ok3(code2) : markdownLineEnding(code2) ? furtherStart2(code2) : nok(code2);
  }
}

// ../../node_modules/micromark-core-commonmark/lib/code-text.js
var codeText = {
  name: "codeText",
  previous,
  resolve: resolveCodeText,
  tokenize: tokenizeCodeText
};
function resolveCodeText(events) {
  let tailExitIndex = events.length - 4;
  let headEnterIndex = 3;
  let index2;
  let enter;
  if ((events[headEnterIndex][1].type === "lineEnding" || events[headEnterIndex][1].type === "space") && (events[tailExitIndex][1].type === "lineEnding" || events[tailExitIndex][1].type === "space")) {
    index2 = headEnterIndex;
    while (++index2 < tailExitIndex) {
      if (events[index2][1].type === "codeTextData") {
        events[headEnterIndex][1].type = "codeTextPadding";
        events[tailExitIndex][1].type = "codeTextPadding";
        headEnterIndex += 2;
        tailExitIndex -= 2;
        break;
      }
    }
  }
  index2 = headEnterIndex - 1;
  tailExitIndex++;
  while (++index2 <= tailExitIndex) {
    if (enter === void 0) {
      if (index2 !== tailExitIndex && events[index2][1].type !== "lineEnding") {
        enter = index2;
      }
    } else if (index2 === tailExitIndex || events[index2][1].type === "lineEnding") {
      events[enter][1].type = "codeTextData";
      if (index2 !== enter + 2) {
        events[enter][1].end = events[index2 - 1][1].end;
        events.splice(enter + 2, index2 - enter - 2);
        tailExitIndex -= index2 - enter - 2;
        index2 = enter + 2;
      }
      enter = void 0;
    }
  }
  return events;
}
function previous(code2) {
  return code2 !== 96 || this.events[this.events.length - 1][1].type === "characterEscape";
}
function tokenizeCodeText(effects, ok3, nok) {
  const self2 = this;
  let sizeOpen = 0;
  let size;
  let token;
  return start2;
  function start2(code2) {
    effects.enter("codeText");
    effects.enter("codeTextSequence");
    return sequenceOpen(code2);
  }
  function sequenceOpen(code2) {
    if (code2 === 96) {
      effects.consume(code2);
      sizeOpen++;
      return sequenceOpen;
    }
    effects.exit("codeTextSequence");
    return between(code2);
  }
  function between(code2) {
    if (code2 === null) {
      return nok(code2);
    }
    if (code2 === 32) {
      effects.enter("space");
      effects.consume(code2);
      effects.exit("space");
      return between;
    }
    if (code2 === 96) {
      token = effects.enter("codeTextSequence");
      size = 0;
      return sequenceClose(code2);
    }
    if (markdownLineEnding(code2)) {
      effects.enter("lineEnding");
      effects.consume(code2);
      effects.exit("lineEnding");
      return between;
    }
    effects.enter("codeTextData");
    return data(code2);
  }
  function data(code2) {
    if (code2 === null || code2 === 32 || code2 === 96 || markdownLineEnding(code2)) {
      effects.exit("codeTextData");
      return between(code2);
    }
    effects.consume(code2);
    return data;
  }
  function sequenceClose(code2) {
    if (code2 === 96) {
      effects.consume(code2);
      size++;
      return sequenceClose;
    }
    if (size === sizeOpen) {
      effects.exit("codeTextSequence");
      effects.exit("codeText");
      return ok3(code2);
    }
    token.type = "codeTextData";
    return data(code2);
  }
}

// ../../node_modules/micromark-util-subtokenize/lib/splice-buffer.js
var SpliceBuffer = class {
  /**
   * @param {ReadonlyArray<T> | null | undefined} [initial]
   *   Initial items (optional).
   * @returns
   *   Splice buffer.
   */
  constructor(initial) {
    this.left = initial ? [...initial] : [];
    this.right = [];
  }
  /**
   * Array access;
   * does not move the cursor.
   *
   * @param {number} index
   *   Index.
   * @return {T}
   *   Item.
   */
  get(index2) {
    if (index2 < 0 || index2 >= this.left.length + this.right.length) {
      throw new RangeError("Cannot access index `" + index2 + "` in a splice buffer of size `" + (this.left.length + this.right.length) + "`");
    }
    if (index2 < this.left.length) return this.left[index2];
    return this.right[this.right.length - index2 + this.left.length - 1];
  }
  /**
   * The length of the splice buffer, one greater than the largest index in the
   * array.
   */
  get length() {
    return this.left.length + this.right.length;
  }
  /**
   * Remove and return `list[0]`;
   * moves the cursor to `0`.
   *
   * @returns {T | undefined}
   *   Item, optional.
   */
  shift() {
    this.setCursor(0);
    return this.right.pop();
  }
  /**
   * Slice the buffer to get an array;
   * does not move the cursor.
   *
   * @param {number} start
   *   Start.
   * @param {number | null | undefined} [end]
   *   End (optional).
   * @returns {Array<T>}
   *   Array of items.
   */
  slice(start2, end) {
    const stop = end === null || end === void 0 ? Number.POSITIVE_INFINITY : end;
    if (stop < this.left.length) {
      return this.left.slice(start2, stop);
    }
    if (start2 > this.left.length) {
      return this.right.slice(this.right.length - stop + this.left.length, this.right.length - start2 + this.left.length).reverse();
    }
    return this.left.slice(start2).concat(this.right.slice(this.right.length - stop + this.left.length).reverse());
  }
  /**
   * Mimics the behavior of Array.prototype.splice() except for the change of
   * interface necessary to avoid segfaults when patching in very large arrays.
   *
   * This operation moves cursor is moved to `start` and results in the cursor
   * placed after any inserted items.
   *
   * @param {number} start
   *   Start;
   *   zero-based index at which to start changing the array;
   *   negative numbers count backwards from the end of the array and values
   *   that are out-of bounds are clamped to the appropriate end of the array.
   * @param {number | null | undefined} [deleteCount=0]
   *   Delete count (default: `0`);
   *   maximum number of elements to delete, starting from start.
   * @param {Array<T> | null | undefined} [items=[]]
   *   Items to include in place of the deleted items (default: `[]`).
   * @return {Array<T>}
   *   Any removed items.
   */
  splice(start2, deleteCount, items) {
    const count = deleteCount || 0;
    this.setCursor(Math.trunc(start2));
    const removed = this.right.splice(this.right.length - count, Number.POSITIVE_INFINITY);
    if (items) chunkedPush(this.left, items);
    return removed.reverse();
  }
  /**
   * Remove and return the highest-numbered item in the array, so
   * `list[list.length - 1]`;
   * Moves the cursor to `length`.
   *
   * @returns {T | undefined}
   *   Item, optional.
   */
  pop() {
    this.setCursor(Number.POSITIVE_INFINITY);
    return this.left.pop();
  }
  /**
   * Inserts a single item to the high-numbered side of the array;
   * moves the cursor to `length`.
   *
   * @param {T} item
   *   Item.
   * @returns {undefined}
   *   Nothing.
   */
  push(item) {
    this.setCursor(Number.POSITIVE_INFINITY);
    this.left.push(item);
  }
  /**
   * Inserts many items to the high-numbered side of the array.
   * Moves the cursor to `length`.
   *
   * @param {Array<T>} items
   *   Items.
   * @returns {undefined}
   *   Nothing.
   */
  pushMany(items) {
    this.setCursor(Number.POSITIVE_INFINITY);
    chunkedPush(this.left, items);
  }
  /**
   * Inserts a single item to the low-numbered side of the array;
   * Moves the cursor to `0`.
   *
   * @param {T} item
   *   Item.
   * @returns {undefined}
   *   Nothing.
   */
  unshift(item) {
    this.setCursor(0);
    this.right.push(item);
  }
  /**
   * Inserts many items to the low-numbered side of the array;
   * moves the cursor to `0`.
   *
   * @param {Array<T>} items
   *   Items.
   * @returns {undefined}
   *   Nothing.
   */
  unshiftMany(items) {
    this.setCursor(0);
    chunkedPush(this.right, items.reverse());
  }
  /**
   * Move the cursor to a specific position in the array. Requires
   * time proportional to the distance moved.
   *
   * If `n < 0`, the cursor will end up at the beginning.
   * If `n > length`, the cursor will end up at the end.
   *
   * @param {number} n
   *   Position.
   * @return {undefined}
   *   Nothing.
   */
  setCursor(n) {
    if (n === this.left.length || n > this.left.length && this.right.length === 0 || n < 0 && this.left.length === 0) return;
    if (n < this.left.length) {
      const removed = this.left.splice(n, Number.POSITIVE_INFINITY);
      chunkedPush(this.right, removed.reverse());
    } else {
      const removed = this.right.splice(this.left.length + this.right.length - n, Number.POSITIVE_INFINITY);
      chunkedPush(this.left, removed.reverse());
    }
  }
};
function chunkedPush(list3, right) {
  let chunkStart = 0;
  if (right.length < 1e4) {
    list3.push(...right);
  } else {
    while (chunkStart < right.length) {
      list3.push(...right.slice(chunkStart, chunkStart + 1e4));
      chunkStart += 1e4;
    }
  }
}

// ../../node_modules/micromark-util-subtokenize/index.js
function subtokenize(eventsArray) {
  const jumps = {};
  let index2 = -1;
  let event;
  let lineIndex;
  let otherIndex;
  let otherEvent;
  let parameters;
  let subevents;
  let more;
  const events = new SpliceBuffer(eventsArray);
  while (++index2 < events.length) {
    while (index2 in jumps) {
      index2 = jumps[index2];
    }
    event = events.get(index2);
    if (index2 && event[1].type === "chunkFlow" && events.get(index2 - 1)[1].type === "listItemPrefix") {
      subevents = event[1]._tokenizer.events;
      otherIndex = 0;
      if (otherIndex < subevents.length && subevents[otherIndex][1].type === "lineEndingBlank") {
        otherIndex += 2;
      }
      if (otherIndex < subevents.length && subevents[otherIndex][1].type === "content") {
        while (++otherIndex < subevents.length) {
          if (subevents[otherIndex][1].type === "content") {
            break;
          }
          if (subevents[otherIndex][1].type === "chunkText") {
            subevents[otherIndex][1]._isInFirstContentOfListItem = true;
            otherIndex++;
          }
        }
      }
    }
    if (event[0] === "enter") {
      if (event[1].contentType) {
        Object.assign(jumps, subcontent(events, index2));
        index2 = jumps[index2];
        more = true;
      }
    } else if (event[1]._container) {
      otherIndex = index2;
      lineIndex = void 0;
      while (otherIndex--) {
        otherEvent = events.get(otherIndex);
        if (otherEvent[1].type === "lineEnding" || otherEvent[1].type === "lineEndingBlank") {
          if (otherEvent[0] === "enter") {
            if (lineIndex) {
              events.get(lineIndex)[1].type = "lineEndingBlank";
            }
            otherEvent[1].type = "lineEnding";
            lineIndex = otherIndex;
          }
        } else if (otherEvent[1].type === "linePrefix" || otherEvent[1].type === "listItemIndent") {
        } else {
          break;
        }
      }
      if (lineIndex) {
        event[1].end = {
          ...events.get(lineIndex)[1].start
        };
        parameters = events.slice(lineIndex, index2);
        parameters.unshift(event);
        events.splice(lineIndex, index2 - lineIndex + 1, parameters);
      }
    }
  }
  splice(eventsArray, 0, Number.POSITIVE_INFINITY, events.slice(0));
  return !more;
}
function subcontent(events, eventIndex) {
  const token = events.get(eventIndex)[1];
  const context = events.get(eventIndex)[2];
  let startPosition = eventIndex - 1;
  const startPositions = [];
  let tokenizer = token._tokenizer;
  if (!tokenizer) {
    tokenizer = context.parser[token.contentType](token.start);
    if (token._contentTypeTextTrailing) {
      tokenizer._contentTypeTextTrailing = true;
    }
  }
  const childEvents = tokenizer.events;
  const jumps = [];
  const gaps = {};
  let stream;
  let previous2;
  let index2 = -1;
  let current = token;
  let adjust = 0;
  let start2 = 0;
  const breaks = [start2];
  while (current) {
    while (events.get(++startPosition)[1] !== current) {
    }
    startPositions.push(startPosition);
    if (!current._tokenizer) {
      stream = context.sliceStream(current);
      if (!current.next) {
        stream.push(null);
      }
      if (previous2) {
        tokenizer.defineSkip(current.start);
      }
      if (current._isInFirstContentOfListItem) {
        tokenizer._gfmTasklistFirstContentOfListItem = true;
      }
      tokenizer.write(stream);
      if (current._isInFirstContentOfListItem) {
        tokenizer._gfmTasklistFirstContentOfListItem = void 0;
      }
    }
    previous2 = current;
    current = current.next;
  }
  current = token;
  while (++index2 < childEvents.length) {
    if (
      // Find a void token that includes a break.
      childEvents[index2][0] === "exit" && childEvents[index2 - 1][0] === "enter" && childEvents[index2][1].type === childEvents[index2 - 1][1].type && childEvents[index2][1].start.line !== childEvents[index2][1].end.line
    ) {
      start2 = index2 + 1;
      breaks.push(start2);
      current._tokenizer = void 0;
      current.previous = void 0;
      current = current.next;
    }
  }
  tokenizer.events = [];
  if (current) {
    current._tokenizer = void 0;
    current.previous = void 0;
  } else {
    breaks.pop();
  }
  index2 = breaks.length;
  while (index2--) {
    const slice = childEvents.slice(breaks[index2], breaks[index2 + 1]);
    const start3 = startPositions.pop();
    jumps.push([start3, start3 + slice.length - 1]);
    events.splice(start3, 2, slice);
  }
  jumps.reverse();
  index2 = -1;
  while (++index2 < jumps.length) {
    gaps[adjust + jumps[index2][0]] = adjust + jumps[index2][1];
    adjust += jumps[index2][1] - jumps[index2][0] - 1;
  }
  return gaps;
}

// ../../node_modules/micromark-core-commonmark/lib/content.js
var content2 = {
  resolve: resolveContent,
  tokenize: tokenizeContent
};
var continuationConstruct = {
  partial: true,
  tokenize: tokenizeContinuation
};
function resolveContent(events) {
  subtokenize(events);
  return events;
}
function tokenizeContent(effects, ok3) {
  let previous2;
  return chunkStart;
  function chunkStart(code2) {
    effects.enter("content");
    previous2 = effects.enter("chunkContent", {
      contentType: "content"
    });
    return chunkInside(code2);
  }
  function chunkInside(code2) {
    if (code2 === null) {
      return contentEnd(code2);
    }
    if (markdownLineEnding(code2)) {
      return effects.check(continuationConstruct, contentContinue, contentEnd)(code2);
    }
    effects.consume(code2);
    return chunkInside;
  }
  function contentEnd(code2) {
    effects.exit("chunkContent");
    effects.exit("content");
    return ok3(code2);
  }
  function contentContinue(code2) {
    effects.consume(code2);
    effects.exit("chunkContent");
    previous2.next = effects.enter("chunkContent", {
      contentType: "content",
      previous: previous2
    });
    previous2 = previous2.next;
    return chunkInside;
  }
}
function tokenizeContinuation(effects, ok3, nok) {
  const self2 = this;
  return startLookahead;
  function startLookahead(code2) {
    effects.exit("chunkContent");
    effects.enter("lineEnding");
    effects.consume(code2);
    effects.exit("lineEnding");
    return factorySpace(effects, prefixed, "linePrefix");
  }
  function prefixed(code2) {
    if (code2 === null || markdownLineEnding(code2)) {
      return nok(code2);
    }
    const tail = self2.events[self2.events.length - 1];
    if (!self2.parser.constructs.disable.null.includes("codeIndented") && tail && tail[1].type === "linePrefix" && tail[2].sliceSerialize(tail[1], true).length >= 4) {
      return ok3(code2);
    }
    return effects.interrupt(self2.parser.constructs.flow, nok, ok3)(code2);
  }
}

// ../../node_modules/micromark-factory-destination/index.js
function factoryDestination(effects, ok3, nok, type, literalType, literalMarkerType, rawType, stringType, max) {
  const limit = max || Number.POSITIVE_INFINITY;
  let balance = 0;
  return start2;
  function start2(code2) {
    if (code2 === 60) {
      effects.enter(type);
      effects.enter(literalType);
      effects.enter(literalMarkerType);
      effects.consume(code2);
      effects.exit(literalMarkerType);
      return enclosedBefore;
    }
    if (code2 === null || code2 === 32 || code2 === 41 || asciiControl(code2)) {
      return nok(code2);
    }
    effects.enter(type);
    effects.enter(rawType);
    effects.enter(stringType);
    effects.enter("chunkString", {
      contentType: "string"
    });
    return raw(code2);
  }
  function enclosedBefore(code2) {
    if (code2 === 62) {
      effects.enter(literalMarkerType);
      effects.consume(code2);
      effects.exit(literalMarkerType);
      effects.exit(literalType);
      effects.exit(type);
      return ok3;
    }
    effects.enter(stringType);
    effects.enter("chunkString", {
      contentType: "string"
    });
    return enclosed(code2);
  }
  function enclosed(code2) {
    if (code2 === 62) {
      effects.exit("chunkString");
      effects.exit(stringType);
      return enclosedBefore(code2);
    }
    if (code2 === null || code2 === 60 || markdownLineEnding(code2)) {
      return nok(code2);
    }
    effects.consume(code2);
    return code2 === 92 ? enclosedEscape : enclosed;
  }
  function enclosedEscape(code2) {
    if (code2 === 60 || code2 === 62 || code2 === 92) {
      effects.consume(code2);
      return enclosed;
    }
    return enclosed(code2);
  }
  function raw(code2) {
    if (!balance && (code2 === null || code2 === 41 || markdownLineEndingOrSpace(code2))) {
      effects.exit("chunkString");
      effects.exit(stringType);
      effects.exit(rawType);
      effects.exit(type);
      return ok3(code2);
    }
    if (balance < limit && code2 === 40) {
      effects.consume(code2);
      balance++;
      return raw;
    }
    if (code2 === 41) {
      effects.consume(code2);
      balance--;
      return raw;
    }
    if (code2 === null || code2 === 32 || code2 === 40 || asciiControl(code2)) {
      return nok(code2);
    }
    effects.consume(code2);
    return code2 === 92 ? rawEscape : raw;
  }
  function rawEscape(code2) {
    if (code2 === 40 || code2 === 41 || code2 === 92) {
      effects.consume(code2);
      return raw;
    }
    return raw(code2);
  }
}

// ../../node_modules/micromark-factory-label/index.js
function factoryLabel(effects, ok3, nok, type, markerType, stringType) {
  const self2 = this;
  let size = 0;
  let seen;
  return start2;
  function start2(code2) {
    effects.enter(type);
    effects.enter(markerType);
    effects.consume(code2);
    effects.exit(markerType);
    effects.enter(stringType);
    return atBreak;
  }
  function atBreak(code2) {
    if (size > 999 || code2 === null || code2 === 91 || code2 === 93 && !seen || // To do: remove in the future once we’ve switched from
    // `micromark-extension-footnote` to `micromark-extension-gfm-footnote`,
    // which doesn’t need this.
    // Hidden footnotes hook.
    /* c8 ignore next 3 */
    code2 === 94 && !size && "_hiddenFootnoteSupport" in self2.parser.constructs) {
      return nok(code2);
    }
    if (code2 === 93) {
      effects.exit(stringType);
      effects.enter(markerType);
      effects.consume(code2);
      effects.exit(markerType);
      effects.exit(type);
      return ok3;
    }
    if (markdownLineEnding(code2)) {
      effects.enter("lineEnding");
      effects.consume(code2);
      effects.exit("lineEnding");
      return atBreak;
    }
    effects.enter("chunkString", {
      contentType: "string"
    });
    return labelInside(code2);
  }
  function labelInside(code2) {
    if (code2 === null || code2 === 91 || code2 === 93 || markdownLineEnding(code2) || size++ > 999) {
      effects.exit("chunkString");
      return atBreak(code2);
    }
    effects.consume(code2);
    if (!seen) seen = !markdownSpace(code2);
    return code2 === 92 ? labelEscape : labelInside;
  }
  function labelEscape(code2) {
    if (code2 === 91 || code2 === 92 || code2 === 93) {
      effects.consume(code2);
      size++;
      return labelInside;
    }
    return labelInside(code2);
  }
}

// ../../node_modules/micromark-factory-title/index.js
function factoryTitle(effects, ok3, nok, type, markerType, stringType) {
  let marker;
  return start2;
  function start2(code2) {
    if (code2 === 34 || code2 === 39 || code2 === 40) {
      effects.enter(type);
      effects.enter(markerType);
      effects.consume(code2);
      effects.exit(markerType);
      marker = code2 === 40 ? 41 : code2;
      return begin;
    }
    return nok(code2);
  }
  function begin(code2) {
    if (code2 === marker) {
      effects.enter(markerType);
      effects.consume(code2);
      effects.exit(markerType);
      effects.exit(type);
      return ok3;
    }
    effects.enter(stringType);
    return atBreak(code2);
  }
  function atBreak(code2) {
    if (code2 === marker) {
      effects.exit(stringType);
      return begin(marker);
    }
    if (code2 === null) {
      return nok(code2);
    }
    if (markdownLineEnding(code2)) {
      effects.enter("lineEnding");
      effects.consume(code2);
      effects.exit("lineEnding");
      return factorySpace(effects, atBreak, "linePrefix");
    }
    effects.enter("chunkString", {
      contentType: "string"
    });
    return inside(code2);
  }
  function inside(code2) {
    if (code2 === marker || code2 === null || markdownLineEnding(code2)) {
      effects.exit("chunkString");
      return atBreak(code2);
    }
    effects.consume(code2);
    return code2 === 92 ? escape : inside;
  }
  function escape(code2) {
    if (code2 === marker || code2 === 92) {
      effects.consume(code2);
      return inside;
    }
    return inside(code2);
  }
}

// ../../node_modules/micromark-factory-whitespace/index.js
function factoryWhitespace(effects, ok3) {
  let seen;
  return start2;
  function start2(code2) {
    if (markdownLineEnding(code2)) {
      effects.enter("lineEnding");
      effects.consume(code2);
      effects.exit("lineEnding");
      seen = true;
      return start2;
    }
    if (markdownSpace(code2)) {
      return factorySpace(effects, start2, seen ? "linePrefix" : "lineSuffix")(code2);
    }
    return ok3(code2);
  }
}

// ../../node_modules/micromark-core-commonmark/lib/definition.js
var definition = {
  name: "definition",
  tokenize: tokenizeDefinition
};
var titleBefore = {
  partial: true,
  tokenize: tokenizeTitleBefore
};
function tokenizeDefinition(effects, ok3, nok) {
  const self2 = this;
  let identifier;
  return start2;
  function start2(code2) {
    effects.enter("definition");
    return before(code2);
  }
  function before(code2) {
    return factoryLabel.call(
      self2,
      effects,
      labelAfter,
      // Note: we don’t need to reset the way `markdown-rs` does.
      nok,
      "definitionLabel",
      "definitionLabelMarker",
      "definitionLabelString"
    )(code2);
  }
  function labelAfter(code2) {
    identifier = normalizeIdentifier(self2.sliceSerialize(self2.events[self2.events.length - 1][1]).slice(1, -1));
    if (code2 === 58) {
      effects.enter("definitionMarker");
      effects.consume(code2);
      effects.exit("definitionMarker");
      return markerAfter;
    }
    return nok(code2);
  }
  function markerAfter(code2) {
    return markdownLineEndingOrSpace(code2) ? factoryWhitespace(effects, destinationBefore)(code2) : destinationBefore(code2);
  }
  function destinationBefore(code2) {
    return factoryDestination(
      effects,
      destinationAfter,
      // Note: we don’t need to reset the way `markdown-rs` does.
      nok,
      "definitionDestination",
      "definitionDestinationLiteral",
      "definitionDestinationLiteralMarker",
      "definitionDestinationRaw",
      "definitionDestinationString"
    )(code2);
  }
  function destinationAfter(code2) {
    return effects.attempt(titleBefore, after, after)(code2);
  }
  function after(code2) {
    return markdownSpace(code2) ? factorySpace(effects, afterWhitespace, "whitespace")(code2) : afterWhitespace(code2);
  }
  function afterWhitespace(code2) {
    if (code2 === null || markdownLineEnding(code2)) {
      effects.exit("definition");
      self2.parser.defined.push(identifier);
      return ok3(code2);
    }
    return nok(code2);
  }
}
function tokenizeTitleBefore(effects, ok3, nok) {
  return titleBefore2;
  function titleBefore2(code2) {
    return markdownLineEndingOrSpace(code2) ? factoryWhitespace(effects, beforeMarker)(code2) : nok(code2);
  }
  function beforeMarker(code2) {
    return factoryTitle(effects, titleAfter, nok, "definitionTitle", "definitionTitleMarker", "definitionTitleString")(code2);
  }
  function titleAfter(code2) {
    return markdownSpace(code2) ? factorySpace(effects, titleAfterOptionalWhitespace, "whitespace")(code2) : titleAfterOptionalWhitespace(code2);
  }
  function titleAfterOptionalWhitespace(code2) {
    return code2 === null || markdownLineEnding(code2) ? ok3(code2) : nok(code2);
  }
}

// ../../node_modules/micromark-core-commonmark/lib/hard-break-escape.js
var hardBreakEscape = {
  name: "hardBreakEscape",
  tokenize: tokenizeHardBreakEscape
};
function tokenizeHardBreakEscape(effects, ok3, nok) {
  return start2;
  function start2(code2) {
    effects.enter("hardBreakEscape");
    effects.consume(code2);
    return after;
  }
  function after(code2) {
    if (markdownLineEnding(code2)) {
      effects.exit("hardBreakEscape");
      return ok3(code2);
    }
    return nok(code2);
  }
}

// ../../node_modules/micromark-core-commonmark/lib/heading-atx.js
var headingAtx = {
  name: "headingAtx",
  resolve: resolveHeadingAtx,
  tokenize: tokenizeHeadingAtx
};
function resolveHeadingAtx(events, context) {
  let contentEnd = events.length - 2;
  let contentStart = 3;
  let content3;
  let text5;
  if (events[contentStart][1].type === "whitespace") {
    contentStart += 2;
  }
  if (contentEnd - 2 > contentStart && events[contentEnd][1].type === "whitespace") {
    contentEnd -= 2;
  }
  if (events[contentEnd][1].type === "atxHeadingSequence" && (contentStart === contentEnd - 1 || contentEnd - 4 > contentStart && events[contentEnd - 2][1].type === "whitespace")) {
    contentEnd -= contentStart + 1 === contentEnd ? 2 : 4;
  }
  if (contentEnd > contentStart) {
    content3 = {
      type: "atxHeadingText",
      start: events[contentStart][1].start,
      end: events[contentEnd][1].end
    };
    text5 = {
      type: "chunkText",
      start: events[contentStart][1].start,
      end: events[contentEnd][1].end,
      contentType: "text"
    };
    splice(events, contentStart, contentEnd - contentStart + 1, [["enter", content3, context], ["enter", text5, context], ["exit", text5, context], ["exit", content3, context]]);
  }
  return events;
}
function tokenizeHeadingAtx(effects, ok3, nok) {
  let size = 0;
  return start2;
  function start2(code2) {
    effects.enter("atxHeading");
    return before(code2);
  }
  function before(code2) {
    effects.enter("atxHeadingSequence");
    return sequenceOpen(code2);
  }
  function sequenceOpen(code2) {
    if (code2 === 35 && size++ < 6) {
      effects.consume(code2);
      return sequenceOpen;
    }
    if (code2 === null || markdownLineEndingOrSpace(code2)) {
      effects.exit("atxHeadingSequence");
      return atBreak(code2);
    }
    return nok(code2);
  }
  function atBreak(code2) {
    if (code2 === 35) {
      effects.enter("atxHeadingSequence");
      return sequenceFurther(code2);
    }
    if (code2 === null || markdownLineEnding(code2)) {
      effects.exit("atxHeading");
      return ok3(code2);
    }
    if (markdownSpace(code2)) {
      return factorySpace(effects, atBreak, "whitespace")(code2);
    }
    effects.enter("atxHeadingText");
    return data(code2);
  }
  function sequenceFurther(code2) {
    if (code2 === 35) {
      effects.consume(code2);
      return sequenceFurther;
    }
    effects.exit("atxHeadingSequence");
    return atBreak(code2);
  }
  function data(code2) {
    if (code2 === null || code2 === 35 || markdownLineEndingOrSpace(code2)) {
      effects.exit("atxHeadingText");
      return atBreak(code2);
    }
    effects.consume(code2);
    return data;
  }
}

// ../../node_modules/micromark-util-html-tag-name/index.js
var htmlBlockNames = [
  "address",
  "article",
  "aside",
  "base",
  "basefont",
  "blockquote",
  "body",
  "caption",
  "center",
  "col",
  "colgroup",
  "dd",
  "details",
  "dialog",
  "dir",
  "div",
  "dl",
  "dt",
  "fieldset",
  "figcaption",
  "figure",
  "footer",
  "form",
  "frame",
  "frameset",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "head",
  "header",
  "hr",
  "html",
  "iframe",
  "legend",
  "li",
  "link",
  "main",
  "menu",
  "menuitem",
  "nav",
  "noframes",
  "ol",
  "optgroup",
  "option",
  "p",
  "param",
  "search",
  "section",
  "summary",
  "table",
  "tbody",
  "td",
  "tfoot",
  "th",
  "thead",
  "title",
  "tr",
  "track",
  "ul"
];
var htmlRawNames = ["pre", "script", "style", "textarea"];

// ../../node_modules/micromark-core-commonmark/lib/html-flow.js
var htmlFlow = {
  concrete: true,
  name: "htmlFlow",
  resolveTo: resolveToHtmlFlow,
  tokenize: tokenizeHtmlFlow
};
var blankLineBefore = {
  partial: true,
  tokenize: tokenizeBlankLineBefore
};
var nonLazyContinuationStart = {
  partial: true,
  tokenize: tokenizeNonLazyContinuationStart
};
function resolveToHtmlFlow(events) {
  let index2 = events.length;
  while (index2--) {
    if (events[index2][0] === "enter" && events[index2][1].type === "htmlFlow") {
      break;
    }
  }
  if (index2 > 1 && events[index2 - 2][1].type === "linePrefix") {
    events[index2][1].start = events[index2 - 2][1].start;
    events[index2 + 1][1].start = events[index2 - 2][1].start;
    events.splice(index2 - 2, 2);
  }
  return events;
}
function tokenizeHtmlFlow(effects, ok3, nok) {
  const self2 = this;
  let marker;
  let closingTag;
  let buffer;
  let index2;
  let markerB;
  return start2;
  function start2(code2) {
    return before(code2);
  }
  function before(code2) {
    effects.enter("htmlFlow");
    effects.enter("htmlFlowData");
    effects.consume(code2);
    return open;
  }
  function open(code2) {
    if (code2 === 33) {
      effects.consume(code2);
      return declarationOpen;
    }
    if (code2 === 47) {
      effects.consume(code2);
      closingTag = true;
      return tagCloseStart;
    }
    if (code2 === 63) {
      effects.consume(code2);
      marker = 3;
      return self2.interrupt ? ok3 : continuationDeclarationInside;
    }
    if (asciiAlpha(code2)) {
      effects.consume(code2);
      buffer = String.fromCharCode(code2);
      return tagName;
    }
    return nok(code2);
  }
  function declarationOpen(code2) {
    if (code2 === 45) {
      effects.consume(code2);
      marker = 2;
      return commentOpenInside;
    }
    if (code2 === 91) {
      effects.consume(code2);
      marker = 5;
      index2 = 0;
      return cdataOpenInside;
    }
    if (asciiAlpha(code2)) {
      effects.consume(code2);
      marker = 4;
      return self2.interrupt ? ok3 : continuationDeclarationInside;
    }
    return nok(code2);
  }
  function commentOpenInside(code2) {
    if (code2 === 45) {
      effects.consume(code2);
      return self2.interrupt ? ok3 : continuationDeclarationInside;
    }
    return nok(code2);
  }
  function cdataOpenInside(code2) {
    const value = "CDATA[";
    if (code2 === value.charCodeAt(index2++)) {
      effects.consume(code2);
      if (index2 === value.length) {
        return self2.interrupt ? ok3 : continuation;
      }
      return cdataOpenInside;
    }
    return nok(code2);
  }
  function tagCloseStart(code2) {
    if (asciiAlpha(code2)) {
      effects.consume(code2);
      buffer = String.fromCharCode(code2);
      return tagName;
    }
    return nok(code2);
  }
  function tagName(code2) {
    if (code2 === null || code2 === 47 || code2 === 62 || markdownLineEndingOrSpace(code2)) {
      const slash = code2 === 47;
      const name2 = buffer.toLowerCase();
      if (!slash && !closingTag && htmlRawNames.includes(name2)) {
        marker = 1;
        return self2.interrupt ? ok3(code2) : continuation(code2);
      }
      if (htmlBlockNames.includes(buffer.toLowerCase())) {
        marker = 6;
        if (slash) {
          effects.consume(code2);
          return basicSelfClosing;
        }
        return self2.interrupt ? ok3(code2) : continuation(code2);
      }
      marker = 7;
      return self2.interrupt && !self2.parser.lazy[self2.now().line] ? nok(code2) : closingTag ? completeClosingTagAfter(code2) : completeAttributeNameBefore(code2);
    }
    if (code2 === 45 || asciiAlphanumeric(code2)) {
      effects.consume(code2);
      buffer += String.fromCharCode(code2);
      return tagName;
    }
    return nok(code2);
  }
  function basicSelfClosing(code2) {
    if (code2 === 62) {
      effects.consume(code2);
      return self2.interrupt ? ok3 : continuation;
    }
    return nok(code2);
  }
  function completeClosingTagAfter(code2) {
    if (markdownSpace(code2)) {
      effects.consume(code2);
      return completeClosingTagAfter;
    }
    return completeEnd(code2);
  }
  function completeAttributeNameBefore(code2) {
    if (code2 === 47) {
      effects.consume(code2);
      return completeEnd;
    }
    if (code2 === 58 || code2 === 95 || asciiAlpha(code2)) {
      effects.consume(code2);
      return completeAttributeName;
    }
    if (markdownSpace(code2)) {
      effects.consume(code2);
      return completeAttributeNameBefore;
    }
    return completeEnd(code2);
  }
  function completeAttributeName(code2) {
    if (code2 === 45 || code2 === 46 || code2 === 58 || code2 === 95 || asciiAlphanumeric(code2)) {
      effects.consume(code2);
      return completeAttributeName;
    }
    return completeAttributeNameAfter(code2);
  }
  function completeAttributeNameAfter(code2) {
    if (code2 === 61) {
      effects.consume(code2);
      return completeAttributeValueBefore;
    }
    if (markdownSpace(code2)) {
      effects.consume(code2);
      return completeAttributeNameAfter;
    }
    return completeAttributeNameBefore(code2);
  }
  function completeAttributeValueBefore(code2) {
    if (code2 === null || code2 === 60 || code2 === 61 || code2 === 62 || code2 === 96) {
      return nok(code2);
    }
    if (code2 === 34 || code2 === 39) {
      effects.consume(code2);
      markerB = code2;
      return completeAttributeValueQuoted;
    }
    if (markdownSpace(code2)) {
      effects.consume(code2);
      return completeAttributeValueBefore;
    }
    return completeAttributeValueUnquoted(code2);
  }
  function completeAttributeValueQuoted(code2) {
    if (code2 === markerB) {
      effects.consume(code2);
      markerB = null;
      return completeAttributeValueQuotedAfter;
    }
    if (code2 === null || markdownLineEnding(code2)) {
      return nok(code2);
    }
    effects.consume(code2);
    return completeAttributeValueQuoted;
  }
  function completeAttributeValueUnquoted(code2) {
    if (code2 === null || code2 === 34 || code2 === 39 || code2 === 47 || code2 === 60 || code2 === 61 || code2 === 62 || code2 === 96 || markdownLineEndingOrSpace(code2)) {
      return completeAttributeNameAfter(code2);
    }
    effects.consume(code2);
    return completeAttributeValueUnquoted;
  }
  function completeAttributeValueQuotedAfter(code2) {
    if (code2 === 47 || code2 === 62 || markdownSpace(code2)) {
      return completeAttributeNameBefore(code2);
    }
    return nok(code2);
  }
  function completeEnd(code2) {
    if (code2 === 62) {
      effects.consume(code2);
      return completeAfter;
    }
    return nok(code2);
  }
  function completeAfter(code2) {
    if (code2 === null || markdownLineEnding(code2)) {
      return continuation(code2);
    }
    if (markdownSpace(code2)) {
      effects.consume(code2);
      return completeAfter;
    }
    return nok(code2);
  }
  function continuation(code2) {
    if (code2 === 45 && marker === 2) {
      effects.consume(code2);
      return continuationCommentInside;
    }
    if (code2 === 60 && marker === 1) {
      effects.consume(code2);
      return continuationRawTagOpen;
    }
    if (code2 === 62 && marker === 4) {
      effects.consume(code2);
      return continuationClose;
    }
    if (code2 === 63 && marker === 3) {
      effects.consume(code2);
      return continuationDeclarationInside;
    }
    if (code2 === 93 && marker === 5) {
      effects.consume(code2);
      return continuationCdataInside;
    }
    if (markdownLineEnding(code2) && (marker === 6 || marker === 7)) {
      effects.exit("htmlFlowData");
      return effects.check(blankLineBefore, continuationAfter, continuationStart)(code2);
    }
    if (code2 === null || markdownLineEnding(code2)) {
      effects.exit("htmlFlowData");
      return continuationStart(code2);
    }
    effects.consume(code2);
    return continuation;
  }
  function continuationStart(code2) {
    return effects.check(nonLazyContinuationStart, continuationStartNonLazy, continuationAfter)(code2);
  }
  function continuationStartNonLazy(code2) {
    effects.enter("lineEnding");
    effects.consume(code2);
    effects.exit("lineEnding");
    return continuationBefore;
  }
  function continuationBefore(code2) {
    if (code2 === null || markdownLineEnding(code2)) {
      return continuationStart(code2);
    }
    effects.enter("htmlFlowData");
    return continuation(code2);
  }
  function continuationCommentInside(code2) {
    if (code2 === 45) {
      effects.consume(code2);
      return continuationDeclarationInside;
    }
    return continuation(code2);
  }
  function continuationRawTagOpen(code2) {
    if (code2 === 47) {
      effects.consume(code2);
      buffer = "";
      return continuationRawEndTag;
    }
    return continuation(code2);
  }
  function continuationRawEndTag(code2) {
    if (code2 === 62) {
      const name2 = buffer.toLowerCase();
      if (htmlRawNames.includes(name2)) {
        effects.consume(code2);
        return continuationClose;
      }
      return continuation(code2);
    }
    if (asciiAlpha(code2) && buffer.length < 8) {
      effects.consume(code2);
      buffer += String.fromCharCode(code2);
      return continuationRawEndTag;
    }
    return continuation(code2);
  }
  function continuationCdataInside(code2) {
    if (code2 === 93) {
      effects.consume(code2);
      return continuationDeclarationInside;
    }
    return continuation(code2);
  }
  function continuationDeclarationInside(code2) {
    if (code2 === 62) {
      effects.consume(code2);
      return continuationClose;
    }
    if (code2 === 45 && marker === 2) {
      effects.consume(code2);
      return continuationDeclarationInside;
    }
    return continuation(code2);
  }
  function continuationClose(code2) {
    if (code2 === null || markdownLineEnding(code2)) {
      effects.exit("htmlFlowData");
      return continuationAfter(code2);
    }
    effects.consume(code2);
    return continuationClose;
  }
  function continuationAfter(code2) {
    effects.exit("htmlFlow");
    return ok3(code2);
  }
}
function tokenizeNonLazyContinuationStart(effects, ok3, nok) {
  const self2 = this;
  return start2;
  function start2(code2) {
    if (markdownLineEnding(code2)) {
      effects.enter("lineEnding");
      effects.consume(code2);
      effects.exit("lineEnding");
      return after;
    }
    return nok(code2);
  }
  function after(code2) {
    return self2.parser.lazy[self2.now().line] ? nok(code2) : ok3(code2);
  }
}
function tokenizeBlankLineBefore(effects, ok3, nok) {
  return start2;
  function start2(code2) {
    effects.enter("lineEnding");
    effects.consume(code2);
    effects.exit("lineEnding");
    return effects.attempt(blankLine, ok3, nok);
  }
}

// ../../node_modules/micromark-core-commonmark/lib/html-text.js
var htmlText = {
  name: "htmlText",
  tokenize: tokenizeHtmlText
};
function tokenizeHtmlText(effects, ok3, nok) {
  const self2 = this;
  let marker;
  let index2;
  let returnState;
  return start2;
  function start2(code2) {
    effects.enter("htmlText");
    effects.enter("htmlTextData");
    effects.consume(code2);
    return open;
  }
  function open(code2) {
    if (code2 === 33) {
      effects.consume(code2);
      return declarationOpen;
    }
    if (code2 === 47) {
      effects.consume(code2);
      return tagCloseStart;
    }
    if (code2 === 63) {
      effects.consume(code2);
      return instruction;
    }
    if (asciiAlpha(code2)) {
      effects.consume(code2);
      return tagOpen;
    }
    return nok(code2);
  }
  function declarationOpen(code2) {
    if (code2 === 45) {
      effects.consume(code2);
      return commentOpenInside;
    }
    if (code2 === 91) {
      effects.consume(code2);
      index2 = 0;
      return cdataOpenInside;
    }
    if (asciiAlpha(code2)) {
      effects.consume(code2);
      return declaration;
    }
    return nok(code2);
  }
  function commentOpenInside(code2) {
    if (code2 === 45) {
      effects.consume(code2);
      return commentEnd;
    }
    return nok(code2);
  }
  function comment(code2) {
    if (code2 === null) {
      return nok(code2);
    }
    if (code2 === 45) {
      effects.consume(code2);
      return commentClose;
    }
    if (markdownLineEnding(code2)) {
      returnState = comment;
      return lineEndingBefore(code2);
    }
    effects.consume(code2);
    return comment;
  }
  function commentClose(code2) {
    if (code2 === 45) {
      effects.consume(code2);
      return commentEnd;
    }
    return comment(code2);
  }
  function commentEnd(code2) {
    return code2 === 62 ? end(code2) : code2 === 45 ? commentClose(code2) : comment(code2);
  }
  function cdataOpenInside(code2) {
    const value = "CDATA[";
    if (code2 === value.charCodeAt(index2++)) {
      effects.consume(code2);
      return index2 === value.length ? cdata : cdataOpenInside;
    }
    return nok(code2);
  }
  function cdata(code2) {
    if (code2 === null) {
      return nok(code2);
    }
    if (code2 === 93) {
      effects.consume(code2);
      return cdataClose;
    }
    if (markdownLineEnding(code2)) {
      returnState = cdata;
      return lineEndingBefore(code2);
    }
    effects.consume(code2);
    return cdata;
  }
  function cdataClose(code2) {
    if (code2 === 93) {
      effects.consume(code2);
      return cdataEnd;
    }
    return cdata(code2);
  }
  function cdataEnd(code2) {
    if (code2 === 62) {
      return end(code2);
    }
    if (code2 === 93) {
      effects.consume(code2);
      return cdataEnd;
    }
    return cdata(code2);
  }
  function declaration(code2) {
    if (code2 === null || code2 === 62) {
      return end(code2);
    }
    if (markdownLineEnding(code2)) {
      returnState = declaration;
      return lineEndingBefore(code2);
    }
    effects.consume(code2);
    return declaration;
  }
  function instruction(code2) {
    if (code2 === null) {
      return nok(code2);
    }
    if (code2 === 63) {
      effects.consume(code2);
      return instructionClose;
    }
    if (markdownLineEnding(code2)) {
      returnState = instruction;
      return lineEndingBefore(code2);
    }
    effects.consume(code2);
    return instruction;
  }
  function instructionClose(code2) {
    return code2 === 62 ? end(code2) : instruction(code2);
  }
  function tagCloseStart(code2) {
    if (asciiAlpha(code2)) {
      effects.consume(code2);
      return tagClose;
    }
    return nok(code2);
  }
  function tagClose(code2) {
    if (code2 === 45 || asciiAlphanumeric(code2)) {
      effects.consume(code2);
      return tagClose;
    }
    return tagCloseBetween(code2);
  }
  function tagCloseBetween(code2) {
    if (markdownLineEnding(code2)) {
      returnState = tagCloseBetween;
      return lineEndingBefore(code2);
    }
    if (markdownSpace(code2)) {
      effects.consume(code2);
      return tagCloseBetween;
    }
    return end(code2);
  }
  function tagOpen(code2) {
    if (code2 === 45 || asciiAlphanumeric(code2)) {
      effects.consume(code2);
      return tagOpen;
    }
    if (code2 === 47 || code2 === 62 || markdownLineEndingOrSpace(code2)) {
      return tagOpenBetween(code2);
    }
    return nok(code2);
  }
  function tagOpenBetween(code2) {
    if (code2 === 47) {
      effects.consume(code2);
      return end;
    }
    if (code2 === 58 || code2 === 95 || asciiAlpha(code2)) {
      effects.consume(code2);
      return tagOpenAttributeName;
    }
    if (markdownLineEnding(code2)) {
      returnState = tagOpenBetween;
      return lineEndingBefore(code2);
    }
    if (markdownSpace(code2)) {
      effects.consume(code2);
      return tagOpenBetween;
    }
    return end(code2);
  }
  function tagOpenAttributeName(code2) {
    if (code2 === 45 || code2 === 46 || code2 === 58 || code2 === 95 || asciiAlphanumeric(code2)) {
      effects.consume(code2);
      return tagOpenAttributeName;
    }
    return tagOpenAttributeNameAfter(code2);
  }
  function tagOpenAttributeNameAfter(code2) {
    if (code2 === 61) {
      effects.consume(code2);
      return tagOpenAttributeValueBefore;
    }
    if (markdownLineEnding(code2)) {
      returnState = tagOpenAttributeNameAfter;
      return lineEndingBefore(code2);
    }
    if (markdownSpace(code2)) {
      effects.consume(code2);
      return tagOpenAttributeNameAfter;
    }
    return tagOpenBetween(code2);
  }
  function tagOpenAttributeValueBefore(code2) {
    if (code2 === null || code2 === 60 || code2 === 61 || code2 === 62 || code2 === 96) {
      return nok(code2);
    }
    if (code2 === 34 || code2 === 39) {
      effects.consume(code2);
      marker = code2;
      return tagOpenAttributeValueQuoted;
    }
    if (markdownLineEnding(code2)) {
      returnState = tagOpenAttributeValueBefore;
      return lineEndingBefore(code2);
    }
    if (markdownSpace(code2)) {
      effects.consume(code2);
      return tagOpenAttributeValueBefore;
    }
    effects.consume(code2);
    return tagOpenAttributeValueUnquoted;
  }
  function tagOpenAttributeValueQuoted(code2) {
    if (code2 === marker) {
      effects.consume(code2);
      marker = void 0;
      return tagOpenAttributeValueQuotedAfter;
    }
    if (code2 === null) {
      return nok(code2);
    }
    if (markdownLineEnding(code2)) {
      returnState = tagOpenAttributeValueQuoted;
      return lineEndingBefore(code2);
    }
    effects.consume(code2);
    return tagOpenAttributeValueQuoted;
  }
  function tagOpenAttributeValueUnquoted(code2) {
    if (code2 === null || code2 === 34 || code2 === 39 || code2 === 60 || code2 === 61 || code2 === 96) {
      return nok(code2);
    }
    if (code2 === 47 || code2 === 62 || markdownLineEndingOrSpace(code2)) {
      return tagOpenBetween(code2);
    }
    effects.consume(code2);
    return tagOpenAttributeValueUnquoted;
  }
  function tagOpenAttributeValueQuotedAfter(code2) {
    if (code2 === 47 || code2 === 62 || markdownLineEndingOrSpace(code2)) {
      return tagOpenBetween(code2);
    }
    return nok(code2);
  }
  function end(code2) {
    if (code2 === 62) {
      effects.consume(code2);
      effects.exit("htmlTextData");
      effects.exit("htmlText");
      return ok3;
    }
    return nok(code2);
  }
  function lineEndingBefore(code2) {
    effects.exit("htmlTextData");
    effects.enter("lineEnding");
    effects.consume(code2);
    effects.exit("lineEnding");
    return lineEndingAfter;
  }
  function lineEndingAfter(code2) {
    return markdownSpace(code2) ? factorySpace(effects, lineEndingAfterPrefix, "linePrefix", self2.parser.constructs.disable.null.includes("codeIndented") ? void 0 : 4)(code2) : lineEndingAfterPrefix(code2);
  }
  function lineEndingAfterPrefix(code2) {
    effects.enter("htmlTextData");
    return returnState(code2);
  }
}

// ../../node_modules/micromark-core-commonmark/lib/label-end.js
var labelEnd = {
  name: "labelEnd",
  resolveAll: resolveAllLabelEnd,
  resolveTo: resolveToLabelEnd,
  tokenize: tokenizeLabelEnd
};
var resourceConstruct = {
  tokenize: tokenizeResource
};
var referenceFullConstruct = {
  tokenize: tokenizeReferenceFull
};
var referenceCollapsedConstruct = {
  tokenize: tokenizeReferenceCollapsed
};
function resolveAllLabelEnd(events) {
  let index2 = -1;
  const newEvents = [];
  while (++index2 < events.length) {
    const token = events[index2][1];
    newEvents.push(events[index2]);
    if (token.type === "labelImage" || token.type === "labelLink" || token.type === "labelEnd") {
      const offset = token.type === "labelImage" ? 4 : 2;
      token.type = "data";
      index2 += offset;
    }
  }
  if (events.length !== newEvents.length) {
    splice(events, 0, events.length, newEvents);
  }
  return events;
}
function resolveToLabelEnd(events, context) {
  let index2 = events.length;
  let offset = 0;
  let token;
  let open;
  let close;
  let media;
  while (index2--) {
    token = events[index2][1];
    if (open) {
      if (token.type === "link" || token.type === "labelLink" && token._inactive) {
        break;
      }
      if (events[index2][0] === "enter" && token.type === "labelLink") {
        token._inactive = true;
      }
    } else if (close) {
      if (events[index2][0] === "enter" && (token.type === "labelImage" || token.type === "labelLink") && !token._balanced) {
        open = index2;
        if (token.type !== "labelLink") {
          offset = 2;
          break;
        }
      }
    } else if (token.type === "labelEnd") {
      close = index2;
    }
  }
  const group = {
    type: events[open][1].type === "labelLink" ? "link" : "image",
    start: {
      ...events[open][1].start
    },
    end: {
      ...events[events.length - 1][1].end
    }
  };
  const label = {
    type: "label",
    start: {
      ...events[open][1].start
    },
    end: {
      ...events[close][1].end
    }
  };
  const text5 = {
    type: "labelText",
    start: {
      ...events[open + offset + 2][1].end
    },
    end: {
      ...events[close - 2][1].start
    }
  };
  media = [["enter", group, context], ["enter", label, context]];
  media = push(media, events.slice(open + 1, open + offset + 3));
  media = push(media, [["enter", text5, context]]);
  media = push(media, resolveAll(context.parser.constructs.insideSpan.null, events.slice(open + offset + 4, close - 3), context));
  media = push(media, [["exit", text5, context], events[close - 2], events[close - 1], ["exit", label, context]]);
  media = push(media, events.slice(close + 1));
  media = push(media, [["exit", group, context]]);
  splice(events, open, events.length, media);
  return events;
}
function tokenizeLabelEnd(effects, ok3, nok) {
  const self2 = this;
  let index2 = self2.events.length;
  let labelStart;
  let defined;
  while (index2--) {
    if ((self2.events[index2][1].type === "labelImage" || self2.events[index2][1].type === "labelLink") && !self2.events[index2][1]._balanced) {
      labelStart = self2.events[index2][1];
      break;
    }
  }
  return start2;
  function start2(code2) {
    if (!labelStart) {
      return nok(code2);
    }
    if (labelStart._inactive) {
      return labelEndNok(code2);
    }
    defined = self2.parser.defined.includes(normalizeIdentifier(self2.sliceSerialize({
      start: labelStart.end,
      end: self2.now()
    })));
    effects.enter("labelEnd");
    effects.enter("labelMarker");
    effects.consume(code2);
    effects.exit("labelMarker");
    effects.exit("labelEnd");
    return after;
  }
  function after(code2) {
    if (code2 === 40) {
      return effects.attempt(resourceConstruct, labelEndOk, defined ? labelEndOk : labelEndNok)(code2);
    }
    if (code2 === 91) {
      return effects.attempt(referenceFullConstruct, labelEndOk, defined ? referenceNotFull : labelEndNok)(code2);
    }
    return defined ? labelEndOk(code2) : labelEndNok(code2);
  }
  function referenceNotFull(code2) {
    return effects.attempt(referenceCollapsedConstruct, labelEndOk, labelEndNok)(code2);
  }
  function labelEndOk(code2) {
    return ok3(code2);
  }
  function labelEndNok(code2) {
    labelStart._balanced = true;
    return nok(code2);
  }
}
function tokenizeResource(effects, ok3, nok) {
  return resourceStart;
  function resourceStart(code2) {
    effects.enter("resource");
    effects.enter("resourceMarker");
    effects.consume(code2);
    effects.exit("resourceMarker");
    return resourceBefore;
  }
  function resourceBefore(code2) {
    return markdownLineEndingOrSpace(code2) ? factoryWhitespace(effects, resourceOpen)(code2) : resourceOpen(code2);
  }
  function resourceOpen(code2) {
    if (code2 === 41) {
      return resourceEnd(code2);
    }
    return factoryDestination(effects, resourceDestinationAfter, resourceDestinationMissing, "resourceDestination", "resourceDestinationLiteral", "resourceDestinationLiteralMarker", "resourceDestinationRaw", "resourceDestinationString", 32)(code2);
  }
  function resourceDestinationAfter(code2) {
    return markdownLineEndingOrSpace(code2) ? factoryWhitespace(effects, resourceBetween)(code2) : resourceEnd(code2);
  }
  function resourceDestinationMissing(code2) {
    return nok(code2);
  }
  function resourceBetween(code2) {
    if (code2 === 34 || code2 === 39 || code2 === 40) {
      return factoryTitle(effects, resourceTitleAfter, nok, "resourceTitle", "resourceTitleMarker", "resourceTitleString")(code2);
    }
    return resourceEnd(code2);
  }
  function resourceTitleAfter(code2) {
    return markdownLineEndingOrSpace(code2) ? factoryWhitespace(effects, resourceEnd)(code2) : resourceEnd(code2);
  }
  function resourceEnd(code2) {
    if (code2 === 41) {
      effects.enter("resourceMarker");
      effects.consume(code2);
      effects.exit("resourceMarker");
      effects.exit("resource");
      return ok3;
    }
    return nok(code2);
  }
}
function tokenizeReferenceFull(effects, ok3, nok) {
  const self2 = this;
  return referenceFull;
  function referenceFull(code2) {
    return factoryLabel.call(self2, effects, referenceFullAfter, referenceFullMissing, "reference", "referenceMarker", "referenceString")(code2);
  }
  function referenceFullAfter(code2) {
    return self2.parser.defined.includes(normalizeIdentifier(self2.sliceSerialize(self2.events[self2.events.length - 1][1]).slice(1, -1))) ? ok3(code2) : nok(code2);
  }
  function referenceFullMissing(code2) {
    return nok(code2);
  }
}
function tokenizeReferenceCollapsed(effects, ok3, nok) {
  return referenceCollapsedStart;
  function referenceCollapsedStart(code2) {
    effects.enter("reference");
    effects.enter("referenceMarker");
    effects.consume(code2);
    effects.exit("referenceMarker");
    return referenceCollapsedOpen;
  }
  function referenceCollapsedOpen(code2) {
    if (code2 === 93) {
      effects.enter("referenceMarker");
      effects.consume(code2);
      effects.exit("referenceMarker");
      effects.exit("reference");
      return ok3;
    }
    return nok(code2);
  }
}

// ../../node_modules/micromark-core-commonmark/lib/label-start-image.js
var labelStartImage = {
  name: "labelStartImage",
  resolveAll: labelEnd.resolveAll,
  tokenize: tokenizeLabelStartImage
};
function tokenizeLabelStartImage(effects, ok3, nok) {
  const self2 = this;
  return start2;
  function start2(code2) {
    effects.enter("labelImage");
    effects.enter("labelImageMarker");
    effects.consume(code2);
    effects.exit("labelImageMarker");
    return open;
  }
  function open(code2) {
    if (code2 === 91) {
      effects.enter("labelMarker");
      effects.consume(code2);
      effects.exit("labelMarker");
      effects.exit("labelImage");
      return after;
    }
    return nok(code2);
  }
  function after(code2) {
    return code2 === 94 && "_hiddenFootnoteSupport" in self2.parser.constructs ? nok(code2) : ok3(code2);
  }
}

// ../../node_modules/micromark-core-commonmark/lib/label-start-link.js
var labelStartLink = {
  name: "labelStartLink",
  resolveAll: labelEnd.resolveAll,
  tokenize: tokenizeLabelStartLink
};
function tokenizeLabelStartLink(effects, ok3, nok) {
  const self2 = this;
  return start2;
  function start2(code2) {
    effects.enter("labelLink");
    effects.enter("labelMarker");
    effects.consume(code2);
    effects.exit("labelMarker");
    effects.exit("labelLink");
    return after;
  }
  function after(code2) {
    return code2 === 94 && "_hiddenFootnoteSupport" in self2.parser.constructs ? nok(code2) : ok3(code2);
  }
}

// ../../node_modules/micromark-core-commonmark/lib/line-ending.js
var lineEnding = {
  name: "lineEnding",
  tokenize: tokenizeLineEnding
};
function tokenizeLineEnding(effects, ok3) {
  return start2;
  function start2(code2) {
    effects.enter("lineEnding");
    effects.consume(code2);
    effects.exit("lineEnding");
    return factorySpace(effects, ok3, "linePrefix");
  }
}

// ../../node_modules/micromark-core-commonmark/lib/thematic-break.js
var thematicBreak = {
  name: "thematicBreak",
  tokenize: tokenizeThematicBreak
};
function tokenizeThematicBreak(effects, ok3, nok) {
  let size = 0;
  let marker;
  return start2;
  function start2(code2) {
    effects.enter("thematicBreak");
    return before(code2);
  }
  function before(code2) {
    marker = code2;
    return atBreak(code2);
  }
  function atBreak(code2) {
    if (code2 === marker) {
      effects.enter("thematicBreakSequence");
      return sequence(code2);
    }
    if (size >= 3 && (code2 === null || markdownLineEnding(code2))) {
      effects.exit("thematicBreak");
      return ok3(code2);
    }
    return nok(code2);
  }
  function sequence(code2) {
    if (code2 === marker) {
      effects.consume(code2);
      size++;
      return sequence;
    }
    effects.exit("thematicBreakSequence");
    return markdownSpace(code2) ? factorySpace(effects, atBreak, "whitespace")(code2) : atBreak(code2);
  }
}

// ../../node_modules/micromark-core-commonmark/lib/list.js
var list = {
  continuation: {
    tokenize: tokenizeListContinuation
  },
  exit: tokenizeListEnd,
  name: "list",
  tokenize: tokenizeListStart
};
var listItemPrefixWhitespaceConstruct = {
  partial: true,
  tokenize: tokenizeListItemPrefixWhitespace
};
var indentConstruct = {
  partial: true,
  tokenize: tokenizeIndent
};
function tokenizeListStart(effects, ok3, nok) {
  const self2 = this;
  const tail = self2.events[self2.events.length - 1];
  let initialSize = tail && tail[1].type === "linePrefix" ? tail[2].sliceSerialize(tail[1], true).length : 0;
  let size = 0;
  return start2;
  function start2(code2) {
    const kind = self2.containerState.type || (code2 === 42 || code2 === 43 || code2 === 45 ? "listUnordered" : "listOrdered");
    if (kind === "listUnordered" ? !self2.containerState.marker || code2 === self2.containerState.marker : asciiDigit(code2)) {
      if (!self2.containerState.type) {
        self2.containerState.type = kind;
        effects.enter(kind, {
          _container: true
        });
      }
      if (kind === "listUnordered") {
        effects.enter("listItemPrefix");
        return code2 === 42 || code2 === 45 ? effects.check(thematicBreak, nok, atMarker)(code2) : atMarker(code2);
      }
      if (!self2.interrupt || code2 === 49) {
        effects.enter("listItemPrefix");
        effects.enter("listItemValue");
        return inside(code2);
      }
    }
    return nok(code2);
  }
  function inside(code2) {
    if (asciiDigit(code2) && ++size < 10) {
      effects.consume(code2);
      return inside;
    }
    if ((!self2.interrupt || size < 2) && (self2.containerState.marker ? code2 === self2.containerState.marker : code2 === 41 || code2 === 46)) {
      effects.exit("listItemValue");
      return atMarker(code2);
    }
    return nok(code2);
  }
  function atMarker(code2) {
    effects.enter("listItemMarker");
    effects.consume(code2);
    effects.exit("listItemMarker");
    self2.containerState.marker = self2.containerState.marker || code2;
    return effects.check(
      blankLine,
      // Can’t be empty when interrupting.
      self2.interrupt ? nok : onBlank,
      effects.attempt(listItemPrefixWhitespaceConstruct, endOfPrefix, otherPrefix)
    );
  }
  function onBlank(code2) {
    self2.containerState.initialBlankLine = true;
    initialSize++;
    return endOfPrefix(code2);
  }
  function otherPrefix(code2) {
    if (markdownSpace(code2)) {
      effects.enter("listItemPrefixWhitespace");
      effects.consume(code2);
      effects.exit("listItemPrefixWhitespace");
      return endOfPrefix;
    }
    return nok(code2);
  }
  function endOfPrefix(code2) {
    self2.containerState.size = initialSize + self2.sliceSerialize(effects.exit("listItemPrefix"), true).length;
    return ok3(code2);
  }
}
function tokenizeListContinuation(effects, ok3, nok) {
  const self2 = this;
  self2.containerState._closeFlow = void 0;
  return effects.check(blankLine, onBlank, notBlank);
  function onBlank(code2) {
    self2.containerState.furtherBlankLines = self2.containerState.furtherBlankLines || self2.containerState.initialBlankLine;
    return factorySpace(effects, ok3, "listItemIndent", self2.containerState.size + 1)(code2);
  }
  function notBlank(code2) {
    if (self2.containerState.furtherBlankLines || !markdownSpace(code2)) {
      self2.containerState.furtherBlankLines = void 0;
      self2.containerState.initialBlankLine = void 0;
      return notInCurrentItem(code2);
    }
    self2.containerState.furtherBlankLines = void 0;
    self2.containerState.initialBlankLine = void 0;
    return effects.attempt(indentConstruct, ok3, notInCurrentItem)(code2);
  }
  function notInCurrentItem(code2) {
    self2.containerState._closeFlow = true;
    self2.interrupt = void 0;
    return factorySpace(effects, effects.attempt(list, ok3, nok), "linePrefix", self2.parser.constructs.disable.null.includes("codeIndented") ? void 0 : 4)(code2);
  }
}
function tokenizeIndent(effects, ok3, nok) {
  const self2 = this;
  return factorySpace(effects, afterPrefix, "listItemIndent", self2.containerState.size + 1);
  function afterPrefix(code2) {
    const tail = self2.events[self2.events.length - 1];
    return tail && tail[1].type === "listItemIndent" && tail[2].sliceSerialize(tail[1], true).length === self2.containerState.size ? ok3(code2) : nok(code2);
  }
}
function tokenizeListEnd(effects) {
  effects.exit(this.containerState.type);
}
function tokenizeListItemPrefixWhitespace(effects, ok3, nok) {
  const self2 = this;
  return factorySpace(effects, afterPrefix, "listItemPrefixWhitespace", self2.parser.constructs.disable.null.includes("codeIndented") ? void 0 : 4 + 1);
  function afterPrefix(code2) {
    const tail = self2.events[self2.events.length - 1];
    return !markdownSpace(code2) && tail && tail[1].type === "listItemPrefixWhitespace" ? ok3(code2) : nok(code2);
  }
}

// ../../node_modules/micromark-core-commonmark/lib/setext-underline.js
var setextUnderline = {
  name: "setextUnderline",
  resolveTo: resolveToSetextUnderline,
  tokenize: tokenizeSetextUnderline
};
function resolveToSetextUnderline(events, context) {
  let index2 = events.length;
  let content3;
  let text5;
  let definition2;
  while (index2--) {
    if (events[index2][0] === "enter") {
      if (events[index2][1].type === "content") {
        content3 = index2;
        break;
      }
      if (events[index2][1].type === "paragraph") {
        text5 = index2;
      }
    } else {
      if (events[index2][1].type === "content") {
        events.splice(index2, 1);
      }
      if (!definition2 && events[index2][1].type === "definition") {
        definition2 = index2;
      }
    }
  }
  const heading2 = {
    type: "setextHeading",
    start: {
      ...events[content3][1].start
    },
    end: {
      ...events[events.length - 1][1].end
    }
  };
  events[text5][1].type = "setextHeadingText";
  if (definition2) {
    events.splice(text5, 0, ["enter", heading2, context]);
    events.splice(definition2 + 1, 0, ["exit", events[content3][1], context]);
    events[content3][1].end = {
      ...events[definition2][1].end
    };
  } else {
    events[content3][1] = heading2;
  }
  events.push(["exit", heading2, context]);
  return events;
}
function tokenizeSetextUnderline(effects, ok3, nok) {
  const self2 = this;
  let marker;
  return start2;
  function start2(code2) {
    let index2 = self2.events.length;
    let paragraph2;
    while (index2--) {
      if (self2.events[index2][1].type !== "lineEnding" && self2.events[index2][1].type !== "linePrefix" && self2.events[index2][1].type !== "content") {
        paragraph2 = self2.events[index2][1].type === "paragraph";
        break;
      }
    }
    if (!self2.parser.lazy[self2.now().line] && (self2.interrupt || paragraph2)) {
      effects.enter("setextHeadingLine");
      marker = code2;
      return before(code2);
    }
    return nok(code2);
  }
  function before(code2) {
    effects.enter("setextHeadingLineSequence");
    return inside(code2);
  }
  function inside(code2) {
    if (code2 === marker) {
      effects.consume(code2);
      return inside;
    }
    effects.exit("setextHeadingLineSequence");
    return markdownSpace(code2) ? factorySpace(effects, after, "lineSuffix")(code2) : after(code2);
  }
  function after(code2) {
    if (code2 === null || markdownLineEnding(code2)) {
      effects.exit("setextHeadingLine");
      return ok3(code2);
    }
    return nok(code2);
  }
}

// ../../node_modules/micromark/lib/initialize/flow.js
var flow = {
  tokenize: initializeFlow
};
function initializeFlow(effects) {
  const self2 = this;
  const initial = effects.attempt(
    // Try to parse a blank line.
    blankLine,
    atBlankEnding,
    // Try to parse initial flow (essentially, only code).
    effects.attempt(this.parser.constructs.flowInitial, afterConstruct, factorySpace(effects, effects.attempt(this.parser.constructs.flow, afterConstruct, effects.attempt(content2, afterConstruct)), "linePrefix"))
  );
  return initial;
  function atBlankEnding(code2) {
    if (code2 === null) {
      effects.consume(code2);
      return;
    }
    effects.enter("lineEndingBlank");
    effects.consume(code2);
    effects.exit("lineEndingBlank");
    self2.currentConstruct = void 0;
    return initial;
  }
  function afterConstruct(code2) {
    if (code2 === null) {
      effects.consume(code2);
      return;
    }
    effects.enter("lineEnding");
    effects.consume(code2);
    effects.exit("lineEnding");
    self2.currentConstruct = void 0;
    return initial;
  }
}

// ../../node_modules/micromark/lib/initialize/text.js
var resolver = {
  resolveAll: createResolver()
};
var string = initializeFactory("string");
var text2 = initializeFactory("text");
function initializeFactory(field) {
  return {
    resolveAll: createResolver(field === "text" ? resolveAllLineSuffixes : void 0),
    tokenize: initializeText
  };
  function initializeText(effects) {
    const self2 = this;
    const constructs2 = this.parser.constructs[field];
    const text5 = effects.attempt(constructs2, start2, notText);
    return start2;
    function start2(code2) {
      return atBreak(code2) ? text5(code2) : notText(code2);
    }
    function notText(code2) {
      if (code2 === null) {
        effects.consume(code2);
        return;
      }
      effects.enter("data");
      effects.consume(code2);
      return data;
    }
    function data(code2) {
      if (atBreak(code2)) {
        effects.exit("data");
        return text5(code2);
      }
      effects.consume(code2);
      return data;
    }
    function atBreak(code2) {
      if (code2 === null) {
        return true;
      }
      const list3 = constructs2[code2];
      let index2 = -1;
      if (list3) {
        while (++index2 < list3.length) {
          const item = list3[index2];
          if (!item.previous || item.previous.call(self2, self2.previous)) {
            return true;
          }
        }
      }
      return false;
    }
  }
}
function createResolver(extraResolver) {
  return resolveAllText;
  function resolveAllText(events, context) {
    let index2 = -1;
    let enter;
    while (++index2 <= events.length) {
      if (enter === void 0) {
        if (events[index2] && events[index2][1].type === "data") {
          enter = index2;
          index2++;
        }
      } else if (!events[index2] || events[index2][1].type !== "data") {
        if (index2 !== enter + 2) {
          events[enter][1].end = events[index2 - 1][1].end;
          events.splice(enter + 2, index2 - enter - 2);
          index2 = enter + 2;
        }
        enter = void 0;
      }
    }
    return extraResolver ? extraResolver(events, context) : events;
  }
}
function resolveAllLineSuffixes(events, context) {
  let eventIndex = 0;
  while (++eventIndex <= events.length) {
    if ((eventIndex === events.length || events[eventIndex][1].type === "lineEnding") && events[eventIndex - 1][1].type === "data") {
      const data = events[eventIndex - 1][1];
      const chunks = context.sliceStream(data);
      let index2 = chunks.length;
      let bufferIndex = -1;
      let size = 0;
      let tabs;
      while (index2--) {
        const chunk = chunks[index2];
        if (typeof chunk === "string") {
          bufferIndex = chunk.length;
          while (chunk.charCodeAt(bufferIndex - 1) === 32) {
            size++;
            bufferIndex--;
          }
          if (bufferIndex) break;
          bufferIndex = -1;
        } else if (chunk === -2) {
          tabs = true;
          size++;
        } else if (chunk === -1) {
        } else {
          index2++;
          break;
        }
      }
      if (context._contentTypeTextTrailing && eventIndex === events.length) {
        size = 0;
      }
      if (size) {
        const token = {
          type: eventIndex === events.length || tabs || size < 2 ? "lineSuffix" : "hardBreakTrailing",
          start: {
            _bufferIndex: index2 ? bufferIndex : data.start._bufferIndex + bufferIndex,
            _index: data.start._index + index2,
            line: data.end.line,
            column: data.end.column - size,
            offset: data.end.offset - size
          },
          end: {
            ...data.end
          }
        };
        data.end = {
          ...token.start
        };
        if (data.start.offset === data.end.offset) {
          Object.assign(data, token);
        } else {
          events.splice(eventIndex, 0, ["enter", token, context], ["exit", token, context]);
          eventIndex += 2;
        }
      }
      eventIndex++;
    }
  }
  return events;
}

// ../../node_modules/micromark/lib/constructs.js
var constructs_exports = {};
__export(constructs_exports, {
  attentionMarkers: () => attentionMarkers,
  contentInitial: () => contentInitial,
  disable: () => disable,
  document: () => document3,
  flow: () => flow2,
  flowInitial: () => flowInitial,
  insideSpan: () => insideSpan,
  string: () => string2,
  text: () => text3
});
var document3 = {
  [42]: list,
  [43]: list,
  [45]: list,
  [48]: list,
  [49]: list,
  [50]: list,
  [51]: list,
  [52]: list,
  [53]: list,
  [54]: list,
  [55]: list,
  [56]: list,
  [57]: list,
  [62]: blockQuote
};
var contentInitial = {
  [91]: definition
};
var flowInitial = {
  [-2]: codeIndented,
  [-1]: codeIndented,
  [32]: codeIndented
};
var flow2 = {
  [35]: headingAtx,
  [42]: thematicBreak,
  [45]: [setextUnderline, thematicBreak],
  [60]: htmlFlow,
  [61]: setextUnderline,
  [95]: thematicBreak,
  [96]: codeFenced,
  [126]: codeFenced
};
var string2 = {
  [38]: characterReference,
  [92]: characterEscape
};
var text3 = {
  [-5]: lineEnding,
  [-4]: lineEnding,
  [-3]: lineEnding,
  [33]: labelStartImage,
  [38]: characterReference,
  [42]: attention,
  [60]: [autolink, htmlText],
  [91]: labelStartLink,
  [92]: [hardBreakEscape, characterEscape],
  [93]: labelEnd,
  [95]: attention,
  [96]: codeText
};
var insideSpan = {
  null: [attention, resolver]
};
var attentionMarkers = {
  null: [42, 95]
};
var disable = {
  null: []
};

// ../../node_modules/micromark/lib/create-tokenizer.js
function createTokenizer(parser, initialize, from) {
  let point4 = {
    _bufferIndex: -1,
    _index: 0,
    line: from && from.line || 1,
    column: from && from.column || 1,
    offset: from && from.offset || 0
  };
  const columnStart = {};
  const resolveAllConstructs = [];
  let chunks = [];
  let stack = [];
  let consumed = true;
  const effects = {
    attempt: constructFactory(onsuccessfulconstruct),
    check: constructFactory(onsuccessfulcheck),
    consume,
    enter,
    exit: exit2,
    interrupt: constructFactory(onsuccessfulcheck, {
      interrupt: true
    })
  };
  const context = {
    code: null,
    containerState: {},
    defineSkip,
    events: [],
    now,
    parser,
    previous: null,
    sliceSerialize,
    sliceStream,
    write
  };
  let state = initialize.tokenize.call(context, effects);
  let expectedCode;
  if (initialize.resolveAll) {
    resolveAllConstructs.push(initialize);
  }
  return context;
  function write(slice) {
    chunks = push(chunks, slice);
    main();
    if (chunks[chunks.length - 1] !== null) {
      return [];
    }
    addResult(initialize, 0);
    context.events = resolveAll(resolveAllConstructs, context.events, context);
    return context.events;
  }
  function sliceSerialize(token, expandTabs) {
    return serializeChunks(sliceStream(token), expandTabs);
  }
  function sliceStream(token) {
    return sliceChunks(chunks, token);
  }
  function now() {
    const {
      _bufferIndex,
      _index,
      line,
      column,
      offset
    } = point4;
    return {
      _bufferIndex,
      _index,
      line,
      column,
      offset
    };
  }
  function defineSkip(value) {
    columnStart[value.line] = value.column;
    accountForPotentialSkip();
  }
  function main() {
    let chunkIndex;
    while (point4._index < chunks.length) {
      const chunk = chunks[point4._index];
      if (typeof chunk === "string") {
        chunkIndex = point4._index;
        if (point4._bufferIndex < 0) {
          point4._bufferIndex = 0;
        }
        while (point4._index === chunkIndex && point4._bufferIndex < chunk.length) {
          go(chunk.charCodeAt(point4._bufferIndex));
        }
      } else {
        go(chunk);
      }
    }
  }
  function go(code2) {
    consumed = void 0;
    expectedCode = code2;
    state = state(code2);
  }
  function consume(code2) {
    if (markdownLineEnding(code2)) {
      point4.line++;
      point4.column = 1;
      point4.offset += code2 === -3 ? 2 : 1;
      accountForPotentialSkip();
    } else if (code2 !== -1) {
      point4.column++;
      point4.offset++;
    }
    if (point4._bufferIndex < 0) {
      point4._index++;
    } else {
      point4._bufferIndex++;
      if (point4._bufferIndex === // Points w/ non-negative `_bufferIndex` reference
      // strings.
      /** @type {string} */
      chunks[point4._index].length) {
        point4._bufferIndex = -1;
        point4._index++;
      }
    }
    context.previous = code2;
    consumed = true;
  }
  function enter(type, fields) {
    const token = fields || {};
    token.type = type;
    token.start = now();
    context.events.push(["enter", token, context]);
    stack.push(token);
    return token;
  }
  function exit2(type) {
    const token = stack.pop();
    token.end = now();
    context.events.push(["exit", token, context]);
    return token;
  }
  function onsuccessfulconstruct(construct, info) {
    addResult(construct, info.from);
  }
  function onsuccessfulcheck(_, info) {
    info.restore();
  }
  function constructFactory(onreturn, fields) {
    return hook;
    function hook(constructs2, returnState, bogusState) {
      let listOfConstructs;
      let constructIndex;
      let currentConstruct;
      let info;
      return Array.isArray(constructs2) ? (
        /* c8 ignore next 1 */
        handleListOfConstructs(constructs2)
      ) : "tokenize" in constructs2 ? (
        // Looks like a construct.
        handleListOfConstructs([
          /** @type {Construct} */
          constructs2
        ])
      ) : handleMapOfConstructs(constructs2);
      function handleMapOfConstructs(map) {
        return start2;
        function start2(code2) {
          const left = code2 !== null && map[code2];
          const all2 = code2 !== null && map.null;
          const list3 = [
            // To do: add more extension tests.
            /* c8 ignore next 2 */
            ...Array.isArray(left) ? left : left ? [left] : [],
            ...Array.isArray(all2) ? all2 : all2 ? [all2] : []
          ];
          return handleListOfConstructs(list3)(code2);
        }
      }
      function handleListOfConstructs(list3) {
        listOfConstructs = list3;
        constructIndex = 0;
        if (list3.length === 0) {
          return bogusState;
        }
        return handleConstruct(list3[constructIndex]);
      }
      function handleConstruct(construct) {
        return start2;
        function start2(code2) {
          info = store();
          currentConstruct = construct;
          if (!construct.partial) {
            context.currentConstruct = construct;
          }
          if (construct.name && context.parser.constructs.disable.null.includes(construct.name)) {
            return nok(code2);
          }
          return construct.tokenize.call(
            // If we do have fields, create an object w/ `context` as its
            // prototype.
            // This allows a “live binding”, which is needed for `interrupt`.
            fields ? Object.assign(Object.create(context), fields) : context,
            effects,
            ok3,
            nok
          )(code2);
        }
      }
      function ok3(code2) {
        consumed = true;
        onreturn(currentConstruct, info);
        return returnState;
      }
      function nok(code2) {
        consumed = true;
        info.restore();
        if (++constructIndex < listOfConstructs.length) {
          return handleConstruct(listOfConstructs[constructIndex]);
        }
        return bogusState;
      }
    }
  }
  function addResult(construct, from2) {
    if (construct.resolveAll && !resolveAllConstructs.includes(construct)) {
      resolveAllConstructs.push(construct);
    }
    if (construct.resolve) {
      splice(context.events, from2, context.events.length - from2, construct.resolve(context.events.slice(from2), context));
    }
    if (construct.resolveTo) {
      context.events = construct.resolveTo(context.events, context);
    }
  }
  function store() {
    const startPoint = now();
    const startPrevious = context.previous;
    const startCurrentConstruct = context.currentConstruct;
    const startEventsIndex = context.events.length;
    const startStack = Array.from(stack);
    return {
      from: startEventsIndex,
      restore
    };
    function restore() {
      point4 = startPoint;
      context.previous = startPrevious;
      context.currentConstruct = startCurrentConstruct;
      context.events.length = startEventsIndex;
      stack = startStack;
      accountForPotentialSkip();
    }
  }
  function accountForPotentialSkip() {
    if (point4.line in columnStart && point4.column < 2) {
      point4.column = columnStart[point4.line];
      point4.offset += columnStart[point4.line] - 1;
    }
  }
}
function sliceChunks(chunks, token) {
  const startIndex = token.start._index;
  const startBufferIndex = token.start._bufferIndex;
  const endIndex = token.end._index;
  const endBufferIndex = token.end._bufferIndex;
  let view;
  if (startIndex === endIndex) {
    view = [chunks[startIndex].slice(startBufferIndex, endBufferIndex)];
  } else {
    view = chunks.slice(startIndex, endIndex);
    if (startBufferIndex > -1) {
      const head = view[0];
      if (typeof head === "string") {
        view[0] = head.slice(startBufferIndex);
      } else {
        view.shift();
      }
    }
    if (endBufferIndex > 0) {
      view.push(chunks[endIndex].slice(0, endBufferIndex));
    }
  }
  return view;
}
function serializeChunks(chunks, expandTabs) {
  let index2 = -1;
  const result = [];
  let atTab;
  while (++index2 < chunks.length) {
    const chunk = chunks[index2];
    let value;
    if (typeof chunk === "string") {
      value = chunk;
    } else switch (chunk) {
      case -5: {
        value = "\r";
        break;
      }
      case -4: {
        value = "\n";
        break;
      }
      case -3: {
        value = "\r\n";
        break;
      }
      case -2: {
        value = expandTabs ? " " : "	";
        break;
      }
      case -1: {
        if (!expandTabs && atTab) continue;
        value = " ";
        break;
      }
      default: {
        value = String.fromCharCode(chunk);
      }
    }
    atTab = chunk === -2;
    result.push(value);
  }
  return result.join("");
}

// ../../node_modules/micromark/lib/parse.js
function parse(options) {
  const settings = options || {};
  const constructs2 = (
    /** @type {FullNormalizedExtension} */
    combineExtensions([constructs_exports, ...settings.extensions || []])
  );
  const parser = {
    constructs: constructs2,
    content: create2(content),
    defined: [],
    document: create2(document2),
    flow: create2(flow),
    lazy: {},
    string: create2(string),
    text: create2(text2)
  };
  return parser;
  function create2(initial) {
    return creator;
    function creator(from) {
      return createTokenizer(parser, initial, from);
    }
  }
}

// ../../node_modules/micromark/lib/postprocess.js
function postprocess(events) {
  while (!subtokenize(events)) {
  }
  return events;
}

// ../../node_modules/micromark/lib/preprocess.js
var search = /[\0\t\n\r]/g;
function preprocess() {
  let column = 1;
  let buffer = "";
  let start2 = true;
  let atCarriageReturn;
  return preprocessor;
  function preprocessor(value, encoding, end) {
    const chunks = [];
    let match;
    let next;
    let startPosition;
    let endPosition;
    let code2;
    value = buffer + (typeof value === "string" ? value.toString() : new TextDecoder(encoding || void 0).decode(value));
    startPosition = 0;
    buffer = "";
    if (start2) {
      if (value.charCodeAt(0) === 65279) {
        startPosition++;
      }
      start2 = void 0;
    }
    while (startPosition < value.length) {
      search.lastIndex = startPosition;
      match = search.exec(value);
      endPosition = match && match.index !== void 0 ? match.index : value.length;
      code2 = value.charCodeAt(endPosition);
      if (!match) {
        buffer = value.slice(startPosition);
        break;
      }
      if (code2 === 10 && startPosition === endPosition && atCarriageReturn) {
        chunks.push(-3);
        atCarriageReturn = void 0;
      } else {
        if (atCarriageReturn) {
          chunks.push(-5);
          atCarriageReturn = void 0;
        }
        if (startPosition < endPosition) {
          chunks.push(value.slice(startPosition, endPosition));
          column += endPosition - startPosition;
        }
        switch (code2) {
          case 0: {
            chunks.push(65533);
            column++;
            break;
          }
          case 9: {
            next = Math.ceil(column / 4) * 4;
            chunks.push(-2);
            while (column++ < next) chunks.push(-1);
            break;
          }
          case 10: {
            chunks.push(-4);
            column = 1;
            break;
          }
          default: {
            atCarriageReturn = true;
            column = 1;
          }
        }
      }
      startPosition = endPosition + 1;
    }
    if (end) {
      if (atCarriageReturn) chunks.push(-5);
      if (buffer) chunks.push(buffer);
      chunks.push(null);
    }
    return chunks;
  }
}

// ../../node_modules/micromark-util-decode-string/index.js
var characterEscapeOrReference = /\\([!-/:-@[-`{-~])|&(#(?:\d{1,7}|x[\da-f]{1,6})|[\da-z]{1,31});/gi;
function decodeString(value) {
  return value.replace(characterEscapeOrReference, decode);
}
function decode($0, $1, $2) {
  if ($1) {
    return $1;
  }
  const head = $2.charCodeAt(0);
  if (head === 35) {
    const head2 = $2.charCodeAt(1);
    const hex = head2 === 120 || head2 === 88;
    return decodeNumericCharacterReference($2.slice(hex ? 2 : 1), hex ? 16 : 10);
  }
  return decodeNamedCharacterReference($2) || $0;
}

// ../../node_modules/mdast-util-from-markdown/lib/index.js
var own2 = {}.hasOwnProperty;
function fromMarkdown(value, encoding, options) {
  if (encoding && typeof encoding === "object") {
    options = encoding;
    encoding = void 0;
  }
  return compiler(options)(postprocess(parse(options).document().write(preprocess()(value, encoding, true))));
}
function compiler(options) {
  const config = {
    transforms: [],
    canContainEols: ["emphasis", "fragment", "heading", "paragraph", "strong"],
    enter: {
      autolink: opener(link2),
      autolinkProtocol: onenterdata,
      autolinkEmail: onenterdata,
      atxHeading: opener(heading2),
      blockQuote: opener(blockQuote2),
      characterEscape: onenterdata,
      characterReference: onenterdata,
      codeFenced: opener(codeFlow),
      codeFencedFenceInfo: buffer,
      codeFencedFenceMeta: buffer,
      codeIndented: opener(codeFlow, buffer),
      codeText: opener(codeText2, buffer),
      codeTextData: onenterdata,
      data: onenterdata,
      codeFlowValue: onenterdata,
      definition: opener(definition2),
      definitionDestinationString: buffer,
      definitionLabelString: buffer,
      definitionTitleString: buffer,
      emphasis: opener(emphasis2),
      hardBreakEscape: opener(hardBreak2),
      hardBreakTrailing: opener(hardBreak2),
      htmlFlow: opener(html4, buffer),
      htmlFlowData: onenterdata,
      htmlText: opener(html4, buffer),
      htmlTextData: onenterdata,
      image: opener(image2),
      label: buffer,
      link: opener(link2),
      listItem: opener(listItem2),
      listItemValue: onenterlistitemvalue,
      listOrdered: opener(list3, onenterlistordered),
      listUnordered: opener(list3),
      paragraph: opener(paragraph2),
      reference: onenterreference,
      referenceString: buffer,
      resourceDestinationString: buffer,
      resourceTitleString: buffer,
      setextHeading: opener(heading2),
      strong: opener(strong2),
      thematicBreak: opener(thematicBreak3)
    },
    exit: {
      atxHeading: closer(),
      atxHeadingSequence: onexitatxheadingsequence,
      autolink: closer(),
      autolinkEmail: onexitautolinkemail,
      autolinkProtocol: onexitautolinkprotocol,
      blockQuote: closer(),
      characterEscapeValue: onexitdata,
      characterReferenceMarkerHexadecimal: onexitcharacterreferencemarker,
      characterReferenceMarkerNumeric: onexitcharacterreferencemarker,
      characterReferenceValue: onexitcharacterreferencevalue,
      characterReference: onexitcharacterreference,
      codeFenced: closer(onexitcodefenced),
      codeFencedFence: onexitcodefencedfence,
      codeFencedFenceInfo: onexitcodefencedfenceinfo,
      codeFencedFenceMeta: onexitcodefencedfencemeta,
      codeFlowValue: onexitdata,
      codeIndented: closer(onexitcodeindented),
      codeText: closer(onexitcodetext),
      codeTextData: onexitdata,
      data: onexitdata,
      definition: closer(),
      definitionDestinationString: onexitdefinitiondestinationstring,
      definitionLabelString: onexitdefinitionlabelstring,
      definitionTitleString: onexitdefinitiontitlestring,
      emphasis: closer(),
      hardBreakEscape: closer(onexithardbreak),
      hardBreakTrailing: closer(onexithardbreak),
      htmlFlow: closer(onexithtmlflow),
      htmlFlowData: onexitdata,
      htmlText: closer(onexithtmltext),
      htmlTextData: onexitdata,
      image: closer(onexitimage),
      label: onexitlabel,
      labelText: onexitlabeltext,
      lineEnding: onexitlineending,
      link: closer(onexitlink),
      listItem: closer(),
      listOrdered: closer(),
      listUnordered: closer(),
      paragraph: closer(),
      referenceString: onexitreferencestring,
      resourceDestinationString: onexitresourcedestinationstring,
      resourceTitleString: onexitresourcetitlestring,
      resource: onexitresource,
      setextHeading: closer(onexitsetextheading),
      setextHeadingLineSequence: onexitsetextheadinglinesequence,
      setextHeadingText: onexitsetextheadingtext,
      strong: closer(),
      thematicBreak: closer()
    }
  };
  configure(config, (options || {}).mdastExtensions || []);
  const data = {};
  return compile;
  function compile(events) {
    let tree = {
      type: "root",
      children: []
    };
    const context = {
      stack: [tree],
      tokenStack: [],
      config,
      enter,
      exit: exit2,
      buffer,
      resume,
      data
    };
    const listStack = [];
    let index2 = -1;
    while (++index2 < events.length) {
      if (events[index2][1].type === "listOrdered" || events[index2][1].type === "listUnordered") {
        if (events[index2][0] === "enter") {
          listStack.push(index2);
        } else {
          const tail = listStack.pop();
          index2 = prepareList(events, tail, index2);
        }
      }
    }
    index2 = -1;
    while (++index2 < events.length) {
      const handler = config[events[index2][0]];
      if (own2.call(handler, events[index2][1].type)) {
        handler[events[index2][1].type].call(Object.assign({
          sliceSerialize: events[index2][2].sliceSerialize
        }, context), events[index2][1]);
      }
    }
    if (context.tokenStack.length > 0) {
      const tail = context.tokenStack[context.tokenStack.length - 1];
      const handler = tail[1] || defaultOnError;
      handler.call(context, void 0, tail[0]);
    }
    tree.position = {
      start: point3(events.length > 0 ? events[0][1].start : {
        line: 1,
        column: 1,
        offset: 0
      }),
      end: point3(events.length > 0 ? events[events.length - 2][1].end : {
        line: 1,
        column: 1,
        offset: 0
      })
    };
    index2 = -1;
    while (++index2 < config.transforms.length) {
      tree = config.transforms[index2](tree) || tree;
    }
    return tree;
  }
  function prepareList(events, start2, length) {
    let index2 = start2 - 1;
    let containerBalance = -1;
    let listSpread = false;
    let listItem3;
    let lineIndex;
    let firstBlankLineIndex;
    let atMarker;
    while (++index2 <= length) {
      const event = events[index2];
      switch (event[1].type) {
        case "listUnordered":
        case "listOrdered":
        case "blockQuote": {
          if (event[0] === "enter") {
            containerBalance++;
          } else {
            containerBalance--;
          }
          atMarker = void 0;
          break;
        }
        case "lineEndingBlank": {
          if (event[0] === "enter") {
            if (listItem3 && !atMarker && !containerBalance && !firstBlankLineIndex) {
              firstBlankLineIndex = index2;
            }
            atMarker = void 0;
          }
          break;
        }
        case "linePrefix":
        case "listItemValue":
        case "listItemMarker":
        case "listItemPrefix":
        case "listItemPrefixWhitespace": {
          break;
        }
        default: {
          atMarker = void 0;
        }
      }
      if (!containerBalance && event[0] === "enter" && event[1].type === "listItemPrefix" || containerBalance === -1 && event[0] === "exit" && (event[1].type === "listUnordered" || event[1].type === "listOrdered")) {
        if (listItem3) {
          let tailIndex = index2;
          lineIndex = void 0;
          while (tailIndex--) {
            const tailEvent = events[tailIndex];
            if (tailEvent[1].type === "lineEnding" || tailEvent[1].type === "lineEndingBlank") {
              if (tailEvent[0] === "exit") continue;
              if (lineIndex) {
                events[lineIndex][1].type = "lineEndingBlank";
                listSpread = true;
              }
              tailEvent[1].type = "lineEnding";
              lineIndex = tailIndex;
            } else if (tailEvent[1].type === "linePrefix" || tailEvent[1].type === "blockQuotePrefix" || tailEvent[1].type === "blockQuotePrefixWhitespace" || tailEvent[1].type === "blockQuoteMarker" || tailEvent[1].type === "listItemIndent") {
            } else {
              break;
            }
          }
          if (firstBlankLineIndex && (!lineIndex || firstBlankLineIndex < lineIndex)) {
            listItem3._spread = true;
          }
          listItem3.end = Object.assign({}, lineIndex ? events[lineIndex][1].start : event[1].end);
          events.splice(lineIndex || index2, 0, ["exit", listItem3, event[2]]);
          index2++;
          length++;
        }
        if (event[1].type === "listItemPrefix") {
          const item = {
            type: "listItem",
            _spread: false,
            start: Object.assign({}, event[1].start),
            // @ts-expect-error: we’ll add `end` in a second.
            end: void 0
          };
          listItem3 = item;
          events.splice(index2, 0, ["enter", item, event[2]]);
          index2++;
          length++;
          firstBlankLineIndex = void 0;
          atMarker = true;
        }
      }
    }
    events[start2][1]._spread = listSpread;
    return length;
  }
  function opener(create2, and) {
    return open;
    function open(token) {
      enter.call(this, create2(token), token);
      if (and) and.call(this, token);
    }
  }
  function buffer() {
    this.stack.push({
      type: "fragment",
      children: []
    });
  }
  function enter(node2, token, errorHandler) {
    const parent = this.stack[this.stack.length - 1];
    const siblings = parent.children;
    siblings.push(node2);
    this.stack.push(node2);
    this.tokenStack.push([token, errorHandler || void 0]);
    node2.position = {
      start: point3(token.start),
      // @ts-expect-error: `end` will be patched later.
      end: void 0
    };
  }
  function closer(and) {
    return close;
    function close(token) {
      if (and) and.call(this, token);
      exit2.call(this, token);
    }
  }
  function exit2(token, onExitError) {
    const node2 = this.stack.pop();
    const open = this.tokenStack.pop();
    if (!open) {
      throw new Error("Cannot close `" + token.type + "` (" + stringifyPosition({
        start: token.start,
        end: token.end
      }) + "): it\u2019s not open");
    } else if (open[0].type !== token.type) {
      if (onExitError) {
        onExitError.call(this, token, open[0]);
      } else {
        const handler = open[1] || defaultOnError;
        handler.call(this, token, open[0]);
      }
    }
    node2.position.end = point3(token.end);
  }
  function resume() {
    return toString(this.stack.pop());
  }
  function onenterlistordered() {
    this.data.expectingFirstListItemValue = true;
  }
  function onenterlistitemvalue(token) {
    if (this.data.expectingFirstListItemValue) {
      const ancestor = this.stack[this.stack.length - 2];
      ancestor.start = Number.parseInt(this.sliceSerialize(token), 10);
      this.data.expectingFirstListItemValue = void 0;
    }
  }
  function onexitcodefencedfenceinfo() {
    const data2 = this.resume();
    const node2 = this.stack[this.stack.length - 1];
    node2.lang = data2;
  }
  function onexitcodefencedfencemeta() {
    const data2 = this.resume();
    const node2 = this.stack[this.stack.length - 1];
    node2.meta = data2;
  }
  function onexitcodefencedfence() {
    if (this.data.flowCodeInside) return;
    this.buffer();
    this.data.flowCodeInside = true;
  }
  function onexitcodefenced() {
    const data2 = this.resume();
    const node2 = this.stack[this.stack.length - 1];
    node2.value = data2.replace(/^(\r?\n|\r)|(\r?\n|\r)$/g, "");
    this.data.flowCodeInside = void 0;
  }
  function onexitcodeindented() {
    const data2 = this.resume();
    const node2 = this.stack[this.stack.length - 1];
    node2.value = data2.replace(/(\r?\n|\r)$/g, "");
  }
  function onexitdefinitionlabelstring(token) {
    const label = this.resume();
    const node2 = this.stack[this.stack.length - 1];
    node2.label = label;
    node2.identifier = normalizeIdentifier(this.sliceSerialize(token)).toLowerCase();
  }
  function onexitdefinitiontitlestring() {
    const data2 = this.resume();
    const node2 = this.stack[this.stack.length - 1];
    node2.title = data2;
  }
  function onexitdefinitiondestinationstring() {
    const data2 = this.resume();
    const node2 = this.stack[this.stack.length - 1];
    node2.url = data2;
  }
  function onexitatxheadingsequence(token) {
    const node2 = this.stack[this.stack.length - 1];
    if (!node2.depth) {
      const depth = this.sliceSerialize(token).length;
      node2.depth = depth;
    }
  }
  function onexitsetextheadingtext() {
    this.data.setextHeadingSlurpLineEnding = true;
  }
  function onexitsetextheadinglinesequence(token) {
    const node2 = this.stack[this.stack.length - 1];
    node2.depth = this.sliceSerialize(token).codePointAt(0) === 61 ? 1 : 2;
  }
  function onexitsetextheading() {
    this.data.setextHeadingSlurpLineEnding = void 0;
  }
  function onenterdata(token) {
    const node2 = this.stack[this.stack.length - 1];
    const siblings = node2.children;
    let tail = siblings[siblings.length - 1];
    if (!tail || tail.type !== "text") {
      tail = text5();
      tail.position = {
        start: point3(token.start),
        // @ts-expect-error: we’ll add `end` later.
        end: void 0
      };
      siblings.push(tail);
    }
    this.stack.push(tail);
  }
  function onexitdata(token) {
    const tail = this.stack.pop();
    tail.value += this.sliceSerialize(token);
    tail.position.end = point3(token.end);
  }
  function onexitlineending(token) {
    const context = this.stack[this.stack.length - 1];
    if (this.data.atHardBreak) {
      const tail = context.children[context.children.length - 1];
      tail.position.end = point3(token.end);
      this.data.atHardBreak = void 0;
      return;
    }
    if (!this.data.setextHeadingSlurpLineEnding && config.canContainEols.includes(context.type)) {
      onenterdata.call(this, token);
      onexitdata.call(this, token);
    }
  }
  function onexithardbreak() {
    this.data.atHardBreak = true;
  }
  function onexithtmlflow() {
    const data2 = this.resume();
    const node2 = this.stack[this.stack.length - 1];
    node2.value = data2;
  }
  function onexithtmltext() {
    const data2 = this.resume();
    const node2 = this.stack[this.stack.length - 1];
    node2.value = data2;
  }
  function onexitcodetext() {
    const data2 = this.resume();
    const node2 = this.stack[this.stack.length - 1];
    node2.value = data2;
  }
  function onexitlink() {
    const node2 = this.stack[this.stack.length - 1];
    if (this.data.inReference) {
      const referenceType = this.data.referenceType || "shortcut";
      node2.type += "Reference";
      node2.referenceType = referenceType;
      delete node2.url;
      delete node2.title;
    } else {
      delete node2.identifier;
      delete node2.label;
    }
    this.data.referenceType = void 0;
  }
  function onexitimage() {
    const node2 = this.stack[this.stack.length - 1];
    if (this.data.inReference) {
      const referenceType = this.data.referenceType || "shortcut";
      node2.type += "Reference";
      node2.referenceType = referenceType;
      delete node2.url;
      delete node2.title;
    } else {
      delete node2.identifier;
      delete node2.label;
    }
    this.data.referenceType = void 0;
  }
  function onexitlabeltext(token) {
    const string3 = this.sliceSerialize(token);
    const ancestor = this.stack[this.stack.length - 2];
    ancestor.label = decodeString(string3);
    ancestor.identifier = normalizeIdentifier(string3).toLowerCase();
  }
  function onexitlabel() {
    const fragment = this.stack[this.stack.length - 1];
    const value = this.resume();
    const node2 = this.stack[this.stack.length - 1];
    this.data.inReference = true;
    if (node2.type === "link") {
      const children = fragment.children;
      node2.children = children;
    } else {
      node2.alt = value;
    }
  }
  function onexitresourcedestinationstring() {
    const data2 = this.resume();
    const node2 = this.stack[this.stack.length - 1];
    node2.url = data2;
  }
  function onexitresourcetitlestring() {
    const data2 = this.resume();
    const node2 = this.stack[this.stack.length - 1];
    node2.title = data2;
  }
  function onexitresource() {
    this.data.inReference = void 0;
  }
  function onenterreference() {
    this.data.referenceType = "collapsed";
  }
  function onexitreferencestring(token) {
    const label = this.resume();
    const node2 = this.stack[this.stack.length - 1];
    node2.label = label;
    node2.identifier = normalizeIdentifier(this.sliceSerialize(token)).toLowerCase();
    this.data.referenceType = "full";
  }
  function onexitcharacterreferencemarker(token) {
    this.data.characterReferenceType = token.type;
  }
  function onexitcharacterreferencevalue(token) {
    const data2 = this.sliceSerialize(token);
    const type = this.data.characterReferenceType;
    let value;
    if (type) {
      value = decodeNumericCharacterReference(data2, type === "characterReferenceMarkerNumeric" ? 10 : 16);
      this.data.characterReferenceType = void 0;
    } else {
      const result = decodeNamedCharacterReference(data2);
      value = result;
    }
    const tail = this.stack[this.stack.length - 1];
    tail.value += value;
  }
  function onexitcharacterreference(token) {
    const tail = this.stack.pop();
    tail.position.end = point3(token.end);
  }
  function onexitautolinkprotocol(token) {
    onexitdata.call(this, token);
    const node2 = this.stack[this.stack.length - 1];
    node2.url = this.sliceSerialize(token);
  }
  function onexitautolinkemail(token) {
    onexitdata.call(this, token);
    const node2 = this.stack[this.stack.length - 1];
    node2.url = "mailto:" + this.sliceSerialize(token);
  }
  function blockQuote2() {
    return {
      type: "blockquote",
      children: []
    };
  }
  function codeFlow() {
    return {
      type: "code",
      lang: null,
      meta: null,
      value: ""
    };
  }
  function codeText2() {
    return {
      type: "inlineCode",
      value: ""
    };
  }
  function definition2() {
    return {
      type: "definition",
      identifier: "",
      label: null,
      title: null,
      url: ""
    };
  }
  function emphasis2() {
    return {
      type: "emphasis",
      children: []
    };
  }
  function heading2() {
    return {
      type: "heading",
      // @ts-expect-error `depth` will be set later.
      depth: 0,
      children: []
    };
  }
  function hardBreak2() {
    return {
      type: "break"
    };
  }
  function html4() {
    return {
      type: "html",
      value: ""
    };
  }
  function image2() {
    return {
      type: "image",
      title: null,
      url: "",
      alt: null
    };
  }
  function link2() {
    return {
      type: "link",
      title: null,
      url: "",
      children: []
    };
  }
  function list3(token) {
    return {
      type: "list",
      ordered: token.type === "listOrdered",
      start: null,
      spread: token._spread,
      children: []
    };
  }
  function listItem2(token) {
    return {
      type: "listItem",
      spread: token._spread,
      checked: null,
      children: []
    };
  }
  function paragraph2() {
    return {
      type: "paragraph",
      children: []
    };
  }
  function strong2() {
    return {
      type: "strong",
      children: []
    };
  }
  function text5() {
    return {
      type: "text",
      value: ""
    };
  }
  function thematicBreak3() {
    return {
      type: "thematicBreak"
    };
  }
}
function point3(d) {
  return {
    line: d.line,
    column: d.column,
    offset: d.offset
  };
}
function configure(combined, extensions) {
  let index2 = -1;
  while (++index2 < extensions.length) {
    const value = extensions[index2];
    if (Array.isArray(value)) {
      configure(combined, value);
    } else {
      extension(combined, value);
    }
  }
}
function extension(combined, extension2) {
  let key;
  for (key in extension2) {
    if (own2.call(extension2, key)) {
      switch (key) {
        case "canContainEols": {
          const right = extension2[key];
          if (right) {
            combined[key].push(...right);
          }
          break;
        }
        case "transforms": {
          const right = extension2[key];
          if (right) {
            combined[key].push(...right);
          }
          break;
        }
        case "enter":
        case "exit": {
          const right = extension2[key];
          if (right) {
            Object.assign(combined[key], right);
          }
          break;
        }
      }
    }
  }
}
function defaultOnError(left, right) {
  if (left) {
    throw new Error("Cannot close `" + left.type + "` (" + stringifyPosition({
      start: left.start,
      end: left.end
    }) + "): a different token (`" + right.type + "`, " + stringifyPosition({
      start: right.start,
      end: right.end
    }) + ") is open");
  } else {
    throw new Error("Cannot close document, a token (`" + right.type + "`, " + stringifyPosition({
      start: right.start,
      end: right.end
    }) + ") is still open");
  }
}

// ../../node_modules/remark-parse/lib/index.js
function remarkParse(options) {
  const self2 = this;
  self2.parser = parser;
  function parser(doc) {
    return fromMarkdown(doc, {
      ...self2.data("settings"),
      ...options,
      // Note: these options are not in the readme.
      // The goal is for them to be set by plugins on `data` instead of being
      // passed by users.
      extensions: self2.data("micromarkExtensions") || [],
      mdastExtensions: self2.data("fromMarkdownExtensions") || []
    });
  }
}

// ../../node_modules/mdast-util-to-hast/lib/handlers/blockquote.js
function blockquote(state, node2) {
  const result = {
    type: "element",
    tagName: "blockquote",
    properties: {},
    children: state.wrap(state.all(node2), true)
  };
  state.patch(node2, result);
  return state.applyData(node2, result);
}

// ../../node_modules/mdast-util-to-hast/lib/handlers/break.js
function hardBreak(state, node2) {
  const result = { type: "element", tagName: "br", properties: {}, children: [] };
  state.patch(node2, result);
  return [state.applyData(node2, result), { type: "text", value: "\n" }];
}

// ../../node_modules/mdast-util-to-hast/lib/handlers/code.js
function code(state, node2) {
  const value = node2.value ? node2.value + "\n" : "";
  const properties = {};
  const language = node2.lang ? node2.lang.split(/\s+/) : [];
  if (language.length > 0) {
    properties.className = ["language-" + language[0]];
  }
  let result = {
    type: "element",
    tagName: "code",
    properties,
    children: [{ type: "text", value }]
  };
  if (node2.meta) {
    result.data = { meta: node2.meta };
  }
  state.patch(node2, result);
  result = state.applyData(node2, result);
  result = { type: "element", tagName: "pre", properties: {}, children: [result] };
  state.patch(node2, result);
  return result;
}

// ../../node_modules/mdast-util-to-hast/lib/handlers/delete.js
function strikethrough(state, node2) {
  const result = {
    type: "element",
    tagName: "del",
    properties: {},
    children: state.all(node2)
  };
  state.patch(node2, result);
  return state.applyData(node2, result);
}

// ../../node_modules/mdast-util-to-hast/lib/handlers/emphasis.js
function emphasis(state, node2) {
  const result = {
    type: "element",
    tagName: "em",
    properties: {},
    children: state.all(node2)
  };
  state.patch(node2, result);
  return state.applyData(node2, result);
}

// ../../node_modules/mdast-util-to-hast/lib/handlers/footnote-reference.js
function footnoteReference(state, node2) {
  const clobberPrefix = typeof state.options.clobberPrefix === "string" ? state.options.clobberPrefix : "user-content-";
  const id = String(node2.identifier).toUpperCase();
  const safeId = normalizeUri(id.toLowerCase());
  const index2 = state.footnoteOrder.indexOf(id);
  let counter;
  let reuseCounter = state.footnoteCounts.get(id);
  if (reuseCounter === void 0) {
    reuseCounter = 0;
    state.footnoteOrder.push(id);
    counter = state.footnoteOrder.length;
  } else {
    counter = index2 + 1;
  }
  reuseCounter += 1;
  state.footnoteCounts.set(id, reuseCounter);
  const link2 = {
    type: "element",
    tagName: "a",
    properties: {
      href: "#" + clobberPrefix + "fn-" + safeId,
      id: clobberPrefix + "fnref-" + safeId + (reuseCounter > 1 ? "-" + reuseCounter : ""),
      dataFootnoteRef: true,
      ariaDescribedBy: ["footnote-label"]
    },
    children: [{ type: "text", value: String(counter) }]
  };
  state.patch(node2, link2);
  const sup = {
    type: "element",
    tagName: "sup",
    properties: {},
    children: [link2]
  };
  state.patch(node2, sup);
  return state.applyData(node2, sup);
}

// ../../node_modules/mdast-util-to-hast/lib/handlers/heading.js
function heading(state, node2) {
  const result = {
    type: "element",
    tagName: "h" + node2.depth,
    properties: {},
    children: state.all(node2)
  };
  state.patch(node2, result);
  return state.applyData(node2, result);
}

// ../../node_modules/mdast-util-to-hast/lib/handlers/html.js
function html3(state, node2) {
  if (state.options.allowDangerousHtml) {
    const result = { type: "raw", value: node2.value };
    state.patch(node2, result);
    return state.applyData(node2, result);
  }
  return void 0;
}

// ../../node_modules/mdast-util-to-hast/lib/revert.js
function revert(state, node2) {
  const subtype = node2.referenceType;
  let suffix = "]";
  if (subtype === "collapsed") {
    suffix += "[]";
  } else if (subtype === "full") {
    suffix += "[" + (node2.label || node2.identifier) + "]";
  }
  if (node2.type === "imageReference") {
    return [{ type: "text", value: "![" + node2.alt + suffix }];
  }
  const contents = state.all(node2);
  const head = contents[0];
  if (head && head.type === "text") {
    head.value = "[" + head.value;
  } else {
    contents.unshift({ type: "text", value: "[" });
  }
  const tail = contents[contents.length - 1];
  if (tail && tail.type === "text") {
    tail.value += suffix;
  } else {
    contents.push({ type: "text", value: suffix });
  }
  return contents;
}

// ../../node_modules/mdast-util-to-hast/lib/handlers/image-reference.js
function imageReference(state, node2) {
  const id = String(node2.identifier).toUpperCase();
  const definition2 = state.definitionById.get(id);
  if (!definition2) {
    return revert(state, node2);
  }
  const properties = { src: normalizeUri(definition2.url || ""), alt: node2.alt };
  if (definition2.title !== null && definition2.title !== void 0) {
    properties.title = definition2.title;
  }
  const result = { type: "element", tagName: "img", properties, children: [] };
  state.patch(node2, result);
  return state.applyData(node2, result);
}

// ../../node_modules/mdast-util-to-hast/lib/handlers/image.js
function image(state, node2) {
  const properties = { src: normalizeUri(node2.url) };
  if (node2.alt !== null && node2.alt !== void 0) {
    properties.alt = node2.alt;
  }
  if (node2.title !== null && node2.title !== void 0) {
    properties.title = node2.title;
  }
  const result = { type: "element", tagName: "img", properties, children: [] };
  state.patch(node2, result);
  return state.applyData(node2, result);
}

// ../../node_modules/mdast-util-to-hast/lib/handlers/inline-code.js
function inlineCode(state, node2) {
  const text5 = { type: "text", value: node2.value.replace(/\r?\n|\r/g, " ") };
  state.patch(node2, text5);
  const result = {
    type: "element",
    tagName: "code",
    properties: {},
    children: [text5]
  };
  state.patch(node2, result);
  return state.applyData(node2, result);
}

// ../../node_modules/mdast-util-to-hast/lib/handlers/link-reference.js
function linkReference(state, node2) {
  const id = String(node2.identifier).toUpperCase();
  const definition2 = state.definitionById.get(id);
  if (!definition2) {
    return revert(state, node2);
  }
  const properties = { href: normalizeUri(definition2.url || "") };
  if (definition2.title !== null && definition2.title !== void 0) {
    properties.title = definition2.title;
  }
  const result = {
    type: "element",
    tagName: "a",
    properties,
    children: state.all(node2)
  };
  state.patch(node2, result);
  return state.applyData(node2, result);
}

// ../../node_modules/mdast-util-to-hast/lib/handlers/link.js
function link(state, node2) {
  const properties = { href: normalizeUri(node2.url) };
  if (node2.title !== null && node2.title !== void 0) {
    properties.title = node2.title;
  }
  const result = {
    type: "element",
    tagName: "a",
    properties,
    children: state.all(node2)
  };
  state.patch(node2, result);
  return state.applyData(node2, result);
}

// ../../node_modules/mdast-util-to-hast/lib/handlers/list-item.js
function listItem(state, node2, parent) {
  const results = state.all(node2);
  const loose = parent ? listLoose(parent) : listItemLoose(node2);
  const properties = {};
  const children = [];
  if (typeof node2.checked === "boolean") {
    const head = results[0];
    let paragraph2;
    if (head && head.type === "element" && head.tagName === "p") {
      paragraph2 = head;
    } else {
      paragraph2 = { type: "element", tagName: "p", properties: {}, children: [] };
      results.unshift(paragraph2);
    }
    if (paragraph2.children.length > 0) {
      paragraph2.children.unshift({ type: "text", value: " " });
    }
    paragraph2.children.unshift({
      type: "element",
      tagName: "input",
      properties: { type: "checkbox", checked: node2.checked, disabled: true },
      children: []
    });
    properties.className = ["task-list-item"];
  }
  let index2 = -1;
  while (++index2 < results.length) {
    const child = results[index2];
    if (loose || index2 !== 0 || child.type !== "element" || child.tagName !== "p") {
      children.push({ type: "text", value: "\n" });
    }
    if (child.type === "element" && child.tagName === "p" && !loose) {
      children.push(...child.children);
    } else {
      children.push(child);
    }
  }
  const tail = results[results.length - 1];
  if (tail && (loose || tail.type !== "element" || tail.tagName !== "p")) {
    children.push({ type: "text", value: "\n" });
  }
  const result = { type: "element", tagName: "li", properties, children };
  state.patch(node2, result);
  return state.applyData(node2, result);
}
function listLoose(node2) {
  let loose = false;
  if (node2.type === "list") {
    loose = node2.spread || false;
    const children = node2.children;
    let index2 = -1;
    while (!loose && ++index2 < children.length) {
      loose = listItemLoose(children[index2]);
    }
  }
  return loose;
}
function listItemLoose(node2) {
  const spread = node2.spread;
  return spread === null || spread === void 0 ? node2.children.length > 1 : spread;
}

// ../../node_modules/mdast-util-to-hast/lib/handlers/list.js
function list2(state, node2) {
  const properties = {};
  const results = state.all(node2);
  let index2 = -1;
  if (typeof node2.start === "number" && node2.start !== 1) {
    properties.start = node2.start;
  }
  while (++index2 < results.length) {
    const child = results[index2];
    if (child.type === "element" && child.tagName === "li" && child.properties && Array.isArray(child.properties.className) && child.properties.className.includes("task-list-item")) {
      properties.className = ["contains-task-list"];
      break;
    }
  }
  const result = {
    type: "element",
    tagName: node2.ordered ? "ol" : "ul",
    properties,
    children: state.wrap(results, true)
  };
  state.patch(node2, result);
  return state.applyData(node2, result);
}

// ../../node_modules/mdast-util-to-hast/lib/handlers/paragraph.js
function paragraph(state, node2) {
  const result = {
    type: "element",
    tagName: "p",
    properties: {},
    children: state.all(node2)
  };
  state.patch(node2, result);
  return state.applyData(node2, result);
}

// ../../node_modules/mdast-util-to-hast/lib/handlers/root.js
function root2(state, node2) {
  const result = { type: "root", children: state.wrap(state.all(node2)) };
  state.patch(node2, result);
  return state.applyData(node2, result);
}

// ../../node_modules/mdast-util-to-hast/lib/handlers/strong.js
function strong(state, node2) {
  const result = {
    type: "element",
    tagName: "strong",
    properties: {},
    children: state.all(node2)
  };
  state.patch(node2, result);
  return state.applyData(node2, result);
}

// ../../node_modules/mdast-util-to-hast/lib/handlers/table.js
function table(state, node2) {
  const rows = state.all(node2);
  const firstRow = rows.shift();
  const tableContent = [];
  if (firstRow) {
    const head = {
      type: "element",
      tagName: "thead",
      properties: {},
      children: state.wrap([firstRow], true)
    };
    state.patch(node2.children[0], head);
    tableContent.push(head);
  }
  if (rows.length > 0) {
    const body = {
      type: "element",
      tagName: "tbody",
      properties: {},
      children: state.wrap(rows, true)
    };
    const start2 = pointStart(node2.children[1]);
    const end = pointEnd(node2.children[node2.children.length - 1]);
    if (start2 && end) body.position = { start: start2, end };
    tableContent.push(body);
  }
  const result = {
    type: "element",
    tagName: "table",
    properties: {},
    children: state.wrap(tableContent, true)
  };
  state.patch(node2, result);
  return state.applyData(node2, result);
}

// ../../node_modules/mdast-util-to-hast/lib/handlers/table-row.js
function tableRow(state, node2, parent) {
  const siblings = parent ? parent.children : void 0;
  const rowIndex = siblings ? siblings.indexOf(node2) : 1;
  const tagName = rowIndex === 0 ? "th" : "td";
  const align = parent && parent.type === "table" ? parent.align : void 0;
  const length = align ? align.length : node2.children.length;
  let cellIndex = -1;
  const cells = [];
  while (++cellIndex < length) {
    const cell = node2.children[cellIndex];
    const properties = {};
    const alignValue = align ? align[cellIndex] : void 0;
    if (alignValue) {
      properties.align = alignValue;
    }
    let result2 = { type: "element", tagName, properties, children: [] };
    if (cell) {
      result2.children = state.all(cell);
      state.patch(cell, result2);
      result2 = state.applyData(cell, result2);
    }
    cells.push(result2);
  }
  const result = {
    type: "element",
    tagName: "tr",
    properties: {},
    children: state.wrap(cells, true)
  };
  state.patch(node2, result);
  return state.applyData(node2, result);
}

// ../../node_modules/mdast-util-to-hast/lib/handlers/table-cell.js
function tableCell(state, node2) {
  const result = {
    type: "element",
    tagName: "td",
    // Assume body cell.
    properties: {},
    children: state.all(node2)
  };
  state.patch(node2, result);
  return state.applyData(node2, result);
}

// ../../node_modules/trim-lines/index.js
var tab = 9;
var space = 32;
function trimLines(value) {
  const source = String(value);
  const search2 = /\r?\n|\r/g;
  let match = search2.exec(source);
  let last = 0;
  const lines = [];
  while (match) {
    lines.push(
      trimLine(source.slice(last, match.index), last > 0, true),
      match[0]
    );
    last = match.index + match[0].length;
    match = search2.exec(source);
  }
  lines.push(trimLine(source.slice(last), last > 0, false));
  return lines.join("");
}
function trimLine(value, start2, end) {
  let startIndex = 0;
  let endIndex = value.length;
  if (start2) {
    let code2 = value.codePointAt(startIndex);
    while (code2 === tab || code2 === space) {
      startIndex++;
      code2 = value.codePointAt(startIndex);
    }
  }
  if (end) {
    let code2 = value.codePointAt(endIndex - 1);
    while (code2 === tab || code2 === space) {
      endIndex--;
      code2 = value.codePointAt(endIndex - 1);
    }
  }
  return endIndex > startIndex ? value.slice(startIndex, endIndex) : "";
}

// ../../node_modules/mdast-util-to-hast/lib/handlers/text.js
function text4(state, node2) {
  const result = { type: "text", value: trimLines(String(node2.value)) };
  state.patch(node2, result);
  return state.applyData(node2, result);
}

// ../../node_modules/mdast-util-to-hast/lib/handlers/thematic-break.js
function thematicBreak2(state, node2) {
  const result = {
    type: "element",
    tagName: "hr",
    properties: {},
    children: []
  };
  state.patch(node2, result);
  return state.applyData(node2, result);
}

// ../../node_modules/mdast-util-to-hast/lib/handlers/index.js
var handlers = {
  blockquote,
  break: hardBreak,
  code,
  delete: strikethrough,
  emphasis,
  footnoteReference,
  heading,
  html: html3,
  imageReference,
  image,
  inlineCode,
  linkReference,
  link,
  listItem,
  list: list2,
  paragraph,
  // @ts-expect-error: root is different, but hard to type.
  root: root2,
  strong,
  table,
  tableCell,
  tableRow,
  text: text4,
  thematicBreak: thematicBreak2,
  toml: ignore,
  yaml: ignore,
  definition: ignore,
  footnoteDefinition: ignore
};
function ignore() {
  return void 0;
}

// ../../node_modules/@ungap/structured-clone/esm/types.js
var VOID = -1;
var PRIMITIVE = 0;
var ARRAY = 1;
var OBJECT = 2;
var DATE = 3;
var REGEXP = 4;
var MAP = 5;
var SET = 6;
var ERROR = 7;
var BIGINT = 8;

// ../../node_modules/@ungap/structured-clone/esm/deserialize.js
var { defineProperty } = Object;
var env = typeof self === "object" ? self : globalThis;
var guard = (name2, init) => {
  switch (name2) {
    case "Function":
    case "SharedWorker":
    case "Worker":
    case "eval":
    case "setInterval":
    case "setTimeout":
      throw new TypeError("unable to deserialize " + name2);
  }
  return new env[name2](init);
};
var deserializer = ($, _) => {
  const as = (out, index2) => {
    $.set(index2, out);
    return out;
  };
  const unpair = (index2) => {
    if ($.has(index2))
      return $.get(index2);
    const [type, value] = _[index2];
    switch (type) {
      case PRIMITIVE:
      case VOID:
        return as(value, index2);
      case ARRAY: {
        const arr = as([], index2);
        for (const index3 of value)
          arr.push(unpair(index3));
        return arr;
      }
      case OBJECT: {
        const object = as({}, index2);
        for (const [key, index3] of value) {
          const k = unpair(key), value2 = unpair(index3);
          if (k === "__proto__") defineProperty(object, k, {
            value: value2,
            configurable: true,
            enumerable: true,
            writable: true
          });
          else object[k] = value2;
        }
        return object;
      }
      case DATE:
        return as(new Date(value), index2);
      case REGEXP: {
        const { source, flags } = value;
        return as(new RegExp(source, flags), index2);
      }
      case MAP: {
        const map = as(/* @__PURE__ */ new Map(), index2);
        for (const [key, index3] of value)
          map.set(unpair(key), unpair(index3));
        return map;
      }
      case SET: {
        const set = as(/* @__PURE__ */ new Set(), index2);
        for (const index3 of value)
          set.add(unpair(index3));
        return set;
      }
      case ERROR: {
        const { name: name2, message } = value;
        return as(
          typeof env[name2] === "function" ? guard(name2, message) : new Error(message),
          index2
        );
      }
      case BIGINT:
        return as(BigInt(value), index2);
      case "BigInt":
        return as(Object(BigInt(value)), index2);
      case "ArrayBuffer":
        return as(new Uint8Array(value).buffer, value);
      case "DataView": {
        const { buffer } = new Uint8Array(value);
        return as(new DataView(buffer), value);
      }
      case "-0":
        return -0;
    }
    return as(guard(type, value), index2);
  };
  return unpair;
};
var deserialize = (serialized) => deserializer(/* @__PURE__ */ new Map(), serialized)(0);

// ../../node_modules/@ungap/structured-clone/esm/serialize.js
var EMPTY = "";
var { toString: toString2 } = {};
var { keys, is } = Object;
var typeOf = (value) => {
  const type = typeof value;
  if (type !== "object" || !value)
    return [PRIMITIVE, type];
  const asString = toString2.call(value).slice(8, -1);
  switch (asString) {
    case "Array":
      return [ARRAY, EMPTY];
    case "Object":
      return [OBJECT, EMPTY];
    case "Date":
      return [DATE, EMPTY];
    case "RegExp":
      return [REGEXP, EMPTY];
    case "Map":
      return [MAP, EMPTY];
    case "Set":
      return [SET, EMPTY];
    case "DataView":
      return [ARRAY, asString];
  }
  if (asString.includes("Array"))
    return [ARRAY, asString];
  if (value instanceof Error)
    return [ERROR, value.name || "Error"];
  return [OBJECT, asString];
};
var shouldSkip = ([TYPE, type]) => TYPE === PRIMITIVE && (type === "function" || type === "symbol");
var serializer = (strict, json, $, _) => {
  const as = (out, value) => {
    const index2 = _.push(out) - 1;
    $.set(value, index2);
    return index2;
  };
  const pair = (value) => {
    if ($.has(value))
      return $.get(value);
    let [TYPE, type] = typeOf(value);
    switch (TYPE) {
      case PRIMITIVE: {
        let entry = value;
        switch (type) {
          case "bigint":
            TYPE = BIGINT;
            entry = value.toString();
            break;
          case "number":
            if (!value && is(value, -0))
              return _.push(["-0"]) - 1;
            break;
          case "function":
          case "symbol":
            if (strict)
              throw new TypeError("unable to serialize " + type);
            entry = null;
            break;
          case "undefined":
            return as([VOID], value);
        }
        return as([TYPE, entry], value);
      }
      case ARRAY: {
        if (type) {
          let spread = value;
          if (type === "DataView") {
            spread = new Uint8Array(value.buffer);
          } else if (type === "ArrayBuffer") {
            spread = new Uint8Array(value);
          }
          return as([type, [...spread]], value);
        }
        const arr = [];
        const index2 = as([TYPE, arr], value);
        for (const entry of value)
          arr.push(pair(entry));
        return index2;
      }
      case OBJECT: {
        if (type) {
          switch (type) {
            case "BigInt":
              return as([type, value.toString()], value);
            case "Boolean":
            case "Number":
            case "String":
              return as([type, value.valueOf()], value);
          }
        }
        if (json && "toJSON" in value)
          return pair(value.toJSON());
        const entries = [];
        const index2 = as([TYPE, entries], value);
        for (const key of keys(value)) {
          if (strict || !shouldSkip(typeOf(value[key])))
            entries.push([pair(key), pair(value[key])]);
        }
        return index2;
      }
      case DATE:
        return as([TYPE, isNaN(value.getTime()) ? EMPTY : value.toISOString()], value);
      case REGEXP: {
        const { source, flags } = value;
        return as([TYPE, { source, flags }], value);
      }
      case MAP: {
        const entries = [];
        const index2 = as([TYPE, entries], value);
        for (const [key, entry] of value) {
          if (strict || !(shouldSkip(typeOf(key)) || shouldSkip(typeOf(entry))))
            entries.push([pair(key), pair(entry)]);
        }
        return index2;
      }
      case SET: {
        const entries = [];
        const index2 = as([TYPE, entries], value);
        for (const entry of value) {
          if (strict || !shouldSkip(typeOf(entry)))
            entries.push(pair(entry));
        }
        return index2;
      }
    }
    const { message } = value;
    return as([TYPE, { name: type, message }], value);
  };
  return pair;
};
var serialize = (value, { json, lossy } = {}) => {
  const _ = [];
  return serializer(!(json || lossy), !!json, /* @__PURE__ */ new Map(), _)(value), _;
};

// ../../node_modules/@ungap/structured-clone/esm/index.js
var esm_default = typeof structuredClone === "function" ? (
  /* c8 ignore start */
  (any, options) => options && ("json" in options || "lossy" in options) ? deserialize(serialize(any, options)) : structuredClone(any)
) : (any, options) => deserialize(serialize(any, options));

// ../../node_modules/mdast-util-to-hast/lib/footer.js
function defaultFootnoteBackContent(_, rereferenceIndex) {
  const result = [{ type: "text", value: "\u21A9" }];
  if (rereferenceIndex > 1) {
    result.push({
      type: "element",
      tagName: "sup",
      properties: {},
      children: [{ type: "text", value: String(rereferenceIndex) }]
    });
  }
  return result;
}
function defaultFootnoteBackLabel(referenceIndex, rereferenceIndex) {
  return "Back to reference " + (referenceIndex + 1) + (rereferenceIndex > 1 ? "-" + rereferenceIndex : "");
}
function footer(state) {
  const clobberPrefix = typeof state.options.clobberPrefix === "string" ? state.options.clobberPrefix : "user-content-";
  const footnoteBackContent = state.options.footnoteBackContent || defaultFootnoteBackContent;
  const footnoteBackLabel = state.options.footnoteBackLabel || defaultFootnoteBackLabel;
  const footnoteLabel = state.options.footnoteLabel || "Footnotes";
  const footnoteLabelTagName = state.options.footnoteLabelTagName || "h2";
  const footnoteLabelProperties = state.options.footnoteLabelProperties || {
    className: ["sr-only"]
  };
  const listItems = [];
  let referenceIndex = -1;
  while (++referenceIndex < state.footnoteOrder.length) {
    const definition2 = state.footnoteById.get(
      state.footnoteOrder[referenceIndex]
    );
    if (!definition2) {
      continue;
    }
    const content3 = state.all(definition2);
    const id = String(definition2.identifier).toUpperCase();
    const safeId = normalizeUri(id.toLowerCase());
    let rereferenceIndex = 0;
    const backReferences = [];
    const counts2 = state.footnoteCounts.get(id);
    while (counts2 !== void 0 && ++rereferenceIndex <= counts2) {
      if (backReferences.length > 0) {
        backReferences.push({ type: "text", value: " " });
      }
      let children = typeof footnoteBackContent === "string" ? footnoteBackContent : footnoteBackContent(referenceIndex, rereferenceIndex);
      if (typeof children === "string") {
        children = { type: "text", value: children };
      }
      backReferences.push({
        type: "element",
        tagName: "a",
        properties: {
          href: "#" + clobberPrefix + "fnref-" + safeId + (rereferenceIndex > 1 ? "-" + rereferenceIndex : ""),
          dataFootnoteBackref: "",
          ariaLabel: typeof footnoteBackLabel === "string" ? footnoteBackLabel : footnoteBackLabel(referenceIndex, rereferenceIndex),
          className: ["data-footnote-backref"]
        },
        children: Array.isArray(children) ? children : [children]
      });
    }
    const tail = content3[content3.length - 1];
    if (tail && tail.type === "element" && tail.tagName === "p") {
      const tailTail = tail.children[tail.children.length - 1];
      if (tailTail && tailTail.type === "text") {
        tailTail.value += " ";
      } else {
        tail.children.push({ type: "text", value: " " });
      }
      tail.children.push(...backReferences);
    } else {
      content3.push(...backReferences);
    }
    const listItem2 = {
      type: "element",
      tagName: "li",
      properties: { id: clobberPrefix + "fn-" + safeId },
      children: state.wrap(content3, true)
    };
    state.patch(definition2, listItem2);
    listItems.push(listItem2);
  }
  if (listItems.length === 0) {
    return;
  }
  return {
    type: "element",
    tagName: "section",
    properties: { dataFootnotes: true, className: ["footnotes"] },
    children: [
      {
        type: "element",
        tagName: footnoteLabelTagName,
        properties: {
          ...esm_default(footnoteLabelProperties),
          id: "footnote-label"
        },
        children: [{ type: "text", value: footnoteLabel }]
      },
      { type: "text", value: "\n" },
      {
        type: "element",
        tagName: "ol",
        properties: {},
        children: state.wrap(listItems, true)
      },
      { type: "text", value: "\n" }
    ]
  };
}

// ../../node_modules/unist-util-is/lib/index.js
var convert = (
  // Note: overloads in JSDoc can’t yet use different `@template`s.
  /**
   * @type {(
   *   (<Condition extends string>(test: Condition) => (node: unknown, index?: number | null | undefined, parent?: Parent | null | undefined, context?: unknown) => node is Node & {type: Condition}) &
   *   (<Condition extends Props>(test: Condition) => (node: unknown, index?: number | null | undefined, parent?: Parent | null | undefined, context?: unknown) => node is Node & Condition) &
   *   (<Condition extends TestFunction>(test: Condition) => (node: unknown, index?: number | null | undefined, parent?: Parent | null | undefined, context?: unknown) => node is Node & Predicate<Condition, Node>) &
   *   ((test?: null | undefined) => (node?: unknown, index?: number | null | undefined, parent?: Parent | null | undefined, context?: unknown) => node is Node) &
   *   ((test?: Test) => Check)
   * )}
   */
  /**
   * @param {Test} [test]
   * @returns {Check}
   */
  (function(test) {
    if (test === null || test === void 0) {
      return ok2;
    }
    if (typeof test === "function") {
      return castFactory(test);
    }
    if (typeof test === "object") {
      return Array.isArray(test) ? anyFactory(test) : (
        // Cast because `ReadonlyArray` goes into the above but `isArray`
        // narrows to `Array`.
        propertiesFactory(
          /** @type {Props} */
          test
        )
      );
    }
    if (typeof test === "string") {
      return typeFactory(test);
    }
    throw new Error("Expected function, string, or object as test");
  })
);
function anyFactory(tests) {
  const checks2 = [];
  let index2 = -1;
  while (++index2 < tests.length) {
    checks2[index2] = convert(tests[index2]);
  }
  return castFactory(any);
  function any(...parameters) {
    let index3 = -1;
    while (++index3 < checks2.length) {
      if (checks2[index3].apply(this, parameters)) return true;
    }
    return false;
  }
}
function propertiesFactory(check) {
  const checkAsRecord = (
    /** @type {Record<string, unknown>} */
    check
  );
  return castFactory(all2);
  function all2(node2) {
    const nodeAsRecord = (
      /** @type {Record<string, unknown>} */
      /** @type {unknown} */
      node2
    );
    let key;
    for (key in check) {
      if (nodeAsRecord[key] !== checkAsRecord[key]) return false;
    }
    return true;
  }
}
function typeFactory(check) {
  return castFactory(type);
  function type(node2) {
    return node2 && node2.type === check;
  }
}
function castFactory(testFunction) {
  return check;
  function check(value, index2, parent) {
    return Boolean(
      looksLikeANode(value) && testFunction.call(
        this,
        value,
        typeof index2 === "number" ? index2 : void 0,
        parent || void 0
      )
    );
  }
}
function ok2() {
  return true;
}
function looksLikeANode(value) {
  return value !== null && typeof value === "object" && "type" in value;
}

// ../../node_modules/unist-util-visit-parents/lib/color.js
function color(d) {
  return d;
}

// ../../node_modules/unist-util-visit-parents/lib/index.js
var empty2 = [];
var CONTINUE = true;
var EXIT = false;
var SKIP = "skip";
function visitParents(tree, test, visitor, reverse) {
  let check;
  if (typeof test === "function" && typeof visitor !== "function") {
    reverse = visitor;
    visitor = test;
  } else {
    check = test;
  }
  const is3 = convert(check);
  const step = reverse ? -1 : 1;
  factory(tree, void 0, [])();
  function factory(node2, index2, parents) {
    const value = (
      /** @type {Record<string, unknown>} */
      node2 && typeof node2 === "object" ? node2 : {}
    );
    if (typeof value.type === "string") {
      const name2 = (
        // `hast`
        typeof value.tagName === "string" ? value.tagName : (
          // `xast`
          typeof value.name === "string" ? value.name : void 0
        )
      );
      Object.defineProperty(visit2, "name", {
        value: "node (" + color(node2.type + (name2 ? "<" + name2 + ">" : "")) + ")"
      });
    }
    return visit2;
    function visit2() {
      let result = empty2;
      let subresult;
      let offset;
      let grandparents;
      if (!test || is3(node2, index2, parents[parents.length - 1] || void 0)) {
        result = toResult(visitor(node2, parents));
        if (result[0] === EXIT) {
          return result;
        }
      }
      if ("children" in node2 && node2.children) {
        const nodeAsParent = (
          /** @type {UnistParent} */
          node2
        );
        if (nodeAsParent.children && result[0] !== SKIP) {
          offset = (reverse ? nodeAsParent.children.length : -1) + step;
          grandparents = parents.concat(nodeAsParent);
          while (offset > -1 && offset < nodeAsParent.children.length) {
            const child = nodeAsParent.children[offset];
            subresult = factory(child, offset, grandparents)();
            if (subresult[0] === EXIT) {
              return subresult;
            }
            offset = typeof subresult[1] === "number" ? subresult[1] : offset + step;
          }
        }
      }
      return result;
    }
  }
}
function toResult(value) {
  if (Array.isArray(value)) {
    return value;
  }
  if (typeof value === "number") {
    return [CONTINUE, value];
  }
  return value === null || value === void 0 ? empty2 : [value];
}

// ../../node_modules/unist-util-visit/lib/index.js
function visit(tree, testOrVisitor, visitorOrReverse, maybeReverse) {
  let reverse;
  let test;
  let visitor;
  if (typeof testOrVisitor === "function" && typeof visitorOrReverse !== "function") {
    test = void 0;
    visitor = testOrVisitor;
    reverse = visitorOrReverse;
  } else {
    test = testOrVisitor;
    visitor = visitorOrReverse;
    reverse = maybeReverse;
  }
  visitParents(tree, test, overload, reverse);
  function overload(node2, parents) {
    const parent = parents[parents.length - 1];
    const index2 = parent ? parent.children.indexOf(node2) : void 0;
    return visitor(node2, index2, parent);
  }
}

// ../../node_modules/mdast-util-to-hast/lib/state.js
var own3 = {}.hasOwnProperty;
var emptyOptions3 = {};
function createState(tree, options) {
  const settings = options || emptyOptions3;
  const definitionById = /* @__PURE__ */ new Map();
  const footnoteById = /* @__PURE__ */ new Map();
  const footnoteCounts = /* @__PURE__ */ new Map();
  const handlers2 = { ...handlers, ...settings.handlers };
  const state = {
    all: all2,
    applyData,
    definitionById,
    footnoteById,
    footnoteCounts,
    footnoteOrder: [],
    handlers: handlers2,
    one: one3,
    options: settings,
    patch,
    wrap
  };
  visit(tree, function(node2) {
    if (node2.type === "definition" || node2.type === "footnoteDefinition") {
      const map = node2.type === "definition" ? definitionById : footnoteById;
      const id = String(node2.identifier).toUpperCase();
      if (!map.has(id)) {
        map.set(id, node2);
      }
    }
  });
  return state;
  function one3(node2, parent) {
    const type = node2.type;
    const handle = state.handlers[type];
    if (own3.call(state.handlers, type) && handle) {
      return handle(state, node2, parent);
    }
    if (state.options.passThrough && state.options.passThrough.includes(type)) {
      if ("children" in node2) {
        const { children, ...shallow } = node2;
        const result = esm_default(shallow);
        result.children = state.all(node2);
        return result;
      }
      return esm_default(node2);
    }
    const unknown = state.options.unknownHandler || defaultUnknownHandler;
    return unknown(state, node2, parent);
  }
  function all2(parent) {
    const values = [];
    if ("children" in parent) {
      const nodes = parent.children;
      let index2 = -1;
      while (++index2 < nodes.length) {
        const result = state.one(nodes[index2], parent);
        if (result) {
          if (index2 && nodes[index2 - 1].type === "break") {
            if (!Array.isArray(result) && result.type === "text") {
              result.value = trimMarkdownSpaceStart(result.value);
            }
            if (!Array.isArray(result) && result.type === "element") {
              const head = result.children[0];
              if (head && head.type === "text") {
                head.value = trimMarkdownSpaceStart(head.value);
              }
            }
          }
          if (Array.isArray(result)) {
            values.push(...result);
          } else {
            values.push(result);
          }
        }
      }
    }
    return values;
  }
}
function patch(from, to) {
  if (from.position) to.position = position(from);
}
function applyData(from, to) {
  let result = to;
  if (from && from.data) {
    const hName = from.data.hName;
    const hChildren = from.data.hChildren;
    const hProperties = from.data.hProperties;
    if (typeof hName === "string") {
      if (result.type === "element") {
        result.tagName = hName;
      } else {
        const children = "children" in result ? result.children : [result];
        result = { type: "element", tagName: hName, properties: {}, children };
      }
    }
    if (result.type === "element" && hProperties) {
      Object.assign(result.properties, esm_default(hProperties));
    }
    if ("children" in result && result.children && hChildren !== null && hChildren !== void 0) {
      result.children = hChildren;
    }
  }
  return result;
}
function defaultUnknownHandler(state, node2) {
  const data = node2.data || {};
  const result = "value" in node2 && !(own3.call(data, "hProperties") || own3.call(data, "hChildren")) ? { type: "text", value: node2.value } : {
    type: "element",
    tagName: "div",
    properties: {},
    children: state.all(node2)
  };
  state.patch(node2, result);
  return state.applyData(node2, result);
}
function wrap(nodes, loose) {
  const result = [];
  let index2 = -1;
  if (loose) {
    result.push({ type: "text", value: "\n" });
  }
  while (++index2 < nodes.length) {
    if (index2) result.push({ type: "text", value: "\n" });
    result.push(nodes[index2]);
  }
  if (loose && nodes.length > 0) {
    result.push({ type: "text", value: "\n" });
  }
  return result;
}
function trimMarkdownSpaceStart(value) {
  let index2 = 0;
  let code2 = value.charCodeAt(index2);
  while (code2 === 9 || code2 === 32) {
    index2++;
    code2 = value.charCodeAt(index2);
  }
  return value.slice(index2);
}

// ../../node_modules/mdast-util-to-hast/lib/index.js
function toHast(tree, options) {
  const state = createState(tree, options);
  const node2 = state.one(tree, void 0);
  const foot = footer(state);
  const result = Array.isArray(node2) ? { type: "root", children: node2 } : node2 || { type: "root", children: [] };
  if (foot) {
    ok("children" in result);
    result.children.push({ type: "text", value: "\n" }, foot);
  }
  return result;
}

// ../../node_modules/remark-rehype/lib/index.js
function remarkRehype(destination, options) {
  if (destination && "run" in destination) {
    return async function(tree, file) {
      const hastTree = (
        /** @type {HastRoot} */
        toHast(tree, { file, ...options })
      );
      await destination.run(hastTree, file);
    };
  }
  return function(tree, file) {
    return (
      /** @type {HastRoot} */
      toHast(tree, { file, ...destination || options })
    );
  };
}

// ../../node_modules/bail/index.js
function bail(error) {
  if (error) {
    throw error;
  }
}

// ../../node_modules/unified/lib/index.js
var import_extend = __toESM(require_extend(), 1);

// ../../node_modules/is-plain-obj/index.js
function isPlainObject(value) {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return (prototype === null || prototype === Object.prototype || Object.getPrototypeOf(prototype) === null) && !(Symbol.toStringTag in value) && !(Symbol.iterator in value);
}

// ../../node_modules/trough/lib/index.js
function trough() {
  const fns = [];
  const pipeline = { run, use };
  return pipeline;
  function run(...values) {
    let middlewareIndex = -1;
    const callback = values.pop();
    if (typeof callback !== "function") {
      throw new TypeError("Expected function as last argument, not " + callback);
    }
    next(null, ...values);
    function next(error, ...output) {
      const fn = fns[++middlewareIndex];
      let index2 = -1;
      if (error) {
        callback(error);
        return;
      }
      while (++index2 < values.length) {
        if (output[index2] === null || output[index2] === void 0) {
          output[index2] = values[index2];
        }
      }
      values = output;
      if (fn) {
        wrap2(fn, next)(...output);
      } else {
        callback(null, ...output);
      }
    }
  }
  function use(middelware) {
    if (typeof middelware !== "function") {
      throw new TypeError(
        "Expected `middelware` to be a function, not " + middelware
      );
    }
    fns.push(middelware);
    return pipeline;
  }
}
function wrap2(middleware, callback) {
  let called;
  return wrapped;
  function wrapped(...parameters) {
    const fnExpectsCallback = middleware.length > parameters.length;
    let result;
    if (fnExpectsCallback) {
      parameters.push(done);
    }
    try {
      result = middleware.apply(this, parameters);
    } catch (error) {
      const exception = (
        /** @type {Error} */
        error
      );
      if (fnExpectsCallback && called) {
        throw exception;
      }
      return done(exception);
    }
    if (!fnExpectsCallback) {
      if (result && result.then && typeof result.then === "function") {
        result.then(then, done);
      } else if (result instanceof Error) {
        done(result);
      } else {
        then(result);
      }
    }
  }
  function done(error, ...output) {
    if (!called) {
      called = true;
      callback(error, ...output);
    }
  }
  function then(value) {
    done(null, value);
  }
}

// ../../node_modules/vfile/lib/minpath.browser.js
var minpath = { basename, dirname, extname, join, sep: "/" };
function basename(path, extname2) {
  if (extname2 !== void 0 && typeof extname2 !== "string") {
    throw new TypeError('"ext" argument must be a string');
  }
  assertPath(path);
  let start2 = 0;
  let end = -1;
  let index2 = path.length;
  let seenNonSlash;
  if (extname2 === void 0 || extname2.length === 0 || extname2.length > path.length) {
    while (index2--) {
      if (path.codePointAt(index2) === 47) {
        if (seenNonSlash) {
          start2 = index2 + 1;
          break;
        }
      } else if (end < 0) {
        seenNonSlash = true;
        end = index2 + 1;
      }
    }
    return end < 0 ? "" : path.slice(start2, end);
  }
  if (extname2 === path) {
    return "";
  }
  let firstNonSlashEnd = -1;
  let extnameIndex = extname2.length - 1;
  while (index2--) {
    if (path.codePointAt(index2) === 47) {
      if (seenNonSlash) {
        start2 = index2 + 1;
        break;
      }
    } else {
      if (firstNonSlashEnd < 0) {
        seenNonSlash = true;
        firstNonSlashEnd = index2 + 1;
      }
      if (extnameIndex > -1) {
        if (path.codePointAt(index2) === extname2.codePointAt(extnameIndex--)) {
          if (extnameIndex < 0) {
            end = index2;
          }
        } else {
          extnameIndex = -1;
          end = firstNonSlashEnd;
        }
      }
    }
  }
  if (start2 === end) {
    end = firstNonSlashEnd;
  } else if (end < 0) {
    end = path.length;
  }
  return path.slice(start2, end);
}
function dirname(path) {
  assertPath(path);
  if (path.length === 0) {
    return ".";
  }
  let end = -1;
  let index2 = path.length;
  let unmatchedSlash;
  while (--index2) {
    if (path.codePointAt(index2) === 47) {
      if (unmatchedSlash) {
        end = index2;
        break;
      }
    } else if (!unmatchedSlash) {
      unmatchedSlash = true;
    }
  }
  return end < 0 ? path.codePointAt(0) === 47 ? "/" : "." : end === 1 && path.codePointAt(0) === 47 ? "//" : path.slice(0, end);
}
function extname(path) {
  assertPath(path);
  let index2 = path.length;
  let end = -1;
  let startPart = 0;
  let startDot = -1;
  let preDotState = 0;
  let unmatchedSlash;
  while (index2--) {
    const code2 = path.codePointAt(index2);
    if (code2 === 47) {
      if (unmatchedSlash) {
        startPart = index2 + 1;
        break;
      }
      continue;
    }
    if (end < 0) {
      unmatchedSlash = true;
      end = index2 + 1;
    }
    if (code2 === 46) {
      if (startDot < 0) {
        startDot = index2;
      } else if (preDotState !== 1) {
        preDotState = 1;
      }
    } else if (startDot > -1) {
      preDotState = -1;
    }
  }
  if (startDot < 0 || end < 0 || // We saw a non-dot character immediately before the dot.
  preDotState === 0 || // The (right-most) trimmed path component is exactly `..`.
  preDotState === 1 && startDot === end - 1 && startDot === startPart + 1) {
    return "";
  }
  return path.slice(startDot, end);
}
function join(...segments) {
  let index2 = -1;
  let joined;
  while (++index2 < segments.length) {
    assertPath(segments[index2]);
    if (segments[index2]) {
      joined = joined === void 0 ? segments[index2] : joined + "/" + segments[index2];
    }
  }
  return joined === void 0 ? "." : normalize2(joined);
}
function normalize2(path) {
  assertPath(path);
  const absolute = path.codePointAt(0) === 47;
  let value = normalizeString(path, !absolute);
  if (value.length === 0 && !absolute) {
    value = ".";
  }
  if (value.length > 0 && path.codePointAt(path.length - 1) === 47) {
    value += "/";
  }
  return absolute ? "/" + value : value;
}
function normalizeString(path, allowAboveRoot) {
  let result = "";
  let lastSegmentLength = 0;
  let lastSlash = -1;
  let dots = 0;
  let index2 = -1;
  let code2;
  let lastSlashIndex;
  while (++index2 <= path.length) {
    if (index2 < path.length) {
      code2 = path.codePointAt(index2);
    } else if (code2 === 47) {
      break;
    } else {
      code2 = 47;
    }
    if (code2 === 47) {
      if (lastSlash === index2 - 1 || dots === 1) {
      } else if (lastSlash !== index2 - 1 && dots === 2) {
        if (result.length < 2 || lastSegmentLength !== 2 || result.codePointAt(result.length - 1) !== 46 || result.codePointAt(result.length - 2) !== 46) {
          if (result.length > 2) {
            lastSlashIndex = result.lastIndexOf("/");
            if (lastSlashIndex !== result.length - 1) {
              if (lastSlashIndex < 0) {
                result = "";
                lastSegmentLength = 0;
              } else {
                result = result.slice(0, lastSlashIndex);
                lastSegmentLength = result.length - 1 - result.lastIndexOf("/");
              }
              lastSlash = index2;
              dots = 0;
              continue;
            }
          } else if (result.length > 0) {
            result = "";
            lastSegmentLength = 0;
            lastSlash = index2;
            dots = 0;
            continue;
          }
        }
        if (allowAboveRoot) {
          result = result.length > 0 ? result + "/.." : "..";
          lastSegmentLength = 2;
        }
      } else {
        if (result.length > 0) {
          result += "/" + path.slice(lastSlash + 1, index2);
        } else {
          result = path.slice(lastSlash + 1, index2);
        }
        lastSegmentLength = index2 - lastSlash - 1;
      }
      lastSlash = index2;
      dots = 0;
    } else if (code2 === 46 && dots > -1) {
      dots++;
    } else {
      dots = -1;
    }
  }
  return result;
}
function assertPath(path) {
  if (typeof path !== "string") {
    throw new TypeError(
      "Path must be a string. Received " + JSON.stringify(path)
    );
  }
}

// ../../node_modules/vfile/lib/minproc.browser.js
var minproc = { cwd };
function cwd() {
  return "/";
}

// ../../node_modules/vfile/lib/minurl.shared.js
function isUrl(fileUrlOrPath) {
  return Boolean(
    fileUrlOrPath !== null && typeof fileUrlOrPath === "object" && "href" in fileUrlOrPath && fileUrlOrPath.href && "protocol" in fileUrlOrPath && fileUrlOrPath.protocol && // @ts-expect-error: indexing is fine.
    fileUrlOrPath.auth === void 0
  );
}

// ../../node_modules/vfile/lib/minurl.browser.js
function urlToPath(path) {
  if (typeof path === "string") {
    path = new URL(path);
  } else if (!isUrl(path)) {
    const error = new TypeError(
      'The "path" argument must be of type string or an instance of URL. Received `' + path + "`"
    );
    error.code = "ERR_INVALID_ARG_TYPE";
    throw error;
  }
  if (path.protocol !== "file:") {
    const error = new TypeError("The URL must be of scheme file");
    error.code = "ERR_INVALID_URL_SCHEME";
    throw error;
  }
  return getPathFromURLPosix(path);
}
function getPathFromURLPosix(url) {
  if (url.hostname !== "") {
    const error = new TypeError(
      'File URL host must be "localhost" or empty on darwin'
    );
    error.code = "ERR_INVALID_FILE_URL_HOST";
    throw error;
  }
  const pathname = url.pathname;
  let index2 = -1;
  while (++index2 < pathname.length) {
    if (pathname.codePointAt(index2) === 37 && pathname.codePointAt(index2 + 1) === 50) {
      const third = pathname.codePointAt(index2 + 2);
      if (third === 70 || third === 102) {
        const error = new TypeError(
          "File URL path must not include encoded / characters"
        );
        error.code = "ERR_INVALID_FILE_URL_PATH";
        throw error;
      }
    }
  }
  return decodeURIComponent(pathname);
}

// ../../node_modules/vfile/lib/index.js
var order2 = (
  /** @type {const} */
  [
    "history",
    "path",
    "basename",
    "stem",
    "extname",
    "dirname"
  ]
);
var VFile = class {
  /**
   * Create a new virtual file.
   *
   * `options` is treated as:
   *
   * *   `string` or `Uint8Array` — `{value: options}`
   * *   `URL` — `{path: options}`
   * *   `VFile` — shallow copies its data over to the new file
   * *   `object` — all fields are shallow copied over to the new file
   *
   * Path related fields are set in the following order (least specific to
   * most specific): `history`, `path`, `basename`, `stem`, `extname`,
   * `dirname`.
   *
   * You cannot set `dirname` or `extname` without setting either `history`,
   * `path`, `basename`, or `stem` too.
   *
   * @param {Compatible | null | undefined} [value]
   *   File value.
   * @returns
   *   New instance.
   */
  constructor(value) {
    let options;
    if (!value) {
      options = {};
    } else if (isUrl(value)) {
      options = { path: value };
    } else if (typeof value === "string" || isUint8Array(value)) {
      options = { value };
    } else {
      options = value;
    }
    this.cwd = "cwd" in options ? "" : minproc.cwd();
    this.data = {};
    this.history = [];
    this.messages = [];
    this.value;
    this.map;
    this.result;
    this.stored;
    let index2 = -1;
    while (++index2 < order2.length) {
      const field2 = order2[index2];
      if (field2 in options && options[field2] !== void 0 && options[field2] !== null) {
        this[field2] = field2 === "history" ? [...options[field2]] : options[field2];
      }
    }
    let field;
    for (field in options) {
      if (!order2.includes(field)) {
        this[field] = options[field];
      }
    }
  }
  /**
   * Get the basename (including extname) (example: `'index.min.js'`).
   *
   * @returns {string | undefined}
   *   Basename.
   */
  get basename() {
    return typeof this.path === "string" ? minpath.basename(this.path) : void 0;
  }
  /**
   * Set basename (including extname) (`'index.min.js'`).
   *
   * Cannot contain path separators (`'/'` on unix, macOS, and browsers, `'\'`
   * on windows).
   * Cannot be nullified (use `file.path = file.dirname` instead).
   *
   * @param {string} basename
   *   Basename.
   * @returns {undefined}
   *   Nothing.
   */
  set basename(basename2) {
    assertNonEmpty(basename2, "basename");
    assertPart(basename2, "basename");
    this.path = minpath.join(this.dirname || "", basename2);
  }
  /**
   * Get the parent path (example: `'~'`).
   *
   * @returns {string | undefined}
   *   Dirname.
   */
  get dirname() {
    return typeof this.path === "string" ? minpath.dirname(this.path) : void 0;
  }
  /**
   * Set the parent path (example: `'~'`).
   *
   * Cannot be set if there’s no `path` yet.
   *
   * @param {string | undefined} dirname
   *   Dirname.
   * @returns {undefined}
   *   Nothing.
   */
  set dirname(dirname2) {
    assertPath2(this.basename, "dirname");
    this.path = minpath.join(dirname2 || "", this.basename);
  }
  /**
   * Get the extname (including dot) (example: `'.js'`).
   *
   * @returns {string | undefined}
   *   Extname.
   */
  get extname() {
    return typeof this.path === "string" ? minpath.extname(this.path) : void 0;
  }
  /**
   * Set the extname (including dot) (example: `'.js'`).
   *
   * Cannot contain path separators (`'/'` on unix, macOS, and browsers, `'\'`
   * on windows).
   * Cannot be set if there’s no `path` yet.
   *
   * @param {string | undefined} extname
   *   Extname.
   * @returns {undefined}
   *   Nothing.
   */
  set extname(extname2) {
    assertPart(extname2, "extname");
    assertPath2(this.dirname, "extname");
    if (extname2) {
      if (extname2.codePointAt(0) !== 46) {
        throw new Error("`extname` must start with `.`");
      }
      if (extname2.includes(".", 1)) {
        throw new Error("`extname` cannot contain multiple dots");
      }
    }
    this.path = minpath.join(this.dirname, this.stem + (extname2 || ""));
  }
  /**
   * Get the full path (example: `'~/index.min.js'`).
   *
   * @returns {string}
   *   Path.
   */
  get path() {
    return this.history[this.history.length - 1];
  }
  /**
   * Set the full path (example: `'~/index.min.js'`).
   *
   * Cannot be nullified.
   * You can set a file URL (a `URL` object with a `file:` protocol) which will
   * be turned into a path with `url.fileURLToPath`.
   *
   * @param {URL | string} path
   *   Path.
   * @returns {undefined}
   *   Nothing.
   */
  set path(path) {
    if (isUrl(path)) {
      path = urlToPath(path);
    }
    assertNonEmpty(path, "path");
    if (this.path !== path) {
      this.history.push(path);
    }
  }
  /**
   * Get the stem (basename w/o extname) (example: `'index.min'`).
   *
   * @returns {string | undefined}
   *   Stem.
   */
  get stem() {
    return typeof this.path === "string" ? minpath.basename(this.path, this.extname) : void 0;
  }
  /**
   * Set the stem (basename w/o extname) (example: `'index.min'`).
   *
   * Cannot contain path separators (`'/'` on unix, macOS, and browsers, `'\'`
   * on windows).
   * Cannot be nullified (use `file.path = file.dirname` instead).
   *
   * @param {string} stem
   *   Stem.
   * @returns {undefined}
   *   Nothing.
   */
  set stem(stem) {
    assertNonEmpty(stem, "stem");
    assertPart(stem, "stem");
    this.path = minpath.join(this.dirname || "", stem + (this.extname || ""));
  }
  // Normal prototypal methods.
  /**
   * Create a fatal message for `reason` associated with the file.
   *
   * The `fatal` field of the message is set to `true` (error; file not usable)
   * and the `file` field is set to the current file path.
   * The message is added to the `messages` field on `file`.
   *
   * > 🪦 **Note**: also has obsolete signatures.
   *
   * @overload
   * @param {string} reason
   * @param {MessageOptions | null | undefined} [options]
   * @returns {never}
   *
   * @overload
   * @param {string} reason
   * @param {Node | NodeLike | null | undefined} parent
   * @param {string | null | undefined} [origin]
   * @returns {never}
   *
   * @overload
   * @param {string} reason
   * @param {Point | Position | null | undefined} place
   * @param {string | null | undefined} [origin]
   * @returns {never}
   *
   * @overload
   * @param {string} reason
   * @param {string | null | undefined} [origin]
   * @returns {never}
   *
   * @overload
   * @param {Error | VFileMessage} cause
   * @param {Node | NodeLike | null | undefined} parent
   * @param {string | null | undefined} [origin]
   * @returns {never}
   *
   * @overload
   * @param {Error | VFileMessage} cause
   * @param {Point | Position | null | undefined} place
   * @param {string | null | undefined} [origin]
   * @returns {never}
   *
   * @overload
   * @param {Error | VFileMessage} cause
   * @param {string | null | undefined} [origin]
   * @returns {never}
   *
   * @param {Error | VFileMessage | string} causeOrReason
   *   Reason for message, should use markdown.
   * @param {Node | NodeLike | MessageOptions | Point | Position | string | null | undefined} [optionsOrParentOrPlace]
   *   Configuration (optional).
   * @param {string | null | undefined} [origin]
   *   Place in code where the message originates (example:
   *   `'my-package:my-rule'` or `'my-rule'`).
   * @returns {never}
   *   Never.
   * @throws {VFileMessage}
   *   Message.
   */
  fail(causeOrReason, optionsOrParentOrPlace, origin) {
    const message = this.message(causeOrReason, optionsOrParentOrPlace, origin);
    message.fatal = true;
    throw message;
  }
  /**
   * Create an info message for `reason` associated with the file.
   *
   * The `fatal` field of the message is set to `undefined` (info; change
   * likely not needed) and the `file` field is set to the current file path.
   * The message is added to the `messages` field on `file`.
   *
   * > 🪦 **Note**: also has obsolete signatures.
   *
   * @overload
   * @param {string} reason
   * @param {MessageOptions | null | undefined} [options]
   * @returns {VFileMessage}
   *
   * @overload
   * @param {string} reason
   * @param {Node | NodeLike | null | undefined} parent
   * @param {string | null | undefined} [origin]
   * @returns {VFileMessage}
   *
   * @overload
   * @param {string} reason
   * @param {Point | Position | null | undefined} place
   * @param {string | null | undefined} [origin]
   * @returns {VFileMessage}
   *
   * @overload
   * @param {string} reason
   * @param {string | null | undefined} [origin]
   * @returns {VFileMessage}
   *
   * @overload
   * @param {Error | VFileMessage} cause
   * @param {Node | NodeLike | null | undefined} parent
   * @param {string | null | undefined} [origin]
   * @returns {VFileMessage}
   *
   * @overload
   * @param {Error | VFileMessage} cause
   * @param {Point | Position | null | undefined} place
   * @param {string | null | undefined} [origin]
   * @returns {VFileMessage}
   *
   * @overload
   * @param {Error | VFileMessage} cause
   * @param {string | null | undefined} [origin]
   * @returns {VFileMessage}
   *
   * @param {Error | VFileMessage | string} causeOrReason
   *   Reason for message, should use markdown.
   * @param {Node | NodeLike | MessageOptions | Point | Position | string | null | undefined} [optionsOrParentOrPlace]
   *   Configuration (optional).
   * @param {string | null | undefined} [origin]
   *   Place in code where the message originates (example:
   *   `'my-package:my-rule'` or `'my-rule'`).
   * @returns {VFileMessage}
   *   Message.
   */
  info(causeOrReason, optionsOrParentOrPlace, origin) {
    const message = this.message(causeOrReason, optionsOrParentOrPlace, origin);
    message.fatal = void 0;
    return message;
  }
  /**
   * Create a message for `reason` associated with the file.
   *
   * The `fatal` field of the message is set to `false` (warning; change may be
   * needed) and the `file` field is set to the current file path.
   * The message is added to the `messages` field on `file`.
   *
   * > 🪦 **Note**: also has obsolete signatures.
   *
   * @overload
   * @param {string} reason
   * @param {MessageOptions | null | undefined} [options]
   * @returns {VFileMessage}
   *
   * @overload
   * @param {string} reason
   * @param {Node | NodeLike | null | undefined} parent
   * @param {string | null | undefined} [origin]
   * @returns {VFileMessage}
   *
   * @overload
   * @param {string} reason
   * @param {Point | Position | null | undefined} place
   * @param {string | null | undefined} [origin]
   * @returns {VFileMessage}
   *
   * @overload
   * @param {string} reason
   * @param {string | null | undefined} [origin]
   * @returns {VFileMessage}
   *
   * @overload
   * @param {Error | VFileMessage} cause
   * @param {Node | NodeLike | null | undefined} parent
   * @param {string | null | undefined} [origin]
   * @returns {VFileMessage}
   *
   * @overload
   * @param {Error | VFileMessage} cause
   * @param {Point | Position | null | undefined} place
   * @param {string | null | undefined} [origin]
   * @returns {VFileMessage}
   *
   * @overload
   * @param {Error | VFileMessage} cause
   * @param {string | null | undefined} [origin]
   * @returns {VFileMessage}
   *
   * @param {Error | VFileMessage | string} causeOrReason
   *   Reason for message, should use markdown.
   * @param {Node | NodeLike | MessageOptions | Point | Position | string | null | undefined} [optionsOrParentOrPlace]
   *   Configuration (optional).
   * @param {string | null | undefined} [origin]
   *   Place in code where the message originates (example:
   *   `'my-package:my-rule'` or `'my-rule'`).
   * @returns {VFileMessage}
   *   Message.
   */
  message(causeOrReason, optionsOrParentOrPlace, origin) {
    const message = new VFileMessage(
      // @ts-expect-error: the overloads are fine.
      causeOrReason,
      optionsOrParentOrPlace,
      origin
    );
    if (this.path) {
      message.name = this.path + ":" + message.name;
      message.file = this.path;
    }
    message.fatal = false;
    this.messages.push(message);
    return message;
  }
  /**
   * Serialize the file.
   *
   * > **Note**: which encodings are supported depends on the engine.
   * > For info on Node.js, see:
   * > <https://nodejs.org/api/util.html#whatwg-supported-encodings>.
   *
   * @param {string | null | undefined} [encoding='utf8']
   *   Character encoding to understand `value` as when it’s a `Uint8Array`
   *   (default: `'utf-8'`).
   * @returns {string}
   *   Serialized file.
   */
  toString(encoding) {
    if (this.value === void 0) {
      return "";
    }
    if (typeof this.value === "string") {
      return this.value;
    }
    const decoder = new TextDecoder(encoding || void 0);
    return decoder.decode(this.value);
  }
};
function assertPart(part, name2) {
  if (part && part.includes(minpath.sep)) {
    throw new Error(
      "`" + name2 + "` cannot be a path: did not expect `" + minpath.sep + "`"
    );
  }
}
function assertNonEmpty(part, name2) {
  if (!part) {
    throw new Error("`" + name2 + "` cannot be empty");
  }
}
function assertPath2(path, name2) {
  if (!path) {
    throw new Error("Setting `" + name2 + "` requires `path` to be set too");
  }
}
function isUint8Array(value) {
  return Boolean(
    value && typeof value === "object" && "byteLength" in value && "byteOffset" in value
  );
}

// ../../node_modules/unified/lib/callable-instance.js
var CallableInstance = (
  /**
   * @type {new <Parameters extends Array<unknown>, Result>(property: string | symbol) => (...parameters: Parameters) => Result}
   */
  /** @type {unknown} */
  /**
   * @this {Function}
   * @param {string | symbol} property
   * @returns {(...parameters: Array<unknown>) => unknown}
   */
  (function(property) {
    const self2 = this;
    const constr = self2.constructor;
    const proto = (
      /** @type {Record<string | symbol, Function>} */
      // Prototypes do exist.
      // type-coverage:ignore-next-line
      constr.prototype
    );
    const value = proto[property];
    const apply2 = function() {
      return value.apply(apply2, arguments);
    };
    Object.setPrototypeOf(apply2, proto);
    return apply2;
  })
);

// ../../node_modules/unified/lib/index.js
var own4 = {}.hasOwnProperty;
var Processor = class _Processor extends CallableInstance {
  /**
   * Create a processor.
   */
  constructor() {
    super("copy");
    this.Compiler = void 0;
    this.Parser = void 0;
    this.attachers = [];
    this.compiler = void 0;
    this.freezeIndex = -1;
    this.frozen = void 0;
    this.namespace = {};
    this.parser = void 0;
    this.transformers = trough();
  }
  /**
   * Copy a processor.
   *
   * @deprecated
   *   This is a private internal method and should not be used.
   * @returns {Processor<ParseTree, HeadTree, TailTree, CompileTree, CompileResult>}
   *   New *unfrozen* processor ({@linkcode Processor}) that is
   *   configured to work the same as its ancestor.
   *   When the descendant processor is configured in the future it does not
   *   affect the ancestral processor.
   */
  copy() {
    const destination = (
      /** @type {Processor<ParseTree, HeadTree, TailTree, CompileTree, CompileResult>} */
      new _Processor()
    );
    let index2 = -1;
    while (++index2 < this.attachers.length) {
      const attacher = this.attachers[index2];
      destination.use(...attacher);
    }
    destination.data((0, import_extend.default)(true, {}, this.namespace));
    return destination;
  }
  /**
   * Configure the processor with info available to all plugins.
   * Information is stored in an object.
   *
   * Typically, options can be given to a specific plugin, but sometimes it
   * makes sense to have information shared with several plugins.
   * For example, a list of HTML elements that are self-closing, which is
   * needed during all phases.
   *
   * > **Note**: setting information cannot occur on *frozen* processors.
   * > Call the processor first to create a new unfrozen processor.
   *
   * > **Note**: to register custom data in TypeScript, augment the
   * > {@linkcode Data} interface.
   *
   * @example
   *   This example show how to get and set info:
   *
   *   ```js
   *   import {unified} from 'unified'
   *
   *   const processor = unified().data('alpha', 'bravo')
   *
   *   processor.data('alpha') // => 'bravo'
   *
   *   processor.data() // => {alpha: 'bravo'}
   *
   *   processor.data({charlie: 'delta'})
   *
   *   processor.data() // => {charlie: 'delta'}
   *   ```
   *
   * @template {keyof Data} Key
   *
   * @overload
   * @returns {Data}
   *
   * @overload
   * @param {Data} dataset
   * @returns {Processor<ParseTree, HeadTree, TailTree, CompileTree, CompileResult>}
   *
   * @overload
   * @param {Key} key
   * @returns {Data[Key]}
   *
   * @overload
   * @param {Key} key
   * @param {Data[Key]} value
   * @returns {Processor<ParseTree, HeadTree, TailTree, CompileTree, CompileResult>}
   *
   * @param {Data | Key} [key]
   *   Key to get or set, or entire dataset to set, or nothing to get the
   *   entire dataset (optional).
   * @param {Data[Key]} [value]
   *   Value to set (optional).
   * @returns {unknown}
   *   The current processor when setting, the value at `key` when getting, or
   *   the entire dataset when getting without key.
   */
  data(key, value) {
    if (typeof key === "string") {
      if (arguments.length === 2) {
        assertUnfrozen("data", this.frozen);
        this.namespace[key] = value;
        return this;
      }
      return own4.call(this.namespace, key) && this.namespace[key] || void 0;
    }
    if (key) {
      assertUnfrozen("data", this.frozen);
      this.namespace = key;
      return this;
    }
    return this.namespace;
  }
  /**
   * Freeze a processor.
   *
   * Frozen processors are meant to be extended and not to be configured
   * directly.
   *
   * When a processor is frozen it cannot be unfrozen.
   * New processors working the same way can be created by calling the
   * processor.
   *
   * It’s possible to freeze processors explicitly by calling `.freeze()`.
   * Processors freeze automatically when `.parse()`, `.run()`, `.runSync()`,
   * `.stringify()`, `.process()`, or `.processSync()` are called.
   *
   * @returns {Processor<ParseTree, HeadTree, TailTree, CompileTree, CompileResult>}
   *   The current processor.
   */
  freeze() {
    if (this.frozen) {
      return this;
    }
    const self2 = (
      /** @type {Processor} */
      /** @type {unknown} */
      this
    );
    while (++this.freezeIndex < this.attachers.length) {
      const [attacher, ...options] = this.attachers[this.freezeIndex];
      if (options[0] === false) {
        continue;
      }
      if (options[0] === true) {
        options[0] = void 0;
      }
      const transformer = attacher.call(self2, ...options);
      if (typeof transformer === "function") {
        this.transformers.use(transformer);
      }
    }
    this.frozen = true;
    this.freezeIndex = Number.POSITIVE_INFINITY;
    return this;
  }
  /**
   * Parse text to a syntax tree.
   *
   * > **Note**: `parse` freezes the processor if not already *frozen*.
   *
   * > **Note**: `parse` performs the parse phase, not the run phase or other
   * > phases.
   *
   * @param {Compatible | undefined} [file]
   *   file to parse (optional); typically `string` or `VFile`; any value
   *   accepted as `x` in `new VFile(x)`.
   * @returns {ParseTree extends undefined ? Node : ParseTree}
   *   Syntax tree representing `file`.
   */
  parse(file) {
    this.freeze();
    const realFile = vfile(file);
    const parser = this.parser || this.Parser;
    assertParser("parse", parser);
    return parser(String(realFile), realFile);
  }
  /**
   * Process the given file as configured on the processor.
   *
   * > **Note**: `process` freezes the processor if not already *frozen*.
   *
   * > **Note**: `process` performs the parse, run, and stringify phases.
   *
   * @overload
   * @param {Compatible | undefined} file
   * @param {ProcessCallback<VFileWithOutput<CompileResult>>} done
   * @returns {undefined}
   *
   * @overload
   * @param {Compatible | undefined} [file]
   * @returns {Promise<VFileWithOutput<CompileResult>>}
   *
   * @param {Compatible | undefined} [file]
   *   File (optional); typically `string` or `VFile`]; any value accepted as
   *   `x` in `new VFile(x)`.
   * @param {ProcessCallback<VFileWithOutput<CompileResult>> | undefined} [done]
   *   Callback (optional).
   * @returns {Promise<VFile> | undefined}
   *   Nothing if `done` is given.
   *   Otherwise a promise, rejected with a fatal error or resolved with the
   *   processed file.
   *
   *   The parsed, transformed, and compiled value is available at
   *   `file.value` (see note).
   *
   *   > **Note**: unified typically compiles by serializing: most
   *   > compilers return `string` (or `Uint8Array`).
   *   > Some compilers, such as the one configured with
   *   > [`rehype-react`][rehype-react], return other values (in this case, a
   *   > React tree).
   *   > If you’re using a compiler that doesn’t serialize, expect different
   *   > result values.
   *   >
   *   > To register custom results in TypeScript, add them to
   *   > {@linkcode CompileResultMap}.
   *
   *   [rehype-react]: https://github.com/rehypejs/rehype-react
   */
  process(file, done) {
    const self2 = this;
    this.freeze();
    assertParser("process", this.parser || this.Parser);
    assertCompiler("process", this.compiler || this.Compiler);
    return done ? executor(void 0, done) : new Promise(executor);
    function executor(resolve, reject) {
      const realFile = vfile(file);
      const parseTree = (
        /** @type {HeadTree extends undefined ? Node : HeadTree} */
        /** @type {unknown} */
        self2.parse(realFile)
      );
      self2.run(parseTree, realFile, function(error, tree, file2) {
        if (error || !tree || !file2) {
          return realDone(error);
        }
        const compileTree = (
          /** @type {CompileTree extends undefined ? Node : CompileTree} */
          /** @type {unknown} */
          tree
        );
        const compileResult = self2.stringify(compileTree, file2);
        if (looksLikeAValue(compileResult)) {
          file2.value = compileResult;
        } else {
          file2.result = compileResult;
        }
        realDone(
          error,
          /** @type {VFileWithOutput<CompileResult>} */
          file2
        );
      });
      function realDone(error, file2) {
        if (error || !file2) {
          reject(error);
        } else if (resolve) {
          resolve(file2);
        } else {
          ok(done, "`done` is defined if `resolve` is not");
          done(void 0, file2);
        }
      }
    }
  }
  /**
   * Process the given file as configured on the processor.
   *
   * An error is thrown if asynchronous transforms are configured.
   *
   * > **Note**: `processSync` freezes the processor if not already *frozen*.
   *
   * > **Note**: `processSync` performs the parse, run, and stringify phases.
   *
   * @param {Compatible | undefined} [file]
   *   File (optional); typically `string` or `VFile`; any value accepted as
   *   `x` in `new VFile(x)`.
   * @returns {VFileWithOutput<CompileResult>}
   *   The processed file.
   *
   *   The parsed, transformed, and compiled value is available at
   *   `file.value` (see note).
   *
   *   > **Note**: unified typically compiles by serializing: most
   *   > compilers return `string` (or `Uint8Array`).
   *   > Some compilers, such as the one configured with
   *   > [`rehype-react`][rehype-react], return other values (in this case, a
   *   > React tree).
   *   > If you’re using a compiler that doesn’t serialize, expect different
   *   > result values.
   *   >
   *   > To register custom results in TypeScript, add them to
   *   > {@linkcode CompileResultMap}.
   *
   *   [rehype-react]: https://github.com/rehypejs/rehype-react
   */
  processSync(file) {
    let complete = false;
    let result;
    this.freeze();
    assertParser("processSync", this.parser || this.Parser);
    assertCompiler("processSync", this.compiler || this.Compiler);
    this.process(file, realDone);
    assertDone("processSync", "process", complete);
    ok(result, "we either bailed on an error or have a tree");
    return result;
    function realDone(error, file2) {
      complete = true;
      bail(error);
      result = file2;
    }
  }
  /**
   * Run *transformers* on a syntax tree.
   *
   * > **Note**: `run` freezes the processor if not already *frozen*.
   *
   * > **Note**: `run` performs the run phase, not other phases.
   *
   * @overload
   * @param {HeadTree extends undefined ? Node : HeadTree} tree
   * @param {RunCallback<TailTree extends undefined ? Node : TailTree>} done
   * @returns {undefined}
   *
   * @overload
   * @param {HeadTree extends undefined ? Node : HeadTree} tree
   * @param {Compatible | undefined} file
   * @param {RunCallback<TailTree extends undefined ? Node : TailTree>} done
   * @returns {undefined}
   *
   * @overload
   * @param {HeadTree extends undefined ? Node : HeadTree} tree
   * @param {Compatible | undefined} [file]
   * @returns {Promise<TailTree extends undefined ? Node : TailTree>}
   *
   * @param {HeadTree extends undefined ? Node : HeadTree} tree
   *   Tree to transform and inspect.
   * @param {(
   *   RunCallback<TailTree extends undefined ? Node : TailTree> |
   *   Compatible
   * )} [file]
   *   File associated with `node` (optional); any value accepted as `x` in
   *   `new VFile(x)`.
   * @param {RunCallback<TailTree extends undefined ? Node : TailTree>} [done]
   *   Callback (optional).
   * @returns {Promise<TailTree extends undefined ? Node : TailTree> | undefined}
   *   Nothing if `done` is given.
   *   Otherwise, a promise rejected with a fatal error or resolved with the
   *   transformed tree.
   */
  run(tree, file, done) {
    assertNode(tree);
    this.freeze();
    const transformers = this.transformers;
    if (!done && typeof file === "function") {
      done = file;
      file = void 0;
    }
    return done ? executor(void 0, done) : new Promise(executor);
    function executor(resolve, reject) {
      ok(
        typeof file !== "function",
        "`file` can\u2019t be a `done` anymore, we checked"
      );
      const realFile = vfile(file);
      transformers.run(tree, realFile, realDone);
      function realDone(error, outputTree, file2) {
        const resultingTree = (
          /** @type {TailTree extends undefined ? Node : TailTree} */
          outputTree || tree
        );
        if (error) {
          reject(error);
        } else if (resolve) {
          resolve(resultingTree);
        } else {
          ok(done, "`done` is defined if `resolve` is not");
          done(void 0, resultingTree, file2);
        }
      }
    }
  }
  /**
   * Run *transformers* on a syntax tree.
   *
   * An error is thrown if asynchronous transforms are configured.
   *
   * > **Note**: `runSync` freezes the processor if not already *frozen*.
   *
   * > **Note**: `runSync` performs the run phase, not other phases.
   *
   * @param {HeadTree extends undefined ? Node : HeadTree} tree
   *   Tree to transform and inspect.
   * @param {Compatible | undefined} [file]
   *   File associated with `node` (optional); any value accepted as `x` in
   *   `new VFile(x)`.
   * @returns {TailTree extends undefined ? Node : TailTree}
   *   Transformed tree.
   */
  runSync(tree, file) {
    let complete = false;
    let result;
    this.run(tree, file, realDone);
    assertDone("runSync", "run", complete);
    ok(result, "we either bailed on an error or have a tree");
    return result;
    function realDone(error, tree2) {
      bail(error);
      result = tree2;
      complete = true;
    }
  }
  /**
   * Compile a syntax tree.
   *
   * > **Note**: `stringify` freezes the processor if not already *frozen*.
   *
   * > **Note**: `stringify` performs the stringify phase, not the run phase
   * > or other phases.
   *
   * @param {CompileTree extends undefined ? Node : CompileTree} tree
   *   Tree to compile.
   * @param {Compatible | undefined} [file]
   *   File associated with `node` (optional); any value accepted as `x` in
   *   `new VFile(x)`.
   * @returns {CompileResult extends undefined ? Value : CompileResult}
   *   Textual representation of the tree (see note).
   *
   *   > **Note**: unified typically compiles by serializing: most compilers
   *   > return `string` (or `Uint8Array`).
   *   > Some compilers, such as the one configured with
   *   > [`rehype-react`][rehype-react], return other values (in this case, a
   *   > React tree).
   *   > If you’re using a compiler that doesn’t serialize, expect different
   *   > result values.
   *   >
   *   > To register custom results in TypeScript, add them to
   *   > {@linkcode CompileResultMap}.
   *
   *   [rehype-react]: https://github.com/rehypejs/rehype-react
   */
  stringify(tree, file) {
    this.freeze();
    const realFile = vfile(file);
    const compiler2 = this.compiler || this.Compiler;
    assertCompiler("stringify", compiler2);
    assertNode(tree);
    return compiler2(tree, realFile);
  }
  /**
   * Configure the processor to use a plugin, a list of usable values, or a
   * preset.
   *
   * If the processor is already using a plugin, the previous plugin
   * configuration is changed based on the options that are passed in.
   * In other words, the plugin is not added a second time.
   *
   * > **Note**: `use` cannot be called on *frozen* processors.
   * > Call the processor first to create a new unfrozen processor.
   *
   * @example
   *   There are many ways to pass plugins to `.use()`.
   *   This example gives an overview:
   *
   *   ```js
   *   import {unified} from 'unified'
   *
   *   unified()
   *     // Plugin with options:
   *     .use(pluginA, {x: true, y: true})
   *     // Passing the same plugin again merges configuration (to `{x: true, y: false, z: true}`):
   *     .use(pluginA, {y: false, z: true})
   *     // Plugins:
   *     .use([pluginB, pluginC])
   *     // Two plugins, the second with options:
   *     .use([pluginD, [pluginE, {}]])
   *     // Preset with plugins and settings:
   *     .use({plugins: [pluginF, [pluginG, {}]], settings: {position: false}})
   *     // Settings only:
   *     .use({settings: {position: false}})
   *   ```
   *
   * @template {Array<unknown>} [Parameters=[]]
   * @template {Node | string | undefined} [Input=undefined]
   * @template [Output=Input]
   *
   * @overload
   * @param {Preset | null | undefined} [preset]
   * @returns {Processor<ParseTree, HeadTree, TailTree, CompileTree, CompileResult>}
   *
   * @overload
   * @param {PluggableList} list
   * @returns {Processor<ParseTree, HeadTree, TailTree, CompileTree, CompileResult>}
   *
   * @overload
   * @param {Plugin<Parameters, Input, Output>} plugin
   * @param {...(Parameters | [boolean])} parameters
   * @returns {UsePlugin<ParseTree, HeadTree, TailTree, CompileTree, CompileResult, Input, Output>}
   *
   * @param {PluggableList | Plugin | Preset | null | undefined} value
   *   Usable value.
   * @param {...unknown} parameters
   *   Parameters, when a plugin is given as a usable value.
   * @returns {Processor<ParseTree, HeadTree, TailTree, CompileTree, CompileResult>}
   *   Current processor.
   */
  use(value, ...parameters) {
    const attachers = this.attachers;
    const namespace = this.namespace;
    assertUnfrozen("use", this.frozen);
    if (value === null || value === void 0) {
    } else if (typeof value === "function") {
      addPlugin(value, parameters);
    } else if (typeof value === "object") {
      if (Array.isArray(value)) {
        addList(value);
      } else {
        addPreset(value);
      }
    } else {
      throw new TypeError("Expected usable value, not `" + value + "`");
    }
    return this;
    function add(value2) {
      if (typeof value2 === "function") {
        addPlugin(value2, []);
      } else if (typeof value2 === "object") {
        if (Array.isArray(value2)) {
          const [plugin, ...parameters2] = (
            /** @type {PluginTuple<Array<unknown>>} */
            value2
          );
          addPlugin(plugin, parameters2);
        } else {
          addPreset(value2);
        }
      } else {
        throw new TypeError("Expected usable value, not `" + value2 + "`");
      }
    }
    function addPreset(result) {
      if (!("plugins" in result) && !("settings" in result)) {
        throw new Error(
          "Expected usable value but received an empty preset, which is probably a mistake: presets typically come with `plugins` and sometimes with `settings`, but this has neither"
        );
      }
      addList(result.plugins);
      if (result.settings) {
        namespace.settings = (0, import_extend.default)(true, namespace.settings, result.settings);
      }
    }
    function addList(plugins) {
      let index2 = -1;
      if (plugins === null || plugins === void 0) {
      } else if (Array.isArray(plugins)) {
        while (++index2 < plugins.length) {
          const thing = plugins[index2];
          add(thing);
        }
      } else {
        throw new TypeError("Expected a list of plugins, not `" + plugins + "`");
      }
    }
    function addPlugin(plugin, parameters2) {
      let index2 = -1;
      let entryIndex = -1;
      while (++index2 < attachers.length) {
        if (attachers[index2][0] === plugin) {
          entryIndex = index2;
          break;
        }
      }
      if (entryIndex === -1) {
        attachers.push([plugin, ...parameters2]);
      } else if (parameters2.length > 0) {
        let [primary, ...rest] = parameters2;
        const currentPrimary = attachers[entryIndex][1];
        if (isPlainObject(currentPrimary) && isPlainObject(primary)) {
          primary = (0, import_extend.default)(true, currentPrimary, primary);
        }
        attachers[entryIndex] = [plugin, primary, ...rest];
      }
    }
  }
};
var unified = new Processor().freeze();
function assertParser(name2, value) {
  if (typeof value !== "function") {
    throw new TypeError("Cannot `" + name2 + "` without `parser`");
  }
}
function assertCompiler(name2, value) {
  if (typeof value !== "function") {
    throw new TypeError("Cannot `" + name2 + "` without `compiler`");
  }
}
function assertUnfrozen(name2, frozen) {
  if (frozen) {
    throw new Error(
      "Cannot call `" + name2 + "` on a frozen processor.\nCreate a new processor first, by calling it: use `processor()` instead of `processor`."
    );
  }
}
function assertNode(node2) {
  if (!isPlainObject(node2) || typeof node2.type !== "string") {
    throw new TypeError("Expected node, got `" + node2 + "`");
  }
}
function assertDone(name2, asyncName, complete) {
  if (!complete) {
    throw new Error(
      "`" + name2 + "` finished async. Use `" + asyncName + "` instead"
    );
  }
}
function vfile(value) {
  return looksLikeAVFile(value) ? value : new VFile(value);
}
function looksLikeAVFile(value) {
  return Boolean(
    value && typeof value === "object" && "message" in value && "messages" in value
  );
}
function looksLikeAValue(value) {
  return typeof value === "string" || isUint8Array2(value);
}
function isUint8Array2(value) {
  return Boolean(
    value && typeof value === "object" && "byteLength" in value && "byteOffset" in value
  );
}

// ../../node_modules/react-markdown/lib/index.js
var changelog = "https://github.com/remarkjs/react-markdown/blob/main/changelog.md";
var emptyPlugins = [];
var emptyRemarkRehypeOptions = { allowDangerousHtml: true };
var safeProtocol = /^(https?|ircs?|mailto|xmpp)$/i;
var deprecations = [
  { from: "astPlugins", id: "remove-buggy-html-in-markdown-parser" },
  { from: "allowDangerousHtml", id: "remove-buggy-html-in-markdown-parser" },
  {
    from: "allowNode",
    id: "replace-allownode-allowedtypes-and-disallowedtypes",
    to: "allowElement"
  },
  {
    from: "allowedTypes",
    id: "replace-allownode-allowedtypes-and-disallowedtypes",
    to: "allowedElements"
  },
  { from: "className", id: "remove-classname" },
  {
    from: "disallowedTypes",
    id: "replace-allownode-allowedtypes-and-disallowedtypes",
    to: "disallowedElements"
  },
  { from: "escapeHtml", id: "remove-buggy-html-in-markdown-parser" },
  { from: "includeElementIndex", id: "#remove-includeelementindex" },
  {
    from: "includeNodeIndex",
    id: "change-includenodeindex-to-includeelementindex"
  },
  { from: "linkTarget", id: "remove-linktarget" },
  { from: "plugins", id: "change-plugins-to-remarkplugins", to: "remarkPlugins" },
  { from: "rawSourcePos", id: "#remove-rawsourcepos" },
  { from: "renderers", id: "change-renderers-to-components", to: "components" },
  { from: "source", id: "change-source-to-children", to: "children" },
  { from: "sourcePos", id: "#remove-sourcepos" },
  { from: "transformImageUri", id: "#add-urltransform", to: "urlTransform" },
  { from: "transformLinkUri", id: "#add-urltransform", to: "urlTransform" }
];
function Markdown(options) {
  const processor = createProcessor(options);
  const file = createFile(options);
  return post(processor.runSync(processor.parse(file), file), options);
}
function createProcessor(options) {
  const rehypePlugins = options.rehypePlugins || emptyPlugins;
  const remarkPlugins = options.remarkPlugins || emptyPlugins;
  const remarkRehypeOptions = options.remarkRehypeOptions ? { ...options.remarkRehypeOptions, ...emptyRemarkRehypeOptions } : emptyRemarkRehypeOptions;
  const processor = unified().use(remarkParse).use(remarkPlugins).use(remarkRehype, remarkRehypeOptions).use(rehypePlugins);
  return processor;
}
function createFile(options) {
  const children = options.children || "";
  const file = new VFile();
  if (typeof children === "string") {
    file.value = children;
  } else {
    unreachable(
      "Unexpected value `" + children + "` for `children` prop, expected `string`"
    );
  }
  return file;
}
function post(tree, options) {
  const allowedElements = options.allowedElements;
  const allowElement = options.allowElement;
  const components = options.components;
  const disallowedElements = options.disallowedElements;
  const skipHtml = options.skipHtml;
  const unwrapDisallowed = options.unwrapDisallowed;
  const urlTransform = options.urlTransform || defaultUrlTransform;
  for (const deprecation of deprecations) {
    if (Object.hasOwn(options, deprecation.from)) {
      unreachable(
        "Unexpected `" + deprecation.from + "` prop, " + (deprecation.to ? "use `" + deprecation.to + "` instead" : "remove it") + " (see <" + changelog + "#" + deprecation.id + "> for more info)"
      );
    }
  }
  if (allowedElements && disallowedElements) {
    unreachable(
      "Unexpected combined `allowedElements` and `disallowedElements`, expected one or the other"
    );
  }
  visit(tree, transform);
  return toJsxRuntime(tree, {
    Fragment: import_jsx_runtime8.Fragment,
    components,
    ignoreInvalidStyle: true,
    jsx: import_jsx_runtime8.jsx,
    jsxs: import_jsx_runtime8.jsxs,
    passKeys: true,
    passNode: true
  });
  function transform(node2, index2, parent) {
    if (node2.type === "raw" && parent && typeof index2 === "number") {
      if (skipHtml) {
        parent.children.splice(index2, 1);
      } else {
        parent.children[index2] = { type: "text", value: node2.value };
      }
      return index2;
    }
    if (node2.type === "element") {
      let key;
      for (key in urlAttributes) {
        if (Object.hasOwn(urlAttributes, key) && Object.hasOwn(node2.properties, key)) {
          const value = node2.properties[key];
          const test = urlAttributes[key];
          if (test === null || test.includes(node2.tagName)) {
            node2.properties[key] = urlTransform(String(value || ""), key, node2);
          }
        }
      }
    }
    if (node2.type === "element") {
      let remove = allowedElements ? !allowedElements.includes(node2.tagName) : disallowedElements ? disallowedElements.includes(node2.tagName) : false;
      if (!remove && allowElement && typeof index2 === "number") {
        remove = !allowElement(node2, index2, parent);
      }
      if (remove && parent && typeof index2 === "number") {
        if (unwrapDisallowed && node2.children) {
          parent.children.splice(index2, 1, ...node2.children);
        } else {
          parent.children.splice(index2, 1);
        }
        return index2;
      }
    }
  }
}
function defaultUrlTransform(value) {
  const colon = value.indexOf(":");
  const questionMark = value.indexOf("?");
  const numberSign = value.indexOf("#");
  const slash = value.indexOf("/");
  if (
    // If there is no protocol, it’s relative.
    colon === -1 || // If the first colon is after a `?`, `#`, or `/`, it’s not a protocol.
    slash !== -1 && colon > slash || questionMark !== -1 && colon > questionMark || numberSign !== -1 && colon > numberSign || // It is a protocol, it should be allowed.
    safeProtocol.test(value.slice(0, colon))
  ) {
    return value;
  }
  return "";
}

// src/client/workbench/MarkdownContent.tsx
var import_markdown_policy = __toESM(require_markdown_policy(), 1);
var import_jsx_runtime9 = require("react/jsx-runtime");
var safeMarkdownLink = import_markdown_policy.default.safeMarkdownLink;
function MarkdownContent({
  children,
  compact = false
}) {
  const value = typeof children === "string" ? children : "";
  return /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("div", { className: `rolling-skill-markdown${compact ? " rolling-skill-markdown-compact" : ""}`, children: /* @__PURE__ */ (0, import_jsx_runtime9.jsx)(
    Markdown,
    {
      skipHtml: true,
      components: {
        a({ href, children: linkChildren }) {
          const safeHref = safeMarkdownLink(href);
          if (!safeHref) return /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("span", { children: linkChildren });
          const external = !safeHref.startsWith("#");
          return /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("a", { href: safeHref, ...external ? { target: "_blank", rel: "noreferrer" } : {}, children: linkChildren });
        },
        img({ alt }) {
          return /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("span", { className: "rolling-skill-markdown-image-placeholder", children: alt || "Image" });
        }
      },
      children: value
    }
  ) });
}

// src/client/workbench/CasesPanel.tsx
var import_jsx_runtime10 = require("react/jsx-runtime");
function CasesPanel({ t, revision, onChanged, initialDatasetId, initialCaseId, onNavigate }) {
  const [datasets, setDatasets] = (0, import_react7.useState)([]);
  const [runtimes, setRuntimes] = (0, import_react7.useState)([]);
  const [runtimeId, setRuntimeId] = (0, import_react7.useState)("");
  const [datasetId, setDatasetId] = (0, import_react7.useState)(initialDatasetId ?? "");
  const [entries, setEntries] = (0, import_react7.useState)([]);
  const [caseScope, setCaseScope] = (0, import_react7.useState)("all");
  const [page, setPage] = (0, import_react7.useState)(1);
  const [pageResult, setPageResult] = (0, import_react7.useState)({ items: [], total: 0, page: 1, pageSize: 20, pageCount: 0 });
  const [detail, setDetail] = (0, import_react7.useState)(null);
  const [deleting, setDeleting] = (0, import_react7.useState)(null);
  const [recoverQuestions, setRecoverQuestions] = (0, import_react7.useState)(true);
  const [busy, setBusy] = (0, import_react7.useState)(false);
  const [error, setError] = (0, import_react7.useState)(null);
  const [calibrationBatch, setCalibrationBatch] = (0, import_react7.useState)(null);
  const stopCalibration = (0, import_react7.useRef)(false);
  (0, import_react7.useEffect)(() => () => {
    stopCalibration.current = true;
  }, []);
  (0, import_react7.useEffect)(() => {
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
  (0, import_react7.useEffect)(() => {
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
  (0, import_react7.useEffect)(() => {
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
      const all2 = [];
      let nextPage = 1;
      while (true) {
        const result = await requestRollingSkill("cases.list", { datasetId, caseScope: "all", page: nextPage, pageSize: 200 });
        all2.push(...result.items);
        if (nextPage >= result.pageCount) break;
        nextPage += 1;
      }
      const pending = all2.filter((entry) => entry.rubricCalibration?.status !== "current");
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
  return /* @__PURE__ */ (0, import_jsx_runtime10.jsxs)("section", { className: "rolling-skill-panel rolling-skill-data-panel", children: [
    /* @__PURE__ */ (0, import_jsx_runtime10.jsxs)("div", { className: "rolling-skill-panel-header", children: [
      /* @__PURE__ */ (0, import_jsx_runtime10.jsxs)("div", { children: [
        /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("h3", { children: t("casesTitle") }),
        /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("p", { children: t("casesDescription") })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime10.jsxs)("div", { className: "rolling-skill-actions", children: [
        /* @__PURE__ */ (0, import_jsx_runtime10.jsx)(ActionButton, { size: "sm", disabled: !datasetId || busy, onClick: () => void refreshBatch("goodcase"), children: t("refreshGoodCases") }),
        /* @__PURE__ */ (0, import_jsx_runtime10.jsx)(ActionButton, { size: "sm", disabled: !datasetId || busy, onClick: () => void refreshBatch("all"), children: t("refreshAllCases") }),
        calibrationBatch?.status === "running" ? /* @__PURE__ */ (0, import_jsx_runtime10.jsx)(ActionButton, { size: "sm", onClick: () => {
          stopCalibration.current = true;
        }, children: t("stopCalibrationBatch") }) : /* @__PURE__ */ (0, import_jsx_runtime10.jsx)(ActionButton, { size: "sm", disabled: !datasetId || busy, onClick: () => void startCalibrationBatch(), children: t("calibrateAllCases") })
      ] })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime10.jsxs)("div", { className: "rolling-skill-form-row", children: [
      /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("select", { className: "rolling-skill-select", "aria-label": t("selectDataset"), value: datasetId, onChange: (event) => {
        setDatasetId(event.target.value);
        setPage(1);
      }, children: datasets.map((dataset) => /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("option", { value: dataset.id, children: dataset.name }, dataset.id)) }),
      /* @__PURE__ */ (0, import_jsx_runtime10.jsxs)("select", { className: "rolling-skill-select", "aria-label": t("caseFilter"), value: caseScope, onChange: (event) => {
        setCaseScope(event.target.value);
        setPage(1);
      }, children: [
        /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("option", { value: "all", children: t("allCases") }),
        /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("option", { value: "goodcase", children: t("goodcase") }),
        /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("option", { value: "badcase", children: t("badcase") })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime10.jsx)(RuntimeSelect, { t, runtimes, value: runtimeId, onChange: setRuntimeId, label: t("refreshRuntime") })
    ] }),
    error ? /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("p", { className: "rolling-skill-inline-error", role: "alert", children: error }) : null,
    calibrationBatch ? /* @__PURE__ */ (0, import_jsx_runtime10.jsxs)("section", { className: "rolling-skill-subpanel", children: [
      /* @__PURE__ */ (0, import_jsx_runtime10.jsxs)("p", { children: [
        t("calibrationBatchProgress").replace("{completed}", String(calibrationBatch.completed)).replace("{total}", String(calibrationBatch.total)),
        " \xB7 ",
        calibrationBatch.status
      ] }),
      calibrationBatch.error ? /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("p", { className: "rolling-skill-inline-error", children: calibrationBatch.error }) : null,
      calibrationBatch.currentSessionId ? /* @__PURE__ */ (0, import_jsx_runtime10.jsx)(ActionButton, { size: "sm", onClick: () => onNavigate({ page: "curation", sessionId: calibrationBatch.currentSessionId }), children: t("reviewCalibration") }) : null
    ] }) : null,
    /* @__PURE__ */ (0, import_jsx_runtime10.jsxs)("div", { className: "rolling-skill-list", children: [
      entries.map((entry) => /* @__PURE__ */ (0, import_jsx_runtime10.jsxs)("article", { className: "rolling-skill-case-row", children: [
        /* @__PURE__ */ (0, import_jsx_runtime10.jsxs)("div", { className: "rolling-skill-case-copy", children: [
          /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("span", { className: "rolling-skill-badge", children: entry.caseType === "goodcase" ? t("goodcase") : t("badcase") }),
          entry.rubricCalibration?.status !== "current" ? /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("span", { className: "rolling-skill-badge", children: t("caseNeedsCalibration") }) : null,
          /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("div", { className: "rolling-skill-case-question", children: /* @__PURE__ */ (0, import_jsx_runtime10.jsx)(MarkdownContent, { compact: true, children: entry.question }) }),
          /* @__PURE__ */ (0, import_jsx_runtime10.jsx)(MarkdownContent, { compact: true, children: entry.answer })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime10.jsxs)("div", { className: "rolling-skill-actions", children: [
          /* @__PURE__ */ (0, import_jsx_runtime10.jsx)(ActionButton, { size: "sm", onClick: () => void inspect(entry), children: t("details") }),
          /* @__PURE__ */ (0, import_jsx_runtime10.jsx)(ActionButton, { size: "sm", disabled: busy, onClick: () => void refreshOne(entry), children: t("refreshCase") }),
          entry.rubricCalibration?.status !== "current" ? /* @__PURE__ */ (0, import_jsx_runtime10.jsx)(ActionButton, { size: "sm", disabled: busy, onClick: () => void calibrate(entry), children: t("calibrateCase") }) : null,
          /* @__PURE__ */ (0, import_jsx_runtime10.jsx)(ActionButton, { size: "sm", disabled: busy, onClick: () => setDeleting(entry), children: t("delete") })
        ] })
      ] }, entry.id)),
      entries.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("p", { children: t("emptyCases") }) : null
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime10.jsxs)("div", { className: "rolling-skill-pagination", "aria-label": t("casePages"), children: [
      /* @__PURE__ */ (0, import_jsx_runtime10.jsx)(ActionButton, { size: "sm", disabled: page <= 1, onClick: () => setPage((value) => value - 1), children: t("previousPage") }),
      /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("span", { children: t("pageStatus").replace("{page}", String(pageResult.page)).replace("{pages}", String(pageResult.pageCount || 1)).replace("{total}", String(pageResult.total)) }),
      /* @__PURE__ */ (0, import_jsx_runtime10.jsx)(ActionButton, { size: "sm", disabled: pageResult.pageCount === 0 || page >= pageResult.pageCount, onClick: () => setPage((value) => value + 1), children: t("nextPage") })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime10.jsx)(import_dsh_client_ui_primitives4.Modal, { open: detail !== null, onClose: () => setDetail(null), title: t("caseDetailTitle"), closeLabel: t("close"), footer: /* @__PURE__ */ (0, import_jsx_runtime10.jsx)(ActionButton, { onClick: () => setDetail(null), children: t("close") }), children: detail ? /* @__PURE__ */ (0, import_jsx_runtime10.jsxs)("div", { className: "rolling-skill-detail-stack", children: [
      /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("span", { className: "rolling-skill-badge", children: detail.caseType === "goodcase" ? t("goodcase") : t("badcase") }),
      /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("h4", { children: t("question") }),
      /* @__PURE__ */ (0, import_jsx_runtime10.jsx)(MarkdownContent, { children: detail.question }),
      /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("h4", { children: t("caseAnswer") }),
      /* @__PURE__ */ (0, import_jsx_runtime10.jsx)(MarkdownContent, { children: detail.answer }),
      detail.issueDescription ? /* @__PURE__ */ (0, import_jsx_runtime10.jsxs)(import_jsx_runtime10.Fragment, { children: [
        /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("h4", { children: t("caseIssue") }),
        /* @__PURE__ */ (0, import_jsx_runtime10.jsx)(MarkdownContent, { children: detail.issueDescription })
      ] }) : null,
      /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("h4", { children: t("caseEvidence") }),
      /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("pre", { children: JSON.stringify({ rubric: detail.rubric ?? null, operationEvidence: detail.operationEvidence ?? null, source: detail.episode?.source ?? null }, null, 2) })
    ] }) : null }),
    /* @__PURE__ */ (0, import_jsx_runtime10.jsxs)(import_dsh_client_ui_primitives4.Modal, { open: deleting !== null, onClose: () => setDeleting(null), title: t("deleteCaseTitle"), closeLabel: t("cancel"), footer: /* @__PURE__ */ (0, import_jsx_runtime10.jsxs)(import_jsx_runtime10.Fragment, { children: [
      /* @__PURE__ */ (0, import_jsx_runtime10.jsx)(ActionButton, { onClick: () => setDeleting(null), children: t("cancel") }),
      /* @__PURE__ */ (0, import_jsx_runtime10.jsx)(ActionButton, { disabled: busy, onClick: remove, children: t("confirmDelete") })
    ] }), children: [
      /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("p", { children: t("deleteRecoveryPrompt") }),
      /* @__PURE__ */ (0, import_jsx_runtime10.jsxs)("label", { className: "rolling-skill-check", children: [
        /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("input", { type: "checkbox", checked: recoverQuestions, onChange: (event) => setRecoverQuestions(event.target.checked) }),
        /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("span", { children: t("recoverToRawCases") })
      ] })
    ] })
  ] });
}

// src/client/workbench/DatasetsPanel.tsx
var import_dsh_client_ui_primitives5 = require("@deepseek-ai/dsh-client-ui-primitives");
var import_react8 = require("react");
var import_jsx_runtime11 = require("react/jsx-runtime");
function DatasetsPanel({ t, onChanged }) {
  const [datasets, setDatasets] = (0, import_react8.useState)([]);
  const [catalog, setCatalog] = (0, import_react8.useState)({ repositories: [], skills: [] });
  const [name2, setName] = (0, import_react8.useState)("");
  const [skillId, setSkillId] = (0, import_react8.useState)("");
  const [deleting, setDeleting] = (0, import_react8.useState)(null);
  const [binding, setBinding] = (0, import_react8.useState)(null);
  const [bindingSkillId, setBindingSkillId] = (0, import_react8.useState)("");
  const [recoverQuestions, setRecoverQuestions] = (0, import_react8.useState)(true);
  const [busy, setBusy] = (0, import_react8.useState)(false);
  const [error, setError] = (0, import_react8.useState)(null);
  const [revision, setRevision] = (0, import_react8.useState)(0);
  (0, import_react8.useEffect)(() => {
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
  const create2 = () => mutate(async () => {
    const selectedSkill = catalog.skills.find((skill) => skill.id === skillId);
    if (!selectedSkill) throw new Error(t("noManagedSkills"));
    await requestRollingSkill("datasets.create", {
      name: name2,
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
  return /* @__PURE__ */ (0, import_jsx_runtime11.jsxs)("section", { className: "rolling-skill-panel rolling-skill-data-panel", children: [
    /* @__PURE__ */ (0, import_jsx_runtime11.jsxs)("div", { className: "rolling-skill-panel-header", children: [
      /* @__PURE__ */ (0, import_jsx_runtime11.jsxs)("div", { children: [
        /* @__PURE__ */ (0, import_jsx_runtime11.jsx)("h3", { children: t("datasetsTitle") }),
        /* @__PURE__ */ (0, import_jsx_runtime11.jsx)("p", { children: t("datasetsDescription") })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime11.jsx)(ActionButton, { size: "sm", onClick: reload, children: t("refresh") })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime11.jsxs)("div", { className: "rolling-skill-form-row", children: [
      /* @__PURE__ */ (0, import_jsx_runtime11.jsx)(
        import_dsh_client_ui_primitives5.Input,
        {
          value: name2,
          placeholder: t("datasetName"),
          "aria-label": t("datasetName"),
          onChange: (event) => setName(event.target.value)
        }
      ),
      /* @__PURE__ */ (0, import_jsx_runtime11.jsx)(
        "select",
        {
          className: "rolling-skill-select",
          "aria-label": t("datasetSkill"),
          value: skillId,
          onChange: (event) => setSkillId(event.target.value),
          children: catalog.skills.filter((skill) => skill.status === "valid").map((skill) => {
            const repository = catalog.repositories.find((entry) => entry.id === skill.repositoryId);
            return /* @__PURE__ */ (0, import_jsx_runtime11.jsxs)("option", { value: skill.id, children: [
              skill.name,
              " \xB7 ",
              repository?.displayName ?? skill.repositoryId
            ] }, skill.id);
          })
        }
      ),
      /* @__PURE__ */ (0, import_jsx_runtime11.jsx)(ActionButton, { size: "sm", disabled: busy || !name2.trim() || !skillId, onClick: create2, children: t("createDataset") })
    ] }),
    error ? /* @__PURE__ */ (0, import_jsx_runtime11.jsx)("p", { className: "rolling-skill-inline-error", role: "alert", children: error }) : null,
    /* @__PURE__ */ (0, import_jsx_runtime11.jsxs)("div", { className: "rolling-skill-list", children: [
      datasets.map((dataset) => /* @__PURE__ */ (0, import_jsx_runtime11.jsxs)("article", { className: "rolling-skill-list-row", children: [
        /* @__PURE__ */ (0, import_jsx_runtime11.jsxs)("div", { children: [
          /* @__PURE__ */ (0, import_jsx_runtime11.jsx)("strong", { children: dataset.name }),
          /* @__PURE__ */ (0, import_jsx_runtime11.jsx)("span", { children: dataset.skillReference?.evidencePrecision === "managed" ? `${t("datasetSkill")}: ${dataset.skillReference.name}` : t("unboundManagedSkill") }),
          /* @__PURE__ */ (0, import_jsx_runtime11.jsx)("span", { children: t("caseBreakdown").replace("{all}", String(dataset.caseCount)).replace("{good}", String(dataset.goodcaseCount)).replace("{bad}", String(dataset.badcaseCount)) })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime11.jsxs)("div", { className: "rolling-skill-actions", children: [
          /* @__PURE__ */ (0, import_jsx_runtime11.jsx)(ActionButton, { size: "sm", onClick: () => beginBinding(dataset), children: t("changeManagedSkill") }),
          /* @__PURE__ */ (0, import_jsx_runtime11.jsx)(ActionButton, { size: "sm", onClick: () => void exportCsv(dataset.id), children: t("exportCsv") }),
          /* @__PURE__ */ (0, import_jsx_runtime11.jsx)(ActionButton, { size: "sm", onClick: () => setDeleting(dataset), children: t("delete") })
        ] })
      ] }, dataset.id)),
      datasets.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime11.jsx)("p", { children: t("emptyDatasets") }) : null
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime11.jsxs)(
      import_dsh_client_ui_primitives5.Modal,
      {
        open: deleting !== null,
        onClose: () => setDeleting(null),
        title: t("deleteDatasetTitle"),
        closeLabel: t("cancel"),
        footer: /* @__PURE__ */ (0, import_jsx_runtime11.jsxs)(import_jsx_runtime11.Fragment, { children: [
          /* @__PURE__ */ (0, import_jsx_runtime11.jsx)(ActionButton, { onClick: () => setDeleting(null), children: t("cancel") }),
          /* @__PURE__ */ (0, import_jsx_runtime11.jsx)(ActionButton, { disabled: busy, onClick: remove, children: t("confirmDelete") })
        ] }),
        children: [
          /* @__PURE__ */ (0, import_jsx_runtime11.jsx)("p", { children: t("deleteRecoveryPrompt") }),
          /* @__PURE__ */ (0, import_jsx_runtime11.jsxs)("label", { className: "rolling-skill-check", children: [
            /* @__PURE__ */ (0, import_jsx_runtime11.jsx)("input", { type: "checkbox", checked: recoverQuestions, onChange: (event) => setRecoverQuestions(event.target.checked) }),
            /* @__PURE__ */ (0, import_jsx_runtime11.jsx)("span", { children: t("recoverToRawCases") })
          ] })
        ]
      }
    ),
    /* @__PURE__ */ (0, import_jsx_runtime11.jsxs)(
      import_dsh_client_ui_primitives5.Modal,
      {
        open: binding !== null,
        onClose: () => setBinding(null),
        title: t("bindManagedSkillTitle"),
        closeLabel: t("cancel"),
        footer: /* @__PURE__ */ (0, import_jsx_runtime11.jsxs)(import_jsx_runtime11.Fragment, { children: [
          /* @__PURE__ */ (0, import_jsx_runtime11.jsx)(ActionButton, { onClick: () => setBinding(null), children: t("cancel") }),
          /* @__PURE__ */ (0, import_jsx_runtime11.jsx)(ActionButton, { disabled: busy || !bindingSkillId, onClick: bindSkill, children: t("save") })
        ] }),
        children: [
          /* @__PURE__ */ (0, import_jsx_runtime11.jsx)("p", { children: t("bindManagedSkillDescription") }),
          /* @__PURE__ */ (0, import_jsx_runtime11.jsx)("select", { className: "rolling-skill-select", value: bindingSkillId, onChange: (event) => setBindingSkillId(event.target.value), children: catalog.skills.filter((skill) => skill.status === "valid").map((skill) => {
            const repository = catalog.repositories.find((entry) => entry.id === skill.repositoryId);
            return /* @__PURE__ */ (0, import_jsx_runtime11.jsxs)("option", { value: skill.id, children: [
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
var import_react9 = require("react");
var import_jsx_runtime12 = require("react/jsx-runtime");
function EvaluationsPanel({ t, initialRunId }) {
  const [runtimes, setRuntimes] = (0, import_react9.useState)([]);
  const [datasets, setDatasets] = (0, import_react9.useState)([]);
  const [runs, setRuns] = (0, import_react9.useState)([]);
  const [targetRuntimeId, setTargetRuntimeId] = (0, import_react9.useState)("");
  const [targetRuntimeIds, setTargetRuntimeIds] = (0, import_react9.useState)([]);
  const [judgeRuntimeId, setJudgeRuntimeId] = (0, import_react9.useState)("");
  const [datasetId, setDatasetId] = (0, import_react9.useState)("");
  const [versions, setVersions] = (0, import_react9.useState)([]);
  const [versionId, setVersionId] = (0, import_react9.useState)("");
  const [installations, setInstallations] = (0, import_react9.useState)([]);
  const [targetModels, setTargetModels] = (0, import_react9.useState)([]);
  const [judgeModels, setJudgeModels] = (0, import_react9.useState)([]);
  const [targetModelId, setTargetModelId] = (0, import_react9.useState)("");
  const [judgeModelId, setJudgeModelId] = (0, import_react9.useState)("");
  const [effort, setEffort] = (0, import_react9.useState)("");
  const [judgeEffort, setJudgeEffort] = (0, import_react9.useState)("");
  const [activationMode, setActivationMode] = (0, import_react9.useState)("explicit");
  const [caseScope, setCaseScope] = (0, import_react9.useState)("all");
  const [caseIds, setCaseIds] = (0, import_react9.useState)([]);
  const [detail, setDetail] = (0, import_react9.useState)(null);
  const [busy, setBusy] = (0, import_react9.useState)(false);
  const [error, setError] = (0, import_react9.useState)(null);
  const [revision, setRevision] = (0, import_react9.useState)(0);
  (0, import_react9.useEffect)(() => {
    const controller = new AbortController();
    Promise.all([
      requestRollingSkill("runtimes.list", {}, controller.signal),
      requestRollingSkill("datasets.list", {}, controller.signal),
      requestRollingSkill("evaluations.list", {}, controller.signal),
      requestRollingSkill("settings.get", {}, controller.signal)
    ]).then(([runtimeItems, datasetItems, runItems, settings]) => {
      const configuredRuntimeId = settings.plugin.runtime?.runtimeId;
      setRuntimes(runtimeItems);
      setDatasets(datasetItems);
      setRuns(runItems);
      setTargetRuntimeId((current) => current || configuredRuntimeId || runtimeItems[0]?.runtimeId || "");
      setTargetRuntimeIds((current) => current.length ? current : configuredRuntimeId ? [configuredRuntimeId] : runtimeItems[0]?.runtimeId ? [runtimeItems[0].runtimeId] : []);
      setJudgeRuntimeId((current) => current || configuredRuntimeId || runtimeItems[0]?.runtimeId || "");
      setJudgeModelId((current) => current || settings.rollingSkill.judgeProfile.modelId || "");
      setJudgeEffort((current) => current || settings.rollingSkill.judgeProfile.effort || "");
      setDatasetId((current) => current || datasetItems[0]?.id || "");
      if (initialRunId) void inspect(initialRunId);
    }).catch((reason) => {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : t("loadError"));
    });
    return () => controller.abort();
  }, [revision, initialRunId]);
  const selectedDataset = (0, import_react9.useMemo)(
    () => datasets.find((dataset) => dataset.id === datasetId) ?? null,
    [datasets, datasetId]
  );
  (0, import_react9.useEffect)(() => {
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
  (0, import_react9.useEffect)(() => {
    if (!datasetId) return;
    const controller = new AbortController();
    requestRollingSkill("cases.list", { datasetId, caseScope, pageSize: 200 }, controller.signal).then((page) => setCaseIds(page.items.map((entry) => entry.id))).catch((reason) => {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : t("loadError"));
    });
    return () => controller.abort();
  }, [datasetId, caseScope, revision]);
  (0, import_react9.useEffect)(() => {
    if (!targetRuntimeId) return;
    const controller = new AbortController();
    requestRollingSkill("runtimes.models", { runtimeId: targetRuntimeId }, controller.signal).then((models) => {
      setTargetModels(models);
      setTargetModelId((current) => current || (models[0]?.id ?? models[0]?.model ?? ""));
    }).catch((reason) => {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : t("loadError"));
    });
    return () => controller.abort();
  }, [targetRuntimeId]);
  (0, import_react9.useEffect)(() => {
    if (!judgeRuntimeId) return;
    const controller = new AbortController();
    requestRollingSkill("runtimes.models", { runtimeId: judgeRuntimeId }, controller.signal).then((models) => {
      setJudgeModels(models);
      setJudgeModelId((current) => {
        const available = models.some((model) => (model.id ?? model.model) === current);
        return current && available ? current : models[0]?.id ?? models[0]?.model ?? "";
      });
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
  const start2 = () => mutate(() => requestRollingSkill("evaluations.start", {
    datasetId,
    versionId,
    caseIds: caseScope === "all" ? [] : caseIds,
    selectionMode: caseScope === "all" ? "dataset" : "selected",
    activationMode,
    targets: targetRuntimeIds.map((runtimeId) => ({ runtimeId, modelId: runtimeId === targetRuntimeId ? targetModelId || null : null, effort: effort || null })),
    judge: { runtimeId: judgeRuntimeId, modelId: judgeModelId || null, effort: judgeEffort || null }
  }));
  const inspect = async (runId) => {
    setError(null);
    try {
      setDetail(await requestRollingSkill("evaluations.get", { runId }));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t("loadError"));
    }
  };
  (0, import_react9.useEffect)(() => {
    if (!runs.some((run) => ["queued", "running"].includes(run.status))) return;
    const timer = window.setInterval(() => setRevision((value) => value + 1), 1500);
    return () => window.clearInterval(timer);
  }, [runs]);
  return /* @__PURE__ */ (0, import_jsx_runtime12.jsxs)("div", { className: "rolling-skill-data-stack", children: [
    /* @__PURE__ */ (0, import_jsx_runtime12.jsxs)("section", { className: "rolling-skill-panel", children: [
      /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("div", { className: "rolling-skill-panel-header", children: /* @__PURE__ */ (0, import_jsx_runtime12.jsxs)("div", { children: [
        /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("h3", { children: t("evaluationStartTitle") }),
        /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("p", { children: t("evaluationStartDescription") })
      ] }) }),
      /* @__PURE__ */ (0, import_jsx_runtime12.jsxs)("label", { className: "rolling-skill-field", children: [
        /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("span", { children: t("selectDataset") }),
        /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("select", { className: "rolling-skill-select", value: datasetId, onChange: (event) => setDatasetId(event.target.value), children: datasets.map((dataset) => /* @__PURE__ */ (0, import_jsx_runtime12.jsxs)("option", { value: dataset.id, children: [
          dataset.name,
          " \xB7 ",
          dataset.caseCount
        ] }, dataset.id)) })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime12.jsxs)("label", { className: "rolling-skill-field", children: [
        /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("span", { children: t("evaluationVersion") }),
        /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("select", { className: "rolling-skill-select", value: versionId, onChange: (event) => setVersionId(event.target.value), children: versions.map((version) => /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("option", { value: version.id, children: version.versionLabel ?? version.id }, version.id)) })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime12.jsxs)("label", { className: "rolling-skill-field", children: [
        /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("span", { children: t("evaluationCaseScope") }),
        /* @__PURE__ */ (0, import_jsx_runtime12.jsxs)("select", { className: "rolling-skill-select", value: caseScope, onChange: (event) => setCaseScope(event.target.value), children: [
          /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("option", { value: "all", children: t("allCases") }),
          /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("option", { value: "goodcase", children: t("goodcase") }),
          /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("option", { value: "badcase", children: t("badcase") })
        ] })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime12.jsxs)("label", { className: "rolling-skill-field", children: [
        /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("span", { children: t("activationMode") }),
        /* @__PURE__ */ (0, import_jsx_runtime12.jsxs)("select", { className: "rolling-skill-select", value: activationMode, onChange: (event) => setActivationMode(event.target.value), children: [
          /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("option", { value: "explicit", children: t("explicitActivation") }),
          /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("option", { value: "automatic", children: t("automaticActivation") })
        ] })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime12.jsx)(EvaluationRuntimeMatrix, { t, runtimes, values: targetRuntimeIds, primary: targetRuntimeId, onChange: (values) => {
        setTargetRuntimeIds(values);
        setTargetRuntimeId((current) => values.includes(current) ? current : values[0] ?? "");
      }, onPrimary: setTargetRuntimeId }),
      /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("p", { className: installationsReady ? "rolling-skill-inline-success" : "rolling-skill-inline-error", children: installationsReady ? t("installationReady") : t("installationMissing") }),
      /* @__PURE__ */ (0, import_jsx_runtime12.jsxs)("div", { className: "rolling-skill-grid", children: [
        /* @__PURE__ */ (0, import_jsx_runtime12.jsxs)("label", { className: "rolling-skill-field", children: [
          /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("span", { children: t("model") }),
          /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("select", { className: "rolling-skill-select", value: targetModelId, onChange: (event) => setTargetModelId(event.target.value), children: targetModels.map((model) => {
            const id = model.id ?? model.model ?? "";
            return /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("option", { value: id, children: model.displayName ?? id }, id);
          }) })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime12.jsx)(ModelEffortSelect, { label: t("effort"), runtimeDefaultLabel: t("runtimeDefault"), models: targetModels, modelId: targetModelId, value: effort, onChange: setEffort })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime12.jsx)(RuntimeSelect, { t, runtimes, value: judgeRuntimeId, onChange: setJudgeRuntimeId, label: t("judgeRuntime") }),
      /* @__PURE__ */ (0, import_jsx_runtime12.jsxs)("div", { className: "rolling-skill-grid", children: [
        /* @__PURE__ */ (0, import_jsx_runtime12.jsxs)("label", { className: "rolling-skill-field", children: [
          /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("span", { children: t("judgeModel") }),
          /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("select", { className: "rolling-skill-select", value: judgeModelId, onChange: (event) => setJudgeModelId(event.target.value), children: judgeModels.map((model) => {
            const id = model.id ?? model.model ?? "";
            return /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("option", { value: id, children: model.displayName ?? id }, id);
          }) })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime12.jsx)(ModelEffortSelect, { label: t("effort"), runtimeDefaultLabel: t("runtimeDefault"), models: judgeModels, modelId: judgeModelId, value: judgeEffort, onChange: setJudgeEffort })
      ] }),
      error ? /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("p", { className: "rolling-skill-inline-error", role: "alert", children: error }) : null,
      /* @__PURE__ */ (0, import_jsx_runtime12.jsx)(ActionButton, { disabled: busy || !datasetId || !versionId || !targetRuntimeId || !judgeRuntimeId || !installationsReady || caseScope !== "all" && caseIds.length === 0, onClick: () => void start2(), children: t("startEvaluation") })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime12.jsxs)("section", { className: "rolling-skill-panel", children: [
      /* @__PURE__ */ (0, import_jsx_runtime12.jsxs)("div", { className: "rolling-skill-panel-header", children: [
        /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("div", { children: /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("h3", { children: t("evaluationRuns") }) }),
        /* @__PURE__ */ (0, import_jsx_runtime12.jsx)(ActionButton, { size: "sm", onClick: () => setRevision((value) => value + 1), children: t("refresh") })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime12.jsxs)("div", { className: "rolling-skill-list", children: [
        runs.map((run) => /* @__PURE__ */ (0, import_jsx_runtime12.jsxs)("article", { className: "rolling-skill-list-row", children: [
          /* @__PURE__ */ (0, import_jsx_runtime12.jsxs)("div", { children: [
            /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("strong", { children: run.status }),
            /* @__PURE__ */ (0, import_jsx_runtime12.jsxs)("span", { children: [
              run.id,
              " \xB7 ",
              run.caseCount ?? 0,
              " Cases \xB7 ",
              run.runtimeCount ?? 0,
              " Runtimes"
            ] })
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime12.jsxs)("div", { className: "rolling-skill-actions", children: [
            /* @__PURE__ */ (0, import_jsx_runtime12.jsx)(ActionButton, { size: "sm", onClick: () => void inspect(run.id), children: t("details") }),
            ["queued", "running"].includes(run.status) ? /* @__PURE__ */ (0, import_jsx_runtime12.jsx)(ActionButton, { size: "sm", disabled: busy, onClick: () => void mutate(() => requestRollingSkill("evaluations.cancel", { runId: run.id })), children: t("cancelRun") }) : /* @__PURE__ */ (0, import_jsx_runtime12.jsx)(ActionButton, { size: "sm", disabled: busy, onClick: () => {
              if (window.confirm(t("deleteEvaluationConfirm"))) void mutate(() => requestRollingSkill("evaluations.delete", { runId: run.id }));
            }, children: t("delete") })
          ] })
        ] }, run.id)),
        runs.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("p", { children: t("emptyEvaluations") }) : null
      ] })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime12.jsx)(import_dsh_client_ui_primitives6.Modal, { open: detail !== null, onClose: () => setDetail(null), title: t("evaluationDetail"), closeLabel: t("cancel"), footer: /* @__PURE__ */ (0, import_jsx_runtime12.jsx)(ActionButton, { onClick: () => setDetail(null), children: t("close") }), children: detail ? /* @__PURE__ */ (0, import_jsx_runtime12.jsxs)("div", { className: "rolling-skill-detail-stack rolling-skill-evaluation-detail", children: [
      /* @__PURE__ */ (0, import_jsx_runtime12.jsx)(EvaluationRunEvidence, { detail, t }),
      /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("div", { className: "rolling-skill-evaluation-results", children: detail.results.map((result) => /* @__PURE__ */ (0, import_jsx_runtime12.jsx)(EvaluationResultCard, { result, detail, t }, result.id)) })
    ] }) : null })
  ] });
}
function formatDate(value) {
  if (!value) return "\u2014";
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleString() : value;
}
function shortDigest(value) {
  if (!value) return "\u2014";
  return value.length > 32 ? `${value.slice(0, 24)}\u2026${value.slice(-6)}` : value;
}
function runtimeLabel(configuration) {
  if (!configuration) return "\u2014";
  return [configuration.displayName ?? configuration.runtimeId, configuration.version, configuration.modelId, configuration.effort].filter(Boolean).join(" \xB7 ");
}
function EvaluationRunEvidence({ detail, t }) {
  const version = detail.managedVersionSnapshot ?? detail.skillEvidence?.managedSource;
  const rubric = detail.rubricVersionSnapshot;
  return /* @__PURE__ */ (0, import_jsx_runtime12.jsxs)("section", { className: "rolling-skill-evidence-card", children: [
    /* @__PURE__ */ (0, import_jsx_runtime12.jsxs)("div", { className: "rolling-skill-panel-header", children: [
      /* @__PURE__ */ (0, import_jsx_runtime12.jsxs)("div", { children: [
        /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("h4", { children: t("evaluationRunEvidence") }),
        /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("p", { children: t("traceScopeCase") })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("span", { className: "rolling-skill-badge", children: detail.status })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime12.jsxs)("dl", { children: [
      /* @__PURE__ */ (0, import_jsx_runtime12.jsxs)("div", { children: [
        /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("dt", { children: t("evaluationVersion") }),
        /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("dd", { children: version?.versionId ?? t("notAvailable") })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime12.jsxs)("div", { children: [
        /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("dt", { children: t("installationCommit") }),
        /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("dd", { children: /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("code", { children: version?.commit?.slice(0, 12) ?? t("notAvailable") }) })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime12.jsxs)("div", { children: [
        /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("dt", { children: t("installationDigest") }),
        /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("dd", { title: version?.contentDigest ?? void 0, children: /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("code", { children: shortDigest(version?.contentDigest) }) })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime12.jsxs)("div", { children: [
        /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("dt", { children: t("frozenRubric") }),
        /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("dd", { children: rubric ? `v${rubric.version ?? "\u2014"} \xB7 ${rubric.rubric?.title ?? rubric.id ?? "\u2014"}` : t("notAvailable") })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime12.jsxs)("div", { children: [
        /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("dt", { children: t("rubricDigest") }),
        /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("dd", { title: rubric?.rubricDigest ?? void 0, children: /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("code", { children: shortDigest(rubric?.rubricDigest) }) })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime12.jsxs)("div", { children: [
        /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("dt", { children: t("createdAt") }),
        /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("dd", { children: formatDate(detail.createdAt) })
      ] })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("h4", { children: t("targetRuntimeConfiguration") }),
    /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("div", { className: "rolling-skill-audit-grid", children: detail.runtimeConfigurations?.map((runtime) => /* @__PURE__ */ (0, import_jsx_runtime12.jsxs)("article", { className: "rolling-skill-audit-card", children: [
      /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("strong", { children: runtimeLabel(runtime) }),
      /* @__PURE__ */ (0, import_jsx_runtime12.jsxs)("small", { children: [
        t("installationJob"),
        " \xB7 ",
        runtime.installationJobId ?? t("notAvailable"),
        " \xB7 ",
        runtime.installationVerification ?? t("notAvailable")
      ] })
    ] }, runtime.runtimeId ?? runtimeLabel(runtime))) }),
    /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("h4", { children: t("judgeConfiguration") }),
    /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("p", { children: runtimeLabel(detail.judgeConfiguration) })
  ] });
}
function EvaluationResultCard({ result, detail, t }) {
  const score = result.computedScore?.totalScore;
  return /* @__PURE__ */ (0, import_jsx_runtime12.jsxs)("article", { className: "rolling-skill-evaluation-result", children: [
    /* @__PURE__ */ (0, import_jsx_runtime12.jsxs)("header", { children: [
      /* @__PURE__ */ (0, import_jsx_runtime12.jsxs)("div", { children: [
        /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("strong", { children: result.question ?? result.id }),
        /* @__PURE__ */ (0, import_jsx_runtime12.jsxs)("small", { children: [
          result.runtimeId ?? t("notAvailable"),
          " \xB7 ",
          result.durationMs !== void 0 ? `${result.durationMs} ms` : t("notAvailable")
        ] })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime12.jsxs)("span", { className: "rolling-skill-score-total", children: [
        score ?? t("notAvailable"),
        /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("small", { children: "/100" })
      ] })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime12.jsxs)("div", { className: "rolling-skill-actions", children: [
      /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("span", { className: "rolling-skill-badge", children: result.status }),
      /* @__PURE__ */ (0, import_jsx_runtime12.jsxs)("span", { className: "rolling-skill-badge", children: [
        "Judge \xB7 ",
        result.gradingStatus ?? t("notAvailable")
      ] }),
      result.computedScore?.outcomeTier || result.computedScore?.overallVerdict ? /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("span", { className: "rolling-skill-badge", children: result.computedScore.outcomeTier ?? result.computedScore.overallVerdict }) : null
    ] }),
    result.error || result.gradingError ? /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("p", { className: "rolling-skill-inline-error", children: result.error ?? result.gradingError }) : null,
    result.response ? /* @__PURE__ */ (0, import_jsx_runtime12.jsxs)("details", { children: [
      /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("summary", { children: t("evaluationResponse") }),
      /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("pre", { className: "rolling-skill-verbatim", children: result.response })
    ] }) : null,
    /* @__PURE__ */ (0, import_jsx_runtime12.jsx)(EvaluationScoreBreakdown, { result, detail, t }),
    /* @__PURE__ */ (0, import_jsx_runtime12.jsx)(EvaluationTrace, { traceEvidence: result.traceEvidence, t })
  ] });
}
function EvaluationScoreBreakdown({ result, detail, t }) {
  const scores = result.computedScore?.criterionScores ?? [];
  const contract = result.scoreContract?.criteria ?? [];
  const assessments = result.judgment?.assessments ?? [];
  const judge = result.judge ?? detail.judgeConfiguration;
  if (!scores.length && !result.judgment && !result.computedScore) return null;
  return /* @__PURE__ */ (0, import_jsx_runtime12.jsxs)("details", { className: "rolling-skill-score-breakdown", open: true, children: [
    /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("summary", { children: t("scoreBreakdown") }),
    /* @__PURE__ */ (0, import_jsx_runtime12.jsxs)("p", { className: "rolling-skill-judge-meta", children: [
      /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("b", { children: "Judge:" }),
      " ",
      runtimeLabel(judge),
      result.judge?.attempts ? ` \xB7 ${t("judgeAttempts")} ${result.judge.attempts}` : ""
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime12.jsxs)("div", { className: "rolling-skill-score-list", children: [
      scores.map((score) => {
        const criterion = contract.find((entry) => entry.id === score.id);
        const assessment = assessments.find((entry) => entry.criterionId === score.id);
        return /* @__PURE__ */ (0, import_jsx_runtime12.jsxs)("article", { className: score.criticalFailureTriggered ? "rolling-skill-score-item rolling-skill-score-critical" : "rolling-skill-score-item", children: [
          /* @__PURE__ */ (0, import_jsx_runtime12.jsxs)("header", { children: [
            /* @__PURE__ */ (0, import_jsx_runtime12.jsxs)("strong", { children: [
              score.id,
              " \xB7 ",
              criterion?.title ?? criterion?.criterion ?? t("notAvailable")
            ] }),
            /* @__PURE__ */ (0, import_jsx_runtime12.jsxs)("span", { children: [
              score.points ?? t("notAvailable"),
              "/",
              score.maxPoints ?? t("notAvailable")
            ] })
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime12.jsxs)("small", { children: [
            t("weight"),
            " ",
            criterion?.weight ?? t("notAvailable"),
            " \xB7 ",
            t("rating"),
            " ",
            score.rating ?? assessment?.rating ?? t("notAvailable"),
            "/10",
            assessment?.confidence !== void 0 ? ` \xB7 ${t("confidence")} ${Math.round(assessment.confidence * 100)}%` : ""
          ] }),
          criterion?.criterion ? /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("p", { children: criterion.criterion }) : null,
          assessment?.rationale ? /* @__PURE__ */ (0, import_jsx_runtime12.jsxs)("p", { children: [
            /* @__PURE__ */ (0, import_jsx_runtime12.jsxs)("b", { children: [
              t("judgeRationale"),
              ": "
            ] }),
            assessment.rationale
          ] }) : null,
          assessment?.evidenceRefs?.length ? /* @__PURE__ */ (0, import_jsx_runtime12.jsxs)("p", { children: [
            /* @__PURE__ */ (0, import_jsx_runtime12.jsxs)("b", { children: [
              t("evidenceReferences"),
              ": "
            ] }),
            assessment.evidenceRefs.join(" \xB7 ")
          ] }) : null,
          assessment?.verificationStatus ? /* @__PURE__ */ (0, import_jsx_runtime12.jsxs)("p", { children: [
            /* @__PURE__ */ (0, import_jsx_runtime12.jsxs)("b", { children: [
              t("verificationStatus"),
              ": "
            ] }),
            assessment.verificationStatus
          ] }) : null
        ] }, score.id);
      }),
      !scores.length ? /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("p", { children: t("emptyScoreBreakdown") }) : null
    ] })
  ] });
}
function traceEntryLabel(entry) {
  const message = entry.message ?? {};
  const method = typeof message.method === "string" ? message.method : "trace event";
  const params = message.params && typeof message.params === "object" ? message.params : {};
  const item = params.item && typeof params.item === "object" ? params.item : {};
  const update = params.update && typeof params.update === "object" ? params.update : {};
  const title = [entry.direction, method, item.type, item.tool, update.sessionUpdate].filter((value) => typeof value === "string" && value).join(" \xB7 ");
  const detail = [item.command, item.status, item.path, update.status].filter((value) => typeof value === "string" && value).join(" \xB7 ");
  return { title: title || method, detail };
}
function EvaluationTrace({ traceEvidence, t }) {
  if (!traceEvidence) return /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("p", { children: t("emptyTrace") });
  const entries = traceEvidence.entries ?? [];
  return /* @__PURE__ */ (0, import_jsx_runtime12.jsxs)("details", { className: "rolling-skill-trace", open: true, children: [
    /* @__PURE__ */ (0, import_jsx_runtime12.jsxs)("summary", { children: [
      t("evaluationTrace"),
      " \xB7 ",
      entries.length
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime12.jsxs)("div", { className: "rolling-skill-trace-summary", children: [
      /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("span", { className: "rolling-skill-badge", children: t("traceScopeCase") }),
      /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("span", { children: traceEvidence.semanticCoverageComplete ? t("traceComplete") : t("traceCompacted") }),
      traceEvidence.omittedEntries ? /* @__PURE__ */ (0, import_jsx_runtime12.jsxs)("span", { children: [
        t("traceOmitted"),
        " ",
        traceEvidence.omittedEntries
      ] }) : null
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("ol", { className: "rolling-skill-trace-list", children: entries.map((entry, index2) => {
      const label = traceEntryLabel(entry);
      return /* @__PURE__ */ (0, import_jsx_runtime12.jsxs)("li", { children: [
        /* @__PURE__ */ (0, import_jsx_runtime12.jsxs)("code", { children: [
          "L",
          entry.sequence ?? "\u2014"
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime12.jsxs)("span", { children: [
          /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("strong", { children: label.title }),
          label.detail ? /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("small", { children: label.detail }) : null
        ] })
      ] }, `${entry.sequence ?? index2}`);
    }) }),
    entries.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("p", { children: t("emptyTrace") }) : null
  ] });
}
function EvaluationRuntimeMatrix({ t, runtimes, values, primary, onChange, onPrimary }) {
  return /* @__PURE__ */ (0, import_jsx_runtime12.jsxs)("fieldset", { className: "rolling-skill-runtime-select", children: [
    /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("legend", { children: t("evaluationRuntime") }),
    /* @__PURE__ */ (0, import_jsx_runtime12.jsxs)("div", { className: "rolling-skill-runtime-list", children: [
      runtimes.map((runtime) => /* @__PURE__ */ (0, import_jsx_runtime12.jsxs)("label", { className: "rolling-skill-runtime-option", children: [
        /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("input", { type: "checkbox", checked: values.includes(runtime.runtimeId), onChange: (event) => onChange(event.target.checked ? [...values, runtime.runtimeId] : values.filter((value) => value !== runtime.runtimeId)) }),
        /* @__PURE__ */ (0, import_jsx_runtime12.jsxs)("span", { children: [
          /* @__PURE__ */ (0, import_jsx_runtime12.jsxs)("strong", { children: [
            runtime.displayName,
            " ",
            runtime.version
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("code", { children: runtime.executablePath }),
          values.includes(runtime.runtimeId) ? /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("button", { type: "button", className: "rolling-skill-link-button", "aria-pressed": primary === runtime.runtimeId, onClick: (event) => {
            event.preventDefault();
            onPrimary(runtime.runtimeId);
          }, children: primary === runtime.runtimeId ? t("primaryRuntime") : t("makePrimaryRuntime") }) : null
        ] })
      ] }, runtime.runtimeId)),
      runtimes.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("p", { children: t("noRuntimes") }) : null
    ] })
  ] });
}

// src/client/workbench/OperatorPanel.tsx
var import_dsh_client_ui_primitives8 = require("@deepseek-ai/dsh-client-ui-primitives");
var import_react11 = require("react");

// src/client/workbench/RuntimeInteractions.tsx
var import_dsh_client_ui_primitives7 = require("@deepseek-ai/dsh-client-ui-primitives");
var import_react10 = require("react");
var import_jsx_runtime13 = require("react/jsx-runtime");
function RuntimeInteractions({
  t,
  ownerKind,
  ownerId
}) {
  const [items, setItems] = (0, import_react10.useState)([]);
  const [answers, setAnswers] = (0, import_react10.useState)({});
  const [busyId, setBusyId] = (0, import_react10.useState)(null);
  const [error, setError] = (0, import_react10.useState)(null);
  const [revision, setRevision] = (0, import_react10.useState)(0);
  (0, import_react10.useEffect)(() => {
    const controller = new AbortController();
    requestRollingSkill("interactions.list", {
      ownerKind,
      ...ownerId ? { ownerId } : {}
    }, controller.signal).then(setItems).catch((reason) => {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : t("loadError"));
    });
    return () => controller.abort();
  }, [ownerKind, ownerId, revision]);
  (0, import_react10.useEffect)(() => {
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
  return /* @__PURE__ */ (0, import_jsx_runtime13.jsxs)("section", { className: "rolling-skill-subpanel rolling-skill-section-gap", children: [
    /* @__PURE__ */ (0, import_jsx_runtime13.jsx)("h4", { children: t("runtimeInteractions") }),
    error ? /* @__PURE__ */ (0, import_jsx_runtime13.jsx)("p", { className: "rolling-skill-inline-error", role: "alert", children: error }) : null,
    /* @__PURE__ */ (0, import_jsx_runtime13.jsx)("div", { className: "rolling-skill-list", children: items.map((interaction) => /* @__PURE__ */ (0, import_jsx_runtime13.jsx)("article", { className: "rolling-skill-list-row", children: /* @__PURE__ */ (0, import_jsx_runtime13.jsxs)("div", { children: [
      /* @__PURE__ */ (0, import_jsx_runtime13.jsx)("strong", { children: interaction.kind === "permission" ? t("runtimePermissionRequest") : t("runtimeQuestionRequest") }),
      /* @__PURE__ */ (0, import_jsx_runtime13.jsxs)("span", { children: [
        interaction.runtime?.displayName ?? interaction.ownerId,
        " ",
        interaction.runtime?.version ?? "",
        " \xB7 ",
        interaction.jobId ?? interaction.ownerId
      ] }),
      interaction.kind === "permission" ? /* @__PURE__ */ (0, import_jsx_runtime13.jsxs)("div", { className: "rolling-skill-actions", children: [
        (interaction.options ?? []).map((option) => {
          const decision = option.optionId ?? option.id ?? option.value ?? "";
          return /* @__PURE__ */ (0, import_jsx_runtime13.jsx)(ActionButton, { size: "sm", disabled: busyId === interaction.id || !decision, onClick: () => void resolve(interaction, { decision }), children: option.label ?? option.name ?? decision }, decision);
        }),
        /* @__PURE__ */ (0, import_jsx_runtime13.jsx)(ActionButton, { size: "sm", disabled: busyId === interaction.id, onClick: () => void resolve(interaction, { decision: "decline" }), children: t("reject") })
      ] }) : /* @__PURE__ */ (0, import_jsx_runtime13.jsxs)("div", { className: "rolling-skill-detail-stack", children: [
        (interaction.questions ?? []).map((question, index2) => {
          const questionId = question.id ?? question.questionId ?? `question-${index2}`;
          const key = `${interaction.id}:${questionId}`;
          return /* @__PURE__ */ (0, import_jsx_runtime13.jsxs)("label", { className: "rolling-skill-field", children: [
            /* @__PURE__ */ (0, import_jsx_runtime13.jsx)("span", { children: question.prompt ?? question.question ?? questionId }),
            /* @__PURE__ */ (0, import_jsx_runtime13.jsx)(import_dsh_client_ui_primitives7.Input, { value: answers[key] ?? "", onChange: (event) => setAnswers((current) => ({ ...current, [key]: event.target.value })) })
          ] }, questionId);
        }),
        /* @__PURE__ */ (0, import_jsx_runtime13.jsx)(ActionButton, { size: "sm", disabled: busyId === interaction.id, onClick: () => void resolve(interaction, { answers: (interaction.questions ?? []).map((question, index2) => {
          const questionId = question.id ?? question.questionId ?? `question-${index2}`;
          return { questionId, answer: answers[`${interaction.id}:${questionId}`] ?? "" };
        }) }), children: t("submitAnswers") })
      ] })
    ] }) }, interaction.id)) })
  ] });
}

// src/client/workbench/OperatorPanel.tsx
var import_jsx_runtime14 = require("react/jsx-runtime");
function OperatorPanel({ t, initialSessionId }) {
  const [runtimes, setRuntimes] = (0, import_react11.useState)([]);
  const [runtimeId, setRuntimeId] = (0, import_react11.useState)("");
  const [models, setModels] = (0, import_react11.useState)([]);
  const [modelId, setModelId] = (0, import_react11.useState)("");
  const [effort, setEffort] = (0, import_react11.useState)("");
  const [objective, setObjective] = (0, import_react11.useState)("");
  const [datasets, setDatasets] = (0, import_react11.useState)([]);
  const [catalog, setCatalog] = (0, import_react11.useState)({ skills: [], repositories: [] });
  const [summary, setSummary] = (0, import_react11.useState)({
    sessions: [],
    jobs: [],
    approvals: [],
    totals: { sessions: 0, jobs: 0, approvals: 0 }
  });
  const [detail, setDetail] = (0, import_react11.useState)(null);
  const [artifacts, setArtifacts] = (0, import_react11.useState)([]);
  const [message, setMessage] = (0, import_react11.useState)("");
  const [busy, setBusy] = (0, import_react11.useState)(false);
  const [error, setError] = (0, import_react11.useState)(null);
  const [revision, setRevision] = (0, import_react11.useState)(0);
  (0, import_react11.useEffect)(() => {
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
  (0, import_react11.useEffect)(() => {
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
  const start2 = () => mutate(() => requestRollingSkill("operators.start", {
    runtimeId,
    modelId: modelId || null,
    effort: effort || null,
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
  (0, import_react11.useEffect)(() => {
    if (!summary.jobs.some((job) => !["cancelled", "failed", "succeeded"].includes(job.status))) return;
    const timer = window.setInterval(() => {
      setRevision((value) => value + 1);
      if (detail) void inspect(detail.session.id);
    }, 1500);
    return () => window.clearInterval(timer);
  }, [summary.jobs, detail?.session.id]);
  return /* @__PURE__ */ (0, import_jsx_runtime14.jsxs)("section", { className: "rolling-skill-panel", children: [
    /* @__PURE__ */ (0, import_jsx_runtime14.jsxs)("div", { className: "rolling-skill-panel-header", children: [
      /* @__PURE__ */ (0, import_jsx_runtime14.jsxs)("div", { children: [
        /* @__PURE__ */ (0, import_jsx_runtime14.jsx)("h3", { children: t("operatorTitle") }),
        /* @__PURE__ */ (0, import_jsx_runtime14.jsx)("p", { children: t("operatorDescription") })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime14.jsx)(ActionButton, { size: "sm", onClick: () => setRevision((value) => value + 1), children: t("refresh") })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime14.jsx)(RuntimeSelect, { t, runtimes, value: runtimeId, onChange: setRuntimeId, label: t("operatorRuntime") }),
    /* @__PURE__ */ (0, import_jsx_runtime14.jsxs)("div", { className: "rolling-skill-grid", children: [
      /* @__PURE__ */ (0, import_jsx_runtime14.jsxs)("label", { className: "rolling-skill-field", children: [
        /* @__PURE__ */ (0, import_jsx_runtime14.jsx)("span", { children: t("model") }),
        /* @__PURE__ */ (0, import_jsx_runtime14.jsx)("select", { className: "rolling-skill-select", value: modelId, onChange: (event) => setModelId(event.target.value), children: models.map((model) => {
          const id = model.id ?? model.model ?? "";
          return /* @__PURE__ */ (0, import_jsx_runtime14.jsx)("option", { value: id, children: model.displayName ?? id }, id);
        }) })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime14.jsx)(ModelEffortSelect, { label: t("effort"), runtimeDefaultLabel: t("runtimeDefault"), models, modelId, value: effort, onChange: setEffort })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime14.jsxs)("label", { className: "rolling-skill-field", children: [
      /* @__PURE__ */ (0, import_jsx_runtime14.jsx)("span", { children: t("operatorObjective") }),
      /* @__PURE__ */ (0, import_jsx_runtime14.jsx)(import_dsh_client_ui_primitives8.Input, { value: objective, placeholder: t("operatorObjectivePlaceholder"), onChange: (event) => setObjective(event.target.value) })
    ] }),
    error ? /* @__PURE__ */ (0, import_jsx_runtime14.jsx)("p", { className: "rolling-skill-inline-error", role: "alert", children: error }) : null,
    /* @__PURE__ */ (0, import_jsx_runtime14.jsx)(ActionButton, { disabled: busy || !runtimeId || !objective.trim(), onClick: () => void start2(), children: t("startOperator") }),
    /* @__PURE__ */ (0, import_jsx_runtime14.jsxs)("div", { className: "rolling-skill-list rolling-skill-section-gap", children: [
      summary.sessions.map((session) => {
        const job = parentJob(session.id);
        return /* @__PURE__ */ (0, import_jsx_runtime14.jsxs)("article", { className: "rolling-skill-list-row", children: [
          /* @__PURE__ */ (0, import_jsx_runtime14.jsxs)("div", { children: [
            /* @__PURE__ */ (0, import_jsx_runtime14.jsx)("strong", { children: job?.status ?? t("notAvailable") }),
            /* @__PURE__ */ (0, import_jsx_runtime14.jsxs)("span", { children: [
              session.runtime.displayName,
              " ",
              session.runtime.version || "",
              " \xB7 ",
              session.modelId || session.id
            ] }),
            /* @__PURE__ */ (0, import_jsx_runtime14.jsx)("small", { children: job?.objective })
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime14.jsxs)("div", { className: "rolling-skill-actions", children: [
            /* @__PURE__ */ (0, import_jsx_runtime14.jsx)(ActionButton, { size: "sm", onClick: () => void inspect(session.id), children: t("details") }),
            job?.status === "running" ? /* @__PURE__ */ (0, import_jsx_runtime14.jsx)(ActionButton, { size: "sm", disabled: busy, onClick: () => void mutate(() => requestRollingSkill("operators.pause", { sessionId: session.id })), children: t("pause") }) : null,
            ["paused", "needs_recovery"].includes(job?.status ?? "") ? /* @__PURE__ */ (0, import_jsx_runtime14.jsx)(ActionButton, { size: "sm", disabled: busy, onClick: () => void mutate(() => requestRollingSkill("operators.resume", { sessionId: session.id })), children: t("resume") }) : null,
            !["cancelled", "failed", "succeeded"].includes(job?.status ?? "") ? /* @__PURE__ */ (0, import_jsx_runtime14.jsx)(ActionButton, { size: "sm", disabled: busy, onClick: () => void mutate(() => requestRollingSkill("operators.cancel", { sessionId: session.id })), children: t("cancelRun") }) : null
          ] })
        ] }, session.id);
      }),
      summary.sessions.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime14.jsx)("p", { children: t("emptyOperators") }) : null
    ] }),
    pendingApprovals.length ? /* @__PURE__ */ (0, import_jsx_runtime14.jsxs)("div", { className: "rolling-skill-subpanel rolling-skill-section-gap", children: [
      /* @__PURE__ */ (0, import_jsx_runtime14.jsx)("h4", { children: t("pendingApprovals") }),
      pendingApprovals.map((approval) => {
        const job = summary.jobs.find((item) => item.id === approval.jobId);
        return /* @__PURE__ */ (0, import_jsx_runtime14.jsxs)("article", { className: "rolling-skill-list-row", children: [
          /* @__PURE__ */ (0, import_jsx_runtime14.jsxs)("div", { children: [
            /* @__PURE__ */ (0, import_jsx_runtime14.jsx)("strong", { children: approval.action }),
            /* @__PURE__ */ (0, import_jsx_runtime14.jsx)("span", { children: approval.risk })
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime14.jsxs)("div", { className: "rolling-skill-actions", children: [
            /* @__PURE__ */ (0, import_jsx_runtime14.jsx)(ActionButton, { size: "sm", disabled: busy || !job, onClick: () => void mutate(() => requestRollingSkill("operators.approve", { sessionId: job?.sessionId, approvalId: approval.id, decision: "approve", scope: "once" })), children: t("approve") }),
            /* @__PURE__ */ (0, import_jsx_runtime14.jsx)(ActionButton, { size: "sm", disabled: busy || !job, onClick: () => void mutate(() => requestRollingSkill("operators.approve", { sessionId: job?.sessionId, approvalId: approval.id, decision: "reject", scope: "once" })), children: t("reject") })
          ] })
        ] }, approval.id);
      })
    ] }) : null,
    /* @__PURE__ */ (0, import_jsx_runtime14.jsx)(RuntimeInteractions, { t, ownerKind: "operator" }),
    /* @__PURE__ */ (0, import_jsx_runtime14.jsx)(import_dsh_client_ui_primitives8.Modal, { open: detail !== null, onClose: () => setDetail(null), title: t("operatorDetail"), closeLabel: t("close"), footer: /* @__PURE__ */ (0, import_jsx_runtime14.jsx)(ActionButton, { onClick: () => setDetail(null), children: t("close") }), children: detail ? /* @__PURE__ */ (0, import_jsx_runtime14.jsxs)("div", { className: "rolling-skill-detail-stack", children: [
      /* @__PURE__ */ (0, import_jsx_runtime14.jsxs)("p", { children: [
        /* @__PURE__ */ (0, import_jsx_runtime14.jsx)("strong", { children: detail.state }),
        " \xB7 ",
        detail.session.runtime.displayName,
        " \xB7 ",
        detail.parentJob.objective
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime14.jsxs)("section", { className: "rolling-skill-subpanel", children: [
        /* @__PURE__ */ (0, import_jsx_runtime14.jsx)("h4", { children: t("operatorTranscript") }),
        /* @__PURE__ */ (0, import_jsx_runtime14.jsxs)("div", { className: "rolling-skill-list", children: [
          (detail.session.transcript ?? []).map((entry, index2) => /* @__PURE__ */ (0, import_jsx_runtime14.jsx)("article", { className: "rolling-skill-list-row", children: /* @__PURE__ */ (0, import_jsx_runtime14.jsxs)("div", { children: [
            /* @__PURE__ */ (0, import_jsx_runtime14.jsx)("strong", { children: String(entry.kind ?? t("notAvailable")) }),
            /* @__PURE__ */ (0, import_jsx_runtime14.jsx)("pre", { children: JSON.stringify(entry, null, 2) })
          ] }) }, String(entry.id ?? index2))),
          !detail.session.transcript?.length ? /* @__PURE__ */ (0, import_jsx_runtime14.jsx)("p", { children: t("emptyOperatorTranscript") }) : null
        ] })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime14.jsxs)("section", { className: "rolling-skill-subpanel", children: [
        /* @__PURE__ */ (0, import_jsx_runtime14.jsx)("h4", { children: t("operatorArtifacts") }),
        /* @__PURE__ */ (0, import_jsx_runtime14.jsxs)("div", { className: "rolling-skill-list", children: [
          artifacts.map((artifact) => /* @__PURE__ */ (0, import_jsx_runtime14.jsx)("article", { className: "rolling-skill-list-row", children: /* @__PURE__ */ (0, import_jsx_runtime14.jsxs)("div", { children: [
            /* @__PURE__ */ (0, import_jsx_runtime14.jsx)("strong", { children: artifact.name ?? artifact.id }),
            /* @__PURE__ */ (0, import_jsx_runtime14.jsxs)("span", { children: [
              artifact.mediaType ?? "",
              " ",
              artifact.byteLength === void 0 ? "" : `\xB7 ${artifact.byteLength} B`
            ] })
          ] }) }, artifact.id)),
          artifacts.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime14.jsx)("p", { children: t("emptyOperatorArtifacts") }) : null
        ] })
      ] }),
      !["cancelled", "failed", "succeeded"].includes(detail.parentJob.status) ? /* @__PURE__ */ (0, import_jsx_runtime14.jsxs)("div", { className: "rolling-skill-actions", children: [
        /* @__PURE__ */ (0, import_jsx_runtime14.jsx)(import_dsh_client_ui_primitives8.Input, { value: message, placeholder: t("operatorFollowUp"), onChange: (event) => setMessage(event.target.value) }),
        /* @__PURE__ */ (0, import_jsx_runtime14.jsx)(ActionButton, { disabled: busy || !message.trim(), onClick: () => void send(), children: t("send") })
      ] }) : null
    ] }) : null })
  ] });
}

// src/client/workbench/OptimizationPanel.tsx
var import_dsh_client_ui_primitives9 = require("@deepseek-ai/dsh-client-ui-primitives");
var import_react12 = require("react");
var import_jsx_runtime15 = require("react/jsx-runtime");
function OptimizationPanel({ t, initialRunId }) {
  const [runtimes, setRuntimes] = (0, import_react12.useState)([]);
  const [datasets, setDatasets] = (0, import_react12.useState)([]);
  const [catalog, setCatalog] = (0, import_react12.useState)({ skills: [] });
  const [detail, setDetail] = (0, import_react12.useState)(null);
  const [runs, setRuns] = (0, import_react12.useState)([]);
  const [skillId, setSkillId] = (0, import_react12.useState)("");
  const [versionId, setVersionId] = (0, import_react12.useState)("");
  const [datasetId, setDatasetId] = (0, import_react12.useState)("");
  const [operatorRuntimeId, setOperatorRuntimeId] = (0, import_react12.useState)("");
  const [targetRuntimeId, setTargetRuntimeId] = (0, import_react12.useState)("");
  const [judgeRuntimeId, setJudgeRuntimeId] = (0, import_react12.useState)("");
  const [preflightReady, setPreflightReady] = (0, import_react12.useState)(false);
  const [preflightResult, setPreflightResult] = (0, import_react12.useState)(null);
  const [runDetail, setRunDetail] = (0, import_react12.useState)(null);
  const [report, setReport] = (0, import_react12.useState)(null);
  const [busy, setBusy] = (0, import_react12.useState)(false);
  const [error, setError] = (0, import_react12.useState)(null);
  const [revision, setRevision] = (0, import_react12.useState)(0);
  (0, import_react12.useEffect)(() => {
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
  (0, import_react12.useEffect)(() => {
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
  const released = (0, import_react12.useMemo)(() => detail?.versions.filter((version) => version.state === "released") ?? [], [detail]);
  const compatibleDatasets = (0, import_react12.useMemo)(() => datasets.filter((dataset) => dataset.skillReference?.id === detail?.skill.id && dataset.skillReference?.repositoryId === detail?.skill.repositoryId && Boolean(dataset.activeRubricVersionId)), [datasets, detail]);
  const configuration = () => ({
    skillId,
    baselineVersionId: versionId,
    datasetId,
    operator: { runtimeId: operatorRuntimeId, effort: null },
    targets: [{ runtimeId: targetRuntimeId, effort: null }],
    judge: { runtimeId: judgeRuntimeId, effort: null },
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
  const start2 = () => mutate(async () => {
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
  (0, import_react12.useEffect)(() => {
    if (!runs.some((run) => !["completed", "failed", "cancelled"].includes(run.state))) return;
    const timer = window.setInterval(() => {
      setRevision((value) => value + 1);
      if (runDetail) void inspect(runDetail.id);
    }, 1500);
    return () => window.clearInterval(timer);
  }, [runs, runDetail?.id]);
  return /* @__PURE__ */ (0, import_jsx_runtime15.jsxs)("section", { className: "rolling-skill-panel", children: [
    /* @__PURE__ */ (0, import_jsx_runtime15.jsxs)("div", { className: "rolling-skill-panel-header", children: [
      /* @__PURE__ */ (0, import_jsx_runtime15.jsxs)("div", { children: [
        /* @__PURE__ */ (0, import_jsx_runtime15.jsx)("h3", { children: t("optimizationTitle") }),
        /* @__PURE__ */ (0, import_jsx_runtime15.jsx)("p", { children: t("optimizationDescription") })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime15.jsx)(ActionButton, { size: "sm", onClick: () => setRevision((value) => value + 1), children: t("refresh") })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime15.jsxs)("div", { className: "rolling-skill-grid", children: [
      /* @__PURE__ */ (0, import_jsx_runtime15.jsxs)("label", { className: "rolling-skill-field", children: [
        /* @__PURE__ */ (0, import_jsx_runtime15.jsx)("span", { children: t("optimizationSkill") }),
        /* @__PURE__ */ (0, import_jsx_runtime15.jsx)("select", { className: "rolling-skill-select", value: skillId, onChange: (event) => setSkillId(event.target.value), children: catalog.skills.map((skill) => /* @__PURE__ */ (0, import_jsx_runtime15.jsx)("option", { value: skill.id, children: skill.name }, skill.id)) })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime15.jsxs)("label", { className: "rolling-skill-field", children: [
        /* @__PURE__ */ (0, import_jsx_runtime15.jsx)("span", { children: t("optimizationBaseline") }),
        /* @__PURE__ */ (0, import_jsx_runtime15.jsx)("select", { className: "rolling-skill-select", value: versionId, onChange: (event) => {
          setVersionId(event.target.value);
          setPreflightReady(false);
        }, children: released.map((version) => /* @__PURE__ */ (0, import_jsx_runtime15.jsx)("option", { value: version.id, children: version.versionLabel || version.id }, version.id)) })
      ] })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime15.jsxs)("label", { className: "rolling-skill-field", children: [
      /* @__PURE__ */ (0, import_jsx_runtime15.jsx)("span", { children: t("selectDataset") }),
      /* @__PURE__ */ (0, import_jsx_runtime15.jsx)("select", { className: "rolling-skill-select", value: datasetId, onChange: (event) => {
        setDatasetId(event.target.value);
        setPreflightReady(false);
      }, children: compatibleDatasets.map((dataset) => /* @__PURE__ */ (0, import_jsx_runtime15.jsx)("option", { value: dataset.id, children: dataset.name }, dataset.id)) })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime15.jsx)(RuntimeSelect, { t, runtimes, value: operatorRuntimeId, onChange: (value) => {
      setOperatorRuntimeId(value);
      setPreflightReady(false);
    }, label: t("operatorRuntime") }),
    /* @__PURE__ */ (0, import_jsx_runtime15.jsx)(RuntimeSelect, { t, runtimes, value: targetRuntimeId, onChange: (value) => {
      setTargetRuntimeId(value);
      setPreflightReady(false);
    }, label: t("optimizationTargetRuntime") }),
    /* @__PURE__ */ (0, import_jsx_runtime15.jsx)(RuntimeSelect, { t, runtimes, value: judgeRuntimeId, onChange: (value) => {
      setJudgeRuntimeId(value);
      setPreflightReady(false);
    }, label: t("judgeRuntime") }),
    error ? /* @__PURE__ */ (0, import_jsx_runtime15.jsx)("p", { className: "rolling-skill-inline-error", role: "alert", children: error }) : null,
    /* @__PURE__ */ (0, import_jsx_runtime15.jsxs)("div", { className: "rolling-skill-actions", children: [
      /* @__PURE__ */ (0, import_jsx_runtime15.jsx)(ActionButton, { disabled: busy || !ready, onClick: () => void preflight(), children: t("optimizationPreflight") }),
      /* @__PURE__ */ (0, import_jsx_runtime15.jsx)(ActionButton, { disabled: busy || !preflightReady, onClick: () => void start2(), children: t("startOptimization") })
    ] }),
    preflightResult ? /* @__PURE__ */ (0, import_jsx_runtime15.jsxs)("section", { className: "rolling-skill-subpanel rolling-skill-section-gap", children: [
      /* @__PURE__ */ (0, import_jsx_runtime15.jsx)("h4", { children: t("optimizationPreflightResult") }),
      /* @__PURE__ */ (0, import_jsx_runtime15.jsx)("pre", { children: JSON.stringify(preflightResult, null, 2) })
    ] }) : null,
    /* @__PURE__ */ (0, import_jsx_runtime15.jsxs)("div", { className: "rolling-skill-list rolling-skill-section-gap", children: [
      runs.map((run) => /* @__PURE__ */ (0, import_jsx_runtime15.jsxs)("article", { className: "rolling-skill-list-row", children: [
        /* @__PURE__ */ (0, import_jsx_runtime15.jsxs)("div", { children: [
          /* @__PURE__ */ (0, import_jsx_runtime15.jsx)("strong", { children: run.state }),
          /* @__PURE__ */ (0, import_jsx_runtime15.jsxs)("span", { children: [
            run.id,
            " \xB7 Epoch ",
            run.currentEpoch ?? 0
          ] }),
          run.error?.message ? /* @__PURE__ */ (0, import_jsx_runtime15.jsx)("small", { children: run.error.message }) : null
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime15.jsxs)("div", { className: "rolling-skill-actions", children: [
          /* @__PURE__ */ (0, import_jsx_runtime15.jsx)(ActionButton, { size: "sm", onClick: () => void inspect(run.id), children: t("details") }),
          !["paused", "completed", "failed", "cancelled"].includes(run.state) ? /* @__PURE__ */ (0, import_jsx_runtime15.jsx)(ActionButton, { size: "sm", disabled: busy, onClick: () => void mutate(() => requestRollingSkill("optimizations.pause", { runId: run.id })), children: t("pause") }) : null,
          ["paused", "needs_recovery"].includes(run.state) ? /* @__PURE__ */ (0, import_jsx_runtime15.jsx)(ActionButton, { size: "sm", disabled: busy, onClick: () => void mutate(() => requestRollingSkill("optimizations.resume", { runId: run.id })), children: t("resume") }) : null,
          !["completed", "failed", "cancelled"].includes(run.state) ? /* @__PURE__ */ (0, import_jsx_runtime15.jsx)(ActionButton, { size: "sm", disabled: busy, onClick: () => void mutate(() => requestRollingSkill("optimizations.cancel", { runId: run.id })), children: t("cancelRun") }) : null
        ] })
      ] }, run.id)),
      runs.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime15.jsx)("p", { children: t("emptyOptimizations") }) : null
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime15.jsx)(import_dsh_client_ui_primitives9.Modal, { open: runDetail !== null, onClose: () => setRunDetail(null), title: t("optimizationDetail"), closeLabel: t("close"), footer: /* @__PURE__ */ (0, import_jsx_runtime15.jsxs)(import_jsx_runtime15.Fragment, { children: [
      /* @__PURE__ */ (0, import_jsx_runtime15.jsx)(ActionButton, { disabled: busy, onClick: () => void generateReport(), children: t("generateOptimizationReport") }),
      /* @__PURE__ */ (0, import_jsx_runtime15.jsx)(ActionButton, { onClick: () => setRunDetail(null), children: t("close") })
    ] }), children: runDetail ? /* @__PURE__ */ (0, import_jsx_runtime15.jsxs)("div", { className: "rolling-skill-detail-stack", children: [
      /* @__PURE__ */ (0, import_jsx_runtime15.jsxs)("p", { children: [
        /* @__PURE__ */ (0, import_jsx_runtime15.jsx)("strong", { children: runDetail.state }),
        " \xB7 ",
        runDetail.id,
        " \xB7 Epoch ",
        runDetail.currentEpoch ?? 0
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime15.jsx)("pre", { children: JSON.stringify({ snapshotDigest: runDetail.snapshotDigest, baseline: runDetail.baseline, dataset: runDetail.dataset, rubric: runDetail.rubric, operator: runDetail.operator, targets: runDetail.targets, judge: runDetail.judge, checkpoint: runDetail.checkpoint, error: runDetail.error }, null, 2) }),
      /* @__PURE__ */ (0, import_jsx_runtime15.jsxs)("section", { className: "rolling-skill-subpanel", children: [
        /* @__PURE__ */ (0, import_jsx_runtime15.jsx)("h4", { children: t("optimizationTimeline") }),
        /* @__PURE__ */ (0, import_jsx_runtime15.jsxs)("div", { className: "rolling-skill-list", children: [
          (runDetail.epochs ?? []).map((epoch) => /* @__PURE__ */ (0, import_jsx_runtime15.jsx)("article", { className: "rolling-skill-list-row", children: /* @__PURE__ */ (0, import_jsx_runtime15.jsxs)("div", { children: [
            /* @__PURE__ */ (0, import_jsx_runtime15.jsxs)("strong", { children: [
              "Epoch ",
              epoch.number,
              " \xB7 ",
              epoch.status
            ] }),
            /* @__PURE__ */ (0, import_jsx_runtime15.jsxs)("span", { children: [
              epoch.candidate?.versionId ?? t("notAvailable"),
              " \xB7 ",
              epoch.analysis?.score ?? t("notAvailable"),
              " / \u0394 ",
              epoch.analysis?.scoreDelta ?? t("notAvailable")
            ] }),
            /* @__PURE__ */ (0, import_jsx_runtime15.jsxs)("small", { children: [
              epoch.decision?.action,
              " ",
              epoch.decision?.rationale
            ] }),
            /* @__PURE__ */ (0, import_jsx_runtime15.jsx)("pre", { children: JSON.stringify({ candidate: epoch.candidate ?? null, installations: epoch.installations ?? [], analysis: epoch.analysis ?? null, decision: epoch.decision ?? null }, null, 2) })
          ] }) }, epoch.number)),
          !runDetail.epochs?.length ? /* @__PURE__ */ (0, import_jsx_runtime15.jsx)("p", { children: t("emptyOptimizationTimeline") }) : null
        ] })
      ] }),
      report ? /* @__PURE__ */ (0, import_jsx_runtime15.jsxs)("section", { className: "rolling-skill-subpanel", children: [
        /* @__PURE__ */ (0, import_jsx_runtime15.jsx)("h4", { children: t("optimizationReport") }),
        /* @__PURE__ */ (0, import_jsx_runtime15.jsxs)("p", { children: [
          /* @__PURE__ */ (0, import_jsx_runtime15.jsx)("code", { children: report.artifactId }),
          " \xB7 ",
          /* @__PURE__ */ (0, import_jsx_runtime15.jsx)("code", { children: report.digest })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime15.jsx)("pre", { className: "rolling-skill-verbatim", children: report.preview ?? t("notAvailable") })
      ] }) : null
    ] }) : null })
  ] });
}

// src/client/workbench/RawCasesPanel.tsx
var import_dsh_client_ui_primitives10 = require("@deepseek-ai/dsh-client-ui-primitives");
var import_react13 = require("react");
var import_raw_case_evidence = __toESM(require_raw_case_evidence(), 1);
var import_raw_case_skill_filter = __toESM(require_raw_case_skill_filter(), 1);
var import_jsx_runtime16 = require("react/jsx-runtime");
var rawCaseEvidence = import_raw_case_evidence.default.rawCaseEvidence;
var evidenceTimeline = import_raw_case_evidence.default.evidenceTimeline;
var rawCaseSkillOptions = import_raw_case_skill_filter.default.rawCaseSkillOptions;
var rawCaseSkillGroups = import_raw_case_skill_filter.default.rawCaseSkillGroups;
var resolveRawCaseSkillScope = import_raw_case_skill_filter.default.resolveRawCaseSkillScope;
function dateTime(value, fallback) {
  if (!value) return fallback;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleString() : fallback;
}
function confidence(value, fallback) {
  return typeof value === "number" && Number.isFinite(value) ? `${Math.round(value * 100)}%` : fallback;
}
function detailText(value) {
  if (value === null || value === void 0 || value === "") return null;
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}
function RawCasesPanel({ t, revision, onChanged, initialRawCaseId, onNavigate }) {
  const [entries, setEntries] = (0, import_react13.useState)([]);
  const [catalog, setCatalog] = (0, import_react13.useState)({ repositories: [], skills: [] });
  const [datasets, setDatasets] = (0, import_react13.useState)([]);
  const [search2, setSearch] = (0, import_react13.useState)("");
  const [skillScope, setSkillScope] = (0, import_react13.useState)("all");
  const [adding, setAdding] = (0, import_react13.useState)(false);
  const [editing, setEditing] = (0, import_react13.useState)(null);
  const [question, setQuestion] = (0, import_react13.useState)("");
  const [note, setNote] = (0, import_react13.useState)("");
  const [skillId, setSkillId] = (0, import_react13.useState)("");
  const [deleting, setDeleting] = (0, import_react13.useState)(null);
  const [inspecting, setInspecting] = (0, import_react13.useState)(null);
  const [drafting, setDrafting] = (0, import_react13.useState)(null);
  const [draftDatasetId, setDraftDatasetId] = (0, import_react13.useState)("");
  const [busy, setBusy] = (0, import_react13.useState)(false);
  const [error, setError] = (0, import_react13.useState)(null);
  const [dispatchedSessionId, setDispatchedSessionId] = (0, import_react13.useState)(null);
  const [loadedEvidence, setLoadedEvidence] = (0, import_react13.useState)(null);
  const [evidenceLoading, setEvidenceLoading] = (0, import_react13.useState)(false);
  const [evidenceError, setEvidenceError] = (0, import_react13.useState)(null);
  const [evidenceAttempt, setEvidenceAttempt] = (0, import_react13.useState)(0);
  const activeSessionId = (0, import_react13.useSyncExternalStore)(
    subscribeActiveConversationSession,
    activeConversationSessionSnapshot,
    () => null
  );
  const evidence = (0, import_react13.useMemo)(
    () => rawCaseEvidence(inspecting?.source, activeSessionId),
    [inspecting?.source, activeSessionId]
  );
  const timeline = (0, import_react13.useMemo)(
    () => evidenceTimeline(loadedEvidence?.episode),
    [loadedEvidence?.episode]
  );
  const skillOptions = (0, import_react13.useMemo)(() => rawCaseSkillOptions(entries), [entries]);
  const filteredGroups = (0, import_react13.useMemo)(
    () => rawCaseSkillGroups(entries, search2, skillScope),
    [entries, search2, skillScope]
  );
  (0, import_react13.useEffect)(() => {
    const controller = new AbortController();
    Promise.all([
      requestRollingSkill("rawCases.list", {}, controller.signal),
      requestRollingSkill("skills.catalog", {}, controller.signal),
      requestRollingSkill("datasets.list", {}, controller.signal)
    ]).then(([rawCases, nextCatalog, datasetItems]) => {
      setEntries(rawCases);
      setCatalog(nextCatalog);
      setDatasets(datasetItems);
      const valid2 = nextCatalog.skills.filter((skill) => skill.status === "valid");
      setSkillId((current) => valid2.some((skill) => skill.id === current) ? current : valid2[0]?.id ?? "");
      if (initialRawCaseId) setInspecting(rawCases.find((entry) => entry.id === initialRawCaseId) ?? null);
    }).catch((reason) => {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : t("loadError"));
    });
    return () => controller.abort();
  }, [revision, initialRawCaseId]);
  (0, import_react13.useEffect)(() => {
    setSkillScope((current) => resolveRawCaseSkillScope(current, entries));
  }, [entries]);
  (0, import_react13.useEffect)(() => {
    const controller = new AbortController();
    setLoadedEvidence(null);
    setEvidenceError(null);
    if (!inspecting || !evidence.observation) {
      setEvidenceLoading(false);
      return () => controller.abort();
    }
    setEvidenceLoading(true);
    requestRollingSkill(
      "rawCases.evidence",
      { id: inspecting.id },
      controller.signal
    ).then((value) => {
      if (!controller.signal.aborted) setLoadedEvidence(value);
    }).catch((reason) => {
      if (!controller.signal.aborted) {
        setEvidenceError(reason instanceof Error ? reason.message : t("captureEvidenceLoadError"));
      }
    }).finally(() => {
      if (!controller.signal.aborted) setEvidenceLoading(false);
    });
    return () => controller.abort();
  }, [inspecting?.id, evidence.observation, evidenceAttempt]);
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
  const viewCaptureRange = () => {
    const observation = evidence.observation;
    if (!evidence.canRevealRange || !observation?.threadId || evidence.startSeq === null || evidence.endSeq === null) return;
    window.dispatchEvent(new CustomEvent("rolling-skill:reveal-capture-range", { detail: {
      sessionId: observation.threadId,
      startSeq: evidence.startSeq,
      endSeq: evidence.endSeq
    } }));
    setInspecting(null);
    window.dispatchEvent(new CustomEvent("rolling-skill:close-workbench"));
  };
  const form = /* @__PURE__ */ (0, import_jsx_runtime16.jsxs)("div", { className: "rolling-skill-form-stack", children: [
    /* @__PURE__ */ (0, import_jsx_runtime16.jsxs)("label", { children: [
      /* @__PURE__ */ (0, import_jsx_runtime16.jsx)("span", { children: t("question") }),
      /* @__PURE__ */ (0, import_jsx_runtime16.jsx)("textarea", { value: question, onChange: (event) => setQuestion(event.target.value) })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime16.jsxs)("label", { children: [
      /* @__PURE__ */ (0, import_jsx_runtime16.jsx)("span", { children: t("datasetSkill") }),
      /* @__PURE__ */ (0, import_jsx_runtime16.jsx)("select", { className: "rolling-skill-select", value: skillId, onChange: (event) => setSkillId(event.target.value), children: catalog.skills.filter((skill) => skill.status === "valid").map((skill) => {
        const repository = catalog.repositories.find((entry) => entry.id === skill.repositoryId);
        return /* @__PURE__ */ (0, import_jsx_runtime16.jsxs)("option", { value: skill.id, children: [
          skill.name,
          " \xB7 ",
          repository?.displayName ?? skill.repositoryId
        ] }, skill.id);
      }) })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime16.jsxs)("label", { children: [
      /* @__PURE__ */ (0, import_jsx_runtime16.jsx)("span", { children: t("note") }),
      /* @__PURE__ */ (0, import_jsx_runtime16.jsx)(import_dsh_client_ui_primitives10.Input, { value: note, onChange: (event) => setNote(event.target.value) })
    ] })
  ] });
  return /* @__PURE__ */ (0, import_jsx_runtime16.jsxs)("section", { className: "rolling-skill-panel rolling-skill-data-panel", children: [
    /* @__PURE__ */ (0, import_jsx_runtime16.jsxs)("div", { className: "rolling-skill-panel-header", children: [
      /* @__PURE__ */ (0, import_jsx_runtime16.jsxs)("div", { children: [
        /* @__PURE__ */ (0, import_jsx_runtime16.jsx)("h3", { children: t("rawCasesTitle") }),
        /* @__PURE__ */ (0, import_jsx_runtime16.jsx)("p", { children: t("rawCasesDescription") })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime16.jsx)(ActionButton, { size: "sm", disabled: !catalog.skills.some((skill) => skill.status === "valid"), onClick: beginAdd, children: t("addRawCase") })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime16.jsxs)("div", { className: "rolling-skill-raw-filter-toolbar", children: [
      /* @__PURE__ */ (0, import_jsx_runtime16.jsx)(import_dsh_client_ui_primitives10.Input, { value: search2, placeholder: t("searchRawCases"), "aria-label": t("searchRawCases"), onChange: (event) => setSearch(event.target.value) }),
      /* @__PURE__ */ (0, import_jsx_runtime16.jsxs)("label", { className: "rolling-skill-raw-skill-select", children: [
        /* @__PURE__ */ (0, import_jsx_runtime16.jsx)("span", { children: t("rawCaseSkillFilter") }),
        /* @__PURE__ */ (0, import_jsx_runtime16.jsxs)("select", { className: "rolling-skill-select", "aria-label": t("rawCaseSkillFilter"), value: skillScope, onChange: (event) => setSkillScope(event.target.value), children: [
          /* @__PURE__ */ (0, import_jsx_runtime16.jsxs)("option", { value: "all", children: [
            t("allSkills"),
            " \xB7 ",
            entries.length
          ] }),
          skillOptions.map((option) => /* @__PURE__ */ (0, import_jsx_runtime16.jsxs)("option", { value: option.key, children: [
            option.name,
            " \xB7 ",
            option.count
          ] }, option.key))
        ] })
      ] })
    ] }),
    error ? /* @__PURE__ */ (0, import_jsx_runtime16.jsx)("p", { className: "rolling-skill-inline-error", role: "alert", children: error }) : null,
    dispatchedSessionId ? /* @__PURE__ */ (0, import_jsx_runtime16.jsxs)("p", { className: "rolling-skill-inline-success", children: [
      t("rawCaseDispatched"),
      " ",
      /* @__PURE__ */ (0, import_jsx_runtime16.jsx)("code", { children: dispatchedSessionId })
    ] }) : null,
    /* @__PURE__ */ (0, import_jsx_runtime16.jsxs)("div", { className: "rolling-skill-group-list", children: [
      filteredGroups.map((group) => /* @__PURE__ */ (0, import_jsx_runtime16.jsxs)("section", { className: "rolling-skill-raw-group", children: [
        /* @__PURE__ */ (0, import_jsx_runtime16.jsxs)(
          "button",
          {
            type: "button",
            className: "rolling-skill-raw-group-filter",
            "aria-pressed": skillScope === group.key,
            onClick: () => setSkillScope((current) => current === group.key ? "all" : group.key),
            children: [
              /* @__PURE__ */ (0, import_jsx_runtime16.jsx)("strong", { children: group.name }),
              /* @__PURE__ */ (0, import_jsx_runtime16.jsx)("span", { children: group.items.length })
            ]
          }
        ),
        /* @__PURE__ */ (0, import_jsx_runtime16.jsx)("div", { className: "rolling-skill-list", children: group.items.map((entry) => /* @__PURE__ */ (0, import_jsx_runtime16.jsxs)("article", { className: "rolling-skill-list-row", children: [
          /* @__PURE__ */ (0, import_jsx_runtime16.jsxs)("div", { children: [
            /* @__PURE__ */ (0, import_jsx_runtime16.jsx)("strong", { className: "rolling-skill-verbatim", children: entry.question }),
            /* @__PURE__ */ (0, import_jsx_runtime16.jsxs)("span", { children: [
              entry.source?.kind ?? t("manualSource"),
              entry.note ? ` \xB7 ${entry.note}` : ""
            ] })
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime16.jsxs)("div", { className: "rolling-skill-actions", children: [
            /* @__PURE__ */ (0, import_jsx_runtime16.jsx)(ActionButton, { size: "sm", onClick: () => setInspecting(entry), children: t("captureEvidence") }),
            hasCompleteEpisode(entry) ? /* @__PURE__ */ (0, import_jsx_runtime16.jsx)(ActionButton, { size: "sm", disabled: compatibleDatasets(entry).length === 0, onClick: () => beginDraft(entry), children: t("createCaseDraft") }) : /* @__PURE__ */ (0, import_jsx_runtime16.jsxs)(import_jsx_runtime16.Fragment, { children: [
              activeSessionId ? /* @__PURE__ */ (0, import_jsx_runtime16.jsx)(ActionButton, { size: "sm", disabled: busy, onClick: () => dispatchToSession(entry, "current"), children: t("validateInCurrentSession") }) : null,
              /* @__PURE__ */ (0, import_jsx_runtime16.jsx)(ActionButton, { size: "sm", disabled: busy, onClick: () => dispatchToSession(entry, "new"), children: t("validateInNewSession") })
            ] }),
            /* @__PURE__ */ (0, import_jsx_runtime16.jsx)(ActionButton, { size: "sm", onClick: () => beginEdit(entry), children: t("edit") }),
            /* @__PURE__ */ (0, import_jsx_runtime16.jsx)(ActionButton, { size: "sm", onClick: () => setDeleting(entry), children: t("delete") })
          ] })
        ] }, entry.id)) })
      ] }, group.key)),
      filteredGroups.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime16.jsx)("p", { children: entries.length ? t("emptyRawCaseFilter") : t("emptyRawCases") }) : null
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime16.jsx)(import_dsh_client_ui_primitives10.Modal, { open: adding, onClose: () => setAdding(false), title: t("addRawCaseTitle"), closeLabel: t("cancel"), footer: /* @__PURE__ */ (0, import_jsx_runtime16.jsxs)(import_jsx_runtime16.Fragment, { children: [
      /* @__PURE__ */ (0, import_jsx_runtime16.jsx)(ActionButton, { onClick: () => setAdding(false), children: t("cancel") }),
      /* @__PURE__ */ (0, import_jsx_runtime16.jsx)(ActionButton, { disabled: busy || !question.trim() || !skillId, onClick: add, children: t("save") })
    ] }), children: form }),
    /* @__PURE__ */ (0, import_jsx_runtime16.jsx)(import_dsh_client_ui_primitives10.Modal, { open: editing !== null, onClose: () => setEditing(null), title: t("editRawCaseTitle"), closeLabel: t("cancel"), footer: /* @__PURE__ */ (0, import_jsx_runtime16.jsxs)(import_jsx_runtime16.Fragment, { children: [
      /* @__PURE__ */ (0, import_jsx_runtime16.jsx)(ActionButton, { onClick: () => setEditing(null), children: t("cancel") }),
      /* @__PURE__ */ (0, import_jsx_runtime16.jsx)(ActionButton, { disabled: busy || !question.trim() || !skillId, onClick: save, children: t("save") })
    ] }), children: form }),
    /* @__PURE__ */ (0, import_jsx_runtime16.jsx)(import_dsh_client_ui_primitives10.Modal, { open: inspecting !== null, onClose: () => setInspecting(null), title: t("rawCaseEvidence"), closeLabel: t("close"), footer: /* @__PURE__ */ (0, import_jsx_runtime16.jsx)(ActionButton, { onClick: () => setInspecting(null), children: t("close") }), children: inspecting ? /* @__PURE__ */ (0, import_jsx_runtime16.jsxs)("div", { className: "rolling-skill-detail-stack rolling-skill-capture-evidence", children: [
      /* @__PURE__ */ (0, import_jsx_runtime16.jsx)("p", { className: "rolling-skill-muted", children: t("captureEvidenceDescription") }),
      evidence.observation ? /* @__PURE__ */ (0, import_jsx_runtime16.jsxs)(import_jsx_runtime16.Fragment, { children: [
        /* @__PURE__ */ (0, import_jsx_runtime16.jsxs)("dl", { className: "rolling-skill-evidence-summary", children: [
          /* @__PURE__ */ (0, import_jsx_runtime16.jsxs)("div", { children: [
            /* @__PURE__ */ (0, import_jsx_runtime16.jsx)("dt", { children: t("captureClassification") }),
            /* @__PURE__ */ (0, import_jsx_runtime16.jsx)("dd", { children: evidence.observation.caseType === "badcase" ? t("badcase") : evidence.observation.caseType === "goodcase" ? t("goodcase") : t("unknown") })
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime16.jsxs)("div", { children: [
            /* @__PURE__ */ (0, import_jsx_runtime16.jsx)("dt", { children: t("captureOutcome") }),
            /* @__PURE__ */ (0, import_jsx_runtime16.jsx)("dd", { children: evidence.observation.outcome === "resolved" ? t("resolved") : evidence.observation.outcome === "unresolved" ? t("unresolved") : t("unknown") })
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime16.jsxs)("div", { children: [
            /* @__PURE__ */ (0, import_jsx_runtime16.jsx)("dt", { children: t("confidence") }),
            /* @__PURE__ */ (0, import_jsx_runtime16.jsx)("dd", { children: confidence(evidence.observation.confidence, t("unknown")) })
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime16.jsxs)("div", { children: [
            /* @__PURE__ */ (0, import_jsx_runtime16.jsx)("dt", { children: t("captureInspectedAt") }),
            /* @__PURE__ */ (0, import_jsx_runtime16.jsx)("dd", { children: dateTime(evidence.observation.inspectedAt, t("unknown")) })
          ] })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime16.jsxs)("section", { className: "rolling-skill-capture-range-card", children: [
          /* @__PURE__ */ (0, import_jsx_runtime16.jsx)("h4", { children: t("messageRange") }),
          /* @__PURE__ */ (0, import_jsx_runtime16.jsx)("p", { className: "rolling-skill-muted", children: t("rangeMeaning") }),
          evidenceLoading ? /* @__PURE__ */ (0, import_jsx_runtime16.jsx)("p", { className: "rolling-skill-muted", children: t("captureEvidenceLoading") }) : null,
          evidenceError ? /* @__PURE__ */ (0, import_jsx_runtime16.jsxs)("div", { className: "rolling-skill-capture-evidence-error", role: "alert", children: [
            /* @__PURE__ */ (0, import_jsx_runtime16.jsx)("p", { children: t("captureEvidenceLoadError") }),
            /* @__PURE__ */ (0, import_jsx_runtime16.jsx)("small", { children: evidenceError }),
            /* @__PURE__ */ (0, import_jsx_runtime16.jsx)(ActionButton, { size: "sm", onClick: () => setEvidenceAttempt((value) => value + 1), children: t("retry") })
          ] }) : null,
          !evidenceLoading && !evidenceError && loadedEvidence && timeline.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime16.jsx)("p", { children: t("captureEvidenceEmpty") }) : null,
          timeline.length > 0 ? /* @__PURE__ */ (0, import_jsx_runtime16.jsx)("ol", { className: "rolling-skill-capture-evidence-timeline", children: timeline.map((item, index2) => /* @__PURE__ */ (0, import_jsx_runtime16.jsx)("li", { "data-kind": item.kind, "data-boundary": item.boundary ?? void 0, children: item.kind === "tool" ? /* @__PURE__ */ (0, import_jsx_runtime16.jsxs)("details", { className: "rolling-skill-capture-tool", children: [
            /* @__PURE__ */ (0, import_jsx_runtime16.jsxs)("summary", { children: [
              /* @__PURE__ */ (0, import_jsx_runtime16.jsx)("strong", { children: item.label }),
              item.status ? /* @__PURE__ */ (0, import_jsx_runtime16.jsx)("span", { children: item.status }) : null
            ] }),
            /* @__PURE__ */ (0, import_jsx_runtime16.jsxs)("div", { className: "rolling-skill-capture-tool-details", children: [
              detailText(item.arguments) ? /* @__PURE__ */ (0, import_jsx_runtime16.jsxs)("div", { children: [
                /* @__PURE__ */ (0, import_jsx_runtime16.jsx)("strong", { children: t("captureToolArguments") }),
                /* @__PURE__ */ (0, import_jsx_runtime16.jsx)("pre", { children: detailText(item.arguments) })
              ] }) : null,
              detailText(item.result) ? /* @__PURE__ */ (0, import_jsx_runtime16.jsxs)("div", { children: [
                /* @__PURE__ */ (0, import_jsx_runtime16.jsx)("strong", { children: t("captureToolResult") }),
                /* @__PURE__ */ (0, import_jsx_runtime16.jsx)("pre", { children: detailText(item.result) })
              ] }) : null,
              detailText(item.error) ? /* @__PURE__ */ (0, import_jsx_runtime16.jsxs)("div", { children: [
                /* @__PURE__ */ (0, import_jsx_runtime16.jsx)("strong", { children: t("captureToolError") }),
                /* @__PURE__ */ (0, import_jsx_runtime16.jsx)("pre", { children: detailText(item.error) })
              ] }) : null
            ] })
          ] }) : item.kind === "context" ? /* @__PURE__ */ (0, import_jsx_runtime16.jsxs)("details", { className: "rolling-skill-capture-context", children: [
            /* @__PURE__ */ (0, import_jsx_runtime16.jsx)("summary", { children: t("captureContext") }),
            /* @__PURE__ */ (0, import_jsx_runtime16.jsx)("p", { className: "rolling-skill-verbatim", children: item.text || t("notAvailable") })
          ] }) : /* @__PURE__ */ (0, import_jsx_runtime16.jsxs)("article", { children: [
            /* @__PURE__ */ (0, import_jsx_runtime16.jsxs)("header", { children: [
              /* @__PURE__ */ (0, import_jsx_runtime16.jsx)("strong", { children: item.kind === "user" ? t("captureUser") : t("captureAssistant") }),
              item.boundary ? /* @__PURE__ */ (0, import_jsx_runtime16.jsx)("span", { children: item.boundary === "start" ? t("captureStartTag") : t("captureEndTag") }) : null
            ] }),
            /* @__PURE__ */ (0, import_jsx_runtime16.jsx)("p", { className: "rolling-skill-verbatim", children: item.text || t("notAvailable") })
          ] }) }, item.id ?? `${item.type}:${index2}`)) }) : null,
          evidence.canRevealRange ? /* @__PURE__ */ (0, import_jsx_runtime16.jsx)(ActionButton, { size: "sm", onClick: viewCaptureRange, children: t("viewCaptureRange") }) : null
        ] }),
        evidence.observation.summary ? /* @__PURE__ */ (0, import_jsx_runtime16.jsxs)("div", { children: [
          /* @__PURE__ */ (0, import_jsx_runtime16.jsx)("h4", { children: t("captureSummary") }),
          /* @__PURE__ */ (0, import_jsx_runtime16.jsx)("p", { children: evidence.observation.summary })
        ] }) : null,
        evidence.observation.reason ? /* @__PURE__ */ (0, import_jsx_runtime16.jsxs)("div", { children: [
          /* @__PURE__ */ (0, import_jsx_runtime16.jsx)("h4", { children: t("captureReason") }),
          /* @__PURE__ */ (0, import_jsx_runtime16.jsx)("p", { children: evidence.observation.reason })
        ] }) : null
      ] }) : /* @__PURE__ */ (0, import_jsx_runtime16.jsx)("p", { children: t("manualEvidenceDescription") }),
      /* @__PURE__ */ (0, import_jsx_runtime16.jsxs)("details", { className: "rolling-skill-advanced-evidence", children: [
        /* @__PURE__ */ (0, import_jsx_runtime16.jsx)("summary", { children: t("rawCaseEvidenceAdvanced") }),
        /* @__PURE__ */ (0, import_jsx_runtime16.jsx)("pre", { children: JSON.stringify(inspecting.source ?? { kind: "manual" }, null, 2) })
      ] })
    ] }) : null }),
    /* @__PURE__ */ (0, import_jsx_runtime16.jsxs)(import_dsh_client_ui_primitives10.Modal, { open: drafting !== null, onClose: () => setDrafting(null), title: t("createCaseDraft"), closeLabel: t("cancel"), footer: /* @__PURE__ */ (0, import_jsx_runtime16.jsxs)(import_jsx_runtime16.Fragment, { children: [
      /* @__PURE__ */ (0, import_jsx_runtime16.jsx)(ActionButton, { onClick: () => setDrafting(null), children: t("cancel") }),
      /* @__PURE__ */ (0, import_jsx_runtime16.jsx)(ActionButton, { disabled: busy || !draftDatasetId, onClick: createDraft, children: t("captureCreate") })
    ] }), children: [
      /* @__PURE__ */ (0, import_jsx_runtime16.jsx)("p", { children: t("rawCaseDraftDescription") }),
      /* @__PURE__ */ (0, import_jsx_runtime16.jsx)("select", { className: "rolling-skill-select", value: draftDatasetId, onChange: (event) => setDraftDatasetId(event.target.value), children: compatibleDatasets(drafting).map((dataset) => /* @__PURE__ */ (0, import_jsx_runtime16.jsx)("option", { value: dataset.id, children: dataset.name }, dataset.id)) })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime16.jsx)(import_dsh_client_ui_primitives10.Modal, { open: deleting !== null, onClose: () => setDeleting(null), title: t("deleteRawCaseTitle"), closeLabel: t("cancel"), footer: /* @__PURE__ */ (0, import_jsx_runtime16.jsxs)(import_jsx_runtime16.Fragment, { children: [
      /* @__PURE__ */ (0, import_jsx_runtime16.jsx)(ActionButton, { onClick: () => setDeleting(null), children: t("cancel") }),
      /* @__PURE__ */ (0, import_jsx_runtime16.jsx)(ActionButton, { disabled: busy, onClick: recycle, children: t("confirmDelete") })
    ] }), children: /* @__PURE__ */ (0, import_jsx_runtime16.jsx)("p", { children: t("deleteRawCasePrompt") }) })
  ] });
}

// src/client/workbench/SkillsPanel.tsx
var import_dsh_client_ui_primitives13 = require("@deepseek-ai/dsh-client-ui-primitives");
var import_react16 = require("react");

// src/client/workbench/InstallationsPanel.tsx
var import_dsh_client_ui_primitives11 = require("@deepseek-ai/dsh-client-ui-primitives");
var import_react14 = require("react");
var import_jsx_runtime17 = require("react/jsx-runtime");
var ACTIVE_STATUSES = /* @__PURE__ */ new Set([
  "queued",
  "running",
  "verifying",
  "awaiting_permission",
  "awaiting_confirmation"
]);
function shortDigest2(value) {
  if (!value) return "\u2014";
  return value.length > 28 ? `${value.slice(0, 20)}\u2026${value.slice(-6)}` : value;
}
function dateTime2(value) {
  if (!value) return "\u2014";
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleString() : value;
}
function InstallationsPanel({ t, initialJobId, refreshRevision = 0 }) {
  const [overview, setOverview] = (0, import_react14.useState)({ jobs: [], matrix: [] });
  const [selectedJob, setSelectedJob] = (0, import_react14.useState)(null);
  const [followUp, setFollowUp] = (0, import_react14.useState)("");
  const [busy, setBusy] = (0, import_react14.useState)(false);
  const [error, setError] = (0, import_react14.useState)(null);
  const [revision, setRevision] = (0, import_react14.useState)(0);
  const loadJob = async (jobId, signal) => {
    setSelectedJob(await requestRollingSkill("installations.get", { jobId }, signal));
  };
  (0, import_react14.useEffect)(() => {
    const controller = new AbortController();
    requestRollingSkill("installations.list", {}, controller.signal).then((value) => {
      setOverview(value);
      setError(null);
      if (initialJobId) void loadJob(initialJobId, controller.signal);
    }).catch((reason) => {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : t("loadError"));
    });
    return () => controller.abort();
  }, [revision, initialJobId, refreshRevision]);
  (0, import_react14.useEffect)(() => {
    if (!overview.jobs.some((job) => ACTIVE_STATUSES.has(job.status))) return;
    const timer = window.setInterval(() => setRevision((value) => value + 1), 1500);
    return () => window.clearInterval(timer);
  }, [overview.jobs]);
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
  const sendFollowUp = () => {
    if (!selectedJob || !followUp.trim()) return;
    void mutate(async () => {
      setSelectedJob(await requestRollingSkill("installations.send", {
        jobId: selectedJob.id,
        text: followUp.trim()
      }));
      setFollowUp("");
    });
  };
  return /* @__PURE__ */ (0, import_jsx_runtime17.jsxs)("div", { className: "rolling-skill-data-stack", children: [
    /* @__PURE__ */ (0, import_jsx_runtime17.jsxs)("section", { className: "rolling-skill-panel", children: [
      /* @__PURE__ */ (0, import_jsx_runtime17.jsxs)("div", { className: "rolling-skill-panel-header", children: [
        /* @__PURE__ */ (0, import_jsx_runtime17.jsxs)("div", { children: [
          /* @__PURE__ */ (0, import_jsx_runtime17.jsx)("h3", { children: t("installationAudit") }),
          /* @__PURE__ */ (0, import_jsx_runtime17.jsx)("p", { children: t("installationAuditDescription") })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime17.jsx)(ActionButton, { size: "sm", onClick: () => setRevision((value) => value + 1), children: t("refresh") })
      ] }),
      error ? /* @__PURE__ */ (0, import_jsx_runtime17.jsx)("p", { className: "rolling-skill-inline-error", role: "alert", children: error }) : null,
      /* @__PURE__ */ (0, import_jsx_runtime17.jsx)("h4", { children: t("trustedInstallations") }),
      /* @__PURE__ */ (0, import_jsx_runtime17.jsxs)("div", { className: "rolling-skill-audit-grid", children: [
        overview.matrix.map((record) => /* @__PURE__ */ (0, import_jsx_runtime17.jsxs)("article", { className: "rolling-skill-audit-card", children: [
          /* @__PURE__ */ (0, import_jsx_runtime17.jsxs)("header", { children: [
            /* @__PURE__ */ (0, import_jsx_runtime17.jsx)("strong", { children: record.displayName ?? record.runtimeId }),
            /* @__PURE__ */ (0, import_jsx_runtime17.jsx)("span", { className: "rolling-skill-badge", children: record.verification ?? t("notAvailable") })
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime17.jsxs)("dl", { children: [
            /* @__PURE__ */ (0, import_jsx_runtime17.jsxs)("div", { children: [
              /* @__PURE__ */ (0, import_jsx_runtime17.jsx)("dt", { children: t("installationVersion") }),
              /* @__PURE__ */ (0, import_jsx_runtime17.jsx)("dd", { children: record.versionId ?? t("notAvailable") })
            ] }),
            /* @__PURE__ */ (0, import_jsx_runtime17.jsxs)("div", { children: [
              /* @__PURE__ */ (0, import_jsx_runtime17.jsx)("dt", { children: t("installationCommit") }),
              /* @__PURE__ */ (0, import_jsx_runtime17.jsx)("dd", { children: /* @__PURE__ */ (0, import_jsx_runtime17.jsx)("code", { children: record.commit?.slice(0, 12) ?? t("notAvailable") }) })
            ] }),
            /* @__PURE__ */ (0, import_jsx_runtime17.jsxs)("div", { children: [
              /* @__PURE__ */ (0, import_jsx_runtime17.jsx)("dt", { children: t("installationDigest") }),
              /* @__PURE__ */ (0, import_jsx_runtime17.jsx)("dd", { title: record.contentDigest ?? void 0, children: /* @__PURE__ */ (0, import_jsx_runtime17.jsx)("code", { children: shortDigest2(record.contentDigest) }) })
            ] }),
            /* @__PURE__ */ (0, import_jsx_runtime17.jsxs)("div", { children: [
              /* @__PURE__ */ (0, import_jsx_runtime17.jsx)("dt", { children: t("installationJob") }),
              /* @__PURE__ */ (0, import_jsx_runtime17.jsx)("dd", { children: record.trustedJobId ?? t("notAvailable") })
            ] }),
            /* @__PURE__ */ (0, import_jsx_runtime17.jsxs)("div", { children: [
              /* @__PURE__ */ (0, import_jsx_runtime17.jsx)("dt", { children: t("installedAt") }),
              /* @__PURE__ */ (0, import_jsx_runtime17.jsx)("dd", { children: dateTime2(record.installedAt) })
            ] })
          ] }),
          record.trustedJobId ? /* @__PURE__ */ (0, import_jsx_runtime17.jsx)(ActionButton, { size: "sm", onClick: () => void loadJob(record.trustedJobId), children: t("details") }) : null
        ] }, `${record.runtimeId}:${record.skillId}:${record.versionId}`)),
        overview.matrix.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime17.jsx)("p", { children: t("emptyInstallationAudit") }) : null
      ] })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime17.jsxs)("section", { className: "rolling-skill-panel", children: [
      /* @__PURE__ */ (0, import_jsx_runtime17.jsx)("h3", { children: t("installationJobs") }),
      /* @__PURE__ */ (0, import_jsx_runtime17.jsxs)("div", { className: "rolling-skill-list", children: [
        overview.jobs.map((job) => /* @__PURE__ */ (0, import_jsx_runtime17.jsxs)("article", { className: "rolling-skill-list-row", children: [
          /* @__PURE__ */ (0, import_jsx_runtime17.jsxs)("div", { children: [
            /* @__PURE__ */ (0, import_jsx_runtime17.jsxs)("strong", { children: [
              job.status,
              " \xB7 ",
              job.request.skillName ?? t("notAvailable")
            ] }),
            /* @__PURE__ */ (0, import_jsx_runtime17.jsxs)("span", { children: [
              job.runtime.displayName,
              " ",
              job.runtime.version ?? "",
              " \xB7 ",
              job.request.versionLabel ?? job.request.source?.versionId ?? job.id
            ] }),
            /* @__PURE__ */ (0, import_jsx_runtime17.jsx)("small", { children: dateTime2(job.completedAt ?? job.updatedAt ?? job.createdAt) })
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime17.jsxs)("div", { className: "rolling-skill-actions", children: [
            /* @__PURE__ */ (0, import_jsx_runtime17.jsx)(ActionButton, { size: "sm", onClick: () => void loadJob(job.id), children: t("details") }),
            ACTIVE_STATUSES.has(job.status) ? /* @__PURE__ */ (0, import_jsx_runtime17.jsx)(ActionButton, { size: "sm", disabled: busy, onClick: () => void mutate(() => requestRollingSkill("installations.cancel", { jobId: job.id })), children: t("cancelRun") }) : null
          ] })
        ] }, job.id)),
        overview.jobs.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime17.jsx)("p", { children: t("emptyInstallationJobs") }) : null
      ] })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime17.jsx)(RuntimeInteractions, { t, ownerKind: "installation" }),
    /* @__PURE__ */ (0, import_jsx_runtime17.jsx)(import_dsh_client_ui_primitives11.Modal, { open: selectedJob !== null, onClose: () => setSelectedJob(null), title: t("installationDetail"), closeLabel: t("close"), footer: /* @__PURE__ */ (0, import_jsx_runtime17.jsx)(ActionButton, { onClick: () => setSelectedJob(null), children: t("close") }), children: selectedJob ? /* @__PURE__ */ (0, import_jsx_runtime17.jsxs)("div", { className: "rolling-skill-detail-stack", children: [
      /* @__PURE__ */ (0, import_jsx_runtime17.jsxs)("section", { className: "rolling-skill-evidence-card", children: [
        /* @__PURE__ */ (0, import_jsx_runtime17.jsx)("h4", { children: t("installationSource") }),
        /* @__PURE__ */ (0, import_jsx_runtime17.jsxs)("dl", { children: [
          /* @__PURE__ */ (0, import_jsx_runtime17.jsxs)("div", { children: [
            /* @__PURE__ */ (0, import_jsx_runtime17.jsx)("dt", { children: t("status") }),
            /* @__PURE__ */ (0, import_jsx_runtime17.jsx)("dd", { children: selectedJob.status })
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime17.jsxs)("div", { children: [
            /* @__PURE__ */ (0, import_jsx_runtime17.jsx)("dt", { children: t("runtime") }),
            /* @__PURE__ */ (0, import_jsx_runtime17.jsxs)("dd", { children: [
              selectedJob.runtime.displayName,
              " ",
              selectedJob.runtime.version ?? ""
            ] })
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime17.jsxs)("div", { children: [
            /* @__PURE__ */ (0, import_jsx_runtime17.jsx)("dt", { children: t("installationVersion") }),
            /* @__PURE__ */ (0, import_jsx_runtime17.jsx)("dd", { children: selectedJob.request.versionLabel ?? selectedJob.request.source?.versionId ?? t("notAvailable") })
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime17.jsxs)("div", { children: [
            /* @__PURE__ */ (0, import_jsx_runtime17.jsx)("dt", { children: t("installationCommit") }),
            /* @__PURE__ */ (0, import_jsx_runtime17.jsx)("dd", { children: /* @__PURE__ */ (0, import_jsx_runtime17.jsx)("code", { children: selectedJob.request.source?.commit?.slice(0, 12) ?? t("notAvailable") }) })
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime17.jsxs)("div", { children: [
            /* @__PURE__ */ (0, import_jsx_runtime17.jsx)("dt", { children: t("installationDigest") }),
            /* @__PURE__ */ (0, import_jsx_runtime17.jsx)("dd", { title: selectedJob.request.source?.expectedDigest ?? void 0, children: /* @__PURE__ */ (0, import_jsx_runtime17.jsx)("code", { children: shortDigest2(selectedJob.request.source?.expectedDigest) }) })
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime17.jsxs)("div", { children: [
            /* @__PURE__ */ (0, import_jsx_runtime17.jsx)("dt", { children: t("installationVerification") }),
            /* @__PURE__ */ (0, import_jsx_runtime17.jsx)("dd", { children: selectedJob.parsedResult?.verification ?? t("notAvailable") })
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime17.jsxs)("div", { children: [
            /* @__PURE__ */ (0, import_jsx_runtime17.jsx)("dt", { children: t("installedAt") }),
            /* @__PURE__ */ (0, import_jsx_runtime17.jsx)("dd", { children: dateTime2(selectedJob.completedAt) })
          ] })
        ] })
      ] }),
      selectedJob.error ? /* @__PURE__ */ (0, import_jsx_runtime17.jsxs)("p", { className: "rolling-skill-inline-error", children: [
        selectedJob.error.code,
        " \xB7 ",
        selectedJob.error.message
      ] }) : null,
      /* @__PURE__ */ (0, import_jsx_runtime17.jsx)("h4", { children: t("installerConversation") }),
      /* @__PURE__ */ (0, import_jsx_runtime17.jsx)("div", { className: "rolling-skill-conversation-log", children: selectedJob.messages?.map((message, index2) => /* @__PURE__ */ (0, import_jsx_runtime17.jsxs)("div", { "data-role": message.role, children: [
        /* @__PURE__ */ (0, import_jsx_runtime17.jsx)("strong", { children: message.role }),
        /* @__PURE__ */ (0, import_jsx_runtime17.jsx)("p", { children: message.content })
      ] }, `${message.recordedAt ?? index2}`)) }),
      /* @__PURE__ */ (0, import_jsx_runtime17.jsx)("h4", { children: t("installerActivity") }),
      /* @__PURE__ */ (0, import_jsx_runtime17.jsx)("div", { className: "rolling-skill-list", children: selectedJob.activities?.map((activity, index2) => /* @__PURE__ */ (0, import_jsx_runtime17.jsx)("div", { className: "rolling-skill-list-row", children: /* @__PURE__ */ (0, import_jsx_runtime17.jsxs)("div", { children: [
        /* @__PURE__ */ (0, import_jsx_runtime17.jsx)("strong", { children: activity.title ?? activity.type }),
        /* @__PURE__ */ (0, import_jsx_runtime17.jsx)("span", { children: activity.summary })
      ] }) }, `${activity.recordedAt ?? index2}`)) }),
      selectedJob.canFollowUp ? /* @__PURE__ */ (0, import_jsx_runtime17.jsxs)("div", { className: "rolling-skill-form-row", children: [
        /* @__PURE__ */ (0, import_jsx_runtime17.jsx)(import_dsh_client_ui_primitives11.Input, { value: followUp, placeholder: t("installerFollowUp"), onChange: (event) => setFollowUp(event.target.value) }),
        /* @__PURE__ */ (0, import_jsx_runtime17.jsx)(ActionButton, { disabled: busy || !followUp.trim(), onClick: sendFollowUp, children: t("sendRevision") })
      ] }) : null
    ] }) : null })
  ] });
}

// src/client/workbench/SkillEditModal.tsx
var import_dsh_client_ui_primitives12 = require("@deepseek-ai/dsh-client-ui-primitives");
var import_react15 = require("react");
var import_jsx_runtime18 = require("react/jsx-runtime");
var SETTINGS_KEY = "rolling-skill:skill-edit-runtime-settings/v1";
var ACTIVE_STATES = /* @__PURE__ */ new Set(["draft", "running", "idle", "applying", "needs_recovery"]);
var RUNNING_STATES = /* @__PURE__ */ new Set(["draft", "running", "applying"]);
function rememberedSettings() {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(SETTINGS_KEY) ?? "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}
function modelIdentifier(model) {
  return model.id ?? model.model ?? "";
}
function stateLabel(t, state) {
  const labels = {
    draft: t("skillEditStateDraft"),
    running: t("skillEditStateRunning"),
    idle: t("skillEditStateIdle"),
    applying: t("skillEditStateApplying"),
    needs_recovery: t("skillEditStateRecovery"),
    published: t("skillEditStatePublished"),
    discarded: t("skillEditStateDiscarded"),
    failed: t("skillEditStateFailed")
  };
  return labels[state] ?? state;
}
function SkillEditModal({
  t,
  open,
  skillId,
  skillName,
  onClose,
  onPublished
}) {
  const [runtimes, setRuntimes] = (0, import_react15.useState)([]);
  const [runtimeId, setRuntimeId] = (0, import_react15.useState)("");
  const [models, setModels] = (0, import_react15.useState)([]);
  const [modelId, setModelId] = (0, import_react15.useState)("");
  const [effort, setEffort] = (0, import_react15.useState)("");
  const [objective, setObjective] = (0, import_react15.useState)("");
  const [message, setMessage] = (0, import_react15.useState)("");
  const [session, setSession] = (0, import_react15.useState)(null);
  const [busy, setBusy] = (0, import_react15.useState)(false);
  const [loading, setLoading] = (0, import_react15.useState)(false);
  const [error, setError] = (0, import_react15.useState)(null);
  const refreshSession = async (sessionId, signal) => {
    const next = await requestRollingSkill("skillEdits.get", { sessionId }, signal);
    setSession(next);
    return next;
  };
  (0, import_react15.useEffect)(() => {
    if (!open || !skillId) return;
    const controller = new AbortController();
    const remembered = rememberedSettings();
    setLoading(true);
    setError(null);
    Promise.all([
      requestRollingSkill("runtimes.list", {}, controller.signal),
      requestRollingSkill("skillEdits.list", { skillId }, controller.signal)
    ]).then(async ([runtimeItems, result]) => {
      setRuntimes(runtimeItems);
      const selectedRuntime = runtimeItems.some((runtime) => runtime.runtimeId === remembered.runtimeId) ? remembered.runtimeId ?? "" : runtimeItems[0]?.runtimeId ?? "";
      setRuntimeId(selectedRuntime);
      const active = result.sessions.find((candidate) => ACTIVE_STATES.has(candidate.state));
      if (active) await refreshSession(active.id, controller.signal);
      else setSession(null);
    }).catch((reason) => {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : t("loadError"));
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false);
    });
    return () => controller.abort();
  }, [open, skillId]);
  (0, import_react15.useEffect)(() => {
    if (!open || session || !runtimeId) return;
    const controller = new AbortController();
    const remembered = rememberedSettings();
    requestRollingSkill("runtimes.models", { runtimeId }, controller.signal).then((items) => {
      setModels(items);
      const rememberedModel = remembered.runtimeId === runtimeId ? remembered.modelId : "";
      const selectedModel = items.some((model) => modelIdentifier(model) === rememberedModel) ? rememberedModel ?? "" : modelIdentifier(items[0] ?? {});
      setModelId(selectedModel);
      setEffort(remembered.runtimeId === runtimeId && selectedModel === remembered.modelId ? remembered.effort ?? "" : "");
    }).catch((reason) => {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : t("loadError"));
    });
    return () => controller.abort();
  }, [open, runtimeId, session?.id]);
  (0, import_react15.useEffect)(() => {
    if (!open || !session || !ACTIVE_STATES.has(session.state)) return;
    const timer = window.setInterval(() => void refreshSession(session.id).catch((reason) => {
      setError(reason instanceof Error ? reason.message : t("loadError"));
    }), 1500);
    return () => window.clearInterval(timer);
  }, [open, session?.id, session?.state]);
  const perform = async (operation) => {
    setBusy(true);
    setError(null);
    try {
      setSession(await operation());
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t("loadError"));
    } finally {
      setBusy(false);
    }
  };
  const start2 = () => perform(async () => {
    const next = await requestRollingSkill("skillEdits.start", {
      skillId,
      runtimeId,
      modelId,
      effort,
      objective
    });
    window.localStorage.setItem(SETTINGS_KEY, JSON.stringify({ runtimeId, modelId, effort }));
    return next;
  });
  const send = () => perform(async () => {
    const next = await requestRollingSkill("skillEdits.send", { sessionId: session?.id, text: message });
    setMessage("");
    return next;
  });
  const apply2 = () => perform(async () => {
    const next = await requestRollingSkill("skillEdits.applyAndRelease", {
      sessionId: session?.id,
      expectedRevision: session?.revision
    });
    onPublished();
    return next;
  });
  const discard = () => perform(() => requestRollingSkill("skillEdits.discard", {
    sessionId: session?.id,
    expectedRevision: session?.revision
  }));
  const canSend = Boolean(session?.operatorSessionId && ACTIVE_STATES.has(session.state) && session.state !== "applying");
  const canApply = Boolean(session?.state === "idle" && session.diff?.changed && session.diff.valid);
  const canStart = Boolean(runtimeId && modelId && effort && objective.trim());
  const footer2 = session ? /* @__PURE__ */ (0, import_jsx_runtime18.jsxs)(import_jsx_runtime18.Fragment, { children: [
    ACTIVE_STATES.has(session.state) ? /* @__PURE__ */ (0, import_jsx_runtime18.jsx)(ActionButton, { disabled: busy || session.state === "applying", onClick: () => void discard(), children: t("discardSkillEdit") }) : null,
    ACTIVE_STATES.has(session.state) ? /* @__PURE__ */ (0, import_jsx_runtime18.jsx)(ActionButton, { tone: "primary", disabled: busy || !canApply, onClick: () => void apply2(), children: t("applySkillEdit") }) : null,
    /* @__PURE__ */ (0, import_jsx_runtime18.jsx)(ActionButton, { onClick: onClose, children: t("close") })
  ] }) : /* @__PURE__ */ (0, import_jsx_runtime18.jsxs)(import_jsx_runtime18.Fragment, { children: [
    /* @__PURE__ */ (0, import_jsx_runtime18.jsx)(ActionButton, { onClick: onClose, children: t("cancel") }),
    /* @__PURE__ */ (0, import_jsx_runtime18.jsx)(ActionButton, { tone: "primary", disabled: busy || loading || !canStart, onClick: () => void start2(), children: t("startSkillEdit") })
  ] });
  const changedFiles = (0, import_react15.useMemo)(() => session?.diff?.files ?? [], [session?.diff]);
  return /* @__PURE__ */ (0, import_jsx_runtime18.jsx)(import_dsh_client_ui_primitives12.Modal, { open, onClose, title: `${t("skillEditTitle")} \xB7 ${skillName}`, closeLabel: t("close"), footer: footer2, children: /* @__PURE__ */ (0, import_jsx_runtime18.jsxs)("div", { className: "rolling-skill-skill-edit-modal", children: [
    loading ? /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("p", { children: t("loading") }) : null,
    error ? /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("p", { className: "rolling-skill-inline-error", role: "alert", children: error }) : null,
    !session && !loading ? /* @__PURE__ */ (0, import_jsx_runtime18.jsxs)("div", { className: "rolling-skill-detail-stack", children: [
      /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("p", { className: "rolling-skill-help", children: t("skillEditDescription") }),
      /* @__PURE__ */ (0, import_jsx_runtime18.jsx)(RuntimeSelect, { t, runtimes, value: runtimeId, onChange: setRuntimeId, label: t("skillEditRuntime") }),
      /* @__PURE__ */ (0, import_jsx_runtime18.jsxs)("div", { className: "rolling-skill-grid", children: [
        /* @__PURE__ */ (0, import_jsx_runtime18.jsxs)("label", { className: "rolling-skill-field", children: [
          /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("span", { children: t("model") }),
          /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("select", { className: "rolling-skill-select", value: modelId, onChange: (event) => {
            setModelId(event.target.value);
            setEffort("");
          }, children: models.map((model) => {
            const id = modelIdentifier(model);
            return /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("option", { value: id, children: model.displayName ?? id }, id);
          }) })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime18.jsx)(ModelEffortSelect, { label: t("effort"), runtimeDefaultLabel: t("selectSkillEditEffort"), models, modelId, value: effort, onChange: setEffort })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime18.jsxs)("label", { className: "rolling-skill-field", children: [
        /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("span", { children: t("skillEditObjective") }),
        /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("textarea", { className: "rolling-skill-textarea", value: objective, placeholder: t("skillEditObjectivePlaceholder"), onChange: (event) => setObjective(event.target.value) })
      ] })
    ] }) : null,
    session ? /* @__PURE__ */ (0, import_jsx_runtime18.jsxs)("div", { className: "rolling-skill-detail-stack", children: [
      /* @__PURE__ */ (0, import_jsx_runtime18.jsxs)("div", { className: "rolling-skill-skill-edit-status", children: [
        /* @__PURE__ */ (0, import_jsx_runtime18.jsxs)("div", { children: [
          /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("strong", { children: stateLabel(t, session.state) }),
          /* @__PURE__ */ (0, import_jsx_runtime18.jsxs)("span", { children: [
            session.runtime.runtimeId,
            " \xB7 ",
            session.runtime.modelId,
            " \xB7 ",
            session.runtime.effort
          ] })
        ] }),
        session.publishedVersionLabel ? /* @__PURE__ */ (0, import_jsx_runtime18.jsxs)("span", { children: [
          t("publishedVersionLabel"),
          " ",
          session.publishedVersionLabel
        ] }) : null
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("p", { className: "rolling-skill-help", children: session.objective }),
      session.error?.message ? /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("p", { className: "rolling-skill-inline-error", role: "alert", children: session.error.message }) : null,
      /* @__PURE__ */ (0, import_jsx_runtime18.jsxs)("div", { className: "rolling-skill-skill-edit-layout", children: [
        /* @__PURE__ */ (0, import_jsx_runtime18.jsxs)("section", { className: "rolling-skill-subpanel rolling-skill-skill-edit-conversation", children: [
          /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("h4", { children: t("skillEditConversation") }),
          /* @__PURE__ */ (0, import_jsx_runtime18.jsxs)("div", { className: "rolling-skill-skill-edit-messages", children: [
            session.messages.map((entry, index2) => /* @__PURE__ */ (0, import_jsx_runtime18.jsxs)("article", { "data-role": entry.role, children: [
              /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("strong", { children: entry.role === "assistant" ? t("agent") : t("you") }),
              /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("p", { children: entry.content })
            ] }, `${entry.recordedAt ?? "message"}-${index2}`)),
            session.messages.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("p", { children: t("emptySkillEditConversation") }) : null
          ] }),
          canSend ? /* @__PURE__ */ (0, import_jsx_runtime18.jsxs)("div", { className: "rolling-skill-skill-edit-follow-up", children: [
            /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("textarea", { className: "rolling-skill-textarea", value: message, placeholder: t("skillEditFollowUp"), onChange: (event) => setMessage(event.target.value) }),
            /* @__PURE__ */ (0, import_jsx_runtime18.jsx)(ActionButton, { disabled: busy || !message.trim(), onClick: () => void send(), children: t("send") })
          ] }) : null
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime18.jsxs)("section", { className: "rolling-skill-subpanel rolling-skill-skill-edit-diff", children: [
          /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("h4", { children: t("skillEditChanges") }),
          session.diff?.validationError?.message ? /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("p", { className: "rolling-skill-inline-error", children: session.diff.validationError.message }) : null,
          /* @__PURE__ */ (0, import_jsx_runtime18.jsxs)("div", { className: "rolling-skill-skill-edit-files", children: [
            changedFiles.map((file) => /* @__PURE__ */ (0, import_jsx_runtime18.jsxs)("article", { children: [
              /* @__PURE__ */ (0, import_jsx_runtime18.jsxs)("header", { children: [
                /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("strong", { children: file.path }),
                /* @__PURE__ */ (0, import_jsx_runtime18.jsxs)("span", { children: [
                  t(file.status === "added" ? "skillEditAdded" : file.status === "deleted" ? "skillEditDeleted" : "skillEditModified"),
                  " \xB7 +",
                  file.additions ?? "\u2013",
                  " / -",
                  file.deletions ?? "\u2013"
                ] })
              ] }),
              file.binary ? /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("p", { children: t("skillEditBinaryFile") }) : /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("pre", { children: file.patch }),
              file.truncated ? /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("small", { children: t("skillEditDiffTruncated") }) : null
            ] }, file.path)),
            !changedFiles.length ? /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("p", { children: RUNNING_STATES.has(session.state) ? t("skillEditWaitingForChanges") : t("skillEditNoChanges") }) : null
          ] }),
          session.diff?.truncated ? /* @__PURE__ */ (0, import_jsx_runtime18.jsx)("p", { className: "rolling-skill-help", children: t("skillEditDiffTruncated") }) : null
        ] })
      ] }),
      session.operatorSessionId ? /* @__PURE__ */ (0, import_jsx_runtime18.jsx)(RuntimeInteractions, { t, ownerKind: "operator", ownerId: session.operatorSessionId }) : null
    ] }) : null
  ] }) });
}

// src/client/workbench/SkillsPanel.tsx
var import_jsx_runtime19 = require("react/jsx-runtime");
function dateTime3(value, fallback) {
  if (!value) return fallback;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleString() : fallback;
}
function SkillsPanel({ t, mode, initialSkillId, initialJobId, onSkillChange, onOpenVersions }) {
  const [catalog, setCatalog] = (0, import_react16.useState)({ repositories: [], skills: [] });
  const [detail, setDetail] = (0, import_react16.useState)(null);
  const [runtimes, setRuntimes] = (0, import_react16.useState)([]);
  const [runtimeIds, setRuntimeIds] = (0, import_react16.useState)([]);
  const [sourceKind, setSourceKind] = (0, import_react16.useState)("folder");
  const [sourceLocation, setSourceLocation] = (0, import_react16.useState)("");
  const [managedSkillPath, setManagedSkillPath] = (0, import_react16.useState)("");
  const [hasActiveEdit, setHasActiveEdit] = (0, import_react16.useState)(false);
  const [editOpen, setEditOpen] = (0, import_react16.useState)(false);
  const [pathCopied, setPathCopied] = (0, import_react16.useState)(false);
  const [busy, setBusy] = (0, import_react16.useState)(false);
  const [error, setError] = (0, import_react16.useState)(null);
  const [revision, setRevision] = (0, import_react16.useState)(0);
  (0, import_react16.useEffect)(() => {
    const controller = new AbortController();
    Promise.all([
      requestRollingSkill("skills.catalog", {}, controller.signal),
      requestRollingSkill("installations.targets", {}, controller.signal)
    ]).then(([nextCatalog, runtimeItems]) => {
      setCatalog(nextCatalog);
      setRuntimes(runtimeItems);
      setRuntimeIds((current) => current.length ? current : runtimeItems[0]?.runtimeId ? [runtimeItems[0].runtimeId] : []);
      const selectedSkillId = initialSkillId ?? detail?.skill.id;
      const requestedSkill = nextCatalog.skills.find((skill) => skill.id === selectedSkillId) ?? nextCatalog.skills[0];
      if (requestedSkill) void loadSkill(requestedSkill.id, controller.signal);
      else {
        setDetail(null);
        setManagedSkillPath("");
        setHasActiveEdit(false);
      }
    }).catch((reason) => {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : t("loadError"));
    });
    return () => controller.abort();
  }, [revision, initialSkillId, initialJobId, mode]);
  const loadSkill = async (skillId, signal) => {
    setManagedSkillPath("");
    setHasActiveEdit(false);
    if (mode === "versions") {
      const [next2, pathResult, editResult] = await Promise.all([
        requestRollingSkill("skills.get", { skillId }, signal),
        requestRollingSkill("skills.path", { skillId }, signal),
        requestRollingSkill("skillEdits.list", { skillId }, signal)
      ]);
      setDetail(next2);
      setManagedSkillPath(pathResult.path);
      setHasActiveEdit(editResult.sessions.some((session) => ["draft", "running", "idle", "applying", "needs_recovery"].includes(session.state)));
      return;
    }
    const next = await requestRollingSkill("skills.get", { skillId }, signal);
    setDetail(next);
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
  const publishedVersions = (0, import_react16.useMemo)(() => detail?.versions.filter((version) => version.state === "released") ?? [], [detail]);
  const releasedVersions = (0, import_react16.useMemo)(() => detail?.versions.filter((version) => version.state === "released" && !version.deprecatedAt) ?? [], [detail]);
  const released = releasedVersions[0] ?? null;
  const install = () => mutate(() => requestRollingSkill("installations.start", {
    skillId: detail?.skill.id,
    versionId: released?.id,
    targets: runtimeIds.map((selectedRuntimeId) => ({ runtimeId: selectedRuntimeId, modelId: null, effort: null, permissionMode: null }))
  }));
  const deprecate = (version) => mutate(() => requestRollingSkill("skills.deprecate", { versionId: version.id }));
  const revealManagedSkill = (skillId) => mutate(() => requestRollingSkill("skills.revealSkill", { skillId }));
  const copyManagedSkillPath = async () => {
    if (!managedSkillPath) return;
    setError(null);
    try {
      await window.navigator.clipboard.writeText(managedSkillPath);
      setPathCopied(true);
      window.setTimeout(() => setPathCopied(false), 1500);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t("loadError"));
    }
  };
  const chooseSource = async () => {
    if (sourceKind === "git-url") return;
    setBusy(true);
    setError(null);
    try {
      const selected = await requestRollingSkill("skills.chooseSource", { kind: sourceKind });
      if (selected.location) setSourceLocation(selected.location);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t("loadError"));
    } finally {
      setBusy(false);
    }
  };
  return /* @__PURE__ */ (0, import_jsx_runtime19.jsxs)("div", { className: "rolling-skill-data-stack", children: [
    mode !== "import" ? /* @__PURE__ */ (0, import_jsx_runtime19.jsxs)("label", { className: "rolling-skill-current-skill", children: [
      /* @__PURE__ */ (0, import_jsx_runtime19.jsx)("span", { children: t("currentManagedSkill") }),
      /* @__PURE__ */ (0, import_jsx_runtime19.jsx)("select", { "aria-label": t("currentManagedSkill"), className: "rolling-skill-select", value: detail?.skill.id ?? "", disabled: busy || catalog.skills.length === 0, onChange: (event) => {
        onSkillChange?.(event.target.value);
        void loadSkill(event.target.value);
      }, children: catalog.skills.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime19.jsx)("option", { value: "", children: t("emptySkills") }) : catalog.skills.map((skill) => /* @__PURE__ */ (0, import_jsx_runtime19.jsx)("option", { value: skill.id, children: skill.name }, skill.id)) })
    ] }) : null,
    error ? /* @__PURE__ */ (0, import_jsx_runtime19.jsx)("p", { className: "rolling-skill-inline-error", role: "alert", children: error }) : null,
    mode === "import" ? /* @__PURE__ */ (0, import_jsx_runtime19.jsxs)("section", { className: "rolling-skill-panel", children: [
      /* @__PURE__ */ (0, import_jsx_runtime19.jsxs)("div", { className: "rolling-skill-panel-header", children: [
        /* @__PURE__ */ (0, import_jsx_runtime19.jsxs)("div", { children: [
          /* @__PURE__ */ (0, import_jsx_runtime19.jsx)("h3", { children: t("skillRepositories") }),
          /* @__PURE__ */ (0, import_jsx_runtime19.jsx)("p", { children: t("skillRepositoriesDescription") })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime19.jsx)(ActionButton, { size: "sm", disabled: busy, onClick: () => void mutate(() => requestRollingSkill("skills.rescan", {})), children: t("rescan") })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime19.jsxs)("div", { className: "rolling-skill-skill-import", children: [
        /* @__PURE__ */ (0, import_jsx_runtime19.jsxs)("select", { "aria-label": t("skillSourceKind"), className: "rolling-skill-select", value: sourceKind, onChange: (event) => {
          setSourceKind(event.target.value);
          setSourceLocation("");
        }, children: [
          /* @__PURE__ */ (0, import_jsx_runtime19.jsx)("option", { value: "folder", children: t("skillSourceFolder") }),
          /* @__PURE__ */ (0, import_jsx_runtime19.jsx)("option", { value: "local-git", children: t("skillSourceLocalGit") }),
          /* @__PURE__ */ (0, import_jsx_runtime19.jsx)("option", { value: "git-url", children: t("skillSourceGitUrl") }),
          /* @__PURE__ */ (0, import_jsx_runtime19.jsx)("option", { value: "zip", children: t("skillSourceZip") })
        ] }),
        sourceKind === "git-url" ? /* @__PURE__ */ (0, import_jsx_runtime19.jsx)(import_dsh_client_ui_primitives13.Input, { value: sourceLocation, placeholder: t("skillGitUrlPlaceholder"), onChange: (event) => setSourceLocation(event.target.value) }) : /* @__PURE__ */ (0, import_jsx_runtime19.jsxs)("div", { className: "rolling-skill-skill-source-picker", children: [
          /* @__PURE__ */ (0, import_jsx_runtime19.jsx)(ActionButton, { size: "sm", disabled: busy, onClick: () => void chooseSource(), children: t(sourceKind === "zip" ? "chooseSkillZip" : "chooseSkillFolder") }),
          sourceLocation ? /* @__PURE__ */ (0, import_jsx_runtime19.jsxs)("div", { className: "rolling-skill-selected-source", title: sourceLocation, children: [
            /* @__PURE__ */ (0, import_jsx_runtime19.jsx)("span", { children: t("selectedSkillSource") }),
            /* @__PURE__ */ (0, import_jsx_runtime19.jsx)("code", { children: sourceLocation })
          ] }) : null
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime19.jsx)(ActionButton, { tone: "primary", size: "sm", disabled: busy || !sourceLocation.trim(), onClick: () => void mutate(() => requestRollingSkill("skills.import", { kind: sourceKind, location: sourceLocation })), children: t("importSkill") })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime19.jsxs)("div", { className: "rolling-skill-list", children: [
        catalog.skills.map((skill) => {
          const repository = catalog.repositories.find((entry) => entry.id === skill.repositoryId);
          const repositoryLabel = repository?.displayName && repository.displayName !== skill.name ? `${repository.displayName} \xB7 ` : "";
          return /* @__PURE__ */ (0, import_jsx_runtime19.jsxs)("article", { className: "rolling-skill-list-row rolling-skill-managed-skill-row", children: [
            /* @__PURE__ */ (0, import_jsx_runtime19.jsxs)("button", { type: "button", className: "rolling-skill-skill-row", "aria-current": detail?.skill.id === skill.id ? "true" : void 0, onClick: () => onOpenVersions?.(skill.id), children: [
              /* @__PURE__ */ (0, import_jsx_runtime19.jsx)("strong", { children: skill.name }),
              /* @__PURE__ */ (0, import_jsx_runtime19.jsxs)("span", { children: [
                repositoryLabel,
                skill.description || skill.status
              ] })
            ] }),
            /* @__PURE__ */ (0, import_jsx_runtime19.jsx)(ActionButton, { size: "sm", disabled: busy, onClick: () => void revealManagedSkill(skill.id), children: t("revealRepository") })
          ] }, skill.id);
        }),
        catalog.skills.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime19.jsx)("p", { children: t("emptySkills") }) : null
      ] })
    ] }) : null,
    mode === "versions" ? detail ? /* @__PURE__ */ (0, import_jsx_runtime19.jsxs)("section", { className: "rolling-skill-panel", children: [
      /* @__PURE__ */ (0, import_jsx_runtime19.jsxs)("div", { className: "rolling-skill-panel-header", children: [
        /* @__PURE__ */ (0, import_jsx_runtime19.jsxs)("div", { children: [
          /* @__PURE__ */ (0, import_jsx_runtime19.jsx)("h3", { children: detail.skill.name }),
          /* @__PURE__ */ (0, import_jsx_runtime19.jsx)("p", { children: detail.skill.description || detail.skill.status })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime19.jsxs)("div", { className: "rolling-skill-actions", children: [
          /* @__PURE__ */ (0, import_jsx_runtime19.jsx)(ActionButton, { tone: "primary", size: "sm", disabled: busy, onClick: () => setEditOpen(true), children: t(hasActiveEdit ? "continueSkillEdit" : "editSkillWithAgent") }),
          /* @__PURE__ */ (0, import_jsx_runtime19.jsx)(ActionButton, { size: "sm", disabled: busy, onClick: () => void revealManagedSkill(detail.skill.id), children: t("revealRepository") })
        ] })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime19.jsxs)("div", { className: "rolling-skill-managed-path", children: [
        /* @__PURE__ */ (0, import_jsx_runtime19.jsx)("span", { children: t("managedSkillPath") }),
        /* @__PURE__ */ (0, import_jsx_runtime19.jsx)("code", { title: managedSkillPath, children: managedSkillPath }),
        /* @__PURE__ */ (0, import_jsx_runtime19.jsx)(ActionButton, { size: "sm", disabled: !managedSkillPath, onClick: () => void copyManagedSkillPath(), children: t(pathCopied ? "pathCopied" : "copyPath") })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime19.jsxs)("details", { className: "rolling-skill-manifest-details", children: [
        /* @__PURE__ */ (0, import_jsx_runtime19.jsx)("summary", { children: t("viewSkillContent") }),
        /* @__PURE__ */ (0, import_jsx_runtime19.jsx)("pre", { className: "rolling-skill-manifest", children: detail.manifest })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime19.jsx)("h4", { className: "rolling-skill-version-heading", children: t("publishedVersions") }),
      /* @__PURE__ */ (0, import_jsx_runtime19.jsxs)("div", { className: "rolling-skill-list", children: [
        publishedVersions.map((version) => /* @__PURE__ */ (0, import_jsx_runtime19.jsxs)("article", { className: "rolling-skill-version-card", children: [
          /* @__PURE__ */ (0, import_jsx_runtime19.jsxs)("header", { children: [
            /* @__PURE__ */ (0, import_jsx_runtime19.jsx)("strong", { children: version.versionLabel ?? t("notAvailable") }),
            !version.deprecatedAt ? /* @__PURE__ */ (0, import_jsx_runtime19.jsx)(ActionButton, { size: "sm", disabled: busy, onClick: () => void deprecate(version), children: t("deprecateVersion") }) : /* @__PURE__ */ (0, import_jsx_runtime19.jsx)("span", { children: t("deprecatedVersion") })
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime19.jsx)("dl", { children: /* @__PURE__ */ (0, import_jsx_runtime19.jsxs)("div", { children: [
            /* @__PURE__ */ (0, import_jsx_runtime19.jsx)("dt", { children: t("createdAt") }),
            /* @__PURE__ */ (0, import_jsx_runtime19.jsx)("dd", { children: dateTime3(version.releasedAt ?? version.createdAt, t("notAvailable")) })
          ] }) })
        ] }, version.id)),
        publishedVersions.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime19.jsx)("p", { children: t("emptyPublishedVersions") }) : null
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime19.jsx)(SkillEditModal, { t, open: editOpen, skillId: detail.skill.id, skillName: detail.skill.name, onClose: () => {
        setEditOpen(false);
        setRevision((value) => value + 1);
      }, onPublished: () => {
        setHasActiveEdit(false);
        setRevision((value) => value + 1);
      } })
    ] }) : /* @__PURE__ */ (0, import_jsx_runtime19.jsx)("section", { className: "rolling-skill-panel", children: /* @__PURE__ */ (0, import_jsx_runtime19.jsx)("p", { children: t("emptySkills") }) }) : null,
    mode === "install" ? /* @__PURE__ */ (0, import_jsx_runtime19.jsxs)(import_jsx_runtime19.Fragment, { children: [
      detail ? /* @__PURE__ */ (0, import_jsx_runtime19.jsxs)("section", { className: "rolling-skill-panel", children: [
        /* @__PURE__ */ (0, import_jsx_runtime19.jsx)("div", { className: "rolling-skill-panel-header", children: /* @__PURE__ */ (0, import_jsx_runtime19.jsxs)("div", { children: [
          /* @__PURE__ */ (0, import_jsx_runtime19.jsx)("h3", { children: t("skillInstallTab") }),
          /* @__PURE__ */ (0, import_jsx_runtime19.jsxs)("p", { children: [
            detail.skill.name,
            " \xB7 ",
            released?.versionLabel ?? t("notAvailable")
          ] })
        ] }) }),
        /* @__PURE__ */ (0, import_jsx_runtime19.jsx)(RuntimeSelectionGrid, { t, runtimes, values: runtimeIds, onChange: setRuntimeIds }),
        /* @__PURE__ */ (0, import_jsx_runtime19.jsx)(ActionButton, { tone: "primary", disabled: busy || !released || runtimeIds.length === 0, onClick: () => void install(), children: t("installReleased") })
      ] }) : /* @__PURE__ */ (0, import_jsx_runtime19.jsx)("section", { className: "rolling-skill-panel", children: /* @__PURE__ */ (0, import_jsx_runtime19.jsx)("p", { children: t("emptySkills") }) }),
      /* @__PURE__ */ (0, import_jsx_runtime19.jsx)(InstallationsPanel, { t, initialJobId, refreshRevision: revision })
    ] }) : null
  ] });
}
function RuntimeSelectionGrid({ t, runtimes, values, onChange }) {
  return /* @__PURE__ */ (0, import_jsx_runtime19.jsxs)("fieldset", { className: "rolling-skill-runtime-select", children: [
    /* @__PURE__ */ (0, import_jsx_runtime19.jsx)("legend", { children: t("installationRuntime") }),
    /* @__PURE__ */ (0, import_jsx_runtime19.jsxs)("div", { className: "rolling-skill-runtime-list", children: [
      runtimes.map((runtime) => /* @__PURE__ */ (0, import_jsx_runtime19.jsxs)("label", { className: "rolling-skill-runtime-option", children: [
        /* @__PURE__ */ (0, import_jsx_runtime19.jsx)("input", { type: "checkbox", checked: values.includes(runtime.runtimeId), onChange: (event) => onChange(event.target.checked ? [...values, runtime.runtimeId] : values.filter((value) => value !== runtime.runtimeId)) }),
        /* @__PURE__ */ (0, import_jsx_runtime19.jsxs)("span", { children: [
          /* @__PURE__ */ (0, import_jsx_runtime19.jsxs)("strong", { children: [
            runtime.displayName,
            " ",
            runtime.version
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime19.jsx)("code", { children: runtime.executablePath })
        ] })
      ] }, runtime.runtimeId)),
      runtimes.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime19.jsx)("p", { children: t("noRuntimes") }) : null
    ] })
  ] });
}

// src/client/workbench/CurationPanel.tsx
var import_react18 = require("react");
var import_curation_selection = __toESM(require_curation_selection(), 1);

// src/client/workbench/CurationSessionView.tsx
var import_react17 = require("react");
var import_jsx_runtime20 = require("react/jsx-runtime");
function newKey(prefix) {
  return `${prefix}:${globalThis.crypto.randomUUID()}`;
}
function CurationSessionView({
  sessionId,
  t,
  onChanged,
  onNavigate
}) {
  const [revision, setRevision] = (0, import_react17.useState)(0);
  const [session, setSession] = (0, import_react17.useState)(null);
  const [error, setError] = (0, import_react17.useState)(null);
  const [message, setMessage] = (0, import_react17.useState)("");
  const [busy, setBusy] = (0, import_react17.useState)(false);
  const keys2 = (0, import_react17.useRef)(/* @__PURE__ */ new Map());
  (0, import_react17.useEffect)(() => {
    const controller = new AbortController();
    requestRollingSkill("curation.get", { sessionId }, controller.signal).then((value) => {
      setSession(value);
      setError(null);
    }).catch((reason) => {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : t("loadError"));
    });
    return () => controller.abort();
  }, [sessionId, revision]);
  (0, import_react17.useEffect)(() => {
    if (!session || !["queued", "running"].includes(session.status)) return;
    const timer = window.setTimeout(() => setRevision((value) => value + 1), 1500);
    return () => window.clearTimeout(timer);
  }, [session?.status, session?.revision]);
  const mutate = async (method, extra = {}) => {
    if (!session || busy) return false;
    const signature = `${method}:${session.revision}:${JSON.stringify(extra)}`;
    let idempotencyKey = keys2.current.get(signature);
    if (!idempotencyKey) {
      idempotencyKey = newKey(method);
      keys2.current.set(signature, idempotencyKey);
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
      keys2.current.delete(signature);
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
      return true;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t("loadError"));
      return false;
    } finally {
      setBusy(false);
    }
  };
  const sendRevision = async () => {
    const text5 = message.trim();
    if (!text5) return;
    if (await mutate("curation.send", { text: text5 })) setMessage("");
  };
  if (!session && !error) return /* @__PURE__ */ (0, import_jsx_runtime20.jsx)("div", { className: "rolling-skill-state", role: "status", children: t("loading") });
  if (!session) return /* @__PURE__ */ (0, import_jsx_runtime20.jsx)("div", { className: "rolling-skill-state rolling-skill-error", role: "alert", children: error });
  const editable = !["archived", "cancelled"].includes(session.status);
  const working = Boolean(session.curator?.working || ["queued", "running"].includes(session.status));
  return /* @__PURE__ */ (0, import_jsx_runtime20.jsxs)("section", { className: "rolling-skill-panel rolling-skill-session-view", children: [
    /* @__PURE__ */ (0, import_jsx_runtime20.jsxs)("div", { className: "rolling-skill-panel-header", children: [
      /* @__PURE__ */ (0, import_jsx_runtime20.jsxs)("div", { children: [
        /* @__PURE__ */ (0, import_jsx_runtime20.jsx)("h3", { children: session.episode?.originalQuestion ?? session.id }),
        /* @__PURE__ */ (0, import_jsx_runtime20.jsxs)("p", { children: [
          session.caseType,
          " \xB7 ",
          session.status
        ] })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime20.jsx)(ActionButton, { size: "sm", onClick: () => setRevision((value) => value + 1), children: t("refresh") })
    ] }),
    session.error || error ? /* @__PURE__ */ (0, import_jsx_runtime20.jsx)("p", { className: "rolling-skill-inline-error", role: "alert", children: error ?? session.error }) : null,
    /* @__PURE__ */ (0, import_jsx_runtime20.jsxs)("section", { className: "rolling-skill-curation-primary", children: [
      /* @__PURE__ */ (0, import_jsx_runtime20.jsx)("h4", { children: t("latestDraft") }),
      session.draft ? /* @__PURE__ */ (0, import_jsx_runtime20.jsx)(CurationDraftCard, { draft: session.draft, t }) : /* @__PURE__ */ (0, import_jsx_runtime20.jsx)("p", { children: t("noValidDraft") })
    ] }),
    editable ? /* @__PURE__ */ (0, import_jsx_runtime20.jsxs)("section", { className: "rolling-skill-curation-composer", children: [
      /* @__PURE__ */ (0, import_jsx_runtime20.jsxs)("div", { children: [
        /* @__PURE__ */ (0, import_jsx_runtime20.jsx)("h4", { children: t("revisionComposerTitle") }),
        /* @__PURE__ */ (0, import_jsx_runtime20.jsx)("p", { children: t("revisionComposerDescription") })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime20.jsx)(
        "textarea",
        {
          "aria-label": t("reviewMessage"),
          placeholder: t("reviewMessagePlaceholder"),
          value: message,
          disabled: working || busy,
          onChange: (event) => setMessage(event.target.value)
        }
      ),
      working ? /* @__PURE__ */ (0, import_jsx_runtime20.jsx)("p", { className: "rolling-skill-muted", role: "status", children: t("curationWorking") }) : null,
      /* @__PURE__ */ (0, import_jsx_runtime20.jsxs)("div", { className: "rolling-skill-actions", children: [
        /* @__PURE__ */ (0, import_jsx_runtime20.jsx)(ActionButton, { tone: "primary", disabled: working || busy || !message.trim(), onClick: () => void sendRevision(), children: t("generateRevision") }),
        session.status === "failed" ? /* @__PURE__ */ (0, import_jsx_runtime20.jsx)(ActionButton, { disabled: busy, onClick: () => mutate("curation.retry"), children: t("retry") }) : null,
        /* @__PURE__ */ (0, import_jsx_runtime20.jsx)(ActionButton, { disabled: busy || session.status !== "needs_review" || !session.draft, onClick: () => mutate("curation.save"), children: t("saveCase") }),
        /* @__PURE__ */ (0, import_jsx_runtime20.jsx)(ActionButton, { disabled: busy, onClick: () => {
          if (window.confirm(t("discardDraftConfirm"))) mutate("curation.discard");
        }, children: t("discardDraft") })
      ] })
    ] }) : null,
    /* @__PURE__ */ (0, import_jsx_runtime20.jsxs)("details", { className: "rolling-skill-curation-runtime-details", children: [
      /* @__PURE__ */ (0, import_jsx_runtime20.jsx)("summary", { children: t("runtimeInformation") }),
      /* @__PURE__ */ (0, import_jsx_runtime20.jsxs)("section", { className: "rolling-skill-evidence-card", children: [
        /* @__PURE__ */ (0, import_jsx_runtime20.jsx)("h4", { children: t("frozenEvidence") }),
        /* @__PURE__ */ (0, import_jsx_runtime20.jsxs)("dl", { children: [
          /* @__PURE__ */ (0, import_jsx_runtime20.jsxs)("div", { children: [
            /* @__PURE__ */ (0, import_jsx_runtime20.jsx)("dt", { children: t("sourceRange") }),
            /* @__PURE__ */ (0, import_jsx_runtime20.jsxs)("dd", { children: [
              session.episode?.source.startSeq,
              "\u2013",
              session.episode?.source.endSeq
            ] })
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime20.jsxs)("div", { children: [
            /* @__PURE__ */ (0, import_jsx_runtime20.jsx)("dt", { children: "Digest" }),
            /* @__PURE__ */ (0, import_jsx_runtime20.jsx)("dd", { children: /* @__PURE__ */ (0, import_jsx_runtime20.jsx)("code", { children: session.episode?.source.digest }) })
          ] })
        ] }),
        session.episode?.source.observedSkills.map((skill) => /* @__PURE__ */ (0, import_jsx_runtime20.jsxs)("p", { children: [
          skill.name,
          " \xB7 ",
          skill.provider,
          " \xB7 #",
          skill.callSeq,
          "\u2013",
          skill.resultSeq
        ] }, `${skill.name}:${skill.callSeq}`)),
        session.operationEvidence ? /* @__PURE__ */ (0, import_jsx_runtime20.jsxs)("dl", { children: [
          /* @__PURE__ */ (0, import_jsx_runtime20.jsxs)("div", { children: [
            /* @__PURE__ */ (0, import_jsx_runtime20.jsx)("dt", { children: t("skillRepositories") }),
            /* @__PURE__ */ (0, import_jsx_runtime20.jsxs)("dd", { children: [
              session.operationEvidence.skillName ?? t("notAvailable"),
              " \xB7 ",
              session.operationEvidence.versionLabel ?? t("notAvailable")
            ] })
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime20.jsxs)("div", { children: [
            /* @__PURE__ */ (0, import_jsx_runtime20.jsx)("dt", { children: t("installationCommit") }),
            /* @__PURE__ */ (0, import_jsx_runtime20.jsx)("dd", { children: /* @__PURE__ */ (0, import_jsx_runtime20.jsx)("code", { children: session.operationEvidence.commit?.slice(0, 12) ?? t("notAvailable") }) })
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime20.jsxs)("div", { children: [
            /* @__PURE__ */ (0, import_jsx_runtime20.jsx)("dt", { children: t("installationDigest") }),
            /* @__PURE__ */ (0, import_jsx_runtime20.jsx)("dd", { title: session.operationEvidence.contentDigest ?? void 0, children: /* @__PURE__ */ (0, import_jsx_runtime20.jsx)("code", { children: session.operationEvidence.contentDigest ?? t("notAvailable") }) })
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime20.jsxs)("div", { children: [
            /* @__PURE__ */ (0, import_jsx_runtime20.jsx)("dt", { children: t("frozenRubric") }),
            /* @__PURE__ */ (0, import_jsx_runtime20.jsx)("dd", { children: session.operationEvidence.rubricVersionId ?? t("notAvailable") })
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime20.jsxs)("div", { children: [
            /* @__PURE__ */ (0, import_jsx_runtime20.jsx)("dt", { children: t("installationRuntime") }),
            /* @__PURE__ */ (0, import_jsx_runtime20.jsxs)("dd", { children: [
              session.operationEvidence.runtime?.displayName ?? t("notAvailable"),
              " ",
              session.operationEvidence.runtime?.version ?? ""
            ] })
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime20.jsxs)("div", { children: [
            /* @__PURE__ */ (0, import_jsx_runtime20.jsx)("dt", { children: t("installationJob") }),
            /* @__PURE__ */ (0, import_jsx_runtime20.jsxs)("dd", { children: [
              session.operationEvidence.installation?.jobId ?? t("notAvailable"),
              " \xB7 ",
              session.operationEvidence.installation?.verification ?? t("notAvailable")
            ] })
          ] })
        ] }) : null,
        editable ? /* @__PURE__ */ (0, import_jsx_runtime20.jsxs)("div", { className: "rolling-skill-curation-model-controls", children: [
          /* @__PURE__ */ (0, import_jsx_runtime20.jsxs)("label", { className: "rolling-skill-field", children: [
            /* @__PURE__ */ (0, import_jsx_runtime20.jsx)("span", { children: t("model") }),
            /* @__PURE__ */ (0, import_jsx_runtime20.jsx)("input", { value: session.curator?.modelId ?? "", placeholder: t("configuredDefault"), onChange: (event) => setSession({ ...session, curator: { ...session.curator, modelId: event.target.value } }), onBlur: () => mutate("curation.model", { modelId: session.curator?.modelId || null }) })
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime20.jsxs)("label", { className: "rolling-skill-field", children: [
            /* @__PURE__ */ (0, import_jsx_runtime20.jsx)("span", { children: t("effort") }),
            /* @__PURE__ */ (0, import_jsx_runtime20.jsxs)("select", { className: "rolling-skill-select", value: session.curator?.effort ?? "", onChange: (event) => mutate("curation.effort", { effort: event.target.value || null }), children: [
              /* @__PURE__ */ (0, import_jsx_runtime20.jsx)("option", { value: "", children: t("configuredDefault") }),
              /* @__PURE__ */ (0, import_jsx_runtime20.jsx)("option", { value: "low", children: "low" }),
              /* @__PURE__ */ (0, import_jsx_runtime20.jsx)("option", { value: "medium", children: "medium" }),
              /* @__PURE__ */ (0, import_jsx_runtime20.jsx)("option", { value: "high", children: "high" }),
              /* @__PURE__ */ (0, import_jsx_runtime20.jsx)("option", { value: "xhigh", children: "xhigh" }),
              /* @__PURE__ */ (0, import_jsx_runtime20.jsx)("option", { value: "max", children: "max" })
            ] })
          ] })
        ] }) : null
      ] })
    ] })
  ] });
}
function StringList({ title, values }) {
  if (!values?.length) return null;
  return /* @__PURE__ */ (0, import_jsx_runtime20.jsxs)("section", { children: [
    /* @__PURE__ */ (0, import_jsx_runtime20.jsx)("h4", { children: title }),
    /* @__PURE__ */ (0, import_jsx_runtime20.jsx)("ul", { children: values.map((value, index2) => /* @__PURE__ */ (0, import_jsx_runtime20.jsx)("li", { children: value }, `${index2}:${value}`)) })
  ] });
}
function CurationDraftCard({ draft, t }) {
  const answer = draft.referenceAnswer;
  const hasDetails = Boolean(
    answer?.evidence?.length || draft.rubricCoverage?.length || draft.caseSpecificCriteria?.length || draft.caseAutomaticFailures?.length || draft.badCaseAnalysis
  );
  return /* @__PURE__ */ (0, import_jsx_runtime20.jsxs)("div", { className: "rolling-skill-curation-draft-card", children: [
    /* @__PURE__ */ (0, import_jsx_runtime20.jsxs)("header", { children: [
      /* @__PURE__ */ (0, import_jsx_runtime20.jsx)("strong", { children: answer?.summary ?? draft.schemaVersion ?? t("notAvailable") }),
      /* @__PURE__ */ (0, import_jsx_runtime20.jsx)("span", { className: "rolling-skill-badge", children: draft.schemaVersion })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime20.jsx)(StringList, { title: t("requiredFacts"), values: answer?.requiredFacts }),
    /* @__PURE__ */ (0, import_jsx_runtime20.jsx)(StringList, { title: t("requiredSteps"), values: answer?.requiredSteps }),
    /* @__PURE__ */ (0, import_jsx_runtime20.jsx)(StringList, { title: t("requiredOutputFormat"), values: answer?.requiredOutputFormat }),
    hasDetails ? /* @__PURE__ */ (0, import_jsx_runtime20.jsxs)("details", { className: "rolling-skill-curation-draft-details", children: [
      /* @__PURE__ */ (0, import_jsx_runtime20.jsx)("summary", { children: t("draftDetails") }),
      /* @__PURE__ */ (0, import_jsx_runtime20.jsxs)("div", { children: [
        answer?.evidence?.length ? /* @__PURE__ */ (0, import_jsx_runtime20.jsxs)("section", { children: [
          /* @__PURE__ */ (0, import_jsx_runtime20.jsx)("h4", { children: t("evidenceReferences") }),
          /* @__PURE__ */ (0, import_jsx_runtime20.jsx)("div", { className: "rolling-skill-rubric-criteria", children: answer.evidence.map((entry, index2) => /* @__PURE__ */ (0, import_jsx_runtime20.jsxs)("article", { children: [
            /* @__PURE__ */ (0, import_jsx_runtime20.jsx)("strong", { children: entry.claim }),
            /* @__PURE__ */ (0, import_jsx_runtime20.jsx)("p", { children: entry.sourceItemIds?.join(" \xB7 ") })
          ] }, `${index2}:${entry.claim}`)) })
        ] }) : null,
        draft.rubricCoverage?.length ? /* @__PURE__ */ (0, import_jsx_runtime20.jsxs)("section", { children: [
          /* @__PURE__ */ (0, import_jsx_runtime20.jsx)("h4", { children: t("rubricCoverage") }),
          /* @__PURE__ */ (0, import_jsx_runtime20.jsx)("div", { className: "rolling-skill-rubric-criteria", children: draft.rubricCoverage.map((entry, index2) => /* @__PURE__ */ (0, import_jsx_runtime20.jsxs)("article", { children: [
            /* @__PURE__ */ (0, import_jsx_runtime20.jsxs)("strong", { children: [
              entry.criterionId,
              " \xB7 ",
              entry.applicability
            ] }),
            /* @__PURE__ */ (0, import_jsx_runtime20.jsx)("p", { children: entry.expectation }),
            /* @__PURE__ */ (0, import_jsx_runtime20.jsx)("small", { children: entry.evidenceBasis })
          ] }, `${entry.criterionId}:${index2}`)) })
        ] }) : null,
        draft.caseSpecificCriteria?.length ? /* @__PURE__ */ (0, import_jsx_runtime20.jsxs)("section", { children: [
          /* @__PURE__ */ (0, import_jsx_runtime20.jsx)("h4", { children: t("caseSpecificCriteria") }),
          /* @__PURE__ */ (0, import_jsx_runtime20.jsx)("div", { className: "rolling-skill-rubric-criteria", children: draft.caseSpecificCriteria.map((entry, index2) => /* @__PURE__ */ (0, import_jsx_runtime20.jsxs)("article", { children: [
            /* @__PURE__ */ (0, import_jsx_runtime20.jsxs)("strong", { children: [
              entry.id,
              " \xB7 ",
              entry.criterion
            ] }),
            /* @__PURE__ */ (0, import_jsx_runtime20.jsxs)("span", { children: [
              t("weight"),
              " ",
              entry.weight
            ] })
          ] }, `${entry.id}:${index2}`)) })
        ] }) : null,
        draft.caseAutomaticFailures?.length ? /* @__PURE__ */ (0, import_jsx_runtime20.jsxs)("section", { children: [
          /* @__PURE__ */ (0, import_jsx_runtime20.jsx)("h4", { children: t("automaticFailures") }),
          /* @__PURE__ */ (0, import_jsx_runtime20.jsx)("ul", { children: draft.caseAutomaticFailures.map((entry, index2) => /* @__PURE__ */ (0, import_jsx_runtime20.jsx)("li", { children: typeof entry === "string" ? entry : `${entry.id ?? ""} ${entry.condition ?? ""} ${entry.rationale ?? ""}` }, index2)) })
        ] }) : null,
        draft.badCaseAnalysis ? /* @__PURE__ */ (0, import_jsx_runtime20.jsxs)("section", { children: [
          /* @__PURE__ */ (0, import_jsx_runtime20.jsx)("h4", { children: t("badCaseAnalysis") }),
          /* @__PURE__ */ (0, import_jsx_runtime20.jsx)("p", { children: typeof draft.badCaseAnalysis === "string" ? draft.badCaseAnalysis : draft.badCaseAnalysis.summary }),
          typeof draft.badCaseAnalysis === "object" ? /* @__PURE__ */ (0, import_jsx_runtime20.jsxs)(import_jsx_runtime20.Fragment, { children: [
            /* @__PURE__ */ (0, import_jsx_runtime20.jsx)(StringList, { title: t("rootCauses"), values: draft.badCaseAnalysis.rootCauses }),
            /* @__PURE__ */ (0, import_jsx_runtime20.jsx)(StringList, { title: t("improvements"), values: draft.badCaseAnalysis.improvements })
          ] }) : null
        ] }) : null
      ] })
    ] }) : null
  ] });
}

// src/client/workbench/CurationPanel.tsx
var import_jsx_runtime21 = require("react/jsx-runtime");
var visibleCurationSelection = import_curation_selection.default.visibleCurationSelection;
function CurationPanel({ t, initialSessionId, onNavigate }) {
  const [selectedId, setSelectedId] = (0, import_react18.useState)(initialSessionId ?? "");
  const [revision, setRevision] = (0, import_react18.useState)(0);
  const [showArchived, setShowArchived] = (0, import_react18.useState)(false);
  const [state, setState] = (0, import_react18.useState)({ status: "loading" });
  (0, import_react18.useEffect)(() => {
    if (initialSessionId) setSelectedId(initialSessionId);
  }, [initialSessionId]);
  (0, import_react18.useEffect)(() => {
    const controller = new AbortController();
    Promise.all([
      requestRollingSkill("curation.list", {}, controller.signal),
      requestRollingSkill("curation.list", { archived: true }, controller.signal)
    ]).then(([active, archived]) => {
      setState({ status: "ready", active: active.items, archived: archived.items });
    }).catch((error) => {
      if (!controller.signal.aborted) {
        setState({ status: "error", message: error instanceof Error ? error.message : t("loadError") });
      }
    });
    return () => controller.abort();
  }, [revision]);
  const items = state.status === "ready" ? showArchived ? state.archived : state.active : [];
  const visibleSelectedId = state.status === "ready" ? visibleCurationSelection(selectedId, items) : selectedId;
  (0, import_react18.useEffect)(() => {
    if (state.status !== "ready") return;
    setSelectedId((current) => visibleCurationSelection(current, items));
  }, [state, showArchived]);
  (0, import_react18.useEffect)(() => {
    if (!initialSessionId || state.status !== "ready" || selectedId !== initialSessionId) return;
    if (state.archived.some((session) => session.id === initialSessionId)) setShowArchived(true);
    if (state.active.some((session) => session.id === initialSessionId)) setShowArchived(false);
  }, [initialSessionId, selectedId, state]);
  if (state.status === "loading") return /* @__PURE__ */ (0, import_jsx_runtime21.jsx)("div", { className: "rolling-skill-state", role: "status", children: t("loading") });
  if (state.status === "error") return /* @__PURE__ */ (0, import_jsx_runtime21.jsxs)("div", { className: "rolling-skill-state rolling-skill-error", role: "alert", children: [
    /* @__PURE__ */ (0, import_jsx_runtime21.jsx)("span", { children: state.message }),
    /* @__PURE__ */ (0, import_jsx_runtime21.jsx)(ActionButton, { size: "sm", onClick: () => setRevision((value) => value + 1), children: t("retry") })
  ] });
  return /* @__PURE__ */ (0, import_jsx_runtime21.jsxs)("div", { className: "rolling-skill-review-layout", children: [
    /* @__PURE__ */ (0, import_jsx_runtime21.jsxs)("aside", { className: "rolling-skill-panel rolling-skill-review-list", children: [
      /* @__PURE__ */ (0, import_jsx_runtime21.jsxs)("div", { className: "rolling-skill-panel-header", children: [
        /* @__PURE__ */ (0, import_jsx_runtime21.jsxs)("div", { children: [
          /* @__PURE__ */ (0, import_jsx_runtime21.jsx)("h3", { children: t("curation") }),
          /* @__PURE__ */ (0, import_jsx_runtime21.jsx)("p", { children: t("curationDescription") })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime21.jsx)(ActionButton, { size: "sm", onClick: () => setRevision((value) => value + 1), children: t("refresh") })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime21.jsxs)("div", { className: "rolling-skill-review-scope", role: "group", "aria-label": t("draftStatusFilter"), children: [
        /* @__PURE__ */ (0, import_jsx_runtime21.jsxs)("button", { type: "button", "aria-pressed": !showArchived, onClick: () => setShowArchived(false), children: [
          t("activeDrafts"),
          " ",
          /* @__PURE__ */ (0, import_jsx_runtime21.jsx)("span", { children: state.active.length })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime21.jsxs)("button", { type: "button", "aria-pressed": showArchived, onClick: () => setShowArchived(true), children: [
          t("archivedDrafts"),
          " ",
          /* @__PURE__ */ (0, import_jsx_runtime21.jsx)("span", { children: state.archived.length })
        ] })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime21.jsx)("div", { className: "rolling-skill-list", children: items.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime21.jsx)("p", { children: t("emptyDrafts") }) : items.map((session) => /* @__PURE__ */ (0, import_jsx_runtime21.jsxs)(
        "button",
        {
          type: "button",
          className: "rolling-skill-review-list-button",
          "data-selected": visibleSelectedId === session.id,
          onClick: () => {
            setSelectedId(session.id);
            onNavigate({ page: "curation", sessionId: session.id });
          },
          children: [
            /* @__PURE__ */ (0, import_jsx_runtime21.jsx)("strong", { children: session.episode?.originalQuestion || session.id }),
            /* @__PURE__ */ (0, import_jsx_runtime21.jsxs)("span", { children: [
              session.caseType,
              " \xB7 ",
              session.status
            ] })
          ]
        },
        session.id
      )) })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime21.jsx)("main", { className: "rolling-skill-review-detail", children: visibleSelectedId ? /* @__PURE__ */ (0, import_jsx_runtime21.jsx)(
      CurationSessionView,
      {
        sessionId: visibleSelectedId,
        t,
        onChanged: () => setRevision((value) => value + 1),
        onNavigate
      },
      visibleSelectedId
    ) : /* @__PURE__ */ (0, import_jsx_runtime21.jsx)("div", { className: "rolling-skill-state", children: t("selectDraft") }) })
  ] });
}

// src/client/workbench/RubricPanel.tsx
var import_react20 = require("react");

// src/client/workbench/RubricSessionView.tsx
var import_react19 = require("react");
var import_jsx_runtime22 = require("react/jsx-runtime");
function RubricSessionView({ sessionId, t, onChanged }) {
  const [revision, setRevision] = (0, import_react19.useState)(0);
  const [session, setSession] = (0, import_react19.useState)(null);
  const [message, setMessage] = (0, import_react19.useState)("");
  const [error, setError] = (0, import_react19.useState)(null);
  const [busy, setBusy] = (0, import_react19.useState)(false);
  const keys2 = (0, import_react19.useRef)(/* @__PURE__ */ new Map());
  (0, import_react19.useEffect)(() => {
    const controller = new AbortController();
    requestRollingSkill("rubrics.get", { sessionId }, controller.signal).then((value) => {
      setSession(value);
      setError(null);
    }).catch((reason) => {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : t("loadError"));
    });
    return () => controller.abort();
  }, [sessionId, revision]);
  (0, import_react19.useEffect)(() => {
    if (!session || !["queued", "running"].includes(session.status)) return;
    const timer = window.setTimeout(() => setRevision((value) => value + 1), 1500);
    return () => window.clearTimeout(timer);
  }, [session?.status, session?.revision]);
  const mutate = async (method, extra = {}) => {
    if (!session || busy) return;
    const signature = `${method}:${session.revision}:${JSON.stringify(extra)}`;
    let idempotencyKey = keys2.current.get(signature);
    if (!idempotencyKey) {
      idempotencyKey = `${method}:${globalThis.crypto.randomUUID()}`;
      keys2.current.set(signature, idempotencyKey);
    }
    setBusy(true);
    setError(null);
    try {
      const result = await requestRollingSkill(method, { sessionId: session.id, expectedRevision: session.revision, idempotencyKey, ...extra });
      keys2.current.delete(signature);
      const updated = result.session ?? result;
      if (updated?.id) setSession(updated);
      if (method === "rubrics.publish" || method === "rubrics.discard") onChanged();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t("loadError"));
    } finally {
      setBusy(false);
    }
  };
  if (!session && !error) return /* @__PURE__ */ (0, import_jsx_runtime22.jsx)("div", { className: "rolling-skill-state", role: "status", children: t("loading") });
  if (!session) return /* @__PURE__ */ (0, import_jsx_runtime22.jsx)("div", { className: "rolling-skill-state rolling-skill-error", role: "alert", children: error });
  const editable = !["archived", "cancelled"].includes(session.status);
  return /* @__PURE__ */ (0, import_jsx_runtime22.jsxs)("section", { className: "rolling-skill-panel rolling-skill-session-view", children: [
    /* @__PURE__ */ (0, import_jsx_runtime22.jsxs)("div", { className: "rolling-skill-panel-header", children: [
      /* @__PURE__ */ (0, import_jsx_runtime22.jsxs)("div", { children: [
        /* @__PURE__ */ (0, import_jsx_runtime22.jsx)("h3", { children: t("rubricReview") }),
        /* @__PURE__ */ (0, import_jsx_runtime22.jsx)("p", { children: session.status })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime22.jsx)(ActionButton, { size: "sm", onClick: () => setRevision((value) => value + 1), children: t("refresh") })
    ] }),
    session.error || error ? /* @__PURE__ */ (0, import_jsx_runtime22.jsx)("p", { className: "rolling-skill-inline-error", role: "alert", children: error ?? session.error }) : null,
    session.operationEvidence ? /* @__PURE__ */ (0, import_jsx_runtime22.jsxs)("section", { className: "rolling-skill-evidence-card", children: [
      /* @__PURE__ */ (0, import_jsx_runtime22.jsx)("h4", { children: t("frozenEvidence") }),
      /* @__PURE__ */ (0, import_jsx_runtime22.jsxs)("dl", { children: [
        /* @__PURE__ */ (0, import_jsx_runtime22.jsxs)("div", { children: [
          /* @__PURE__ */ (0, import_jsx_runtime22.jsx)("dt", { children: t("skillRepositories") }),
          /* @__PURE__ */ (0, import_jsx_runtime22.jsxs)("dd", { children: [
            session.operationEvidence.skillName ?? t("notAvailable"),
            " \xB7 ",
            session.operationEvidence.versionLabel ?? t("notAvailable")
          ] })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime22.jsxs)("div", { children: [
          /* @__PURE__ */ (0, import_jsx_runtime22.jsx)("dt", { children: t("installationCommit") }),
          /* @__PURE__ */ (0, import_jsx_runtime22.jsx)("dd", { children: /* @__PURE__ */ (0, import_jsx_runtime22.jsx)("code", { children: session.operationEvidence.commit?.slice(0, 12) ?? t("notAvailable") }) })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime22.jsxs)("div", { children: [
          /* @__PURE__ */ (0, import_jsx_runtime22.jsx)("dt", { children: t("installationDigest") }),
          /* @__PURE__ */ (0, import_jsx_runtime22.jsx)("dd", { title: session.operationEvidence.contentDigest ?? void 0, children: /* @__PURE__ */ (0, import_jsx_runtime22.jsx)("code", { children: session.operationEvidence.contentDigest ?? t("notAvailable") }) })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime22.jsxs)("div", { children: [
          /* @__PURE__ */ (0, import_jsx_runtime22.jsx)("dt", { children: t("installationRuntime") }),
          /* @__PURE__ */ (0, import_jsx_runtime22.jsxs)("dd", { children: [
            session.operationEvidence.runtime?.displayName ?? t("notAvailable"),
            " ",
            session.operationEvidence.runtime?.version ?? ""
          ] })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime22.jsxs)("div", { children: [
          /* @__PURE__ */ (0, import_jsx_runtime22.jsx)("dt", { children: t("installationJob") }),
          /* @__PURE__ */ (0, import_jsx_runtime22.jsxs)("dd", { children: [
            session.operationEvidence.installation?.jobId ?? t("notAvailable"),
            " \xB7 ",
            session.operationEvidence.installation?.verification ?? t("notAvailable")
          ] })
        ] })
      ] })
    ] }) : null,
    /* @__PURE__ */ (0, import_jsx_runtime22.jsxs)("section", { children: [
      /* @__PURE__ */ (0, import_jsx_runtime22.jsx)("h4", { children: t("rubricAgentConversation") }),
      /* @__PURE__ */ (0, import_jsx_runtime22.jsx)("div", { className: "rolling-skill-conversation-log", children: session.conversation.map((entry) => /* @__PURE__ */ (0, import_jsx_runtime22.jsxs)("div", { "data-role": entry.role, children: [
        /* @__PURE__ */ (0, import_jsx_runtime22.jsx)("strong", { children: entry.role }),
        /* @__PURE__ */ (0, import_jsx_runtime22.jsx)("p", { children: entry.text })
      ] }, entry.id)) })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime22.jsxs)("section", { children: [
      /* @__PURE__ */ (0, import_jsx_runtime22.jsx)("h4", { children: t("latestRubricDraft") }),
      session.draft ? /* @__PURE__ */ (0, import_jsx_runtime22.jsxs)("div", { className: "rolling-skill-rubric-draft", children: [
        /* @__PURE__ */ (0, import_jsx_runtime22.jsx)("h3", { children: session.draft.title }),
        /* @__PURE__ */ (0, import_jsx_runtime22.jsx)("p", { children: session.draft.summary }),
        /* @__PURE__ */ (0, import_jsx_runtime22.jsx)("p", { children: session.draft.scoringModel }),
        session.draft.criteria?.map((criterion) => /* @__PURE__ */ (0, import_jsx_runtime22.jsxs)("article", { children: [
          /* @__PURE__ */ (0, import_jsx_runtime22.jsxs)("strong", { children: [
            criterion.id,
            " \xB7 ",
            criterion.title,
            " \xB7 ",
            t("weight"),
            " ",
            criterion.weight
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime22.jsx)("p", { children: criterion.criterion }),
          criterion.evidenceRequirements?.length ? /* @__PURE__ */ (0, import_jsx_runtime22.jsxs)("p", { children: [
            /* @__PURE__ */ (0, import_jsx_runtime22.jsxs)("b", { children: [
              t("rubricEvidenceRequirements"),
              ": "
            ] }),
            criterion.evidenceRequirements.join(" \xB7 ")
          ] }) : null,
          criterion.scoringAnchors ? /* @__PURE__ */ (0, import_jsx_runtime22.jsxs)("details", { children: [
            /* @__PURE__ */ (0, import_jsx_runtime22.jsx)("summary", { children: t("scoringAnchors") }),
            /* @__PURE__ */ (0, import_jsx_runtime22.jsx)("dl", { children: Object.entries(criterion.scoringAnchors).map(([score, anchor]) => /* @__PURE__ */ (0, import_jsx_runtime22.jsxs)("div", { children: [
              /* @__PURE__ */ (0, import_jsx_runtime22.jsx)("dt", { children: score }),
              /* @__PURE__ */ (0, import_jsx_runtime22.jsx)("dd", { children: anchor })
            ] }, score)) })
          ] }) : null,
          criterion.criticalFailure ? /* @__PURE__ */ (0, import_jsx_runtime22.jsx)("span", { className: "rolling-skill-inline-error", children: t("criticalFailure") }) : null
        ] }, criterion.id)),
        session.draft.automaticFailures?.length ? /* @__PURE__ */ (0, import_jsx_runtime22.jsxs)("section", { children: [
          /* @__PURE__ */ (0, import_jsx_runtime22.jsx)("h4", { children: t("automaticFailures") }),
          session.draft.automaticFailures.map((failure) => /* @__PURE__ */ (0, import_jsx_runtime22.jsxs)("article", { children: [
            /* @__PURE__ */ (0, import_jsx_runtime22.jsxs)("strong", { children: [
              failure.id,
              " \xB7 ",
              failure.condition
            ] }),
            /* @__PURE__ */ (0, import_jsx_runtime22.jsx)("p", { children: failure.rationale })
          ] }, failure.id))
        ] }) : null
      ] }) : /* @__PURE__ */ (0, import_jsx_runtime22.jsx)("p", { children: t("noValidDraft") })
    ] }),
    editable ? /* @__PURE__ */ (0, import_jsx_runtime22.jsxs)("div", { className: "rolling-skill-form-stack", children: [
      /* @__PURE__ */ (0, import_jsx_runtime22.jsxs)("label", { className: "rolling-skill-field", children: [
        /* @__PURE__ */ (0, import_jsx_runtime22.jsx)("span", { children: t("model") }),
        /* @__PURE__ */ (0, import_jsx_runtime22.jsx)("input", { value: session.rubricAgent?.modelId ?? "", placeholder: t("configuredDefault"), onChange: (event) => setSession({ ...session, rubricAgent: { ...session.rubricAgent, modelId: event.target.value } }), onBlur: () => mutate("rubrics.model", { modelId: session.rubricAgent?.modelId || null }) })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime22.jsxs)("label", { className: "rolling-skill-field", children: [
        /* @__PURE__ */ (0, import_jsx_runtime22.jsx)("span", { children: t("effort") }),
        /* @__PURE__ */ (0, import_jsx_runtime22.jsxs)("select", { className: "rolling-skill-select", value: session.rubricAgent?.effort ?? "", onChange: (event) => mutate("rubrics.effort", { effort: event.target.value || null }), children: [
          /* @__PURE__ */ (0, import_jsx_runtime22.jsx)("option", { value: "", children: t("configuredDefault") }),
          /* @__PURE__ */ (0, import_jsx_runtime22.jsx)("option", { value: "low", children: "low" }),
          /* @__PURE__ */ (0, import_jsx_runtime22.jsx)("option", { value: "medium", children: "medium" }),
          /* @__PURE__ */ (0, import_jsx_runtime22.jsx)("option", { value: "high", children: "high" }),
          /* @__PURE__ */ (0, import_jsx_runtime22.jsx)("option", { value: "xhigh", children: "xhigh" }),
          /* @__PURE__ */ (0, import_jsx_runtime22.jsx)("option", { value: "max", children: "max" })
        ] })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime22.jsxs)("label", { className: "rolling-skill-field", children: [
        /* @__PURE__ */ (0, import_jsx_runtime22.jsx)("span", { children: t("reviewMessage") }),
        /* @__PURE__ */ (0, import_jsx_runtime22.jsx)("textarea", { value: message, onChange: (event) => setMessage(event.target.value) })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime22.jsxs)("div", { className: "rolling-skill-actions", children: [
        /* @__PURE__ */ (0, import_jsx_runtime22.jsx)(ActionButton, { tone: "primary", disabled: busy || !message.trim(), onClick: () => mutate("rubrics.send", { text: message.trim() }).then(() => setMessage("")), children: t("sendRevision") }),
        session.status === "failed" ? /* @__PURE__ */ (0, import_jsx_runtime22.jsx)(ActionButton, { disabled: busy, onClick: () => mutate("rubrics.retry"), children: t("retry") }) : null,
        /* @__PURE__ */ (0, import_jsx_runtime22.jsx)(ActionButton, { disabled: busy || session.status !== "needs_review" || !session.draft, onClick: () => mutate("rubrics.publish"), children: t("publishRubric") }),
        /* @__PURE__ */ (0, import_jsx_runtime22.jsx)(ActionButton, { disabled: busy, onClick: () => {
          if (window.confirm(t("discardRubricConfirm"))) mutate("rubrics.discard");
        }, children: t("discardDraft") })
      ] })
    ] }) : null
  ] });
}

// src/client/workbench/RubricPanel.tsx
var import_jsx_runtime23 = require("react/jsx-runtime");
function RubricPanel({
  t,
  initialDatasetId,
  initialSessionId,
  onNavigate
}) {
  const [datasets, setDatasets] = (0, import_react20.useState)([]);
  const [datasetId, setDatasetId] = (0, import_react20.useState)(initialDatasetId ?? "");
  const [selectedSessionId, setSelectedSessionId] = (0, import_react20.useState)(initialSessionId ?? "");
  const [sessions, setSessions] = (0, import_react20.useState)([]);
  const [versions, setVersions] = (0, import_react20.useState)([]);
  const [active, setActive] = (0, import_react20.useState)(null);
  const [modelId, setModelId] = (0, import_react20.useState)("");
  const [effort, setEffort] = (0, import_react20.useState)("");
  const [revision, setRevision] = (0, import_react20.useState)(0);
  const [busy, setBusy] = (0, import_react20.useState)(false);
  const [error, setError] = (0, import_react20.useState)(null);
  (0, import_react20.useEffect)(() => {
    const controller = new AbortController();
    Promise.all([
      requestRollingSkill("datasets.list", {}, controller.signal),
      requestRollingSkill("settings.get", {}, controller.signal)
    ]).then(([rows, settings]) => {
      setDatasets(rows);
      setDatasetId((current) => current || rows[0]?.id || "");
      setModelId((current) => current || settings.rollingSkill.rubricProfile.modelId || "");
      setEffort((current) => current || settings.rollingSkill.rubricProfile.effort || "");
    }).catch((reason) => {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : t("loadError"));
    });
    return () => controller.abort();
  }, []);
  (0, import_react20.useEffect)(() => {
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
  const create2 = async () => {
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
  return /* @__PURE__ */ (0, import_jsx_runtime23.jsxs)("div", { className: "rolling-skill-review-layout", children: [
    /* @__PURE__ */ (0, import_jsx_runtime23.jsxs)("aside", { className: "rolling-skill-panel rolling-skill-review-list", children: [
      /* @__PURE__ */ (0, import_jsx_runtime23.jsx)("div", { className: "rolling-skill-panel-header", children: /* @__PURE__ */ (0, import_jsx_runtime23.jsxs)("div", { children: [
        /* @__PURE__ */ (0, import_jsx_runtime23.jsx)("h3", { children: t("rubrics") }),
        /* @__PURE__ */ (0, import_jsx_runtime23.jsx)("p", { children: t("rubricDescription") })
      ] }) }),
      /* @__PURE__ */ (0, import_jsx_runtime23.jsxs)("label", { className: "rolling-skill-field", children: [
        /* @__PURE__ */ (0, import_jsx_runtime23.jsx)("span", { children: t("selectDataset") }),
        /* @__PURE__ */ (0, import_jsx_runtime23.jsx)("select", { className: "rolling-skill-select", value: datasetId, onChange: (event) => {
          setDatasetId(event.target.value);
          setSelectedSessionId("");
        }, children: datasets.map((dataset) => /* @__PURE__ */ (0, import_jsx_runtime23.jsx)("option", { value: dataset.id, children: dataset.name }, dataset.id)) })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime23.jsxs)("div", { className: "rolling-skill-form-stack rolling-skill-create-rubric", children: [
        /* @__PURE__ */ (0, import_jsx_runtime23.jsxs)("label", { className: "rolling-skill-field", children: [
          /* @__PURE__ */ (0, import_jsx_runtime23.jsx)("span", { children: t("model") }),
          /* @__PURE__ */ (0, import_jsx_runtime23.jsx)("input", { value: modelId, placeholder: t("configuredDefault"), onChange: (event) => setModelId(event.target.value) })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime23.jsxs)("label", { className: "rolling-skill-field", children: [
          /* @__PURE__ */ (0, import_jsx_runtime23.jsx)("span", { children: t("effort") }),
          /* @__PURE__ */ (0, import_jsx_runtime23.jsxs)("select", { className: "rolling-skill-select", value: effort, onChange: (event) => setEffort(event.target.value), children: [
            /* @__PURE__ */ (0, import_jsx_runtime23.jsx)("option", { value: "", children: t("configuredDefault") }),
            /* @__PURE__ */ (0, import_jsx_runtime23.jsx)("option", { value: "low", children: "low" }),
            /* @__PURE__ */ (0, import_jsx_runtime23.jsx)("option", { value: "medium", children: "medium" }),
            /* @__PURE__ */ (0, import_jsx_runtime23.jsx)("option", { value: "high", children: "high" }),
            /* @__PURE__ */ (0, import_jsx_runtime23.jsx)("option", { value: "xhigh", children: "xhigh" }),
            /* @__PURE__ */ (0, import_jsx_runtime23.jsx)("option", { value: "max", children: "max" })
          ] })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime23.jsx)(ActionButton, { tone: "primary", disabled: !datasetId || busy, onClick: create2, children: t("createRubric") })
      ] }),
      error ? /* @__PURE__ */ (0, import_jsx_runtime23.jsx)("p", { className: "rolling-skill-inline-error", role: "alert", children: error }) : null,
      /* @__PURE__ */ (0, import_jsx_runtime23.jsx)("h4", { children: t("rubricSessions") }),
      /* @__PURE__ */ (0, import_jsx_runtime23.jsx)("div", { className: "rolling-skill-list", children: sessions.map((session) => /* @__PURE__ */ (0, import_jsx_runtime23.jsxs)("button", { type: "button", className: "rolling-skill-review-list-button", "data-selected": selectedSessionId === session.id, onClick: () => {
        setSelectedSessionId(session.id);
        onNavigate({ page: "rubrics", datasetId, sessionId: session.id });
      }, children: [
        /* @__PURE__ */ (0, import_jsx_runtime23.jsx)("strong", { children: session.status }),
        /* @__PURE__ */ (0, import_jsx_runtime23.jsx)("span", { children: session.updatedAt })
      ] }, session.id)) }),
      /* @__PURE__ */ (0, import_jsx_runtime23.jsx)("h4", { children: t("rubricHistory") }),
      active ? /* @__PURE__ */ (0, import_jsx_runtime23.jsxs)("p", { className: "rolling-skill-badge", children: [
        t("activeRubric"),
        " \xB7 v",
        active.version
      ] }) : /* @__PURE__ */ (0, import_jsx_runtime23.jsx)("p", { children: t("noActiveRubric") }),
      active && active.rubric.scoringModel !== "unified-100/v1" ? /* @__PURE__ */ (0, import_jsx_runtime23.jsxs)("section", { className: "rolling-skill-subpanel", children: [
        /* @__PURE__ */ (0, import_jsx_runtime23.jsx)("p", { children: t("legacyRubricNotice") }),
        /* @__PURE__ */ (0, import_jsx_runtime23.jsx)(ActionButton, { size: "sm", disabled: busy, onClick: () => void migrateLegacy(), children: t("migrateLegacyRubric") })
      ] }) : null,
      /* @__PURE__ */ (0, import_jsx_runtime23.jsx)("div", { className: "rolling-skill-list", children: versions.map((version) => /* @__PURE__ */ (0, import_jsx_runtime23.jsx)(RubricVersionCard, { version, active: version.id === active?.id, t }, version.id)) })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime23.jsx)("main", { className: "rolling-skill-review-detail", children: selectedSessionId ? /* @__PURE__ */ (0, import_jsx_runtime23.jsx)(RubricSessionView, { sessionId: selectedSessionId, t, onChanged: () => setRevision((value) => value + 1) }) : active ? /* @__PURE__ */ (0, import_jsx_runtime23.jsx)(RubricVersionCard, { version: active, active: true, t }) : /* @__PURE__ */ (0, import_jsx_runtime23.jsx)("div", { className: "rolling-skill-state", children: t("selectRubricSession") }) })
  ] });
}
function RubricVersionCard({ version, active, t }) {
  const evidence = version.operationEvidence;
  return /* @__PURE__ */ (0, import_jsx_runtime23.jsxs)("details", { className: "rolling-skill-rubric-version", open: active, children: [
    /* @__PURE__ */ (0, import_jsx_runtime23.jsxs)("summary", { children: [
      /* @__PURE__ */ (0, import_jsx_runtime23.jsxs)("span", { children: [
        /* @__PURE__ */ (0, import_jsx_runtime23.jsxs)("strong", { children: [
          "v",
          version.version,
          " \xB7 ",
          version.rubric.title ?? t("notAvailable")
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime23.jsx)("small", { children: new Date(version.createdAt).toLocaleString() })
      ] }),
      active ? /* @__PURE__ */ (0, import_jsx_runtime23.jsx)("span", { className: "rolling-skill-badge", children: t("activeRubric") }) : null
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime23.jsxs)("div", { className: "rolling-skill-rubric-version-body", children: [
      /* @__PURE__ */ (0, import_jsx_runtime23.jsx)("p", { children: version.rubric.summary }),
      /* @__PURE__ */ (0, import_jsx_runtime23.jsxs)("dl", { children: [
        /* @__PURE__ */ (0, import_jsx_runtime23.jsxs)("div", { children: [
          /* @__PURE__ */ (0, import_jsx_runtime23.jsx)("dt", { children: t("scoringModel") }),
          /* @__PURE__ */ (0, import_jsx_runtime23.jsx)("dd", { children: version.rubric.scoringModel ?? t("notAvailable") })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime23.jsxs)("div", { children: [
          /* @__PURE__ */ (0, import_jsx_runtime23.jsx)("dt", { children: t("rubricDigest") }),
          /* @__PURE__ */ (0, import_jsx_runtime23.jsx)("dd", { title: version.rubricDigest ?? void 0, children: /* @__PURE__ */ (0, import_jsx_runtime23.jsx)("code", { children: version.rubricDigest ?? t("notAvailable") }) })
        ] }),
        evidence ? /* @__PURE__ */ (0, import_jsx_runtime23.jsxs)(import_jsx_runtime23.Fragment, { children: [
          /* @__PURE__ */ (0, import_jsx_runtime23.jsxs)("div", { children: [
            /* @__PURE__ */ (0, import_jsx_runtime23.jsx)("dt", { children: t("skillRepositories") }),
            /* @__PURE__ */ (0, import_jsx_runtime23.jsxs)("dd", { children: [
              evidence.skillName ?? t("notAvailable"),
              " \xB7 ",
              evidence.versionLabel ?? t("notAvailable")
            ] })
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime23.jsxs)("div", { children: [
            /* @__PURE__ */ (0, import_jsx_runtime23.jsx)("dt", { children: t("installationCommit") }),
            /* @__PURE__ */ (0, import_jsx_runtime23.jsx)("dd", { children: /* @__PURE__ */ (0, import_jsx_runtime23.jsx)("code", { children: evidence.commit?.slice(0, 12) ?? t("notAvailable") }) })
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime23.jsxs)("div", { children: [
            /* @__PURE__ */ (0, import_jsx_runtime23.jsx)("dt", { children: t("installationRuntime") }),
            /* @__PURE__ */ (0, import_jsx_runtime23.jsxs)("dd", { children: [
              evidence.runtime?.displayName ?? t("notAvailable"),
              " ",
              evidence.runtime?.version ?? ""
            ] })
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime23.jsxs)("div", { children: [
            /* @__PURE__ */ (0, import_jsx_runtime23.jsx)("dt", { children: t("installationJob") }),
            /* @__PURE__ */ (0, import_jsx_runtime23.jsxs)("dd", { children: [
              evidence.installation?.jobId ?? t("notAvailable"),
              " \xB7 ",
              evidence.installation?.verification ?? t("notAvailable")
            ] })
          ] })
        ] }) : null
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime23.jsx)("h4", { children: t("rubricCriteria") }),
      /* @__PURE__ */ (0, import_jsx_runtime23.jsx)("div", { className: "rolling-skill-rubric-criteria", children: version.rubric.criteria?.map((criterion) => /* @__PURE__ */ (0, import_jsx_runtime23.jsxs)("article", { children: [
        /* @__PURE__ */ (0, import_jsx_runtime23.jsxs)("header", { children: [
          /* @__PURE__ */ (0, import_jsx_runtime23.jsxs)("strong", { children: [
            criterion.id,
            " \xB7 ",
            criterion.title
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime23.jsxs)("span", { children: [
            t("weight"),
            " ",
            criterion.weight
          ] })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime23.jsx)("p", { children: criterion.criterion }),
        criterion.evidenceRequirements?.length ? /* @__PURE__ */ (0, import_jsx_runtime23.jsxs)("p", { children: [
          /* @__PURE__ */ (0, import_jsx_runtime23.jsxs)("b", { children: [
            t("rubricEvidenceRequirements"),
            ": "
          ] }),
          criterion.evidenceRequirements.join(" \xB7 ")
        ] }) : null,
        criterion.scoringAnchors ? /* @__PURE__ */ (0, import_jsx_runtime23.jsxs)("details", { children: [
          /* @__PURE__ */ (0, import_jsx_runtime23.jsx)("summary", { children: t("scoringAnchors") }),
          /* @__PURE__ */ (0, import_jsx_runtime23.jsx)("dl", { children: Object.entries(criterion.scoringAnchors).map(([score, anchor]) => /* @__PURE__ */ (0, import_jsx_runtime23.jsxs)("div", { children: [
            /* @__PURE__ */ (0, import_jsx_runtime23.jsx)("dt", { children: score }),
            /* @__PURE__ */ (0, import_jsx_runtime23.jsx)("dd", { children: anchor })
          ] }, score)) })
        ] }) : null,
        criterion.criticalFailure ? /* @__PURE__ */ (0, import_jsx_runtime23.jsx)("span", { className: "rolling-skill-inline-error", children: t("criticalFailure") }) : null
      ] }, criterion.id)) }),
      version.rubric.automaticFailures?.length ? /* @__PURE__ */ (0, import_jsx_runtime23.jsxs)("section", { children: [
        /* @__PURE__ */ (0, import_jsx_runtime23.jsx)("h4", { children: t("automaticFailures") }),
        /* @__PURE__ */ (0, import_jsx_runtime23.jsx)("div", { className: "rolling-skill-rubric-criteria", children: version.rubric.automaticFailures.map((failure) => /* @__PURE__ */ (0, import_jsx_runtime23.jsxs)("article", { children: [
          /* @__PURE__ */ (0, import_jsx_runtime23.jsxs)("strong", { children: [
            failure.id,
            " \xB7 ",
            failure.condition
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime23.jsx)("p", { children: failure.rationale })
        ] }, failure.id)) })
      ] }) : null
    ] })
  ] });
}

// src/client/workbench/Workbench.tsx
var import_jsx_runtime24 = require("react/jsx-runtime");
var NAVIGATION_GROUPS = [
  {
    id: "overview",
    label: "overview",
    defaultPage: "overview",
    pages: [{ id: "overview", label: "overview" }]
  },
  {
    id: "case-management",
    label: "caseManagement",
    defaultPage: "automatic",
    pages: [
      { id: "automatic", label: "automatic" },
      { id: "raw-cases", label: "rawCases" },
      { id: "curation", label: "curation" },
      { id: "cases", label: "cases" },
      { id: "datasets", label: "datasets" }
    ]
  },
  {
    id: "skill-installation",
    label: "skillAndInstallation",
    defaultPage: "skill-import",
    pages: [
      { id: "skill-import", label: "skillImportTab" },
      { id: "skill-versions", label: "skillVersionsTab" },
      { id: "skill-install", label: "skillInstallTab" }
    ]
  },
  {
    id: "evaluation-optimization",
    label: "evaluationAndOptimization",
    defaultPage: "rubrics",
    pages: [
      { id: "rubrics", label: "rubrics" },
      { id: "evaluations", label: "evaluations" },
      { id: "operator", label: "operator" },
      { id: "optimization", label: "optimizationTitle" }
    ]
  }
];
var VISIBLE_PAGES = new Set(NAVIGATION_GROUPS.flatMap((group) => group.pages.map((page) => page.id)));
function normalizeWorkbenchRoute(route) {
  if (!route || typeof route !== "object") return { page: "overview" };
  const candidate = route;
  if (candidate.page === "skills") {
    return typeof candidate.skillId === "string" ? { page: "skill-versions", skillId: candidate.skillId } : { page: "skill-import" };
  }
  if (candidate.page === "installations") {
    return typeof candidate.jobId === "string" ? { page: "skill-install", jobId: candidate.jobId } : { page: "skill-install" };
  }
  if (typeof candidate.page !== "string" || !VISIBLE_PAGES.has(candidate.page)) {
    return { page: "overview" };
  }
  return route;
}
function navigationRoute(page, current) {
  const skillId = "skillId" in current ? current.skillId : void 0;
  if (page === "skill-import") return { page, skillId };
  if (page === "skill-versions") return { page, skillId };
  if (page === "skill-install") return { page, skillId };
  return { page };
}
function dateTime4(value, fallback) {
  if (!value) return fallback;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleString() : fallback;
}
function Workbench({ locale, t, initialRoute = { page: "overview" }, onRouteChange }) {
  (0, import_react21.useSyncExternalStore)(
    (listener) => locale.subscribe(listener),
    () => locale.getSnapshot().revision,
    () => 0
  );
  const [route, setRoute] = (0, import_react21.useState)(() => normalizeWorkbenchRoute(initialRoute));
  const [reloadRevision, setReloadRevision] = (0, import_react21.useState)(0);
  const [dataRevision, setDataRevision] = (0, import_react21.useState)(0);
  const [state, setState] = (0, import_react21.useState)({ status: "loading" });
  (0, import_react21.useEffect)(() => {
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
  (0, import_react21.useEffect)(() => {
    const next = normalizeWorkbenchRoute(initialRoute);
    setRoute(next);
    if (next.page !== initialRoute.page) onRouteChange?.(next);
  }, [JSON.stringify(initialRoute)]);
  const activeGroup = NAVIGATION_GROUPS.find(
    (group) => group.pages.some((page) => page.id === route.page)
  ) ?? NAVIGATION_GROUPS[0];
  return /* @__PURE__ */ (0, import_jsx_runtime24.jsxs)("section", { className: "rolling-skill-workbench", "aria-labelledby": "rolling-skill-title", children: [
    /* @__PURE__ */ (0, import_jsx_runtime24.jsxs)("header", { className: "rolling-skill-header", children: [
      /* @__PURE__ */ (0, import_jsx_runtime24.jsxs)("div", { children: [
        /* @__PURE__ */ (0, import_jsx_runtime24.jsx)("h2", { id: "rolling-skill-title", children: t("title") }),
        /* @__PURE__ */ (0, import_jsx_runtime24.jsx)("p", { children: t("subtitle") })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime24.jsx)(ActionButton, { size: "sm", onClick: reload, disabled: state.status === "loading", children: t("refresh") })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime24.jsx)("nav", { className: "rolling-skill-tabs rolling-skill-primary-tabs", "aria-label": t("workbenchSections"), children: NAVIGATION_GROUPS.map((group) => /* @__PURE__ */ (0, import_jsx_runtime24.jsx)(
      import_dsh_client_ui_primitives14.Button,
      {
        variant: activeGroup.id === group.id ? "outline" : "ghost",
        size: "sm",
        "aria-pressed": activeGroup.id === group.id,
        onClick: () => navigate({ page: group.defaultPage }),
        children: t(group.label)
      },
      group.id
    )) }),
    activeGroup.id !== "overview" ? /* @__PURE__ */ (0, import_jsx_runtime24.jsx)("nav", { className: "rolling-skill-tabs rolling-skill-secondary-tabs", "aria-label": t("workbenchPages"), children: activeGroup.pages.map((page) => /* @__PURE__ */ (0, import_jsx_runtime24.jsx)(
      import_dsh_client_ui_primitives14.Button,
      {
        variant: route.page === page.id ? "outline" : "ghost",
        size: "sm",
        "aria-pressed": route.page === page.id,
        onClick: () => navigate(navigationRoute(page.id, route)),
        children: t(page.label)
      },
      page.id
    )) }) : null,
    state.status === "loading" ? /* @__PURE__ */ (0, import_jsx_runtime24.jsx)("div", { className: "rolling-skill-state", role: "status", children: t("loading") }) : state.status === "error" ? /* @__PURE__ */ (0, import_jsx_runtime24.jsxs)("div", { className: "rolling-skill-state rolling-skill-error", role: "alert", children: [
      /* @__PURE__ */ (0, import_jsx_runtime24.jsx)("strong", { children: t("loadError") }),
      /* @__PURE__ */ (0, import_jsx_runtime24.jsx)("span", { children: state.message }),
      /* @__PURE__ */ (0, import_jsx_runtime24.jsx)(ActionButton, { size: "sm", onClick: reload, children: t("retry") })
    ] }) : route.page === "curation" ? /* @__PURE__ */ (0, import_jsx_runtime24.jsx)(CurationPanel, { t, initialSessionId: route.sessionId, onNavigate: navigate }) : route.page === "datasets" ? /* @__PURE__ */ (0, import_jsx_runtime24.jsx)(DatasetsPanel, { t, onChanged: () => setDataRevision((value) => value + 1) }) : route.page === "cases" ? /* @__PURE__ */ (0, import_jsx_runtime24.jsx)(CasesPanel, { t, revision: dataRevision, initialDatasetId: route.datasetId, initialCaseId: route.caseId, onNavigate: navigate, onChanged: () => setDataRevision((value) => value + 1) }) : route.page === "raw-cases" ? /* @__PURE__ */ (0, import_jsx_runtime24.jsx)(RawCasesPanel, { t, revision: dataRevision, initialRawCaseId: route.rawCaseId, onNavigate: navigate, onChanged: () => setDataRevision((value) => value + 1) }) : route.page === "rubrics" ? /* @__PURE__ */ (0, import_jsx_runtime24.jsx)(
      RubricPanel,
      {
        t,
        initialDatasetId: route.datasetId,
        initialSessionId: route.sessionId,
        onNavigate: navigate
      }
    ) : route.page === "evaluations" ? /* @__PURE__ */ (0, import_jsx_runtime24.jsx)(EvaluationsPanel, { t, initialRunId: route.runId }) : route.page === "skill-import" || route.page === "skill-versions" || route.page === "skill-install" ? /* @__PURE__ */ (0, import_jsx_runtime24.jsx)(
      SkillsPanel,
      {
        t,
        mode: route.page === "skill-import" ? "import" : route.page === "skill-versions" ? "versions" : "install",
        initialSkillId: route.skillId,
        initialJobId: route.page === "skill-install" ? route.jobId : void 0,
        onSkillChange: (skillId) => navigate({ ...route, skillId }),
        onOpenVersions: (skillId) => navigate({ page: "skill-versions", skillId })
      }
    ) : route.page === "automatic" ? /* @__PURE__ */ (0, import_jsx_runtime24.jsx)(AutomaticCapturePanel, { t }) : route.page === "operator" ? /* @__PURE__ */ (0, import_jsx_runtime24.jsx)(OperatorPanel, { t, initialSessionId: route.sessionId }) : route.page === "optimization" ? /* @__PURE__ */ (0, import_jsx_runtime24.jsx)(OptimizationPanel, { t, initialRunId: route.runId }) : /* @__PURE__ */ (0, import_jsx_runtime24.jsx)(Overview, { dashboard: state.dashboard, t })
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
  return /* @__PURE__ */ (0, import_jsx_runtime24.jsxs)("div", { className: "rolling-skill-overview", children: [
    /* @__PURE__ */ (0, import_jsx_runtime24.jsx)("div", { className: "rolling-skill-counts", children: counts2.map((count) => /* @__PURE__ */ (0, import_jsx_runtime24.jsxs)("div", { className: "rolling-skill-count", children: [
      /* @__PURE__ */ (0, import_jsx_runtime24.jsx)("strong", { children: dashboard.counts[count.key] }),
      /* @__PURE__ */ (0, import_jsx_runtime24.jsx)("span", { children: t(count.label) })
    ] }, count.key)) }),
    /* @__PURE__ */ (0, import_jsx_runtime24.jsxs)("div", { className: "rolling-skill-grid", children: [
      /* @__PURE__ */ (0, import_jsx_runtime24.jsxs)("section", { className: "rolling-skill-panel", children: [
        /* @__PURE__ */ (0, import_jsx_runtime24.jsx)("h3", { children: t("automaticStatus") }),
        /* @__PURE__ */ (0, import_jsx_runtime24.jsxs)("dl", { children: [
          /* @__PURE__ */ (0, import_jsx_runtime24.jsxs)("div", { children: [
            /* @__PURE__ */ (0, import_jsx_runtime24.jsx)("dt", { children: t("nextRun") }),
            /* @__PURE__ */ (0, import_jsx_runtime24.jsx)("dd", { children: dateTime4(dashboard.automaticCapture.nextRunAt, t("notAvailable")) })
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime24.jsxs)("div", { children: [
            /* @__PURE__ */ (0, import_jsx_runtime24.jsx)("dt", { children: t("lastSuccess") }),
            /* @__PURE__ */ (0, import_jsx_runtime24.jsx)("dd", { children: dateTime4(dashboard.automaticCapture.lastSuccessAt, t("notAvailable")) })
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime24.jsxs)("div", { children: [
            /* @__PURE__ */ (0, import_jsx_runtime24.jsx)("dt", { children: t("lastError") }),
            /* @__PURE__ */ (0, import_jsx_runtime24.jsx)("dd", { children: dashboard.automaticCapture.error ?? t("noError") })
          ] })
        ] })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime24.jsxs)("section", { className: "rolling-skill-panel", children: [
        /* @__PURE__ */ (0, import_jsx_runtime24.jsx)("h3", { children: t("runtime") }),
        runtime ? /* @__PURE__ */ (0, import_jsx_runtime24.jsxs)("div", { className: "rolling-skill-runtime", children: [
          /* @__PURE__ */ (0, import_jsx_runtime24.jsx)("strong", { children: [runtime.displayName ?? runtime.runtimeId, runtime.version].filter(Boolean).join(" ") }),
          /* @__PURE__ */ (0, import_jsx_runtime24.jsx)("code", { children: runtime.executablePath })
        ] }) : /* @__PURE__ */ (0, import_jsx_runtime24.jsx)("p", { children: t("noRuntime") })
      ] })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime24.jsxs)("section", { className: "rolling-skill-panel rolling-skill-path", children: [
      /* @__PURE__ */ (0, import_jsx_runtime24.jsx)("h3", { children: t("dataDirectory") }),
      /* @__PURE__ */ (0, import_jsx_runtime24.jsx)("code", { children: dashboard.dataRoot })
    ] })
  ] });
}

// src/client/workbench/WorkbenchOverlay.tsx
var import_jsx_runtime25 = require("react/jsx-runtime");
function WorkbenchOverlay({ locale, route, t, onClose, onRouteChange }) {
  const overlayRef = (0, import_react22.useRef)(null);
  (0, import_react22.useEffect)(() => {
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
  return /* @__PURE__ */ (0, import_jsx_runtime25.jsx)("div", { className: "rolling-skill-workbench-backdrop", onMouseDown: (event) => {
    if (event.currentTarget === event.target) onClose();
  }, children: /* @__PURE__ */ (0, import_jsx_runtime25.jsxs)(
    "div",
    {
      ref: overlayRef,
      className: "rolling-skill-workbench-overlay",
      role: "dialog",
      "aria-modal": "true",
      "aria-label": t("title"),
      children: [
        /* @__PURE__ */ (0, import_jsx_runtime25.jsx)(
          import_dsh_client_ui_primitives15.Button,
          {
            className: "rolling-skill-workbench-close",
            variant: "ghost",
            size: "sm",
            onClick: onClose,
            "aria-label": t("close"),
            children: "\xD7"
          }
        ),
        /* @__PURE__ */ (0, import_jsx_runtime25.jsx)(Workbench, { locale, t, initialRoute: route, onRouteChange })
      ]
    }
  ) });
}

// src/client/workbench/WorkbenchLauncher.tsx
var import_jsx_runtime26 = require("react/jsx-runtime");
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
  const [open, setOpen] = (0, import_react23.useState)(false);
  const [route, setRoute] = (0, import_react23.useState)(savedRoute);
  const changeRoute = (0, import_react23.useCallback)((next) => {
    setRoute(next);
    persistRoute(next);
  }, []);
  (0, import_react23.useEffect)(() => {
    const openWorkbench2 = (event) => {
      const next = event.detail?.route;
      if (next?.page) changeRoute(next);
      setOpen(true);
    };
    window.addEventListener("rolling-skill:open-workbench", openWorkbench2);
    return () => window.removeEventListener("rolling-skill:open-workbench", openWorkbench2);
  }, [changeRoute]);
  (0, import_react23.useEffect)(() => {
    const closeWorkbench = () => setOpen(false);
    window.addEventListener("rolling-skill:close-workbench", closeWorkbench);
    return () => window.removeEventListener("rolling-skill:close-workbench", closeWorkbench);
  }, []);
  return /* @__PURE__ */ (0, import_jsx_runtime26.jsxs)(import_jsx_runtime26.Fragment, { children: [
    /* @__PURE__ */ (0, import_jsx_runtime26.jsx)(
      import_dsh_client_ui_primitives16.Button,
      {
        variant: "ghost",
        size: "sm",
        onClick: () => setOpen(true),
        "aria-label": t("openWorkbench"),
        title: t("openWorkbench"),
        children: wide ? t("nav") : "RS"
      }
    ),
    open ? /* @__PURE__ */ (0, import_jsx_runtime26.jsx)(
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
var import_dsh_client_ui_primitives17 = require("@deepseek-ai/dsh-client-ui-primitives");
var import_react24 = require("react");
var import_jsx_runtime27 = require("react/jsx-runtime");
function RollingSkillSettings({ t }) {
  const [revision, setRevision] = (0, import_react24.useState)(0);
  const [runtimes, setRuntimes] = (0, import_react24.useState)([]);
  const [models, setModels] = (0, import_react24.useState)([]);
  const [runtimeId, setRuntimeId] = (0, import_react24.useState)("");
  const [profiles, setProfiles] = (0, import_react24.useState)({
    curator: { modelId: null, effort: null },
    rubric: { modelId: null, effort: null },
    judge: { modelId: null, effort: null }
  });
  const [busy, setBusy] = (0, import_react24.useState)(false);
  const [saveError, setSaveError] = (0, import_react24.useState)(null);
  const [state, setState] = (0, import_react24.useState)({ status: "loading" });
  (0, import_react24.useEffect)(() => {
    const controller = new AbortController();
    Promise.all([
      requestRollingSkill("settings.get", {}, controller.signal),
      requestRollingSkill("runtimes.list", {}, controller.signal)
    ]).then(([settings, runtimeItems]) => {
      setState({ status: "ready" });
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
  (0, import_react24.useEffect)(() => {
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
  const updateProfile = (kind, patch2) => {
    setProfiles((current) => ({ ...current, [kind]: { ...current[kind], ...patch2 } }));
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
  return /* @__PURE__ */ (0, import_jsx_runtime27.jsxs)("section", { className: "rolling-skill-settings", "aria-labelledby": "rolling-skill-settings-title", children: [
    /* @__PURE__ */ (0, import_jsx_runtime27.jsxs)("header", { className: "rolling-skill-header", children: [
      /* @__PURE__ */ (0, import_jsx_runtime27.jsxs)("div", { children: [
        /* @__PURE__ */ (0, import_jsx_runtime27.jsx)("h2", { id: "rolling-skill-settings-title", children: t("settings") }),
        /* @__PURE__ */ (0, import_jsx_runtime27.jsx)("p", { children: t("settingsDescription") })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime27.jsx)(import_dsh_client_ui_primitives17.Button, { variant: "outline", size: "sm", onClick: () => setRevision((value) => value + 1), children: t("refresh") })
    ] }),
    state.status === "loading" ? /* @__PURE__ */ (0, import_jsx_runtime27.jsx)("div", { className: "rolling-skill-state", role: "status", children: t("loading") }) : state.status === "error" ? /* @__PURE__ */ (0, import_jsx_runtime27.jsx)("div", { className: "rolling-skill-state rolling-skill-error", role: "alert", children: state.message }) : /* @__PURE__ */ (0, import_jsx_runtime27.jsx)("div", { className: "rolling-skill-data-stack", children: /* @__PURE__ */ (0, import_jsx_runtime27.jsxs)("section", { className: "rolling-skill-panel", children: [
      /* @__PURE__ */ (0, import_jsx_runtime27.jsx)("h3", { children: t("agentDefaults") }),
      /* @__PURE__ */ (0, import_jsx_runtime27.jsxs)("label", { className: "rolling-skill-field", children: [
        /* @__PURE__ */ (0, import_jsx_runtime27.jsx)("span", { children: t("defaultRuntime") }),
        /* @__PURE__ */ (0, import_jsx_runtime27.jsx)("select", { className: "rolling-skill-select", value: runtimeId, onChange: (event) => setRuntimeId(event.target.value), children: runtimes.map((item) => /* @__PURE__ */ (0, import_jsx_runtime27.jsxs)("option", { value: item.runtimeId, children: [
          item.displayName,
          " ",
          item.version ?? ""
        ] }, item.runtimeId)) })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime27.jsx)("div", { className: "rolling-skill-grid", children: ["curator", "rubric", "judge"].map((kind) => /* @__PURE__ */ (0, import_jsx_runtime27.jsxs)("section", { className: "rolling-skill-subpanel", children: [
        /* @__PURE__ */ (0, import_jsx_runtime27.jsx)("h4", { children: t(kind === "curator" ? "curatorDefault" : kind === "rubric" ? "rubricDefault" : "judgeDefault") }),
        /* @__PURE__ */ (0, import_jsx_runtime27.jsxs)("label", { className: "rolling-skill-field", children: [
          /* @__PURE__ */ (0, import_jsx_runtime27.jsx)("span", { children: t("model") }),
          /* @__PURE__ */ (0, import_jsx_runtime27.jsxs)("select", { className: "rolling-skill-select", value: profiles[kind].modelId ?? "", onChange: (event) => updateProfile(kind, { modelId: event.target.value || null }), children: [
            /* @__PURE__ */ (0, import_jsx_runtime27.jsx)("option", { value: "", children: t("runtimeDefault") }),
            models.map((model) => {
              const id = model.id ?? model.model ?? "";
              return /* @__PURE__ */ (0, import_jsx_runtime27.jsx)("option", { value: id, children: model.displayName ?? id }, id);
            })
          ] })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime27.jsxs)("label", { className: "rolling-skill-field", children: [
          /* @__PURE__ */ (0, import_jsx_runtime27.jsx)("span", { children: t("effort") }),
          /* @__PURE__ */ (0, import_jsx_runtime27.jsxs)("select", { className: "rolling-skill-select", value: profiles[kind].effort ?? "", onChange: (event) => updateProfile(kind, { effort: event.target.value || null }), children: [
            /* @__PURE__ */ (0, import_jsx_runtime27.jsx)("option", { value: "", children: t("runtimeDefault") }),
            ["low", "medium", "high", "xhigh", "max"].map((value) => /* @__PURE__ */ (0, import_jsx_runtime27.jsx)("option", { value, children: value }, value))
          ] })
        ] })
      ] }, kind)) }),
      saveError ? /* @__PURE__ */ (0, import_jsx_runtime27.jsx)("p", { className: "rolling-skill-inline-error", role: "alert", children: saveError }) : null,
      /* @__PURE__ */ (0, import_jsx_runtime27.jsx)(import_dsh_client_ui_primitives17.Button, { variant: "outline", disabled: busy || !runtimeId, onClick: () => void save(), children: t("saveDefaults") })
    ] }) })
  ] });
}

// src/client/index.tsx
var import_jsx_runtime28 = require("react/jsx-runtime");
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
  const RollingSkillSection = () => /* @__PURE__ */ (0, import_jsx_runtime28.jsx)(RollingSkillSettings, { t });
  ctx.slots.inject("settings.section", () => ctx.slots.register({
    name: "settings.section",
    id: "rolling-skill",
    order: 20,
    label: () => t("nav"),
    locale: LOCALE_NAMESPACE
  }, RollingSkillSection));
  const RollingSkillWorkbenchLauncher = (props) => /* @__PURE__ */ (0, import_jsx_runtime28.jsx)(WorkbenchLauncher, { wide: Boolean(props.wide), locale: ctx.locale, t });
  ctx.slots.inject("sidebar.footer.action", () => ctx.slots.register({
    name: "sidebar.footer.action",
    id: "rolling-skill-workbench",
    order: 20,
    label: () => t("nav"),
    locale: LOCALE_NAMESPACE
  }, RollingSkillWorkbenchLauncher));
  const RollingSkillCaseCaptureAction = (props) => /* @__PURE__ */ (0, import_jsx_runtime28.jsx)(
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
  const RollingSkillConversationMarkers = (props) => /* @__PURE__ */ (0, import_jsx_runtime28.jsx)(
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
