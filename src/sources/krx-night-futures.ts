import { unzipSync } from "fflate";

export const KRX_NIGHT_FUTURES_MASTER_URL =
  "https://new.real.download.dws.co.kr/common/master/fo_cme_code.mst.zip";

const MASTER_REFRESH_INTERVAL_MS = 6 * 60 * 60 * 1000;
const MASTER_REQUEST_TIMEOUT_MS = 30_000;

export interface KrxNightFuturesContract {
  code: string;
  standardCode?: string;
  name: string;
}

let cachedContracts: KrxNightFuturesContract[] | undefined;
let cachedAt = 0;

export async function getCurrentKospi200NightFuturesContract(): Promise<KrxNightFuturesContract> {
  const contracts = await fetchKrxNightFuturesContracts();
  const contract = contracts[0];
  if (!contract) {
    throw new Error("KOSPI200 KRX 야간선물 최근월물을 찾지 못했습니다.");
  }
  return contract;
}

export async function fetchKrxNightFuturesContracts(): Promise<KrxNightFuturesContract[]> {
  if (cachedContracts && Date.now() - cachedAt < MASTER_REFRESH_INTERVAL_MS) {
    return cachedContracts;
  }

  const response = await fetch(KRX_NIGHT_FUTURES_MASTER_URL, {
    signal: AbortSignal.timeout(MASTER_REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(
      `KOSPI200 야간선물 종목 목록 다운로드에 실패했습니다. (${response.status})`,
    );
  }

  const contracts = parseKrxNightFuturesMaster(
    new Uint8Array(await response.arrayBuffer()),
  );
  if (contracts.length === 0) {
    throw new Error("KOSPI200 야간선물 종목 목록이 비어 있습니다.");
  }

  cachedContracts = contracts;
  cachedAt = Date.now();
  return contracts;
}

export function parseKrxNightFuturesMaster(
  archive: Uint8Array,
): KrxNightFuturesContract[] {
  const files = unzipSync(archive);
  const file = Object.values(files)[0];
  if (!file) {
    throw new Error("KOSPI200 야간선물 종목 마스터 압축 파일이 비어 있습니다.");
  }

  const text = new TextDecoder("euc-kr").decode(file);
  const contracts: KrxNightFuturesContract[] = [];
  for (const line of text.split(/\r?\n/)) {
    const productType = line.slice(0, 1);
    const code = line.slice(1, 10).trim();
    const standardCode = line.slice(10, 22).trim();
    const name = line.slice(22, 63).trim();
    const underlyingName = line.slice(81).trim();
    if (productType !== "1" || !code || underlyingName !== "KOSPI200") {
      continue;
    }
    contracts.push({
      code,
      ...(standardCode ? { standardCode } : {}),
      name: name || "KOSPI200 KRX 야간선물",
    });
  }

  // KIS master files list the nearest expiry first.
  return contracts;
}
