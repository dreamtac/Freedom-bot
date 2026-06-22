import { z } from "zod";

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
});

export interface AppConfig {
  botToken: string;
  clientId: string;
  guildId?: string;
  notificationChannelId?: string;
  newsPollIntervalMs: number;
}

export function loadConfig(
  environment: NodeJS.ProcessEnv = process.env,
): AppConfig {
  const result = configSchema.safeParse(environment);

  if (!result.success) {
    const messages = result.error.issues.map((issue) => issue.message).join("\n");
    throw new Error(`환경변수 설정을 확인해 주세요:\n${messages}`);
  }

  return {
    botToken: result.data.DISCORD_BOT_TOKEN,
    clientId: result.data.DISCORD_CLIENT_ID,
    ...(result.data.DISCORD_GUILD_ID
      ? { guildId: result.data.DISCORD_GUILD_ID }
      : {}),
    ...(result.data.DISCORD_NOTIFICATION_CHANNEL_ID
      ? { notificationChannelId: result.data.DISCORD_NOTIFICATION_CHANNEL_ID }
      : {}),
    newsPollIntervalMs: result.data.NEWS_POLL_INTERVAL_MS,
  };
}
