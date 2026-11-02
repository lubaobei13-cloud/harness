# DSH 原生「公司模式」(Company Mode) 验收与使用说明

## 1. 当前运行状态（已在线热生效，无需重启）

已通过本地运行态接口 `GET /api/dsh-company/overview` 验证：
- **预设注册状态 (`presetStatus.registered`)**：`true`
- **预设 ID / 名称**：`company` / `公司模式`
- **当前已激活的全部原生模式列表 (`registeredPresets`)**：
  `["standard", "ptc", "minimal", "cordis", "liangshen", "company"]`

---

## 2. 本次界面与交互重构内容

1. **四大部门余额卡片重新排版美化（彻底解决文字溢出框外问题）**
   - 在 [`lib/client.js`](file:///Users/baiqin/Documents/try/multiagent/lib/client.js) 中重构了 `.dshCo_balanceGrid` 与 `.dshCo_agentCard`：
     - 取消了原先“左侧标题与右侧超长额度徽章在同一行横向挤压”的布局，避免标题被挤成竖排或右侧额度文字捅出卡片边框。
     - **第一行（标题栏）**：左侧显示在线状态绿点 + 部门名称（`Codex (ChatGPT)`、`Qoder (工程一部)`、`WorkBuddy (工程二部)`、`豆包 (2.1 Pro · 工作模式)`），右侧显示精简层级标签（`L3 规划院` / `L3 工程一部` / `L3 工程二部` / `L3 督察院`），下方独占一行展示独立计费渠道说明。
     - **第二行（全宽额度高亮框 `.dshCo_quotaBox`）**：100% 宽度展示实时余额/限流摘要与进度条/真实数据源标识，搭配 `overflow: hidden` 与自动折行（`word-break: break-word; overflow-wrap: anywhere`），确保任何长度的文字均严格收纳在卡片框内。
     - **模型标签区（`.dshCo_modelTags`）**：所有模型标签均支持框内自适应折行，不再撑破边框。

2. **删除冗余的手动工作模式选择与派单表单**
   - 移除了插件面板下方原有的“选择集团调度模式（5 个模式按钮）”、“任务指令输入框”、“工作区输入框”及“立即派发集团任务”等冗余控件。
   - **您只需在 DSH 聊天对话框中选择「公司模式」正常发号施令**，具体调哪个部门、走哪套流水线完全由 DSH 总包工头按预设制度自动决定。

3. **保留并升级「📋 集团工单与下属部门沟通实况」看板**
   - 在四部门余额卡片正下方直接展示 **「📋 集团工单与下属部门沟通实况」**：
     - 左侧为 **工单列表**（自动记录您在 DSH 对话框下令后触发的每一次派单）。
     - 右侧为 **DSH 派活指令 & 下属部门沟通时间轴 (`communications`)**，按步骤清晰展示：
       - `Step 1: ⚡ L2 总包工头 (DSH) ➔ 四大部门`（DSH 派发的具体指令与 `allowedFiles` 权限围挡）
       - `Step 2: 🟣 L3 Codex ➔ ⚡ DSH`（顶层架构拆解与子工单分配）
       - `Step 3: 🟠 L3 豆包督察院 ➔ 🛠️ Qoder / WorkBuddy`（跨部门传令洗稿防串联）
       - `Step 4: 🔄 L4 部门内四步多 Subagent 沟通`（内部大模型规划 ➔ Flash 施工 ➔ 内部督察 ➔ 大模型内审）
       - `Step 5: 🟠 L3 豆包督察院 ➔ ⚡ DSH`（《监军密折》Diff 审计结论）
       - `Step 6: 🟣 L3 Codex ➔ ⚡ DSH ➔ 👑 董事长`（匿名盲审验收与结项报告）
