// Keep this policy free of imports from the optional feature implementation.
export const ETERNAL_RETURN_COMMAND_NAMES: ReadonlySet<string> = new Set([
  "이터널리턴", "전적", "상세전적", "시즌전적", "전적분석",
]);

export const ETERNAL_RETURN_COMPONENT_PREFIX = "er:";
export const ETERNAL_RETURN_RECEIPT_COMPONENT_PREFIX = "er:r:";

export function isEternalReturnCommand(name: string): boolean {
  return ETERNAL_RETURN_COMMAND_NAMES.has(name);
}

export function isEternalReturnComponent(customId: string): boolean {
  return customId.startsWith(ETERNAL_RETURN_COMPONENT_PREFIX);
}

export function isEternalReturnReceiptComponent(customId: string): boolean {
  return customId.startsWith(ETERNAL_RETURN_RECEIPT_COMPONENT_PREFIX);
}

export function readEternalReturnConfig(environment: NodeJS.ProcessEnv) {
  const flag = environment.ER_ENABLED?.trim() || "false";
  if (flag !== "true" && flag !== "false") {
    throw new Error("ER_ENABLED는 true 또는 false로 설정해 주세요.");
  }
  const erEnabled = flag === "true";
  const key = erEnabled ? environment.ER_API_KEY?.trim() : undefined;
  const receiptFlag = environment.ER_RECEIPTS_ENABLED?.trim() || "false";
  if (receiptFlag !== "true" && receiptFlag !== "false") {
    throw new Error("ER_RECEIPTS_ENABLED는 true 또는 false로 설정해 주세요.");
  }
  const erReceiptsEnabled = erEnabled && receiptFlag === "true";
  return {
    erEnabled,
    erReceiptsEnabled,
    ...(key ? { erApiKey: key } : {}),
  };
}
