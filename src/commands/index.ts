import type { BotCommand } from "./types.js";
import { statusCommand } from "./status.js";

export const commands: readonly BotCommand[] = [statusCommand];

export const commandsByName = new Map(
  commands.map((command) => [command.data.name, command]),
);
