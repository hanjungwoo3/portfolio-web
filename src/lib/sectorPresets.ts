// 성적표 섹터 비교 — 표에 올릴 종목 묶음. **목록은 여기 한 벌**(PC·모바일 공용).
//   반도체·반도체 소부장은 직접 고른 목록(2026-10-06, 코드 전부 시세 확인), 나머지는 지수(대장주)
//   페이지의 섹터 줄에서 개별주만 그대로 가져온다 — 대장주 페이지를 고치면 여기도 따라간다.
import { buildDashboardPage } from "./dashboardGroups";
import { US_PAIRS } from "./usMarketData";

export interface SectorPreset {
  key: string; label: string; tickers: string[]; names: Record<string, string>;
  subs?: Record<string, string>;   // 세부 분류(반도체 소부장: 장비·부품·소재·후공정) — 있으면 표에 분류 열·필터
  subOrder?: string[];
}

// 표시 이름 — 네이버 조회가 비어도(코스닥 일부) 코드 대신 이름이 나오게 목록에 박아 둔다.
const NAMES: Record<string, string> = {"005930": "삼성전자", "000660": "SK하이닉스", "009150": "삼성전기", "011070": "LG이노텍", "353200": "대덕전자", "222800": "심텍", "007660": "이수페타시스", "000990": "DB하이텍", "108320": "LX세미콘", "080220": "제주반도체", "399720": "가온칩스", "240810": "원익IPS", "036930": "주성엔지니어링", "403870": "HPSP", "319660": "피에스케이", "084370": "유진테크", "095610": "테스", "039030": "이오테크닉스", "281820": "케이씨텍", "079370": "제우스", "036810": "에프에스티", "031980": "피에스케이홀딩스", "348210": "넥스틴", "140860": "파크시스템스", "322310": "오로스테크놀로지", "098460": "고영", "042700": "한미반도체", "095340": "ISC", "058470": "리노공업", "089030": "테크윙", "067310": "하나마이크론", "131970": "두산테스나", "003160": "디아이", "232140": "와이씨", "092870": "엑시콘", "131290": "티에스이", "357780": "솔브레인", "005290": "동진쎄미켐", "104830": "원익머트리얼즈", "064760": "티씨케이", "166090": "하나머티리얼즈", "059090": "미코", "183300": "코미코", "373220": "LG에너지솔루션", "006400": "삼성SDI", "086520": "에코프로", "003670": "포스코퓨처엠", "066970": "엘앤에프", "247540": "에코프로비엠", "348370": "엔켐", "093370": "후성", "033160": "엠케이전자", "014680": "한솔케미칼", "281740": "레이크머티리얼즈", "102710": "이엔에프테크놀로지", "074600": "원익QnC", "272110": "케이엔제이", "101160": "월덱스", "089890": "코세스"};

const SEMI: string[] = [
  "005930", "000660", "009150", "011070", "353200", "222800", "007660",   // 메모리·부품·기판
  "000990", "108320", "080220", "399720",                                 // 파운드리·팹리스
];
// 반도체 소부장 — 분류(소재·부품·장비 + 후공정 서비스)별. 표에 '분류' 열과 필터로 나온다.
//   후공정 서비스(OSAT)는 소재·부품·장비 어디에도 안 맞아 따로 둔다(패키징·테스트를 대신 해 주는 회사).
const SOBUJANG_SUBS: Record<string, string[]> = {
  "장비": ["042700", "240810", "036930", "403870", "319660", "084370", "095610", "039030", "281820", "079370", "031980",
          "348210", "140860", "322310", "098460", "089030", "003160", "092870", "232140", "089890"],
  "부품": ["095340", "058470", "131290", "064760", "166090", "059090", "183300", "036810", "074600", "272110", "101160"],
  "소재": ["093370", "357780", "005290", "033160", "014680", "104830", "281740", "102710"],
  "후공정": ["067310", "131970"],
};
const SEMI_SOBUJANG: string[] = Object.values(SOBUJANG_SUBS).flat();
const SOBUJANG_SUB: Record<string, string> = Object.fromEntries(
  Object.entries(SOBUJANG_SUBS).flatMap(([sub, ts]) => ts.map(t => [t, sub])));

let cache: SectorPreset[] | null = null;
export function sectorPresets(): SectorPreset[] {
  if (cache) return cache;
  const krStock = new Set(US_PAIRS.filter(p => p.krStock).map(p => p.symbol));
  const byCode = new Map(US_PAIRS.map(p => [p.symbol, p.name]));
  const fromLeaders: SectorPreset[] = [];
  for (const sec of buildDashboardPage("leaders", false).filter(s => s.id.startsWith("ld"))) {
    sec.rows.forEach((row, i) => {
      const label = sec.rowLabels?.[i] ?? sec.short;
      const tickers = row.filter(s => krStock.has(s)).map(s => s.slice(0, 6));
      const names = Object.fromEntries(row.filter(s => krStock.has(s)).map(s => [s.slice(0, 6), byCode.get(s) ?? ""]));
      // 반도체·반도체 소부장은 위 직접 고른 목록(더 많다)을 쓴다 — 같은 이름 줄은 건너뛴다
      if (tickers.length && label !== "반도체" && label !== "반도체 소부장") fromLeaders.push({ key: `ld:${label}`, label, tickers, names });
    });
  }
  cache = [
    { key: "semi", label: "반도체", tickers: SEMI, names: NAMES },
    { key: "semi-sobujang", label: "반도체 소부장", tickers: SEMI_SOBUJANG, names: NAMES,
      subs: SOBUJANG_SUB, subOrder: Object.keys(SOBUJANG_SUBS) },
    ...fromLeaders,
  ];
  return cache;
}
