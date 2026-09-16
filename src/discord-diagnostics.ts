import { Events, type Client } from "discord.js";

import { errorDetails } from "./interaction-handler.js";

export function registerDiscordDiagnostics(client: Client): void {
  client.on(Events.Error, (error) => {
    console.error("[discord] client-error", errorDetails(error));
  });
  client.on(Events.ShardError, (error, shardId) => {
    console.error("[discord] shard-error", { shardId, ...errorDetails(error) });
  });
  client.on(Events.ShardDisconnect, (event, shardId) => {
    console.warn("[discord] disconnected", { shardId, code: event.code });
  });
  client.on(Events.ShardReconnecting, (shardId) => {
    console.info("[discord] reconnecting", { shardId });
  });
  client.on(Events.ShardResume, (shardId, replayedEvents) => {
    console.info("[discord] resumed", { shardId, replayedEvents });
  });
}
