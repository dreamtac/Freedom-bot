import { z } from "zod";
import { readEternalReturnConfig } from "./features/eternal-return-policy.js";

const snowflakeSchema = z
  .string()
  .regex(/^\d{17,20}$/, "Discord ID는 17~20자리 숫자여야 합니다.");

const configSchema = z.object({
  DISCORD_BOT_TOKEN: z.string().min(1, "DISCORD_BOT_TOKEN이 필요합니다."),
  DISCORD_CLIENT_ID: snowflakeSchema,
  DISCORD_GUILD_ID: z.preprocess(
    (value) => (value === "" ? undefined : value),
    snowflakeSchema.optional(),
  ),
  DISCORD_NOTIFICATION_CHANNEL_ID: z.preprocess(
    (value) => (value === "" ? undefined : value),
    snowflakeSchema.optional(),
  ),
  NEWS_POLL_INTERVAL_MS: z.preprocess(
    (value) => (value === "" || value === undefined ? 300_000 : value),
    z.coerce.number().int().min(60_000).max(86_400_000),
  ),
  STOCK_MASTER_REFRESH_INTERVAL_MS: z.preprocess(
    (value) => (value === "" || value === undefined ? 86_400_000 : value),
    z.coerce.number().int().min(60_000).max(604_800_000),
  ),
  ER_REFRESH_INTERVAL_MS: z.preprocess(
    (value) => (value === "" || value === undefined ? 300_000 : value),
    z.coerce.number().int().min(60_000).max(86_400_000),
  ),
  ER_RECEIPT_CHANNEL_ID: z.preprocess(
    (value) => (value === "" ? undefined : value),
    snowflakeSchema.optional(),
  ),
  ER_RECEIPT_MAX_PER_CYCLE: z.preprocess(
    (value) => (value === "" || value === undefined ? 3 : value),
    z.coerce.number().int().min(1).max(10),
  ),
  KIS_APP_KEY: z.preprocess(
    (value) => (value === "" ? undefined : value),
    z.string().min(1).optional(),
  ),
  KIS_APP_SECRET: z.preprocess(
    (value) => (value === "" ? undefined : value),
    z.string().min(1).optional(),
  ),
  KIS_BASE_URL: z.preprocess(
    (value) =>
      value === "" || value === undefined
        ? "https://openapi.koreainvestment.com:9443"
        : value,
    z.string().url(),
  ),
  KIS_WS_URL: z.preprocess(
    (value) =>
      value === "" || value === undefined
        ? "ws://ops.koreainvestment.com:21000"
        : value,
    z.string().url(),
  ),
});

export interface KisConfig {
  appKey: string;
  appSecret: string;
  baseUrl: string;
  websocketUrl: string;
}

export interface AppConfig {
  botToken: string;
  clientId: string;
  guildId?: string;
  notificationChannelId?: string;
  newsPollIntervalMs: number;
  stockMasterRefreshIntervalMs: number;
  erRefreshIntervalMs: number;
  kis?: KisConfig;
  erEnabled: boolean;
  erReceiptsEnabled: boolean;
  erApiKey?: string;
  erReceiptChannelId?: string;
  erReceiptMaxPerCycle: number;
}

export function loadConfig(
  environment: NodeJS.ProcessEnv = process.env,
): AppConfig {
  const result = configSchema.safeParse(environment);

  if (!result.success) {
    const messages = result.error.issues.map((issue) => issue.message).join("\n");
    throw new Error(`환경변수 설정을 확인해 주세요:\n${messages}`);
  }

  if (
    (result.data.KIS_APP_KEY && !result.data.KIS_APP_SECRET) ||
    (!result.data.KIS_APP_KEY && result.data.KIS_APP_SECRET)
  ) {
    throw new Error(
      "환경변수 설정을 확인해 주세요:\nKIS_APP_KEY와 KIS_APP_SECRET은 함께 설정해야 합니다.",
    );
  }

  const eternalReturn = readEternalReturnConfig(environment);
  if (eternalReturn.erReceiptsEnabled && !result.data.ER_RECEIPT_CHANNEL_ID) {
    throw new Error("환경변수 설정을 확인해 주세요:\nER_RECEIPTS_ENABLED=true이면 ER_RECEIPT_CHANNEL_ID가 필요합니다.");
  }
  if (eternalReturn.erReceiptsEnabled && !eternalReturn.erApiKey) {
    throw new Error("환경변수 설정을 확인해 주세요:\n게임 결과 알림에는 ER_API_KEY가 필요합니다.");
  }

  return {
    botToken: result.data.DISCORD_BOT_TOKEN,
    ...eternalReturn,
    clientId: result.data.DISCORD_CLIENT_ID,
    ...(result.data.DISCORD_GUILD_ID
      ? { guildId: result.data.DISCORD_GUILD_ID }
      : {}),
    ...(result.data.DISCORD_NOTIFICATION_CHANNEL_ID
      ? { notificationChannelId: result.data.DISCORD_NOTIFICATION_CHANNEL_ID }
      : {}),
    newsPollIntervalMs: result.data.NEWS_POLL_INTERVAL_MS,
    stockMasterRefreshIntervalMs: result.data.STOCK_MASTER_REFRESH_INTERVAL_MS,
    erRefreshIntervalMs: result.data.ER_REFRESH_INTERVAL_MS,
    erReceiptMaxPerCycle: result.data.ER_RECEIPT_MAX_PER_CYCLE,
    ...(result.data.ER_RECEIPT_CHANNEL_ID
      ? { erReceiptChannelId: result.data.ER_RECEIPT_CHANNEL_ID }
      : {}),
    ...(result.data.KIS_APP_KEY && result.data.KIS_APP_SECRET
      ? {
          kis: {
            appKey: result.data.KIS_APP_KEY,
            appSecret: result.data.KIS_APP_SECRET,
            baseUrl: result.data.KIS_BASE_URL,
            websocketUrl: result.data.KIS_WS_URL,
          },
        }
      : {}),
  };
}
