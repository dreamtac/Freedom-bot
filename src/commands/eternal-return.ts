import { MessageFlags, SlashCommandBuilder } from "discord.js";

import {
  EternalReturnApiError,
  MATCHING_MODE,
  getFreeCharacters,
  getGameResults,
  getRankByNickname,
  getRecentGamesByNickname,
} from "../sources/eternal-return.js";
import {
  createEmptyReferenceData,
  getReferenceData,
} from "../sources/eternal-return-reference.js";
import {
  buildFreeCharactersEmbed,
  buildRankEmbed,
  buildRecentGamesEmbed,
} from "./eternal-return-formatters.js";
import type { BotCommand } from "./types.js";
import { errorDetails } from "../interaction-handler.js";

export const eternalReturnCommand: BotCommand = {
  data: new SlashCommandBuilder()
    .setName("이터널리턴")
    .setDescription("이터널 리턴 전적과 랭크를 조회합니다.")
    .addSubcommand((subcommand) => subcommand
      .setName("전적")
      .setDescription("최근 경기의 순위, 딜량, 장비와 특성을 조회합니다.")
      .addStringOption((option) => option
        .setName("닉네임").setDescription("현재 게임 닉네임").setRequired(true).setMinLength(1).setMaxLength(32))
      .addIntegerOption((option) => option
        .setName("개수").setDescription("표시할 경기 수 (기본 3경기)").setMinValue(1).setMaxValue(5)))
    .addSubcommand((subcommand) => subcommand
      .setName("랭크")
      .setDescription("시즌별 스쿼드 랭크 점수와 순위를 조회합니다.")
      .addStringOption((option) => option
        .setName("닉네임").setDescription("현재 게임 닉네임").setRequired(true).setMinLength(1).setMaxLength(32))
      .addIntegerOption((option) => option
        .setName("시즌").setDescription("API 시즌 ID (게임의 표시 시즌 번호와 다를 수 있습니다.)")
        .setRequired(true).setMinValue(1)))
    .addSubcommand((subcommand) => subcommand
      .setName("무료캐릭터")
      .setDescription("모드별 무료 캐릭터 목록을 조회합니다.")
      .addStringOption((option) => option
        .setName("모드").setDescription("조회할 매칭 모드").setRequired(true)
        .addChoices({ name: "일반", value: "normal" }, { name: "랭크", value: "rank" }))),

  async execute(interaction, context) {
    if (context.erEnabled !== true) {
      await interaction.reply({
        content: "현재 이 봇에서 사용할 수 없는 기능입니다.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    const apiKey = context.erApiKey;
    if (!apiKey) {
      await interaction.reply({
        content: "이터널 리턴 API 키가 아직 설정되지 않았습니다. `.env`에 `ER_API_KEY`를 추가한 뒤 봇을 재시작해 주세요.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await interaction.deferReply();
    const label = `[interaction ${interaction.id}] eternal-return`;
    let stage = "options";
    try {
      const subcommand = interaction.commandName === "전적"
        ? "전적"
        : interaction.options.getSubcommand();
      if (subcommand === "랭크") {
        const nickname = interaction.options.getString("닉네임", true).trim();
        const season = interaction.options.getInteger("시즌", true);
        stage = "rank-api";
        const data = await getRankByNickname(nickname, season, apiKey);
        const embed = buildRankEmbed(nickname, data.userRank)
          .setFooter({ text: `API 시즌 ${season} · 스쿼드` });
        stage = "reply";
        await interaction.editReply({ embeds: [embed] });
        return;
      }

      if (subcommand === "전적") {
        const nickname = interaction.options.getString("닉네임", true).trim();
        const count = interaction.options.getInteger("개수") ?? 3;
        stage = "recent-games-api";
        const collection = context.eternalReturnCollector
          ? await context.eternalReturnCollector.refreshNickname(nickname, "interactive")
          : undefined;
        const games = collection
          ? collection.games.slice(0, count)
          : getGameResults(await getRecentGamesByNickname(nickname, apiKey)).slice(0, count);
        stage = "reference-data";
        const { references, warning } = await loadNames(
          apiKey, games.length > 0, label, context.eternalReturnStore,
        );
        stage = "format";
        const embed = buildRecentGamesEmbed(nickname, games, references);
        if (warning) embed.setFooter({ text: warning });
        stage = "reply";
        await interaction.editReply({ embeds: [embed] });
        if (collection && context.eternalReturnCollector) {
          void context.eternalReturnCollector.backfill(collection.userId, { targetGames: 100 })
            .catch((error: unknown) => {
              console.warn(`${label} backfill-failed`, errorDetails(error));
            });
        }
        return;
      }

      if (subcommand === "무료캐릭터") {
        const mode = interaction.options.getString("모드", true);
        const ranked = mode === "rank";
        stage = "free-characters-api";
        const codes = await getFreeCharacters(ranked ? MATCHING_MODE.rank : MATCHING_MODE.normal, apiKey);
        stage = "reference-data";
        const { references, warning } = await loadNames(
          apiKey, codes.length > 0, label, context.eternalReturnStore,
        );
        stage = "format";
        const embed = buildFreeCharactersEmbed(ranked ? "랭크" : "일반", codes, references);
        if (warning) embed.setFooter({ text: warning });
        stage = "reply";
        await interaction.editReply({ embeds: [embed] });
        return;
      }

      await interaction.editReply("알 수 없는 이터널 리턴 명령어입니다.");
    } catch (error: unknown) {
      console.error(`${label} failed`, { stage, ...errorDetails(error) });
      await interaction.editReply(error instanceof EternalReturnApiError
        ? error.message
        : "이터널 리턴 정보를 조회하는 중 문제가 발생했습니다. 잠시 후 다시 시도해 주세요.");
    }
  },
};

export const eternalReturnRecordCommand: BotCommand = {
  data: new SlashCommandBuilder()
    .setName("전적")
    .setDescription("이터널 리턴 최근 전적을 조회합니다.")
    .addStringOption(option => option
      .setName("닉네임").setDescription("현재 게임 닉네임").setRequired(true).setMinLength(1).setMaxLength(32))
    .addIntegerOption(option => option
      .setName("개수").setDescription("표시할 경기 수 (기본 3경기)").setMinValue(1).setMaxValue(5)),
  execute: eternalReturnCommand.execute,
};

async function loadNames(
  apiKey: string,
  needed: boolean,
  label: string,
  store?: import("../storage/eternal-return-store.js").EternalReturnStore,
) {
  if (!needed) return { references: createEmptyReferenceData(), warning: undefined };
  try {
    return { references: await getReferenceData(apiKey, {}, store), warning: undefined };
  } catch (error: unknown) {
    console.warn(`${label} reference-data-failed`, errorDetails(error));
    return {
      references: createEmptyReferenceData(),
      warning: "이름 데이터를 불러오지 못해 일부 항목을 코드로 표시합니다.",
    };
  }
}
