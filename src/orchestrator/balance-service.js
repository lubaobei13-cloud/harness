import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { COMPANY_ROSTER } from "../config/roster.js";
import { getWorkBuddyStatus } from "../providers/workbuddy-provider.js";
import {
  getQoderStatus,
  inspectQoderLocalTelemetry,
  readIndependentQoderUsage,
} from "../providers/qoder-provider.js";
import {
  getDoubaoStatus,
  inspectDoubaoLocalTelemetry,
  readIndependentDoubaoUsage,
} from "../providers/doubao-provider.js";

const BALANCE_CACHE_TTL_MS = 15_000;
const PROBE_TIMEOUT_MS = 8_000;

let cachedOverview = null;
let cachedAtMs = 0;
let inflightPromise = null;

const DEPTS = COMPANY_ROSTER.departments;

/**
 * Ensure `accept-encoding: identity` so DSH host's undici dispatcher never returns raw compressed bytes.
 */
function withIdentityHeaders(headers = {}) {
  return {
    ...headers,
    "accept-encoding": "identity",
  };
}

/**
 * 1. Probe live Codex (ChatGPT Plus / Pro subscription) quota independently from `~/.codex/auth.json` + `wham/usage`.
 * Strictly reports real upstream values; never guesses a fallback percentage on error.
 */
export async function probeCodexBalance() {
  const dept = DEPTS.codex;
  const authPath = path.join(os.homedir(), ".codex", "auth.json");
  if (!fs.existsSync(authPath)) {
    return {
      department: "codex",
      name: dept.name,
      independentBilling: true,
      billingChannel: "ChatGPT / Codex 独立订阅配额",
      online: false,
      statusText: "未检测到 ~/.codex/auth.json",
      headlineBalance: "未登录",
      remainingPercent: null,
      windows: [],
      defaultModel: dept.defaultModel,
      escalationModel: dept.escalationModel,
      forbiddenModels: dept.forbiddenModels,
      updatedAt: Date.now(),
    };
  }

  let authData = null;
  try {
    authData = JSON.parse(fs.readFileSync(authPath, "utf8"));
  } catch (err) {
    return {
      department: "codex",
      name: dept.name,
      independentBilling: true,
      billingChannel: "ChatGPT / Codex 独立订阅配额",
      online: false,
      statusText: `凭据读取失败: ${err.message}`,
      headlineBalance: "凭据异常",
      remainingPercent: null,
      windows: [],
      defaultModel: dept.defaultModel,
      escalationModel: dept.escalationModel,
      forbiddenModels: dept.forbiddenModels,
      updatedAt: Date.now(),
    };
  }

  const accessToken = authData?.tokens?.access_token;
  const accountId = authData?.tokens?.account_id;

  if (!accessToken) {
    return {
      department: "codex",
      name: dept.name,
      independentBilling: true,
      billingChannel: "ChatGPT / Codex 独立订阅配额",
      online: false,
      statusText: "~/.codex/auth.json 中缺少 access_token",
      headlineBalance: "未授权",
      remainingPercent: null,
      windows: [],
      defaultModel: dept.defaultModel,
      escalationModel: dept.escalationModel,
      forbiddenModels: dept.forbiddenModels,
      updatedAt: Date.now(),
    };
  }

  try {
    const response = await fetch("https://chatgpt.com/backend-api/wham/usage", {
      headers: withIdentityHeaders({
        authorization: `Bearer ${accessToken}`,
        "user-agent": "codex-cli",
        accept: "application/json",
        ...(accountId ? { "chatgpt-account-id": accountId } : {}),
      }),
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });

    if (!response.ok) {
      throw new Error(`wham/usage HTTP ${response.status}`);
    }

    const body = await response.json();
    const primary = body?.rate_limit?.primary_window;
    const secondary = body?.rate_limit?.secondary_window;

    const hasPrimary = typeof primary?.used_percent === "number";
    const used5h = hasPrimary ? Number(primary.used_percent) : null;
    const rem5h =
      used5h !== null ? Math.max(0, Math.min(100, 100 - used5h)) : null;

    const hasSecondary = typeof secondary?.used_percent === "number";
    const usedWeek = hasSecondary ? Number(secondary.used_percent) : null;
    const remWeek =
      usedWeek !== null ? Math.max(0, Math.min(100, 100 - usedWeek)) : null;

    const astraAvailable = body?.model_usage?.["gpt-6-astra"]?.available !== false;
    const planType = String(body?.plan_type || "unknown").toUpperCase();
    const creditsBalance = body?.credits?.balance ?? null;
    const limitReached = Boolean(body?.rate_limit?.limit_reached);

    const windows = [];
    if (hasPrimary) {
      windows.push({
        key: "5h",
        label: "5小时窗口",
        usedPercent: used5h,
        remainingPercent: rem5h,
        resetsAt: primary.reset_at
          ? new Date(primary.reset_at * 1000).toISOString()
          : null,
      });
    }
    if (hasSecondary) {
      windows.push({
        key: "week",
        label: "7天周窗口",
        usedPercent: usedWeek,
        remainingPercent: remWeek,
        resetsAt: secondary.reset_at
          ? new Date(secondary.reset_at * 1000).toISOString()
          : null,
      });
    }

    const headlineParts = [];
    if (rem5h !== null) headlineParts.push(`5h剩余 ${rem5h}%`);
    if (remWeek !== null) headlineParts.push(`周剩余 ${remWeek}%`);

    return {
      department: "codex",
      name: dept.name,
      independentBilling: true,
      billingChannel: `ChatGPT ${planType} 独立配额 (wham/usage)`,
      online: true,
      planType: `ChatGPT ${planType}`,
      accountLabel: accountId
        ? `ChatGPT ${planType} (${accountId.slice(0, 8)}…)`
        : `ChatGPT ${planType}`,
      statusText: `独立从 wham/usage 实时读取 · 套餐: ChatGPT ${planType} · ${
        rem5h !== null ? `5h窗口已用 ${used5h}% (剩余 ${rem5h}%)` : "无5h窗口数据"
      } · ${
        remWeek !== null ? `7天周窗口已用 ${usedWeek}% (剩余 ${remWeek}%)` : "无周窗口数据"
      }${creditsBalance !== null ? ` · Credits: ${creditsBalance}` : ""}`,
      headlineBalance:
        headlineParts.length > 0 ? headlineParts.join(" · ") : `ChatGPT ${planType}`,
      remainingPercent: rem5h,
      weeklyRemainingPercent: remWeek,
      limitReached,
      creditsBalance,
      astraAvailable,
      windows,
      defaultModel: dept.defaultModel,
      escalationModel: dept.escalationModel,
      forbiddenModels: dept.forbiddenModels,
      updatedAt: Date.now(),
    };
  } catch (err) {
    // Strictly never guess a fallback percentage on error
    return {
      department: "codex",
      name: dept.name,
      independentBilling: true,
      billingChannel: "ChatGPT / Codex 独立订阅配额",
      online: false,
      statusText: `wham/usage 远端实时额度查询失败 (${err.message})，拒绝猜测额度百分比`,
      headlineBalance: "实时查询失败",
      remainingPercent: null,
      windows: [],
      defaultModel: dept.defaultModel,
      escalationModel: dept.escalationModel,
      forbiddenModels: dept.forbiddenModels,
      updatedAt: Date.now(),
    };
  }
}

/**
 * 2. Probe live WorkBuddy remaining credits and package details independently via `dsh-workbuddy-connect`.
 * Strictly isolated from Qoder.
 */
export async function probeWorkBuddyBalance() {
  const dept = DEPTS.workbuddy;
  const wbPluginDir = path.join(
    os.homedir(),
    ".dsh/profiles/desktop/node_modules/dsh-workbuddy-connect/lib"
  );
  const indexPath = path.join(wbPluginDir, "index.js");

  try {
    if (!fs.existsSync(indexPath)) {
      const basic = await getWorkBuddyStatus();
      return {
        department: "workbuddy",
        name: dept.name,
        independentBilling: true,
        billingChannel: "WorkBuddy 独立计费账户",
        online: Boolean(basic.available),
        statusText: basic.available
          ? "WorkBuddy 在线（未找到 dsh-workbuddy-connect 插件目录）"
          : "未找到 WorkBuddy 插件",
        headlineBalance:
          basic.credits != null ? `${basic.credits} Credits` : "无法读取",
        remainingCredits: basic.credits ?? null,
        totalCredits: null,
        remainingPercent: null,
        packages: [],
        defaultModel: dept.defaultModel,
        planningModels: dept.plannerModels,
        executionModels: dept.executorModels,
        reviewerModels: dept.reviewerModels,
        updatedAt: Date.now(),
      };
    }

    const files = fs.readdirSync(wbPluginDir);
    const hbFile = files.find(
      (f) => f.startsWith("host-heartbeat-") && f.endsWith(".js")
    );
    const wb = await import(indexPath);
    const hb = hbFile ? await import(path.join(wbPluginDir, hbFile)) : null;

    const client = new wb.WorkBuddyUpstreamClient();
    const keyProvider =
      hb && typeof hb.b === "function" ? hb.b(wb.CN_VARIANT) : undefined;
    const store = new wb.WorkBuddyCredentialStore({
      variant: wb.CN_VARIANT,
      refresh: (c) => client.refreshToken(c),
      keyProvider,
    });

    const credential = await store.resolve();
    const creditsInfo = await client.fetchCredits(credential);

    const hasTotal = typeof creditsInfo?.total === "number";
    const remainTotal = hasTotal
      ? Math.round(Number(creditsInfo.total) * 100) / 100
      : null;
    const packages = Array.isArray(creditsInfo?.accounts)
      ? creditsInfo.accounts.map((pkg) => ({
          name: pkg.packageName || "WorkBuddy 资源包",
          remain: Math.round(Number(pkg.remain ?? 0) * 100) / 100,
          size: Math.round(Number(pkg.size ?? 0) * 100) / 100,
          used: Math.round(Number(pkg.used ?? 0) * 100) / 100,
          expiresAt: pkg.endTimeMs
            ? new Date(pkg.endTimeMs).toISOString()
            : null,
        }))
      : [];
    const totalSize =
      Math.round(packages.reduce((acc, p) => acc + (p.size || 0), 0) * 100) /
      100;
    const usedTotal =
      totalSize > 0 && remainTotal !== null
        ? Math.round(Math.max(0, totalSize - remainTotal) * 100) / 100
        : null;
    const remPercent =
      totalSize > 0 && remainTotal !== null
        ? Math.round((remainTotal / totalSize) * 1000) / 10
        : null;

    return {
      department: "workbuddy",
      name: dept.name,
      independentBilling: true,
      billingChannel: "WorkBuddy 专属 Credits (独立计费，与 Qoder 不通用)",
      online: true,
      accountLabel:
        credential?.user?.nickname ||
        credential?.user?.name ||
        "WorkBuddy CN 独立账号",
      statusText: `独立从 WorkBuddy 接口实时读取 · 剩余 ${remainTotal} / ${totalSize} Credits (${
        remPercent !== null ? `${remPercent}%` : "—"
      }) · 已用 ${usedTotal ?? "—"} Credits · 共 ${packages.length} 个独立资源包`,
      headlineBalance:
        remainTotal !== null && totalSize > 0
          ? `${remainTotal} / ${totalSize} Credits (${remPercent}%)`
          : remainTotal !== null
          ? `${remainTotal} Credits`
          : "无法解析",
      remainingCredits: remainTotal,
      totalCredits: totalSize || null,
      usedCredits: usedTotal,
      remainingPercent: remPercent,
      packages,
      defaultModel: dept.defaultModel,
      planningModels: dept.plannerModels,
      executionModels: dept.executorModels,
      reviewerModels: dept.reviewerModels,
      updatedAt: Date.now(),
    };
  } catch (err) {
    return {
      department: "workbuddy",
      name: dept.name,
      independentBilling: true,
      billingChannel: "WorkBuddy 独立计费账户",
      online: false,
      statusText: `WorkBuddy 独立额度读取失败: ${err.message}`,
      headlineBalance: "读取失败",
      remainingCredits: null,
      totalCredits: null,
      remainingPercent: null,
      packages: [],
      defaultModel: dept.defaultModel,
      planningModels: dept.plannerModels,
      executionModels: dept.executorModels,
      reviewerModels: dept.reviewerModels,
      updatedAt: Date.now(),
    };
  }
}

/**
 * Parse Qoder OpenAPI `/sash/api/v2/me/usage` or `/api/v2/quota/usage` payload.
 */
function parseQoderOpenApiUsage(raw) {
  if (!raw || typeof raw !== "object") return null;
  const unwrapped = raw.result || raw.data || raw;
  const root = unwrapped.qoderUsage || unwrapped;

  // Format 1: sash/api/v2/me/usage or api/v2/quota/usage (userQuota / personalQuota / addOnQuota / orgResourcePackage)
  const buckets = [];
  for (const key of [
    "userQuota",
    "user_quota",
    "personalQuota",
    "addOnQuota",
    "add_on_quota",
    "orgResourcePackage",
    "org_resource_package",
  ]) {
    const b = root[key];
    if (
      b &&
      typeof b === "object" &&
      (typeof b.total === "number" || typeof b.cap === "number")
    ) {
      const total = Number(b.total ?? b.cap ?? 0);
      if (total <= 0) continue;
      const used = Number(b.used ?? 0);
      const rem =
        typeof b.remaining === "number"
          ? Math.round(b.remaining * 100) / 100
          : Math.max(0, Math.round((total - used) * 100) / 100);
      buckets.push({
        key,
        name: b.title || b.name || key,
        used: Math.round(used * 100) / 100,
        total: Math.round(total * 100) / 100,
        remain: rem,
      });
    }
  }
  if (buckets.length > 0) {
    const total = Math.round(buckets.reduce((s, b) => s + b.total, 0) * 100) / 100;
    const used = Math.round(buckets.reduce((s, b) => s + b.used, 0) * 100) / 100;
    const remain = Math.max(0, Math.round((total - used) * 100) / 100);
    const pct = total > 0 ? Math.round((remain / total) * 1000) / 10 : null;
    return {
      planTier:
        root?.userType ||
        root?.user_type ||
        root?.planTier?.name ||
        root?.planName ||
        null,
      used,
      total,
      remain,
      pct,
      buckets,
    };
  }

  // Format 2: direct total/used on root
  if (typeof root.total === "number" && root.total > 0) {
    const used = Math.round(Number(root.used ?? 0) * 100) / 100;
    const total = Math.round(Number(root.total ?? 0) * 100) / 100;
    const remain = Math.max(0, Math.round((total - used) * 100) / 100);
    const pct = total > 0 ? Math.round((remain / total) * 1000) / 10 : null;
    return {
      planTier: root.plan_name || root.userType || null,
      used,
      total,
      remain,
      pct,
      buckets: [{ key: "userQuota", name: "Qoder 配额", used, total, remain }],
    };
  }
  return null;
}

/**
 * 3. Probe live Qoder CN status & quota 100% independently from WorkBuddy.
 * Never accepts or falls back to WorkBuddy's credits, and never guesses percentages.
 */
export async function probeQoderBalance() {
  const dept = DEPTS.qoder;
  const localTelemetry = inspectQoderLocalTelemetry();
  const qoderStatus = await getQoderStatus();
  const indUsage = readIndependentQoderUsage();

  // Check DSH's own `.qoder-token-count.qoder-cn.<YYYY-MM-DD>.json` & `.qoder-request-count.qoder-cn.<YYYY-MM-DD>.json`
  const todayStr = new Date().toISOString().slice(0, 10);
  const qoderTokenFile = path.join(
    os.homedir(),
    `.dsh/.qoder-token-count.qoder-cn.${todayStr}.json`
  );
  const qoderReqFile = path.join(
    os.homedir(),
    `.dsh/.qoder-request-count.qoder-cn.${todayStr}.json`
  );
  let pluginTokensToday = 0;
  let pluginRequestsToday = 0;
  if (fs.existsSync(qoderTokenFile)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(qoderTokenFile, "utf8"));
      pluginTokensToday = Number(parsed?.total) || 0;
    } catch {
      // ignore
    }
  }
  if (fs.existsSync(qoderReqFile)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(qoderReqFile, "utf8"));
      pluginRequestsToday = Number(parsed?.count) || 0;
    } catch {
      // ignore
    }
  }

  // Try Qoder CN OpenAPI with Qoder's own device credential or PAT
  const qoderAuthFile = path.join(os.homedir(), ".dsh/.qoder-auth.qoder-cn.json");
  let token =
    process.env.QODERCN_PAT ||
    process.env.QODERCN_PERSONAL_ACCESS_TOKEN ||
    process.env.QODERCN_API_KEY ||
    null;

  if (!token && fs.existsSync(qoderAuthFile)) {
    try {
      const raw = JSON.parse(fs.readFileSync(qoderAuthFile, "utf8"));
      token = raw?.accessToken || raw?.token || raw?.pat || null;
    } catch {
      // ignore
    }
  }

  if (token) {
    const endpoints = [
      "https://openapi.qoder.com.cn/sash/api/v2/me/usage",
      "https://openapi.qoder.com.cn/api/v2/quota/usage",
      "https://gateway.qoder.com.cn/api/v2/user/usage/presentation",
    ];
    for (const url of endpoints) {
      try {
        const res = await fetch(url, {
          headers: withIdentityHeaders({
            authorization: `Bearer ${token}`,
            accept: "application/json",
            "user-agent": "Qoder",
            "cosy-clienttype": "10",
            "cosy-version": localTelemetry.appVersion || "0.4.8",
          }),
          signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
        });
        if (!res.ok) continue;
        const data = await res.json();
        const parsed = parseQoderOpenApiUsage(data);
        if (parsed) {
          return {
            department: "qoder",
            name: dept.name,
            independentBilling: true,
            billingChannel: "Qoder CN 独立计费账户 (OpenAPI 实时读取)",
            online: true,
            mode: "native-qoder-cn-openapi",
            accountLabel: `${localTelemetry.accountName || qoderStatus.accountName} (${
              parsed.planTier || localTelemetry.planType || "Qoder CN"
            })`,
            statusText: `独立从 Qoder CN OpenAPI 实时读取 · 剩余 ${parsed.remain} / ${parsed.total} Credits (${parsed.pct}%) · 已用 ${parsed.used} Credits`,
            headlineBalance: `${parsed.remain} / ${parsed.total} Credits (${parsed.pct}%)`,
            remainingCredits: parsed.remain,
            totalCredits: parsed.total,
            usedCredits: parsed.used,
            remainingPercent: parsed.pct,
            packages: parsed.buckets,
            needsDeviceAuthForExactCredits: false,
            todayCalls: indUsage.todayCalls + pluginRequestsToday,
            todayTokens: indUsage.todayTokens + pluginTokensToday,
            defaultModel: dept.defaultModel,
            planningModels: dept.plannerModels,
            executionModels: dept.executorModels,
            reviewerModels: dept.reviewerModels,
            updatedAt: Date.now(),
          };
        }
      } catch {
        // try next Qoder endpoint
      }
    }
  }

  // No unencrypted OpenAPI Bearer token in ~/.dsh/.qoder-auth.qoder-cn.json yet:
  // Report the exact real data read from Qoder CN Desktop's local status & logs, never borrowing WorkBuddy's credits and never guessing a percentage!
  const planMap = {
    personal_professional: "个人专业版 (personal_professional)",
    personal_free: "个人免费版 (personal_free)",
    enterprise: "企业版 (enterprise)",
  };
  const planLabel = localTelemetry.planType
    ? planMap[localTelemetry.planType] || localTelemetry.planType
    : "未读取到套餐类型";

  const claimedCredits = (localTelemetry.campaignCredits || [])
    .filter((c) => c.status === "CLAIMED")
    .reduce((sum, c) => sum + c.amount, 0);
  const claimableCredits = (localTelemetry.campaignCredits || [])
    .filter((c) => c.status === "CLAIMABLE")
    .reduce((sum, c) => sum + c.amount, 0);

  const creditParts = [];
  if (localTelemetry.billedCreditsTotal > 0) {
    creditParts.push(
      `本地已实扣 ${localTelemetry.billedCreditsTotal} Credits (${localTelemetry.billableRequestCount} 笔计费请求)`
    );
  }
  if (claimedCredits > 0) creditParts.push(`活动已领 ${claimedCredits} Credits`);
  if (claimableCredits > 0) creditParts.push(`可领 ${claimableCredits} Credits`);

  const modelBreakdownEntries = Object.entries(
    localTelemetry.billedCreditsByModel || {}
  ).map(([m, c]) => `${m}: ${c}`);
  const modelBreakdownText =
    modelBreakdownEntries.length > 0
      ? ` · 分模型实扣: [${modelBreakdownEntries.join(", ")}] Credits`
      : "";

  const headline = localTelemetry.loggedIn
    ? `${
        localTelemetry.planType === "personal_professional"
          ? "个人专业版"
          : localTelemetry.planType || "已登录"
      }${
        localTelemetry.billedCreditsTotal > 0
          ? ` · 已实扣 ${localTelemetry.billedCreditsTotal} Credits`
          : ""
      }${claimedCredits > 0 ? ` · 活动+${claimedCredits}已领` : ""}`
    : "未登录 Qoder CN";

  return {
    department: "qoder",
    name: dept.name,
    independentBilling: true,
    billingChannel: "Qoder CN 独立计费账户 (与 WorkBuddy 严格隔离)",
    online: localTelemetry.loggedIn,
    mode: "qoder-cn-local-telemetry",
    accountLabel: localTelemetry.accountName
      ? `${localTelemetry.accountName} (UID ${
          localTelemetry.uid ? localTelemetry.uid.slice(0, 8) + "…" : "未知"
        } · v${localTelemetry.appVersion || "0.4.8"})`
      : "未检测到 Qoder CN 账号",
    planType: planLabel,
    claimedCampaignCredits: claimedCredits,
    claimableCampaignCredits: claimableCredits,
    localBilledCredits: localTelemetry.billedCreditsTotal,
    localBillableRequests: localTelemetry.billableRequestCount,
    localCreditsByModel: localTelemetry.billedCreditsByModel,
    platformModelCount: localTelemetry.platformModelCount,
    localSessionCount: localTelemetry.sessionCount,
    localTurnCount: localTelemetry.turnCount,
    needsDeviceAuthForExactCredits: true,
    statusText: `独立读取 Qoder CN 本地实况 · 账号: ${
      localTelemetry.accountName || "未知"
    } · 套餐: ${planLabel}${
      creditParts.length > 0 ? ` · ${creditParts.join(" / ")}` : ""
    }${modelBreakdownText} · 平台可用模型: ${
      localTelemetry.platformModelCount ?? "—"
    } 个 · 本地会话 ${localTelemetry.sessionCount} 个 (${
      localTelemetry.turnCount
    } 条记录) · 点击下方【一键网页授权】可同步 OpenAPI 精确总额/剩余 Credits（绝不混用 WorkBuddy 额度，亦不猜测百分比）`,
    headlineBalance: headline,
    remainingCredits: null,
    totalCredits: null,
    usedCredits:
      localTelemetry.billedCreditsTotal > 0
        ? localTelemetry.billedCreditsTotal
        : null,
    remainingPercent: null,
    todayCalls: indUsage.todayCalls + pluginRequestsToday,
    todayTokens: indUsage.todayTokens + pluginTokensToday,
    defaultModel: dept.defaultModel,
    planningModels: dept.plannerModels,
    executionModels: dept.executorModels,
    reviewerModels: dept.reviewerModels,
    updatedAt: Date.now(),
  };
}

/**
 * 4. Probe Doubao (豆包 · 工作模式 · 豆包 2.1 Pro · 思考模式：高) status and quota independently.
 * Reads directly from Doubao Desktop's IndexedDB (`chrome_doubao-chat_0.indexeddb.leveldb`) & `public_config.json`.
 * Never hardcodes "unlimited / 100%" or guesses percentages.
 */
export async function probeDoubaoBalance(sessionLedger = null) {
  const dept = DEPTS.doubao;
  const local = inspectDoubaoLocalTelemetry();
  await getDoubaoStatus();
  const indUsage = readIndependentDoubaoUsage();
  const doubaoLedger = sessionLedger?.doubao || {
    calls: 0,
    estimatedTokens: 0,
    lastModel: "doubao-2.1-pro",
  };

  const skuLabel =
    local.sku === "personal_std"
      ? "个人标准版 (personal_std)"
      : local.sku || "豆包桌面端账号";
  const quotaMechanism =
    local.limitMethod === "answer_peak_limit"
      ? `按${local.limitTrigger === "hour" ? "小时" : "周期"}动态峰值限流 (answer_peak_limit/${
          local.limitTrigger || "hour"
        }，额度多但非无限额度)`
      : "动态限流配额";

  const rateLimitText = local.isRateLimited
    ? `⚠️ 已触发峰值限流 (expertReachLimit 命中 ${local.limitHitCount} 次)`
    : "正常未触发限流 (expertReachLimit: 0 次受限)";

  const am = local.agentModeConfig;
  const verifiedModeText = am
    ? `工作模式 (agent-mode:1 / select=${am.modeSelectValue}) · 豆包 2.1 Pro (key=${am.modelItemKey}) · 思考模式：高 (effort=${am.reasoningEffortLevel})`
    : "工作模式 · 豆包 2.1 Pro · 思考模式：高";

  const hourlyCalls = indUsage.hourlyCalls;
  const todayCalls = Math.max(indUsage.todayCalls, doubaoLedger.calls || 0);
  const todayTokens = Math.max(
    indUsage.todayTokens,
    doubaoLedger.estimatedTokens || 0
  );

  return {
    department: "doubao",
    name: dept.name,
    independentBilling: true,
    billingChannel: "豆包独立配额 (Doubao IndexedDB 实时直读)",
    online: local.appInstalled || Boolean(local.userId),
    unlimited: false, // Explicitly NOT unlimited — uses hourly peak rate-limiting (answer_peak_limit/hour)
    accountLabel: local.userId
      ? `Doubao UID ${local.userId} (v${local.appVersion || "2.17.10"})`
      : "Doubao 桌面端",
    planType: skuLabel,
    quotaMechanism,
    isRateLimited: local.isRateLimited,
    limitHitCount: local.limitHitCount,
    contextWindow: local.contextWindow || 256000,
    workMode: "work",
    workModeLabel: "工作模式",
    defaultModel: "doubao-2.1-pro",
    thinkingMode: "high",
    thinkingModeLabel: "思考模式：高",
    verifiedIndexedDbConfig: am,
    conversationCount: local.conversationCount,
    hourlyCalls,
    todayCalls,
    todayTokens,
    statusText: `独立从 Doubao IndexedDB 实时读取 · 账号 UID: ${
      local.userId || "未知"
    } · 计费规则: ${skuLabel} · ${quotaMechanism} · 限流状态: ${rateLimitText} · 实测档位: ${verifiedModeText} · 上下文窗口: ${
      local.contextWindow ? `${local.contextWindow / 1000}K` : "256K"
    } · 本地历史会话 ${
      local.conversationCount
    } 个 · 近1小时执勤 ${hourlyCalls} 次 (今日累计 ${todayCalls} 次 / ${todayTokens} tokens)`,
    headlineBalance: local.isRateLimited
      ? "⚠️ 已触发小时峰值限流"
      : `未限流 (0次受限) · 近1h ${hourlyCalls}次 · 256K窗口`,
    remainingPercent: null, // Never guess 100%; Doubao uses dynamic hourly peak limit without a fixed percentage denominator
    sessionCalls: todayCalls,
    sessionTokens: todayTokens,
    availableModels: dept.models.map((m) => m.id),
    updatedAt: Date.now(),
  };
}

/**
 * Probe DSH Foreman (DeepSeek Official API balance from `~/.dsh/dsh-usage/provider-snapshots.json`).
 */
export async function probeDshForemanBalance() {
  const snapPath = path.join(
    os.homedir(),
    ".dsh/dsh-usage/provider-snapshots.json"
  );
  if (fs.existsSync(snapPath)) {
    try {
      const snap = JSON.parse(fs.readFileSync(snapPath, "utf8"));
      const ds =
        snap?.providers?.["deepseek-official"] || snap?.providers?.deepseek;
      if (ds?.balance?.totalBalance) {
        const symbol =
          String(ds.balance.currency).toUpperCase() === "CNY" ? "¥" : "$";
        return {
          role: "L2 总包工头 (DSH / DeepSeek)",
          online: true,
          headlineBalance: `${symbol}${ds.balance.totalBalance}`,
          currency: ds.balance.currency,
          totalBalance: ds.balance.totalBalance,
          updatedAt: ds.balance.updatedAt || Date.now(),
        };
      }
    } catch {
      // ignore
    }
  }
  return {
    role: "L2 总包工头 (DSH / DeepSeek)",
    online: true,
    headlineBalance: "在线值守",
    currency: "CNY",
    totalBalance: null,
    updatedAt: Date.now(),
  };
}

/**
 * Get real-time independent balances for all 4 sub-agents + DSH Foreman.
 * All 4 agents are probed in parallel with zero cross-sharing.
 */
export async function getCompanyBalances({
  force = false,
  sessionLedger = null,
} = {}) {
  const now = Date.now();
  if (!force && cachedOverview && now - cachedAtMs < BALANCE_CACHE_TTL_MS) {
    return enrichWithSessionLedger(cachedOverview, sessionLedger);
  }

  if (inflightPromise) {
    const res = await inflightPromise;
    return enrichWithSessionLedger(res, sessionLedger);
  }

  inflightPromise = (async () => {
    try {
      const [codex, qoder, workbuddy, doubao, foreman] = await Promise.all([
        probeCodexBalance(),
        probeQoderBalance(),
        probeWorkBuddyBalance(),
        probeDoubaoBalance(sessionLedger),
        probeDshForemanBalance(),
      ]);

      const snapshot = {
        updatedAt: Date.now(),
        foreman,
        agents: {
          codex,
          qoder,
          workbuddy,
          doubao,
        },
      };
      cachedOverview = snapshot;
      cachedAtMs = Date.now();
      return snapshot;
    } finally {
      inflightPromise = null;
    }
  })();

  const result = await inflightPromise;
  return enrichWithSessionLedger(result, sessionLedger);
}

function enrichWithSessionLedger(snapshot, sessionLedger) {
  if (!snapshot) return snapshot;
  const ledger = sessionLedger || {};
  const clone = JSON.parse(JSON.stringify(snapshot));
  for (const dept of ["codex", "qoder", "workbuddy", "doubao"]) {
    if (clone.agents?.[dept]) {
      const rosterDept = DEPTS[dept] || {};
      clone.agents[dept].name = rosterDept.name || clone.agents[dept].name;
      clone.agents[dept].defaultModel = rosterDept.defaultModel || clone.agents[dept].defaultModel;
      clone.agents[dept].defaultReviewerModel =
        rosterDept.defaultReviewerModel || clone.agents[dept].defaultReviewerModel;
      clone.agents[dept].defaultPlannerModel =
        rosterDept.defaultPlannerModel || clone.agents[dept].defaultPlannerModel;
      clone.agents[dept].defaultExecutorModel =
        rosterDept.defaultExecutorModel || clone.agents[dept].defaultExecutorModel;
      clone.agents[dept].escalationModel =
        rosterDept.escalationModel || clone.agents[dept].escalationModel;
      clone.agents[dept].planningModels =
        rosterDept.plannerModels || clone.agents[dept].planningModels;
      clone.agents[dept].executionModels =
        rosterDept.executorModels || clone.agents[dept].executionModels;
      clone.agents[dept].reviewerModels =
        rosterDept.reviewerModels || clone.agents[dept].reviewerModels;

      const l = ledger[dept] || {
        calls: 0,
        estimatedTokens: 0,
        lastModel: null,
      };
      clone.agents[dept].sessionCalls = Math.max(
        clone.agents[dept].todayCalls || 0,
        l.calls || 0
      );
      clone.agents[dept].sessionTokens = Math.max(
        clone.agents[dept].todayTokens || 0,
        l.estimatedTokens || 0
      );
      clone.agents[dept].lastUsedModel =
        l.lastModel || clone.agents[dept].defaultModel;
    }
  }
  return clone;
}
