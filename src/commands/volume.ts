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
import type { KisDailyPrice, KisOverseasQuote, KisStockQuote } from "../sources/kis.js";
import {
  getOverseasExchangeLabel,
  getOverseasStockCandidates,
  suggestOverseasStocks,
} from "../sources/overseas-stocks.js";
import type { BotCommand } from "./types.js";

const DEFAULT_AVERAGE_DAYS = 20;
const MIN_AVERAGE_DAYS = 5;
const MAX_AVERAGE_DAYS = 30;

export const volumeCommand: BotCommand = {
  data: new SlashCommandBuilder()
    .setName("거래량")
    .setDescription("오늘 누적 거래량이 최근 평균보다 많은지 확인합니다.")
    .addStringOption((option) =>
      option
        .setName("종목")
        .setDescription("국내 종목명·코드 또는 미국 티커·종목명입니다. 예: 삼성전자, NVDA")
        .setRequired(true)
        .setAutocomplete(true),
    )
    .addIntegerOption((option) =>
      option
        .setName("평균일수")
        .setDescription("비교할 최근 거래일 수입니다. 기본값은 20일입니다.")
        .setMinValue(MIN_AVERAGE_DAYS)
        .setMaxValue(MAX_AVERAGE_DAYS),
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
    const averageDays =
      interaction.options.getInteger("평균일수") ?? DEFAULT_AVERAGE_DAYS;
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
        // Direct ticker lookup remains available for new symbols between master updates.
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
            const [quote, dailyPrices] = await Promise.all([
              client.fetchOverseasQuote(candidate.symbol, candidate.exchange),
              client.fetchOverseasDailyPrices(candidate.symbol, candidate.exchange, averageDays + 1),
            ]);
            return { quote, dailyPrices, name: candidate.name };
          }),
        );
        const result = results.find((item) => item.status === "fulfilled");
        if (!result || result.status !== "fulfilled") {
          const firstError = results.find((item) => item.status === "rejected");
          throw firstError?.status === "rejected"
            ? firstError.reason
            : new KisApiError("미국 주식 거래량을 찾지 못했습니다.");
        }
        const analysis = analyzeVolume({
          todayVolume: result.value.quote.volume ?? 0,
          averageDays,
          dailyPrices: result.value.dailyPrices,
          timeZone: "America/New_York",
        });
        await interaction.editReply({
          embeds: [buildOverseasVolumeEmbed(result.value.quote, result.value.name, analysis)],
        });
        return;
      }
      const [krxQuote, nxtResult, dailyPrices] = await Promise.all([
        client.fetchDomesticQuote(stock.code, "J"),
        client.fetchDomesticQuote(stock.code, "NX").catch((error: unknown) => error),
        client.fetchDomesticDailyPrices(stock.code, averageDays + 1),
      ]);
      const nxtQuote =
        !isKisStockQuote(nxtResult) || !isUsableQuote(nxtResult)
          ? undefined
          : nxtResult;
      const analysis = analyzeVolume({
        todayVolume: (krxQuote.volume ?? 0) + (nxtQuote?.volume ?? 0),
        averageDays,
        dailyPrices,
      });
      const embedInput: {
        code: string;
        name?: string;
        krxQuote: KisStockQuote;
        nxtQuote?: KisStockQuote;
        analysis: VolumeAnalysis;
      } = {
        code: stock.code,
        krxQuote,
        analysis,
      };
      const displayName = stock.name ?? krxQuote.name;
      if (displayName) {
        embedInput.name = displayName;
      }
      if (nxtQuote) {
        embedInput.nxtQuote = nxtQuote;
      }

      await interaction.editReply({
        embeds: [buildVolumeEmbed(embedInput)],
      });
    } catch (error: unknown) {
      const message =
        error instanceof KisApiError
          ? error.message
          : "거래량을 분석하는 중 문제가 발생했습니다.";
      await interaction.editReply(message);
    }
  },
};

interface VolumeAnalysisInput {
  todayVolume: number;
  averageDays: number;
  dailyPrices: readonly KisDailyPrice[];
  timeZone?: string;
}

interface VolumeAnalysis {
  todayVolume: number;
  averageVolume: number;
  averageDays: number;
  ratio: number;
  status: "active" | "normal" | "quiet";
  sampleDays: number;
}

export function analyzeVolume({
  todayVolume,
  averageDays,
  dailyPrices,
  timeZone = "Asia/Seoul",
}: VolumeAnalysisInput): VolumeAnalysis {
  const previousVolumes = dailyPrices
    .filter((price) => !isTodayPrice(price, timeZone))
    .map((price) => price.volume)
    .filter((volume) => volume > 0)
    .slice(0, averageDays);

  if (previousVolumes.length === 0) {
    throw new KisApiError("평균 거래량을 계산할 과거 거래량이 없습니다.");
  }

  const averageVolume =
    previousVolumes.reduce((sum, volume) => sum + volume, 0) /
    previousVolumes.length;
  const ratio = averageVolume > 0 ? todayVolume / averageVolume : 0;

  return {
    todayVolume,
    averageVolume,
    averageDays,
    ratio,
    status: getVolumeStatus(ratio),
    sampleDays: previousVolumes.length,
  };
}

function buildOverseasVolumeEmbed(
  quote: KisOverseasQuote,
  name: string | undefined,
  analysis: VolumeAnalysis,
): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(getStatusColor(analysis.status))
    .setTitle(`${name ?? quote.symbol} (${quote.symbol}) 거래량`)
    .setDescription(formatVolumeSummary(analysis))
    .addFields(
      {
        name: "오늘 누적",
        value: `${formatNumber(analysis.todayVolume)}주\n${quote.exchangeName} 정규장`,
        inline: false,
      },
      {
        name: "최근 평균",
        value: `${analysis.sampleDays}거래일 평균 ${formatNumber(Math.round(analysis.averageVolume))}주`,
        inline: false,
      },
      { name: "해석", value: getStatusText(analysis.status), inline: false },
    )
    .setFooter({ text: `KIS Open API · ${formatDate(quote.requestedAt)}` });
}

function buildVolumeEmbed({
  code,
  name,
  krxQuote,
  nxtQuote,
  analysis,
}: {
  code: string;
  name?: string;
  krxQuote: KisStockQuote;
  nxtQuote?: KisStockQuote;
  analysis: VolumeAnalysis;
}): EmbedBuilder {
  const title = `${name ?? code} (${code}) 거래량`;
  const embed = new EmbedBuilder()
    .setColor(getStatusColor(analysis.status))
    .setTitle(title)
    .setDescription(formatVolumeSummary(analysis))
    .addFields(
      {
        name: "오늘 누적",
        value: [
          `전체 ${formatNumber(analysis.todayVolume)}주`,
          `KRX ${formatNumber(krxQuote.volume ?? 0)}주`,
          `NXT ${nxtQuote?.volume ? formatNumber(nxtQuote.volume) : "-"}주`,
        ].join("\n"),
        inline: false,
      },
      {
        name: "최근 평균",
        value: `${analysis.sampleDays}거래일 평균 ${formatNumber(Math.round(analysis.averageVolume))}주`,
        inline: false,
      },
      {
        name: "해석",
        value: getStatusText(analysis.status),
        inline: false,
      },
    )
    .setFooter({
      text: `KIS Open API · ${formatDate(krxQuote.requestedAt)}`,
    });

  return embed;
}

function formatVolumeSummary(analysis: VolumeAnalysis): string {
  return `**평균 대비 ${formatPercent(analysis.ratio)}**\n${getStatusLabel(analysis.status)}`;
}

function getVolumeStatus(ratio: number): VolumeAnalysis["status"] {
  if (ratio >= 1.5) {
    return "active";
  }

  if (ratio <= 0.5) {
    return "quiet";
  }

  return "normal";
}

function getStatusLabel(status: VolumeAnalysis["status"]): string {
  if (status === "active") {
    return "거래가 평소보다 활발합니다.";
  }

  if (status === "quiet") {
    return "거래가 평소보다 한산합니다.";
  }

  return "평균적인 거래량 범위입니다.";
}

function getStatusText(status: VolumeAnalysis["status"]): string {
  if (status === "active") {
    return "평균보다 거래가 많이 붙고 있어 관심이 커진 상태로 볼 수 있습니다.";
  }

  if (status === "quiet") {
    return "평균보다 거래가 적어 아직 수급이 강하게 붙었다고 보긴 어렵습니다.";
  }

  return "평균과 크게 다르지 않은 수준입니다.";
}

function getStatusColor(status: VolumeAnalysis["status"]): number {
  if (status === "active") {
    return 0xd92d20;
  }

  if (status === "quiet") {
    return 0x667085;
  }

  return 0x1570ef;
}

function isTodayPrice(price: KisDailyPrice, timeZone: string): boolean {
  if (!price.date || !/^\d{8}$/.test(price.date)) {
    return false;
  }

  const now = new Date();
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  })
    .format(now)
    .replaceAll("-", "");

  return price.date === today;
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

function isKisStockQuote(value: unknown): value is KisStockQuote {
  if (!value || typeof value !== "object") {
    return false;
  }

  return (
    "price" in value &&
    typeof (value as { price?: unknown }).price === "number"
  );
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

function formatNumber(value: number): string {
  return new Intl.NumberFormat("ko-KR", {
    maximumFractionDigits: 0,
  }).format(value);
}

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(0)}%`;
}

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat("ko-KR", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Seoul",
  }).format(date);
}
