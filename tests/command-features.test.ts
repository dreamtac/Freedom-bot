import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const featureLoaded = vi.hoisted(() => vi.fn());
vi.mock("../src/commands/eternal-return.js", async importOriginal => {
  featureLoaded();
  return importOriginal();
});

beforeEach(() => { vi.resetModules(); vi.clearAllMocks(); });
afterEach(() => vi.unstubAllGlobals());

describe("feature command registry", () => {
  it("운영 구성은 전적 모듈을 불러오지 않고 주식·공지는 유지한다", async () => {
    const network = vi.fn().mockRejectedValue(new Error("network must not run"));
    vi.stubGlobal("fetch", network);
    const { loadCommands } = await import("../src/commands/index.js");
    const commands = await loadCommands({ erEnabled: false });
    const names = commands.map(command => command.data.name);
    expect(names).toEqual(expect.arrayContaining(["엔드필드", "시세", "주가알림", "야간선물", "status"]));
    expect(names).not.toEqual(expect.arrayContaining(["전적"]));
    expect(names).not.toContain("이터널리턴");
    expect(featureLoaded).not.toHaveBeenCalled();
    expect(network).not.toHaveBeenCalled();
  });

  it("개발 구성에서만 전적을 추가하며 이후 운영 목록에 남기지 않는다", async () => {
    const { loadCommands } = await import("../src/commands/index.js");
    const development = await loadCommands({ erEnabled: true });
    expect(featureLoaded).toHaveBeenCalledOnce();
    expect(development.map(command => command.data.name)).toEqual(expect.arrayContaining([
      "이터널리턴", "전적", "상세전적", "시즌전적", "전적분석",
    ]));
    const production = await loadCommands({ erEnabled: false });
    expect(production.map(command => command.data.name)).toEqual(development.map(command => command.data.name)
      .filter(name => !["이터널리턴", "전적", "상세전적", "시즌전적", "전적분석"].includes(name)));
  });
});
