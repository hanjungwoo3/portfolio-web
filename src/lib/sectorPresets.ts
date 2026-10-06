// 성적표 섹터 비교 — 표에 올릴 종목 묶음. **목록은 여기 한 벌**(PC·모바일 공용).
//   반도체·반도체 소부장은 직접 고른 목록(2026-10-06, 코드 전부 시세 확인), 나머지는 지수(대장주)
//   페이지의 섹터 줄에서 개별주만 그대로 가져온다 — 대장주 페이지를 고치면 여기도 따라간다.
import { buildDashboardPage } from "./dashboardGroups";
import { US_PAIRS } from "./usMarketData";

export interface SectorPreset { key: string; label: string; tickers: string[]; names: Record<string, string> }

// 표시 이름 — 네이버 조회가 비어도(코스닥 일부) 코드 대신 이름이 나오게 목록에 박아 둔다.
const NAMES: Record<string, string> = {"005930": "삼성전자", "000660": "SK하이닉스", "009150": "삼성전기", "011070": "LG이노텍", "353200": "대덕전자", "222800": "심텍", "007660": "이수페타시스", "000990": "DB하이텍", "108320": "LX세미콘", "080220": "제주반도체", "399720": "가온칩스", "240810": "원익IPS", "036930": "주성엔지니어링", "403870": "HPSP", "319660": "피에스케이", "084370": "유진테크", "095610": "테스", "039030": "이오테크닉스", "281820": "케이씨텍", "079370": "제우스", "036810": "에프에스티", "031980": "피에스케이홀딩스", "348210": "넥스틴", "140860": "파크시스템스", "322310": "오로스테크놀로지", "098460": "고영", "042700": "한미반도체", "095340": "ISC", "058470": "리노공업", "089030": "테크윙", "067310": "하나마이크론", "131970": "두산테스나", "003160": "디아이", "232140": "와이씨", "092870": "엑시콘", "131290": "티에스이", "357780": "솔브레인", "005290": "동진쎄미켐", "104830": "원익머트리얼즈", "064760": "티씨케이", "166090": "하나머티리얼즈", "059090": "미코", "183300": "코미코"};

const SEMI: string[] = [
  "005930", "000660", "009150", "011070", "353200", "222800", "007660",   // 메모리·부품·기판
  "000990", "108320", "080220", "399720",                                 // 파운드리·팹리스
];
const SEMI_SOBUJANG: string[] = [
  // 전공정 장비
  "240810", "036930", "403870", "319660", "084370", "095610", "039030", "281820", "079370", "036810", "031980",
  // 검사·계측
  "348210", "140860", "322310", "098460",
  // 후공정 장비·테스트
  "042700", "095340", "058470", "089030", "067310", "131970", "003160", "232140", "092870", "131290",
  // 소재·부품
  "357780", "005290", "104830", "064760", "166090", "059090", "183300",
];

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
      if (tickers.length) fromLeaders.push({ key: `ld:${label}`, label, tickers, names });
    });
  }
  cache = [
    { key: "semi", label: "반도체", tickers: SEMI, names: NAMES },
    { key: "semi-sobujang", label: "반도체 소부장", tickers: SEMI_SOBUJANG, names: NAMES },
    ...fromLeaders,
  ];
  return cache;
}
