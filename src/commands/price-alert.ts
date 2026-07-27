import {
  EmbedBuilder,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from "discord.js";

import {
  normalizeStockName,
  StockLookupError,
} from "../sources/domestic-stocks.js";
import { KisApiError, KisClient, normalizeDomesticStockCode } from "../sources/kis.js";
import {
  getOverseasExchangeLabel,
  getOverseasStockCandidates,
  suggestOverseasStocks,
} from "../sources/overseas-stocks.js";
import type { KisConfig } from "../config.js";
import { MAX_PRICE_ALERT_STOCKS } from "../storage/price-alert-store.js";
import type { PriceAlertStock } from "../storage/price-alert-store.js";
import type { StockStore } from "../storage/stock-store.js";
import type { BotCommand } from "./types.js";

export const priceAlertCommand: BotCommand = {
  data: new SlashCommandBuilder()
    .setName("주가알림")
    .setDescription("시가 대비 등락률 실시간 알림 종목을 관리합니다.")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDMPermission(false)
    .addSubcommand((subcommand) =>
      subcommand
        .setName("추가")
        .setDescription("종목을 실시간 주가 알림에 추가합니다.")
        .addStringOption((option) =>
          option
            .setName("종목")
            .setDescription("국내 종목명·코드 또는 미국 티커·종목명입니다.")
            .setRequired(true)
            .setAutocomplete(true),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("삭제")
        .setDescription("종목을 실시간 주가 알림에서 제거합니다.")
        .addStringOption((option) =>
          option
            .setName("종목")
            .setDescription("삭제할 등록 종목입니다.")
            .setRequired(true)
            .setAutocomplete(true),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("목록")
        .setDescription("현재 실시간 주가 알림 종목을 확인합니다."),
    ),

  async autocomplete(interaction, context) {
    const focusedValue = interaction.options.getFocused();
    const subcommand = interaction.options.getSubcommand(false);
    if (subcommand === "삭제" && context.priceAlertStore) {
      await interaction.respond(
        context.priceAlertStore
          .list()
          .filter((stock) => matchesQuery(stock, focusedValue))
          .slice(0, 25)
          .map((stock) => ({
            name: formatSuggestionName(stock),
            value: stock.code,
          })),
      );
      return;
    }

    const domestic = context.stockStore?.suggest(focusedValue) ?? [];
    const storedOverseas =
      context.stockStore &&
      "suggestOverseas" in context.stockStore &&
      typeof context.stockStore.suggestOverseas === "function"
        ? context.stockStore.suggestOverseas(focusedValue, 25 - domestic.length)
        : [];
    const overseas = storedOverseas.length > 0
      ? storedOverseas
      : suggestOverseasStocks(focusedValue, 25 - domestic.length);
    await interaction.respond([
      ...domestic.map((stock) => ({ name: formatSuggestionName(stock), value: stock.code })),
      ...overseas.map((stock) => ({
        name: `${stock.name} (${stock.symbol}) · ${getOverseasExchangeLabel(stock.exchange)}`,
        value: stock.symbol,
      })),
    ]);
  },

  async execute(interaction, context) {
    const subcommand = interaction.options.getSubcommand(true);
    if (!context.priceAlertStore) {
      await interaction.reply({
        content: "주가 알림 저장소를 열지 못했습니다.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (subcommand === "목록") {
      await interaction.reply({
        embeds: [buildPriceAlertListEmbed(context.priceAlertStore.list())],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (subcommand === "추가") {
      if (!context.kis || !context.notificationChannelId) {
        await interaction.reply({
          content:
            "실시간 주가 알림에는 KIS API 키와 `DISCORD_NOTIFICATION_CHANNEL_ID` 설정이 모두 필요합니다.",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      const stock = await resolveStock(
        interaction.options.getString("종목", true),
        context.stockStore,
        context.kis,
      );
      if (stock instanceof Error) {
        await interaction.reply({ content: stock.message, flags: MessageFlags.Ephemeral });
        return;
      }

      try {
        const added = context.priceAlertStore.add(stock);
        context.priceAlertMonitor?.refresh();
        await interaction.reply({
          content: added
            ? `${stock.name} (${stock.code})을 실시간 주가 알림에 추가했습니다. 당일 시가 대비 +/-3%, 5%, 8%, 10% 돌파를 감시합니다.`
            : `${stock.name} (${stock.code})은 이미 실시간 주가 알림에 등록되어 있습니다.`,
          flags: MessageFlags.Ephemeral,
        });
      } catch (error: unknown) {
        await interaction.reply({
          content:
            error instanceof Error
              ? error.message
              : "주가 알림 종목을 추가하지 못했습니다.",
          flags: MessageFlags.Ephemeral,
        });
      }
      return;
    }

    const code = interaction.options.getString("종목", true).trim().toUpperCase();
    const removed = context.priceAlertStore.remove(code);
    if (removed) {
      context.priceAlertMonitor?.refresh();
    }
    await interaction.reply({
      content: removed
        ? `${code} 종목을 실시간 주가 알림에서 제거했습니다.`
        : "등록된 실시간 주가 알림 종목이 아닙니다.",
      flags: MessageFlags.Ephemeral,
    });
  },
};

async function resolveStock(
  query: string,
  stockStore: StockStore | undefined,
  kis: KisConfig,
): Promise<Omit<PriceAlertStock, "createdAt"> | Error> {
  try {
    if (stockStore) {
      try {
        const stock = stockStore.resolve(query);
        const code = normalizeDomesticStockCode(stock.code);
        return {
          code,
          name: stock.name ?? code,
          assetType: "domestic",
          ...(stock.market ? { market: stock.market } : {}),
        };
      } catch (error: unknown) {
        if (/^\d{6}$/.test(query.trim())) throw error;
      }

      if (
        "countOverseas" in stockStore &&
        stockStore.countOverseas() > 0
      ) {
        try {
          const stock = stockStore.resolveOverseas(query);
          return {
            code: stock.symbol,
            name: stock.name ?? stock.symbol,
            assetType: "overseas",
            exchange: stock.exchange,
          };
        } catch {
          // New ticker symbols can still be validated against KIS below.
        }
      }
    }
    const candidates = getOverseasStockCandidates(query);
    const results = await Promise.allSettled(
      candidates.map((candidate) =>
        new KisClient(kis).fetchOverseasQuote(candidate.symbol, candidate.exchange).then(() => candidate),
      ),
    );
    const result = results.find((item) => item.status === "fulfilled");
    if (!result || result.status !== "fulfilled") {
      const firstError = results.find((item) => item.status === "rejected");
      throw firstError?.status === "rejected"
        ? firstError.reason
        : new KisApiError("미국 주식 시세를 찾지 못했습니다.");
    }
    const stock = result.value;
    return {
      code: stock.symbol,
      name: stock.name ?? stock.symbol,
      assetType: "overseas",
      exchange: stock.exchange,
    };
  } catch (error: unknown) {
    return error instanceof Error
      ? error
      : new StockLookupError("종목을 찾지 못했습니다.");
  }
}

function buildPriceAlertListEmbed(stocks: readonly PriceAlertStock[]): EmbedBuilder {
  const description =
    stocks.length === 0
      ? "등록된 종목이 없습니다. `/주가알림 추가`로 관심 종목을 등록해 주세요."
      : stocks
          .map((stock, index) => `${index + 1}. ${stock.name} (${stock.code})${getAlertMarketLabel(stock)}`)
          .join("\n");

  return new EmbedBuilder()
    .setColor(0x1570ef)
    .setTitle("실시간 주가 알림 종목")
    .setDescription(description)
    .setFooter({
      text: `${stocks.length}/${MAX_PRICE_ALERT_STOCKS}종목 · 시가 대비 +/-3%, 5%, 8%, 10%`,
    });
}

function matchesQuery(stock: PriceAlertStock, query: string): boolean {
  const normalizedQuery = normalizeStockName(query);
  return (
    normalizedQuery.length === 0 ||
    stock.code.toLowerCase().includes(normalizedQuery) ||
    normalizeStockName(stock.name).includes(normalizedQuery)
  );
}

function formatSuggestionName(stock: { code: string; name: string; market?: string }): string {
  const market = stock.market ? ` · ${formatStockMarketName(stock.market)}` : "";
  return `${stock.name} (${stock.code})${market}`;
}

function getAlertMarketLabel(stock: PriceAlertStock): string {
  if (stock.assetType === "overseas" && stock.exchange) {
    return ` · ${getOverseasExchangeLabel(stock.exchange)}`;
  }
  return stock.market ? ` · ${formatStockMarketName(stock.market)}` : "";
}

function formatStockMarketName(market: string): string {
  if (market === "유가" || market === "유가증권" || market.toUpperCase() === "KOSPI") {
    return "코스피";
  }
  if (market.toUpperCase() === "KOSDAQ") {
    return "코스닥";
  }
  return market;
}
