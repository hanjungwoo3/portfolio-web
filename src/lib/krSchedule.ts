// 국내 장 시간표 받기 — 토스 trading-info 의 오늘 schedule(장 열림·정규장·시간외·애프터) + 휴장일.
//   수능·연초 개장일처럼 시간이 바뀌는 날을 따라가려고(사용자 2026-11-19). 받은 값은 format.ts 의 setKrSchedule 로.
//   오늘 날짜로 localStorage 에도 둔다 — 새로 열자마자(받기 전에도) 맞는 시간을 쓰게. 30분마다 다시.
//   못 받으면 평소 시간 그대로.
import { fetchProxied } from "./api";
import { setKrSchedule, nowKstDateStr, type KrSchedule } from "./format";

const KEY = "kr_schedule_v1";
const toMin = (hm?: string) => { const m = /^(\d{1,2}):(\d{2})$/.exec(hm ?? ""); return m ? +m[1] * 60 + +m[2] : null; };

async function load(): Promise<void> {
  try {
    // wts-cert-api 로 — 같은 응답인데 클라우드 프록시도 통과한다(wts-info-api 는 Cloudflare 에서 400, 실측 2026-11-19).
    //   그래서 확장·앱 없는 웹에서도 시간표가 들어온다(사용자 2026-11-19 "웹에서도 되게 하자")
    const r = await fetchProxied("https://wts-cert-api.tossinvest.com/api/v1/dashboard/wts/overview/trading-info");
    if (!r.ok) return;
    const j = await r.json() as { result?: { data?: Array<{ key?: string; isHoliday?: boolean; schedule?: { name?: string; startTime?: string; endTime?: string }[] }> } };
    const kr = j.result?.data?.find(d => d.key === "kr");
    if (!kr) return;
    const seg = (n: string) => kr.schedule?.find(x => (x.name ?? "").replace(/\s/g, "") === n);
    const reg = seg("정규장"), closing = seg("시간외거래"), after = seg("애프터마켓"), open0 = seg("장열림");
    const regStart = toMin(reg?.startTime), regEnd = toMin(reg?.endTime);
    if (regStart == null || regEnd == null || regEnd <= regStart) {
      if (kr.isHoliday) { const s: KrSchedule = { regStart: 540, regEnd: 930, closingEnd: 960, afterEnd: 1200, holiday: true, date: nowKstDateStr() }; setKrSchedule(s); save(s); }
      return;
    }
    const s: KrSchedule = {
      regStart, regEnd,
      closingEnd: toMin(closing?.endTime) ?? regEnd + 30,
      afterEnd: toMin(after?.endTime) ?? 20 * 60,
      holiday: kr.isHoliday === true,
      date: nowKstDateStr(),
      openStart: toMin(open0?.startTime) ?? undefined,
      afterStart: toMin(after?.startTime) ?? undefined,
    };
    setKrSchedule(s);
    save(s);
  } catch { /* 다음 주기에 */ }
}
function save(s: KrSchedule) { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* 이번만 */ } }

export function startKrSchedule(): void {
  try { const c = JSON.parse(localStorage.getItem(KEY) ?? "null") as KrSchedule | null; if (c && c.date === nowKstDateStr()) setKrSchedule(c); } catch { /* 없음 */ }
  void load();
  setInterval(() => void load(), 30 * 60_000);
}
