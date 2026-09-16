import { EventEmitter } from "node:events";
import { Events, type Client } from "discord.js";
import { afterEach, describe, expect, it, vi } from "vitest";

import { registerDiscordDiagnostics } from "../src/discord-diagnostics.js";

afterEach(() => vi.restoreAllMocks());

describe("Discord diagnostics", () => {
  it("does not log raw interaction packets", () => {
    const log = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const client = new EventEmitter();
    registerDiscordDiagnostics(client as unknown as Client);
    client.emit(Events.Raw, { t: "MESSAGE_CREATE", d: {} }, 0);
    expect(log).not.toHaveBeenCalled();
    client.emit(Events.Raw, {
      t: "INTERACTION_CREATE",
      d: {
        id: "123", application_id: "456", type: 2, token: "secret-token",
        data: { id: "789", name: "전적", options: [{ value: "private-nickname" }] },
      },
    }, 0);
    expect(log).not.toHaveBeenCalled();
  });

  it("records connection failures and recovery without raw error payloads", () => {
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const client = new EventEmitter();
    registerDiscordDiagnostics(client as unknown as Client);
    const error = Object.assign(new Error("connection failed"), { requestBody: { token: "secret-token" } });
    client.emit(Events.Error, error);
    client.emit(Events.ShardError, error, 0);
    client.emit(Events.ShardDisconnect, { code: 1006 }, 0);
    client.emit(Events.ShardReconnecting, 0);
    client.emit(Events.ShardResume, 0, 2);
    expect(errorLog).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(errorLog.mock.calls)).not.toContain("secret-token");
    expect(warn).toHaveBeenCalledWith("[discord] disconnected", { shardId: 0, code: 1006 });
    expect(info).toHaveBeenCalledWith("[discord] resumed", { shardId: 0, replayedEvents: 2 });
  });
});
