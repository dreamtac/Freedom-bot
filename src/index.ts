import "dotenv/config";

import {
  Client,
  Events,
  GatewayIntentBits,
  MessageFlags,
} from "discord.js";
import { resolve } from "node:path";

import { commandsByName } from "./commands/index.js";
import { loadConfig } from "./config.js";
import { NewsMonitor } from "./monitor/news-monitor.js";
import { PriceAlertMonitor } from "./monitor/price-alert-monitor.js";
import { KisClient } from "./sources/kis.js";
import { KisRealtimeClient } from "./sources/kis-realtime.js";
import { PriceAlertStore } from "./storage/price-alert-store.js";
import { StockStore } from "./storage/stock-store.js";

async function startBot(): Promise<void> {
  const config = loadConfig();
  const databasePath = resolve(".data", "freedom-bot.sqlite");
  const priceAlertStore = await PriceAlertStore.open(databasePath);
  const stockStore = await StockStore.open(databasePath);
  const client = new Client({
    intents: [GatewayIntentBits.Guilds],
  });
  const newsMonitor = config.notificationChannelId
    ? new NewsMonitor({
        client,
        channelId: config.notificationChannelId,
        intervalMs: config.newsPollIntervalMs,
        databasePath,
        legacyStorePath: resolve(".data", "seen-posts.json"),
      })
    : undefined;
  const priceAlertMonitor =
    config.kis && config.notificationChannelId
      ? new PriceAlertMonitor({
          channelId: config.notificationChannelId,
          client,
          openingPriceSource: new KisClient(config.kis),
          realtimeClient: new KisRealtimeClient(config.kis),
          store: priceAlertStore,
        })
      : undefined;

  client.once(Events.ClientReady, (readyClient) => {
    console.log(`${readyClient.user.tag}로 로그인했습니다.`);
    if (newsMonitor) {
      if (!readyClient.channels.cache.has(config.notificationChannelId!)) {
        console.error(
          readyClient.guilds.cache.size === 0
            ? "봇이 Discord 서버에 Guild Install 되어 있지 않습니다. 서버용 설치 링크로 봇을 추가해 주세요."
            : "설정된 알림 채널을 볼 수 없습니다. 채널 ID와 봇의 채널 보기 권한을 확인해 주세요.",
        );
        return;
      }

      void newsMonitor.start().catch((error: unknown) => {
        console.error("공지 모니터를 시작하지 못했습니다.", error);
      });
    }
    if (priceAlertMonitor) {
      priceAlertMonitor.start();
    } else if (!config.notificationChannelId) {
      console.log(
        "DISCORD_NOTIFICATION_CHANNEL_ID가 없어 공지와 주가 알림은 비활성화되었습니다.",
      );
    } else if (!config.kis) {
      console.log("KIS API 키가 없어 실시간 주가 알림은 비활성화되었습니다.");
    }
  });

  client.on(Events.InteractionCreate, async (interaction) => {
    if (!interaction.isChatInputCommand() && !interaction.isAutocomplete()) {
      return;
    }

    const command = commandsByName.get(interaction.commandName);
    if (!command) {
      console.warn(`등록되지 않은 명령어 요청: ${interaction.commandName}`);
      return;
    }

    try {
      const context = {
        ...(config.kis ? { kis: config.kis } : {}),
        ...(config.notificationChannelId
          ? { notificationChannelId: config.notificationChannelId }
          : {}),
        ...(priceAlertMonitor ? { priceAlertMonitor } : {}),
        priceAlertStore,
        stockStore,
      };

      if (interaction.isAutocomplete()) {
        if (command.autocomplete) {
          await command.autocomplete(interaction, context);
        } else {
          await interaction.respond([]);
        }
        return;
      }

      await command.execute(interaction, context);
    } catch (error: unknown) {
      console.error(`/${interaction.commandName} 실행에 실패했습니다.`, error);

      if (interaction.isAutocomplete()) {
        if (!interaction.responded) {
          await interaction.respond([]);
        }
        return;
      }

      const response = {
        content: "명령어를 처리하는 중 문제가 발생했습니다.",
        flags: MessageFlags.Ephemeral,
      } as const;

      if (interaction.replied || interaction.deferred) {
        await interaction.followUp(response);
      } else {
        await interaction.reply(response);
      }
    }
  });

  const shutdown = (signal: string): void => {
    console.log(`${signal} 신호를 받아 봇을 종료합니다.`);
    newsMonitor?.stop();
    priceAlertMonitor?.stop();
    priceAlertStore.close();
    stockStore.close();
    client.destroy();
    process.exit(0);
  };

  process.once("SIGINT", () => shutdown("SIGINT"));
  process.once("SIGTERM", () => shutdown("SIGTERM"));

  await client.login(config.botToken);
}

startBot().catch((error: unknown) => {
  console.error("봇을 시작하지 못했습니다.", error);
  process.exitCode = 1;
});
