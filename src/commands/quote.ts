import {
  EmbedBuilder,
  MessageFlags,
  SlashCommandBuilder,
} from "discord.js";

import {
  StockLookupError,
} from "../sources/domestic-stocks.js";
import { KisApiError, KisClient, normalizeDomesticStockCode } from "../sources/kis.js";
import type {
  DomesticMarketCode,
  KisDomesticInvestorFlow,
  KisOverseasQuote,
  KisStockQuote,
} from "../sources/kis.js";
import {
  getOverseasExchangeLabel,
  getOverseasStockCandidates,
  suggestOverseasStocks,
} from "../sources/overseas-stocks.js";
import { getNxtMarketSession } from "../sources/nxt-market-session.js";
import { getUsMarketSession } from "../sources/us-market-session.js";
import type { BotCommand } from "./types.js";

export const quoteCommand: BotCommand = {
  data: new SlashCommandBuilder()
    .setName("시세")
    .setDescription("한국투자증권 API로 국내·미국 주식 현재가를 조회합니다.")
    .addStringOption((option) =>
      option
        .setName("종목")
        .setDescription("국내 종목명·코드 또는 미국 티커·종목명입니다. 예: 삼성전자, NVDA")
        .setRequired(true)
        .setAutocomplete(true),
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
    await interaction.respond(
      [
        ...domestic.map((stock) => ({ name: formatSuggestionName(stock), value: stock.code })),
        ...overseas.map((stock) => ({
          name: `${stock.name} (${stock.symbol}) · ${getOverseasExchangeLabel(stock.exchange)}`,
          value: stock.symbol,
        })),
      ],
    );
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

    const query =
      interaction.options.getString("종목", false) ??
      interaction.options.getString("종목코드", false);
    if (!query) {
      await interaction.reply({
        content: "조회할 종목을 입력해 주세요. 예: `005930`, `삼성전자`, `NVDA`",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

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
        // The curated list and direct ticker lookup remain available before a match is found.
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
          candidates.map((candidate) =>
            client.fetchOverseasQuote(candidate.symbol, candidate.exchange).then((quote) => ({
              quote,
              name: candidate.name,
            })),
          ),
        );
        const result = results.find((item) => item.status === "fulfilled");
        if (!result || result.status !== "fulfilled") {
          const firstError = results.find((item) => item.status === "rejected");
          throw firstError?.status === "rejected"
            ? firstError.reason
            : new KisApiError("미국 주식 시세를 찾지 못했습니다.");
        }
        await interaction.editReply({
          embeds: [buildOverseasQuoteEmbed(result.value.quote, result.value.name, query)],
        });
        return;
      }
      const [krxResult, nxtResult, investorResult] = await Promise.allSettled([
        client.fetchDomesticQuote(stock.code, "J"),
        client.fetchDomesticQuote(stock.code, "NX"),
        client.fetchDomesticInvestorFlow(stock.code),
      ]);
      const krxQuote =
        krxResult.status === "fulfilled" ? krxResult.value : undefined;
      const nxtQuote =
        nxtResult.status === "fulfilled" && isUsableQuote(nxtResult.value)
          ? nxtResult.value
          : undefined;

      if (!krxQuote && !nxtQuote) {
        const krxError =
          krxResult.status === "rejected"
            ? getQuoteError(krxResult.reason)
            : undefined;
        const nxtError =
          nxtResult.status === "rejected"
            ? getQuoteError(nxtResult.reason)
            : undefined;
        throw krxError ?? nxtError ?? new KisApiError("시세 조회에 실패했습니다.");
      }

      const embedInput: QuoteEmbedInput = {};
      if (krxQuote) {
        embedInput.krxQuote = krxQuote;
      }
      if (nxtQuote) {
        embedInput.nxtQuote = nxtQuote;
      }
      if (stock.name) {
        embedInput.resolvedName = stock.name;
      }
      embedInput.query = query;
      if (nxtResult.status === "rejected") {
        const nxtError = getQuoteError(nxtResult.reason);
        if (nxtError) {
          embedInput.nxtError = nxtError;
        }
      }
      if (investorResult.status === "fulfilled") {
        embedInput.investorFlow = investorResult.value;
      }

      await interaction.editReply({
        embeds: [buildQuoteEmbed(embedInput)],
      });
    } catch (error: unknown) {
      const message =
        error instanceof KisApiError
          ? error.message
          : "시세를 조회하는 중 문제가 발생했습니다.";
      await interaction.editReply(message);
    }
  },
};

interface SuggestionStock {
  code: string;
  name: string;
  market?: string;
}

function formatSuggestionName(stock: SuggestionStock): string {
  const market = stock.market ? ` · ${formatStockMarketName(stock.market)}` : "";
  return `${stock.name} (${stock.code})${market}`;
}

interface QuoteEmbedInput {
  krxQuote?: KisStockQuote;
  nxtQuote?: KisStockQuote;
  nxtError?: Error;
  investorFlow?: KisDomesticInvestorFlow;
  query?: string;
  resolvedName?: string;
}

export function buildQuoteEmbed({
  krxQuote,
  nxtQuote,
  nxtError,
  investorFlow,
  query,
  resolvedName,
}: QuoteEmbedInput): EmbedBuilder {
  const visibleNxtQuote = shouldDisplayNxtQuote(nxtQuote, krxQuote);
  const visibleNxtError = visibleNxtQuote || !krxQuote ? nxtError : undefined;
  const primaryQuote = visibleNxtQuote ?? krxQuote ?? nxtQuote;
  if (!primaryQuote) {
    throw new KisApiError("표시할 시세가 없습니다.");
  }

  const displayName = resolvedName ?? primaryQuote.name ?? primaryQuote.code;
  const embed = new EmbedBuilder()
    .setColor(getQuoteColor(primaryQuote))
    .setTitle(`${displayName} (${primaryQuote.code})`)
    .setDescription(buildSummaryDescription(krxQuote, visibleNxtQuote, visibleNxtError))
    .addFields(
      ...buildQuoteFields(visibleNxtQuote, krxQuote, visibleNxtError, investorFlow),
      ...buildMetaFields(primaryQuote, query, resolvedName),
    )
    .setFooter({
      text: `KIS Open API · ${formatDate(primaryQuote.requestedAt)}`,
    });

  return embed;
}

function buildOverseasQuoteEmbed(
  quote: KisOverseasQuote,
  resolvedName: string | undefined,
  query: string,
): EmbedBuilder {
  const name = resolvedName ?? quote.symbol;
  const session = getUsMarketSession(quote.requestedAt);
  const prefix = quote.changeDirection === "up" ? "+" : quote.changeDirection === "down" ? "-" : "";
  const change = `$${formatNumber(Math.abs(quote.change))}`;
  return new EmbedBuilder()
    .setColor(getOverseasQuoteColor(quote))
    .setTitle(`${name} (${quote.symbol})`)
    .setDescription(`**현재가 $${formatNumber(quote.price)}**\n전일 대비 ${prefix}${change} (${prefix}${Math.abs(quote.changeRate).toFixed(2)}%)`)
    .addFields(
      {
        name: `미국 ${session.label}`,
        value: [
          `거래소 ${quote.exchangeName}`,
          `${session.timeZone === "Asia/Seoul" ? "한국" : "미 동부"} 시간 ${session.localTime}`,
          `거래량 ${quote.volume === undefined ? "-" : formatNumber(quote.volume)}`,
          `전일 종가 ${quote.previousClose === undefined ? "-" : `$${formatNumber(quote.previousClose)}`}`,
        ].join("\n"),
        inline: false,
      },
      {
        name: "조회 정보",
        value: query.toUpperCase() === quote.symbol
          ? `티커 ${quote.symbol}`
          : `검색어 ${query} -> ${name}(${quote.symbol})`,
        inline: false,
      },
    )
    .setFooter({ text: `KIS Open API · ${formatDate(quote.requestedAt)}` });
}

function buildSummaryDescription(
  krxQuote?: KisStockQuote,
  nxtQuote?: KisStockQuote,
  nxtError?: Error,
): string {
  const lines: string[] = [];
  if (nxtQuote) {
    lines.push(`**${getNxtQuoteLabel(nxtQuote)}: ${formatWon(nxtQuote.price)}**`);
    lines.push(formatDirection(nxtQuote));
  } else if (nxtError) {
    lines.push(`NXT 시세를 가져오지 못했습니다: ${nxtError.message}`);
  }

  if (krxQuote) {
    if (lines.length > 0) {
      lines.push("");
    }
    lines.push(`**KRX 정규장: ${formatWon(krxQuote.price)}**`);
    lines.push(formatDirection(krxQuote));
  }

  if (krxQuote && nxtQuote && krxQuote.price !== nxtQuote.price) {
    const difference = nxtQuote.price - krxQuote.price;
    const differenceRate = (difference / krxQuote.price) * 100;
    lines.push("");
    lines.push(
      `NXT는 KRX 대비 ${formatSignedWon(difference)} (${formatSignedPercent(differenceRate)})`,
    );
  }

  return lines.join("\n");
}

function shouldDisplayNxtQuote(
  nxtQuote: KisStockQuote | undefined,
  krxQuote: KisStockQuote | undefined,
): KisStockQuote | undefined {
  if (!nxtQuote) {
    return undefined;
  }

  const session = getNxtMarketSession(nxtQuote.requestedAt);
  if (
    session.kind === "pre" ||
    session.kind === "after" ||
    session.kind === "closed" ||
    !krxQuote
  ) {
    return nxtQuote;
  }

  return undefined;
}

function buildQuoteFields(
  nxtQuote?: KisStockQuote,
  krxQuote?: KisStockQuote,
  nxtError?: Error,
  investorFlow?: KisDomesticInvestorFlow,
) {
  const fields: Array<{ name: string; value: string; inline: boolean }> = [];

  if (nxtQuote) {
    fields.push({
      name: getNxtQuoteLabel(nxtQuote),
      value: formatQuoteDetail(nxtQuote),
      inline: false,
    });
  } else if (nxtError) {
    fields.push({
      name: "NXT 시세",
      value: `조회 실패: ${nxtError.message}`,
      inline: false,
    });
  }

  if (krxQuote) {
    fields.push({
      name: "KRX 정규장",
      value: formatQuoteDetail(krxQuote),
      inline: false,
    });
  }

  if (investorFlow) {
    fields.push({
      name: "수급 (최근 확정)",
      value: formatInvestorFlow(investorFlow),
      inline: false,
    });
  }

  return fields;
}

function getNxtQuoteLabel(quote: KisStockQuote): string {
  const session = getNxtMarketSession(quote.requestedAt);
  return session.kind === "closed" ? "NXT 종가" : session.label;
}

function formatInvestorFlow(flow: KisDomesticInvestorFlow): string {
  return [
    `개인 ${formatInvestorParticipant(flow.personal)}`,
    `외국인 ${formatInvestorParticipant(flow.foreign)}`,
    `기관 ${formatInvestorParticipant(flow.institution)}`,
    flow.date ? `기준 ${formatInvestorDate(flow.date)} · 장 마감 후 확정` : "장 마감 후 확정",
  ].join("\n");
}

function formatInvestorParticipant(
  flow: KisDomesticInvestorFlow["personal"],
): string {
  const netLabel = flow.netBuyVolume > 0 ? "순매수" : flow.netBuyVolume < 0 ? "순매도" : "순매수";
  const netValue = formatSignedVolume(flow.netBuyVolume);
  if (flow.buyVolume === undefined || flow.sellVolume === undefined) {
    return `${netLabel} ${netValue}`;
  }
  return `매수 ${formatNumber(flow.buyVolume)}주 · 매도 ${formatNumber(flow.sellVolume)}주 · ${netLabel} ${netValue}`;
}

function formatSignedVolume(value: number): string {
  const sign = value > 0 ? "+" : value < 0 ? "-" : "";
  return `${sign}${formatNumber(Math.abs(value))}주`;
}

function formatInvestorDate(value: string): string {
  if (!/^\d{8}$/.test(value)) return value;
  return `${value.slice(0, 4)}.${value.slice(4, 6)}.${value.slice(6, 8)}`;
}

function buildMetaFields(
  primaryQuote: KisStockQuote,
  query?: string,
  resolvedName?: string,
) {
  const fields: Array<{ name: string; value: string; inline: boolean }> = [];
  const matchedText =
    query && resolvedName && query !== primaryQuote.code
      ? `검색어 ${query} -> ${resolvedName}(${primaryQuote.code})`
      : `종목코드 ${primaryQuote.code}`;

  fields.push({
    name: "조회 정보",
    value: `${matchedText}\n기준 시장 ${getMarketLabel(primaryQuote)}`,
    inline: false,
  });

  return fields;
}

function formatQuoteDetail(quote: KisStockQuote): string {
  const parts = [
    `현재가 ${formatWon(quote.price)}`,
    formatDirection(quote),
    `거래량 ${quote.volume === undefined ? "-" : formatNumber(quote.volume)}`,
    `시가 ${quote.open === undefined ? "-" : formatWon(quote.open)} · 고가 ${
      quote.high === undefined ? "-" : formatWon(quote.high)
    } · 저가 ${quote.low === undefined ? "-" : formatWon(quote.low)}`,
  ];

  return parts.join("\n");
}

function formatDirection(quote: KisStockQuote): string {
  const prefix =
    quote.changeDirection === "up"
      ? "+"
      : quote.changeDirection === "down"
        ? "-"
        : "";
  const absoluteChange = Math.abs(quote.change);
  const absoluteRate = Math.abs(quote.changeRate);

  return `전일 대비 ${prefix}${formatWon(absoluteChange)} (${prefix}${absoluteRate.toFixed(2)}%)`;
}

function getMarketLabel(quote: KisStockQuote): string {
  return `${getMarketCodeLabel(quote.marketCode)}${quote.marketName ? ` · ${formatStockMarketName(quote.marketName)}` : ""}`;
}

function getMarketCodeLabel(marketCode: DomesticMarketCode): string {
  return marketCode === "NX" ? "NXT" : "KRX";
}

function formatStockMarketName(market?: string): string {
  if (!market) {
    return "";
  }

  if (market === "유가" || market === "유가증권") {
    return "코스피";
  }

  if (market.toUpperCase() === "KOSPI") {
    return "코스피";
  }

  if (market.toUpperCase() === "KOSDAQ") {
    return "코스닥";
  }

  return market;
}

function getQuoteColor(quote: KisStockQuote): number {
  if (quote.changeDirection === "up") {
    return 0xd92d20;
  }

  if (quote.changeDirection === "down") {
    return 0x1570ef;
  }

  return 0x667085;
}

function getOverseasQuoteColor(quote: KisOverseasQuote): number {
  if (quote.changeDirection === "up") return 0xd92d20;
  if (quote.changeDirection === "down") return 0x1570ef;
  return 0x667085;
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

function formatWon(value: number): string {
  return `${formatNumber(value)}원`;
}

function formatSignedWon(value: number): string {
  const prefix = value > 0 ? "+" : value < 0 ? "-" : "";
  return `${prefix}${formatWon(Math.abs(value))}`;
}

function formatSignedPercent(value: number): string {
  const prefix = value > 0 ? "+" : value < 0 ? "-" : "";
  return `${prefix}${Math.abs(value).toFixed(2)}%`;
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat("ko-KR", {
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

function getQuoteError(error: unknown): Error | undefined {
  return error instanceof Error ? error : undefined;
}
