import { PermissionFlagsBits } from "discord.js";
import { describe, expect, it } from "vitest";

import { testNotificationCommand } from "../src/commands/test-notification.js";

describe("testNotificationCommand", () => {
  it("서버 관리 권한이 있는 사용자에게만 노출된다", () => {
    const command = testNotificationCommand.data.toJSON();

    expect(command.name).toBe("test-notification");
    expect(command.dm_permission).toBe(false);
    expect(command.default_member_permissions).toBe(
      PermissionFlagsBits.ManageGuild.toString(),
    );
  });
});
