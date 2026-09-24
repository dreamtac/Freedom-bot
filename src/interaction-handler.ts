import { MessageFlags, type Interaction } from "discord.js";

import type { BotCommand, BotCommandContext } from "./commands/types.js";
import {
  isEternalReturnCommand,
  isEternalReturnComponent,
  isEternalReturnReceiptComponent,
} from "./features/eternal-return-policy.js";

// Discord errors can contain request tokens; log only diagnostic fields.
export function errorDetails(error: unknown): object {
  if (!(error instanceof Error)) return { name: "UnknownError" };
  const details = error as Error & { code?: unknown; status?: unknown };
  return {
    name: details.name,
    message: details.message,
    ...(typeof details.code === "number" ? { code: details.code } : {}),
    ...(typeof details.status === "number" ? { status: details.status } : {}),
  };
}

export async function handleInteraction(
  interaction: Interaction,
  commands: ReadonlyMap<string, BotCommand>,
  context: BotCommandContext,
): Promise<void> {
  const label = `[interaction ${interaction.id}]`;

  try {
    // Also reject stale commands/components still visible on Discord after a
    // feature is disabled. Other features' component collectors stay intact.
    const erRequest = (interaction.isChatInputCommand() || interaction.isAutocomplete())
      ? isEternalReturnCommand(interaction.commandName)
      : interaction.isMessageComponent() && isEternalReturnComponent(interaction.customId);
    if (context.erEnabled !== true && erRequest) {
      if (interaction.isAutocomplete()) await interaction.respond([]);
      else if (interaction.isChatInputCommand() || interaction.isMessageComponent()) {
        await interaction.reply({ content: "현재 이 봇에서 사용할 수 없는 기능입니다.", flags: MessageFlags.Ephemeral });
      }
      return;
    }
    if (interaction.isMessageComponent() && isEternalReturnComponent(interaction.customId)) {
      if (interaction.isButton() || interaction.isStringSelectMenu()) {
        if (isEternalReturnReceiptComponent(interaction.customId)) {
          if (context.erReceiptsEnabled !== true) {
            await interaction.reply({ content: "현재 게임 결과 알림 상세 보기는 비활성화되어 있습니다.", flags: MessageFlags.Ephemeral });
          } else {
            const { handleEternalReturnReceiptComponent } = await import("./commands/eternal-return-receipt-ui.js");
            await handleEternalReturnReceiptComponent(interaction, context);
          }
        } else {
          const { handleEternalReturnComponent } = await import("./commands/eternal-return.js");
          await handleEternalReturnComponent(interaction, context);
        }
      }
      return;
    }
    if (!interaction.isChatInputCommand() && !interaction.isAutocomplete()) return;
    const command = commands.get(interaction.commandName);
    if (!command) {
      console.warn(`${label} unknown-command`);
      if (interaction.isAutocomplete()) {
        await interaction.respond([]);
      } else {
        await interaction.reply({
        content: "현재 실행 중인 봇에서 지원하지 않는 명령어입니다. 명령어 등록과 봇 업데이트 상태를 확인해 주세요.",
          flags: MessageFlags.Ephemeral,
        });
      }
      return;
    }
    if (interaction.isAutocomplete()) {
      if (command.autocomplete) await command.autocomplete(interaction, context);
      else await interaction.respond([]);
    } else {
      await command.execute(interaction, context);
    }
  } catch (error: unknown) {
    console.error(`${label} failed`, errorDetails(error));
    try {
      if (interaction.isAutocomplete()) {
        if (!interaction.responded) await interaction.respond([]);
      } else if (interaction.isChatInputCommand() || interaction.isMessageComponent()) {
        const content = "명령어를 처리하는 중 문제가 발생했습니다. 잠시 후 다시 시도해 주세요.";
        if (interaction.deferred && !interaction.replied) {
          await interaction.editReply({ content });
        } else if (interaction.replied) {
          await interaction.followUp({ content, flags: MessageFlags.Ephemeral });
        } else {
          await interaction.reply({ content, flags: MessageFlags.Ephemeral });
        }
      }
    } catch (replyError: unknown) {
      console.error(`${label} error-response-failed`, errorDetails(replyError));
    }
  }
}
