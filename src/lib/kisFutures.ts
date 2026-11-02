// 국내 주식선물(삼성전자·SK하이닉스) — 한국투자 Open API(앱 전용, 본인 키). 무료 공개 출처엔 주식선물 시세가 없다
//   (토스·네이버·다음·한경 실측 2026-10-30, 사용자 "한국투자 연결했어" 2026-11-02).
//   📊종목정보 창의 '선물' 칸(사용자 2026-11-02 "지수에 추가한 건 빼고 종목정보 창에 선물 칸"). 선물이 걸린 종목(201개)만.
//   종목 코드 = "A" + 기초자산 2자리 + 연도 끝자리 + 월(MM) — 한투 종목마스터 fo_stk_code_mts.mst 실측(삼성전자 A11611, SK하이닉스 A50611).
//   근월물 = 만기(그 달 둘째 목요일)가 오늘 이후인 가장 가까운 달. 시장 분류 JF(주식선물).
//   현재가 FHMIF10000000(inquire-price) · 분봉 FHKIF03020200(inquire-time-fuopchartprice), 공식 예제 examples_llm/domestic_futureoption.
import { kisGet, isKisLinkOn } from "./broker";
import type { DaySeries, MarkX } from "./api";

// 종목코드 → 주식선물 기초자산 2자리 — 한투 종목마스터(fo_stk_code_mts.mst, 2026-11-02 받음) 근월물 행에서. 201종목.
//   신규 편입·제외가 생기면 마스터를 다시 받아 갱신(코드 2자리는 종목마다 고정).
const STOCK_FUT_UNDER: Record<string, string> = { "000080": "BK", "000100": "D6", "000120": "G1", "000150": "GT", "000210": "B5", "000240": "0Y", "000270": "19", "000660": "50", "000670": "0Q", "000720": "BN", "000810": "CT", "000880": "C9", "000990": "EK", "001040": "42", "001430": "0M", "001440": "FW", "001450": "CE", "001570": "GN", "001680": "B6", "001800": "0R", "002030": "2N", "002380": "D3", "002790": "CS", "002840": "1L", "003030": "0N", "003090": "0C", "003230": "0K", "003240": "1Z", "003490": "57", "003550": "34", "003670": "E8", "004000": "GV", "004020": "32", "004170": "DD", "004370": "DA", "004990": "FZ", "005300": "GW", "005380": "16", "005420": "HC", "005490": "13", "005830": "D0", "005850": "GY", "005930": "11", "005940": "BZ", "006040": "1W", "006260": "FS", "006280": "GQ", "006400": "22", "006650": "DJ", "006800": "48", "007070": "D4", "007310": "HA", "007340": "1T", "007660": "2P", "008730": "0S", "008770": "BQ", "008930": "CV", "009150": "23", "009240": "D2", "009420": "EE", "009540": "39", "009830": "CB", "009970": "0P", "010060": "C0", "010120": "GL", "010130": "B3", "010140": "BF", "010950": "B2", "011070": "BY", "011170": "BB", "011200": "FA", "011210": "BP", "011780": "C3", "011790": "EJ", "012330": "20", "012450": "BH", "0126Z0": "2M", "012750": "D5", "014680": "G4", "014820": "0E", "015760": "15", "016360": "17", "017670": "12", "017800": "DY", "017960": "2A", "018260": "C5", "018880": "CY", "021240": "CW", "022100": "CN", "023530": "BA", "024110": "B4", "026960": "FX", "028050": "ET", "028260": "C8", "028670": "EH", "029780": "BG", "030000": "C7", "030200": "14", "032640": "B0", "032830": "BD", "033780": "36", "034020": "B9", "034220": "45", "034230": "CG", "034730": "C1", "035250": "BS", "035420": "56", "035720": "CF", "036460": "28", "036570": "BJ", "039490": "HE", "042660": "FV", "042700": "0Z", "047040": "FT", "047050": "B7", "047810": "BM", "051600": "D7", "051900": "CR", "051910": "47", "052690": "G3", "055550": "18", "062040": "2L", "064350": "G6", "064400": "2K", "066570": "24", "066970": "FM", "068270": "CP", "069260": "0A", "069620": "GR", "069960": "D8", "071050": "BL", "071320": "1Y", "071970": "2J", "073240": "GP", "078930": "35", "079550": "DB", "081660": "HJ", "082740": "2Q", "086280": "CC", "086790": "40", "088350": "CA", "090430": "C6", "093370": "EL", "096770": "41", "097950": "D1", "103140": "0X", "105560": "46", "111770": "DG", "112610": "G0", "120110": "HD", "128940": "CX", "137310": "G2", "138040": "FK", "138930": "BT", "139130": "BV", "139480": "54", "161390": "55", "161890": "DE", "175330": "GJ", "180640": "G5", "185750": "HB", "192080": "0D", "192820": "DK", "204320": "DC", "207940": "ES", "241560": "DW", "251270": "E5", "259960": "F8", "267250": "FH", "267260": "GH", "267270": "3N", "268280": "1X", "271560": "FJ", "272210": "EV", "278470": "1Q", "280360": "0H", "282330": "FR", "285130": "GM", "298020": "HH", "298040": "1S", "298050": "HG", "300720": "1A", "302440": "F9", "307950": "2R", "316140": "EB", "323410": "F6", "326030": "FF", "329180": "FD", "352820": "FC", "361610": "FB", "373220": "F5", "375500": "ER", "377300": "F7", "383220": "FG", "402340": "FE", "443060": "1V", "450080": "GZ", "454910": "0F", "456040": "HX", "457190": "0T", "483650": "3P" };
export function hasStockFutures(code: string): boolean { return code in STOCK_FUT_UNDER; }
export function kisFutAvailable(): boolean { return isKisLinkOn(); }

/** 그 달 둘째 목요일(만기일) — KST 날짜 YYYY-MM-DD */
function secondThursday(y: number, m: number): string {
  const first = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();          // 0=일
  const day = 1 + ((4 - first + 7) % 7) + 7;
  return `${y}-${String(m).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}
/** 근월물 코드. 내보내는 건 테스트용 */
export function frontMonthCode(under: string, todayKst = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10)): string {
  let y = Number(todayKst.slice(0, 4)), m = Number(todayKst.slice(5, 7));
  if (todayKst > secondThursday(y, m)) { m += 1; if (m > 12) { m = 1; y += 1; } }
  return `A${under}${y % 10}${String(m).padStart(2, "0")}`;
}

const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : NaN; };

export interface KisFutQuote { code: string; price: number; pct: number; base: number; oi?: number; oiChg?: number; vol?: number }
/** 종목코드(6자리)의 주식선물 근월물 현재가. 선물이 없는 종목은 null */
export async function fetchKisFutQuote(stockCode: string): Promise<KisFutQuote | null> {
  const under = STOCK_FUT_UNDER[stockCode];
  if (!under) return null;
  const code = frontMonthCode(under);
  const { body } = await kisGet<{ rt_cd?: string; output1?: Record<string, string> }>(
    "/uapi/domestic-futureoption/v1/quotations/inquire-price", "FHMIF10000000",
    { FID_COND_MRKT_DIV_CODE: "JF", FID_INPUT_ISCD: code });
  const o = body.output1 ?? {};
  const price = num(o.futs_prpr), pct = num(o.futs_prdy_ctrt);
  if (!(price > 0)) return null;
  const base = num(o.futs_prdy_clpr) > 0 ? num(o.futs_prdy_clpr) : (Number.isFinite(pct) ? price / (1 + pct / 100) : price);
  const oi = num(o.hts_otst_stpl_qty), oiChg = num(o.otst_stpl_qty_icdc), vol = num(o.acml_vol);
  return { code, price, pct: Number.isFinite(pct) ? pct : (price / base - 1) * 100, base,
    ...(oi >= 0 ? { oi } : {}), ...(Number.isFinite(oiChg) ? { oiChg } : {}), ...(vol >= 0 ? { vol } : {}) };
}

/** 오늘 1분봉 — 축 08:45~15:45(주식선물 정규장), 세로선 09:00 시가·15:45 종가. 기준선 = 전일 종가(카드 % 기준) */
export async function fetchKisFutDay(stockCode: string): Promise<DaySeries | null> {
  const under = STOCK_FUT_UNDER[stockCode];
  if (!under) return null;
  const code = frontMonthCode(under);
  const today = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10).replace(/-/g, "");
  const { body } = await kisGet<{ rt_cd?: string; output1?: Record<string, string>; output2?: Record<string, string>[] }>(
    "/uapi/domestic-futureoption/v1/quotations/inquire-time-fuopchartprice", "FHKIF03020200",
    { FID_COND_MRKT_DIV_CODE: "JF", FID_INPUT_ISCD: code, FID_HOUR_CLS_CODE: "60", FID_PW_DATA_INCU_YN: "N",
      FID_FAKE_TICK_INCU_YN: "N", FID_INPUT_DATE_1: today, FID_INPUT_HOUR_1: "160000" });
  const START = 8 * 60 + 45, SPAN = 7 * 60;
  const rows = (body.output2 ?? [])
    .map(r => ({ hm: String(r.stck_cntg_hour ?? ""), c: num(r.futs_prpr ?? r.stck_prpr) }))
    .filter(r => r.hm.length >= 4 && r.c > 0)
    .map(r => ({ f: (Number(r.hm.slice(0, 2)) * 60 + Number(r.hm.slice(2, 4)) - START) / SPAN, c: r.c }))
    .filter(r => r.f >= 0 && r.f <= 1)
    .sort((a, b) => a.f - b.f);
  if (rows.length < 2) return null;
  const prevClose = num(body.output1?.futs_prdy_clpr);
  const markXs: MarkX[] = [{ x: 15 / SPAN }, { x: 1, close: true }];
  return { closes: rows.map(r => r.c), xs: rows.map(r => r.f), markXs, ...(prevClose > 0 ? { base: prevClose } : {}) };
}
