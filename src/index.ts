import "dotenv/config";

import {
  Client,
  Events,
  GatewayIntentBits,
} from "discord.js";
import { resolve } from "node:path";

import { loadCommands } from "./commands/index.js";
import { loadConfig } from "./config.js";
import { registerDiscordDiagnostics } from "./discord-diagnostics.js";
import { handleInteraction } from "./interaction-handler.js";
import { NewsMonitor } from "./monitor/news-monitor.js";
import { MarketCloseReportMonitor } from "./monitor/market-close-report-monitor.js";
import { PriceAlertMonitor } from "./monitor/price-alert-monitor.js";
import { StockMasterMonitor } from "./monitor/stock-master-monitor.js";
import { KisClient } from "./sources/kis.js";
import { KisRealtimeClient } from "./sources/kis-realtime.js";
import { PriceAlertStore } from "./storage/price-alert-store.js";
import { StockStore } from "./storage/stock-store.js";

async function startBot(): Promise<void> {
  const config = loadConfig();
  const commands = await loadCommands(config);
  const commandsByName = new Map(commands.map(command => [command.data.name, command]));
  const shutdownEternalReturn = config.erEnabled
    ? (await import("./sources/eternal-return-request-queue.js")).shutdownEternalReturnRequests
    : undefined;
  const databasePath = resolve(".data", "freedom-bot.sqlite");
  const eternalReturnStore = config.erEnabled
    ? await (await import("./storage/eternal-return-store.js")).EternalReturnStore.open(databasePath)
    : undefined;
  const eternalReturnCollector = eternalReturnStore && config.erApiKey
    ? new (await import("./services/eternal-return-collector.js")).EternalReturnCollector({
        apiKey: config.erApiKey,
        store: eternalReturnStore,
      })
    : undefined;
  const eternalReturnMonitor = eternalReturnStore && eternalReturnCollector
    ? new (await import("./monitor/eternal-return-monitor.js")).EternalReturnMonitor({
        store: eternalReturnStore,
        collector: eternalReturnCollector,
        intervalMs: config.erRefreshIntervalMs,
      })
    : undefined;
  const eternalReturnProfileService = eternalReturnStore && config.erApiKey
    ? new (await import("./services/eternal-return-profile.js")).EternalReturnProfileService({
        apiKey: config.erApiKey,
        store: eternalReturnStore,
      })
    : undefined;
  const priceAlertStore = await PriceAlertStore.open(databasePath);
  const stockStore = await StockStore.open(databasePath);
  const client = new Client({
    intents: [GatewayIntentBits.Guilds],
  });
  registerDiscordDiagnostics(client);
  const newsMonitor = config.notificationChannelId
    ? new NewsMonitor({
        client,
        channelId: config.notificationChannelId,
        intervalMs: config.newsPollIntervalMs,
        databasePath,
        legacyStorePath: resolve(".data", "seen-posts.json"),
      })
    : undefined;
  const realtimeClient =
    config.kis && config.notificationChannelId
      ? new KisRealtimeClient(config.kis)
      : undefined;
  const kisClient = config.kis ? new KisClient(config.kis) : undefined;
  const priceAlertMonitor =
    kisClient && realtimeClient && config.notificationChannelId
      ? new PriceAlertMonitor({
          channelId: config.notificationChannelId,
          client,
          nxtClosePriceSource: kisClient,
          realtimeClient,
          stockMetadataSource: stockStore,
          store: priceAlertStore,
        })
      : undefined;
  const marketCloseReportMonitor =
    kisClient && config.notificationChannelId
      ? new MarketCloseReportMonitor({
          channelId: config.notificationChannelId,
          client,
          priceSource: kisClient,
          store: priceAlertStore,
        })
      : undefined;
  const stockMasterMonitor = new StockMasterMonitor({
    store: stockStore,
    backupPath: resolve(".data", "backups", "before-stock-master.sqlite"),
    intervalMs: config.stockMasterRefreshIntervalMs,
    ...(config.notificationChannelId
      ? { client, channelId: config.notificationChannelId }
      : {}),
  });

  client.once(Events.ClientReady, (readyClient) => {
    console.log(`${readyClient.user.tag}로 로그인했습니다. (ID: ${readyClient.user.id}, 명령어 ${commandsByName.size}개)`);
    if (readyClient.user.id !== config.clientId) {
      console.error("DISCORD_CLIENT_ID와 로그인한 봇 ID가 다릅니다. 명령어가 다른 애플리케이션에 등록될 수 있습니다.");
    }
    if (newsMonitor) {
      if (!readyClient.channels.cache.has(config.notificationChannelId!)) {
        console.error(
          readyClient.guilds.cache.size === 0
            ? "봇이 Discord 서버에 Guild Install 되어 있지 않습니다. 서버용 설치 링크로 봇을 추가해 주세요."
            : "설정된 알림 채널을 볼 수 없습니다. 채널 ID와 봇의 채널 보기 권한을 확인해 주세요.",
        );
      } else {
        void newsMonitor.start().catch((error: unknown) => {
          console.error("공지 모니터를 시작하지 못했습니다.", error);
        });
      }
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
    marketCloseReportMonitor?.start();
    stockMasterMonitor.start();
    if (eternalReturnMonitor) {
      void eternalReturnMonitor.start().catch((error: unknown) => {
        console.error("이터널 리턴 자동 갱신 모니터를 시작하지 못했습니다.", error);
      });
    }
  });

  client.on(Events.InteractionCreate, async (interaction) => {
    await handleInteraction(interaction, commandsByName, {
      erEnabled: config.erEnabled,
      ...(config.erApiKey ? { erApiKey: config.erApiKey } : {}),
      ...(eternalReturnStore ? { eternalReturnStore } : {}),
      ...(eternalReturnCollector ? { eternalReturnCollector } : {}),
      ...(eternalReturnProfileService ? { eternalReturnProfileService } : {}),
      ...(config.kis ? { kis: config.kis } : {}),
      ...(config.notificationChannelId
        ? { notificationChannelId: config.notificationChannelId }
        : {}),
      ...(priceAlertMonitor ? { priceAlertMonitor } : {}),
      ...(realtimeClient ? { realtimeStatusProvider: realtimeClient } : {}),
      priceAlertStore,
      stockStore,
    });
  });

  let shuttingDown = false;
  const shutdown = async (signal: string, exitCode = 0): Promise<void> => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    console.log(`${signal} 신호를 받아 봇을 종료합니다.`);
    newsMonitor?.stop();
    priceAlertMonitor?.stop();
    marketCloseReportMonitor?.stop();
    stockMasterMonitor.stop();
    client.destroy();
    const eternalReturnMonitorStop = eternalReturnMonitor?.stop();
    shutdownEternalReturn?.();
    await eternalReturnMonitorStop;
    await eternalReturnCollector?.shutdown();
    eternalReturnStore?.close();
    priceAlertStore.close();
    stockStore.close();
    process.exit(exitCode);
  };

  process.once("SIGINT", () => { void shutdown("SIGINT"); });
  process.once("SIGTERM", () => { void shutdown("SIGTERM"); });
  process.once("uncaughtException", (error) => {
    console.error("처리하지 못한 예외로 봇을 종료합니다.", error);
    void shutdown("uncaughtException", 1);
  });
  process.once("unhandledRejection", (reason) => {
    console.error("처리하지 못한 Promise 오류로 봇을 종료합니다.", reason);
    void shutdown("unhandledRejection", 1);
  });

  await client.login(config.botToken);
}

startBot().catch((error: unknown) => {
  console.error("봇을 시작하지 못했습니다.", error);
  process.exitCode = 1;
});
