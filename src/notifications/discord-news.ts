import { EmbedBuilder, type Client } from "discord.js";

import type { NewsPost } from "../sources/types.js";

const CATEGORY_NAMES: Readonly<Record<string, string>> = {
  notices: "공지",
  events: "이벤트",
  news: "뉴스",
};

export async function sendNewsPost(
  client: Client,
  channelId: string,
  post: NewsPost,
): Promise<void> {
  const channel = await client.channels.fetch(channelId);
  if (!channel?.isSendable()) {
    throw new Error(`메시지를 전송할 수 없는 채널입니다: ${channelId}`);
  }

  const embed = new EmbedBuilder()
    .setColor(0xf2c94c)
    .setAuthor({ name: post.source })
    .setTitle(post.title.slice(0, 256))
    .setURL(post.url)
    .setDescription(normalizeSummary(post.summary))
    .addFields({
      name: "분류",
      value: CATEGORY_NAMES[post.category] ?? post.category,
      inline: true,
    })
    .setTimestamp(post.publishedAt)
    .setFooter({ text: "공식 홈페이지에서 자세히 보기" });

  if (post.imageUrl) {
    embed.setImage(post.imageUrl);
  }

  await channel.send({ embeds: [embed] });
}

function normalizeSummary(summary: string): string {
  const normalized = summary.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return "새로운 공지가 등록되었습니다.";
  }

  return normalized.length > 500
    ? `${normalized.slice(0, 497)}...`
    : normalized;
}
