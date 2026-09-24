import { MessageFlags, type ButtonInteraction, type StringSelectMenuInteraction } from "discord.js";

import type { EternalReturnReceiptView } from "../services/eternal-return-receipt.js";
import type { BotCommandContext } from "./types.js";
import {
  buildReceiptComponents,
  buildReceiptDetailEmbed,
  type EternalReturnReceiptSection,
} from "./eternal-return-receipt-formatters.js";

type ReceiptInteraction = ButtonInteraction | StringSelectMenuInteraction;

const selections = new Map<string, { playerIndex: number; expiresAt: number }>();
const SELECTION_TTL_MS = 30 * 60 * 1_000;
const sections = new Set<EternalReturnReceiptSection>([
  "combat", "contribution", "credits", "activity", "build",
]);

export async function handleEternalReturnReceiptComponent(
  interaction: ReceiptInteraction,
  context: BotCommandContext,
): Promise<void> {
  const [, kind, receiptId, action] = interaction.customId.split(":");
  const store = context.eternalReturnStore;
  if (kind !== "r" || !receiptId || !action || !store) {
    await expiredReply(interaction);
    return;
  }
  const receipt = store.getGameReceipt(receiptId);
  const view = store.getGameReceiptDetails<EternalReturnReceiptView>(receiptId);
  if (!receipt || !view || view.players.length === 0) {
    await expiredReply(interaction);
    return;
  }

  cleanupSelections();
  const key = `${interaction.user.id}:${receiptId}`;
  let selected = selections.get(key)?.playerIndex ?? 0;
  let section: EternalReturnReceiptSection = "combat";
  if (action === "player" && interaction.isStringSelectMenu()) {
    const value = Number(interaction.values[0]);
    if (Number.isInteger(value) && value >= 0 && value < view.players.length) selected = value;
  } else if (sections.has(action as EternalReturnReceiptSection)) {
    section = action as EternalReturnReceiptSection;
  } else {
    await expiredReply(interaction);
    return;
  }
  selections.set(key, { playerIndex: selected, expiresAt: Date.now() + SELECTION_TTL_MS });
  await interaction.reply({
    embeds: [buildReceiptDetailEmbed(view.players[selected]!, section)],
    components: buildReceiptComponents(view, receiptId, selected),
    flags: MessageFlags.Ephemeral,
  });
}

async function expiredReply(interaction: ReceiptInteraction): Promise<void> {
  await interaction.reply({
    content: "이 게임 결과의 저장 기록을 찾을 수 없습니다. 삭제되었거나 만료된 결과일 수 있습니다.",
    flags: MessageFlags.Ephemeral,
  });
}

function cleanupSelections(): void {
  const now = Date.now();
  for (const [key, selection] of selections) {
    if (selection.expiresAt <= now) selections.delete(key);
  }
}
