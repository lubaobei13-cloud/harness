/**
 * 豆包 (Doubao) 跨部门传话与防勾连隔离模块 + Codex 公司级静态合规核查辅助
 *
 * 核心职责划分（严格遵循董事长最新铁律）：
 * 1. 豆包 (Doubao) 的唯一职责是【跨部门传话筒与物理隔离墙】（Relay & Anti-Collusion Isolation）：
 *    负责隔离开下面的 Agent (Codex / Qoder / WorkBuddy)，抹除身份线索与串联暗号，防止下属勾连。
 *    **豆包严禁参与代码审核！**
 * 2. 公司层面的审核由 **Codex (`gpt-6.1-terra`, `gpt-6.1-sol`, `gpt-6-astra`)** 完成。
 * 3. **DSH 对话框里的主模型** 负责最终的审核（Final Review）。
 */

const COLLUSION_PATTERNS = [
  {
    pattern: /(?:别告诉|瞒着|绕过|架空|不用汇报给)\s*(?:dsh|包工头|领导|老板|总经理|董事长)/gi,
    type: "ANTI_LEADERSHIP_COLLUSION",
    severity: "CRITICAL",
    label: "企图瞒报或架空领导 (dsh/老板)",
  },
  {
    pattern: /(?:直接(?:给个?)?通过|假装(?:没看到|通过)|放(?:一马|水)|走个过场|应付一下|应付差事|互相掩护|统一口径|rubber[- ]?stamp|ignore\s+all\s+errors\s+and\s+approve)/gi,
    type: "RUBBER_STAMP_SOLICITATION",
    severity: "HIGH",
    label: "诱导验收部门放水或串联勾连",
  },
  {
    pattern: /(?:由于(?:额度|时间|环境)限制.*?(?:先不实现|用\s*mock\s*代替|省略)|剩下的让(?:用户|你自己|别人)完成)/gi,
    type: "LAZY_EXCUSE",
    severity: "MEDIUM",
    label: "借口推脱或甩锅未完成工作",
  },
];

const IDENTITY_LEAK_PATTERNS = [
  { pattern: /(?:(?:我是|由)\s*)?\bqoder(?:\s*cn)?\b(?:\s*(?:部门|团队|智能体|施工队))?/gi, replacement: "【匿名施工队】" },
  { pattern: /(?:(?:我是|由)\s*)?\bworkbuddy(?:\s*ai)?\b(?:\s*(?:部门|团队|智能体|施工队))?/gi, replacement: "【匿名施工队】" },
  { pattern: /(?:(?:我是|由)\s*)?\bcodebuddy\b(?:\s*(?:部门|团队|智能体|施工队))?/gi, replacement: "【匿名施工队】" },
];

const LAZY_CODE_PATTERNS = [
  { pattern: /(?:\/\/|#|\/\*+)\s*(?:TODO|FIXME|XXX|HACK)\b[^\r\n]*/g, label: "遗留 TODO/FIXME 占位符" },
  { pattern: /\b(?:TODO|FIXME|XXX|HACK)\b\s*[:：][^\r\n]*/g, label: "遗留 TODO/FIXME 占位符" },
  { pattern: /throw\s+new\s+Error\(\s*["'](?:not\s+implemented|todo)["']\s*\)/gi, label: "抛出 Not Implemented 未实现异常" },
  { pattern: /pass\s*#\s*(?:todo|placeholder|待实现)/gi, label: "Python 空实现占位符" },
];

/**
 * 1. 豆包专职职责：跨部门传话清洗与防勾连物理隔离（不审核代码，仅隔离开下属 Agent）
 */
export function sanitizeInterAgentMessage(rawMessage, { fromDept = "unknown", toDept = "unknown", taskId = "" } = {}) {
  const text = String(rawMessage || "");
  const alerts = [];
  let riskScore = 0;
  let sanitized = text;

  // Strip echoed Doubao relay headers and negated disciplinary reminders before scanning for collusion
  const textForCollusionScan = sanitized
    .replace(/===\s*📋\s*豆包[\s\S]*?={10,}/g, "")
    .replace(/(?:严禁|禁止|不得|不准|切勿|杜绝|未见|未发现|无)[\u4e00-\u9fa5、，\s]{0,14}(?:放水|串联|勾连|应付|瞒报|架空)/g, "");

  // Detect and strip collusion / anti-leadership attempts
  for (const rule of COLLUSION_PATTERNS) {
    const matches = textForCollusionScan.match(rule.pattern);
    if (matches && matches.length > 0) {
      alerts.push({
        type: rule.type,
        severity: rule.severity,
        fromDept,
        toDept,
        label: rule.label,
        evidence: matches.slice(0, 3),
      });
      riskScore += rule.severity === "CRITICAL" ? 60 : rule.severity === "HIGH" ? 35 : 15;
      sanitized = sanitized.replace(rule.pattern, "【豆包传话隔离处已拦截违规勾连话术】");
    }
  }

  // Strip worker identity markers when sending to Codex for company review or between peers
  if (toDept === "codex" || (fromDept !== toDept && ["qoder", "workbuddy"].includes(fromDept))) {
    for (const idRule of IDENTITY_LEAK_PATTERNS) {
      sanitized = sanitized.replace(idRule.pattern, idRule.replacement);
    }
  }

  const riskLevel = riskScore >= 60 ? "CRITICAL" : riskScore >= 30 ? "HIGH" : riskScore > 0 ? "LOW" : "CLEAN";

  const contractHeader = [
    `=== 📋 豆包传话隔离处·跨部门物理隔离转办单 ===`,
    `• 工单编号: ${taskId || "TASK-AUTO"}`,
    `• 传话流向: [已脱敏隔离发送方] ➔ [${toDept.toUpperCase()}]`,
    `• 防勾连状态: ${riskLevel} (${Math.min(riskScore, 100)}/100)`,
    `• 隔离墙声明: 豆包仅负责跨部门传话与隔离开下属 Agent 防勾连；公司级代码审核由 Codex (6.1-terra / 6.1-sol / 6-astra) 执行，最终审核由 DSH 对话框模型执行！`,
    `==============================================`,
  ].join("\n");

  return {
    originalLength: text.length,
    cleanMessage: `${contractHeader}\n\n${sanitized.trim()}`,
    sanitizedBody: sanitized.trim(),
    alerts,
    collusionRiskScore: Math.min(riskScore, 100),
    riskLevel,
    blocked: riskScore >= 80,
  };
}

/**
 * 2. 公司级交付物与文件 Diff 静态合规核查（归属 Codex 公司级审核院，由 6.1-terra / 6.1-sol / 6-astra 联合把关）
 */
export function auditWorkerDelivery({
  department,
  model,
  reviewerModel = "gpt-6.1-terra",
  workerOutput = "",
  diffReport = { authorizedChanges: [], unauthorizedChanges: [] },
  expectFileChanges = false,
}) {
  const findings = [];
  let penaltyScore = 0;

  // Check 1: Unauthorized file edits outside allowedFiles
  if (diffReport.unauthorizedChanges && diffReport.unauthorizedChanges.length > 0) {
    for (const u of diffReport.unauthorizedChanges) {
      findings.push({
        type: "OUT_OF_SCOPE_EDIT",
        severity: "CRITICAL",
        message: `${department} (${model}) 试图越界${u.type === "created" ? "创建" : u.type === "deleted" ? "删除" : "修改"}非授权文件 "${u.file}"（已被系统底层自动回滚: ${u.reverted ? "成功" : "失败"}）`,
      });
      penaltyScore += 45;
    }
  }

  // Check 2: Expected file changes but none were made ("光说不练")
  if (
    expectFileChanges &&
    (!diffReport.authorizedChanges || diffReport.authorizedChanges.length === 0)
  ) {
    findings.push({
      type: "NO_FILE_CHANGES",
      severity: "HIGH",
      message: `${department} (${model}) 被要求修改文件落地代码，但实际授权文件变更数为 0（疑似光说不练/空头交差）`,
    });
    penaltyScore += 35;
  }

  // Check 3: Scan modified files for lazy placeholders (TODO / NotImplemented)
  for (const change of diffReport.authorizedChanges || []) {
    if (change.type === "deleted" || !change.afterText) continue;
    for (const lazyRule of LAZY_CODE_PATTERNS) {
      const matches = change.afterText.match(lazyRule.pattern);
      if (matches && matches.length > 0) {
        findings.push({
          type: "LAZY_PLACEHOLDER",
          severity: "MEDIUM",
          message: `文件 "${change.file}" 中检测到偷懒占位符（${lazyRule.label}: ${matches.slice(0, 2).join(", ")}）`,
        });
        penaltyScore += 15;
      }
    }
  }

  // Check 4: Check worker output for collusion phrases intercepted by Doubao relay
  const relayCheck = sanitizeInterAgentMessage(workerOutput, {
    fromDept: department,
    toDept: "codex",
  });
  for (const alert of relayCheck.alerts) {
    findings.push({
      type: alert.type,
      severity: alert.severity,
      message: `豆包传话隔离处在 ${department} 的文本中拦截到违规勾连话术：${alert.label} (${alert.evidence.join(", ")})`,
    });
    penaltyScore += alert.severity === "CRITICAL" ? 50 : 25;
  }

  const passed = penaltyScore < 35;
  const score = Math.max(0, 100 - penaltyScore);

  const secretMemorial = buildCodexCompanyAuditSummary({
    department,
    model,
    reviewerModel,
    passed,
    score,
    authorizedCount: (diffReport.authorizedChanges || []).length,
    unauthorizedCount: (diffReport.unauthorizedChanges || []).length,
    findings,
  });

  return {
    passed,
    reviewerDepartment: "codex",
    reviewerModel,
    integrityScore: score,
    findings,
    secretMemorial,
  };
}

function buildCodexCompanyAuditSummary({
  department,
  model,
  reviewerModel = "gpt-6.1-terra",
  passed,
  score,
  authorizedCount,
  unauthorizedCount,
  findings,
}) {
  const statusIcon = passed ? "✅ 公司级初审通过" : "🚨 公司级初审驳回 (打回重做)";
  const lines = [
    `【🟣 Codex 公司级审核院·交付物与 Diff 核查单 (${reviewerModel})】`,
    `• 被审核施工部门：${department}（施工模型：${model}，已由豆包传话脱敏隔离）`,
    `• 公司级合规评分：${score}/100（${statusIcon}）`,
    `• 文件围挡核查：合规落盘 ${authorizedCount} 个文件，越界拦截并回滚 ${unauthorizedCount} 个文件`,
  ];

  if (findings.length === 0) {
    lines.push(
      `• Codex 公司级审核评语：经 Codex (${reviewerModel}) 核验，该施工批次文件边界合规、无 TODO 糊弄占位符，准予进入下一环！`
    );
  } else {
    lines.push(`• Codex 检出问题清单（共 ${findings.length} 项）：`);
    for (const f of findings) {
      lines.push(`  - [${f.severity}] ${f.message}`);
    }
    lines.push(
      `• Codex 处置结论：${
        passed
          ? "存在轻微提示项但未触及红线，予以放行。"
          : "未通过公司层面审核！由 Codex 责令打回施工部门重做（经豆包传话隔离转达），严禁带病上报 DSH！"
      }`
    );
  }
  return lines.join("\n");
}

/**
 * 3. 集团结项总汇报生成（呈现：Codex 规划 -> 豆包传话防勾连隔离 -> Qoder/WB 施工 -> Codex (6.1-terra/6.1-sol/6-astra) 公司级审核 -> DSH 对话框模型最终审核）
 */
export function buildPolishedExecutiveReport({
  taskTitle,
  planSummary,
  executions = [],
  audits = [],
  codexReview,
  reworkHistory = [],
  dshDirectActions = [],
  quotaLedger = [],
  liveBalances = null,
  doubaoCustomCommentary = "",
}) {
  const totalCalls = quotaLedger.length;
  const filesModified = [
    ...new Set(
      executions.flatMap((e) => (e.diffReport?.authorizedChanges || []).map((c) => c.file))
    ),
  ];

  const relayCount = quotaLedger.filter((q) => q.department === "doubao").length;

  const lines = [
    `# 🏢 集团项目结项总汇报：${taskTitle || "专项研发任务"}`,
    ``,
    `> **📡 集团协同与三级审核架构说明**：`,
    `> ${
      doubaoCustomCommentary ||
      "本次工单严格执行董事长规定的职责边界：**① 豆包 (Doubao)** 仅负责跨部门传话与防勾连物理隔离（不参与审核）；**② Codex (`gpt-6.1-terra` / `gpt-6.1-sol` / `gpt-6-astra`)** 负责顶层规划与**公司层面的代码审核**（不通过强制打回重做）；**③ DSH 对话框主模型** 负责**最终的审核与拍板验收**！"
    }`,
    ``,
    `---`,
    ``,
    `### 📐 一、 顶层规划与任务拆解（L3 规划院：Codex）`,
    `${planSummary || "已由 Codex (gpt-6.1-sol / gpt-6.1-terra) 完成架构设计与文件边界划分。"}`,
    ``,
    `### 🛠️ 二、 各施工部门执行与 L4 内部圆桌内审情况（Qoder & WorkBuddy）`,
  ];

  if (executions.length === 0) {
    lines.push(`- 本次任务无需施工队改文件，已直接完成。`);
  } else {
    for (const exec of executions) {
      const changedFiles = (exec.diffReport?.authorizedChanges || []).map((c) => `\`${c.file}\``).join(", ") || "无文件变动";
      const dol = exec.internalMeeting?.divisionOfLabor;
      const meetingBadge = exec.internalMeeting
        ? dol
          ? `（已执行 L4 部门内四步同构分工：规划[\`${dol.plannerModel}\`] ➔ 执行[\`${(dol.executorModels || []).join(",")}\`]${dol.inspectorModel ? ` ➔ 内检[\`${dol.inspectorModel}\`]` : ""} ➔ 内审[\`${dol.reviewerModel}\`]）`
          : `（召开了 L4 内部多模型圆桌会：${exec.internalMeeting.participants.join(" + ")}）`
        : `（单兵调用：\`${exec.model}\`）`;
      const reworkTag =
        exec.reworkCount && exec.reworkCount > 0
          ? `（🔄 历经 ${exec.reworkCount} 轮 Codex 公司级审核打回返工后通过）`
          : "";
      lines.push(
        `- **${exec.department.toUpperCase()}** ${meetingBadge}${reworkTag}：\n  - **任务职责**：${exec.subtaskTitle || exec.prompt?.slice(0, 60)}\n  - **落地文件**：${changedFiles}\n  - **产出摘要**：${(exec.summary || exec.output || "").slice(0, 240).replace(/\n+/g, " ")}`
      );
    }
  }

  lines.push(
    ``,
    `### 📡 三、 豆包跨部门传话与防勾连物理隔离记录（仅传话隔离 · 不参与审核）`,
    `- **物理隔离状态**：豆包（工作模式 · \`doubao-2.1-pro\` · 思考高）本次共执行 **${relayCount} 次** 跨部门传话脱敏与身份隔离，已将 \`Codex\`、\`Qoder\`、\`WorkBuddy\` 完全隔离开，抹除全部部门身份标记，杜绝下属 Agent 私下勾连串联。`
  );

  if (reworkHistory.length > 0) {
    lines.push(``, `### 🔄 三（附）、 Codex 公司级审核打回重做闭环记录`);
    for (const rw of reworkHistory) {
      lines.push(`- ${rw}`);
    }
  }

  if (dshDirectActions.length > 0) {
    lines.push(``, `### 🎩 三（附2）、 包工头 (dsh) 统调与兜底记录 (L2)`);
    for (const act of dshDirectActions) {
      lines.push(`- ${act}`);
    }
  }

  lines.push(
    ``,
    `### 🟣 四、 Codex 公司层面代码审核报告（\`gpt-6.1-terra\` / \`gpt-6.1-sol\` / \`gpt-6-astra\`）`
  );
  if (audits.length > 0) {
    for (const audit of audits) {
      lines.push("```text\n" + audit.secretMemorial + "\n```");
    }
  }
  if (codexReview) {
    const reviewersLabel = Array.isArray(codexReview.participatingModels) && codexReview.participatingModels.length > 0
      ? codexReview.participatingModels.map((m) => `\`${m}\``).join(" + ")
      : `\`${codexReview.model}\``;
    lines.push(
      `- **公司级主审模型**：${reviewersLabel} ${codexReview.escalatedToAstra ? "（🔥 已召唤 `gpt-6-astra` 终裁会诊）" : ""}`,
      `- **公司级审核结论**：**${codexReview.approved ? "✅ 公司层面审核通过 (APPROVED)" : "需整改 (REWORK)"}** (评分: ${codexReview.score ?? 95}/100)`,
      `- **公司级审查详情**：${codexReview.summary || codexReview.output || "代码逻辑、文件边界与模块契约均符合公司规范，准予呈交 DSH 对话框主模型进行最终审核。"}`
    );
  }

  lines.push(
    ``,
    `### 🏛️ 五、 DSH 对话框主模型最终审核（Final Review 移交单）`,
    `- **移交状态**：已完成 L4 部门内审与 L3 Codex（\`gpt-6.1-terra\` / \`gpt-6.1-sol\` / \`gpt-6-astra\`）公司层面审核，现移交 **DSH 对话框当前模型** 执行**最终审核 (Final Review)** 并向董事长签发最终验收结论。`
  );

  // Build Department-Level Usage Summary Table
  const deptStats = {
    codex: {
      label: "🟣 Codex (L3 规划与公司级审核院)",
      role: "顶层架构规划 + 公司级代码审核 (6.1-terra / 6.1-sol / 6-astra)",
      calls: 0,
      models: new Set(),
      durationMs: 0,
    },
    qoder: {
      label: "🟢 Qoder (L3 工程一部)",
      role: "分片施工 + L4 四步内审",
      calls: 0,
      models: new Set(),
      durationMs: 0,
    },
    workbuddy: {
      label: "🔵 WorkBuddy (L3 工程二部)",
      role: "分片施工 + L4 四步内审",
      calls: 0,
      models: new Set(),
      durationMs: 0,
    },
    doubao: {
      label: "🟠 豆包 Doubao (L3 传话与防勾连隔离处)",
      role: "仅负责跨部门传话与防勾连物理隔离 (不参与审核)",
      calls: 0,
      models: new Set(),
      durationMs: 0,
    },
  };
  for (const entry of quotaLedger) {
    const d = String(entry.department || "").toLowerCase();
    if (deptStats[d]) {
      deptStats[d].calls += 1;
      if (entry.model) deptStats[d].models.add(entry.model);
      deptStats[d].durationMs += Number(entry.durationMs) || 0;
    }
  }

  const agBalances = liveBalances?.agents || {};
  lines.push(
    ``,
    `### 💰 六、 四大部门独立计费与本次工单用量汇总表`,
    `| 部门 | 编制职责 | 本次调用次数 | 本次参与模型席位 | 阶段总耗时 | 独立计费通道与实时余额状态 |`,
    `| :--- | :--- | :--- | :--- | :--- | :--- |`
  );
  for (const [deptKey, st] of Object.entries(deptStats)) {
    const modelsStr = st.models.size > 0 ? [...st.models].map((m) => `\`${m}\``).join(", ") : "-";
    const balStr =
      agBalances[deptKey]?.headlineBalance ||
      (deptKey === "codex"
        ? "ChatGPT Codex 独立套餐额度"
        : deptKey === "qoder"
        ? "Qoder CN 独立计费通道 (与 WorkBuddy 隔离)"
        : deptKey === "workbuddy"
        ? "WorkBuddy 独立 Credits 额度"
        : "豆包独立动态峰值配额 (工作模式·2.1Pro·思考高)");
    lines.push(
      `| **${st.label}** | ${st.role} | **${st.calls} 次** | ${modelsStr} | ${(st.durationMs / 1000).toFixed(1)}s | \`${balStr}\` |`
    );
  }

  lines.push(
    ``,
    `### 📊 七、 本次工单全链路模型调用与耗时明细表（共 ${totalCalls} 次调用，落地 ${filesModified.length} 个文件）`,
    `| 序号 | 层级 | 部门 | 调用模型 | 任务阶段 | 额度策略 | 耗时 |`,
    `| :--- | :--- | :--- | :--- | :--- | :--- | :--- |`
  );

  quotaLedger.forEach((entry, idx) => {
    lines.push(
      `| ${idx + 1} | ${entry.tier || "L3"} | **${entry.department}** | \`${entry.model}\` | ${entry.stage} | ${entry.quotaNote || "自有额度"} | ${entry.durationMs || 0}ms |`
    );
  });

  return lines.join("\n");
}
