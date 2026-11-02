import {
  getCompanyStatus,
  planWithCodex,
  dispatchWorkerTask,
  blindReviewWithCodex,
  dshDirectIntervene,
  runFullCompanyPipeline,
} from "../orchestrator/company-orchestrator.js";
import { runInternalRoundtable } from "../orchestrator/internal-roundtable.js";
import {
  sanitizeInterAgentMessage,
  auditWorkerDelivery,
  buildPolishedExecutiveReport,
} from "../security/doubao-inspector.js";

export const MCP_TOOLS = [
  {
    name: "company_status",
    description:
      "查询四级智能体公司编制、各部门 (Codex/Qoder/WorkBuddy/豆包) 独立实时额度与在线状态、每日可用模型扫描结果与分工梯队（四大智能体全部独立计费，Qoder与WorkBuddy额度严格隔离不通用；Codex使用 gpt-6.1-terra / gpt-6.1-sol / gpt-6-astra 负责顶层规划与公司层面代码审核，禁用luna；豆包仅负责跨部门传话与防勾连隔离，不参与审核；DSH对话框里的模型负责最终审核）。",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "codex_plan_or_review",
    description:
      "调用 L3 规划与公司级审核院 (Codex: gpt-6.1-terra, gpt-6.1-sol, gpt-6-astra) 进行架构拆解规划 (mode='plan') 或公司层面的代码与 Diff 审核 (mode='review')。严禁使用 luna。",
    inputSchema: {
      type: "object",
      properties: {
        mode: {
          type: "string",
          enum: ["plan", "review"],
          description: "plan: 出规划与划分 allowedFiles; review: 由 6.1-terra/6.1-sol/6-astra 对施工产出做公司层面审核",
        },
        goal: { type: "string", description: "项目目标或验收标准" },
        workspaceRoot: { type: "string", description: "工作区根目录路径" },
        executions: {
          type: "array",
          description: "mode='review' 时可选传入的施工队执行结果列表",
          items: { type: "object" },
        },
        useInternalMeeting: {
          type: "boolean",
          description: "是否开启 Codex 内部 gpt-6.1-terra + gpt-6.1-sol + gpt-6-astra 联合会诊",
        },
        forceEscalateToAstra: {
          type: "boolean",
          description: "是否直接召唤 gpt-6-astra 处理极高难问题",
        },
      },
      required: ["mode", "goal"],
    },
  },
  {
    name: "dispatch_worker",
    description:
      "向施工部门 (qoder 或 workbuddy) 派发工单并允许其在 allowedFiles 白名单范围内直接修改文件。自动经由豆包传话隔离处脱敏防勾连，并由 Codex (gpt-6.1-terra / gpt-6.1-sol / gpt-6-astra) 进行公司层面的代码与 Diff 审核（不通过强制打回重做）。",
    inputSchema: {
      type: "object",
      properties: {
        department: {
          type: "string",
          enum: ["qoder", "workbuddy", "codex", "doubao"],
          description: "目标执行部门",
        },
        subtaskTitle: { type: "string", description: "子任务名称" },
        prompt: { type: "string", description: "具体施工指令" },
        model: {
          type: "string",
          description: "指定模型（留空或 auto 则按任务阶段 phase 与能力自动匹配最优模型）",
        },
        phase: {
          type: "string",
          enum: ["plan", "execute", "review"],
          description: "任务环节：plan/review 使用旗舰大模型，execute 使用高速 Flash 模型",
        },
        complexity: {
          type: "string",
          enum: ["low", "medium", "high"],
          description: "任务难度档位",
        },
        workspaceRoot: { type: "string", description: "工作区目录" },
        allowedFiles: {
          type: "array",
          items: { type: "string" },
          description: "允许该部门修改的文件路径/glob白名单（越界修改会被自动回滚并由 Codex 打回重做）",
        },
        allowFileEdits: { type: "boolean", description: "是否允许直接修改文件" },
        expectFileChanges: { type: "boolean", description: "是否强制要求产生文件改动" },
        useInternalMeeting: {
          type: "boolean",
          description: "是否在该部门内部开启 L4 同构分工多 Subagent 多层审核流水线",
        },
      },
      required: ["department", "prompt"],
    },
  },
  {
    name: "hold_internal_meeting",
    description:
      "在指定部门 (codex / qoder / workbuddy / doubao) 内部开启 L4 多 Subagent 同构分工与多层审核：先由内部规划官(大模型)制定方案、内部执行官(Flash模型)编码、内部自检官核查，再由内部终审主官(大模型)把关拍板并落盘。",
    inputSchema: {
      type: "object",
      properties: {
        department: {
          type: "string",
          enum: ["codex", "qoder", "workbuddy", "doubao"],
        },
        taskPrompt: { type: "string", description: "内部讨论与执行的议题" },
        models: {
          type: "array",
          items: { type: "string" },
          description: "可选：指定参会的多个模型 ID（严禁包含 luna）",
        },
        participantCount: { type: "number", description: "参会模型数量" },
        workspaceRoot: { type: "string" },
        allowedFiles: { type: "array", items: { type: "string" } },
        allowFileEdits: { type: "boolean" },
      },
      required: ["department", "taskPrompt"],
    },
  },
  {
    name: "doubao_inspect_and_sanitize",
    description:
      "调用豆包跨部门传话与防勾连隔离处 (工作模式 · 豆包 2.1 Pro [doubao-2.1-pro] · 思考模式：高) 执行跨部门传话脱敏与防勾连隔离 (action='sanitize') 或结项汇报排版 (action='polish')。注意：豆包只负责传话隔离开下面的 Agent 防止勾连，严禁让豆包做代码审核！",
    inputSchema: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["sanitize", "audit", "polish"],
        },
        message: { type: "string", description: "待传话脱敏或待排版的文本内容" },
        fromDept: { type: "string", description: "来源部门" },
        toDept: { type: "string", description: "目标接收部门" },
        model: { type: "string", description: "默认 doubao-2.1-pro (工作模式 · 思考模式：高)" },
        taskTitle: { type: "string", description: "任务标题（用于 polish 汇报）" },
        diffReport: {
          type: "object",
          description: "文件变更对比报告",
        },
        expectFileChanges: {
          type: "boolean",
          description: "是否强制要求有文件变更",
        },
      },
      required: ["action"],
    },
  },
  {
    name: "dsh_direct_intervene",
    description:
      "L2 总包工头 (dsh) 亲自下场改文件干活并记入集团用工台账（当施工队卡壳或需要总包工头收尾时调用）。",
    inputSchema: {
      type: "object",
      properties: {
        workspaceRoot: { type: "string" },
        reason: { type: "string", description: "包工头亲自下场的原因" },
        fileWrites: {
          type: "array",
          items: {
            type: "object",
            properties: {
              path: { type: "string" },
              content: { type: "string" },
            },
            required: ["path", "content"],
          },
        },
      },
      required: ["reason", "fileWrites"],
    },
  },
  {
    name: "run_company_pipeline",
    description:
      "一键运行四级公司全流程流水线：Codex (6.1-sol/6.1-terra/6-astra) 规划 ➔ 豆包专职传话防勾连隔离 ➔ Qoder & WorkBuddy 分片施工/L4 四步内审 ➔ Codex (6.1-terra/6.1-sol/6-astra) 公司层面代码与 Diff 审核（不通过强制打回重做）➔ 呈交 DSH 对话框里的主模型做最终审核 (Final Review)。",
    inputSchema: {
      type: "object",
      properties: {
        goal: { type: "string", description: "董事长发布的总体任务目标" },
        workspaceRoot: { type: "string", description: "工作区目录" },
        enableInternalMeetings: {
          type: "boolean",
          description: "是否开启各部门 L4 内部多 Subagent 同构分工与多层内审",
        },
        expectFileChanges: { type: "boolean" },
        subtasks: {
          type: "array",
          description: "可选：由包工头预先拆解好的子任务列表",
          items: {
            type: "object",
            properties: {
              id: { type: "string" },
              department: { type: "string" },
              title: { type: "string" },
              complexity: { type: "string" },
              allowedFiles: { type: "array", items: { type: "string" } },
              instructions: { type: "string" },
              useInternalMeeting: { type: "boolean" },
            },
          },
        },
      },
      required: ["goal"],
    },
  },
];

/**
 * Execute an MCP tool call by name (supports both canonical names and `company_*` aliases).
 */
export async function executeMcpToolCall(name, args = {}) {
  switch (name) {
    case "company_status":
      return await getCompanyStatus();

    case "codex_plan_or_review":
    case "company_plan_task":
    case "company_codex_blind_review": {
      const mode =
        name === "company_codex_blind_review"
          ? "review"
          : name === "company_plan_task"
          ? "plan"
          : args.mode || "plan";
      if (mode === "review") {
        return await blindReviewWithCodex({
          goal: args.goal || args.prompt || "代码质量盲审",
          executions: args.executions || [],
          workspaceRoot: args.workspaceRoot || process.cwd(),
          escalateToAstra: Boolean(args.forceEscalateToAstra || args.escalateToAstra),
        });
      }
      return await planWithCodex({
        goal: args.goal || args.prompt || "",
        workspaceRoot: args.workspaceRoot || process.cwd(),
        useInternalMeeting: Boolean(args.useInternalMeeting),
        forceEscalateToAstra: Boolean(args.forceEscalateToAstra),
      });
    }

    case "dispatch_worker":
    case "company_dispatch_worker":
      return await dispatchWorkerTask({
        department: args.department || "qoder",
        subtaskTitle: args.subtaskTitle || args.title || "",
        prompt: args.prompt || args.instructions || "",
        model: args.model || "auto",
        phase: args.phase || null,
        complexity: args.complexity || "medium",
        workspaceRoot: args.workspaceRoot || process.cwd(),
        allowedFiles: args.allowedFiles || ["*"],
        allowFileEdits: args.allowFileEdits !== false,
        expectFileChanges: Boolean(args.expectFileChanges),
        useInternalMeeting: Boolean(args.useInternalMeeting),
      });

    case "hold_internal_meeting":
    case "company_internal_roundtable":
      return await runInternalRoundtable({
        department: args.department || "qoder",
        taskPrompt: args.taskPrompt || args.topic || args.prompt || "",
        models: args.models || null,
        participantCount: args.participantCount || null,
        workspaceRoot: args.workspaceRoot || process.cwd(),
        allowedFiles: args.allowedFiles || ["*"],
        allowFileEdits: Boolean(args.allowFileEdits),
      });

    case "doubao_inspect_and_sanitize":
    case "company_doubao_audit": {
      const action = args.action || (name === "company_doubao_audit" ? "audit" : "sanitize");
      if (action === "sanitize") {
        return sanitizeInterAgentMessage(args.message || "", {
          fromDept: args.fromDept || "worker",
          toDept: args.toDept || "codex",
        });
      }
      if (action === "audit") {
        return auditWorkerDelivery({
          department: args.fromDept || args.department || "qoder",
          model: args.model || "doubao-2.1-pro",
          workerOutput: args.message || args.workerOutput || "",
          diffReport: args.diffReport || { authorizedChanges: [], unauthorizedChanges: [] },
          expectFileChanges: Boolean(args.expectFileChanges),
        });
      }
      return {
        report: buildPolishedExecutiveReport({
          taskTitle: args.taskTitle || "专项任务汇报",
          planSummary: args.message || "",
        }),
      };
    }

    case "dsh_direct_intervene":
    case "company_dsh_direct_intervene":
      return dshDirectIntervene({
        workspaceRoot: args.workspaceRoot || process.cwd(),
        reason: args.reason || "包工头亲自下场兜底",
        fileWrites: args.fileWrites || args.fileOperations || [],
      });

    case "run_company_pipeline":
    case "company_run_full_pipeline":
      return await runFullCompanyPipeline({
        goal: args.goal || args.userRequirement || "",
        subtasks: args.subtasks || null,
        workspaceRoot: args.workspaceRoot || process.cwd(),
        enableInternalMeetings: Boolean(args.enableInternalMeetings),
        expectFileChanges: Boolean(args.expectFileChanges),
      });

    default:
      throw new Error(`Unknown MCP tool: "${name}"`);
  }
}

/**
 * Handle a single JSON-RPC 2.0 request object and return a JSON-RPC 2.0 response object.
 */
export async function handleJsonRpcMessage(msg) {
  if (!msg || typeof msg !== "object") return null;
  const { id, method, params } = msg;

  // Notifications without id require no response
  if (id === undefined && method?.startsWith("notifications/")) {
    return null;
  }

  try {
    if (method === "initialize") {
      return {
        jsonrpc: "2.0",
        id,
        result: {
          protocolVersion: params?.protocolVersion || "2024-11-05",
          capabilities: {
            tools: { listChanged: false },
          },
          serverInfo: {
            name: "dsh-company-multiagent",
            version: "1.0.0",
          },
        },
      };
    }

    if (method === "ping") {
      return { jsonrpc: "2.0", id, result: {} };
    }

    if (method === "tools/list") {
      return {
        jsonrpc: "2.0",
        id,
        result: {
          tools: MCP_TOOLS,
        },
      };
    }

    if (method === "tools/call") {
      const toolName = params?.name;
      const toolArgs = params?.arguments || {};
      const data = await executeMcpToolCall(toolName, toolArgs);
      return {
        jsonrpc: "2.0",
        id,
        result: {
          content: [
            {
              type: "text",
              text: typeof data === "string" ? data : JSON.stringify(data, null, 2),
            },
          ],
          isError: false,
        },
      };
    }

    return {
      jsonrpc: "2.0",
      id,
      error: {
        code: -32601,
        message: `Method not found: ${method}`,
      },
    };
  } catch (err) {
    return {
      jsonrpc: "2.0",
      id,
      result: {
        content: [
          {
            type: "text",
            text: `Error executing ${method}: ${err.message || String(err)}`,
          },
        ],
        isError: true,
      },
    };
  }
}

/**
 * Start the stdio MCP server using raw byte Buffer framing so multi-byte UTF-8 (Chinese characters)
 * in `Content-Length` frames and newline-delimited frames are parsed with 100% byte accuracy.
 */
export function startStdioMcpServer() {
  let rawBuffer = Buffer.alloc(0);
  let processingChain = Promise.resolve();

  const enqueueRequest = (parsed, framingMode) => {
    processingChain = processingChain
      .then(async () => {
        const resp = await handleJsonRpcMessage(parsed);
        if (!resp) return;
        const payload = JSON.stringify(resp);
        if (framingMode === "content-length") {
          const byteLen = Buffer.byteLength(payload, "utf8");
          process.stdout.write(`Content-Length: ${byteLen}\r\n\r\n${payload}`);
        } else {
          process.stdout.write(`${payload}\n`);
        }
      })
      .catch(() => {
        // ignore handler error
      });
  };

  process.stdin.on("data", (chunk) => {
    const bufChunk = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, "utf8");
    rawBuffer = Buffer.concat([rawBuffer, bufChunk]);

    while (rawBuffer.length > 0) {
      // Skip leading CR/LF whitespace between frames if not starting a header or JSON
      let leadingOffset = 0;
      while (
        leadingOffset < rawBuffer.length &&
        (rawBuffer[leadingOffset] === 0x0d || rawBuffer[leadingOffset] === 0x0a)
      ) {
        leadingOffset++;
      }
      if (leadingOffset > 0) {
        rawBuffer = rawBuffer.subarray(leadingOffset);
        if (rawBuffer.length === 0) break;
      }

      const prefixAscii = rawBuffer.subarray(0, Math.min(16, rawBuffer.length)).toString("ascii");
      if (/^Content-Length:/i.test(prefixAscii)) {
        const sepIdx = rawBuffer.indexOf("\r\n\r\n");
        const altSepIdx = sepIdx === -1 ? rawBuffer.indexOf("\n\n") : -1;
        const headerEnd = sepIdx !== -1 ? sepIdx : altSepIdx;
        const sepLen = sepIdx !== -1 ? 4 : 2;
        if (headerEnd === -1) break;

        const headerStr = rawBuffer.subarray(0, headerEnd).toString("ascii");
        const lenMatch = /Content-Length:\s*(\d+)/i.exec(headerStr);
        const contentLen = lenMatch ? Number(lenMatch[1]) : 0;
        const bodyStart = headerEnd + sepLen;
        if (rawBuffer.length < bodyStart + contentLen) break;

        const jsonStr = rawBuffer.subarray(bodyStart, bodyStart + contentLen).toString("utf8");
        rawBuffer = rawBuffer.subarray(bodyStart + contentLen);
        try {
          const parsed = JSON.parse(jsonStr);
          enqueueRequest(parsed, "content-length");
        } catch {
          // ignore malformed JSON
        }
        continue;
      }

      // Line-delimited JSON-RPC
      const nlIdx = rawBuffer.indexOf(0x0a); // '\n'
      if (nlIdx === -1) break;
      const lineStr = rawBuffer.subarray(0, nlIdx).toString("utf8").trim();
      rawBuffer = rawBuffer.subarray(nlIdx + 1);
      if (!lineStr) continue;
      try {
        const parsed = JSON.parse(lineStr);
        enqueueRequest(parsed, "line");
      } catch {
        // ignore malformed line
      }
    }
  });
}
