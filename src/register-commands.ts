import "dotenv/config";

import { REST } from "discord.js";

import { loadCommands } from "./commands/index.js";
import { loadConfig } from "./config.js";
import { parseRegistrationOptions, syncApplicationCommands } from "./command-registration.js";

async function registerCommands(): Promise<void> {
  const config = loadConfig();
  const options = parseRegistrationOptions(process.argv.slice(2));
  const commands = await loadCommands(config);
  const rest = new REST({ version: "10" }).setToken(config.botToken);
  const actions = await syncApplicationCommands(rest, config, commands, options);
  for (const item of actions) {
    console.log(`${options.dryRun ? "[미리보기] " : ""}${item.action} [${item.scope}] /${item.name}`);
  }
  console.log(options.dryRun
    ? "조회만 완료했습니다. Discord 명령어는 변경하지 않았습니다."
    : "명령어 등록을 완료했습니다. 목록에 없는 다른 기능의 명령어는 유지했습니다.");
}

registerCommands().catch((error: unknown) => {
  console.error("슬래시 명령어 등록에 실패했습니다.", error);
  process.exitCode = 1;
});
