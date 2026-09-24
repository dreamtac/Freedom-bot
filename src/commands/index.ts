import type { BotCommand } from "./types.js";
import { endfieldCommand } from "./endfield.js";
import { nightFuturesCommand } from "./night-futures.js";
import { nightFuturesAlertCommand } from "./night-futures-alert.js";
import { quoteCommand } from "./quote.js";
import { marketOverviewCommand } from "./market-overview.js";
import { marketIndexCommand } from "./market-index.js";
import { priceAlertCommand } from "./price-alert.js";
import { stockNewsCommand } from "./stock-news.js";
import { statusCommand } from "./status.js";
import { testNotificationCommand } from "./test-notification.js";
import { volumeCommand } from "./volume.js";

const coreCommands: readonly BotCommand[] = [
  endfieldCommand,
  nightFuturesCommand,
  nightFuturesAlertCommand,
  marketIndexCommand,
  marketOverviewCommand,
  quoteCommand,
  priceAlertCommand,
  stockNewsCommand,
  statusCommand,
  testNotificationCommand,
  volumeCommand,
];

// Registration and runtime must use the same feature selection. Future ER
// services/stores belong behind this gate, not at a shared module's top level.
export async function loadCommands(config: { erEnabled: boolean }): Promise<readonly BotCommand[]> {
  if (!config.erEnabled) return [...coreCommands];
  const {
    eternalReturnCommand,
    eternalReturnRecordCommand,
    eternalReturnDetailCommand,
    eternalReturnSeasonCommand,
    eternalReturnAnalysisCommand,
  } = await import("./eternal-return.js");
  return [
    coreCommands[0]!, eternalReturnCommand, eternalReturnRecordCommand,
    eternalReturnDetailCommand, eternalReturnSeasonCommand, eternalReturnAnalysisCommand,
    ...coreCommands.slice(1),
  ];
}
