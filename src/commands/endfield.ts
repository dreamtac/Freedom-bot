import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
  EmbedBuilder,
  MessageFlags,
  SlashCommandBuilder,
} from "discord.js";

import { fetchAllEndfieldNews } from "../sources/endfield.js";
import type { NewsPost } from "../sources/types.js";
import type { BotCommand } from "./types.js";

const PAGE_SIZE = 10;
const COMPONENT_TTL_MS = 120_000;
const CATEGORY_NAMES: Readonly<Record<string, string>> = {
  notices: "공지",
  events: "이벤트",
  news: "뉴스",
};

export const endfieldCommand: BotCommand = {
  data: new SlashCommandBuilder()
    .setName("엔드필드")
    .setDescription("명일방주: 엔드필드 공지를 확인합니다.")
    .addSubcommand((subcommand) =>
      subcommand
        .setName("공지")
        .setDescription("공식 홈페이지의 전체 공지 목록을 확인합니다.")
        .addIntegerOption((option) =>
          option
            .setName("페이지")
            .setDescription("처음 열 페이지입니다.")
            .setMinValue(1),
        ),
    ),

  async execute(interaction) {
    if (interaction.options.getSubcommand() !== "공지") {
      await interaction.reply({
        content: "알 수 없는 엔드필드 명령어입니다.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const posts = await fetchAllEndfieldNews({ pageSize: 50 });
    if (posts.length === 0) {
      await interaction.editReply("표시할 엔드필드 공지가 없습니다.");
      return;
    }

    const totalPages = Math.ceil(posts.length / PAGE_SIZE);
    let page = clampPage(interaction.options.getInteger("페이지") ?? 1, totalPages);
    const ownerId = interaction.user.id;

    const render = (disabled = false) =>
      buildNewsListMessage(posts, page, totalPages, disabled);

    const message = await interaction.editReply(render());

    while (true) {
      try {
        const buttonInteraction = await message.awaitMessageComponent({
          componentType: ComponentType.Button,
          filter: (componentInteraction) =>
            componentInteraction.user.id === ownerId &&
            componentInteraction.customId.startsWith("endfield-news:"),
          time: COMPONENT_TTL_MS,
        });

        if (buttonInteraction.customId.endsWith(":previous")) {
          page = clampPage(page - 1, totalPages);
        } else if (buttonInteraction.customId.endsWith(":next")) {
          page = clampPage(page + 1, totalPages);
        }

        await buttonInteraction.update(render());
      } catch {
        await interaction.editReply(render(true));
        return;
      }
    }
  },
};

function buildNewsListMessage(
  posts: readonly NewsPost[],
  page: number,
  totalPages: number,
  disabled: boolean,
) {
  const start = (page - 1) * PAGE_SIZE;
  const pagePosts = posts.slice(start, start + PAGE_SIZE);
  const embed = new EmbedBuilder()
    .setColor(0xf2c94c)
    .setTitle("명일방주: 엔드필드 공지 목록")
    .setURL("https://endfield.gryphline.com/ko-kr/news")
    .setDescription(
      pagePosts
        .map((post, index) => formatNewsListItem(post, start + index + 1))
        .join("\n\n"),
    )
    .setFooter({
      text: `${page}/${totalPages} 페이지 · 총 ${posts.length}개`,
    });

  return {
    embeds: [embed],
    components: [buildPaginationRow(page, totalPages, disabled)],
  };
}

function buildPaginationRow(
  page: number,
  totalPages: number,
  disabled: boolean,
): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId("endfield-news:previous")
      .setLabel("이전")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(disabled || page <= 1),
    new ButtonBuilder()
      .setCustomId("endfield-news:next")
      .setLabel("다음")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(disabled || page >= totalPages),
  );
}

function formatNewsListItem(post: NewsPost, index: number): string {
  const category = CATEGORY_NAMES[post.category] ?? post.category;
  const title = truncate(post.title, 90);
  return `**${index}. [${title}](${post.url})**\n${category} · ${formatDate(post.publishedAt)}`;
}

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat("ko-KR", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Seoul",
  }).format(date);
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength - 3)}...`;
}

function clampPage(page: number, totalPages: number): number {
  return Math.min(Math.max(page, 1), totalPages);
}
