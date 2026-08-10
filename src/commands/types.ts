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
  notificationChannelId?: string;
  priceAlertMonitor?: PriceAlertRefresher;
  priceAlertStore?: PriceAlertStore;
  realtimeStatusProvider?: RealtimeStatusProvider;
  stockStore?: StockStore;
}
