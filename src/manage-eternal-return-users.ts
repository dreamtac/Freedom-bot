import "dotenv/config";

import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { readEternalReturnConfig } from "./features/eternal-return-policy.js";
import { getUserIdByNickname } from "./sources/eternal-return.js";
import { shutdownEternalReturnRequests } from "./sources/eternal-return-request-queue.js";
import { EternalReturnStore } from "./storage/eternal-return-store.js";

export async function manageEternalReturnUsers(
  args: readonly string[],
  options: {
    databasePath?: string;
    environment?: NodeJS.ProcessEnv;
    resolveUserId?: typeof getUserIdByNickname;
  } = {},
): Promise<string> {
  const [command, rawTarget] = args;
  const store = await EternalReturnStore.open(options.databasePath ?? resolve(".data", "freedom-bot.sqlite"));
  try {
    if (command === "list") {
      const users = store.listAutoRefreshUsers();
      return users.length === 0
        ? "자동 수집 대상이 없습니다."
        : users.map(user => `${user.nickname}\t${user.userId}`).join("\n");
    }
    const target = rawTarget?.trim();
    if (!target) throw new Error("사용법: npm run manage:eternal-return -- <list|add|disable> [닉네임 또는 UID]");

    if (command === "add" || command === "enable") {
      const config = readEternalReturnConfig(options.environment ?? process.env);
      if (!config.erEnabled || !config.erApiKey) {
        throw new Error("ER_ENABLED=true와 ER_API_KEY가 필요합니다.");
      }
      const userId = await (options.resolveUserId ?? getUserIdByNickname)(
        target, config.erApiKey, { priority: "interactive" },
      );
      store.upsertUser(userId, target);
      store.setAutoRefresh(userId, true);
      return `${target} (${userId})을 자동 수집 대상으로 등록했습니다.`;
    }

    if (command === "disable") {
      const direct = store.getUser(target);
      const matches = direct ? [direct] : store.findUsersByNickname(target);
      if (matches.length === 0) throw new Error(`저장된 사용자를 찾지 못했습니다: ${target}`);
      if (matches.length > 1) {
        throw new Error(`같은 닉네임의 UID가 여러 개입니다. UID로 다시 지정해 주세요: ${matches.map(user => user.userId).join(", ")}`);
      }
      const user = matches[0]!;
      store.setAutoRefresh(user.userId, false);
      return `${user.nickname} (${user.userId})의 자동 수집을 비활성화했습니다.`;
    }
    throw new Error("사용법: npm run manage:eternal-return -- <list|add|disable> [닉네임 또는 UID]");
  } finally {
    store.close();
  }
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
