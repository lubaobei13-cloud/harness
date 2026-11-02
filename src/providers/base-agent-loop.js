import fs from "node:fs";
import path from "node:path";
import {
  isFileAllowed,
  resolveTargetWithExistingParent,
} from "../security/file-scope-guard.js";

const MAX_SNAPSHOT_BACKUP_BYTES = 8 * 1024 * 1024;

function isProbablyBinary(buf) {
  const checkLen = Math.min(buf.length, 512);
  for (let i = 0; i < checkLen; i++) {
    if (buf[i] === 0) return true;
  }
  return false;
}

/**
 * Build workspace context for a worker agent so it can inspect existing files
 * within its assigned scope before making edits.
 */
export function buildWorkspaceContextPrompt(workspaceRoot, allowedFiles = ["*"], maxFiles = 12) {
  const rootResolved = safeRealpath(path.resolve(workspaceRoot));
  const existingFiles = [];

  function walk(dir) {
    if (existingFiles.length >= 60) return;
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if ([".git", "node_modules", ".dsh-company-sandboxes"].includes(entry.name)) continue;
      const full = path.join(dir, entry.name);
      const rel = path.relative(rootResolved, full).replace(/\\/g, "/");
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile()) {
        existingFiles.push(rel);
      }
    }
  }

  walk(rootResolved);

  const scopedFiles = existingFiles.filter((rel) => isFileAllowed(rootResolved, rel, allowedFiles));
  const readOnlyPeers = existingFiles.filter(
    (rel) => !isFileAllowed(rootResolved, rel, allowedFiles) && !rel.startsWith(".")
  );
  const snippets = [];
  const peerSnippets = [];

  for (const rel of scopedFiles.slice(0, maxFiles)) {
    try {
      const full = path.join(rootResolved, rel);
      const stat = fs.statSync(full);
      if (stat.size <= 32 * 1024) {
        const buf = fs.readFileSync(full);
        if (!isProbablyBinary(buf)) {
          const text = buf.toString("utf8");
          snippets.push(`### File: ${rel}\n\`\`\`\n${text}\n\`\`\``);
        }
      }
    } catch {
      // ignore
    }
  }

  for (const rel of readOnlyPeers.slice(0, 6)) {
    try {
      const full = path.join(rootResolved, rel);
      const stat = fs.statSync(full);
      if (stat.size <= 16 * 1024) {
        const buf = fs.readFileSync(full);
        if (!isProbablyBinary(buf)) {
          const text = buf.toString("utf8");
          peerSnippets.push(`### Read-Only Peer File (仅供接口参考，严禁修改): ${rel}\n\`\`\`\n${text}\n\`\`\``);
        }
      }
    } catch {
      // ignore
    }
  }

  return [
    `## 当前工作区环境`,
    `- 工作区根目录: ${rootResolved}`,
    `- 本部门允许修改的文件范围 (allowedFiles): ${JSON.stringify(allowedFiles)}`,
    `- 工作区现有文件列表: ${existingFiles.length > 0 ? existingFiles.join(", ") : "(空目录)"}`,
    snippets.length > 0 ? `\n## 授权范围内现有文件内容\n${snippets.join("\n\n")}` : "",
    peerSnippets.length > 0 ? `\n## 工作区其他模块只读参考（严禁修改，仅供 import 与接口字段对齐）\n${peerSnippets.join("\n\n")}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function safeRealpath(p) {
  try {
    return fs.realpathSync(p);
  } catch {
    return path.resolve(p);
  }
}

/**
 * System instruction appended when a worker agent (Qoder / WorkBuddy / etc.) is asked to modify files.
 */
export function getFileEditProtocolInstruction(allowedFiles = ["*"]) {
  return [
    `## 文件修改协议 (File Modification Protocol)`,
    `你被授权直接修改本工作区内的文件，但**只能**修改匹配以下白名单的路径：${JSON.stringify(allowedFiles)}。`,
    `绝不允许修改白名单以外的文件，也绝不允许在输出中与其它智能体串联或用 TODO 糊弄。`,
    `当你需要创建或修改文件时，请在回复中使用以下 XML 标签格式输出完整文件内容（可输出多个文件）：`,
    ``,
    `<file_write path="相对路径/文件名.ext">`,
    `文件的完整代码内容...`,
    `</file_write>`,
    ``,
    `或者使用局部替换标签：`,
    `<file_edit path="相对路径/文件名.ext">`,
    `<target>原文件中的精确片段</target>`,
    `<replacement>替换后的新片段</replacement>`,
    `</file_edit>`,
  ].join("\n");
}

/**
 * Parse and execute <file_write> or <file_edit> from an LLM response.
 * Note: We write to disk so that `enforceScopeAndDiff` can both record authorized changes
 * and catch/revert any unauthorized out-of-scope file attempts for Doubao's audit!
 */
export function applyStructuredFileOperations(workspaceRoot, responseText, allowedFiles = ["*"]) {
  const rootResolved = safeRealpath(path.resolve(workspaceRoot));
  const text = String(responseText || "");
  const applied = [];
  const rejected = [];

  // 1. Parse <file_write path="...">...</file_write>
  const writeRegex = /<file_write\s+path=["']([^"']+)["']\s*>\r?\n?([\s\S]*?)\r?\n?<\/file_write>/gi;
  let match;
  while ((match = writeRegex.exec(text)) !== null) {
    const relPath = match[1].trim().replace(/^\.\//, "");
    const content = stripOptionalCodeFence(match[2]);
    writeToWorkspace(rootResolved, relPath, content, allowedFiles, applied, rejected);
  }

  // 2. Parse <file_edit path="..."><target>...</target><replacement>...</replacement></file_edit>
  const editRegex =
    /<file_edit\s+path=["']([^"']+)["']\s*>[\s\S]*?<target>\r?\n?([\s\S]*?)\r?\n?<\/target>[\s\S]*?<replacement>\r?\n?([\s\S]*?)\r?\n?<\/replacement>[\s\S]*?<\/file_edit>/gi;
  while ((match = editRegex.exec(text)) !== null) {
    const relPath = match[1].trim().replace(/^\.\//, "");
    const target = match[2];
    const replacement = match[3];
    const absPath = resolveTargetWithExistingParent(path.resolve(rootResolved, relPath));
    const relNormalized = path.relative(rootResolved, absPath).replace(/\\/g, "/");
    if (!relNormalized || relNormalized === "." || relNormalized.startsWith("..") || path.isAbsolute(relNormalized)) {
      rejected.push({ file: relPath, reason: "PATH_TRAVERSAL_OUTSIDE_WORKSPACE" });
      continue;
    }
    if (fs.existsSync(absPath)) {
      const current = fs.readFileSync(absPath, "utf8");
      if (current.includes(target)) {
        // Use a function replacement so `$` macros ($&, $$, $', $`) in replacement are never expanded!
        const updated = current.replace(target, () => replacement);
        writeToWorkspace(rootResolved, relNormalized, updated, allowedFiles, applied, rejected);
      }
    }
  }

  return { applied, rejected };
}

function writeToWorkspace(rootResolved, relPath, content, allowedFiles, applied, rejected) {
  const absPath = resolveTargetWithExistingParent(path.resolve(rootResolved, relPath));
  const relNormalized = path.relative(rootResolved, absPath).replace(/\\/g, "/");
  if (!relNormalized || relNormalized === "." || relNormalized.startsWith("..") || path.isAbsolute(relNormalized)) {
    rejected.push({ file: relPath, reason: "PATH_TRAVERSAL_OUTSIDE_WORKSPACE" });
    return;
  }

  const allowed = isFileAllowed(rootResolved, relNormalized, allowedFiles);

  // Protect oversized existing files (>8MB) outside allowedFiles from being overwritten on disk
  if (!allowed && fs.existsSync(absPath)) {
    try {
      const st = fs.statSync(absPath);
      if (st.size > MAX_SNAPSHOT_BACKUP_BYTES) {
        rejected.push({ file: relNormalized, reason: "OUTSIDE_ALLOWED_FILE_SCOPE_OVERSIZED_PROTECTED" });
        return;
      }
    } catch {
      // ignore
    }
  }

  // Write the file on disk; if it is outside allowedFiles, `enforceScopeAndDiff`
  // will detect it, revert it to beforeSnapshot, and record the violation for Doubao!
  fs.mkdirSync(path.dirname(absPath), { recursive: true });
  fs.writeFileSync(absPath, content, "utf8");

  if (allowed) {
    applied.push({ file: relNormalized, bytes: Buffer.byteLength(content, "utf8") });
  } else {
    rejected.push({ file: relNormalized, reason: "OUTSIDE_ALLOWED_FILE_SCOPE" });
  }
}

function stripOptionalCodeFence(str) {
  const trimmed = str.trim();
  const fenceMatch = /^```[a-zA-Z0-9_-]*\r?\n([\s\S]*?)\r?\n```$/.exec(trimmed);
  return fenceMatch ? fenceMatch[1] : str;
}
