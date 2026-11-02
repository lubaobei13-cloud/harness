import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const IGNORED_DIRS = new Set([".git", "node_modules", ".dsh-company-sandboxes"]);

// Convert a glob or prefix pattern (e.g. "src/api/**", "*.js", "src/**/*.{js,ts}", "backend/") into a RegExp.
export function globToRegExp(pattern) {
  const normalized = String(pattern || "")
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\.\//, "");

  if (normalized === "*" || normalized === "**" || normalized === "**/*") {
    return /^.+$/;
  }

  // Directory prefix shorthand: "backend/" -> "backend/**"
  const effective = normalized.endsWith("/") ? `${normalized}**` : normalized;

  let regexStr = "^";
  for (let i = 0; i < effective.length; i++) {
    const ch = effective[i];
    if (ch === "*") {
      if (effective[i + 1] === "*") {
        if (effective[i + 2] === "/") {
          regexStr += "(?:.+/)?";
          i += 2;
        } else {
          regexStr += ".*";
          i += 1;
        }
      } else {
        regexStr += "[^/]*";
      }
    } else if (ch === "?") {
      regexStr += "[^/]";
    } else if (ch === "{") {
      const closeIdx = effective.indexOf("}", i + 1);
      if (closeIdx !== -1) {
        const inner = effective
          .slice(i + 1, closeIdx)
          .split(",")
          .map((part) => part.trim().replace(/[.+^$()|[\]\\]/g, "\\$&"))
          .join("|");
        regexStr += `(?:${inner})`;
        i = closeIdx;
      } else {
        regexStr += "\\{";
      }
    } else if (".+^${}()|[]\\".includes(ch)) {
      regexStr += "\\" + ch;
    } else {
      regexStr += ch;
    }
  }
  regexStr += "$";
  return new RegExp(regexStr);
}

/**
 * Check whether a target path is inside workspaceRoot (including symlink resolution) and matches allowedFiles patterns.
 */
export function isFileAllowed(workspaceRoot, targetPath, allowedFiles = ["*"]) {
  if (typeof targetPath !== "string" || !targetPath.trim()) {
    return false;
  }
  const rootResolved = safeRealpath(path.resolve(workspaceRoot));
  const absTarget = path.resolve(rootResolved, targetPath);

  // Verify symlink safety on closest existing ancestor
  const realTarget = resolveTargetWithExistingParent(absTarget);
  const rel = path.relative(rootResolved, realTarget).replace(/\\/g, "/");
  if (!rel || rel === "." || rel.startsWith("..") || path.isAbsolute(rel)) {
    return false;
  }

  if (!Array.isArray(allowedFiles) || allowedFiles.length === 0) {
    return false;
  }

  return allowedFiles.some((pattern) => {
    const cleanPattern = String(pattern || "").trim().replace(/\\/g, "/").replace(/^\.\//, "");
    if (!cleanPattern) return false;
    if (cleanPattern === rel) return true;
    if (
      !cleanPattern.includes("*") &&
      !cleanPattern.includes("?") &&
      !cleanPattern.includes("{") &&
      rel.startsWith(cleanPattern.replace(/\/$/, "") + "/")
    ) {
      return true;
    }
    return globToRegExp(cleanPattern).test(rel);
  });
}

function safeRealpath(p) {
  try {
    return fs.realpathSync(p);
  } catch {
    return path.resolve(p);
  }
}

export function resolveTargetWithExistingParent(absTarget) {
  let current = path.resolve(absTarget);
  const tailSegments = [];
  while (!fs.existsSync(current)) {
    const parent = path.dirname(current);
    if (parent === current) break;
    tailSegments.unshift(path.basename(current));
    current = parent;
  }
  const realBase = safeRealpath(current);
  return tailSegments.length > 0 ? path.join(realBase, ...tailSegments) : realBase;
}

/**
 * Detect whether two or more parallel worker assignments have overlapping allowedFiles scopes.
 */
export function detectScopeConflicts(assignments = []) {
  const conflicts = [];
  for (let i = 0; i < assignments.length; i++) {
    for (let j = i + 1; j < assignments.length; j++) {
      const a = assignments[i];
      const b = assignments[j];
      const scopeA = a.allowedFiles || [];
      const scopeB = b.allowedFiles || [];
      const overlappingPatterns = [];
      for (const patA of scopeA) {
        for (const patB of scopeB) {
          if (patternsOverlap(patA, patB)) {
            overlappingPatterns.push(patA === patB ? patA : `${patA} <-> ${patB}`);
            conflicts.push({
              workerA: a.department || a.id || `worker_${i}`,
              workerB: b.department || b.id || `worker_${j}`,
              patternA: patA,
              patternB: patB,
              overlappingPatterns: [patA === patB ? patA : `${patA} <-> ${patB}`],
            });
          }
        }
      }
    }
  }
  return conflicts;
}

function patternsOverlap(patA, patB) {
  const a = String(patA || "").replace(/\\/g, "/").replace(/^\.\//, "").trim();
  const b = String(patB || "").replace(/\\/g, "/").replace(/^\.\//, "").trim();
  if (!a || !b) return false;
  if (a === "*" || a === "**" || a === "**/*" || b === "*" || b === "**" || b === "**/*") {
    return true;
  }
  if (a === b) return true;

  const regA = globToRegExp(a);
  const regB = globToRegExp(b);
  if (regA.test(b) || regB.test(a)) {
    return true;
  }

  // Check directory containment when one pattern is a directory prefix or `dir/**`
  const dirPrefixA = extractDirScopePrefix(a);
  const dirPrefixB = extractDirScopePrefix(b);
  if (dirPrefixA !== null && dirPrefixB !== null) {
    if (
      dirPrefixA === "" ||
      dirPrefixB === "" ||
      dirPrefixA === dirPrefixB ||
      dirPrefixA.startsWith(dirPrefixB + "/") ||
      dirPrefixB.startsWith(dirPrefixA + "/")
    ) {
      // If either is a recursive wildcard under that directory, they overlap
      if (a.includes("**") || b.includes("**") || a.endsWith("/") || b.endsWith("/")) {
        return true;
      }
      // Same directory with single-segment wildcards (e.g. "src/foo*.js" vs "src/*bar.js")
      if (dirPrefixA === dirPrefixB && (a.includes("*") || a.includes("?") || a.includes("{")) && (b.includes("*") || b.includes("?") || b.includes("{"))) {
        return true;
      }
    }
  }

  return false;
}

function extractDirScopePrefix(pat) {
  const wildcardIdx = pat.search(/[*?{]/);
  if (wildcardIdx === -1) {
    const slashIdx = pat.lastIndexOf("/");
    return slashIdx === -1 ? "" : pat.slice(0, slashIdx);
  }
  const beforeWildcard = pat.slice(0, wildcardIdx);
  const slashIdx = beforeWildcard.lastIndexOf("/");
  return slashIdx === -1 ? "" : beforeWildcard.slice(0, slashIdx);
}

/**
 * Capture an in-memory snapshot of files and directories in workspaceRoot so we can compute diffs
 * and automatically revert any out-of-scope edits made by a worker.
 */
export function captureWorkspaceSnapshot(workspaceRoot, maxFileBytes = 8 * 1024 * 1024) {
  const rootResolved = safeRealpath(path.resolve(workspaceRoot));
  const files = new Map();
  const dirs = new Set();

  function walk(currentDir) {
    let entries;
    try {
      entries = fs.readdirSync(currentDir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (IGNORED_DIRS.has(entry.name)) continue;
      const fullPath = path.join(currentDir, entry.name);
      const relPath = path.relative(rootResolved, fullPath).replace(/\\/g, "/");
      if (entry.isDirectory()) {
        dirs.add(relPath);
        walk(fullPath);
      } else if (entry.isFile()) {
        try {
          const stat = fs.statSync(fullPath);
          if (stat.size <= maxFileBytes) {
            const content = fs.readFileSync(fullPath);
            const sha256 = crypto.createHash("sha256").update(content).digest("hex");
            files.set(relPath, {
              relPath,
              size: stat.size,
              sha256,
              content,
              oversized: false,
            });
          } else {
            // Still record oversized file metadata so it is NEVER mistaken for a newly created file!
            const fd = fs.openSync(fullPath, "r");
            const headBuf = Buffer.alloc(Math.min(65536, stat.size));
            fs.readSync(fd, headBuf, 0, headBuf.length, 0);
            fs.closeSync(fd);
            const sha256 = crypto
              .createHash("sha256")
              .update(`${stat.size}:${stat.mtimeMs}:`)
              .update(headBuf)
              .digest("hex");
            files.set(relPath, {
              relPath,
              size: stat.size,
              sha256,
              content: null,
              oversized: true,
            });
          }
        } catch {
          // Ignore transient files
        }
      }
    }
  }

  walk(rootResolved);
  return {
    workspaceRoot: rootResolved,
    capturedAt: Date.now(),
    files,
    dirs,
  };
}

/**
 * Compare current workspace state against a beforeSnapshot, automatically roll back any
 * file modifications outside allowedFiles, clean up unauthorized empty directories,
 * and return a structured diff report.
 */
export function enforceScopeAndDiff(workspaceRoot, beforeSnapshot, allowedFiles = ["*"]) {
  const rootResolved = safeRealpath(path.resolve(workspaceRoot));
  const afterSnapshot = captureWorkspaceSnapshot(rootResolved);
  const authorizedChanges = [];
  const unauthorizedChanges = [];
  const revertedFiles = [];
  const beforeDirs = beforeSnapshot.dirs || new Set();

  const allPaths = new Set([
    ...beforeSnapshot.files.keys(),
    ...afterSnapshot.files.keys(),
  ]);

  for (const relPath of [...allPaths].sort()) {
    const before = beforeSnapshot.files.get(relPath);
    const after = afterSnapshot.files.get(relPath);

    let changeType = null;
    if (!before && after) {
      changeType = "created";
    } else if (before && !after) {
      changeType = "deleted";
    } else if (before && after && before.sha256 !== after.sha256) {
      changeType = "modified";
    }

    if (!changeType) continue;

    const allowed = isFileAllowed(rootResolved, relPath, allowedFiles);
    const absPath = path.join(rootResolved, relPath);

    if (!allowed) {
      // Revert unauthorized change immediately!
      let reverted = false;
      try {
        if (changeType === "created") {
          fs.rmSync(absPath, { force: true });
          cleanupUnauthorizedEmptyDirs(rootResolved, path.dirname(absPath), beforeDirs);
          reverted = true;
        } else if ((changeType === "deleted" || changeType === "modified") && before.content) {
          fs.mkdirSync(path.dirname(absPath), { recursive: true });
          fs.writeFileSync(absPath, before.content);
          reverted = true;
        }
      } catch {
        reverted = false;
      }
      if (reverted) {
        revertedFiles.push(relPath);
      }
      unauthorizedChanges.push({
        file: relPath,
        type: changeType,
        reverted,
      });
    } else {
      const beforeText = before?.content ? before.content.toString("utf8") : "";
      const afterText = after?.content ? after.content.toString("utf8") : "";
      authorizedChanges.push({
        file: relPath,
        type: changeType,
        beforeLines: beforeText ? beforeText.split("\n").length : 0,
        afterLines: afterText ? afterText.split("\n").length : 0,
        snippet: buildSimpleDiffSnippet(relPath, beforeText, afterText),
        afterText,
      });
    }
  }

  // Also clean up any empty directories created outside scope even if no files remained inside
  for (const relDir of [...afterSnapshot.dirs].sort((a, b) => b.length - a.length)) {
    if (!beforeDirs.has(relDir) && !isFileAllowed(rootResolved, relDir, allowedFiles)) {
      cleanupUnauthorizedEmptyDirs(rootResolved, path.join(rootResolved, relDir), beforeDirs);
    }
  }

  return {
    passedScopeCheck: unauthorizedChanges.length === 0,
    authorizedChanges,
    unauthorizedChanges,
    revertedFiles,
    hasUnauthorizedAttempts: unauthorizedChanges.length > 0,
  };
}

function cleanupUnauthorizedEmptyDirs(rootResolved, startDir, beforeDirs) {
  let current = path.resolve(startDir);
  while (current !== rootResolved && current.startsWith(rootResolved + path.sep)) {
    const rel = path.relative(rootResolved, current).replace(/\\/g, "/");
    if (beforeDirs.has(rel)) break;
    try {
      const items = fs.readdirSync(current);
      if (items.length === 0) {
        fs.rmdirSync(current);
        current = path.dirname(current);
      } else {
        break;
      }
    } catch {
      break;
    }
  }
}

function buildSimpleDiffSnippet(file, beforeText, afterText, maxLines = 40) {
  const bLines = beforeText ? beforeText.split("\n") : [];
  const aLines = afterText ? afterText.split("\n") : [];
  const out = [`--- a/${file}`, `+++ b/${file}`];

  const maxLen = Math.max(bLines.length, aLines.length);
  let shown = 0;
  for (let i = 0; i < maxLen && shown < maxLines; i++) {
    const b = bLines[i];
    const a = aLines[i];
    if (b === a) continue;
    if (b !== undefined) {
      out.push(`- ${b}`);
      shown++;
    }
    if (a !== undefined && shown < maxLines) {
      out.push(`+ ${a}`);
      shown++;
    }
  }
  return out.join("\n");
}
