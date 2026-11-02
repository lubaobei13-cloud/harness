/**
 * Four-Tier Company Roster & Capability/Phase-Based Model Routing Configuration
 *
 * Hierarchy:
 * - L1: Chairman (User)
 * - L2: General Manager / Foreman & Final Reviewer (dsh Dialog Model — 总包工头 & 最终审核官)
 * - L3: Four Departments:
 *   - codex: 规划院与公司级审核院 (gpt-6.1-terra, gpt-6.1-sol, gpt-6-astra; strictly forbid luna)
 *   - qoder: 工程一部 (主力施工队A，独立计费)
 *   - workbuddy: 工程二部 (主力施工队B，独立计费)
 *   - doubao: 跨部门传话与防勾连隔离处 (仅负责隔离开下属 Agent 防止勾连串联，不参与代码审核)
 * - L4: Intra-Department Multi-Model Subagents (Mirrors Headquarters' Plan -> Execute -> Inspect -> Review division of labor!)
 */

export const FORBIDDEN_CODEX_PATTERNS = [/luna/i];

export const COMPANY_ROSTER = {
  foreman: {
    id: "dsh",
    name: "DSH (总包工头 / 对话框最终审核官)",
    tier: "L2",
    role: "总调度、跨部门物理隔离督办、接收 Codex 公司级审核结果并在 DSH 对话框内执行最终审核 (Final Review)、疑难兜底亲自下场、最终向董事长汇报",
  },
  departments: {
    codex: {
      id: "codex",
      name: "Codex (规划与公司级审核院 / 总工办)",
      tier: "L3",
      independentBilling: true,
      billingChannel: "codex-wham",
      quotaProfile: "low-precious", // 能力极强，额度精贵，独立从 ChatGPT 后端获取额度
      defaultModel: "gpt-6.1-sol",
      defaultPlannerModel: "gpt-6.1-sol",
      defaultExecutorModel: "gpt-6.1-terra",
      defaultReviewerModel: "gpt-6.1-terra",
      escalationModel: "gpt-6-astra",
      plannerModels: ["gpt-6.1-sol", "gpt-6.1-terra", "gpt-6-astra"],
      executorModels: ["gpt-6.1-terra", "gpt-6.1-sol", "gpt-6-astra"],
      reviewerModels: ["gpt-6.1-terra", "gpt-6.1-sol", "gpt-6-astra"],
      forbiddenModels: ["gpt-6-luna", "gpt-5.6-luna", "luna"],
      responsibilities: [
        "总部顶层架构规划与子任务拆解（划分文件修改白名单 allowedFiles）",
        "公司层面的代码与 Diff 审核（由 gpt-6.1-terra、gpt-6.1-sol、gpt-6-astra 共同把关，审核不通过强制打回施工队重做）",
        "核心技术难题攻关（使用 gpt-6.1-terra / gpt-6.1-sol，疑难问题召唤 gpt-6-astra，全链路严禁使用 luna）",
      ],
      models: [
        {
          id: "gpt-6.1-terra",
          name: "GPT-6.1-Terra (公司级主力代码审核与规划主官)",
          tier: "S",
          roleType: "planner-reviewer",
          capability: 98,
          costWeight: 7,
          strengths: ["company-review", "code-audit", "planning", "architecture", "debugging"],
          defaultEffort: "medium",
          roleInMeeting: "reviewer",
        },
        {
          id: "gpt-6.1-sol",
          name: "GPT-6.1-Sol (默认主力架构规划与联合审核主官)",
          tier: "S",
          roleType: "planner-reviewer",
          capability: 98,
          costWeight: 8,
          strengths: ["planning", "architecture", "review", "complex-coding", "debugging"],
          defaultEffort: "medium",
          roleInMeeting: "planner",
        },
        {
          id: "gpt-6-astra",
          name: "GPT-6-Astra (终极核武 / 公司级疑难终裁官)",
          tier: "S+",
          roleType: "escalation-arbiter",
          capability: 100,
          costWeight: 10,
          strengths: ["escalation", "deep-reasoning", "hard-bugs", "architecture-arbitration"],
          defaultEffort: "high",
          roleInMeeting: "reviewer",
        },
      ],
    },

    qoder: {
      id: "qoder",
      name: "Qoder (工程一部 / 主力施工队A)",
      tier: "L3",
      independentBilling: true,
      billingChannel: "qoder-cn",
      quotaProfile: "medium-balanced", // 独立计费（与 WorkBuddy 额度完全隔离），内部大模型做规划审核、Flash做执行
      defaultModel: "qwen3.8-max",
      defaultPlannerModel: "qwen3.8-max",
      defaultExecutorModel: "qwen3.8-flash",
      defaultReviewerModel: "glm-5.3",
      escalationModel: "kimi-3.1-pro",
      plannerModels: ["qwen3.8-max", "kimi-3.1-pro", "glm-5.3"],
      executorModels: ["qwen3.8-flash", "deepseek-v4.1-flash", "glm-5.3-flash"],
      reviewerModels: ["glm-5.3", "kimi-3.1-pro", "qwen3.8-max"],
      responsibilities: [
        "根据工单直接修改本地工作区文件（受 allowedFiles 围挡约束）",
        "部门内部实行四步同构分工：大模型 (qwen3.8-max / kimi-3.1-pro / glm-5.3) 负责内部规划与内审把关",
        "Flash 模型 (qwen3.8-flash / deepseek-v4.1-flash / glm-5.3-flash) 负责高性价比代码执行落地",
      ],
      models: [
        {
          id: "qwen3.8-max",
          name: "Qwen3.8 Max (Qoder 内部规划与架构大模型)",
          tier: "A+",
          roleType: "planner",
          capability: 92,
          costWeight: 4,
          strengths: ["planning", "architecture", "review", "complex-coding"],
          roleInMeeting: "planner",
        },
        {
          id: "kimi-3.1-pro",
          name: "Kimi 3.1 Pro (Qoder 内部联合规划与终审大模型)",
          tier: "A+",
          roleType: "planner",
          capability: 93,
          costWeight: 4,
          strengths: ["planning", "long-context", "review", "architecture"],
          roleInMeeting: "reviewer",
        },
        {
          id: "glm-5.3",
          name: "GLM-5.3 (Qoder 内部审核与架构大模型)",
          tier: "A+",
          roleType: "reviewer",
          capability: 90,
          costWeight: 3,
          strengths: ["review", "planning", "verification", "architecture"],
          roleInMeeting: "reviewer",
        },
        {
          id: "qwen3.8-flash",
          name: "Qwen3.8 Flash (Qoder 主力高速执行官)",
          tier: "B+",
          roleType: "executor",
          capability: 82,
          costWeight: 1,
          strengths: ["execution", "coding", "fast-edits", "file-implementation"],
          roleInMeeting: "executor",
        },
        {
          id: "deepseek-v4.1-flash",
          name: "DeepSeek V4.1 Flash (Qoder 逻辑代码执行官)",
          tier: "B+",
          roleType: "executor",
          capability: 83,
          costWeight: 1,
          strengths: ["execution", "coding", "algorithms", "fast-edits"],
          roleInMeeting: "executor",
        },
        {
          id: "glm-5.3-flash",
          name: "GLM-5.3 Flash (Qoder 内部自检与快速执行官)",
          tier: "B+",
          roleType: "executor",
          capability: 81,
          costWeight: 1,
          strengths: ["execution", "self-check", "unit-tests", "lint-fix"],
          roleInMeeting: "inspector",
        },
      ],
    },

    workbuddy: {
      id: "workbuddy",
      name: "WorkBuddy (工程二部 / 主力施工队B)",
      tier: "L3",
      independentBilling: true,
      billingChannel: "workbuddy-enterprise",
      quotaProfile: "medium-balanced", // 独立计费（与 Qoder 额度完全隔离），内部大模型做规划审核、Flash做执行
      defaultModel: "kimi-3.1-pro",
      defaultPlannerModel: "kimi-3.1-pro",
      defaultExecutorModel: "deepseek-v4.1-flash",
      defaultReviewerModel: "glm-5.3",
      escalationModel: "qwen3.8-max",
      plannerModels: ["kimi-3.1-pro", "glm-5.3", "qwen3.8-max"],
      executorModels: ["deepseek-v4.1-flash", "glm-5.3-flash", "qwen3.8-flash"],
      reviewerModels: ["glm-5.3", "qwen3.8-max", "kimi-3.1-pro"],
      responsibilities: [
        "与 Qoder 平起平坐，直接修改本地工作区文件（受 allowedFiles 围挡约束）",
        "部门内部同构分工：大模型 (kimi-3.1-pro / glm-5.3 / qwen3.8-max) 负责内部规划与多层内审",
        "Flash 模型 (deepseek-v4.1-flash / glm-5.3-flash / qwen3.8-flash) 负责高效代码编写与改文件执行",
      ],
      models: [
        {
          id: "kimi-3.1-pro",
          name: "Kimi 3.1 Pro (WorkBuddy 首席规划与架构大模型)",
          tier: "A+",
          roleType: "planner",
          capability: 93,
          costWeight: 4,
          strengths: ["planning", "long-context", "architecture", "review"],
          roleInMeeting: "planner",
        },
        {
          id: "glm-5.3",
          name: "GLM-5.3 (WorkBuddy 内部质检与规划大模型)",
          tier: "A+",
          roleType: "reviewer",
          capability: 90,
          costWeight: 3,
          strengths: ["review", "planning", "fullstack", "verification"],
          roleInMeeting: "reviewer",
        },
        {
          id: "qwen3.8-max",
          name: "Qwen3.8 Max (WorkBuddy 联合规划与终审大模型)",
          tier: "A+",
          roleType: "planner",
          capability: 92,
          costWeight: 4,
          strengths: ["planning", "review", "backend", "refactoring"],
          roleInMeeting: "reviewer",
        },
        {
          id: "deepseek-v4.1-flash",
          name: "DeepSeek V4.1 Flash (WorkBuddy 首席高速执行官)",
          tier: "B+",
          roleType: "executor",
          capability: 83,
          costWeight: 1,
          strengths: ["execution", "coding", "fast-edits", "file-implementation"],
          roleInMeeting: "executor",
        },
        {
          id: "glm-5.3-flash",
          name: "GLM-5.3 Flash (WorkBuddy 代码落地与自检执行官)",
          tier: "B+",
          roleType: "executor",
          capability: 81,
          costWeight: 1,
          strengths: ["execution", "frontend", "self-check", "unit-tests"],
          roleInMeeting: "inspector",
        },
        {
          id: "qwen3.8-flash",
          name: "Qwen3.8 Flash (WorkBuddy 敏捷代码执行官)",
          tier: "B+",
          roleType: "executor",
          capability: 82,
          costWeight: 1,
          strengths: ["execution", "scaffolding", "fast-edits"],
          roleInMeeting: "executor",
        },
      ],
    },

    doubao: {
      id: "doubao",
      name: "豆包 Doubao (跨部门传话与防勾连隔离处)",
      tier: "L3",
      independentBilling: true,
      billingChannel: "doubao-work-mode",
      quotaProfile: "high-quota-independent", // 额度较多但绝非无限（按小时动态峰值限流），独立读取真实额度状态
      workMode: "work", // 工作模式 (agent-mode:1, modeId: 3, modeSelectValue: 5)
      workModeLabel: "工作模式",
      thinkingMode: "high", // 思考模式：高 (reasoningEffort: high / level 3)
      thinkingModeLabel: "思考模式：高",
      defaultModel: "doubao-2.1-pro",
      defaultPlannerModel: "doubao-2.1-pro",
      defaultExecutorModel: "doubao-2.1-pro",
      defaultReviewerModel: "doubao-2.1-pro",
      escalationModel: "doubao-2.1-pro",
      plannerModels: ["doubao-2.1-pro"],
      executorModels: ["doubao-2.1-pro"],
      reviewerModels: ["doubao-2.1-pro"],
      responsibilities: [
        "专职担任跨部门传话筒与物理隔离墙：隔离开下属 Agent (Codex / Qoder / WorkBuddy)，防止私下勾连或串联",
        "强制洗稿脱敏：抹除部门身份标记、暗号与求情话术（仅负责传话与防勾连隔离，不参与代码质量审核）",
        "全程启用豆包【工作模式】+【豆包 2.1 Pro (doubao-2.1-pro)】+【思考模式：高】及结项文档排版",
      ],
      models: [
        {
          id: "doubao-2.1-pro",
          name: "豆包 2.1 Pro · 工作模式 · 思考模式：高 (专职传话与防勾连隔离官)",
          tier: "A+",
          roleType: "relay-sanitizer",
          workMode: "work",
          modeId: "3",
          modeSelectValue: "5",
          modelItemKey: "5",
          reasoningEffort: "high",
          capability: 88,
          costWeight: 0.6,
          strengths: [
            "work-mode",
            "deep-thinking-high",
            "anti-collusion",
            "relay-isolation",
            "sanitization",
            "report-polishing",
          ],
          roleInMeeting: "planner",
        },
        {
          id: "doubao-2.1-pro-inspector",
          name: "豆包 2.1 Pro · 工作模式 · 思考模式：高 (跨部门隔离复核官)",
          tier: "A+",
          roleType: "relay-sanitizer",
          workMode: "work",
          modeId: "3",
          modeSelectValue: "5",
          modelItemKey: "5",
          reasoningEffort: "high",
          capability: 88,
          costWeight: 0.6,
          strengths: ["work-mode", "deep-thinking-high", "anti-collusion", "sanitization"],
          roleInMeeting: "reviewer",
        },
      ],
    },
  },
};

export function assertNoForbiddenModel(modelOrList, context = "Company Policy") {
  const list = Array.isArray(modelOrList) ? modelOrList : [modelOrList];
  for (const item of list) {
    if (item && FORBIDDEN_CODEX_PATTERNS.some((pat) => pat.test(String(item)))) {
      throw new Error(
        `[${context} Violation] 公司全链路严禁使用 luna 系列模型 ("${item}")！Codex 请使用 gpt-6.1-terra / gpt-6.1-sol，疑难问题召唤 gpt-6-astra。`
      );
    }
  }
}

/**
 * Dynamically apply user-configured available models from the GUI / Model Scanner
 * onto COMPANY_ROSTER so all routing & meetings use the user's selected models.
 */
export function applyCustomModelConfigToRoster(customConfig) {
  if (!customConfig || typeof customConfig !== "object") return;
  const depts = customConfig.departments || {};

  // 1. Codex
  if (depts.codex) {
    const c = depts.codex;
    const codexDept = COMPANY_ROSTER.departments.codex;
    const safeList = (arr) =>
      (Array.isArray(arr) ? arr : [])
        .map((x) => String(x || "").trim())
        .filter((x) => x && !FORBIDDEN_CODEX_PATTERNS.some((p) => p.test(x)));

    const active = safeList(c.activeModels || c.plannerModels || c.reviewerModels);
    if (active.length > 0) {
      codexDept.plannerModels = [...active];
      codexDept.reviewerModels = [...active];
      codexDept.executorModels = [...active];
      for (const mId of active) {
        if (!codexDept.models.some((m) => m.id === mId)) {
          codexDept.models.push({
            id: mId,
            name: `${mId} (Codex 动态启用模型)`,
            tier: mId.includes("astra") ? "S+" : "S",
            roleType: "planner-reviewer",
            capability: 97,
            costWeight: 8,
            strengths: ["planning", "company-review", "architecture"],
            defaultEffort: "medium",
            roleInMeeting: "reviewer",
          });
        }
      }
    }
    if (c.defaultModel && !FORBIDDEN_CODEX_PATTERNS.some((p) => p.test(c.defaultModel))) {
      codexDept.defaultModel = c.defaultModel;
      codexDept.defaultPlannerModel = c.defaultModel;
    } else if (codexDept.plannerModels.length > 0 && !codexDept.plannerModels.includes(codexDept.defaultModel)) {
      codexDept.defaultModel = codexDept.plannerModels[0];
      codexDept.defaultPlannerModel = codexDept.plannerModels[0];
    }
    if (c.defaultReviewerModel && !FORBIDDEN_CODEX_PATTERNS.some((p) => p.test(c.defaultReviewerModel))) {
      codexDept.defaultReviewerModel = c.defaultReviewerModel;
    } else if (codexDept.reviewerModels.includes("gpt-6.1-terra")) {
      codexDept.defaultReviewerModel = "gpt-6.1-terra";
    }
    if (c.escalationModel && !FORBIDDEN_CODEX_PATTERNS.some((p) => p.test(c.escalationModel))) {
      codexDept.escalationModel = c.escalationModel;
    }
  }

  // 2. Qoder & WorkBuddy
  for (const deptKey of ["qoder", "workbuddy"]) {
    const cfg = depts[deptKey];
    if (!cfg) continue;
    const dept = COMPANY_ROSTER.departments[deptKey];
    const safeList = (arr) =>
      (Array.isArray(arr) ? arr : [])
        .map((x) => String(x || "").trim())
        .filter((x) => x && !FORBIDDEN_CODEX_PATTERNS.some((p) => p.test(x)));

    const planners = safeList(cfg.plannerModels);
    const executors = safeList(cfg.executorModels);
    const reviewers = safeList(cfg.reviewerModels || cfg.plannerModels);

    if (planners.length > 0) {
      dept.plannerModels = planners;
      dept.defaultPlannerModel = cfg.defaultPlannerModel && planners.includes(cfg.defaultPlannerModel)
        ? cfg.defaultPlannerModel
        : planners[0];
      dept.defaultModel = dept.defaultPlannerModel;
    }
    if (reviewers.length > 0) {
      dept.reviewerModels = reviewers;
      dept.defaultReviewerModel = cfg.defaultReviewerModel && reviewers.includes(cfg.defaultReviewerModel)
        ? cfg.defaultReviewerModel
        : reviewers[reviewers.length > 1 ? 1 : 0];
    }
    if (executors.length > 0) {
      dept.executorModels = executors;
      dept.defaultExecutorModel = cfg.defaultExecutorModel && executors.includes(cfg.defaultExecutorModel)
        ? cfg.defaultExecutorModel
        : executors[0];
    }

    // Ensure all configured models exist in dept.models
    for (const mId of [...new Set([...dept.plannerModels, ...dept.reviewerModels])]) {
      if (!dept.models.some((m) => m.id === mId)) {
        dept.models.push({
          id: mId,
          name: `${mId} (${deptKey.toUpperCase()} 规划/内审大模型)`,
          tier: "A+",
          roleType: "planner",
          capability: 91,
          costWeight: 3,
          strengths: ["planning", "review", "architecture"],
          roleInMeeting: "planner",
        });
      }
    }
    for (const mId of dept.executorModels) {
      if (!dept.models.some((m) => m.id === mId)) {
        dept.models.push({
          id: mId,
          name: `${mId} (${deptKey.toUpperCase()} 高速施工模型)`,
          tier: "B+",
          roleType: "executor",
          capability: 82,
          costWeight: 1,
          strengths: ["execution", "coding", "fast-edits"],
          roleInMeeting: "executor",
        });
      }
    }
  }
}

/**
 * Validate and resolve the model for a department according to company rules & task phase.
 *
 * Rules:
 * 1. Codex: Uses `gpt-6.1-terra`, `gpt-6.1-sol`, `gpt-6-astra` (strictly forbid `luna`).
 * 2. Doubao: Work Mode (`work`), Default `doubao-2.1-pro` (豆包 2.1 Pro), Thinking Mode `high` (思考模式：高).
 * 3. Qoder & WorkBuddy (strictly independent billing & execution):
 *    - Planning / Review tasks (`phase: "plan" | "review"`): use large flagship models (`plannerModels` / `reviewerModels`).
 *    - Execution tasks (`phase: "execute"`): use flash execution models (`executorModels`).
 */
export function resolveDepartmentModel(departmentId, requestedModel, options = {}) {
  if (requestedModel && typeof requestedModel === "object") {
    options = requestedModel;
    requestedModel = options.preferredModel || options.model || null;
  }
  const dept = COMPANY_ROSTER.departments[departmentId];
  if (!dept) {
    throw new Error(
      `Unknown department: "${departmentId}". Valid departments: ${Object.keys(COMPANY_ROSTER.departments).join(", ")}`
    );
  }

  // Enforce global anti-luna rule across all departments
  if (requestedModel && FORBIDDEN_CODEX_PATTERNS.some((pat) => pat.test(String(requestedModel)))) {
    if (options.strict !== false) {
      assertNoForbiddenModel(requestedModel, "Company Policy");
    }
    return options.escalate ? dept.escalationModel : dept.defaultModel;
  }

  // 1. Codex model routing (gpt-6.1-terra, gpt-6.1-sol, gpt-6-astra)
  if (departmentId === "codex") {
    if (options.escalate) {
      return dept.escalationModel; // gpt-6-astra
    }
    if (options.phase === "review" || options.phase === "audit") {
      if (requestedModel && requestedModel !== "auto" && requestedModel !== "default") {
        const found = dept.models.find((m) => m.id === requestedModel);
        if (found) return found.id;
      }
      return dept.defaultReviewerModel || dept.reviewerModels[0] || "gpt-6.1-terra";
    }
    if (!requestedModel || requestedModel === "auto" || requestedModel === "default") {
      return dept.defaultModel; // gpt-6.1-sol
    }
    const found = dept.models.find((m) => m.id === requestedModel);
    return found ? found.id : dept.defaultModel;
  }

  // 2. Doubao routing: always use Work Mode + doubao-2.1-pro + High Thinking
  if (departmentId === "doubao") {
    if (requestedModel && requestedModel !== "auto" && requestedModel !== "default") {
      const exact = dept.models.find((m) => m.id === requestedModel);
      if (exact) return exact.id;
    }
    return dept.defaultModel; // doubao-2.1-pro
  }

  // 3. Explicit model requested for Qoder / WorkBuddy
  if (requestedModel && requestedModel !== "auto" && requestedModel !== "default") {
    const exact = dept.models.find((m) => m.id === requestedModel);
    if (exact) return exact.id;
  }

  // 4. Qoder & WorkBuddy phase-aware routing (Plan/Review -> Large Models, Execute -> Flash Models)
  const phase = options.phase || options.taskType || null;
  if (phase === "plan" || phase === "planning") {
    return dept.defaultPlannerModel || dept.plannerModels[0];
  }
  if (phase === "review" || phase === "audit") {
    return dept.defaultReviewerModel || dept.reviewerModels[0];
  }
  if (phase === "execute" || phase === "execution") {
    const idx = Number.isInteger(options.executorIndex) ? options.executorIndex : 0;
    return dept.executorModels[idx % dept.executorModels.length] || dept.defaultExecutorModel;
  }

  if (options.escalate) {
    return dept.escalationModel;
  }

  // Fallback by complexity if phase was not explicitly specified
  const complexity = options.complexity || "medium";
  if (complexity === "high" || complexity === "critical") {
    return dept.defaultPlannerModel; // Large flagship model
  }
  if (complexity === "low") {
    return dept.defaultExecutorModel; // Flash model
  }
  return dept.defaultModel;
}

/**
 * Build the L4 Intra-Department Subagent Pipeline Roster that mirrors Headquarters' division of labor:
 * - Planner Subagent (Large Model)
 * - Executor Subagents (Flash Models)
 * - Inspector Subagent (Internal Self-Check before review)
 * - Reviewer Subagent (Large Model distinct from Planner for cross-review)
 */
export function selectInternalMeetingModels(departmentId, options = {}) {
  const dept = COMPANY_ROSTER.departments[departmentId];
  if (!dept) {
    throw new Error(`Unknown department: "${departmentId}"`);
  }

  if (Array.isArray(options.models) && options.models.length > 0) {
    assertNoForbiddenModel(options.models, "Internal Roundtable Policy");
  }

  if (departmentId === "codex") {
    // Codex internal meeting / review council: gpt-6.1-terra + gpt-6.1-sol + gpt-6-astra
    const codexIds = dept.plannerModels?.length
      ? dept.plannerModels
      : ["gpt-6.1-terra", "gpt-6.1-sol", "gpt-6-astra"];
    const resolved = codexIds
      .map((id) => dept.models.find((m) => m.id === id))
      .filter(Boolean);
    return resolved.length >= 2
      ? resolved
      : [
          dept.models.find((m) => m.id === "gpt-6.1-terra"),
          dept.models.find((m) => m.id === "gpt-6.1-sol"),
          dept.models.find((m) => m.id === "gpt-6-astra"),
        ].filter(Boolean);
  }

  if (departmentId === "doubao") {
    return dept.models.slice(0, 2);
  }

  if (Array.isArray(options.models) && options.models.length > 0) {
    const resolved = options.models
      .map((id) => dept.models.find((m) => m.id === id))
      .filter(Boolean);
    if (resolved.length >= 2) return resolved;
  }

  // For Qoder & WorkBuddy: ensure the internal meeting includes BOTH Large Planner/Reviewer models AND Flash Executor models!
  if (departmentId === "qoder" || departmentId === "workbuddy") {
    const planner = dept.models.find((m) => m.id === dept.defaultPlannerModel) || dept.models[0];
    const executor1 =
      dept.models.find((m) => m.id === dept.executorModels[0]) ||
      dept.models.find((m) => m.roleType === "executor");
    const executor2 =
      dept.models.find((m) => m.id === (dept.executorModels[1] || dept.executorModels[0])) ||
      executor1;
    const reviewer =
      dept.models.find((m) => m.id === dept.defaultReviewerModel) ||
      dept.models.find((m) => m.id !== planner?.id && m.roleType !== "executor") ||
      planner;
    const team = [planner, executor1, executor2, reviewer].filter(Boolean);
    const count = options.count ? Math.min(Math.max(options.count, 2), team.length) : team.length;
    return team.slice(0, count);
  }

  const count = Math.min(Math.max(options.count || 3, 2), dept.models.length);
  return dept.models.slice(0, count);
}

/**
 * Return structured L4 internal division-of-labor assignments mirroring Headquarters:
 * 1. planner (大模型出内部规划)
 * 2. executors (Flash 模型做具体执行)
 * 3. inspector (内部自检督察)
 * 4. reviewer (大模型做内部终审验收)
 */
export function getInternalDivisionOfLabor(departmentId, customModels = null) {
  const dept = COMPANY_ROSTER.departments[departmentId];
  if (!dept) {
    throw new Error(`Unknown department: "${departmentId}"`);
  }
  if (Array.isArray(customModels) && customModels.length > 0) {
    assertNoForbiddenModel(customModels, "Internal Division Policy");
  }

  if (departmentId === "codex") {
    return {
      planner: dept.defaultPlannerModel || "gpt-6.1-sol",
      executors: [dept.defaultReviewerModel || "gpt-6.1-terra", dept.defaultPlannerModel || "gpt-6.1-sol"],
      inspector: dept.defaultReviewerModel || "gpt-6.1-terra",
      reviewer: dept.escalationModel || "gpt-6-astra",
    };
  }

  if (departmentId === "doubao") {
    return {
      mode: "work",
      modeLabel: "工作模式",
      thinkingMode: "high",
      thinkingLabel: "思考模式：高",
      planner: "doubao-2.1-pro",
      executors: ["doubao-2.1-pro"],
      inspector: "doubao-2.1-pro",
      reviewer: "doubao-2.1-pro",
    };
  }

  return {
    independentBilling: true,
    billingChannel: dept.billingChannel,
    planner: dept.defaultPlannerModel,
    coPlanners: dept.plannerModels,
    executors: dept.executorModels.slice(0, 2),
    allExecutors: dept.executorModels,
    inspector: dept.executorModels[dept.executorModels.length - 1] || "glm-5.3-flash",
    reviewer: dept.defaultReviewerModel,
  };
}
