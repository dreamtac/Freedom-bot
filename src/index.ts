import "dotenv/config";

import { Client, Events, GatewayIntentBits } from "discord.js";
import { resolve } from "node:path";

import { commandsByName } from "./commands/index.js";
import { loadConfig } from "./config.js";
import { NewsMonitor } from "./monitor/news-monitor.js";

async function startBot(): Promise<void> {
  const config = loadConfig();
  const client = new Client({
    intents: [GatewayIntentBits.Guilds],
  });
  const newsMonitor = config.notificationChannelId
    ? new NewsMonitor({
        client,
        channelId: config.notificationChannelId,
        intervalMs: config.newsPollIntervalMs,
        storePath: resolve(".data", "seen-posts.json"),
      })
    : undefined;

  client.once(Events.ClientReady, (readyClient) => {
    console.log(`${readyClient.user.tag}로 로그인했습니다.`);
    if (newsMonitor) {
      void newsMonitor.start().catch((error: unknown) => {
        console.error("공지 모니터를 시작하지 못했습니다.", error);
      });
    } else {
      console.log(
        "DISCORD_NOTIFICATION_CHANNEL_ID가 없어 공지 알림은 비활성화되었습니다.",
      );
    }
  });

  client.on(Events.InteractionCreate, async (interaction) => {
    if (!interaction.isChatInputCommand()) {
      return;
    }

    const command = commandsByName.get(interaction.commandName);
    if (!command) {
      console.warn(`등록되지 않은 명령어 요청: ${interaction.commandName}`);
      return;
    }

    try {
      await command.execute(interaction);
    } catch (error: unknown) {
      console.error(`/${interaction.commandName} 실행에 실패했습니다.`, error);

      const response = {
        content: "명령어를 처리하는 중 문제가 발생했습니다.",
        ephemeral: true,
      } as const;

      if (interaction.replied || interaction.deferred) {
        await interaction.followUp(response);
      } else {
        await interaction.reply(response);
      }
    }
  });

  const shutdown = async (signal: string): Promise<void> => {
    console.log(`${signal} 신호를 받아 봇을 종료합니다.`);
    newsMonitor?.stop();
    client.destroy();
  };

  process.once("SIGINT", () => void shutdown("SIGINT"));
  process.once("SIGTERM", () => void shutdown("SIGTERM"));

  await client.login(config.botToken);
}

startBot().catch((error: unknown) => {
  console.error("봇을 시작하지 못했습니다.", error);
  process.exitCode = 1;
});
