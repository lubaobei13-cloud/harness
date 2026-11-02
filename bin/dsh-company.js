#!/usr/bin/env node
import {
  getCompanyStatus,
  planWithCodex,
  dispatchWorkerTask,
  blindReviewWithCodex,
  dshDirectIntervene,
  runFullCompanyPipeline,
} from "../src/orchestrator/company-orchestrator.js";
import { runInternalRoundtable } from "../src/orchestrator/internal-roundtable.js";
import { sanitizeInterAgentMessage } from "../src/security/doubao-inspector.js";

const VALID_DEPARTMENTS = new Set(["codex", "qoder", "workbuddy", "doubao"]);

function parseArgs(argv) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith("--")) {
      const eqIdx = arg.indexOf("=");
      if (eqIdx !== -1) {
        flags[arg.slice(2, eqIdx)] = arg.slice(eqIdx + 1);
      } else {
        const key = arg.slice(2);
        const next = argv[i + 1];
        if (next !== undefined && !next.startsWith("--")) {
          flags[key] = next;
          i++;
        } else {
          flags[key] = true;
        }
      }
    } else {
      positional.push(arg);
    }
  }
  return { positional, flags };
}

function printHelp() {
  console.log(
    [
      "DSH 四级智能体集团调度中心 CLI (dsh-company)",
      "",
      "用法:",
      "  dsh-company status                                  查看四级公司编制、模型策略与在线状态",
      "  dsh-company plan <goal> [--meeting] [--astra]       调用 Codex (默认 gpt-6.1-sol, 升级 gpt-6-astra) 规划拆单",
      "  dsh-company dispatch --dept <qoder|workbuddy|...> --prompt <text> [--phase <plan|execute|review>] [--model <id>] [--files <glob1,glob2>] [--meeting]",
      "  dsh-company roundtable <dept> <prompt>              在指定部门内开启 L4 多 Subagent 同构分工与多层内审 (等价于 meeting --dept <dept> --prompt <prompt>)",
      "  dsh-company meeting --dept <codex|qoder|workbuddy|doubao> --prompt <text> [--models <m1,m2>]",
      "  dsh-company review <goal> [--astra]                 调用 Codex 对当前施工结果进行盲审验收",
      "  dsh-company intervene --file <path> --content <str> [--reason <text>]  包工头 (dsh) 亲自下场改文件",
      "  dsh-company sanitize --from <dept> --to <dept> --message <text>        调用豆包专家模式洗稿脱敏",
      "  dsh-company pipeline <goal> [--cwd <dir>] [--meeting]                  一键运行完整四级多层审核流水线",
      "",
      "集团核心模型铁律:",
      "  1. Codex: 默认固定使用 gpt-6.1-sol，解决不了召唤 gpt-6-astra，全链路严禁使用 luna。",
      "  2. 豆包 (Doubao): 默认固定使用 doubao-expert (专家模式)，负责防串联脱敏、Diff 监军密折与总结润色。",
      "  3. Qoder & WorkBuddy: 规划/内审使用大模型 (kimi-3.1-pro, glm-5.3, qwen3.8-max)；执行落地使用 Flash 模型 (deepseek-v4.1-flash, glm-5.3-flash, qwen3.8-flash)。",
      "  4. 部门内 L4 Subagent 与总部实行同构分工 (内部规划 ➔ 内部执行 ➔ 内部自检 ➔ 内部终审)，实现多层审核把关。",
    ].join("\n")
  );
}

async function main() {
  const { positional, flags } = parseArgs(process.argv.slice(2));
  const cmd = positional[0] || "help";

  if (cmd === "help" || flags.help) {
    printHelp();
    return;
  }

  if (cmd === "status" || cmd === "roster") {
    const st = await getCompanyStatus();
    console.log(JSON.stringify(st, null, 2));
    return;
  }

  if (cmd === "plan") {
    const goal = positional.slice(1).join(" ") || flags.goal || flags.prompt;
    if (!goal) throw new Error("Missing <goal> for plan command");
    const res = await planWithCodex({
      goal,
      workspaceRoot: flags.cwd || process.cwd(),
      useInternalMeeting: Boolean(flags.meeting),
      forceEscalateToAstra: Boolean(flags.astra),
    });
    console.log(JSON.stringify(res, null, 2));
    return;
  }

  if (cmd === "dispatch") {
    let dept = flags.dept || flags.department;
    let restPositional = positional.slice(1);
    if (!dept && restPositional.length > 0 && VALID_DEPARTMENTS.has(restPositional[0])) {
      dept = restPositional[0];
      restPositional = restPositional.slice(1);
    }
    dept = dept || "qoder";
    const prompt = flags.prompt || restPositional.join(" ");
    if (!prompt) throw new Error("Missing --prompt for dispatch command");
    const allowedFiles = flags.files
      ? String(flags.files)
          .split(",")
          .map((s) => s.trim())
      : ["*"];
    const res = await dispatchWorkerTask({
      department: dept,
      subtaskTitle: flags.title || "",
      prompt,
      model: flags.model || "auto",
      phase: flags.phase || null,
      complexity: flags.complexity || "medium",
      workspaceRoot: flags.cwd || process.cwd(),
      allowedFiles,
      allowFileEdits: flags["no-edit"] ? false : true,
      expectFileChanges: Boolean(flags["expect-changes"]),
      useInternalMeeting: Boolean(flags.meeting),
    });
    console.log(JSON.stringify(res, null, 2));
    return;
  }

  if (cmd === "meeting" || cmd === "roundtable") {
    let dept = flags.dept || flags.department;
    let restPositional = positional.slice(1);
    if (!dept && restPositional.length > 0 && VALID_DEPARTMENTS.has(restPositional[0])) {
      dept = restPositional[0];
      restPositional = restPositional.slice(1);
    }
    dept = dept || "workbuddy";
    const taskPrompt = flags.prompt || restPositional.join(" ");
    if (!taskPrompt) throw new Error("Missing --prompt or <prompt> for meeting/roundtable command");
    const models = flags.models
      ? String(flags.models)
          .split(",")
          .map((s) => s.trim())
      : null;
    const allowedFiles = flags.files
      ? String(flags.files)
          .split(",")
          .map((s) => s.trim())
      : ["*"];
    const res = await runInternalRoundtable({
      department: dept,
      taskPrompt,
      models,
      workspaceRoot: flags.cwd || process.cwd(),
      allowedFiles,
      allowFileEdits: Boolean(flags.edit),
    });
    console.log(JSON.stringify(res, null, 2));
    return;
  }

  if (cmd === "review") {
    const goal = positional.slice(1).join(" ") || flags.goal || flags.prompt || "代码质量盲审";
    const res = await blindReviewWithCodex({
      goal,
      executions: [],
      workspaceRoot: flags.cwd || process.cwd(),
      escalateToAstra: Boolean(flags.astra),
    });
    console.log(JSON.stringify(res, null, 2));
    return;
  }

  if (cmd === "intervene") {
    const filePath = flags.file || flags.path;
    const content = flags.content ?? "";
    const fileWrites = filePath ? [{ path: filePath, content: String(content) }] : [];
    const res = dshDirectIntervene({
      workspaceRoot: flags.cwd || process.cwd(),
      reason: flags.reason || positional.slice(1).join(" ") || "包工头亲自下场兜底修正",
      fileWrites,
    });
    console.log(JSON.stringify(res, null, 2));
    return;
  }

  if (cmd === "sanitize" || cmd === "inspect") {
    const message = flags.message || positional.slice(1).join(" ");
    const res = sanitizeInterAgentMessage(message, {
      fromDept: flags.from || "qoder",
      toDept: flags.to || "codex",
    });
    console.log(JSON.stringify(res, null, 2));
    return;
  }

  if (cmd === "pipeline" || cmd === "run") {
    const goal = positional.slice(1).join(" ") || flags.goal || flags.prompt;
    if (!goal) throw new Error("Missing <goal> for pipeline command");
    const res = await runFullCompanyPipeline({
      goal,
      workspaceRoot: flags.cwd || process.cwd(),
      enableInternalMeetings: Boolean(flags.meeting),
      expectFileChanges: Boolean(flags["expect-changes"]),
    });
    if (flags.json) {
      console.log(JSON.stringify(res, null, 2));
    } else {
      console.log(res.bossReport);
    }
    return;
  }

  throw new Error(`Unknown command: "${cmd}". Run "dsh-company --help" for usage.`);
}

main().catch((err) => {
  console.error(`[dsh-company error] ${err.message}`);
  process.exit(1);
});
