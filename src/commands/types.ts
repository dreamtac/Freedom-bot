import type {
  AutocompleteInteraction,
  ChatInputCommandInteraction,
  SlashCommandBuilder,
  SlashCommandOptionsOnlyBuilder,
  SlashCommandSubcommandsOnlyBuilder,
} from "discord.js";
import type { KisConfig } from "../config.js";
import type { KisRealtimeStatus } from "../sources/kis-realtime.js";
import type { PriceAlertStore } from "../storage/price-alert-store.js";
import type { StockStore } from "../storage/stock-store.js";
import type { EternalReturnStore } from "../storage/eternal-return-store.js";
import type { EternalReturnCollector } from "../services/eternal-return-collector.js";
import type { EternalReturnProfileService } from "../services/eternal-return-profile.js";

export interface PriceAlertRefresher {
  refresh(): void;
}

export interface RealtimeStatusProvider {
  getStatus(): KisRealtimeStatus;
}

export interface BotCommand {
  data:
    | SlashCommandBuilder
    | SlashCommandOptionsOnlyBuilder
    | SlashCommandSubcommandsOnlyBuilder;
  execute(
    interaction: ChatInputCommandInteraction,
    context: BotCommandContext,
  ): Promise<void>;
  autocomplete?(
    interaction: AutocompleteInteraction,
    context: BotCommandContext,
  ): Promise<void>;
}

export interface BotCommandContext {
  kis?: KisConfig;
  erEnabled?: boolean;
  erReceiptsEnabled?: boolean;
  erApiKey?: string;
  eternalReturnStore?: EternalReturnStore;
  eternalReturnCollector?: EternalReturnCollector;
  eternalReturnProfileService?: EternalReturnProfileService;
  notificationChannelId?: string;
  priceAlertMonitor?: PriceAlertRefresher;
  priceAlertStore?: PriceAlertStore;
  realtimeStatusProvider?: RealtimeStatusProvider;
  stockStore?: StockStore;
}
