import { useState, useEffect } from "react";
import { useQueries } from "@tanstack/react-query";
import { fetchTossNews, fetchTossNewsLink, type TossNewsItem, type TossNewsStock, type TossNewsCategory } from "../lib/api";

// 증시 뉴스 — 토스증권 뉴스(익명, 4카테고리). PC: 4블럭 한번에 / 모바일: 탭 1개씩.
//   클릭 시 언론사 원문 기사를 팝업 창으로(토스 X).

const FEED_URL = "https://www.tossinvest.com/feed/news";
const flag = (nation: string) => (nation === "KR" ? "🇰🇷" : nation === "US" ? "🇺🇸" : "");
const CATS: { key: TossNewsCategory; label: string }[] = [
  { key: "PERSONALIZED", label: "인기뉴스" },
  { key: "ALL_HIGHLIGHT", label: "주요뉴스" },
  { key: "HOT", label: "최신뉴스" },
  { key: "SOARING_STOCK", label: "급상승" },
];

function useIsWide() {
  const [wide, setWide] = useState(() => typeof window !== "undefined" && window.matchMedia("(min-width: 768px)").matches);
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 768px)");
    const on = () => setWide(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return wide;
}

function ago(iso: string): string {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return "";
  const m = Math.floor((Date.now() - t) / 60000);
  if (m < 1) return "방금";
  if (m < 60) return `${m}분 전`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}시간 전`;
  return `${Math.floor(h / 24)}일 전`;
}

// 클릭 → 상세에서 원문 URL 조회 후 팝업 창(넓게)으로 이동. 팝업 차단 방지 위해 빈 창 먼저 동기로 open.
function openOriginal(newsId: string) {
  const w = Math.min(1440, Math.max(480, window.screen.width - 80)), h = 800;
  const left = Math.max(0, Math.round((window.screen.width - w) / 2));
  const top = Math.max(0, Math.round((window.screen.height - h) / 2));
  const win = window.open("about:blank", "tossNews", `popup=yes,width=${w},height=${h},left=${left},top=${top}`);
  if (win) win.opener = null;
  fetchTossNewsLink(newsId).then(url => {
    if (!win) return;
    if (url) win.location.href = url;
    else win.close();
  }).catch(() => win?.close());
}

function StockChip({ s }: { s: TossNewsStock }) {
  const f = s.fluctuation;
  const cls = f == null ? "text-gray-500" : f > 0 ? "text-rose-600" : f < 0 ? "text-blue-600" : "text-gray-500";
  return (
    <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 whitespace-nowrap">
      <span className="text-gray-600">{s.stockName}</span>
      {f != null && <span className={`ml-0.5 font-bold tabular-nums ${cls}`}>{f > 0 ? "+" : ""}{f.toFixed(2)}%</span>}
    </span>
  );
}

function NewsRow({ n }: { n: TossNewsItem }) {
  return (
    <button type="button" onClick={() => openOriginal(n.newsId)}
       className="w-full text-left flex gap-2 p-2 rounded-lg hover:bg-gray-50 transition-colors">
      {n.imageUrl && (
        <img src={n.imageUrl} alt="" loading="lazy"
             className="w-16 h-16 object-cover rounded-md shrink-0 bg-gray-100"
             onError={e => { (e.currentTarget as HTMLImageElement).style.display = "none"; }} />
      )}
      <div className="min-w-0 flex-1">
        <div className="text-[11px] text-gray-400 flex items-center gap-1">
          <span>{flag(n.nation)} {n.agency}</span><span>·</span><span>{ago(n.createdAt)}</span>
        </div>
        <div className="text-sm font-bold text-gray-800 leading-snug line-clamp-2">{n.title}</div>
        {n.summary && <div className="text-xs text-gray-500 leading-snug line-clamp-2 mt-0.5">{n.summary}</div>}
        {n.stocks.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-1">
            {n.stocks.slice(0, 4).map(s => <StockChip key={s.stockCode} s={s} />)}
          </div>
        )}
      </div>
    </button>
  );
}

function NewsList({ items }: { items: TossNewsItem[] }) {
  if (items.length === 0) return <div className="py-6 text-center text-xs text-gray-400">뉴스 불러오는 중…</div>;
  return <div className="divide-y divide-gray-100">{items.map(n => <NewsRow key={n.newsId} n={n} />)}</div>;
}

export function NewsFeed() {
  const isWide = useIsWide();
  const [active, setActive] = useState<TossNewsCategory>("PERSONALIZED");
  const results = useQueries({
    queries: CATS.map(c => ({
      queryKey: ["tossNews", c.key],
      queryFn: () => fetchTossNews(c.key),
      enabled: isWide || c.key === active,   // 모바일은 선택 탭만, PC는 4개 모두
      staleTime: 2 * 60 * 1000,
      refetchInterval: 3 * 60 * 1000,
      refetchOnWindowFocus: false,
    })),
  });
  const dataByCat = new Map<TossNewsCategory, TossNewsItem[]>();
  CATS.forEach((c, i) => dataByCat.set(c.key, results[i].data ?? []));

  return (
    <div className="relative rounded-xl border border-gray-300 bg-white p-2.5 pt-4 mt-1.5">
      <a href={FEED_URL} target="_blank" rel="noopener noreferrer"
         className="absolute -top-3 left-3 z-10 px-2 py-0.5 rounded-md border border-gray-300 bg-gray-50
                    text-sm font-bold text-gray-700 whitespace-nowrap hover:bg-gray-100 hover:text-blue-600">
        📰 증시 뉴스 <span className="text-[10px] text-gray-400">↗</span>
      </a>

      {isWide ? (
        // PC — 4개 카테고리 블럭을 한번에
        <div className="grid grid-cols-2 xl:grid-cols-4 gap-x-3 gap-y-2">
          {CATS.map(c => (
            <div key={c.key} className="min-w-0">
              <div className="text-xs font-bold text-gray-700 mb-1 px-0.5 sticky top-0 bg-white">{c.label}</div>
              <div className="max-h-[70vh] overflow-y-auto">
                <NewsList items={dataByCat.get(c.key)!} />
              </div>
            </div>
          ))}
        </div>
      ) : (
        // 모바일 — 탭으로 1개씩
        <>
          <div className="flex flex-wrap gap-1 mb-1.5">
            {CATS.map(c => (
              <button key={c.key} onClick={() => setActive(c.key)}
                      className={`px-2 py-0.5 rounded-md text-[11px] font-semibold border transition-colors ${
                        active === c.key
                          ? "bg-gray-800 text-white border-gray-800"
                          : "bg-white text-gray-500 border-gray-300 hover:bg-gray-50"}`}>
                {c.label}
              </button>
            ))}
          </div>
          <NewsList items={dataByCat.get(active)!} />
        </>
      )}
    </div>
  );
}
