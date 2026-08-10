import {
  EmbedBuilder,
  MessageFlags,
  SlashCommandBuilder,
} from "discord.js";

import { StockLookupError } from "../sources/domestic-stocks.js";
import {
  KisApiError,
  KisClient,
  normalizeDomesticStockCode,
} from "../sources/kis.js";
import type {
  KisNewsTitle,
  KisOverseasQuote,
  KisStockQuote,
} from "../sources/kis.js";
import { getNxtMarketSession } from "../sources/nxt-market-session.js";
import {
  getOverseasExchangeLabel,
  getOverseasStockCandidates,
  suggestOverseasStocks,
} from "../sources/overseas-stocks.js";
import { getUsMarketSession } from "../sources/us-market-session.js";
import type { BotCommand } from "./types.js";

const DEFAULT_NEWS_COUNT = 7;
const MIN_NEWS_COUNT = 3;
const MAX_NEWS_COUNT = 10;

export const stockNewsCommand: BotCommand = {
  data: new SlashCommandBuilder()
    .setName("뉴스")
    .setDescription("주가 흐름과 함께 해당 종목의 최근 뉴스 제목을 확인합니다.")
    .addStringOption((option) =>
      option
        .setName("종목")
        .setDescription("국내 종목명·코드 또는 미국 티커·종목명입니다. 예: 삼성전자, NVDA")
        .setRequired(true)
        .setAutocomplete(true),
    )
    .addIntegerOption((option) =>
      option
        .setName("개수")
        .setDescription("표시할 최근 뉴스 수입니다. 기본값은 7개입니다.")
        .setMinValue(MIN_NEWS_COUNT)
        .setMaxValue(MAX_NEWS_COUNT),
    ),

  async autocomplete(interaction, context) {
    const focusedValue = interaction.options.getFocused();
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
    if (!context.kis) {
      await interaction.reply({
        content:
          "KIS API 키가 아직 설정되지 않았습니다. `.env`에 `KIS_APP_KEY`와 `KIS_APP_SECRET`을 추가한 뒤 봇을 재시작해 주세요.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const query = interaction.options.getString("종목", true);
    const newsCount = interaction.options.getInteger("개수") ?? DEFAULT_NEWS_COUNT;
    let stock;
    let overseasStock;

    try {
      if (context.stockStore) {
        stock = context.stockStore.resolve(query);
        normalizeDomesticStockCode(stock.code);
      }
    } catch (error: unknown) {
      if (/^\d{6}$/.test(query.trim())) {
        await interaction.reply({
          content: error instanceof Error ? error.message : "종목을 찾지 못했습니다.",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
    }
    if (
      !stock &&
      context.stockStore &&
      "countOverseas" in context.stockStore &&
      context.stockStore.countOverseas()
    ) {
      try {
        overseasStock = context.stockStore.resolveOverseas(query);
      } catch {
        // Direct ticker lookup remains available between master file updates.
      }
    }

    await interaction.deferReply();

    try {
      const client = new KisClient(context.kis);
      if (!stock) {
        const candidates = overseasStock
          ? [overseasStock]
          : getOverseasStockCandidates(query);
        const results = await Promise.allSettled(
          candidates.map(async (candidate) => {
            const quote = await client.fetchOverseasQuote(candidate.symbol, candidate.exchange);
            const newsResult = await Promise.allSettled([
              client.fetchOverseasNewsTitles(candidate.symbol, candidate.exchange, newsCount),
            ]);
            const news = newsResult[0];
            return {
              quote,
              name: candidate.name,
              news: news?.status === "fulfilled" ? news.value : [],
              newsError: news ? getError(news) : undefined,
            };
          }),
        );
        const result = results.find((item) => item.status === "fulfilled");
        if (!result || result.status !== "fulfilled") {
          const firstError = results.find((item) => item.status === "rejected");
          throw firstError?.status === "rejected"
            ? firstError.reason
            : new KisApiError("미국 주식 뉴스 조회에 실패했습니다.");
        }

        await interaction.editReply({
          embeds: [buildStockNewsEmbed({
            code: result.value.quote.symbol,
            ...(result.value.name ? { name: result.value.name } : {}),
            overseasQuote: result.value.quote,
            news: result.value.news,
            ...(result.value.newsError ? { newsError: result.value.newsError } : {}),
          })],
        });
        return;
      }

      const [krxResult, nxtResult, newsResult] = await Promise.allSettled([
        client.fetchDomesticQuote(stock.code, "J"),
        client.fetchDomesticQuote(stock.code, "NX"),
        client.fetchDomesticNewsTitles(stock.code, newsCount),
      ]);
      const krxQuote =
        krxResult.status === "fulfilled" ? krxResult.value : undefined;
      const nxtQuote =
        nxtResult.status === "fulfilled" && isUsableQuote(nxtResult.value)
          ? nxtResult.value
          : undefined;
      const news = newsResult.status === "fulfilled" ? newsResult.value : [];

      if (!krxQuote && !nxtQuote && newsResult.status === "rejected") {
        throw getError(krxResult) ?? getError(nxtResult) ?? getError(newsResult) ?? new KisApiError("뉴스 조회에 실패했습니다.");
      }

      const embedInput: StockNewsEmbedInput = {
        code: stock.code,
        news,
      };
      if (stock.name) {
        embedInput.name = stock.name;
      }
      if (krxQuote) {
        embedInput.krxQuote = krxQuote;
      }
      if (nxtQuote) {
        embedInput.nxtQuote = nxtQuote;
      }
      const newsError = getError(newsResult);
      if (newsError) {
        embedInput.newsError = newsError;
      }

      await interaction.editReply({
        embeds: [buildStockNewsEmbed(embedInput)],
      });
    } catch (error: unknown) {
      const message =
        error instanceof KisApiError
          ? error.message
          : "뉴스를 조회하는 중 문제가 발생했습니다.";
      await interaction.editReply(message);
    }
  },
};

interface StockNewsEmbedInput {
  code: string;
  name?: string;
  krxQuote?: KisStockQuote;
  nxtQuote?: KisStockQuote;
  overseasQuote?: KisOverseasQuote;
  news: readonly KisNewsTitle[];
  newsError?: Error;
}

export function buildStockNewsEmbed({
  code,
  name,
  krxQuote,
  nxtQuote,
  overseasQuote,
  news,
  newsError,
}: StockNewsEmbedInput): EmbedBuilder {
  const primaryQuote = overseasQuote ?? nxtQuote ?? krxQuote;
  const displayName = name ?? krxQuote?.name ?? nxtQuote?.name ?? code;
  const embed = new EmbedBuilder()
    .setColor(primaryQuote ? getQuoteColor(primaryQuote) : 0x667085)
    .setTitle(`${displayName} (${code}) 관련 뉴스`)
    .setDescription(buildDescription(krxQuote, nxtQuote, overseasQuote))
    .addFields({
      name: newsError ? "최근 관련 뉴스 (조회 실패)" : `최근 관련 뉴스 ${news.length}건`,
      value: newsError
        ? `뉴스 제목을 가져오지 못했습니다: ${newsError.message}`
        : formatNewsList(news),
      inline: false,
    })
    .setFooter({
      text: `KIS Open API · ${formatDate(primaryQuote?.requestedAt ?? new Date())}`,
    });

  return embed;
}

function buildDescription(
  krxQuote?: KisStockQuote,
  nxtQuote?: KisStockQuote,
  overseasQuote?: KisOverseasQuote,
): string {
  const lines = ["**주가 흐름**"];

  if (overseasQuote) {
    const session = getUsMarketSession(overseasQuote.requestedAt);
    lines.push(`미국 ${session.label} ${formatOverseasQuote(overseasQuote)}`);
    lines.push(
      `거래소 ${overseasQuote.exchangeName} · ${session.timeZone === "Asia/Seoul" ? "한국" : "미 동부"} 시간 ${session.localTime}`,
    );
  }

  if (!overseasQuote && nxtQuote) {
    lines.push(`${getNxtMarketSession(nxtQuote.requestedAt).label} ${formatQuote(nxtQuote)}`);
  }

  if (!overseasQuote && krxQuote) {
    lines.push(`KRX 정규장 ${formatQuote(krxQuote)}`);
  }

  if (!krxQuote && !nxtQuote && !overseasQuote) {
    lines.push("시세를 가져오지 못했습니다.");
  }

  lines.push("");
  lines.push("뉴스 제목은 변동 원인을 확인하는 단서이며, 인과관계를 단정하지 않습니다.");
  return lines.join("\n");
}

function formatQuote(quote: KisStockQuote): string {
  const prefix =
    quote.changeDirection === "up"
      ? "+"
      : quote.changeDirection === "down"
        ? "-"
        : "";
  return `${formatWon(quote.price)} · 전일 대비 ${prefix}${formatWon(Math.abs(quote.change))} (${prefix}${Math.abs(quote.changeRate).toFixed(2)}%)`;
}

function formatOverseasQuote(quote: KisOverseasQuote): string {
  const prefix =
    quote.changeDirection === "up"
      ? "+"
      : quote.changeDirection === "down"
        ? "-"
        : "";
  return `$${formatNumber(quote.price)} · 전일 대비 ${prefix}$${formatNumber(Math.abs(quote.change))} (${prefix}${Math.abs(quote.changeRate).toFixed(2)}%)`;
}

function formatNewsList(news: readonly KisNewsTitle[]): string {
  if (news.length === 0) {
    return "최근 관련 뉴스 제목이 없습니다.";
  }

  const items: string[] = [];
  let length = 0;
  for (const item of news) {
    const formatted = `- ${formatNewsMeta(item)} ${truncateText(normalizeWhitespace(item.title), 150)}`;
    if (length + formatted.length + 1 > 1_000) {
      break;
    }
    items.push(formatted);
    length += formatted.length + 1;
  }

  return items.length > 0 ? items.join("\n") : "최근 관련 뉴스 제목이 없습니다.";
}

function formatNewsMeta(news: KisNewsTitle): string {
  const dateTime = formatNewsDateTime(news.date, news.time);
  const source = normalizeWhitespace(news.source ?? "");
  const details = [dateTime, source].filter((value) => value.length > 0);
  return details.length > 0 ? `[${details.join(" · ")}]` : "[출처 미상]";
}

function formatNewsDateTime(date?: string, time?: string): string {
  if (!date || !/^\d{8}$/.test(date)) {
    return "";
  }

  const month = Number(date.slice(4, 6));
  const day = Number(date.slice(6, 8));
  if (!time || !/^\d{6}$/.test(time)) {
    return `${month}/${day}`;
  }

  return `${month}/${day} ${time.slice(0, 2)}:${time.slice(2, 4)}`;
}

function getError(
  result: PromiseSettledResult<unknown>,
): Error | undefined {
  return result.status === "rejected" && result.reason instanceof Error
    ? result.reason
    : undefined;
}

function isUsableQuote(quote: KisStockQuote): boolean {
  return (
    quote.price > 0 ||
    (quote.volume ?? 0) > 0 ||
    (quote.open ?? 0) > 0 ||
    (quote.high ?? 0) > 0 ||
    (quote.low ?? 0) > 0
  );
}

function getQuoteColor(quote: Pick<KisStockQuote, "changeDirection">): number {
  if (quote.changeDirection === "up") {
    return 0xd92d20;
  }

  if (quote.changeDirection === "down") {
    return 0x1570ef;
  }

  return 0x667085;
}

interface SuggestionStock {
  code: string;
  name: string;
  market?: string;
}

function formatSuggestionName(stock: SuggestionStock): string {
  const market = stock.market ? ` · ${formatStockMarketName(stock.market)}` : "";
  return `${stock.name} (${stock.code})${market}`;
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

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function truncateText(value: string, maximumLength: number): string {
  return value.length > maximumLength
    ? `${value.slice(0, maximumLength - 3)}...`
    : value;
}

function formatWon(value: number): string {
  return `${new Intl.NumberFormat("ko-KR").format(value)}원`;
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 2,
  }).format(value);
}

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat("ko-KR", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Seoul",
  }).format(date);
}
