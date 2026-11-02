import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..");
const PROFILE_DIR = path.join(os.homedir(), ".dsh", "profiles", "desktop");
const TARGET_PKG_DIR = path.join(PROFILE_DIR, "node_modules", "dsh-company-multiagent");

function copyRecursive(src, dest) {
  const stat = fs.statSync(src);
  if (stat.isDirectory()) {
    fs.mkdirSync(dest, { recursive: true });
    for (const entry of fs.readdirSync(src)) {
      if (entry === "node_modules" || entry === ".git" || entry === ".DS_Store") continue;
      copyRecursive(path.join(src, entry), path.join(dest, entry));
    }
  } else {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
  }
}

export function installToDshDesktopProfile() {
  if (!fs.existsSync(PROFILE_DIR)) {
    throw new Error(`DeepSeek Harness desktop profile not found at ${PROFILE_DIR}`);
  }

  // 1. Copy plugin files into ~/.dsh/profiles/desktop/node_modules/dsh-company-multiagent
  if (fs.existsSync(TARGET_PKG_DIR)) {
    fs.rmSync(TARGET_PKG_DIR, { recursive: true, force: true });
  }
  fs.mkdirSync(TARGET_PKG_DIR, { recursive: true });

  for (const item of ["package.json", "cordis.patch.yml", "icon.svg", "lib", "src", "bin"]) {
    const srcPath = path.join(PROJECT_ROOT, item);
    if (fs.existsSync(srcPath)) {
      copyRecursive(srcPath, path.join(TARGET_PKG_DIR, item));
    }
  }

  // 2. Register ONLY `dsh-company-multiagent` in ~/.dsh/profiles/desktop/package.json
  //    and permanently remove any legacy `dsh-company-multiagent-live-*` duplicates
  const profilePkgPath = path.join(PROFILE_DIR, "package.json");
  const profilePkg = JSON.parse(fs.readFileSync(profilePkgPath, "utf8"));

  const nmDir = path.join(PROFILE_DIR, "node_modules");
  for (const entry of fs.readdirSync(nmDir)) {
    if (entry.startsWith("dsh-company-multiagent-live")) {
      fs.rmSync(path.join(nmDir, entry), { recursive: true, force: true });
    }
  }

  profilePkg.dependencies = profilePkg.dependencies || {};
  for (const k of Object.keys(profilePkg.dependencies)) {
    if (k.startsWith("dsh-company-multiagent-live")) {
      delete profilePkg.dependencies[k];
    }
  }
  profilePkg.dependencies["dsh-company-multiagent"] = "1.1.0";

  profilePkg.dsh = profilePkg.dsh || {};
  profilePkg.dsh.profile = profilePkg.dsh.profile || {};
  profilePkg.dsh.profile.bundles = Array.isArray(profilePkg.dsh.profile.bundles)
    ? profilePkg.dsh.profile.bundles.filter(
        (b) => !String(b).startsWith("dsh-company-multiagent-live")
      )
    : [];

  if (!profilePkg.dsh.profile.bundles.includes("dsh-company-multiagent")) {
    profilePkg.dsh.profile.bundles.push("dsh-company-multiagent");
  }

  fs.writeFileSync(profilePkgPath, JSON.stringify(profilePkg, null, 2) + "\n", "utf8");

  // 3. Ensure cordis.patch.yml does NOT contain any legacy `dsh-company-multiagent-live-*` or disable entries
  const userPatchPath = path.join(PROFILE_DIR, "cordis.patch.yml");
  if (fs.existsSync(userPatchPath)) {
    const orig = fs.readFileSync(userPatchPath, "utf8");
    const cleaned = orig
      .replace(/\n- insert:\n\s+- id: dsh-company-[a-z0-9-]+[\s\S]*$/m, "")
      .replace(/\n- id: dsh-company-multiagent-live-[0-9]+\n(?:\s+.*\n?)*/g, "")
      .replace(/\n- id: dsh-company\n\s+disabled: true\n?/g, "")
      .trimEnd();
    if (cleaned !== orig.trimEnd()) {
      fs.writeFileSync(userPatchPath, cleaned + "\n", "utf8");
    }
  }

  return {
    ok: true,
    installedPath: TARGET_PKG_DIR,
    profilePkgPath,
    bundles: profilePkg.dsh.profile.bundles,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const res = installToDshDesktopProfile();
  console.log(JSON.stringify(res, null, 2));
}
