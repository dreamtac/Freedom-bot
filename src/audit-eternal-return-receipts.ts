import "dotenv/config";

import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { readEternalReturnConfig } from "./features/eternal-return-policy.js";
import {
  analyzeReceiptSamples,
  renderReceiptSampleAudit,
  type ReceiptSample,
} from "./services/eternal-return-receipt-audit.js";
import { getGamesByUserId, getRawGameResults, getUserIdByNickname } from "./sources/eternal-return.js";
import { shutdownEternalReturnRequests } from "./sources/eternal-return-request-queue.js";
import { EternalReturnStore } from "./storage/eternal-return-store.js";

interface AuditOptions {
  databasePath: string;
  outputPath?: string;
  pagesPerUser: number;
}

export async function auditEternalReturnReceipts(
  args: readonly string[],
  environment: NodeJS.ProcessEnv = process.env,
): Promise<string> {
  const options = parseOptions(args);
  const config = readEternalReturnConfig(environment);
  if (!config.erEnabled || !config.erApiKey) {
    throw new Error("ER_ENABLED=true와 ER_API_KEY가 필요합니다.");
  }

  const store = await EternalReturnStore.open(options.databasePath);
  const users = store.listAutoRefreshUsers();
  store.close();
  if (users.length === 0) throw new Error("자동 수집 대상으로 등록된 유저가 없습니다.");

  const samples: ReceiptSample[] = [];
  for (const user of users) {
    const userId = await getUserIdByNickname(user.nickname, config.erApiKey, { priority: "backfill" });
    let next: string | undefined;
    for (let page = 0; page < options.pagesPerUser; page += 1) {
      const response = await getGamesByUserId(userId, config.erApiKey, {
        priority: "backfill",
        ...(next ? { next } : {}),
      });
      samples.push(...getRawGameResults(response) as ReceiptSample[]);
      next = normalizeCursor(response.next);
      if (!next) break;
    }
  }

  const report = renderReceiptSampleAudit(analyzeReceiptSamples(samples), {
    generatedAt: new Date(), userCount: users.length, pagesPerUser: options.pagesPerUser,
  });
  if (options.outputPath) await writeFile(options.outputPath, report, "utf8");
  return report;
}

function parseOptions(args: readonly string[]): AuditOptions {
  let databasePath = resolve(".data", "freedom-bot.sqlite");
  let outputPath: string | undefined;
  let pagesPerUser = 2;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    const value = args[index + 1];
    if (argument === "--database" && value) {
      databasePath = resolve(value);
      index += 1;
    } else if (argument === "--output" && value) {
      outputPath = resolve(value);
      index += 1;
    } else if (argument === "--pages" && value) {
      pagesPerUser = Number(value);
      index += 1;
    } else {
      throw new Error("사용법: npm run audit:er-receipts -- [--database PATH] [--output PATH] [--pages 1~10]");
    }
  }
  if (!Number.isSafeInteger(pagesPerUser) || pagesPerUser < 1 || pagesPerUser > 10) {
    throw new Error("--pages는 1~10 사이의 정수여야 합니다.");
  }
  return { databasePath, pagesPerUser, ...(outputPath ? { outputPath } : {}) };
}

function normalizeCursor(value: number | string | undefined): string | undefined {
  if (value === undefined || value === null) return undefined;
  const cursor = String(value).trim();
  return cursor && cursor !== "0" ? cursor : undefined;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  auditEternalReturnReceipts(process.argv.slice(2))
    .then(report => {
      if (!process.argv.includes("--output")) console.log(report);
    })
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : error);
      process.exitCode = 1;
    })
    .finally(() => shutdownEternalReturnRequests());
}
