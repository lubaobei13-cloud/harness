import crypto from "node:crypto";
import {
  COMPANY_FOREMAN_SYSTEM_PROMPT,
  getSharedCompanyHostService,
  registerCompanyAgentTools,
} from "./index.js";

export const name = "dsh-company-preset-tools";
export const inject = ["tools", "systemPrompt"];

const SYNTHETIC_SOURCE_KINDS = new Set([
  "time-context",
  "skill-catalog",
  "runtime-context",
  "model-selection",
  "system-reminder",
  "dsh-session-title-llm",
  "tool-goal",
  "synthetic",
  "dsh-company-foreman",
  "liangshen-working-context",
  "liangshen-tool-catalog",
  "liangshen-guard",
]);

function extractMessageText(message) {
  if (!message || typeof message !== "object") return "";
  if (typeof message.content === "string") return message.content.trim();
  if (!Array.isArray(message.content)) return "";
  return message.content
    .filter((block) => block && block.type === "text" && typeof block.text === "string")
    .map((block) => block.text)
    .join("\n")
    .trim();
}

function isRealUserMessage(message) {
  if (!message || message.role !== "user") return false;
  const sourceKind = message.source?.kind;
  if (sourceKind && SYNTHETIC_SOURCE_KINDS.has(sourceKind)) return false;
  const text = extractMessageText(message);
  if (!text) return false;
  if (
    text.startsWith("[Time Context:") ||
    text.startsWith("[Working Context:") ||
    text.startsWith("[Available Tools") ||
    text.startsWith("【🏢 集团四级流水线执行回执") ||
    text.startsWith("【🏢 集团公司模式台账与状态同步")
  ) {
    return false;
  }
  return true;
}

/**
 * Determine whether a user message in `公司模式` is an actionable requirement
 * that must trigger the 4-tier multi-agent pipeline (Codex + Qoder + WorkBuddy + Doubao),
 * versus a conversational/meta question about who did the work or current balances.
 */
export function classifyCompanyUserPrompt(userText = "") {
  const trimmed = String(userText || "").trim();
  if (!trimmed) {
    return { kind: "ignore", expectFileChanges: false };
  }

  // Pure greetings
  if (/^(?:你好|您好|hi|hello|hey|在吗|在不在|早上好|下午好|晚上好)[!！?？。.\s]*$/i.test(trimmed)) {
    return { kind: "meta", expectFileChanges: false };
  }

  // Meta questions asking about who wrote the code, whether tools/agents were called, or balance/status queries
  const isMetaAuditQuestion =
    /(?:你是直接写的|自己直接干|自己写的吗|还是调用.*工具|调用.*codex|谁写的|哪个部门写的|哪个模型写的|有没有调用|调没调用|查看.*余额|查一下.*余额|各部门.*余额|公司状态|集团状态|你有什么工具|现在是什么模式)/i.test(
      trimmed
    ) &&
    !/\b(?:timer-core|cli-report)\b|(?:请帮我写|帮我创建|帮我实现|请实现|请编写|写一个|创建一个|实现一个|开发一个|重构|修复)/i.test(
      trimmed
    );

  if (isMetaAuditQuestion) {
    return { kind: "meta", expectFileChanges: false };
  }

  const expectFileChanges =
    /(?:写|创建|生成|实现|修改|重构|开发|构建|修复|添加|补充|编写|代码|文件|模块|脚本|函数|组件|项目|\.m?[jt]sx?|\.py|\.go|\.rs|\.java|\.json|\.md|\.html|\.css|\bwrite\b|\bcreate\b|\bimplement\b|\bbuild\b|\bfix\b|\brefactor\b)/i.test(
      trimmed
    );

  return {
    kind: "pipeline",
    expectFileChanges,
  };
}

function buildPipelineReceiptMessage(userText, completedRun, workspaceRoot) {
  const res = completedRun?.result || {};
  const plan = res.plan || {};
  const executions = Array.isArray(res.executions) ? res.executions : [];
  const codexReview = res.codexReview || {};

  const modifiedFiles = [];
  const executionLines = executions.map((exec, idx) => {
    const deptLabel =
      exec.department === "qoder"
        ? "🟢 L3 工程一部 (Qoder · 独立计费)"
        : exec.department === "workbuddy"
        ? "🔵 L3 工程二部 (WorkBuddy · 独立计费)"
        : `🛠️ L3 ${String(exec.department || "").toUpperCase()}`;
    const div = exec.internalMeeting?.divisionOfLabor;
    const l4Flow = div
      ? `L4 四步同构内审: 1.规划[${div.plannerModel}] ➔ 2.Flash施工[${(div.executorModels || []).join(",")}] ➔ 3.内部督察[${div.inspectorModel || "自检"}] ➔ 4.终审[${div.reviewerModel}]`
      : `执行模型: ${exec.model}`;
    const files = (exec.diffReport?.authorizedChanges || []).map((c) => c.file);
    for (const f of files) {
      if (!modifiedFiles.includes(f)) modifiedFiles.push(f);
    }
    const auditBadge = exec.audit?.passed
      ? `✅ Codex (${exec.audit?.reviewerModel || "gpt-6.1-terra"}) 公司级初审通过 (${exec.audit?.integrityScore ?? 100}/100)`
      : `⚠️ Codex 公司级初审打回重做 (${exec.audit?.integrityScore ?? 60}/100: ${exec.audit?.summary || ""})`;
    return [
      `  ${idx + 1}. ${deptLabel} — 子任务：「${exec.subtaskTitle || "模块施工"}」`,
      `     - 责任田白名单 (allowedFiles): ${JSON.stringify(exec.diffReport?.allowedFiles || ["*"])}`,
      `     - 部门内多 Subagent 链路: ${l4Flow}`,
      `     - 实际落盘文件: ${files.length > 0 ? files.map((f) => `\`${f}\``).join(", ") : "(无文件变更或需总包工头兜底)"}`,
      `     - Codex 公司级初审: ${auditBadge}`,
    ].join("\n");
  });

  const reworkHistory = Array.isArray(res.reworkHistory) ? res.reworkHistory : [];
  const reworkBlock =
    reworkHistory.length > 0
      ? [
          `- **🔄 Codex 公司级审核打回重做闭环记录**:`,
          ...reworkHistory.map((r) => `  - ${r}`),
        ].join("\n")
      : `- **🔄 公司级审核打回重做记录**: 一次通过，无需返工`;

  // Extract the two Markdown usage tables from reportMarkdown so we can explicitly instruct DSH to output them verbatim
  const reportMd = String(completedRun?.reportMarkdown || "");
  const usageTablesStartIdx = reportMd.indexOf("### 💰 六、");
  const usageTablesMarkdown =
    usageTablesStartIdx !== -1 ? reportMd.slice(usageTablesStartIdx).trim() : "";

  const codexReviewerList =
    Array.isArray(codexReview.participatingModels) && codexReview.participatingModels.length > 0
      ? codexReview.participatingModels.join(" / ")
      : codexReview.model || "gpt-6.1-terra / gpt-6.1-sol / gpt-6-astra";

  const text = [
    `【🏢 集团四级流水线执行回执 — 请 DSH 对话框主模型执行「最终审核 (Final Review)」并汇报】`,
    `集团系统已在「公司模式」下自动调动麾下四大独立计费部门（Codex / Qoder / WorkBuddy / 豆包）完成了本次需求的全链路执行：`,
    `- **豆包 (Doubao)** 全程仅担任跨部门传话筒与物理隔离墙（隔离开下面的 Agent 防止勾连串联，不参与代码审核）；`,
    `- **Codex (\`gpt-6.1-terra\`, \`gpt-6.1-sol\`, \`gpt-6-astra\`)** 完成了顶层架构规划与**公司层面的代码及 Diff 审核**（审核不通过已自动打回重做）；`,
    `- **现在请由你（DSH 对话框里的模型）执行最终的审核 (Final Review)**！`,
    ``,
    `### 📋 本次集团工单实况档案 (Run ID: \`${completedRun?.runId || "completed"}\`)`,
    `- **工作区目录**: \`${workspaceRoot}\``,
    `- **🟣 L3 规划与公司级审核院 (Codex)**: 规划模型 \`${plan.model || "gpt-6.1-sol"}\`${plan.escalatedToAstra ? " (已触发 Astra 升级)" : ""}，拆解为 ${(plan.subtasks || []).length} 个子工单：${plan.planSummary || ""}`,
    `- **🟠 L3 跨部门传话与防勾连隔离处 (豆包 Doubao)**: 固定采用 \`工作模式 (agent-mode:1) + 豆包 2.1 Pro (doubao-2.1-pro) + 思考模式：高\`，已完成跨部门传话脱敏与身份隔离（仅传话隔离，不审核代码）。`,
    `- **🛠️ L3 工程一部 (Qoder) & 工程二部 (WorkBuddy) 施工与 L4 内部四步审核明细**:`,
    executionLines.join("\n") || "  (已完成部门级执行)",
    reworkBlock,
    `- **🟣 L3 Codex 公司层面审核结论 (\`gpt-6.1-terra\` / \`gpt-6.1-sol\` / \`gpt-6-astra\`)**: \`${codexReviewerList}\` — ${codexReview.approved ? "✅ 公司级审核通过" : "⚠️ 已触发返工复核"} (评分: ${codexReview.score ?? 95}/100) — ${codexReview.summary || ""}`,
    `- **📁 已由下属部门写入磁盘的文件**: ${modifiedFiles.length > 0 ? modifiedFiles.map((f) => `\`${f}\``).join(", ") : "无"}`,
    ``,
    `### ⚠️ L2 总包工头 & 最终审核官 (DSH 对话框模型) 铁律`,
    `1. **由你执行最终审核 (Final Review)**：下属部门已完成施工、豆包已完成防勾连隔离传话、Codex (\`6.1-terra\` / \`6.1-sol\` / \`6-astra\`) 已完成公司层面审核。请你现在执行验证命令（如 \`node ...\`）核验实际输出，并给出你作为 **DSH 对话框模型的最终审核结论**！`,
    `2. **严禁重复写文件覆盖下属已合规落盘的成果**：上述文件（${modifiedFiles.length > 0 ? modifiedFiles.join(", ") : "下属产出"}）已经由 Qoder 与 WorkBuddy 写入工作区磁盘并通过 Codex 公司级审核！除非你最终审核实机验证时发现报错，否则**绝不要**用你自己的 write/edit 工具重写覆盖它们！`,
    `3. **审核不通过严禁带病上报**：若你在最终审核运行验证时发现报错或接口不一致，你必须立即修补并通过实机运行验证，**确保最终呈报给董事长时 100% 审核通过且实机运行成功**！`,
    `4. **按最新职责分工向董事长汇报**：请在回复中向董事长清晰呈现：① Codex 顶层规划、② 豆包专职传话与防勾连物理隔离（不参与审核）、③ Qoder & WorkBuddy 分片施工及 L4 四步内审、④ Codex (\`gpt-6.1-terra\` / \`gpt-6.1-sol\` / \`gpt-6-astra\`) 公司层面审核及打回重做闭环、⑤ **你（DSH 对话框模型）的最终审核结论与实机验证输出**！`,
    `5. **【硬性格式要求】必须在回复末尾原样附上两张 Markdown 用量统计表**：向董事长汇报时，**必须在你的回复末尾完整粘贴输出下方的《💰 六、 四大部门独立计费与本次工单用量汇总表》和《📊 七、 本次工单全链路模型调用与耗时明细表》两张 Markdown 表格**！严禁省略、合并或删减这两张用量统计表！`,
    ``,
    `---`,
    `### 📌 必须在回复末尾原样输出的【用量与余额统计表】（请直接完整复制到你的回复末尾）`,
    usageTablesMarkdown,
    ``,
    `---`,
    `### 附：豆包秘书处整理的《集团项目结项总汇报》全文`,
    reportMd,
  ].join("\n");

  return {
    id: crypto.randomUUID(),
    role: "user",
    content: [{ type: "text", text }],
    source: { kind: "dsh-company-foreman" },
  };
}

async function buildMetaStatusMessage(hostService, workspaceRoot) {
  const ov = await hostService.overview({ forceBalances: false }).catch(() => null);
  const ag = ov?.balances?.agents || {};
  const recentRuns = Array.isArray(hostService?.recentRuns) ? hostService.recentRuns : [];
  const matchingRun =
    recentRuns.find((r) => r && r.workspaceRoot === workspaceRoot) || recentRuns[0] || null;

  const lines = [
    `【🏢 集团公司模式台账与状态同步（仅供 L2 总包工头回答董事长查询）】`,
    `当前会话严格运行在「公司模式」(preset: company)。`,
    ``,
    `### 1. 四部门独立实时余额与配置`,
    `- **🟣 Codex (规划与公司级审核院 · gpt-6.1-terra / gpt-6.1-sol / gpt-6-astra · 严禁 luna)**: \`${ag.codex?.headlineBalance || "正常"}\``,
    `- **🟢 Qoder (工程一部 · 独立计费 · 规划/内审: kimi-3.1-pro, glm-5.3, qwen3.8-max | 执行: deepseek-v4.1-flash, glm-5.3-flash, qwen3.8-flash)**: \`${ag.qoder?.headlineBalance || "正常"}\``,
    `- **🔵 WorkBuddy (工程二部 · 独立计费 · 同构大模型+Flash分级)**: \`${ag.workbuddy?.headlineBalance || "正常"}\``,
    `- **🟠 豆包 Doubao (跨部门传话与防勾连隔离处 · 仅传话防勾连不审核 · 工作模式 + 豆包 2.1 Pro + 思考高)**: \`${ag.doubao?.headlineBalance || "正常"}\``,
  ];

  if (matchingRun) {
    lines.push(
      ``,
      `### 2. 最近一次集团四级流水线工单档案 (Run ID: \`${matchingRun.runId}\`)`,
      `- **工单目标**: ${matchingRun.goal || ""}`,
      `- **工作区**: \`${matchingRun.workspaceRoot || workspaceRoot}\``,
      `- **执行状态**: ${matchingRun.status} (${matchingRun.stage || ""})`,
      `- **详细结项报告**:`,
      matchingRun.reportMarkdown || "(已完成)"
    );
  } else {
    lines.push(
      ``,
      `### 2. 最近工单记录`,
      `- 当前工作区尚未派发工单；一旦董事长下达开发或修改需求，系统将自动调动 Codex、Qoder、WorkBuddy、豆包四部门按四级流水线执行。`
    );
  }

  return {
    id: crypto.randomUUID(),
    role: "user",
    content: [{ type: "text", text: lines.join("\n") }],
    source: { kind: "dsh-company-foreman" },
  };
}

export function apply(ctx) {
  const hostService = getSharedCompanyHostService(ctx);
  const disposeTools = registerCompanyAgentTools(ctx, hostService);

  let disposeSection;
  if (ctx.systemPrompt && typeof ctx.systemPrompt.section === "function") {
    disposeSection = ctx.systemPrompt.section({
      name: "company:foreman-discipline",
      order: 140,
      interpolate: false,
      text: COMPANY_FOREMAN_SYSTEM_PROMPT,
    });
  }

  const processedMessageIds = new Set();
  const sessionsWithCompletedPipeline = new Set();
  let disposePreStep = null;
  let disposePreExecute = null;

  if (typeof ctx.on === "function") {
    disposePreStep = ctx.on(
      "agent/pre-step",
      async (payload, next) => {
        const decision = typeof next === "function" ? await next() : payload;
        if (!decision || decision.kind !== "enter" || !Array.isArray(decision.messages)) {
          return decision;
        }

        const agent = payload?.agent;
        const session = agent?.session || payload?.session || null;

        // Strict preset guard: only run inside the `company` preset (`公司模式`)
        if (session && typeof hostService?.resolveSessionPresetId === "function") {
          const presetId = hostService.resolveSessionPresetId(session);
          if (presetId && presetId !== "company") {
            return decision;
          }
        }

        // Find the latest unprocessed real user message in this step
        const realUserMessages = decision.messages.filter(isRealUserMessage);
        if (realUserMessages.length === 0) {
          return decision;
        }
        const latestUserMsg = realUserMessages[realUserMessages.length - 1];
        const msgKey =
          latestUserMsg.id || `${session?.id || "anon"}:${extractMessageText(latestUserMsg)}`;
        if (processedMessageIds.has(msgKey)) {
          return decision;
        }
        processedMessageIds.add(msgKey);

        const userText = extractMessageText(latestUserMsg);
        const classification = classifyCompanyUserPrompt(userText);
        if (classification.kind === "ignore") {
          return decision;
        }

        const sessionCwd =
          session?.header?.cwd || session?.cwd || hostService.defaultWorkspace();

        if (classification.kind === "meta") {
          const metaMsg = await buildMetaStatusMessage(hostService, sessionCwd);
          return {
            ...decision,
            messages: [...decision.messages, metaMsg],
          };
        }

        // Actionable task in `公司模式`: deterministically execute the 4-tier company pipeline
        // (Codex plan -> Doubao sanitize -> Qoder & WorkBuddy L4 4-step execution -> Doubao diff audit -> Codex blind review)
        // BEFORE DSH or `agy` can write files directly itself!
        const actionRes = await hostService.executeAction({
          action: "pipeline",
          goal: userText,
          workspaceRoot: sessionCwd,
          enableInternalMeetings: true,
          expectFileChanges: classification.expectFileChanges,
          timeoutMs: Number(payload?.timeoutMs) || 90000,
          mockRunner: payload?.mockRunner || hostService?.config?.mockRunner || null,
          async: false,
        });

        const completedRun = actionRes?.run;
        if (session?.id) {
          sessionsWithCompletedPipeline.add(session.id);
          if (hostService.lastAutoPipelineBySession instanceof Map) {
            hostService.lastAutoPipelineBySession.set(session.id, {
              ts: Date.now(),
              run: completedRun,
            });
          }
        }

        const receiptMsg = buildPipelineReceiptMessage(
          userText,
          completedRun,
          sessionCwd
        );
        return {
          ...decision,
          messages: [...decision.messages, receiptMsg],
        };
      },
      { prepend: true }
    );

    disposePreExecute = ctx.on("tools/pre-execute", async (payload, next) => {
      const toolName = String(payload?.name || payload?.toolName || "");
      const session = payload?.agent?.session || payload?.session || null;
      const isDirectFileEditTool =
        toolName === "write" ||
        toolName === "edit" ||
        toolName === "write_file" ||
        toolName === "edit_file";

      if (isDirectFileEditTool && session?.id && !sessionsWithCompletedPipeline.has(session.id)) {
        const hasRecentWorkspaceRun = (hostService?.recentRuns || []).some(
          (r) =>
            r &&
            Date.now() - (r.endedAt || r.startedAt || 0) < 300000 &&
            r.workspaceRoot === (session?.header?.cwd || session?.cwd)
        );
        if (!hasRecentWorkspaceRun) {
          throw new Error(
            "【🏢 公司模式纪律拦截】严禁 DSH 总包工头跳过四部门直接写文件！请先通过 `run_company_pipeline` 调度 Codex、Qoder、WorkBuddy、豆包四部门完成规划、分片施工与多层内审后，仅在兜底修补时方可写文件。"
          );
        }
      }
      return typeof next === "function" ? await next() : payload;
    });
  }

  ctx.effect?.(() => () => {
    try {
      disposeTools?.();
    } catch {}
    try {
      disposeSection?.();
    } catch {}
    try {
      if (typeof disposePreStep === "function") disposePreStep();
    } catch {}
    try {
      if (typeof disposePreExecute === "function") disposePreExecute();
    } catch {}
  }, "dsh-company: preset-tools");
}
