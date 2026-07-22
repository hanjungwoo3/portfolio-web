// 코드→한글 종목명 사전 생성 — public/kr-stock-names.json.
//   소스: TradingView scanner(코드 목록) + 네이버 polling(한글명 배치).
//   히트맵 등에서 런타임 0콜로 한글명 매핑. 종목명은 거의 불변이라 가끔 재생성:
//     node scripts/gen-stock-names.mjs   (또는 npm run gen-names)
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36";
const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "kr-stock-names.json");

// 1) scanner 로 KOSPI + KOSDAQ 전체 코드 수집
async function scanCodes(symbolset) {
  const resp = await fetch("https://scanner.tradingview.com/korea/scan", {
    method: "POST",
    headers: { "User-Agent": UA, "Content-Type": "application/json" },
    body: JSON.stringify({ symbols: { symbolset: [symbolset] }, columns: ["name"], range: [0, 5000] }),
  });
  const j = await resp.json();
  return (j.data ?? []).map(r => String(r.d[0])).filter(c => /^[\dA-Za-z]{6}$/.test(c));
}

// 2) 네이버 polling 배치로 코드→한글명 (50개씩)
async function fetchNames(codes) {
  const out = {};
  const BATCH = 50;
  const chunks = [];
  for (let i = 0; i < codes.length; i += BATCH) chunks.push(codes.slice(i, i + BATCH));
  for (const chunk of chunks) {
    try {
      const resp = await fetch(
        `https://polling.finance.naver.com/api/realtime/domestic/stock/${chunk.join(",")}`,
        { headers: { "User-Agent": UA, "Referer": "https://finance.naver.com/" } });
      const j = await resp.json();
      for (const x of j.datas ?? []) {
        if (x.itemCode && x.stockName) out[String(x.itemCode)] = String(x.stockName);
      }
    } catch (e) { console.warn("batch fail", chunk[0], String(e).slice(0, 60)); }
  }
  return out;
}

const kospi = await scanCodes("SYML:KRX;KOSPI");
const kosdaq = await scanCodes("SYML:KRX;KOSDAQ");
const codes = [...new Set([...kospi, ...kosdaq])];
console.log(`코드 수집: KOSPI ${kospi.length} + KOSDAQ ${kosdaq.length} → 고유 ${codes.length}`);

const names = await fetchNames(codes);
const sorted = Object.fromEntries(Object.keys(names).sort().map(k => [k, names[k]]));
writeFileSync(OUT, JSON.stringify(sorted));
console.log(`한글명 매핑 ${Object.keys(sorted).length}개 → ${OUT}`);
