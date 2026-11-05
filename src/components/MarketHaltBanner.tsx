// 사이드카·서킷브레이커 경고(사용자 2026-11-05 "매도 사이드카 발동인데 이런 경우 경고 알람 넣자").
//   거래소 규칙(발동 조건) — 숫자로 판정한 '발동 수준'이다(거래소 공식 발동 신호를 무료로 주는 곳이 없다):
//   · 사이드카(프로그램 매매 5분 정지): 코스피200 선물 ±5%(1분 지속) / 코스닥150 선물 ±6%(+ 코스닥150 지수 ±3%, 1분 지속). 하루 한 번, 14:50 뒤엔 안 걸린다
//   · 서킷브레이커(매매 20분 정지): 코스피·코스닥 지수 −8% / −15% / −20%(1분 지속)
//   30초마다 본다(평일 09:00~15:30). 처음 넘는 순간 화면 맨 위 붉은 띠 + 소리 + 알림(허용했으면). ✕ 로 닫으면 그 단계는 오늘 다시 안 띄운다.
import { useEffect, useState } from "react";
import { fetchKrFuturesLive, fetchProxied } from "../lib/api";

interface Alert { key: string; level: "side" | "cb"; text: string; detail: string; down: boolean }
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

async function check(): Promise<Alert[]> {
  const [k2, kq, idx] = await Promise.all([fetchKrFuturesLive("kospi200").catch(() => null), fetchKrFuturesLive("kosdaq150").catch(() => null), indexPct()]);
  const out: Alert[] = [];
  const m = kstNow().getUTCHours() * 60 + kstNow().getUTCMinutes();
  const side = (name: string, pct: number | undefined, th: number) => {
    if (pct == null || !Number.isFinite(pct) || Math.abs(pct) < th || m > 14 * 60 + 50) return;
    const down = pct < 0;
    out.push({ key: `side-${name}-${down ? "d" : "u"}`, level: "side", down,
      text: `${name} ${down ? "매도" : "매수"} 사이드카 기준선 넘음`,
      // 단정 금지 — 숫자 비교일 뿐, 실제 발동은 거래소가 정한다(1분 지속·하루 한 번)(사용자 2026-11-05 "공식이 아닌데 멈춘다는게 뭔 말이야")
      detail: `${name === "코스피" ? "코스피200" : "코스닥150"} 선물 ${pct > 0 ? "+" : ""}${pct.toFixed(2)}% (기준 ±${th}%) — 1분 이어지면 거래소가 프로그램 ${down ? "매도" : "매수"} 주문만 5분 정지(일반 매매는 그대로, 하루 한 번만 — 오늘 이미 걸렸으면 다시 안 걸림)` });
  };
  side("코스피", k2?.pct, 5);
  side("코스닥", kq?.pct, 6);
  for (const [code, name] of [["KOSPI", "코스피"], ["KOSDAQ", "코스닥"]] as const) {
    const p = idx[code];
    if (p == null || !Number.isFinite(p)) continue;
    const stage = p <= -20 ? 3 : p <= -15 ? 2 : p <= -8 ? 1 : 0;
    if (stage) out.push({ key: `cb-${code}-${stage}`, level: "cb", down: true,
      text: `${name} 서킷브레이커 ${stage}단계 기준선 넘음`,
      detail: `${name} 지수 ${p.toFixed(2)}% (기준 −${[8, 15, 20][stage - 1]}%) — 1분 이어지면 거래소가 ${stage === 3 ? "그날 장을 끝냄" : "모든 매매를 20분 정지(단계마다 하루 한 번)"}` });
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
    let seen = new Set<string>();
    const tick = async () => {
      const k = kstNow(), d = k.getUTCDay(), m = k.getUTCHours() * 60 + k.getUTCMinutes();
      if (d === 0 || d === 6 || m < 9 * 60 || m > 15 * 60 + 30) { setAlerts([]); return; }
      const a = await check();
      const fresh = a.filter(x => !seen.has(x.key) && !dismissed().has(x.key));
      if (fresh.length) {
        beep();
        try {
          if ("Notification" in window && Notification.permission === "granted") fresh.forEach(x => new Notification(`⚠️ ${x.text}`, { body: x.detail }));
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
    <div className="fixed top-1 left-1/2 -translate-x-1/2 z-[3000] flex flex-col gap-1 w-[min(640px,96vw)]">
      {show.map(a => (
        <div key={a.key} className={`flex items-start gap-2 rounded-lg shadow-xl px-3 py-2 text-white ${a.level === "cb" ? "bg-red-800" : "bg-red-600"} animate-pulse`}>
          <span className="text-lg leading-none">⚠️</span>
          <div className="min-w-0 flex-1">
            <div className="font-black text-[14px]">{a.text}</div>
            <div className="text-[12px] opacity-95">{a.detail}</div>
            <div className="text-[10.5px] opacity-75">앱이 숫자로 본 것 — 실제 발동 여부는 거래소 공지로 확인 · 30초마다</div>
          </div>
          <button onClick={() => { const s = new Set(closed); s.add(a.key); setClosed(s); saveDismissed(s); }}
                  className="px-1.5 rounded hover:bg-white/20 font-bold" title="오늘 이 경고는 다시 띄우지 않기">✕</button>
        </div>
      ))}
    </div>
  );
}
