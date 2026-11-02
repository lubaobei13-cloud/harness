window.__ModuleLoader__.load({
  id: "dsh-company-multiagent",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

    const react = require("react");
    const reactDomClient = require("react-dom/client");
    const h = react.createElement;

    const COMPANY_PANEL_ID = "dsh-company";
    const NS = "dsh-company-multiagent";
    const SIDEBAR_COLLAPSED_KEY = "dsh-company.sidebar-card.collapsed";

    const zh = {
      "company.title": "四级集团总控台",
      "company.subtitle":
        "L1 董事长 ➔ L2 DSH 总包工头与最终审核 ➔ L3 四大独立计费部门 (豆包仅传话防勾连 · Codex 6.1-terra/6.1-sol/6-astra 公司级审核) ➔ L4 内部四步内审",
      "company.refresh": "刷新实时余额",
      "company.refreshing": "刷新中…",
    };

    const en = {
      "company.title": "4-Tier Company Console",
      "company.subtitle":
        "L1 Chairman -> L2 DSH Foreman & Final Review -> L3 4 Depts (Doubao Relay Only · Codex 6.1-terra/6.1-sol/6-astra Company Review) -> L4 Internal 4-Step Review",
      "company.refresh": "Refresh Balances",
      "company.refreshing": "Refreshing…",
    };

    const CSS_TEXT = `
/* Expand DSH Settings Modal when "四级集团总控台" (图2) is open so it matches the wide modal effect of 图3 */
[data-shortcut-modal="settings"]:has(.dshCo_wrap),
[data-shortcut-modal="settings"][data-dsh-company-active="1"] {
  width: min(1420px, calc(100vw - 36px)) !important;
  max-width: calc(100vw - 36px) !important;
  height: min(900px, calc(100vh - 36px)) !important;
  max-height: calc(100vh - 36px) !important;
  transition: width 0.18s ease, height 0.18s ease;
}
[data-shortcut-modal="settings"]:has(.dshCo_wrap) [class*="_options"],
[data-shortcut-modal="settings"][data-dsh-company-active="1"] [class*="_options"] {
  padding: 18px 22px 28px !important;
  overflow-y: auto !important;
  overflow-x: hidden !important;
}
[data-shortcut-modal="settings"]:has(.dshCo_wrap) [class*="_options"] > div,
[data-shortcut-modal="settings"][data-dsh-company-active="1"] [class*="_options"] > div {
  max-width: 100% !important;
  width: 100% !important;
}

/* Permanently hide left-sidebar entry (图1) per user requirement */
.dshCo_sideCard,
[data-dsh-company-foot-card] {
  display: none !important;
}

.dshCo_wrap {
  color: inherit;
  font-family: inherit;
  display: flex;
  flex-direction: column;
  gap: 18px;
  padding: 8px 6px 28px;
  box-sizing: border-box;
  max-width: 1320px;
  margin: 0 auto;
  width: 100%;
  overflow-y: visible;
  overflow-x: hidden;
  container-type: inline-size;
}
.dshCo_topHeader {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  padding-bottom: 14px;
  border-bottom: 1px solid color-mix(in srgb, currentColor 14%, transparent);
}
.dshCo_titleGroup {
  display: flex;
  flex-direction: column;
  gap: 5px;
  min-width: 0;
}
.dshCo_title {
  font-size: 18px;
  font-weight: 700;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin: 0;
}
.dshCo_subtitle {
  font-size: 12px;
  opacity: 0.72;
  margin: 0;
  line-height: 1.45;
}
.dshCo_headerActions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
}
.dshCo_foremanPill {
  font-size: 12px;
  font-weight: 600;
  padding: 5px 12px;
  border-radius: 999px;
  background: color-mix(in srgb, #10b981 14%, transparent);
  border: 1px solid color-mix(in srgb, #10b981 40%, transparent);
  display: inline-flex;
  align-items: center;
  gap: 6px;
  max-width: 100%;
  box-sizing: border-box;
}
.dshCo_btn {
  appearance: none;
  color: inherit;
  font: inherit;
  cursor: pointer;
  background: color-mix(in srgb, currentColor 6%, transparent);
  border: 1px solid color-mix(in srgb, currentColor 20%, transparent);
  border-radius: 8px;
  padding: 6px 13px;
  font-size: 12px;
  font-weight: 600;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  box-sizing: border-box;
  max-width: 100%;
  white-space: normal;
  word-break: break-word;
  text-align: center;
  transition: background 0.15s, border-color 0.15s, opacity 0.15s;
}
.dshCo_btn:hover:not(:disabled) {
  background: color-mix(in srgb, currentColor 12%, transparent);
  border-color: color-mix(in srgb, currentColor 35%, transparent);
}
.dshCo_btn:disabled {
  opacity: 0.5;
  cursor: default;
}

/* 4-Department Balance Grid & Cards (Strictly Contained, Zero Overflow) */
.dshCo_balanceGrid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 14px;
  width: 100%;
  box-sizing: border-box;
}
@container (max-width: 980px) {
  .dshCo_balanceGrid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
@container (max-width: 560px) {
  .dshCo_balanceGrid {
    grid-template-columns: minmax(0, 1fr);
  }
}
@media (max-width: 1020px) {
  .dshCo_balanceGrid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
@media (max-width: 620px) {
  .dshCo_balanceGrid {
    grid-template-columns: minmax(0, 1fr);
  }
}
.dshCo_agentCard {
  min-width: 0;
  max-width: 100%;
  box-sizing: border-box;
  overflow: hidden;
  border: 1px solid color-mix(in srgb, currentColor 14%, transparent);
  background: linear-gradient(
    180deg,
    color-mix(in srgb, currentColor 4.5%, transparent) 0%,
    color-mix(in srgb, currentColor 2%, transparent) 100%
  );
  border-radius: 14px;
  padding: 14px 15px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  position: relative;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.04);
}
.dshCo_agentHead {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
  width: 100%;
}
.dshCo_agentTitleRow {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  min-width: 0;
  width: 100%;
}
.dshCo_agentName {
  font-size: 14.5px;
  font-weight: 700;
  display: inline-flex;
  align-items: center;
  gap: 7px;
  min-width: 0;
  line-height: 1.3;
  word-break: break-word;
}
.dshCo_tierPill {
  font-size: 10.5px;
  font-weight: 600;
  padding: 2px 7px;
  border-radius: 999px;
  background: color-mix(in srgb, currentColor 8%, transparent);
  border: 1px solid color-mix(in srgb, currentColor 14%, transparent);
  flex-shrink: 0;
  white-space: nowrap;
  opacity: 0.85;
}
.dshCo_statusDot {
  width: 8px;
  height: 8px;
  border-radius: 999px;
  background: #10b981;
  display: inline-block;
  flex-shrink: 0;
  box-shadow: 0 0 0 2px color-mix(in srgb, #10b981 25%, transparent);
}
.dshCo_statusDotOff {
  background: #ef4444;
  box-shadow: 0 0 0 2px color-mix(in srgb, #ef4444 25%, transparent);
}
.dshCo_channelSub {
  font-size: 11px;
  opacity: 0.72;
  line-height: 1.35;
  word-break: break-word;
  overflow-wrap: anywhere;
}
.dshCo_quotaBox {
  display: flex;
  flex-direction: column;
  gap: 7px;
  padding: 9px 11px;
  border-radius: 10px;
  background: color-mix(in srgb, currentColor 6%, transparent);
  border: 1px solid color-mix(in srgb, currentColor 12%, transparent);
  box-sizing: border-box;
  width: 100%;
  min-width: 0;
}
.dshCo_headlineBadge {
  font-size: 12.5px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  line-height: 1.35;
  word-break: break-word;
  overflow-wrap: anywhere;
}
.dshCo_barTrack {
  width: 100%;
  height: 6px;
  border-radius: 999px;
  background: color-mix(in srgb, currentColor 12%, transparent);
  overflow: hidden;
}
.dshCo_barFill {
  height: 100%;
  border-radius: 999px;
  transition: width 0.3s ease;
  background: #10b981;
}
.dshCo_barWarn {
  background: #f59e0b;
}
.dshCo_barLow {
  background: #ef4444;
}
.dshCo_realDataRow {
  font-size: 10.5px;
  padding: 4px 8px;
  border-radius: 6px;
  background: color-mix(in srgb, #0ea5e9 11%, transparent);
  border: 1px dashed color-mix(in srgb, #0ea5e9 40%, transparent);
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  align-items: center;
  gap: 4px 8px;
  line-height: 1.35;
  word-break: break-word;
  overflow-wrap: anywhere;
}
.dshCo_metaLine {
  font-size: 11px;
  opacity: 0.8;
  line-height: 1.48;
  word-break: break-word;
  overflow-wrap: anywhere;
  min-width: 0;
}
.dshCo_modelTags {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
  margin-top: 2px;
  min-width: 0;
  width: 100%;
}
.dshCo_tag {
  font-size: 10.5px;
  padding: 3px 7px;
  border-radius: 6px;
  border: 1px solid color-mix(in srgb, currentColor 16%, transparent);
  background: color-mix(in srgb, currentColor 4.5%, transparent);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  line-height: 1.35;
  max-width: 100%;
  box-sizing: border-box;
  white-space: normal;
  word-break: break-word;
  overflow-wrap: anywhere;
}
.dshCo_tagPlan {
  border-color: color-mix(in srgb, #8b5cf6 42%, transparent);
  background: color-mix(in srgb, #8b5cf6 11%, transparent);
}
.dshCo_tagExec {
  border-color: color-mix(in srgb, #0ea5e9 42%, transparent);
  background: color-mix(in srgb, #0ea5e9 11%, transparent);
}
.dshCo_tagBan {
  border-color: color-mix(in srgb, #ef4444 42%, transparent);
  background: color-mix(in srgb, #ef4444 11%, transparent);
}
.dshCo_cardFooter {
  font-size: 11px;
  opacity: 0.78;
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  align-items: center;
  gap: 4px 10px;
  margin-top: auto;
  padding-top: 8px;
  border-top: 1px solid color-mix(in srgb, currentColor 9%, transparent);
  word-break: break-word;
}

/* Work Orders & Inter-Department Communication Board */
.dshCo_ordersSection {
  border: 1px solid color-mix(in srgb, currentColor 14%, transparent);
  border-radius: 14px;
  padding: 16px 18px;
  display: flex;
  flex-direction: column;
  gap: 14px;
  background: color-mix(in srgb, currentColor 2.5%, transparent);
  box-sizing: border-box;
  width: 100%;
  min-width: 0;
}
.dshCo_ordersHeader {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  align-items: center;
  gap: 10px;
  padding-bottom: 10px;
  border-bottom: 1px solid color-mix(in srgb, currentColor 10%, transparent);
}
.dshCo_ordersTitle {
  font-size: 15px;
  font-weight: 700;
  margin: 0;
  display: flex;
  align-items: center;
  gap: 8px;
}
.dshCo_ordersSub {
  font-size: 11.5px;
  opacity: 0.72;
  margin: 3px 0 0 0;
  line-height: 1.4;
}
.dshCo_runningBox {
  border: 1px solid color-mix(in srgb, #2563eb 45%, transparent);
  background: color-mix(in srgb, #2563eb 10%, transparent);
  border-radius: 10px;
  padding: 12px 14px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.dshCo_ordersSplit {
  display: grid;
  grid-template-columns: 310px minmax(0, 1fr);
  gap: 14px;
  align-items: start;
  width: 100%;
  min-width: 0;
}
@container (max-width: 820px) {
  .dshCo_ordersSplit {
    grid-template-columns: minmax(0, 1fr);
  }
}
@media (max-width: 900px) {
  .dshCo_ordersSplit {
    grid-template-columns: minmax(0, 1fr);
  }
}
.dshCo_orderList {
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-height: 600px;
  overflow-y: auto;
  min-width: 0;
}
.dshCo_orderItem {
  appearance: none;
  text-align: left;
  color: inherit;
  font: inherit;
  border: 1px solid color-mix(in srgb, currentColor 14%, transparent);
  background: color-mix(in srgb, currentColor 3%, transparent);
  border-radius: 10px;
  padding: 10px 12px;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  gap: 5px;
  min-width: 0;
  width: 100%;
  box-sizing: border-box;
  transition: border-color 0.15s, background 0.15s;
}
.dshCo_orderItem:hover {
  background: color-mix(in srgb, currentColor 6%, transparent);
}
.dshCo_orderItemActive {
  border-color: #2563eb;
  background: color-mix(in srgb, #2563eb 10%, transparent);
}
.dshCo_orderItemTop {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 6px;
  font-size: 11px;
}
.dshCo_orderActionBadge {
  font-size: 10.5px;
  font-weight: 700;
  padding: 2px 7px;
  border-radius: 999px;
  background: color-mix(in srgb, #2563eb 16%, transparent);
  border: 1px solid color-mix(in srgb, #2563eb 38%, transparent);
}
.dshCo_orderGoal {
  font-size: 12.5px;
  font-weight: 600;
  line-height: 1.38;
  word-break: break-word;
  overflow-wrap: anywhere;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.dshCo_orderDetail {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-width: 0;
  width: 100%;
}
.dshCo_dispatchSummaryBox {
  border: 1px solid color-mix(in srgb, currentColor 14%, transparent);
  background: color-mix(in srgb, currentColor 4%, transparent);
  border-radius: 10px;
  padding: 12px 14px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}
.dshCo_commTimeline {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: 0;
}
.dshCo_commCard {
  border: 1px solid color-mix(in srgb, currentColor 14%, transparent);
  background: color-mix(in srgb, currentColor 3%, transparent);
  border-radius: 10px;
  padding: 11px 13px;
  display: flex;
  flex-direction: column;
  gap: 7px;
  min-width: 0;
}
.dshCo_commHead {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  align-items: center;
  gap: 6px 10px;
}
.dshCo_commRoute {
  font-size: 12.5px;
  font-weight: 700;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
}
.dshCo_commBody {
  font-size: 12px;
  line-height: 1.55;
  white-space: pre-wrap;
  word-break: break-word;
  overflow-wrap: anywhere;
  padding: 8px 10px;
  border-radius: 8px;
  background: color-mix(in srgb, currentColor 4%, transparent);
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  max-height: 260px;
  overflow-y: auto;
}
.dshCo_reportBox {
  border: 1px solid color-mix(in srgb, currentColor 16%, transparent);
  background: color-mix(in srgb, currentColor 4%, transparent);
  border-radius: 10px;
  padding: 14px 16px;
  white-space: pre-wrap;
  word-break: break-word;
  overflow-wrap: anywhere;
  font-size: 12px;
  line-height: 1.6;
  max-height: 460px;
  overflow-y: auto;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
}

/* Daily Model Scanner & Graphical Model Configurator (Codex / Qoder / WorkBuddy) */
.dshCo_modelConfigSection {
  border: 1px solid color-mix(in srgb, currentColor 14%, transparent);
  border-radius: 14px;
  padding: 16px 18px;
  display: flex;
  flex-direction: column;
  gap: 14px;
  background: color-mix(in srgb, currentColor 2.5%, transparent);
  box-sizing: border-box;
  width: 100%;
  min-width: 0;
}
.dshCo_modelConfigGrid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 14px;
  width: 100%;
  box-sizing: border-box;
}
@container (max-width: 920px) {
  .dshCo_modelConfigGrid {
    grid-template-columns: minmax(0, 1fr);
  }
}
@media (max-width: 960px) {
  .dshCo_modelConfigGrid {
    grid-template-columns: minmax(0, 1fr);
  }
}
.dshCo_modelDeptCard {
  border: 1px solid color-mix(in srgb, currentColor 14%, transparent);
  background: color-mix(in srgb, currentColor 3.5%, transparent);
  border-radius: 12px;
  padding: 13px 14px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: 0;
}
.dshCo_modelChipGrid {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  max-height: 185px;
  overflow-y: auto;
  padding: 6px;
  border-radius: 8px;
  background: color-mix(in srgb, currentColor 3%, transparent);
  border: 1px solid color-mix(in srgb, currentColor 10%, transparent);
}
.dshCo_modelChip {
  appearance: none;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 11px;
  padding: 4px 8px;
  border-radius: 6px;
  border: 1px solid color-mix(in srgb, currentColor 18%, transparent);
  background: color-mix(in srgb, currentColor 4%, transparent);
  color: inherit;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  transition: all 0.14s ease;
  text-align: left;
  line-height: 1.3;
}
.dshCo_modelChip:hover:not(:disabled) {
  border-color: color-mix(in srgb, currentColor 40%, transparent);
  background: color-mix(in srgb, currentColor 9%, transparent);
}
.dshCo_modelChipActivePlan {
  border-color: #8b5cf6;
  background: color-mix(in srgb, #8b5cf6 18%, transparent);
  font-weight: 700;
}
.dshCo_modelChipActiveExec {
  border-color: #0ea5e9;
  background: color-mix(in srgb, #0ea5e9 18%, transparent);
  font-weight: 700;
}
.dshCo_modelChipBanned {
  border-color: color-mix(in srgb, #ef4444 45%, transparent);
  background: color-mix(in srgb, #ef4444 10%, transparent);
  opacity: 0.6;
  cursor: not-allowed;
  text-decoration: line-through;
}
.dshCo_selectRow {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  font-size: 11.5px;
}
.dshCo_select {
  font: inherit;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 11px;
  padding: 4px 8px;
  border-radius: 6px;
  border: 1px solid color-mix(in srgb, currentColor 22%, transparent);
  background: color-mix(in srgb, currentColor 7%, transparent);
  color: inherit;
  max-width: 62%;
}
.dshCo_input {
  font: inherit;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 11px;
  padding: 5px 8px;
  border-radius: 6px;
  border: 1px solid color-mix(in srgb, currentColor 20%, transparent);
  background: color-mix(in srgb, currentColor 5%, transparent);
  color: inherit;
  flex: 1;
  min-width: 0;
}
`;

    function ensureStylesMounted() {
      if (typeof document === "undefined") return;
      const tagId = "dsh-company-multiagent-styles";
      const existing = document.getElementById(tagId);
      if (existing) {
        existing.textContent = CSS_TEXT;
        return;
      }
      const style = document.createElement("style");
      style.id = tagId;
      style.textContent = CSS_TEXT;
      document.head.appendChild(style);
    }

    function createCompanyStore() {
      let state = {
        overview: null,
        qoderPluginUsage: null,
        loading: true,
        refreshing: false,
        scanningModels: false,
        savingModels: false,
        error: null,
        modalOpen: false,
      };
      const listeners = new Set();

      const setState = (patch) => {
        state = {
          ...state,
          ...(typeof patch === "function" ? patch(state) : patch),
        };
        for (const fn of [...listeners]) {
          try {
            fn();
          } catch {}
        }
      };

      const fetchOverview = async (force = false) => {
        if (force) setState({ refreshing: true });
        try {
          const url = force
            ? "/api/dsh-company/refresh"
            : "/api/dsh-company/overview";
          const res = await fetch(url, {
            method: force ? "POST" : "GET",
            signal: AbortSignal.timeout(15000),
          });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const data = await res.json();

          let qoderPluginUsage = state.qoderPluginUsage;
          try {
            const qRes = await fetch("/plugins/dsh-connect-qoder/usage", {
              signal: AbortSignal.timeout(3000),
            });
            if (qRes.ok) {
              const qData = await qRes.json();
              const activeRegion = (qData?.regions || []).find(
                (r) => r.available
              );
              if (activeRegion) qoderPluginUsage = activeRegion;
            }
          } catch {}

          setState({
            overview: data,
            qoderPluginUsage,
            loading: false,
            refreshing: false,
            error: null,
          });
        } catch (err) {
          setState({
            loading: false,
            refreshing: false,
            error: err.message || String(err),
          });
        }
      };

      const scanModels = async () => {
        setState({ scanningModels: true });
        try {
          const res = await fetch("/api/dsh-company/models", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ action: "scan" }),
          });
          const data = await res.json();
          if (state.overview && data.modelConfig) {
            setState({
              overview: { ...state.overview, modelConfig: data.modelConfig },
            });
          }
          await fetchOverview(false);
        } finally {
          setState({ scanningModels: false });
        }
      };

      const updateModels = async (patch) => {
        setState({ savingModels: true });
        try {
          const res = await fetch("/api/dsh-company/models", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(patch),
          });
          const data = await res.json();
          if (state.overview && data.modelConfig) {
            setState({
              overview: { ...state.overview, modelConfig: data.modelConfig },
            });
          }
          await fetchOverview(false);
        } finally {
          setState({ savingModels: false });
        }
      };

      const clearHistory = async () => {
        await fetch("/api/dsh-company/clear-history", { method: "POST" });
        await fetchOverview(false);
      };

      return {
        getSnapshot: () => state,
        subscribe: (fn) => {
          listeners.add(fn);
          return () => listeners.delete(fn);
        },
        setState,
        fetchOverview,
        scanModels,
        updateModels,
        clearHistory,
      };
    }

    function barColorClass(percent) {
      if (percent == null) return "dshCo_barFill";
      if (percent <= 15) return "dshCo_barFill dshCo_barLow";
      if (percent <= 35) return "dshCo_barFill dshCo_barWarn";
      return "dshCo_barFill";
    }

    /**
     * Individual Agent Balance & Model Assignment Card (Beautified, Zero Text Overflow)
     */
    function AgentBalanceCard({ agentKey, agent, qoderPluginUsage, store }) {
      const [authPending, setAuthPending] = react.useState(false);
      const [authHint, setAuthHint] = react.useState("");

      if (!agent) return null;

      let headline = agent.headlineBalance || "在线";
      let hasExactPct = typeof agent.remainingPercent === "number";
      let pct = hasExactPct ? agent.remainingPercent : null;
      let statusLine = agent.statusText || "";

      if (
        agentKey === "qoder" &&
        qoderPluginUsage &&
        qoderPluginUsage.userQuota &&
        typeof qoderPluginUsage.userQuota.total === "number" &&
        qoderPluginUsage.userQuota.total > 0
      ) {
        const uq = qoderPluginUsage.userQuota;
        const rem = Math.max(0, Number(uq.total) - Number(uq.used || 0));
        pct = Math.round((rem / uq.total) * 1000) / 10;
        hasExactPct = true;
        headline = `${rem} / ${uq.total} Credits (${pct}%)`;
        statusLine = `独立从 Qoder CN 官方 OpenAPI 实时读取 · 剩余 ${rem} / ${uq.total} Credits (${pct}%)`;
      }

      const handleQoderDeviceAuth = async () => {
        setAuthPending(true);
        setAuthHint("正在发起 Qoder CN 官方设备授权…");
        try {
          const startRes = await fetch(
            "/plugins/dsh-connect-qoder/device-login/start",
            {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ region: "qoder-cn" }),
            }
          );
          const startData = await startRes.json();
          if (!startRes.ok || !startData.authUrl) {
            throw new Error(startData.error || "无法启动 Qoder CN 设备授权");
          }
          window.open(startData.authUrl, "_blank", "noopener,noreferrer");
          setAuthHint(
            "已打开 Qoder CN 授权页，请在浏览器确认登录，正在自动轮询结果…"
          );

          const deadline = Date.now() + 120000;
          while (Date.now() < deadline) {
            await new Promise((r) => setTimeout(r, 2500));
            const pollRes = await fetch(
              "/plugins/dsh-connect-qoder/device-login/poll?region=qoder-cn"
            );
            if (!pollRes.ok) continue;
            const pollData = await pollRes.json();
            if (pollData.status === "authenticated") {
              await fetch("/plugins/dsh-connect-qoder/account/reload", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ region: "qoder-cn" }),
              }).catch(() => {});
              setAuthHint("✅ Qoder CN 授权成功，正在刷新独立精确余额…");
              if (store) await store.fetchOverview(true);
              setAuthPending(false);
              return;
            }
            if (
              pollData.status === "failed" ||
              pollData.status === "expired"
            ) {
              throw new Error(pollData.error || "授权超时或已取消");
            }
          }
          throw new Error("等待授权超时，请重试");
        } catch (err) {
          setAuthHint(`⚠️ ${err.message || String(err)}`);
          setAuthPending(false);
        }
      };

      const titleMap = {
        codex: "Codex (ChatGPT)",
        qoder: "Qoder (工程一部)",
        workbuddy: "WorkBuddy (工程二部)",
        doubao: "豆包 (2.1 Pro · 仅传话隔离)",
      };

      const tierPillMap = {
        codex: "L3 规划与公司审核院",
        qoder: "L3 工程一部",
        workbuddy: "L3 工程二部",
        doubao: "L3 传话防勾连处",
      };

      const roleBadgeMap = {
        codex: "ChatGPT PLUS 独立配额 · 负责顶层规划与公司级审核 (6.1-terra / 6.1-sol / 6-astra)",
        qoder: "Qoder CN 独立计费账户 (与 WorkBuddy 严格隔离)",
        workbuddy: "WorkBuddy 专属 Credits (独立计费，与 Qoder 不通用)",
        doubao: "豆包独立配额 · 仅负责跨部门传话与物理隔离下属Agent防止勾连 (绝不参与审核)",
      };

      return h(
        "div",
        { className: "dshCo_agentCard" },
        // 1. Clean Header: Agent Name + Tier Pill on top, Billing Channel below
        h(
          "div",
          { className: "dshCo_agentHead" },
          h(
            "div",
            { className: "dshCo_agentTitleRow" },
            h(
              "div",
              { className: "dshCo_agentName" },
              h("span", {
                className: agent.online
                  ? "dshCo_statusDot"
                  : "dshCo_statusDot dshCo_statusDotOff",
              }),
              h("span", null, titleMap[agentKey] || agent.name)
            ),
            h("span", { className: "dshCo_tierPill" }, tierPillMap[agentKey] || "L3")
          ),
          h(
            "div",
            { className: "dshCo_channelSub" },
            agent.billingChannel || roleBadgeMap[agentKey] || agent.name
          )
        ),

        // 2. Full-Width Quota & Progress Box (never overflows horizontally)
        h(
          "div",
          { className: "dshCo_quotaBox" },
          h("div", { className: "dshCo_headlineBadge" }, headline),
          hasExactPct
            ? h(
                "div",
                { className: "dshCo_barTrack", title: `真实剩余百分比: ${pct}%` },
                h("div", {
                  className: barColorClass(pct),
                  style: { width: `${Math.max(4, Math.min(100, pct))}%` },
                })
              )
            : h(
                "div",
                { className: "dshCo_realDataRow" },
                h(
                  "span",
                  null,
                  agentKey === "doubao"
                    ? "📊 按小时动态峰值限流 (仅传话隔离)"
                    : agentKey === "qoder" && agent.localBilledCredits > 0
                    ? `📊 本地已实扣 ${agent.localBilledCredits} Credits (${
                        agent.localBillableRequests || 0
                      } 笔)`
                    : "📊 独立状态直读 (未猜测百分比)"
                ),
                h("span", { style: { fontWeight: 700, flexShrink: 0 } }, "真实数据源")
              )
        ),

        // 3. Detailed Telemetry Description
        h("div", { className: "dshCo_metaLine" }, statusLine),

        // 4. Optional One-Click Qoder CN Device OAuth Button
        agentKey === "qoder" &&
          agent.needsDeviceAuthForExactCredits &&
          !hasExactPct &&
          h(
            "div",
            { style: { display: "flex", flexDirection: "column", gap: "4px", width: "100%" } },
            h(
              "button",
              {
                type: "button",
                className: "dshCo_btn",
                style: { fontSize: "11px", padding: "5px 10px", width: "100%" },
                disabled: authPending,
                onClick: handleQoderDeviceAuth,
              },
              authPending
                ? "⏳ 正在等待 Qoder CN 网页授权…"
                : "🔗 一键网页授权读取 Qoder 精确剩余 Credits"
            ),
            authHint &&
              h(
                "div",
                { style: { fontSize: "10.5px", opacity: 0.85, wordBreak: "break-word" } },
                authHint
              )
          ),

        // 5. Model Tier Badges (Cleanly Wrapped)
        agentKey === "codex" &&
          h(
            "div",
            { className: "dshCo_modelTags" },
            h(
              "span",
              { className: "dshCo_tag dshCo_tagPlan" },
              `公司级审核: ${(
                agent.companyReviewModels || [
                  "gpt-6.1-terra",
                  "gpt-6.1-sol",
                  "gpt-6-astra",
                ]
              ).join(" / ")}`
            ),
            h(
              "span",
              { className: "dshCo_tag dshCo_tagExec" },
              `规划主官: ${agent.defaultModel || "gpt-6.1-sol"} · 审校主官: ${
                agent.defaultReviewerModel || "gpt-6.1-terra"
              }`
            ),
            h("span", { className: "dshCo_tag dshCo_tagBan" }, "🚫 严禁 luna")
          ),
        (agentKey === "qoder" || agentKey === "workbuddy") &&
          h(
            "div",
            { className: "dshCo_modelTags" },
            h(
              "span",
              { className: "dshCo_tag" },
              agentKey === "qoder"
                ? "💰 Qoder 独立计费 (不与WB通用)"
                : "💰 WorkBuddy 独立计费 (不与Qoder通用)"
            ),
            h(
              "span",
              { className: "dshCo_tag dshCo_tagPlan" },
              `规划/内审大模型: ${(agent.planningModels || []).join(" / ")}`
            ),
            h(
              "span",
              { className: "dshCo_tag dshCo_tagExec" },
              `施工Flash: ${(agent.executionModels || []).join(" / ")}`
            )
          ),
        agentKey === "doubao" &&
          h(
            "div",
            { className: "dshCo_modelTags" },
            h(
              "span",
              { className: "dshCo_tag dshCo_tagPlan" },
              `职责: 仅传话防勾连 (不审代码)`
            ),
            h(
              "span",
              { className: "dshCo_tag dshCo_tagPlan" },
              `模型: 豆包 2.1 Pro (${agent.defaultModel || "doubao-2.1-pro"})`
            ),
            h(
              "span",
              { className: "dshCo_tag dshCo_tagExec" },
              `工作模式 · 思考: 高 (${agent.thinkingMode || "high"})`
            )
          ),

        // 6. Card Footer
        h(
          "div",
          { className: "dshCo_cardFooter" },
          h("span", null, `今日/本班次调用: ${agent.sessionCalls || 0} 次`),
          h("span", null, `当前模型: ${agent.lastUsedModel || agent.defaultModel}`)
        )
      );
    }

    function formatActionLabel(action) {
      switch (action) {
        case "pipeline":
          return "🏢 全链路四部门协同工单";
        case "plan":
          return "📐 Codex 架构拆解工单";
        case "dispatch":
          return "🛠️ 部门施工派单";
        case "roundtable":
          return "🔄 部门内四步圆桌会";
        case "sanitize":
          return "🛡️ 豆包传话隔离防勾连";
        case "intervene":
          return "⚡ DSH 包工头亲自兜底";
        default:
          return `📋 集团工单 (${action || "协同"})`;
      }
    }

    /**
     * Synthesize structured communication steps if a run record was created before `communications` was persisted
     * or if a run is currently executing (`activeRun`)
     */
    function getRunCommunications(run) {
      if (!run) return [];
      if (Array.isArray(run.communications) && run.communications.length > 0) {
        return run.communications;
      }
      const comms = [];
      const res = run.result || {};
      const action = run.action || "pipeline";
      const dept = String(run.department || "qoder").toUpperCase();

      comms.push({
        step: 1,
        from: "⚡ L2 总包工头 (DSH 对话框模型)",
        to:
          action === "pipeline"
            ? "🏢 四大部门 (Codex / Qoder / WorkBuddy / 豆包传话处)"
            : action === "plan"
            ? "🟣 L3 Codex (规划与公司级审核院)"
            : action === "sanitize"
            ? "🟠 L3 豆包传话隔离处"
            : `🛠️ L3 ${dept}`,
        stage: "DSH 派活指令",
        model: "DSH 对话框主模型",
        badge: formatActionLabel(action),
        content: `【派活目标】：${run.goal || ""}${
          Array.isArray(run.allowedFiles) && run.allowedFiles.length > 0
            ? `\n【文件围挡 (allowedFiles)】：${run.allowedFiles.join(", ")}`
            : ""
        }`,
      });

      if (run.status === "running" && Array.isArray(run.logs) && run.logs.length > 0) {
        comms.push({
          step: comms.length + 1,
          from: "⏳ 集团实时执行流水线",
          to: "⚡ L2 总包工头 (DSH)",
          stage: run.stage || "正在执行中…",
          model: "实时流转中",
          badge: "⏳ 执行中",
          content: run.logs.map((l, i) => `${i + 1}. ${l}`).join("\n"),
        });
      }

      if (res.plan) {
        comms.push({
          step: comms.length + 1,
          from: "🟣 L3 Codex (规划与公司级审核院)",
          to: "⚡ L2 总包工头 (DSH)",
          stage: "顶层架构规划与子工单拆解",
          model: res.plan.model || "gpt-6.1-sol",
          badge: `拆解 ${(res.plan.subtasks || []).length} 个子工单`,
          content:
            (res.plan.planSummary || "") +
            ((res.plan.subtasks || []).length > 0
              ? "\n\n" +
                res.plan.subtasks
                  .map(
                    (st, i) =>
                      `${i + 1}. [${String(st.department || "qoder").toUpperCase()}] ${
                        st.title || "子任务"
                      } (允许修改: ${(st.allowedFiles || ["*"]).join(", ")})`
                  )
                  .join("\n")
              : ""),
        });
      }

      if (Array.isArray(res.executions)) {
        for (const exec of res.executions) {
          const dName = String(exec.department || "qoder").toUpperCase();
          if (exec.relaySanitization) {
            comms.push({
              step: comms.length + 1,
              from: "🟠 L3 豆包传话与防勾连隔离处 (仅传话·不审代码)",
              to: `🛠️ L3 ${dName}`,
              stage: `物理隔离下属Agent传话 (${exec.subtaskTitle || "施工任务"})`,
              model: "doubao-2.1-pro",
              badge: `防勾连风险: ${exec.relaySanitization.riskLevel || "LOW"}`,
              content:
                exec.relaySanitization.cleanMessage ||
                exec.relaySanitization.sanitizedBody ||
                "",
            });
          }
          if (
            exec.internalMeeting &&
            Array.isArray(exec.internalMeeting.transcript)
          ) {
            for (const entry of exec.internalMeeting.transcript) {
              comms.push({
                step: comms.length + 1,
                from: `🔄 L4 ${dName} · ${entry.role || "Subagent"}`,
                to: `🔄 L4 ${dName} 内部下一环`,
                stage: `部门内四步沟通 (${entry.role || "Subagent"})`,
                model: entry.model || exec.model,
                badge: entry.phase || "L4 内审",
                content: entry.output || "",
              });
            }
          }
          comms.push({
            step: comms.length + 1,
            from: `🛠️ L3 ${dName}`,
            to: "🟣 L3 Codex 公司级审核院 & ⚡ DSH",
            stage: `施工交付与Codex公司级合规核查：${exec.subtaskTitle || "子任务"}`,
            model: exec.model || "auto",
            badge: exec.audit?.passed ? "✅ Codex公司初审通过" : "已交付",
            content: exec.output || exec.summary || "",
          });
        }
      } else if (res.output || res.cleanMessage || res.planSummary) {
        comms.push({
          step: comms.length + 1,
          from:
            action === "plan"
              ? "🟣 L3 Codex"
              : action === "sanitize"
              ? "🟠 L3 豆包传话隔离处"
              : `🛠️ L3 ${dept}`,
          to: "⚡ L2 总包工头 (DSH)",
          stage: "下属部门执行反馈",
          model: res.model || "auto",
          badge: "✅ 已完成",
          content:
            res.output ||
            res.cleanMessage ||
            res.sanitizedBody ||
            res.planSummary ||
            "",
        });
      }

      if (res.codexReview) {
        comms.push({
          step: comms.length + 1,
          from: "🟣 L3 Codex 公司级审核院 (6.1-terra / 6.1-sol / 6-astra)",
          to: "⚡ L2 DSH 对话框模型 (执行最终审核) ➔ 👑 L1 董事长",
          stage: "公司层面盲审验收 ➔ 呈交 DSH 对话框模型做最终审核",
          model: res.codexReview.model || "gpt-6.1-terra",
          badge: res.codexReview.approved
            ? `✅ 公司级审核通过 (${res.codexReview.score || 95}分)`
            : `⚠️ 需关注`,
          content: res.codexReview.summary || res.codexReview.rawOutput || "",
        });
      }

      return comms;
    }

    /**
     * Daily Model Scanner & Graphical Model Configurator for Codex, Qoder, and WorkBuddy
     */
    function ModelConfigSection({ store, modelConfig }) {
      const snap = react.useSyncExternalStore(store.subscribe, store.getSnapshot);
      const [newCodexModel, setNewCodexModel] = react.useState("");
      const [newQoderModel, setNewQoderModel] = react.useState("");
      const [newQoderTier, setNewQoderTier] = react.useState("planner");
      const [newWbModel, setNewWbModel] = react.useState("");
      const [newWbTier, setNewWbTier] = react.useState("planner");

      const cfg = modelConfig || {
        lastScannedAt: null,
        scanSchedule: "daily (24h)",
        departments: {},
      };
      const depts = cfg.departments || {};
      const codexCfg = depts.codex || {
        discoveredModels: [
          { id: "gpt-6.1-terra", label: "GPT-6.1-Terra", forbidden: false },
          { id: "gpt-6.1-sol", label: "GPT-6.1-Sol", forbidden: false },
          { id: "gpt-6-astra", label: "GPT-6-Astra", forbidden: false },
        ],
        activeModels: ["gpt-6.1-terra", "gpt-6.1-sol", "gpt-6-astra"],
        defaultPlannerModel: "gpt-6.1-sol",
        defaultReviewerModel: "gpt-6.1-terra",
        escalationModel: "gpt-6-astra",
      };
      const qoderCfg = depts.qoder || {
        discoveredModels: [],
        plannerModels: ["qwen3.8-max", "kimi-3.1-pro", "glm-5.3"],
        executorModels: ["qwen3.8-flash", "deepseek-v4.1-flash", "glm-5.3-flash"],
        defaultPlannerModel: "qwen3.8-max",
        defaultExecutorModel: "qwen3.8-flash",
      };
      const wbCfg = depts.workbuddy || {
        discoveredModels: [],
        plannerModels: ["kimi-3.1-pro", "glm-5.3", "qwen3.8-max"],
        executorModels: ["deepseek-v4.1-flash", "glm-5.3-flash", "qwen3.8-flash"],
        defaultPlannerModel: "kimi-3.1-pro",
        defaultExecutorModel: "deepseek-v4.1-flash",
      };

      const toggleCodexModel = (modelId) => {
        if (String(modelId).toLowerCase().includes("luna")) return;
        const curr = Array.isArray(codexCfg.activeModels) ? codexCfg.activeModels : [];
        let next = curr.includes(modelId)
          ? curr.filter((m) => m !== modelId)
          : [...curr, modelId];
        if (next.length === 0) next = ["gpt-6.1-terra", "gpt-6.1-sol", "gpt-6-astra"];
        store.updateModels({ codex: { activeModels: next } });
      };

      const cycleWorkerModelRole = (deptKey, deptObj, modelId) => {
        if (String(modelId).toLowerCase().includes("luna")) return;
        const planners = Array.isArray(deptObj.plannerModels) ? deptObj.plannerModels : [];
        const executors = Array.isArray(deptObj.executorModels) ? deptObj.executorModels : [];
        const inPlan = planners.includes(modelId);
        const inExec = executors.includes(modelId);
        let nextPlan = [...planners];
        let nextExec = [...executors];
        if (!inPlan && !inExec) {
          if (String(modelId).toLowerCase().includes("flash")) nextExec.push(modelId);
          else nextPlan.push(modelId);
        } else if (inPlan) {
          nextPlan = nextPlan.filter((m) => m !== modelId);
          nextExec.push(modelId);
        } else {
          nextExec = nextExec.filter((m) => m !== modelId);
        }
        if (nextPlan.length === 0) nextPlan = [planners[0] || "qwen3.8-max"];
        if (nextExec.length === 0) nextExec = [executors[0] || "qwen3.8-flash"];
        store.updateModels({
          [deptKey]: {
            plannerModels: nextPlan,
            executorModels: nextExec,
            defaultPlannerModel: nextPlan[0],
            defaultReviewerModel: nextPlan[0],
            defaultExecutorModel: nextExec[0],
          },
        });
      };

      const renderWorkerDeptCard = (
        deptKey,
        title,
        subtitle,
        deptObj,
        newId,
        setNewId,
        newTier,
        setNewTier
      ) => {
        const planners = deptObj.plannerModels || [];
        const executors = deptObj.executorModels || [];
        const discovered =
          Array.isArray(deptObj.discoveredModels) && deptObj.discoveredModels.length > 0
            ? deptObj.discoveredModels
            : [...new Set([...planners, ...executors])].map((id) => ({
                id,
                label: id,
                tier: executors.includes(id) ? "executor" : "planner",
              }));

        return h(
          "div",
          { className: "dshCo_modelDeptCard" },
          h(
            "div",
            { style: { display: "flex", justifyContent: "space-between", alignItems: "center" } },
            h("span", { style: { fontWeight: 700, fontSize: "13.5px" } }, title),
            h("span", { className: "dshCo_tierPill" }, `已探测 ${discovered.length} 个模型`)
          ),
          h("div", { className: "dshCo_channelSub" }, subtitle),
          h(
            "div",
            { className: "dshCo_selectRow" },
            h("span", null, "默认规划/内审大模型:"),
            h(
              "select",
              {
                className: "dshCo_select",
                value: deptObj.defaultPlannerModel || planners[0] || "",
                onChange: (e) => {
                  const val = e.target.value;
                  store.updateModels({
                    [deptKey]: {
                      defaultPlannerModel: val,
                      defaultReviewerModel: val,
                      plannerModels: [val, ...planners.filter((m) => m !== val)],
                    },
                  });
                },
              },
              planners.map((m) => h("option", { key: m, value: m }, m))
            )
          ),
          h(
            "div",
            { className: "dshCo_selectRow" },
            h("span", null, "默认施工 Flash 模型:"),
            h(
              "select",
              {
                className: "dshCo_select",
                value: deptObj.defaultExecutorModel || executors[0] || "",
                onChange: (e) => {
                  const val = e.target.value;
                  store.updateModels({
                    [deptKey]: {
                      defaultExecutorModel: val,
                      executorModels: [val, ...executors.filter((m) => m !== val)],
                    },
                  });
                },
              },
              executors.map((m) => h("option", { key: m, value: m }, m))
            )
          ),
          h(
            "div",
            { style: { fontSize: "11px", opacity: 0.78 } },
            "点击模型标签循环切换状态：【🟣规划/内审大模型】➔【🔵施工Flash】➔【未启用】"
          ),
          h(
            "div",
            { className: "dshCo_modelChipGrid" },
            discovered.map((m) => {
              const inPlan = planners.includes(m.id);
              const inExec = executors.includes(m.id);
              const cls = inPlan
                ? "dshCo_modelChip dshCo_modelChipActivePlan"
                : inExec
                ? "dshCo_modelChip dshCo_modelChipActiveExec"
                : "dshCo_modelChip";
              return h(
                "button",
                {
                  key: m.id,
                  type: "button",
                  className: cls,
                  onClick: () => cycleWorkerModelRole(deptKey, deptObj, m.id),
                },
                h("span", null, inPlan ? "🟣大模型" : inExec ? "🔵Flash" : "⚪未启用"),
                h("span", null, m.id)
              );
            })
          ),
          h(
            "div",
            { style: { display: "flex", gap: "6px", marginTop: "auto", paddingTop: "4px" } },
            h("input", {
              type: "text",
              className: "dshCo_input",
              placeholder: "手动新增新模型ID…",
              value: newId,
              onChange: (e) => setNewId(e.target.value),
            }),
            h(
              "select",
              {
                className: "dshCo_select",
                style: { maxWidth: "88px" },
                value: newTier,
                onChange: (e) => setNewTier(e.target.value),
              },
              h("option", { value: "planner" }, "大模型"),
              h("option", { value: "executor" }, "Flash")
            ),
            h(
              "button",
              {
                type: "button",
                className: "dshCo_btn",
                style: { padding: "4px 9px", fontSize: "11px" },
                onClick: () => {
                  const id = newId.trim();
                  if (!id || id.toLowerCase().includes("luna")) return;
                  store.updateModels({ addCustomModel: { department: deptKey, id, tier: newTier } });
                  setNewId("");
                },
              },
              "＋添加"
            )
          )
        );
      };

      const codexActive = codexCfg.activeModels || ["gpt-6.1-terra", "gpt-6.1-sol", "gpt-6-astra"];
      const codexDiscovered = codexCfg.discoveredModels || [];

      return h(
        "div",
        { className: "dshCo_modelConfigSection" },
        h(
          "div",
          { className: "dshCo_ordersHeader" },
          h(
            "div",
            null,
            h(
              "h2",
              { className: "dshCo_ordersTitle" },
              "🎛️ 每日可用模型自动扫描与图形化配置中心 (Codex / Qoder / WorkBuddy)",
              h(
                "span",
                {
                  style: {
                    fontSize: "11px",
                    fontWeight: 600,
                    padding: "2px 8px",
                    borderRadius: "999px",
                    background: "color-mix(in srgb, #8b5cf6 16%, transparent)",
                    border: "1px solid color-mix(in srgb, #8b5cf6 38%, transparent)",
                  },
                },
                cfg.lastScannedAt
                  ? `每日自动扫描已开启 · 上次扫描: ${new Date(cfg.lastScannedAt).toLocaleString()}`
                  : "每日自动扫描已开启 (24h周期)"
              )
            ),
            h(
              "p",
              { className: "dshCo_ordersSub" },
              "系统每天自动扫描本机 Codex、Qoder、WorkBuddy 最新发布的可用模型列表；您可在此通过图形界面一键勾选/切换各部门的可用模型与默认主官。"
            )
          ),
          h(
            "div",
            { style: { display: "flex", gap: "8px", flexWrap: "wrap" } },
            h(
              "button",
              {
                type: "button",
                className: "dshCo_btn",
                disabled: snap.scanningModels,
                onClick: () => store.scanModels(),
              },
              snap.scanningModels ? "🔍 正在扫描本机最新模型…" : "🔍 立即扫描可用模型"
            ),
            h(
              "button",
              {
                type: "button",
                className: "dshCo_btn",
                disabled: snap.savingModels,
                onClick: () => store.updateModels({ action: "reset" }),
              },
              "↺ 恢复默认推荐模型"
            )
          )
        ),
        h(
          "div",
          { className: "dshCo_modelConfigGrid" },
          // 1. Codex Card
          h(
            "div",
            { className: "dshCo_modelDeptCard" },
            h(
              "div",
              { style: { display: "flex", justifyContent: "space-between", alignItems: "center" } },
              h("span", { style: { fontWeight: 700, fontSize: "13.5px" } }, "🟣 Codex (规划与公司级审核院)"),
              h("span", { className: "dshCo_tierPill" }, `已探测 ${codexDiscovered.length} 个模型`)
            ),
            h(
              "div",
              { className: "dshCo_channelSub" },
              "公司层面审核与顶层规划固定主力：gpt-6.1-terra、gpt-6.1-sol、gpt-6-astra（严禁 luna）"
            ),
            h(
              "div",
              { className: "dshCo_selectRow" },
              h("span", null, "默认顶层规划主官:"),
              h(
                "select",
                {
                  className: "dshCo_select",
                  value: codexCfg.defaultPlannerModel || "gpt-6.1-sol",
                  onChange: (e) =>
                    store.updateModels({ codex: { defaultPlannerModel: e.target.value } }),
                },
                codexActive.map((m) => h("option", { key: m, value: m }, m))
              )
            ),
            h(
              "div",
              { className: "dshCo_selectRow" },
              h("span", null, "默认公司级审核主官:"),
              h(
                "select",
                {
                  className: "dshCo_select",
                  value: codexCfg.defaultReviewerModel || "gpt-6.1-terra",
                  onChange: (e) =>
                    store.updateModels({ codex: { defaultReviewerModel: e.target.value } }),
                },
                codexActive.map((m) => h("option", { key: m, value: m }, m))
              )
            ),
            h(
              "div",
              { className: "dshCo_selectRow" },
              h("span", null, "疑难升级重炮模型:"),
              h(
                "select",
                {
                  className: "dshCo_select",
                  value: codexCfg.escalationModel || "gpt-6-astra",
                  onChange: (e) =>
                    store.updateModels({ codex: { escalationModel: e.target.value } }),
                },
                codexActive.map((m) => h("option", { key: m, value: m }, m))
              )
            ),
            h(
              "div",
              { style: { fontSize: "11px", opacity: 0.78 } },
              "点击下方模型标签启用/停用 Codex 规划与公司审核可用模型："
            ),
            h(
              "div",
              { className: "dshCo_modelChipGrid" },
              codexDiscovered.map((m) => {
                const isForbidden = m.forbidden || String(m.id).toLowerCase().includes("luna");
                const isActive = !isForbidden && codexActive.includes(m.id);
                return h(
                  "button",
                  {
                    key: m.id,
                    type: "button",
                    disabled: isForbidden,
                    className: isForbidden
                      ? "dshCo_modelChip dshCo_modelChipBanned"
                      : isActive
                      ? "dshCo_modelChip dshCo_modelChipActivePlan"
                      : "dshCo_modelChip",
                    onClick: () => toggleCodexModel(m.id),
                  },
                  h("span", null, isForbidden ? "🚫禁用" : isActive ? "✅启用" : "⚪备用"),
                  h("span", null, m.id)
                );
              })
            ),
            h(
              "div",
              { style: { display: "flex", gap: "6px", marginTop: "auto", paddingTop: "4px" } },
              h("input", {
                type: "text",
                className: "dshCo_input",
                placeholder: "手动新增 Codex 模型ID…",
                value: newCodexModel,
                onChange: (e) => setNewCodexModel(e.target.value),
              }),
              h(
                "button",
                {
                  type: "button",
                  className: "dshCo_btn",
                  style: { padding: "4px 9px", fontSize: "11px" },
                  onClick: () => {
                    const id = newCodexModel.trim();
                    if (!id || id.toLowerCase().includes("luna")) return;
                    store.updateModels({
                      addCustomModel: { department: "codex", id, tier: "planner" },
                    });
                    setNewCodexModel("");
                  },
                },
                "＋添加"
              )
            )
          ),
          // 2. Qoder Card
          renderWorkerDeptCard(
            "qoder",
            "🟢 Qoder (工程一部)",
            "独立计费 · 负责复杂代码工程与四步内审 (规划/内审用大模型，施工用Flash)",
            qoderCfg,
            newQoderModel,
            setNewQoderModel,
            newQoderTier,
            setNewQoderTier
          ),
          // 3. WorkBuddy Card
          renderWorkerDeptCard(
            "workbuddy",
            "🔵 WorkBuddy (工程二部)",
            "独立计费 · 负责全栈/脚本组件施工与四步内审 (规划/内审用大模型，施工用Flash)",
            wbCfg,
            newWbModel,
            setNewWbModel,
            newWbTier,
            setNewWbTier
          )
        )
      );
    }

    /**
     * Main Graphical Console Component:
     * 1. Top Header + 4-Department Balance Dashboard
     * 2. Daily Model Scanner & Graphical Model Configurator (Codex / Qoder / WorkBuddy)
     * 3. Work Order & Subordinate Communication Board (supports switching work orders even during execution)
     */
    function CompanyConsoleView({ store, onCloseModal }) {
      const snap = react.useSyncExternalStore(
        store.subscribe,
        store.getSnapshot
      );
      const [selectedRunId, setSelectedRunId] = react.useState(null);
      const [showRawReport, setShowRawReport] = react.useState(false);
      const wrapRef = react.useRef(null);

      // Expand parent DSH Settings modal (`[data-shortcut-modal="settings"]`) when mounted in 图2 so it looks identical to 图3
      react.useEffect(() => {
        const el = wrapRef.current;
        const modalPanel = el?.closest?.('[data-shortcut-modal="settings"]');
        if (modalPanel) {
          modalPanel.setAttribute("data-dsh-company-active", "1");
          return () => {
            modalPanel.removeAttribute("data-dsh-company-active");
          };
        }
      }, []);

      // Poll overview every 2.5s while a task is running, or every 10s when idle
      react.useEffect(() => {
        store.fetchOverview(false);
        const isRunning = Boolean(snap.overview?.activeRun);
        const intervalMs = isRunning ? 2500 : 10000;
        const timer = window.setInterval(() => {
          if (document.visibilityState === "visible") {
            store.fetchOverview(false);
          }
        }, intervalMs);
        return () => window.clearInterval(timer);
      }, [Boolean(snap.overview?.activeRun)]);

      const balances = snap.overview?.balances;
      const agents = balances?.agents || {};
      const foreman = balances?.foreman;
      const activeRun = snap.overview?.activeRun;
      const recentRuns = snap.overview?.recentRuns || [];

      // Combine activeRun + recentRuns into `allRuns` so the user can freely switch between any work order even while activeRun is executing!
      const allRuns = react.useMemo(() => {
        const list = [];
        if (activeRun && activeRun.runId) {
          list.push(activeRun);
        }
        for (const r of recentRuns) {
          if (!r || !r.runId) continue;
          if (!list.some((x) => x.runId === r.runId)) {
            list.push(r);
          }
        }
        return list;
      }, [activeRun, recentRuns]);

      const displayedRun =
        (selectedRunId
          ? allRuns.find((r) => r.runId === selectedRunId)
          : null) ||
        activeRun ||
        allRuns[0] ||
        null;
      const communications = getRunCommunications(displayedRun);

      return h(
        "div",
        { className: "dshCo_wrap", ref: wrapRef },
        // Top Header
        h(
          "div",
          { className: "dshCo_topHeader" },
          h(
            "div",
            { className: "dshCo_titleGroup" },
            h(
              "h1",
              { className: "dshCo_title" },
              "🏢 DSH 四级智能体集团总控台",
              h(
                "span",
                {
                  style: {
                    fontSize: "11px",
                    padding: "2px 9px",
                    borderRadius: "999px",
                    background: "color-mix(in srgb, #10b981 15%, transparent)",
                    border: "1px solid color-mix(in srgb, #10b981 40%, transparent)",
                  },
                },
                "对话框公司模式联动 · 实时看板"
              )
            ),
            h("p", { className: "dshCo_subtitle" }, zh["company.subtitle"])
          ),
          h(
            "div",
            { className: "dshCo_headerActions" },
            foreman &&
              h(
                "span",
                { className: "dshCo_foremanPill" },
                `⚡ ${foreman.role}: ${foreman.headlineBalance}`
              ),
            h(
              "button",
              {
                type: "button",
                className: "dshCo_btn",
                disabled: snap.refreshing,
                onClick: () => store.fetchOverview(true),
              },
              snap.refreshing ? "🔄 正在刷新余额…" : "🔄 刷新实时余额"
            ),
            onCloseModal &&
              h(
                "button",
                {
                  type: "button",
                  className: "dshCo_btn",
                  onClick: onCloseModal,
                },
                "✕ 关闭窗口"
              )
          )
        ),

        // 1. Real-Time 4-Agent Balance Dashboard
        h(
          "div",
          { className: "dshCo_balanceGrid" },
          h(AgentBalanceCard, {
            agentKey: "codex",
            agent: agents.codex,
            store,
          }),
          h(AgentBalanceCard, {
            agentKey: "qoder",
            agent: agents.qoder,
            qoderPluginUsage: snap.qoderPluginUsage,
            store,
          }),
          h(AgentBalanceCard, {
            agentKey: "workbuddy",
            agent: agents.workbuddy,
            store,
          }),
          h(AgentBalanceCard, {
            agentKey: "doubao",
            agent: agents.doubao,
            store,
          })
        ),

        // 2. Daily Model Scanner & Graphical Model Configurator (Codex / Qoder / WorkBuddy)
        h(ModelConfigSection, {
          store,
          modelConfig: snap.overview?.modelConfig,
        }),

        // 3. Work Order & Inter-Department Communication Board (Dispatched from DSH Chat Dialog)
        h(
          "div",
          { className: "dshCo_ordersSection" },
          h(
            "div",
            { className: "dshCo_ordersHeader" },
            h(
              "div",
              null,
              h(
                "h2",
                { className: "dshCo_ordersTitle" },
                "📋 集团工单与下属部门沟通实况",
                h(
                  "span",
                  {
                    style: {
                      fontSize: "11px",
                      fontWeight: 600,
                      padding: "2px 8px",
                      borderRadius: "999px",
                      background: activeRun
                        ? "color-mix(in srgb, #2563eb 18%, transparent)"
                        : "color-mix(in srgb, currentColor 8%, transparent)",
                    },
                  },
                  activeRun
                    ? `⏳ 正在执行工单 (${activeRun.runId}) · 可自由点击左侧切换查看任意历史工单`
                    : `共 ${allRuns.length} 条工单记录`
                )
              ),
              h(
                "p",
                { className: "dshCo_ordersSub" },
                "职责铁律：豆包仅负责传话与物理隔离下属Agent防止勾连（绝不参与审核）；公司层面审核由 Codex (6.1-terra / 6.1-sol / 6-astra) 执行；最终审核由 DSH 对话框模型完成。"
              )
            ),
            recentRuns.length > 0 &&
              h(
                "button",
                {
                  type: "button",
                  className: "dshCo_btn",
                  onClick: () => store.clearHistory(),
                },
                "🗑️ 清空工单记录"
              )
          ),

          // Live Active Run Box (with button to switch back if viewing another historical work order)
          activeRun &&
            h(
              "div",
              { className: "dshCo_runningBox" },
              h(
                "div",
                {
                  style: {
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    gap: "8px",
                    flexWrap: "wrap",
                  },
                },
                h(
                  "div",
                  { style: { fontWeight: 700, fontSize: "13px" } },
                  `⏳ 正在执行工单 (${activeRun.runId})：${activeRun.stage}`
                ),
                displayedRun &&
                  displayedRun.runId !== activeRun.runId &&
                  h(
                    "button",
                    {
                      type: "button",
                      className: "dshCo_btn",
                      style: { padding: "3px 9px", fontSize: "11px" },
                      onClick: () => setSelectedRunId(activeRun.runId),
                    },
                    "👁️ 切回当前执行工单"
                  )
              ),
              h(
                "div",
                { style: { fontSize: "11.5px", opacity: 0.85 } },
                (activeRun.logs || []).join("  ➔  ")
              )
            ),

          // Work Order List + Detailed Communication Timeline
          allRuns.length === 0
            ? h(
                "div",
                {
                  className: "dshCo_metaLine",
                  style: {
                    padding: "22px 16px",
                    textAlign: "center",
                    border:
                      "1px dashed color-mix(in srgb, currentColor 16%, transparent)",
                    borderRadius: "10px",
                  },
                },
                "暂无工单记录。请直接在 DSH 聊天对话框选择「公司模式」并发送指令，DSH 派活与下属部门沟通实况将自动在此展示。"
              )
            : h(
                "div",
                { className: "dshCo_ordersSplit" },
                // Left: Work Order List (includes activeRun + recentRuns, freely selectable at any time)
                h(
                  "div",
                  { className: "dshCo_orderList" },
                  allRuns.map((r, idx) => {
                    const isSelected =
                      displayedRun && displayedRun.runId === r.runId;
                    return h(
                      "button",
                      {
                        key: r.runId,
                        type: "button",
                        className: isSelected
                          ? "dshCo_orderItem dshCo_orderItemActive"
                          : "dshCo_orderItem",
                        onClick: () => setSelectedRunId(r.runId),
                      },
                      h(
                        "div",
                        { className: "dshCo_orderItemTop" },
                        h(
                          "span",
                          { className: "dshCo_orderActionBadge" },
                          formatActionLabel(r.action)
                        ),
                        h(
                          "span",
                          { style: { opacity: 0.72 } },
                          `${r.status === "succeeded" ? "✅" : r.status === "running" ? "⏳执行中" : "❌"} #${
                            allRuns.length - idx
                          }`
                        )
                      ),
                      h(
                        "div",
                        { className: "dshCo_orderGoal" },
                        r.goal || "集团协同任务"
                      ),
                      h(
                        "div",
                        {
                          style: {
                            fontSize: "10.5px",
                            opacity: 0.68,
                            display: "flex",
                            justifyContent: "space-between",
                            gap: "6px",
                          },
                        },
                        h(
                          "span",
                          null,
                          r.startedAt
                            ? new Date(r.startedAt).toLocaleTimeString()
                            : ""
                        ),
                        h(
                          "span",
                          null,
                          r.durationMs
                            ? `耗时 ${(r.durationMs / 1000).toFixed(1)}s`
                            : "进行中 (可切换)"
                        )
                      )
                    );
                  })
                ),

                // Right: Selected Work Order Dispatch & Inter-Agent Communication Timeline
                displayedRun &&
                  h(
                    "div",
                    { className: "dshCo_orderDetail" },
                    // Order Summary Header
                    h(
                      "div",
                      { className: "dshCo_dispatchSummaryBox" },
                      h(
                        "div",
                        {
                          style: {
                            display: "flex",
                            flexWrap: "wrap",
                            justifyContent: "space-between",
                            alignItems: "center",
                            gap: "8px",
                          },
                        },
                        h(
                          "span",
                          { style: { fontSize: "13px", fontWeight: 700 } },
                          `📌 工单详情 (${displayedRun.runId}) · ${formatActionLabel(
                            displayedRun.action
                          )}`
                        ),
                        h(
                          "button",
                          {
                            type: "button",
                            className: "dshCo_btn",
                            style: { padding: "3px 9px", fontSize: "11px" },
                            onClick: () => setShowRawReport((v) => !v),
                          },
                          showRawReport
                            ? "💬 切换看部门沟通时间轴"
                            : "📄 查看完整结项报告原文"
                        )
                      ),
                      h(
                        "div",
                        { className: "dshCo_metaLine" },
                        `董事长/DSH 任务目标：${displayedRun.goal || ""}`
                      )
                    ),

                    // Communication Cards vs Raw Markdown Report
                    !showRawReport
                      ? h(
                          "div",
                          { className: "dshCo_commTimeline" },
                          communications.map((c, idx) =>
                            h(
                              "div",
                              { key: idx, className: "dshCo_commCard" },
                              h(
                                "div",
                                { className: "dshCo_commHead" },
                                h(
                                  "div",
                                  { className: "dshCo_commRoute" },
                                  h(
                                    "span",
                                    {
                                      style: {
                                        fontSize: "11px",
                                        padding: "1px 6px",
                                        borderRadius: "999px",
                                        background:
                                          "color-mix(in srgb, currentColor 10%, transparent)",
                                      },
                                    },
                                    `Step ${c.step || idx + 1}`
                                  ),
                                  h("span", null, `${c.from}  ➔  ${c.to}`),
                                  h(
                                    "span",
                                    {
                                      style: {
                                        fontSize: "11.5px",
                                        opacity: 0.78,
                                        fontWeight: 500,
                                      },
                                    },
                                    `· ${c.stage}`
                                  )
                                ),
                                h(
                                  "div",
                                  {
                                    style: {
                                      display: "flex",
                                      flexWrap: "wrap",
                                      gap: "5px",
                                      alignItems: "center",
                                    },
                                  },
                                  c.model &&
                                    h(
                                      "span",
                                      { className: "dshCo_tag dshCo_tagPlan" },
                                      c.model
                                    ),
                                  c.badge &&
                                    h(
                                      "span",
                                      { className: "dshCo_tag dshCo_tagExec" },
                                      c.badge
                                    )
                                )
                              ),
                              c.content &&
                                h("div", { className: "dshCo_commBody" }, c.content)
                            )
                          )
                        )
                      : h(
                          "div",
                          { className: "dshCo_reportBox" },
                          displayedRun.reportMarkdown ||
                            displayedRun.error ||
                            "正在等待各部门智能体返回结果…"
                        )
                  )
              )
        )
      );
    }

    const inject = ["slots", "locale", "connection"];

    function apply(ctx) {
      ensureStylesMounted();
      const store = createCompanyStore();

      // Remove any legacy sidebar foot card (图1) or chat dock elements if hot-reloaded
      if (typeof document !== "undefined") {
        document
          .querySelectorAll(
            "[data-dsh-company-foot-card], .dshCo_sideCard, [data-dsh-company-chat-dock], [data-dsh-company-composer-fallback]"
          )
          .forEach((el) => el.remove());
      }

      ctx.effect?.(() => {
        try {
          return ctx.locale?.register?.(NS, { zh, en });
        } catch {
          return () => {};
        }
      }, "dsh-company: locale");

      // Register in Settings Section ("设置 -> 四级集团总控台" [图2], which automatically expands to the spacious 图3 layout)
      if (ctx.slots && typeof ctx.slots.inject === "function") {
        ctx.slots.inject("settings.section", () => {
          try {
            return ctx.slots.register(
              {
                name: "settings.section",
                id: "dsh-company-settings",
                order: 152,
                label: () => "四级集团总控台",
                locale: NS,
                inject: () => ({ store }),
              },
              function CompanySettingsSectionWrapper(props) {
                return h(CompanyConsoleView, { store: props.store || store });
              }
            );
          } catch {
            return () => {};
          }
        });
      }
    }

    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  },
});
