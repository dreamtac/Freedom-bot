import "dotenv/config";

import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { readEternalReturnConfig } from "./features/eternal-return-policy.js";
import { getUserIdByNickname } from "./sources/eternal-return.js";
import { shutdownEternalReturnRequests } from "./sources/eternal-return-request-queue.js";
import { EternalReturnStore, type EternalReturnUserRecord } from "./storage/eternal-return-store.js";

export async function manageEternalReturnUsers(
  args: readonly string[],
  options: {
    databasePath?: string;
    environment?: NodeJS.ProcessEnv;
    resolveUserId?: typeof getUserIdByNickname;
  } = {},
): Promise<string> {
  const [command, rawTarget, rawState, rawChannelId] = args;
  const store = await EternalReturnStore.open(options.databasePath ?? resolve(".data", "freedom-bot.sqlite"));
  try {
    if (command === "list") {
      const users = store.listAutoRefreshUsers();
      return users.length === 0
        ? "자동 수집 대상이 없습니다."
        : users.map(user => `${user.nickname}\t${user.userId}`).join("\n");
    }
    if (command === "status") {
      const target = rawTarget?.trim();
      const users = target ? [selectStoredUser(store, target)] : store.listUsers();
      return users.length === 0
        ? "저장된 이터널 리턴 사용자가 없습니다."
        : users.map(formatStatus).join("\n");
    }
    const target = rawTarget?.trim();
    if (!target) throw new Error(usage());

    if (command === "add" || command === "enable") {
      const config = readEternalReturnConfig(options.environment ?? process.env);
      if (!config.erEnabled || !config.erApiKey) {
        throw new Error("ER_ENABLED=true와 ER_API_KEY가 필요합니다.");
      }
      const userId = await (options.resolveUserId ?? getUserIdByNickname)(
        target, config.erApiKey, { priority: "interactive" },
      );
      store.upsertUser(userId, target);
      for (const previous of store.findUsersByNickname(target)) {
        if (previous.userId !== userId && previous.autoRefresh) {
          store.setAutoRefresh(previous.userId, false);
        }
      }
      store.setAutoRefresh(userId, true);
      return `${target} (${userId})을 자동 수집 대상으로 등록했습니다.`;
    }

    if (command === "disable") {
      const user = selectStoredUser(store, target, "autoRefresh");
      store.setAutoRefresh(user.userId, false);
      return `${user.nickname} (${user.userId})의 자동 수집을 비활성화했습니다.`;
    }
    if (command === "receipt") {
      const state = rawState?.trim().toLowerCase();
      const user = selectStoredUser(store, target, state === "on" ? "autoRefresh" : "receiptEnabled");
      if (state === "status") return formatStatus(user);
      if (state === "off") {
        store.setReceiptSettings(user.userId, false);
        return `${user.nickname} (${user.userId})의 게임 결과 알림을 비활성화했습니다.`;
      }
      if (state !== "on") throw new Error(usage());
      if (!user.autoRefresh) {
        throw new Error("게임 결과 알림을 켜기 전에 해당 유저를 자동 수집 대상으로 등록해 주세요.");
      }
      const environment = options.environment ?? process.env;
      const config = readEternalReturnConfig(environment);
      if (!config.erReceiptsEnabled) {
        throw new Error("ER_ENABLED=true와 ER_RECEIPTS_ENABLED=true가 필요합니다.");
      }
      const channelId = rawChannelId?.trim() || environment.ER_RECEIPT_CHANNEL_ID?.trim();
      if (!channelId || !/^\d{17,20}$/.test(channelId)) {
        throw new Error("게임 결과 알림을 켜려면 17~20자리 ER_RECEIPT_CHANNEL_ID가 필요합니다.");
      }
      store.setReceiptSettings(user.userId, true, channelId);
      return `${user.nickname} (${user.userId})의 게임 결과 알림을 켰습니다. 채널: ${channelId}`;
    }
    throw new Error(usage());
  } finally {
    store.close();
  }
}

function selectStoredUser(
  store: EternalReturnStore,
  target: string,
  preferred?: "autoRefresh" | "receiptEnabled",
) {
  const direct = store.getUser(target);
  if (direct) return direct;
  const matches = store.findUsersByNickname(target);
  if (matches.length === 0) throw new Error(`저장된 사용자를 찾지 못했습니다: ${target}`);
  const preferredMatches = preferred ? matches.filter(user => user[preferred]) : matches;
  if (preferredMatches.length === 1) return preferredMatches[0]!;
  if (matches.length === 1) return matches[0]!;
  throw new Error(`같은 닉네임의 UID가 여러 개입니다. UID로 다시 지정해 주세요: ${matches.map(user => user.userId).join(", ")}`);
}

function formatStatus(user: EternalReturnUserRecord): string {
  return `${user.nickname}\t${user.userId}\t자동 수집 ${user.autoRefresh ? "ON" : "OFF"}`
    + `\t게임 결과 ${user.receiptEnabled ? "ON" : "OFF"}`
    + `\t채널 ${user.receiptChannelId ?? "기본값 없음"}`;
}

function usage(): string {
  return "사용법: npm run manage:eternal-return -- <list|status|add|disable|receipt> [닉네임 또는 UID] [on|off|status] [채널 ID]";
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  manageEternalReturnUsers(process.argv.slice(2))
    .then(message => console.log(message))
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : error);
      process.exitCode = 1;
    })
    .finally(() => shutdownEternalReturnRequests());
}
