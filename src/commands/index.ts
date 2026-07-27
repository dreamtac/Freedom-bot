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

export const commands: readonly BotCommand[] = [
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

export const commandsByName = new Map(
  commands.map((command) => [command.data.name, command]),
);
