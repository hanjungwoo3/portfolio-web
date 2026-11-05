// 사이드카·서킷브레이커 경고 — **앱(PC·안드로이드) 전용**(사용자 2026-11-05 "이 기능은 앱에서만").
//   두 가지를 색으로 가른다(사용자 2026-11-05 "실제 발동은 빨간색, 숫자만 넘은 건 파란색, 문구도 제대로"):
//   · 빨강 = 실제 발동 — 거래소 KIND '오늘의 공시'에 올라온 시장조치(예: "유가증권시장 매도 사이드카(Side car) 발동", 실측 2026-11-05 10:16).
//     KIND 는 프록시 허용 목록에 없어 앱의 직접 요청으로만 받는다 → 웹 브라우저에선 이 경고 자체를 안 띄운다
//   · 파랑 = 숫자만 기준선을 넘음 — 앱이 계산한 것(공식 아님). 거래소 규칙:
//       사이드카(프로그램 주문만 5분 정지): 코스피200 선물 ±5% / 코스닥150 선물 ±6%(+지수 ±3%), 1분 지속, 하루 한 번, 14:50 뒤엔 없음
//       서킷브레이커(모든 매매 20분 정지): 지수 −8% / −15% / −20%(1분 지속, 단계마다 하루 한 번)
//   30초마다(평일 09:00~15:30). KIND 는 숫자가 기준을 넘었을 때와 처음 켤 때만 묻는다. ✕ 로 닫으면 그 경고는 오늘 다시 안 띄운다.
import { useEffect, useState } from "react";
import { fetchKrFuturesLive, fetchProxied } from "../lib/api";
import { isDirectApp, fetchViaNative } from "../lib/nativeProxy";

interface Alert { key: string; official: boolean; text: string; detail: string }
const kstNow = () => new Date(Date.now() + 9 * 3600_000);
const today = () => kstNow().toISOString().slice(0, 10);
const DISMISS = "halt_alert_dismissed";
function dismissed(): Set<string> {
  try { const v = JSON.parse(localStorage.getItem(DISMISS) ?? "null"); return new Set(v?.date === today() ? v.keys : []); } catch { return new Set(); }
}
function saveDismissed(s: Set<string>) { try { localStorage.setItem(DISMISS, JSON.stringify({ date: today(), keys: [...s] })); } catch { /* noop */ } }

async function indexPct(): Promise<Record<string, number>> {
  try {
    const r = await fetchProxied("https://polling.finance.naver.com/api/realtime/domestic/index/KOSPI,KOSDAQ");
    if (!r.ok) return {};
    const j = await r.json() as { datas?: { itemCode?: string; fluctuationsRatio?: string }[] };
    return Object.fromEntries((j.datas ?? []).map(d => [d.itemCode ?? "", Number(d.fluctuationsRatio)]));
  } catch { return {}; }
}

/** 거래소 공식 시장조치(오늘) — KIND 오늘의 공시에서 사이드카·서킷브레이커 줄만. [{ hm, title }] */
export interface HaltNotice { hm: string; title: string }
export function parseKindHalts(html: string): HaltNotice[] {
  const out: HaltNotice[] = [];
  for (const row of html.match(/<tr[\s\S]*?<\/tr>/g) ?? []) {
    const txt = row.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
    if (!/사이드카|Side ?car|서킷브레이커|Circuit/i.test(txt)) continue;
    if (!/시장본부/.test(txt)) continue;   // 거래소가 낸 시장조치만(회사 공시 제목에 섞인 말 제외)
    const hm = txt.match(/\b(\d{2}:\d{2})\b/)?.[1] ?? "";
    const title = txt.replace(/\b\d{2}:\d{2}\b/, "").replace(/\S*시장본부.*$/, "").trim();
    if (title) out.push({ hm, title });
  }
  return out;
}
async function fetchKindHalts(): Promise<HaltNotice[]> {
  const d = today();
  const body = `method=searchTodayDisclosureSub&currentPageSize=100&pageIndex=1&orderMode=0&orderStat=D&forward=todaydisclosure_sub&chose=S&todayFlag=Y&selDate=${d}&marketType=`;
  const r = await fetchViaNative("https://kind.krx.co.kr/disclosure/todaydisclosure.do", {
    method: "POST", body,
    headers: { "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8", Referer: "https://kind.krx.co.kr/disclosure/todaydisclosure.do?method=searchTodayDisclosureMain" },
  });
  if (!r.ok) return [];
  return parseKindHalts(await r.text());
}

function officialAlerts(ns: HaltNotice[]): Alert[] {
  return ns.map(n => {
    const side = /사이드카|Side ?car/i.test(n.title);
    const kq = /코스닥/.test(n.title);
    const sell = /매도/.test(n.title), buy = /매수/.test(n.title);
    return {
      key: `kind-${n.hm}-${n.title}`, official: true,
      text: `${n.title}${n.hm ? ` (${n.hm})` : ""}`,
      detail: side
        ? `거래소가 실제로 발동했습니다 — ${kq ? "코스닥" : "코스피"} 프로그램 ${sell ? "매도" : buy ? "매수" : ""} 주문만 5분간 효력 정지, 일반 매매는 그대로. 사이드카는 하루 한 번이라 오늘은 다시 안 걸립니다`
        : `거래소가 실제로 발동했습니다 — 모든 주식 매매가 20분간 멈춥니다(3단계면 그날 장 종료)`,
    };
  });
}

function numericAlerts(k2: number | undefined, kq: number | undefined, idx: Record<string, number>, offs: HaltNotice[]): Alert[] {
  const out: Alert[] = [];
  const m = kstNow().getUTCHours() * 60 + kstNow().getUTCMinutes();
  const side = (name: "코스피" | "코스닥", pct: number | undefined, th: number) => {
    if (pct == null || !Number.isFinite(pct) || Math.abs(pct) < th || m > 14 * 60 + 50) return;
    const down = pct < 0, dir = down ? "매도" : "매수";
    // 오늘 같은 쪽이 이미 발동했으면 다시 안 걸린다 — 파랑도 띄우지 않는다(빨강이 이미 말했다)
    if (offs.some(n => /사이드카|Side ?car/i.test(n.title) && (name === "코스닥") === /코스닥/.test(n.title) && n.title.includes(dir))) return;
    out.push({ key: `side-${name}-${down ? "d" : "u"}`, official: false,
      text: `${name === "코스피" ? "코스피200" : "코스닥150"} 선물이 ${dir} 사이드카 기준선을 넘었습니다`,
      detail: `${name === "코스피" ? "코스피200" : "코스닥150"} 선물 ${pct > 0 ? "+" : ""}${pct.toFixed(2)}% (기준 ±${th}%). 이 상태가 1분 이어지면 거래소가 프로그램 ${dir} 주문만 5분 정지합니다 — 아직 거래소 발동 공지는 없습니다` });
  };
  side("코스피", k2, 5);
  side("코스닥", kq, 6);
  for (const [code, name] of [["KOSPI", "코스피"], ["KOSDAQ", "코스닥"]] as const) {
    const p = idx[code];
    if (p == null || !Number.isFinite(p)) continue;
    const stage = p <= -20 ? 3 : p <= -15 ? 2 : p <= -8 ? 1 : 0;
    if (!stage) continue;
    if (offs.some(n => /서킷|Circuit/i.test(n.title) && (name === "코스닥") === /코스닥/.test(n.title) && n.title.includes(`${stage}단계`))) continue;
    out.push({ key: `cb-${code}-${stage}`, official: false,
      text: `${name} 지수가 서킷브레이커 ${stage}단계 기준선을 넘었습니다`,
      detail: `${name} ${p.toFixed(2)}% (기준 −${[8, 15, 20][stage - 1]}%). 이 상태가 1분 이어지면 거래소가 ${stage === 3 ? "그날 장을 끝냅니다" : "모든 매매를 20분 정지합니다"} — 아직 거래소 발동 공지는 없습니다` });
  }
  return out;
}

function beep() {
  try {
    const ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    [0, 0.35].forEach(t => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.frequency.value = 880; g.gain.value = 0.15;
      o.connect(g); g.connect(ctx.destination);
      o.start(ctx.currentTime + t); o.stop(ctx.currentTime + t + 0.2);
    });
  } catch { /* 소리 막힘 */ }
}

export function MarketHaltBanner() {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [closed, setClosed] = useState<Set<string>>(dismissed);
  useEffect(() => {
    if (!isDirectApp()) return;   // 웹 브라우저는 공식 발동을 확인할 수 없어 띄우지 않는다
    let seen = new Set<string>();
    let offs: HaltNotice[] = [], kindAt = 0;
    const tick = async () => {
      const k = kstNow(), d = k.getUTCDay(), m = k.getUTCHours() * 60 + k.getUTCMinutes();
      if (d === 0 || d === 6 || m < 9 * 60 || m > 15 * 60 + 30) { setAlerts([]); return; }
      const [k2, kq, idx] = await Promise.all([fetchKrFuturesLive("kospi200").catch(() => null), fetchKrFuturesLive("kosdaq150").catch(() => null), indexPct()]);
      // KIND — 처음 한 번, 그 뒤엔 숫자가 기준선 근처(사이드카 −4%·서킷 −7%)일 때만 1분마다
      const near = Math.abs(k2?.pct ?? 0) >= 4 || Math.abs(kq?.pct ?? 0) >= 5 || (idx.KOSPI ?? 0) <= -7 || (idx.KOSDAQ ?? 0) <= -7;
      if (!kindAt || (near && Date.now() - kindAt > 55_000)) {
        kindAt = Date.now();
        try { offs = await fetchKindHalts(); } catch { /* 다음에 */ }
      }
      const a = [...officialAlerts(offs), ...numericAlerts(k2?.pct, kq?.pct, idx, offs)];
      const fresh = a.filter(x => !seen.has(x.key) && !dismissed().has(x.key));
      if (fresh.length) {
        beep();
        try {
          if ("Notification" in window && Notification.permission === "granted") fresh.forEach(x => new Notification(`${x.official ? "🚨" : "ℹ️"} ${x.text}`, { body: x.detail }));
        } catch { /* 알림 막힘 */ }
      }
      seen = new Set([...seen, ...a.map(x => x.key)]);
      setAlerts(a);
    };
    void tick();
    const id = setInterval(() => { void tick(); }, 30_000);
    return () => clearInterval(id);
  }, []);
  const show = alerts.filter(a => !closed.has(a.key));
  if (!show.length) return null;
  return (
    <div className="fixed top-1 left-1/2 -translate-x-1/2 z-[3000] flex flex-col gap-1 w-[min(660px,96vw)]">
      {show.map(a => (
        <div key={a.key} className={`flex items-start gap-2 rounded-lg shadow-xl px-3 py-2 text-white ${a.official ? "bg-red-600 animate-pulse" : "bg-blue-600"}`}>
          <span className="text-lg leading-none">{a.official ? "🚨" : "ℹ️"}</span>
          <div className="min-w-0 flex-1">
            <div className="font-black text-[14px]">{a.text}</div>
            <div className="text-[12px] opacity-95">{a.detail}</div>
            <div className="text-[10.5px] opacity-75">{a.official ? "출처: 거래소 KIND 시장조치 공시" : "앱이 숫자로 본 것(공식 발동 아님) · 30초마다"}</div>
          </div>
          <button onClick={() => { const s = new Set(closed); s.add(a.key); setClosed(s); saveDismissed(s); }}
                  className="px-1.5 rounded hover:bg-white/20 font-bold" title="오늘 이 경고는 다시 띄우지 않기">✕</button>
        </div>
      ))}
    </div>
  );
}
