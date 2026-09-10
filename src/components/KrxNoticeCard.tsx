// KRX 주가지수 공지 — 지수 정기변경 안내.
//
// 왜 필요한가 — 지수 규칙이 수급을 통째로 흔든다. 예를 들어 KRX 반도체지수는 종목당
//   20% 비중 상한이 있어서, 넘으면 정기변경 때 덜어낸다. 2026-09-10 에 그 조정으로
//   SK하이닉스 1.2조·삼성전자 0.2조 매도 수요가 나왔다. 펀더멘털과 무관한 기계적 매매인데
//   모르고 보면 악재로 읽힌다.
//
// 제목·날짜·링크만 보여준다. 본문·첨부는 형식이 정형화돼 있지 않아 파싱 품질을 장담 못 한다 —
//   원문으로 보내는 편이 정직하다. 데이터는 크롤러가 하루 1회 받아 둔다(프론트 0콜).

import { useEffect, useState } from "react";

const URL_NOTICES =
  "https://raw.githubusercontent.com/hanjungwoo3/portfolio-etf-index/main/data/krx-notices.json";

interface KrxNotice { seq: string; title: string; date: string; url: string }

const LS_KEY = "krx_notices_v1";
const LS_TS = "krx_notices_ts_v1";
const TTL_MS = 12 * 60 * 60 * 1000;
const SHOW = 5;          // 접힌 상태에서 보여줄 건수

let memo: KrxNotice[] | null = null;

async function loadNotices(): Promise<KrxNotice[]> {
  if (memo) return memo;
  try {
    const ts = Number(localStorage.getItem(LS_TS) ?? "0");
    const raw = localStorage.getItem(LS_KEY);
    if (raw && Date.now() - ts < TTL_MS) {
      memo = JSON.parse(raw) as KrxNotice[];
      return memo;
    }
  } catch { /* noop */ }
  const r = await fetch(URL_NOTICES, { cache: "no-store" });
  if (!r.ok) throw new Error(`krx-notices HTTP ${r.status}`);
  const json = await r.json() as { notices?: KrxNotice[] };
  memo = json.notices ?? [];
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(memo));
    localStorage.setItem(LS_TS, String(Date.now()));
  } catch { /* 용량 초과 — 캐시 없이도 동작 */ }
  return memo;
}

// 최근 2주 안이면 '새 공지' 로 본다 — 정기변경은 분기마다라 그 정도면 충분히 임박이다.
function isRecent(date: string): boolean {
  const t = Date.parse(`${date}T00:00:00+09:00`);
  return Number.isFinite(t) && Date.now() - t < 14 * 86400_000;
}

export function KrxNoticeCard() {
  const [notices, setNotices] = useState<KrxNotice[] | null>(null);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    let alive = true;
    void loadNotices().then(n => { if (alive) setNotices(n); }).catch(() => { /* 조용히 생략 */ });
    return () => { alive = false; };
  }, []);

  if (!notices || notices.length === 0) return null;
  const shown = expanded ? notices : notices.slice(0, SHOW);
  const freshCount = notices.filter(n => isRecent(n.date)).length;

  return (
    <div className="rounded-xl border border-gray-300 bg-white p-2.5">
      <div className="flex items-baseline gap-2 mb-1.5">
        <span className="text-sm font-bold text-gray-800">📋 KRX 지수 공지</span>
        {freshCount > 0 && (
          <span className="px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 text-[10px] font-bold">
            최근 {freshCount}건
          </span>
        )}
        <span className="text-[11px] text-gray-400">정기변경·수시변경 — 누르면 KRX 원문</span>
      </div>
      <ul className="divide-y divide-gray-100">
        {shown.map(n => (
          <li key={n.seq}>
            <a href={n.url} target="_blank" rel="noopener noreferrer"
               className="flex items-baseline gap-2 py-1.5 hover:bg-gray-50 transition-colors">
              <span className={`shrink-0 text-[11px] tabular-nums ${
                      isRecent(n.date) ? "text-amber-700 font-bold" : "text-gray-400"}`}>
                {n.date.slice(5)}
              </span>
              <span className="flex-1 min-w-0 truncate text-[12px] text-gray-700">{n.title}</span>
              <span className="shrink-0 text-[10px] text-gray-400">↗</span>
            </a>
          </li>
        ))}
      </ul>
      {notices.length > SHOW && (
        <button onClick={() => setExpanded(v => !v)}
                className="mt-1 text-[11px] text-gray-500 hover:text-gray-700 underline">
          {expanded ? "접기" : `더보기 (${notices.length - SHOW}건)`}
        </button>
      )}
    </div>
  );
}
