// ETF 구성종목 비중 사전 생성 — public/etf-weights.json.
//   소스: 삼성자산운용(KODEX) product-document.do (전체 구성종목 PDF, 비중 포함).
//   CORS 차단이라 브라우저 직접 불가 → 이 빌드 스크립트(node, 서버측)가 받아 정적 JSON 으로 저장.
//   히트맵 'ETF 비중' 크기 모드에서 런타임 0콜(프록시 불필요)로 사용. 비중은 일 단위로 거의 불변이라 배포 시 재생성:
//     node scripts/gen-etf-weights.mjs   (또는 npm run gen-etf-weights)
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36";
const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "etf-weights.json");

// weightKey(ETF 이름 기준) → KODEX fId (삼성운용 펀드 식별자). 비중 출처가 KODEX ETF 라 ETF 명으로 키 지정.
const FUNDS = {
  kodex200:         "2ETF01",   // KODEX 200
  kodex_kosdaq150:  "2ETF54",   // KODEX 코스닥 150
  kodex_valueup:    "2ETFP2",   // KODEX 코리아밸류업
};

// 1) 최신 PDF 기준일 파악 (product-document 의 pdfGijunYMD, 예 "20260730").
const metaResp = await fetch("https://www.samsungfund.com/api/v1/kodex/product-document.do?fId=2ETF01", {
  headers: { "User-Agent": UA, Referer: "https://www.samsungfund.com/" },
});
if (!metaResp.ok) { console.error("meta HTTP", metaResp.status); process.exit(1); }
const meta = await metaResp.json();
const gijunYMD = meta.pdfGijunYMD || meta.gijunYMD || "";   // "20260730"
const gijunDot = `${gijunYMD.slice(0, 4)}.${gijunYMD.slice(4, 6)}.${gijunYMD.slice(6, 8)}`;  // "2026.07.30"

// 2) 펀드별 product-pdf 전용 엔드포인트 → 전체 구성종목(200) + 비중. (product-document 는 100 상한이라 이걸 사용)
const weights = {};
for (const [key, fId] of Object.entries(FUNDS)) {
  const r = await fetch(`https://www.samsungfund.com/api/v1/kodex/product-pdf/${fId}.do?gijunYMD=${gijunDot}`, {
    headers: { "User-Agent": UA, Referer: "https://www.samsungfund.com/" },
  });
  if (!r.ok) { console.warn("⚠️ HTTP", r.status, key, fId); continue; }
  const j = await r.json();
  const list = j.pdf?.list ?? [];   // { pdf: { gijunYMD, totalCnt, list: [...] } }
  const map = {};
  for (const it of list) {
    const code = String(it.itmNo ?? "");           // "005930" (원화예금 KRD... 은 6자리 아님 → 제외)
    const ratio = Number(it.ratio);
    if (/^[\dA-Za-z]{6}$/.test(code) && Number.isFinite(ratio) && ratio > 0) map[code] = ratio;
  }
  weights[key] = map;
  console.log(`  ${key.padEnd(11)} ${fId} → ${Object.keys(map).length}종목`);
}

writeFileSync(OUT, JSON.stringify({ gijunYMD, weights }));
console.log(`기준일 ${gijunYMD} · wrote ${OUT}`);
