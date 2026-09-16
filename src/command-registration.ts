import { Routes, type REST } from "discord.js";
import type { BotCommand } from "./commands/types.js";
import type { AppConfig } from "./config.js";
import { isEternalReturnCommand } from "./features/eternal-return-policy.js";

type RegistrationConfig = Pick<AppConfig, "clientId" | "guildId" | "erEnabled">;
type RegistrationRest = Pick<REST, "get" | "post" | "delete">;
type Route = `/${string}`;

export interface RegistrationOptions {
  dryRun: boolean;
  cleanupGuildIds: string[];
}

export function parseRegistrationOptions(args: readonly string[]): RegistrationOptions {
  const result: RegistrationOptions = { dryRun: false, cleanupGuildIds: [] };
  for (const arg of args) {
    if (arg === "--dry-run") result.dryRun = true;
    else if (/^--cleanup-guild=\d{17,20}$/.test(arg)) {
      result.cleanupGuildIds.push(arg.slice("--cleanup-guild=".length));
    } else throw new Error(`알 수 없는 명령어 등록 옵션입니다: ${arg}`);
  }
  result.cleanupGuildIds = [...new Set(result.cleanupGuildIds)];
  return result;
}

interface RegisteredCommand { id: string; name: string; type: number }

function registeredCommands(data: unknown): RegisteredCommand[] {
  if (!Array.isArray(data) || data.some(value => !value || typeof value !== "object"
    || typeof value.id !== "string" || typeof value.name !== "string" || typeof value.type !== "number")) {
    throw new Error("Discord 명령어 목록 응답을 확인할 수 없습니다.");
  }
  return data as RegisteredCommand[];
}

export interface RegistrationAction {
  action: "upsert" | "delete";
  scope: string;
  name: string;
  route: Route;
  body?: ReturnType<BotCommand["data"]["toJSON"]>;
}

// Read and validate all relevant scopes before making any changes. Upserting
// owned commands individually preserves unrelated commands in the same app.
export async function syncApplicationCommands(
  rest: RegistrationRest,
  config: RegistrationConfig,
  commands: readonly BotCommand[],
  options: RegistrationOptions,
): Promise<RegistrationAction[]> {
  if (config.erEnabled && options.cleanupGuildIds.length) {
    throw new Error("--cleanup-guild는 ER_ENABLED=false일 때만 사용할 수 있습니다.");
  }
  if (!config.erEnabled && commands.some(command => isEternalReturnCommand(command.data.name))) {
    throw new Error("비활성화된 기능이 명령 등록 목록에 포함되어 있습니다.");
  }
  const app = await rest.get(Routes.oauth2CurrentApplication()) as { id?: unknown };
  if (app?.id !== config.clientId) {
    throw new Error("봇 토큰의 애플리케이션 ID와 DISCORD_CLIENT_ID가 다릅니다. 명령어를 변경하지 않았습니다.");
  }

  const selectedScope = config.guildId ?? "global";
  const collectionRoute = (scope: string) => scope === "global"
    ? Routes.applicationCommands(config.clientId)
    : Routes.applicationGuildCommands(config.clientId, scope);
  const actions: RegistrationAction[] = commands.map(command => ({
    action: "upsert",
    scope: selectedScope,
    name: command.data.name,
    route: collectionRoute(selectedScope),
    body: command.data.toJSON(),
  }));

  if (!config.erEnabled) {
    const scopes = new Set(["global", selectedScope, ...options.cleanupGuildIds]);
    for (const scope of scopes) {
      const existing = registeredCommands(await rest.get(collectionRoute(scope)));
      for (const command of existing) {
        if (command.type !== 1 || !isEternalReturnCommand(command.name)) continue;
        actions.push({
          action: "delete", scope, name: command.name,
          route: scope === "global"
            ? Routes.applicationCommand(config.clientId, command.id)
            : Routes.applicationGuildCommand(config.clientId, scope, command.id),
        });
      }
    }
  }

  if (!options.dryRun) {
    for (const item of actions) {
      if (item.action === "delete") await rest.delete(item.route);
      else await rest.post(item.route, { body: item.body });
    }
  }
  return actions;
}
