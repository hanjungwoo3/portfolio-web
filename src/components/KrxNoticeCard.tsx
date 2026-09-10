// KRX 주가지수 공지 — 지수 정기변경 안내.
//
// 왜 필요한가 — 지수 규칙이 수급을 통째로 흔든다. 예를 들어 KRX 반도체지수는 종목당
//   20% 비중 상한이 있어서, 넘으면 정기변경 때 덜어낸다. 2026-09-10 에 그 조정으로
//   SK하이닉스 1.2조·삼성전자 0.2조 매도 수요가 나왔다. 펀더멘털과 무관한 기계적 매매인데
//   모르고 보면 악재로 읽힌다.
//
// 제목·날짜·링크만 보여준다. 본문·첨부는 형식이 정형화돼 있지 않아 파싱 품질을 장담 못 한다 —
//   원문으로 보내는 편이 정직하다. 데이터는 크롤러가 하루 1회 받아 둔다(프론트 0콜).

import { useEffect, useRef, useState } from "react";
import { openGoogleAi, aiNowStamp } from "../lib/googleAi";

// AI 해설 지시 — 공지 원문을 그대로 붙여 보낸다. 지수 규칙 문서는 용어가 빽빽해서
//   "그래서 내 종목에 무슨 일이 생기나" 를 사람이 읽어내기 어렵다.
const NOTICE_PROMPT =
  "당신은 한국 주식시장 지수 규칙을 일반 투자자에게 설명하는 AI다. " +
  "아래는 한국거래소(KRX)가 낸 주가지수 공지 원문이다. 다음 순서로 답하라. " +
  "1) 한 줄 요약 — 무슨 변경인지 " +
  "2) 언제부터 적용되는지(반영일), 지금 기준으로 이미 지났는지 남았는지 " +
  "3) 어떤 지수·종목이 영향을 받는지. 종목별 비중 상한(CAP) 조정이면 어느 종목이 " +
  "덜어지고 어느 쪽이 담기는지 추정하고, 가능하면 검색으로 실제 규모(금액)를 확인하라 " +
  "4) 이게 주가에 미치는 성격 — 펀더멘털 변화인가, 지수 추종 자금의 기계적 매매인가 " +
  "5) 투자자가 실제로 신경 쓸 점(있으면), 없으면 '특별히 없음' 이라고 분명히 말하라 " +
  "[규칙] 원문에 없는 수치는 지어내지 말고 검색으로 확인하되 출처를 밝혀라. " +
  "확인 못 하면 '확인 필요' 로 표기. 매수/매도 권유 금지. 마지막에 '투자 자문 아님' 명시.";

const URL_NOTICES =
  "https://raw.githubusercontent.com/hanjungwoo3/portfolio-etf-index/main/data/krx-notices.json";

interface KrxNotice { seq: string; title: string; date: string; url: string; body?: string }

// v2: 본문(body) 추가 — 키를 안 올리면 12시간 동안 본문 없는 옛 캐시를 읽는다.
const LS_KEY = "krx_notices_v2";
const LS_TS = "krx_notices_ts_v2";
const TTL_MS = 12 * 60 * 60 * 1000;
const SHOW = 5;          // 접힌 상태에서 보여줄 건수

let memo: KrxNotice[] | null = null;

async function loadNotices(): Promise<KrxNotice[]> {
  if (memo) return memo;
  try {
    const ts = Number(localStorage.getItem(LS_TS) ?? "0");
    const raw = localStorage.getItem(LS_KEY);
    if (raw && Date.now() - ts < TTL_MS) {
      const cached = JSON.parse(raw) as KrxNotice[];
      // 본문이 하나도 없으면 옛 형태다 — 키를 올려도 다음에 또 필드가 늘면 같은 일이 난다.
      //   형태로 판단해 스스로 버리게 해 두면 키 버전에만 기대지 않는다.
      if (cached.some(n => n.body)) { memo = cached; return memo; }
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
  const [opened, setOpened] = useState<KrxNotice | null>(null);

  useEffect(() => {
    let alive = true;
    void loadNotices().then(n => { if (alive) setNotices(n); }).catch(() => { /* 조용히 생략 */ });
    return () => { alive = false; };
  }, []);

  if (!notices || notices.length === 0) return null;
  const shown = expanded ? notices : notices.slice(0, SHOW);
  const freshCount = notices.filter(n => isRecent(n.date)).length;

  return (
    <div className="h-full flex flex-col rounded-xl border border-gray-300 bg-white p-2.5">
      <div className="flex items-baseline gap-2 mb-1.5">
        <span className="text-sm font-bold text-gray-800">📋 KRX 지수 공지</span>
        {freshCount > 0 && (
          <span className="px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 text-[10px] font-bold">
            최근 {freshCount}건
          </span>
        )}
        <span className="text-[11px] text-gray-400">정기변경·수시변경 — 누르면 KRX 원문</span>
      </div>
      {/* flex-1 — 옆 카드가 더 길면 남는 세로 공간을 목록이 차지한다(빈 여백 방지) */}
      <ul className="flex-1 divide-y divide-gray-100">
        {shown.map(n => (
          <li key={n.seq}>
            <button onClick={() => setOpened(n)}
                    className="w-full flex items-baseline gap-2 py-1.5 text-left
                               hover:bg-gray-50 transition-colors">
              <span className={`shrink-0 text-[11px] tabular-nums ${
                      isRecent(n.date) ? "text-amber-700 font-bold" : "text-gray-400"}`}>
                {n.date.slice(5)}
              </span>
              <span className="flex-1 min-w-0 truncate text-[12px] text-gray-700">{n.title}</span>
            </button>
          </li>
        ))}
      </ul>
      {notices.length > SHOW && (
        <button onClick={() => setExpanded(v => !v)}
                className="mt-1 text-[11px] text-gray-500 hover:text-gray-700 underline">
          {expanded ? "접기" : `더보기 (${notices.length - SHOW}건)`}
        </button>
      )}
      {opened && <NoticeDialog notice={opened} onClose={() => setOpened(null)} />}
    </div>
  );
}

// 공지 본문 팝업 — 크롤러가 받아 둔 본문이라 추가 조회가 없다.
function NoticeDialog({ notice, onClose }: { notice: KrxNotice; onClose: () => void }) {
  // 배경 클릭 판정 — 본문에서 드래그하다 배경에서 손을 떼도 닫히면 안 된다(앱의 다른 모달과 동일).
  const downOnBackdropRef = useRef(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-0 sm:p-4"
         onMouseDown={e => { if (e.target === e.currentTarget) downOnBackdropRef.current = true; }}
         onMouseUp={e => {
           if (e.target === e.currentTarget && downOnBackdropRef.current) onClose();
           downOnBackdropRef.current = false;
         }}>
      <div className="w-full sm:max-w-2xl max-h-[85vh] overflow-hidden flex flex-col
                      rounded-t-xl sm:rounded-xl bg-white shadow-xl"
           onMouseDown={e => e.stopPropagation()}>
        <header className="px-4 py-3 border-b bg-gray-50">
          <div className="flex items-start gap-2">
            <h2 className="flex-1 min-w-0 text-sm font-bold text-gray-800">{notice.title}</h2>
            <button onClick={onClose}
                    className="shrink-0 text-gray-400 hover:text-gray-600 text-xl leading-none">✕</button>
          </div>
          <div className="mt-1 flex items-center gap-1.5 flex-wrap text-[11px]">
            <span className="text-gray-500">{notice.date} · 한국거래소</span>
            <span className="flex-1" />
            <button onClick={() => openGoogleAi(
                      `${NOTICE_PROMPT}\n[기준시각] ${aiNowStamp()}\n[공지 제목] ${notice.title}` +
                      `\n[등록일] ${notice.date}\n[원문]\n${notice.body ?? "(본문 없음)"}`)}
                    title="공지 원문을 AI 에 붙여 해설 요청"
                    className="px-1.5 py-0.5 rounded border border-indigo-300 bg-indigo-50
                               text-indigo-700 font-bold hover:bg-indigo-100">
              🤖 AI 해설
            </button>
            <a href={notice.url} target="_blank" rel="noopener noreferrer"
               className="px-1.5 py-0.5 rounded border border-gray-300 bg-white
                          text-gray-600 hover:bg-gray-100">
              🔗 KRX 원문 ↗
            </a>
          </div>
        </header>
        <div className="overflow-y-auto overscroll-contain px-4 py-3">
          {notice.body
            ? <pre className="whitespace-pre-wrap break-words text-[12px] leading-relaxed
                              text-gray-800 font-sans">{notice.body}</pre>
            : <p className="text-[12px] text-gray-500">본문을 받지 못했습니다 — KRX 원문을 열어 주세요.</p>}
        </div>
        <p className="px-4 py-2 text-[10px] text-gray-400 border-t leading-relaxed">
          첨부파일(구성종목 목록 등)은 KRX 원문에서 받을 수 있습니다.
        </p>
      </div>
    </div>
  );
}
