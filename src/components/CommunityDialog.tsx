// 종목별 커뮤니티 팝업 — 토스 커뮤니티 + 네이버 종목토론실을 좌우로 나눠 한 화면에 동시 표시.
//   둘 다 API/스크랩으로 "커뮤니티(글)만" 렌더 → 네이버 페이지 헤더/시세 chrome 없이 글 목록만.
//   · 토스: wts-cert-api /api/v4/comments (fetchTossCommunity) — 닉네임·뱃지·보유여부·좋아요.
//   · 네이버: finance.naver.com/item/board.naver 글 목록 스크랩(fetchNaverBoard) — 제목 클릭=원문.
import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { useQuery } from "@tanstack/react-query";
import {
  fetchTossCommunity, type TossCommunityComment,
  fetchNaverBoard, type NaverBoardPost,
} from "../lib/api";
import { useEscClose } from "../lib/useEscClose";
import { useLastRefresh } from "../lib/lastRefresh";

// 전역 갱신 신호(useLastRefresh) 가 바뀔 때 refetch — 전역 poll 과 같은 타이밍에 함께 갱신.
//   마운트 시 최초 값은 건너뜀(useQuery 가 이미 초기 fetch 함).
function useRefetchOnGlobalPoll(refreshTs: number, refetch: () => void) {
  const seen = useRef(refreshTs);
  useEffect(() => {
    if (refreshTs !== seen.current) { seen.current = refreshTs; refetch(); }
  }, [refreshTs, refetch]);
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
  ticker: string;   // 6자리 KR 코드
  name: string;
}

// 상대시각 (ISO)
function ago(iso: string): string {
  if (!iso) return "";
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return "";
  const s = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (s < 60) return `${s}초 전`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}분 전`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}시간 전`;
  return `${Math.floor(h / 24)}일 전`;
}
// 네이버 날짜 "2026.07.27 08:49" → 상대시각
function agoNaver(d: string): string {
  const m = d.match(/(\d{4})\.(\d{2})\.(\d{2})\s+(\d{2}):(\d{2})/);
  if (!m) return d;
  const [, y, mo, dd, hh, mi] = m;
  return ago(`${y}-${mo}-${dd}T${hh}:${mi}:00+09:00`);
}

function PaneShell({ title, right, children }: { title: string; right?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="h-full flex flex-col min-h-0 border border-gray-200 rounded-md overflow-hidden">
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-gray-200 bg-gray-50 shrink-0">
        <span className="text-xs font-bold text-gray-700">{title}</span>
        {right}
      </div>
      <div className="flex-1 overflow-y-auto min-h-0">{children}</div>
    </div>
  );
}

function TossComment({ c }: { c: TossCommunityComment }) {
  return (
    <div className="border-b border-gray-100 px-3 py-2.5">
      <div className="flex items-center gap-1.5 mb-1">
        {c.profileUrl
          ? <img src={c.profileUrl} alt="" className="w-5 h-5 rounded-full object-cover bg-gray-100"
                 onError={e => { e.currentTarget.style.visibility = "hidden"; }} />
          : <div className="w-5 h-5 rounded-full bg-gray-200" />}
        <span className="text-xs font-semibold text-gray-800 truncate max-w-[110px]">{c.nickname}</span>
        {c.badge && (
          <span className="text-[10px] font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 rounded px-1 py-px shrink-0">
            {c.badge}
          </span>
        )}
        {c.holding && (
          <span className="text-[10px] font-medium text-blue-700 bg-blue-50 border border-blue-200 rounded px-1 py-px shrink-0">
            보유중
          </span>
        )}
        <span className="text-[10px] text-gray-400 ml-auto shrink-0">{ago(c.createdAt)}</span>
      </div>
      <div className="text-[13px] text-gray-800 whitespace-pre-wrap break-words leading-snug">{c.message}</div>
      <div className="flex items-center gap-3 mt-1.5 text-[11px] text-gray-400">
        <span>♡ {c.likeCount.toLocaleString()}</span>
        <span>💬 {c.replyCount.toLocaleString()}</span>
      </div>
    </div>
  );
}

function TossPane({ ticker, refreshTs }: { ticker: string; refreshTs: number }) {
  const { data, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ["toss-community", ticker],
    queryFn: () => fetchTossCommunity(ticker),
    staleTime: 20 * 1000, refetchOnWindowFocus: false,
  });
  useRefetchOnGlobalPoll(refreshTs, refetch);
  const tossUrl = `https://www.tossinvest.com/stocks/A${ticker}/community`;
  return (
    <PaneShell title="🟦 토스 커뮤니티"
      right={
        <span className="flex items-center gap-2">
          <button onClick={() => refetch()} className="text-[11px] text-blue-600 hover:underline">
            {isFetching ? "갱신 중…" : "새로고침"}
          </button>
          <a href={tossUrl} target="_blank" rel="noopener noreferrer" className="text-[11px] text-gray-400 hover:underline">원본↗</a>
        </span>
      }>
      {isLoading ? <div className="text-center text-xs text-gray-400 py-10">불러오는 중…</div>
        : isError ? <div className="text-center text-xs text-gray-400 py-10">불러오지 못했어요.</div>
        : !data || data.length === 0 ? <div className="text-center text-xs text-gray-400 py-10">아직 글이 없어요.</div>
        : data.map(c => <TossComment key={c.id} c={c} />)}
    </PaneShell>
  );
}

function NaverPost({ p }: { p: NaverBoardPost }) {
  return (
    <a href={p.url} target="_blank" rel="noopener noreferrer"
       className="block border-b border-gray-100 px-3 py-2 hover:bg-gray-50">
      <div className="text-[13px] text-gray-800 break-words leading-snug line-clamp-2">{p.title}</div>
      <div className="flex items-center gap-2 mt-1 text-[11px] text-gray-400">
        <span className="truncate max-w-[90px]">{p.author}</span>
        <span>{agoNaver(p.date)}</span>
        <span className="ml-auto shrink-0">조회 {p.views.toLocaleString()}</span>
        {p.up > 0 && <span className="text-rose-500 shrink-0">👍{p.up}</span>}
      </div>
    </a>
  );
}

function NaverPane({ ticker, refreshTs }: { ticker: string; refreshTs: number }) {
  const { data, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ["naver-board", ticker],
    queryFn: () => fetchNaverBoard(ticker),
    staleTime: 20 * 1000, refetchOnWindowFocus: false,
  });
  useRefetchOnGlobalPoll(refreshTs, refetch);
  const naverUrl = `https://finance.naver.com/item/board.naver?code=${ticker}`;
  return (
    <PaneShell title="🟩 네이버 종목토론실"
      right={
        <span className="flex items-center gap-2">
          <button onClick={() => refetch()} className="text-[11px] text-blue-600 hover:underline">
            {isFetching ? "갱신 중…" : "새로고침"}
          </button>
          <a href={naverUrl} target="_blank" rel="noopener noreferrer" className="text-[11px] text-gray-400 hover:underline">원본↗</a>
        </span>
      }>
      {isLoading ? <div className="text-center text-xs text-gray-400 py-10">불러오는 중…</div>
        : isError ? <div className="text-center text-xs text-gray-400 py-10">불러오지 못했어요.</div>
        : !data || data.length === 0 ? <div className="text-center text-xs text-gray-400 py-10">글이 없어요.</div>
        : data.map(p => <NaverPost key={p.id} p={p} />)}
    </PaneShell>
  );
}

export function CommunityDialog({ isOpen, onClose, ticker, name }: Props) {
  useEscClose(isOpen, onClose);
  const refreshTs = useLastRefresh();   // 전역 갱신 신호 — 이 값 바뀔 때 두 패널 함께 refetch
  if (!isOpen) return null;

  // 카드 내부에서 렌더되므로 stacking context 에 갇히지 않도록 body 로 portal (다른 다이얼로그와 동일).
  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4"
         onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="bg-white rounded-lg shadow-xl w-full max-w-3xl h-[82vh] flex flex-col overflow-hidden">
        {/* 헤더 */}
        <div className="flex items-center gap-2 px-4 py-2.5 border-b border-gray-200 shrink-0">
          <span className="text-sm font-bold text-gray-900 truncate">💬 {name} 커뮤니티</span>
          <span className="text-[11px] text-gray-400">{ticker}</span>
          <button onClick={onClose}
                  className="ml-auto w-7 h-7 flex items-center justify-center rounded hover:bg-gray-100 text-gray-500 text-lg">
            ✕
          </button>
        </div>
        {/* 좌우 분할 (모바일은 세로 스택) */}
        <div className="flex-1 min-h-0 p-2 grid grid-cols-1 sm:grid-cols-2 gap-2">
          <TossPane ticker={ticker} refreshTs={refreshTs} />
          <NaverPane ticker={ticker} refreshTs={refreshTs} />
        </div>
      </div>
    </div>,
    document.body,
  );
}

export default CommunityDialog;
