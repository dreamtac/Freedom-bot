import { describe, expect, it } from "vitest";

import { endfieldCommand } from "../src/commands/endfield.js";

describe("endfieldCommand", () => {
  it("엔드필드 공지 목록 슬래시 명령어를 등록한다", () => {
    const command = endfieldCommand.data.toJSON();

    expect(command.name).toBe("엔드필드");
    expect(command.options?.[0]).toMatchObject({
      name: "공지",
      description: "공식 홈페이지의 전체 공지 목록을 확인합니다.",
    });
  });
});
