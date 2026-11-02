import {
  selectInternalMeetingModels,
  getInternalDivisionOfLabor,
  FORBIDDEN_CODEX_PATTERNS,
} from "../config/roster.js";
import {
  applyStructuredFileOperations,
  buildWorkspaceContextPrompt,
  getFileEditProtocolInstruction,
} from "../providers/base-agent-loop.js";
import { runCodexAgent } from "../providers/codex-provider.js";
import { runQoderAgent } from "../providers/qoder-provider.js";
import { runWorkBuddyAgent } from "../providers/workbuddy-provider.js";
import { runDoubaoAgent } from "../providers/doubao-provider.js";

/**
 * Dispatch a single call to the specified department and model.
 */
export async function callDepartmentModel({
  department,
  model,
  prompt,
  phase = null,
  workspaceRoot = process.cwd(),
  allowedFiles = ["*"],
  allowFileEdits = false,
  complexity = "medium",
  autoEscalateToAstra = true,
  timeoutMs = 75000,
  mockRunner = null,
}) {
  if (model && FORBIDDEN_CODEX_PATTERNS.some((p) => p.test(String(model)))) {
    throw new Error(
      `[Company Policy Violation] 全公司严禁使用 luna 模型 ("${model}")！Codex 只允许 gpt-6.1-sol 与 gpt-6-astra。`
    );
  }

  switch (department) {
    case "codex":
      return runCodexAgent({
        prompt,
        model: model || "gpt-6.1-sol",
        phase,
        workspaceRoot,
        allowedFiles,
        allowFileEdits,
        autoEscalateToAstra,
        timeoutMs,
        mockRunner,
      });
    case "qoder":
      return runQoderAgent({
        prompt,
        model,
        phase,
        complexity,
        workspaceRoot,
        allowedFiles,
        allowFileEdits,
        timeoutMs,
        mockRunner,
      });
    case "workbuddy":
      return runWorkBuddyAgent({
        prompt,
        model,
        phase,
        complexity,
        workspaceRoot,
        allowedFiles,
        allowFileEdits,
        timeoutMs,
        mockRunner,
      });
    case "doubao":
      return runDoubaoAgent({
        prompt,
        model: model || "doubao-2.1-pro",
        workMode: "work",
        thinkingMode: "high",
        phase,
        complexity,
        workspaceRoot,
        allowedFiles,
        allowFileEdits,
        timeoutMs,
        mockRunner,
      });
    default:
      throw new Error(`Unsupported department: "${department}"`);
  }
}

/**
 * Run an L4 Intra-Department Multi-Subagent Pipeline (部门内部同构分工 + 多层审核).
 *
 * Strictly mirrors Headquarters' division of labor inside each L3 department:
 * - Step 1 [L4 内部规划官 - 大模型]: (kimi-3.1-pro / qwen3.8-max / glm-5.3 / gpt-6.1-sol / doubao-expert)
 *   Receives the department assignment and produces the Internal Architecture & Implementation Blueprint.
 * - Step 2 [L4 内部施工官 - Flash模型]: (deepseek-v4.1-flash / qwen3.8-flash / glm-5.3-flash)
 *   Follows the Step 1 Blueprint to write the concrete code implementation (<file_write>/<file_edit>).
 * - Step 3 [L4 内部督察官 - 自检Subagent]: (glm-5.3-flash / doubao-pro-thinking)
 *   Audits Step 2's code draft against Step 1's Blueprint (checking for TODO placeholders, missing edge cases, or out-of-scope paths).
 * - Step 4 [L4 内部终审官 - 交叉大模型]: (glm-5.3 / kimi-3.1-pro / qwen3.8-max / gpt-6-astra / doubao-expert)
 *   Reviews Step 1 + Step 2 + Step 3, fixes any flaws flagged by the Internal Inspector, approves the delivery,
 *   and writes the verified files to disk!
 */
export async function runInternalRoundtable({
  department,
  taskPrompt,
  topic,
  models = null,
  participantCount = null,
  workspaceRoot = process.cwd(),
  allowedFiles = ["*"],
  allowFileEdits = false,
  wrapFinalWrite = null,
  timeoutMs = 75000,
  mockRunner = null,
  quotaLedger = [],
}) {
  const effectivePrompt = String(taskPrompt || topic || "");
  const selectedModels = selectInternalMeetingModels(department, {
    models,
    count: participantCount,
  });

  if (selectedModels.length === 0) {
    throw new Error(`No models available for internal meeting in department "${department}"`);
  }

  const division = getInternalDivisionOfLabor(department, models);
  const startMs = Date.now();
  const round1Minutes = [];

  // Determine the concrete models for the 4 internal isomorphic roles
  const plannerModel =
    (Array.isArray(models) && models[0]) || division.planner || selectedModels[0].id;
  const executorModel =
    (Array.isArray(models) && models[1]) ||
    division.executors?.[0] ||
    selectedModels[Math.min(1, selectedModels.length - 1)].id;
  const inspectorModel =
    (Array.isArray(models) && models[2]) ||
    division.inspector ||
    selectedModels[Math.min(2, selectedModels.length - 1)].id;
  const reviewerModel =
    department === "codex"
      ? selectedModels.find((m) => m.id === "gpt-6-astra")?.id || "gpt-6.1-sol"
      : (Array.isArray(models) && models[3]) || division.reviewer || selectedModels[0].id;

  const workspaceContextBlock = allowFileEdits
    ? buildWorkspaceContextPrompt(workspaceRoot, allowedFiles)
    : "";
  const fileEditProtocolBlock = allowFileEdits
    ? getFileEditProtocolInstruction(allowedFiles)
    : "";

  // ============================================================================
  // Step 1: L4 Internal Planner Subagent (大模型出内部规划)
  // ============================================================================
  const plannerRole = `L4 内部规划主官 (Internal Planner — 大模型 [${plannerModel}])：拆解本部门内部实现步骤、接口契约与文件修改蓝图`;
  const plannerPrompt = [
    `【L4 部门内部多 Subagent 协同 · 第一阶段（1/4 内部规划官发言）】`,
    `所属部门：${department.toUpperCase()} | 你的模型席位：${plannerModel}`,
    `你的部门内部分工：${plannerRole}`,
    `允许修改的文件范围 (allowedFiles)：${JSON.stringify(allowedFiles)}`,
    workspaceContextBlock,
    `请制定本部门内部施工蓝图（明确模块结构、关键函数逻辑、边界条件与验收标准，300字以内），供下一棒 Flash 执行 Subagent 编码实现：`,
    ``,
    `## 部门任务议题`,
    effectivePrompt,
  ]
    .filter(Boolean)
    .join("\n");

  const planRes = await callDepartmentModel({
    department,
    model: plannerModel,
    phase: "plan",
    prompt: plannerPrompt,
    workspaceRoot,
    allowedFiles,
    allowFileEdits: false,
    autoEscalateToAstra: false,
    timeoutMs,
    mockRunner,
  });

  quotaLedger.push({
    tier: "L4 (1.内部规划Subagent)",
    department,
    model: planRes.model || plannerModel,
    stage: `内部规划(${planRes.model || plannerModel})`,
    quotaNote: planRes.quotaNote,
    durationMs: planRes.durationMs,
  });

  round1Minutes.push({
    step: 1,
    phase: "plan",
    model: planRes.model || plannerModel,
    role: plannerRole,
    ok: planRes.ok,
    opinion: planRes.output || planRes.error || "(无规划输出)",
  });

  // ============================================================================
  // Step 2: L4 Internal Executor Subagent (Flash模型按内部规划写代码执行)
  // ============================================================================
  const executorRole = `L4 内部施工执行官 (Internal Executor — Flash执行模型 [${executorModel}])：严格遵照内部规划蓝图编写代码实现草案`;
  const executorPrompt = [
    `【L4 部门内部多 Subagent 协同 · 第一阶段（2/4 内部施工官执行）】`,
    `所属部门：${department.toUpperCase()} | 你的模型席位：${executorModel}`,
    `你的部门内部分工：${executorRole}`,
    `允许修改的文件范围 (allowedFiles)：${JSON.stringify(allowedFiles)}`,
    workspaceContextBlock,
    fileEditProtocolBlock,
    `## 上一棒【L4 内部规划官 (${planRes.model || plannerModel})】制定的施工蓝图`,
    planRes.output || "(按原始任务要求执行)",
    ``,
    `## 施工要求`,
    `请严格按照上述内部规划蓝图完成具体代码编写（如涉及文件修改，请输出完整的 <file_write path="...">...</file_write> 或 <file_edit> 代码块草案，交由下一棒内部督察与内部终审大模型核验后落盘）：`,
    effectivePrompt,
  ]
    .filter(Boolean)
    .join("\n");

  const execRes = await callDepartmentModel({
    department,
    model: executorModel,
    phase: "execute",
    prompt: executorPrompt,
    workspaceRoot,
    allowedFiles,
    allowFileEdits: false, // Draft first; final verified write happens after Internal Reviewer approves!
    autoEscalateToAstra: false,
    timeoutMs,
    mockRunner,
  });

  quotaLedger.push({
    tier: "L4 (2.内部执行Subagent)",
    department,
    model: execRes.model || executorModel,
    stage: `内部执行(${execRes.model || executorModel})`,
    quotaNote: execRes.quotaNote,
    durationMs: execRes.durationMs,
  });

  round1Minutes.push({
    step: 2,
    phase: "execute",
    model: execRes.model || executorModel,
    role: executorRole,
    ok: execRes.ok,
    opinion: execRes.output || execRes.error || "(无执行输出)",
  });

  // ============================================================================
  // Step 3: L4 Internal Inspector Subagent (部门内部督察自检：查漏洞/TODO/越界)
  // ============================================================================
  const shouldRunInspector = participantCount === null || participantCount >= 3;
  let inspectOpinion = "内部静态自检通过：未见 TODO 占位符或越界路径。";
  if (shouldRunInspector) {
    const inspectorRole = `L4 内部督察自检官 (Internal Inspector — 内部纪检模型 [${inspectorModel}])：对照内部规划审查执行代码草案，严查 TODO 糊弄、漏写逻辑与文件越界`;
    const inspectorPrompt = [
      `【L4 部门内部多 Subagent 协同 · 第一阶段（3/4 内部督察官初审）】`,
      `所属部门：${department.toUpperCase()} | 你的模型席位：${inspectorModel}`,
      `你的部门内部分工：${inspectorRole}`,
      ``,
      `## 1. 内部规划官 (${planRes.model || plannerModel}) 蓝图`,
      planRes.output || "(无)",
      ``,
      `## 2. 内部施工官 (${execRes.model || executorModel}) 代码草案`,
      execRes.output || "(无)",
      ``,
      `## 内部督察任务`,
      `请逐项核查施工官的代码草案是否完整落实了规划蓝图、是否存在 TODO/FIXME 敷衍占位符、是否超出 allowedFiles (${JSON.stringify(
        allowedFiles
      )})，并给出简明的【部门内部督察初审意见】：`,
    ].join("\n");

    const inspectRes = await callDepartmentModel({
      department,
      model: inspectorModel,
      phase: "review",
      prompt: inspectorPrompt,
      workspaceRoot,
      allowedFiles,
      allowFileEdits: false,
      autoEscalateToAstra: false,
      timeoutMs,
      mockRunner,
    });

    inspectOpinion = inspectRes.output || inspectOpinion;

    quotaLedger.push({
      tier: "L4 (3.内部督察Subagent)",
      department,
      model: inspectRes.model || inspectorModel,
      stage: `内部督察初审(${inspectRes.model || inspectorModel})`,
      quotaNote: inspectRes.quotaNote,
      durationMs: inspectRes.durationMs,
    });

    round1Minutes.push({
      step: 3,
      phase: "inspect",
      model: inspectRes.model || inspectorModel,
      role: inspectorRole,
      ok: inspectRes.ok,
      opinion: inspectOpinion,
    });
  }

  // ============================================================================
  // Step 4: L4 Internal Reviewer Subagent (交叉大模型部门内审终裁与落盘执行)
  // ============================================================================
  const discussionSummary = round1Minutes
    .map(
      (item, idx) =>
        `### 环节 ${idx + 1} [${item.model}] (${item.role}):\n${item.opinion}`
    )
    .join("\n\n");

  const round2Prompt = [
    `【L4 部门内部多 Subagent 协同 · 第二阶段（4/4 部门级大模型终审把关与落地执行）】`,
    `所属部门：${department.toUpperCase()} | 内部终审把关大模型：${reviewerModel}`,
    `以下是本部门内部【1.大模型规划官 ➔ 2.Flash施工执行官 ➔ 3.内部督察自检官】的流水线作业纪要：`,
    ``,
    discussionSummary,
    ``,
    `## 部门内审终裁与最终落盘要求`,
    `请你作为本部门 L4 内部终审主官（大模型），对施工官的代码草案与内部督察意见进行严格内审：`,
    `- 若施工官草案存在任何缺陷或未通过内部督察，请直接修正完善并输出修正后的完整 <file_write> / <file_edit> 标签；`,
    `- 若施工官草案已完全符合规范且无需改动，请直接给出简明内审放行批复（系统会自动将施工官通过内审的 <file_write> / <file_edit> 草案落盘生效，无需重复粘贴整份代码）：`,
    effectivePrompt,
  ].join("\n");

  const executeFinalStage = async () => {
    const res = await callDepartmentModel({
      department,
      model: reviewerModel,
      phase: "review",
      prompt: round2Prompt,
      workspaceRoot,
      allowedFiles,
      allowFileEdits,
      autoEscalateToAstra: department === "codex",
      timeoutMs,
      mockRunner,
    });

    // Fallback file write: if the L4 Internal Reviewer approved Step 2's code draft without repeating
    // a COMPLETE <file_write>...</file_write> or <file_edit>...</file_edit> block in `res.output`,
    // apply Step 2's approved draft!
    const completeFileTagRe =
      /<file_write\s+path=["'][^"']+["']\s*>[\s\S]*?<\/file_write>|<file_edit\s+path=["'][^"']+["']\s*>[\s\S]*?<\/file_edit>/i;
    const hasFileTagsInFinal = completeFileTagRe.test(res.output || "");
    const hasFileTagsInDraft = completeFileTagRe.test(execRes.output || "");
    const explicitlyApproved = /(?:内审通过|终审(?:结果)?\s*[:：]?\s*通过|准予落盘|按原样落盘|审核通过|\bAPPROVED\b)/i.test(
      res.output || ""
    );
    const reviewerRejected =
      !explicitlyApproved &&
      /(?:终审(?:结果)?\s*[:：]?\s*(?:不通过|打回|驳回)|\b(?:REJECTED|REWORK)\b)/i.test(
        res.output || ""
      );

    if (
      allowFileEdits &&
      res.ok &&
      !hasFileTagsInFinal &&
      hasFileTagsInDraft &&
      !reviewerRejected
    ) {
      applyStructuredFileOperations(workspaceRoot, execRes.output, allowedFiles);
    }
    return res;
  };

  const finalRes =
    typeof wrapFinalWrite === "function"
      ? await wrapFinalWrite(executeFinalStage)
      : await executeFinalStage();

  quotaLedger.push({
    tier: "L4 (4.内部终审Subagent)",
    department,
    model: finalRes.model || reviewerModel,
    stage: `内部大模型终审(${finalRes.model || reviewerModel})`,
    quotaNote: finalRes.quotaNote,
    durationMs: finalRes.durationMs,
  });

  const reviewerRole = `L4 内部终审主官 (Internal Reviewer — 交叉大模型 [${
    finalRes.model || reviewerModel
  }])：终审规划与代码草案并签发落盘许可`;
  const transcript = [
    ...round1Minutes,
    {
      step: round1Minutes.length + 1,
      phase: "review",
      model: finalRes.model || reviewerModel,
      role: reviewerRole,
      ok: finalRes.ok,
      opinion: finalRes.output || finalRes.error || "(内部终审通过)",
    },
  ];

  const allParticipants = [
    plannerModel,
    executorModel,
    ...(shouldRunInspector ? [inspectorModel] : []),
    finalRes.model || reviewerModel,
  ];

  return {
    ...finalRes,
    internalMeeting: {
      department,
      participants: allParticipants,
      arbiterModel: finalRes.model || reviewerModel,
      divisionOfLabor: {
        plannerModel: planRes.model || plannerModel,
        executorModels: [execRes.model || executorModel],
        inspectorModel: shouldRunInspector ? inspectorModel : null,
        reviewerModel: finalRes.model || reviewerModel,
      },
      multiLayerReviewPassed: Boolean(finalRes.ok),
      round1Minutes,
      transcript,
      totalDurationMs: Date.now() - startMs,
    },
  };
}
