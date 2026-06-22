import "dotenv/config";

import { REST, Routes } from "discord.js";

import { commands } from "./commands/index.js";
import { loadConfig } from "./config.js";

async function registerCommands(): Promise<void> {
  const config = loadConfig();
  const rest = new REST({ version: "10" }).setToken(config.botToken);
  const body = commands.map((command) => command.data.toJSON());

  if (config.guildId) {
    await rest.put(
      Routes.applicationGuildCommands(config.clientId, config.guildId),
      { body },
    );
    console.log(`개발 서버에 ${body.length}개 명령어를 등록했습니다.`);
    return;
  }

  await rest.put(Routes.applicationCommands(config.clientId), { body });
  console.log(`전역으로 ${body.length}개 명령어를 등록했습니다.`);
}

registerCommands().catch((error: unknown) => {
  console.error("슬래시 명령어 등록에 실패했습니다.", error);
  process.exitCode = 1;
});
