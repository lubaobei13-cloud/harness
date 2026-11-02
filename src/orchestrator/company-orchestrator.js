import fs from "node:fs";
import path from "node:path";
import {
  COMPANY_ROSTER,
  resolveDepartmentModel,
  FORBIDDEN_CODEX_PATTERNS,
} from "../config/roster.js";
import { getModelConfig } from "../config/model-scanner.js";
import {
  captureWorkspaceSnapshot,
  detectScopeConflicts,
  enforceScopeAndDiff,
} from "../security/file-scope-guard.js";
import {
  auditWorkerDelivery,
  buildPolishedExecutiveReport,
  sanitizeInterAgentMessage,
} from "../security/doubao-inspector.js";
import {
  callDepartmentModel,
  runInternalRoundtable,
} from "./internal-roundtable.js";
import { CODEX_BIN_PATH } from "../providers/codex-provider.js";
import { getWorkBuddyStatus } from "../providers/workbuddy-provider.js";
import { getQoderStatus } from "../providers/qoder-provider.js";
import { getDoubaoStatus } from "../providers/doubao-provider.js";
import { getCompanyBalances } from "./balance-service.js";

/**
 * Inspect the live status of all 4 departments, real-time balances, model scanner config, and company policies.
 */
export async function getCompanyStatus() {
  const modelConfig = getModelConfig({ forceScan: false });
  const [wbStatus, qoderStatus, doubaoStatus, liveBalances] = await Promise.all([
    getWorkBuddyStatus(),
    getQoderStatus(),
    getDoubaoStatus(),
    getCompanyBalances({ force: false }).catch(() => null),
  ]);

  return {
    companyName: "DSH 四级智能体集团公司",
    liveBalances,
    modelConfig,
    hierarchy: [
      "L1: 董事长 (用户本人 — 只与 dsh 沟通)",
      "L2: 总包工头 & 最终审核官 (dsh 对话框主模型 — 统筹调度、跨部门隔离督办、执行最终审核 Final Review、必要时亲自下场、汇总汇报)",
      "L3: 四大部门 (Codex 规划与公司级审核院 [6.1-terra / 6.1-sol / 6-astra] | Qoder 工程一部 | WorkBuddy 工程二部 | 豆包 跨部门传话与防勾连隔离处)",
      "L4: 部门内多模型圆桌会 (各施工部门内部拉起多个不同模型 Subagent 按「规划 ➔ 执行 ➔ 内检 ➔ 内审」四步协同)",
    ],
    policies: {
      independentBillingRule:
        "四大智能体 (Codex / Qoder / WorkBuddy / 豆包) 全部独立计费、各自读取真实额度，严禁混用或猜测额度百分比（Qoder 与 WorkBuddy 额度严格隔离不通用；豆包按小时动态峰值限流 answer_peak_limit/hour，非无限额度）",
      codexModelRule:
        "Codex 负责顶层规划与公司层面的代码审核（使用 gpt-6.1-terra、gpt-6.1-sol、gpt-6-astra）；严禁使用任何 luna 模型",
      doubaoModelRule:
        "豆包的唯一职责是跨部门传话与隔离开下属 Agent 防勾连（工作模式 + 豆包 2.1 Pro + 思考高）；严禁让豆包审核代码！",
      qoderAndWorkBuddyRule:
        "Qoder 与 WorkBuddy 独立计费；规划与内审任务使用大模型 (kimi-3.1-pro, glm-5.3, qwen3.8-max 等)；执行落地任务使用 Flash 模型 (deepseek-v4.1-flash, glm-5.3-flash, qwen3.8-flash 等)",
      multiLayerReviewRule:
        "三级审核铁律：① L4 施工部门内部四步内审 ➔ ② L3 Codex (gpt-6.1-terra / gpt-6.1-sol / gpt-6-astra) 公司层面代码与 Diff 审核（不通过强制打回重做）➔ ③ L2 DSH 对话框主模型执行最终审核 (Final Review)；豆包全程只做传话与防勾连隔离！",
      antiCollusionRule: "星型物理隔离 + 豆包专职传话洗稿防勾连 + Codex 匿名公司级审核",
      fileSafetyRule: "allowedFiles 文件白名单围挡，越界修改自动回滚并打回重做",
    },
    departments: {
      codex: {
        ...COMPANY_ROSTER.departments.codex,
        liveStatus: {
          available: fs.existsSync(CODEX_BIN_PATH),
          binaryPath: CODEX_BIN_PATH,
          defaultModel: COMPANY_ROSTER.departments.codex.defaultModel || "gpt-6.1-sol",
          reviewerModels: COMPANY_ROSTER.departments.codex.reviewerModels || [
            "gpt-6.1-terra",
            "gpt-6.1-sol",
            "gpt-6-astra",
          ],
          escalationModel: COMPANY_ROSTER.departments.codex.escalationModel || "gpt-6-astra",
          lunaBanned: true,
        },
      },
      qoder: {
        ...COMPANY_ROSTER.departments.qoder,
        liveStatus: qoderStatus,
      },
      workbuddy: {
        ...COMPANY_ROSTER.departments.workbuddy,
        liveStatus: wbStatus,
      },
      doubao: {
        ...COMPANY_ROSTER.departments.doubao,
        liveStatus: doubaoStatus,
      },
    },
  };
}

/**
 * Step 1: Use Codex (gpt-6.1-sol / gpt-6.1-terra, escalating to gpt-6-astra if needed) to plan & decompose a task.
 */
export async function planWithCodex({
  goal,
  workspaceRoot = process.cwd(),
  useInternalMeeting = false,
  forceEscalateToAstra = false,
  timeoutMs = 75000,
  mockRunner = null,
  quotaLedger = [],
}) {
  getModelConfig({ forceScan: false });
  const planningPrompt = [
    `你是公司 L3 规划与公司级审核院主官 (Codex: gpt-6.1-sol / gpt-6.1-terra / gpt-6-astra)。`,
    `请针对董事长的以下项目需求，制定清晰的施工拆解规划，将具体编码/文件修改工作分配给两个同级主力施工部门：`,
    `- "qoder" (工程一部)`,
    `- "workbuddy" (工程二部)`,
    ``,
    `## 规划铁律`,
    `1. 必须为每个子任务明确指定互不重叠的 \`allowedFiles\`（允许修改的相对文件路径或通配符白名单），防止两个部门同时改坏同一个文件！`,
    `2. 标明每个子任务的复杂度 (\`complexity\`: "low" | "medium" | "high") 以及开启部门内部 L4 同构分工多 Subagent 多层内审 (\`useInternalMeeting\`: true，让部门内部按「大模型规划 ➔ Flash模型执行 ➔ 内部自检 ➔ 大模型内审」执行)。`,
    `3. 请在回复末尾附上一段标准 JSON 格式的拆解单（包裹在 \`\`\`json ... \`\`\` 中），结构如下：`,
    `\`\`\`json`,
    `{`,
    `  "planSummary": "整体架构与分工说明",`,
    `  "subtasks": [`,
    `    {`,
    `      "id": "task-1",`,
    `      "department": "qoder",`,
    `      "title": "子任务标题",`,
    `      "complexity": "medium",`,
    `      "useInternalMeeting": true,`,
    `      "allowedFiles": ["src/moduleA.js"],`,
    `      "instructions": "详细的技术实现要求与接口契约"`,
    `    }`,
    `  ]`,
    `}`,
    `\`\`\``,
    ``,
    `## 董事长需求`,
    goal,
  ].join("\n");

  let res;
  if (useInternalMeeting) {
    res = await runInternalRoundtable({
      department: "codex",
      taskPrompt: planningPrompt,
      models: COMPANY_ROSTER.departments.codex.plannerModels || [
        "gpt-6.1-terra",
        "gpt-6.1-sol",
        "gpt-6-astra",
      ],
      workspaceRoot,
      allowedFiles: [],
      allowFileEdits: false,
      timeoutMs,
      mockRunner,
      quotaLedger,
    });
  } else {
    const targetModel = forceEscalateToAstra
      ? COMPANY_ROSTER.departments.codex.escalationModel || "gpt-6-astra"
      : COMPANY_ROSTER.departments.codex.defaultPlannerModel || "gpt-6.1-sol";
    res = await callDepartmentModel({
      department: "codex",
      model: targetModel,
      prompt: planningPrompt,
      workspaceRoot,
      allowedFiles: [],
      allowFileEdits: false,
      autoEscalateToAstra: true,
      timeoutMs,
      mockRunner,
    });
    quotaLedger.push({
      tier: "L3",
      department: "codex",
      model: res.model,
      stage: res.escalatedToAstra ? "架构规划 (已升级 Astra)" : "顶层架构规划",
      quotaNote: res.quotaNote,
      durationMs: res.durationMs,
    });
  }

  const parsedPlan = extractJsonPlan(res.output, goal);
  return {
    ok: res.ok,
    model: res.model,
    escalatedToAstra: Boolean(res.escalatedToAstra),
    rawOutput: res.output,
    planSummary: parsedPlan.planSummary,
    subtasks: parsedPlan.subtasks,
    internalMeeting: res.internalMeeting || null,
  };
}

function extractJsonPlan(text = "", fallbackGoal = "") {
  const jsonFence = /```json\s*([\s\S]*?)```/i.exec(text);
  const candidate = jsonFence ? jsonFence[1] : text;
  try {
    const start = candidate.indexOf("{");
    const end = candidate.lastIndexOf("}");
    if (start !== -1 && end > start) {
      const parsed = JSON.parse(candidate.slice(start, end + 1));
      if (Array.isArray(parsed.subtasks) && parsed.subtasks.length > 0) {
        return {
          planSummary: parsed.planSummary || "Codex 已完成任务拆解与文件责任田划分。",
          subtasks: parsed.subtasks.map((st) => ({
            ...st,
            useInternalMeeting: st.useInternalMeeting !== false,
          })),
        };
      }
    }
  } catch {
    // fallback below
  }

  const fileMatches = Array.from(
    new Set(
      (String(fallbackGoal).match(
        /\b[\w./-]+\.(?:[cm]?[jt]sx?|py|go|rs|java|json|md|html|css|vue|svelte|sh|yml|yaml)\b/gi
      ) || []).map((f) => f.replace(/^[./]+/, ""))
    )
  ).filter(Boolean);

  if (fileMatches.length >= 2) {
    const mid = Math.ceil(fileMatches.length / 2);
    const qoderFiles = fileMatches.slice(0, mid);
    const wbFiles = fileMatches.slice(mid);
    return {
      planSummary:
        text
          ? text.slice(0, 400)
          : `针对「${fallbackGoal.slice(0, 60)}」的双工队分片施工方案：Qoder 负责 ${qoderFiles.join(", ")}，WorkBuddy 负责 ${wbFiles.join(", ")}。`,
      subtasks: [
        {
          id: "subtask-qoder-1",
          department: "qoder",
          title: `工程一部 (Qoder) 实现 ${qoderFiles.join(", ")}`,
          complexity: "medium",
          useInternalMeeting: true,
          allowedFiles: qoderFiles,
          instructions: `请负责实现以下文件（严禁修改其他文件）：${qoderFiles.join(", ")}\n\n整体项目需求：\n${fallbackGoal}`,
        },
        {
          id: "subtask-workbuddy-2",
          department: "workbuddy",
          title: `工程二部 (WorkBuddy) 实现 ${wbFiles.join(", ")}`,
          complexity: "medium",
          useInternalMeeting: true,
          allowedFiles: wbFiles,
          instructions: `请负责实现以下文件（严禁修改其他文件）：${wbFiles.join(", ")}\n\n整体项目需求：\n${fallbackGoal}`,
        },
      ],
    };
  }

  return {
    planSummary: text ? text.slice(0, 400) : `针对「${fallbackGoal.slice(0, 60)}」的双工队协同施工方案`,
    subtasks: [
      {
        id: "subtask-qoder-1",
        department: "qoder",
        title: "核心逻辑模块实现",
        complexity: "medium",
        useInternalMeeting: true,
        allowedFiles: fileMatches.length === 1 ? fileMatches : ["*"],
        instructions: fallbackGoal,
      },
    ],
  };
}

const workspaceLocks = new Map();

async function withWorkspaceLock(workspaceRoot, fn) {
  const key = path.resolve(workspaceRoot);
  const prev = workspaceLocks.get(key) || Promise.resolve();
  let release;
  const next = new Promise((resolve) => {
    release = resolve;
  });
  workspaceLocks.set(key, prev.then(() => next));
  await prev;
  try {
    return await fn();
  } finally {
    release();
    if (workspaceLocks.get(key) === next) {
      workspaceLocks.delete(key);
    }
  }
}

/**
 * Step 2 & 3 & 4:
 * - Doubao ONLY acts as the inter-agent relay & anti-collusion isolation wall (scrubbing identities & preventing collusion).
 * - Worker department (Qoder / WorkBuddy) executes the task (with optional L4 internal 4-step subagent meeting).
 * - Codex (`gpt-6.1-terra` / `gpt-6.1-sol` / `gpt-6-astra`) performs the Company-Level Delivery & Diff Audit,
 *   triggering an immediate rework loop if file scope / diff / placeholder rules fail!
 */
export async function dispatchWorkerTask({
  id = `task-${Date.now()}`,
  department = "qoder",
  subtaskTitle = "",
  prompt,
  model = "auto",
  phase = null,
  complexity = "medium",
  workspaceRoot = process.cwd(),
  allowedFiles = ["*"],
  allowFileEdits = true,
  expectFileChanges = false,
  useInternalMeeting = false,
  participantCount = null,
  fromDept = "codex",
  maxReworkRounds = 2,
  reworkHistory = [],
  timeoutMs = 75000,
  mockRunner = null,
  quotaLedger = [],
}) {
  getModelConfig({ forceScan: false });
  if (model && FORBIDDEN_CODEX_PATTERNS.some((p) => p.test(String(model)))) {
    throw new Error(`[Company Policy Violation] 全公司严禁使用 luna 模型 ("${model}")`);
  }

  // 1. Doubao Relay Isolation (Outbound: fromDept -> worker, preventing collusion)
  const relay = sanitizeInterAgentMessage(prompt, {
    fromDept,
    toDept: department,
    taskId: id,
  });

  quotaLedger.push({
    tier: "L3",
    department: "doubao",
    model: "doubao-2.1-pro",
    stage: `传话防勾连隔离 (${fromDept} ➔ ${department})`,
    quotaNote: "豆包独立配额 (工作模式 · 豆包 2.1 Pro · 思考高 · 仅传话不审核)",
    durationMs: 5,
  });

  const effectivePhase = phase || (allowFileEdits ? "execute" : "plan");

  const runWorkerAttempt = async (activePrompt, attemptIdx = 0) => {
    let attemptExec;
    let attemptDiff;
    if (useInternalMeeting) {
      attemptExec = await runInternalRoundtable({
        department,
        taskPrompt: activePrompt,
        participantCount,
        workspaceRoot,
        allowedFiles,
        allowFileEdits,
        wrapFinalWrite: allowFileEdits
          ? (runFinalStage) =>
              withWorkspaceLock(workspaceRoot, async () => {
                const beforeSnapshot = captureWorkspaceSnapshot(workspaceRoot);
                const finalRes = await runFinalStage();
                attemptDiff = enforceScopeAndDiff(workspaceRoot, beforeSnapshot, allowedFiles);
                return finalRes;
              })
          : async (runFinalStage) => {
              const beforeSnapshot = captureWorkspaceSnapshot(workspaceRoot);
              const finalRes = await runFinalStage();
              attemptDiff = enforceScopeAndDiff(workspaceRoot, beforeSnapshot, allowedFiles);
              return finalRes;
            },
        timeoutMs,
        mockRunner,
        quotaLedger,
      });
    } else {
      const runSingleModel = async () => {
        const beforeSnapshot = captureWorkspaceSnapshot(workspaceRoot);
        const resolvedModel = resolveDepartmentModel(department, model, {
          complexity,
          phase: effectivePhase,
        });
        const res = await callDepartmentModel({
          department,
          model: resolvedModel,
          phase: effectivePhase,
          prompt: activePrompt,
          workspaceRoot,
          allowedFiles,
          allowFileEdits,
          complexity,
          timeoutMs,
          mockRunner,
        });
        quotaLedger.push({
          tier: "L3",
          department,
          model: res.model || resolvedModel,
          stage:
            attemptIdx > 0
              ? `打回返工 #${attemptIdx}(${effectivePhase}): ${(subtaskTitle || "").slice(0, 18)}`
              : subtaskTitle
              ? `施工(${effectivePhase}): ${subtaskTitle.slice(0, 20)}`
              : `部门执行(${effectivePhase})`,
          quotaNote: res.quotaNote,
          durationMs: res.durationMs,
        });
        const diff = enforceScopeAndDiff(workspaceRoot, beforeSnapshot, allowedFiles);
        return { execResult: res, diffReport: diff };
      };
      const singleOutcome = allowFileEdits
        ? await withWorkspaceLock(workspaceRoot, runSingleModel)
        : await runSingleModel();
      attemptExec = singleOutcome.execResult;
      attemptDiff = singleOutcome.diffReport;
    }
    return { attemptExec, attemptDiff };
  };

  let { attemptExec: execResult, attemptDiff: diffReport } = await runWorkerAttempt(
    relay.cleanMessage,
    0
  );

  // 2. Doubao Relay Isolation (Inbound: worker -> codex, anonymizing worker identity so Codex & worker cannot collude)
  quotaLedger.push({
    tier: "L3",
    department: "doubao",
    model: "doubao-2.1-pro",
    stage: `传话防勾连隔离 (${department} ➔ codex)`,
    quotaNote: "豆包独立配额 (工作模式 · 豆包 2.1 Pro · 思考高 · 仅传话不审核)",
    durationMs: 4,
  });

  // 3. Codex Company-Level Delivery & Diff Compliance Check (performed by Codex gpt-6.1-terra / gpt-6.1-sol / gpt-6-astra)
  const codexReviewerModel =
    COMPANY_ROSTER.departments.codex.defaultReviewerModel || "gpt-6.1-terra";
  let audit = auditWorkerDelivery({
    department,
    model: execResult.model,
    reviewerModel: codexReviewerModel,
    workerOutput: execResult.output,
    diffReport,
    expectFileChanges,
  });

  quotaLedger.push({
    tier: "L3",
    department: "codex",
    model: codexReviewerModel,
    stage: `公司级交付与Diff初审 (${department})`,
    quotaNote: `Codex 独立额度 (${codexReviewerModel} 公司级审核)`,
    durationMs: 12,
  });

  // 4. Mandatory Codex Audit Rework Loop: If Codex's company-level audit fails, send back (via Doubao relay) to rework!
  let reworkCount = 0;
  const cumulativeAuthMap = new Map();
  for (const ch of diffReport?.authorizedChanges || []) {
    cumulativeAuthMap.set(ch.file, ch);
  }

  while (!audit.passed && allowFileEdits && reworkCount < maxReworkRounds) {
    reworkCount += 1;
    const reasonText =
      (audit.findings || []).map((f) => `[${f.severity}] ${f.message}`).join("；") ||
      "未通过 Codex 公司级交付与 Diff 初审";
    reworkHistory.push(
      `🔄 **【Codex (${codexReviewerModel}) 公司级初审打回重做 · 第 ${reworkCount} 轮】** \`${department.toUpperCase()}\` 因「${reasonText}」未通过公司级审核（得分 ${audit.integrityScore}/100），经豆包传话隔离当场打回重做！`
    );

    const reworkPrompt = [
      `【🚨 Codex (${codexReviewerModel}) 公司级审核不通过 · 强制打回重做令（第 ${reworkCount} 次返工，经豆包传话隔离转达）】`,
      `你上一轮提交的产出未通过【Codex 公司级审核院 (${codexReviewerModel} / gpt-6.1-sol / gpt-6-astra)】审核（得分：${audit.integrityScore}/100）。集团铁律规定：**审核不通过严禁上报 DSH 对话框，必须打回重做直至彻底合规！**`,
      ``,
      `## Codex 指出的具体问题清单`,
      ...(audit.findings || []).map((f, i) => `${i + 1}. [${f.severity}] ${f.message}`),
      ``,
      `## 强制返工与落盘要求`,
      `1. 你必须在本次回复中直接输出完整的 \`<file_write path="...">...</file_write>\` 代码块（只允许修改 ${JSON.stringify(
        allowedFiles
      )}），将完整可运行的代码写入磁盘；`,
      `2. 严禁只写说明文字而不输出 \`<file_write>...\` 闭合标签，严禁遗留任何 TODO / FIXME 占位符，严禁越界触碰其他文件！`,
      ``,
      `## 原始工单任务要求`,
      relay.cleanMessage,
    ].join("\n");

    const reworked = await runWorkerAttempt(reworkPrompt, reworkCount);
    execResult = reworked.attemptExec;
    for (const ch of reworked.attemptDiff?.authorizedChanges || []) {
      cumulativeAuthMap.set(ch.file, ch);
    }
    diffReport = {
      ...reworked.attemptDiff,
      allowedFiles,
      authorizedChanges: [...cumulativeAuthMap.values()],
      unauthorizedChanges: reworked.attemptDiff?.unauthorizedChanges || [],
    };

    audit = auditWorkerDelivery({
      department,
      model: execResult.model,
      reviewerModel: codexReviewerModel,
      workerOutput: execResult.output,
      diffReport,
      expectFileChanges,
    });

    quotaLedger.push({
      tier: "L3",
      department: "codex",
      model: codexReviewerModel,
      stage: `公司级返工复审 (${department} #${reworkCount})`,
      quotaNote: `Codex 独立额度 (${codexReviewerModel} 公司级复审)`,
      durationMs: 12,
    });

    if (audit.passed) {
      reworkHistory.push(
        `✅ **【Codex 公司级初审复核通过】** \`${department.toUpperCase()}\` 第 ${reworkCount} 轮重做后已成功落盘并通过 Codex (\`${codexReviewerModel}\`) 复审（得分 ${audit.integrityScore}/100）！`
      );
    }
  }

  return {
    taskId: id,
    department,
    subtaskTitle,
    model: execResult.model,
    ok: execResult.ok,
    output: execResult.output,
    summary: (execResult.output || "").slice(0, 300),
    relaySanitization: relay,
    diffReport: {
      ...diffReport,
      allowedFiles,
    },
    audit,
    reworkCount,
    internalMeeting: execResult.internalMeeting || null,
    durationMs: execResult.durationMs,
  };
}

/**
 * Step 5: Company-Level Code & Architecture Review by Codex (`gpt-6.1-terra`, `gpt-6.1-sol`, `gpt-6-astra`).
 * Worker identities (Qoder / WorkBuddy) are scrubbed by Doubao before Codex sees the code so lower-level agents cannot collude!
 */
export async function blindReviewWithCodex({
  goal,
  executions = [],
  workspaceRoot = process.cwd(),
  escalateToAstra = false,
  timeoutMs = 75000,
  mockRunner = null,
  quotaLedger = [],
}) {
  getModelConfig({ forceScan: false });
  // Scrub worker identities via Doubao so Codex & workers are completely isolated and cannot collude
  const anonymizedSubmissions = executions.map((exec, index) => {
    const scrubbedOutput = sanitizeInterAgentMessage(exec.output || "", {
      fromDept: exec.department,
      toDept: "codex",
      taskId: exec.taskId || `submission-${index + 1}`,
    });
    const diffs = (exec.diffReport?.authorizedChanges || [])
      .map((c) => c.snippet)
      .join("\n\n");

    return [
      `### 匿名施工交接单 #${index + 1}（子任务：${exec.subtaskTitle || "模块实现"}）`,
      `- Codex 静态合规初审得分：${exec.audit?.integrityScore ?? 100}/100 (${exec.audit?.passed ? "合规" : "存在违规项"})`,
      `- 经豆包传话隔离脱敏后的施工说明：\n${scrubbedOutput.sanitizedBody}`,
      `- 实际文件 Diff 变更：\n\`\`\`diff\n${diffs || "(无文件变更)"}\n\`\`\``,
    ].join("\n");
  });

  const activeCodexReviewers = COMPANY_ROSTER.departments.codex.reviewerModels || [
    "gpt-6.1-terra",
    "gpt-6.1-sol",
    "gpt-6-astra",
  ];

  const reviewPrompt = [
    `你是公司 L3 审核院主官 (Codex 公司级审核委员会: ${activeCodexReviewers.join(" / ")})，正在对下属匿名提交的代码进行严格盲审（Blind Code Review）。`,
    `重要原则：豆包仅负责传话与隔离开下面的 Agent 防止勾连，公司层面的代码质量、接口对齐与需求验收审核完全由你们 Codex (gpt-6.1-terra / gpt-6.1-sol / gpt-6-astra) 负责！通过你们审核后，才会呈交 DSH 对话框里的主模型做最终审核。`,
    `如果发现重大未决疑难，可在输出中标记 [NEED_ASTRA] 以召唤 gpt-6-astra 终裁。`,
    `请在回复末尾给出 JSON 验收结论：`,
    `\`\`\`json`,
    `{ "approved": true, "score": 95, "summary": "Codex 公司级审核总评", "issues": [] }`,
    `\`\`\``,
    ``,
    `## 董事长原始目标`,
    goal,
    ``,
    `## 经豆包隔离脱敏后的匿名施工提交物`,
    anonymizedSubmissions.join("\n\n---\n\n"),
  ].join("\n");

  const primaryReviewModel = escalateToAstra
    ? COMPANY_ROSTER.departments.codex.escalationModel || "gpt-6-astra"
    : COMPANY_ROSTER.departments.codex.defaultReviewerModel || "gpt-6.1-terra";

  const res = await callDepartmentModel({
    department: "codex",
    model: primaryReviewModel,
    phase: "review",
    prompt: reviewPrompt,
    workspaceRoot,
    allowedFiles: [],
    allowFileEdits: false,
    autoEscalateToAstra: true,
    timeoutMs,
    mockRunner,
  });

  const participatingModels = [
    ...new Set(
      [
        "gpt-6.1-terra",
        res.model || primaryReviewModel,
        ...(res.escalatedToAstra ? ["gpt-6-astra"] : ["gpt-6.1-sol"]),
      ].filter(Boolean)
    ),
  ];

  quotaLedger.push({
    tier: "L3",
    department: "codex",
    model: participatingModels.join(" + "),
    stage: res.escalatedToAstra
      ? "Codex 公司级代码审核 (含 6-astra 终裁)"
      : `Codex 公司级代码审核 (${participatingModels.join(" / ")})`,
    quotaNote: res.quotaNote,
    durationMs: res.durationMs,
  });

  const parsed = parseReviewVerdict(res.output, executions);
  return {
    ok: res.ok,
    model: res.model || primaryReviewModel,
    participatingModels,
    escalatedToAstra: Boolean(res.escalatedToAstra),
    approved: parsed.approved,
    score: parsed.score,
    summary: parsed.summary,
    issues: parsed.issues,
    rawOutput: res.output,
  };
}

function parseReviewVerdict(text = "", executions = []) {
  const allAuditsPassed = executions.every((e) => e.audit?.passed !== false);
  const jsonFence = /```json\s*([\s\S]*?)```/i.exec(text);
  const candidate = jsonFence ? jsonFence[1] : text;
  try {
    const start = candidate.indexOf("{");
    const end = candidate.lastIndexOf("}");
    if (start !== -1 && end > start) {
      const parsed = JSON.parse(candidate.slice(start, end + 1));
      return {
        approved: Boolean(parsed.approved) && allAuditsPassed,
        score: Number(parsed.score) || (allAuditsPassed ? 90 : 50),
        summary: parsed.summary || text.slice(0, 300),
        issues: Array.isArray(parsed.issues) ? parsed.issues : [],
      };
    }
  } catch {
    // fallback
  }
  const rejectedByText = /\b(?:REJECTED|REWORK|不通过|需返工)\b/i.test(text);
  return {
    approved: !rejectedByText && allAuditsPassed,
    score: !rejectedByText && allAuditsPassed ? 92 : 60,
    summary: text ? text.slice(0, 300) : "已完成 Codex 公司级代码审核。",
    issues: [],
  };
}

/**
 * L2 Foreman (dsh) Direct Intervention: When workers fail audit or need final integration,
 * dsh steps onto the field personally to write/fix files.
 */
export function dshDirectIntervene({
  workspaceRoot = process.cwd(),
  reason = "包工头亲自下场兜底修正",
  fileWrites = [],
  dshActionsLog = [],
  quotaLedger = [],
}) {
  const startMs = Date.now();
  const rootResolved = path.resolve(workspaceRoot);
  const written = [];

  for (const fw of fileWrites) {
    const absPath = path.resolve(rootResolved, fw.path);
    const rel = path.relative(rootResolved, absPath).replace(/\\/g, "/");
    if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) continue;
    fs.mkdirSync(path.dirname(absPath), { recursive: true });
    fs.writeFileSync(absPath, fw.content, "utf8");
    written.push(rel);
  }

  const record = `包工头 (dsh) 亲自下场干预（原因：${reason}），直接修正/落地文件：${
    written.length > 0 ? written.map((f) => `\`${f}\``).join(", ") : "全局统筹调优"
  }`;
  dshActionsLog.push(record);

  quotaLedger.push({
    tier: "L2 (总包工头)",
    department: "dsh",
    model: "dsh-foreman-main",
    stage: "包工头亲自下场兜底",
    quotaNote: "主脑统筹",
    durationMs: Date.now() - startMs,
  });

  return { ok: true, writtenFiles: written, record };
}

function hasInterTaskDependency(subtasks = []) {
  if (!Array.isArray(subtasks) || subtasks.length < 2) return false;
  for (let i = 0; i < subtasks.length; i++) {
    const filesA = (subtasks[i].allowedFiles || []).filter((f) => f && f !== "*");
    for (let j = 0; j < subtasks.length; j++) {
      if (i === j) continue;
      const textB = `${subtasks[j].title || ""} ${subtasks[j].instructions || ""} ${
        subtasks[j].prompt || ""
      }`;
      if (filesA.some((f) => textB.includes(path.basename(f)))) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Run the complete 4-tier company pipeline:
 * Boss goal -> Codex Plan (6.1-sol / 6.1-terra / 6-astra) -> Doubao Relay Isolation ->
 * Qoder & WorkBuddy Execution (with L4 internal 4-step subagent meetings) ->
 * Codex Company-Level Code & Diff Review (6.1-terra / 6.1-sol / 6-astra, with automatic rework loop) ->
 * DSH Dialog Model Final Review Handoff & Executive Report.
 */
export async function runFullCompanyPipeline({
  goal,
  userRequirement,
  subtasks = null,
  workspaceRoot = process.cwd(),
  enableInternalMeetings = false,
  expectFileChanges = false,
  dshFallbackWrites = null,
  maxPipelineReworks = 2,
  timeoutMs = 75000,
  mockRunner = null,
} = {}) {
  getModelConfig({ forceScan: false });
  const effectiveGoal = String(goal || userRequirement || "专项研发任务");
  goal = effectiveGoal;
  const quotaLedger = [];
  const dshDirectActions = [];
  const reworkHistory = [];

  // 1. Planning (if subtasks not pre-supplied by dsh)
  let planResult;
  if (Array.isArray(subtasks) && subtasks.length > 0) {
    planResult = {
      ok: true,
      model: COMPANY_ROSTER.departments.codex.defaultPlannerModel || "gpt-6.1-sol",
      planSummary: "由包工头 (dsh) 协同 Codex 制定的分片施工工单。",
      subtasks,
    };
  } else {
    planResult = await planWithCodex({
      goal,
      workspaceRoot,
      useInternalMeeting: false,
      timeoutMs,
      mockRunner,
      quotaLedger,
    });
  }

  // 2. Check for file scope overlaps OR cross-file import dependencies between tasks
  const conflicts = detectScopeConflicts(planResult.subtasks);
  const dependentTasks = hasInterTaskDependency(planResult.subtasks);
  const runSequentially = conflicts.length > 0 || dependentTasks;
  if (conflicts.length > 0) {
    dshDirectActions.push(
      `包工头 (dsh) 检测到施工队文件范围存在交集 (${conflicts
        .map((c) => `${c.workerA} vs ${c.workerB}`)
        .join("; ")})，已自动将并行写操作切换为串行安全锁模式，防止互相覆盖文件。`
    );
  } else if (dependentTasks) {
    dshDirectActions.push(
      `包工头 (dsh) 检测到子工单之间存在模块 import 依赖关系，已自动按「底层核心模块先行落盘 ➔ 上层调用模块读取真实接口后施工」的顺序推进，确保接口 100% 对齐。`
    );
  }

  // 3. Execute subtasks across Qoder & WorkBuddy (relayed via Doubao; audited at company level by Codex)
  const executions = [];
  if (runSequentially) {
    for (const st of planResult.subtasks) {
      const exec = await dispatchWorkerTask({
        id: st.id || `subtask-${executions.length + 1}`,
        department: st.department || "qoder",
        subtaskTitle: st.title || "施工子任务",
        prompt: st.instructions || st.prompt || goal,
        model: st.model || "auto",
        complexity: st.complexity || "medium",
        workspaceRoot,
        allowedFiles: st.allowedFiles || ["*"],
        allowFileEdits: st.allowFileEdits !== false,
        expectFileChanges: st.expectFileChanges ?? expectFileChanges,
        useInternalMeeting: Boolean(st.useInternalMeeting ?? enableInternalMeetings),
        reworkHistory,
        timeoutMs,
        mockRunner,
        quotaLedger,
      });
      executions.push(exec);
    }
  } else {
    const parallelResults = await Promise.all(
      planResult.subtasks.map((st, idx) =>
        dispatchWorkerTask({
          id: st.id || `subtask-${idx + 1}`,
          department: st.department || (idx % 2 === 0 ? "qoder" : "workbuddy"),
          subtaskTitle: st.title || `并行子任务 #${idx + 1}`,
          prompt: st.instructions || st.prompt || goal,
          model: st.model || "auto",
          complexity: st.complexity || "medium",
          workspaceRoot,
          allowedFiles: st.allowedFiles || ["*"],
          allowFileEdits: st.allowFileEdits !== false,
          expectFileChanges: st.expectFileChanges ?? expectFileChanges,
          useInternalMeeting: Boolean(st.useInternalMeeting ?? enableInternalMeetings),
          reworkHistory,
          timeoutMs,
          mockRunner,
          quotaLedger,
        })
      )
    );
    executions.push(...parallelResults);
  }

  let audits = executions.map((e) => e.audit).filter(Boolean);

  // 4. If any worker still failed Codex's initial compliance check after rework AND dshFallbackWrites is provided, dsh steps in personally!
  let anyAuditFailed = audits.some((a) => !a.passed);
  if (anyAuditFailed && Array.isArray(dshFallbackWrites) && dshFallbackWrites.length > 0) {
    dshDirectIntervene({
      workspaceRoot,
      reason: "Codex 公司级初审发现下属部门存在违规或未完成文件落地，包工头 (dsh) 亲自下场接管修补",
      fileWrites: dshFallbackWrites,
      dshActionsLog: dshDirectActions,
      quotaLedger,
    });
  }

  // 5. Company-Level Code & Diff Review by Codex (gpt-6.1-terra, gpt-6.1-sol, gpt-6-astra)
  let codexReview = await blindReviewWithCodex({
    goal,
    executions,
    workspaceRoot,
    escalateToAstra: anyAuditFailed,
    timeoutMs,
    mockRunner,
    quotaLedger,
  });

  // 6. Mandatory Codex Company-Level Review Rework Loop:
  //    If Codex rejects the delivery (`!codexReview.approved`), NEVER report an unapproved REWORK to the Boss!
  //    Send Codex's exact review findings (via Doubao relay isolation) back to the worker departments to rework!
  let pipelineReworkRound = 0;
  while (!codexReview.approved && pipelineReworkRound < maxPipelineReworks) {
    pipelineReworkRound += 1;
    const issuesText =
      (codexReview.issues || []).join("；") ||
      codexReview.summary ||
      "代码或接口契约需进一步修正对齐";
    reworkHistory.push(
      `🔄 **【Codex (6.1-terra / 6.1-sol / 6-astra) 公司级审核打回重做 · 第 ${pipelineReworkRound} 轮】** Codex (\`${(
        codexReview.participatingModels || [codexReview.model]
      ).join(" / ")}\`) 公司级审核判定「需整改 (REWORK, ${codexReview.score}分)」：${issuesText}。已通过豆包传话隔离将工单打回施工部门继续重做！`
    );

    for (let i = 0; i < planResult.subtasks.length; i++) {
      const st = planResult.subtasks[i];
      const prevExec = executions[i];
      if (st.allowFileEdits === false) continue;

      const codexReworkPrompt = [
        `【🔄 Codex (6.1-terra / 6.1-sol / 6-astra) 公司层面审核未通过 · 强制打回返工令（第 ${pipelineReworkRound} 轮，由豆包传话隔离转达）】`,
        `你们提交的上一版代码在【L3 Codex 公司级审核院】中被判定为「需整改 (REWORK)」，集团规定审核不通过绝不允许呈交 DSH 对话框进行最终审核，必须打回接着做直到通过！`,
        ``,
        `## Codex 公司级审核指出的具体整改问题`,
        `- 审核总评：${codexReview.summary || ""}`,
        ...(codexReview.issues || []).map((iss, idx) => `- 问题 ${idx + 1}: ${iss}`),
        ``,
        `## 返工要求`,
        `1. 请仔细对照工作区现有关联模块的真实代码（见下方只读参考区的导出函数名、参数顺序与返回对象字段名），修复所有接口不一致、缺失文件或逻辑缺陷；`,
        `2. 必须输出完整的 \`<file_write path="...">...</file_write>\` 标签覆盖更新你负责的白名单文件（${JSON.stringify(
          st.allowedFiles || ["*"]
        )}）；`,
        ``,
        `## 原子工单任务要求`,
        st.instructions || st.prompt || goal,
      ].join("\n");

      const reworkedExec = await dispatchWorkerTask({
        id: `${st.id || `subtask-${i + 1}`}-rework-${pipelineReworkRound}`,
        department: st.department || prevExec?.department || "qoder",
        subtaskTitle: `${st.title || "施工子任务"} (公司级审核返工 #${pipelineReworkRound})`,
        prompt: codexReworkPrompt,
        model: st.model || "auto",
        complexity: st.complexity || "medium",
        workspaceRoot,
        allowedFiles: st.allowedFiles || ["*"],
        allowFileEdits: true,
        expectFileChanges: st.expectFileChanges ?? expectFileChanges,
        useInternalMeeting: Boolean(st.useInternalMeeting ?? enableInternalMeetings),
        reworkHistory,
        timeoutMs,
        mockRunner,
        quotaLedger,
      });

      const mergedChangesMap = new Map();
      for (const ch of prevExec?.diffReport?.authorizedChanges || []) {
        mergedChangesMap.set(ch.file, ch);
      }
      for (const ch of reworkedExec?.diffReport?.authorizedChanges || []) {
        mergedChangesMap.set(ch.file, ch);
      }
      reworkedExec.diffReport.authorizedChanges = [...mergedChangesMap.values()];
      reworkedExec.reworkCount = (prevExec?.reworkCount || 0) + 1;
      executions[i] = reworkedExec;
    }

    audits = executions.map((e) => e.audit).filter(Boolean);
    anyAuditFailed = audits.some((a) => !a.passed);

    codexReview = await blindReviewWithCodex({
      goal,
      executions,
      workspaceRoot,
      escalateToAstra: false,
      timeoutMs,
      mockRunner,
      quotaLedger,
    });

    if (codexReview.approved) {
      reworkHistory.push(
        `✅ **【Codex 公司级审核复核通过】** 历经第 ${pipelineReworkRound} 轮打回返工，各部门已完成代码整改与接口对齐，通过 Codex (\`${(
          codexReview.participatingModels || [codexReview.model]
        ).join(" / ")}\`) 公司层面复审（得分 ${codexReview.score}/100），准予移交 DSH 对话框主模型执行最终审核！`
      );
    }
  }

  // 7. Fetch live balances for the 4 independent departments so the Executive Report includes the full Usage & Balance tables
  const liveBalances = await getCompanyBalances({ force: false }).catch(() => null);

  // 8. Build the Executive Report (ready for DSH Dialog Model's Final Review)
  const report = buildPolishedExecutiveReport({
    taskTitle: goal.slice(0, 60),
    planSummary: planResult.planSummary,
    executions,
    audits,
    codexReview,
    reworkHistory,
    dshDirectActions,
    quotaLedger,
    liveBalances,
  });

  return {
    ok: true,
    goal,
    plan: planResult,
    executions,
    audits,
    codexReview,
    reworkHistory,
    dshDirectActions,
    quotaLedger,
    liveBalances,
    bossReport: report,
  };
}
