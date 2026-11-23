// 종목 묶음 타일 팝업 열기 — 어디서든(업종 한눈에 칸 이름 등). 실제 창은 TilePopupHost(App·Mobile 최상위)
export const OPEN_TILE_POPUP = "open-tile-popup";
// reg = 정규장 등락률, aft = 그 뒤(프리·애프터·데이·NXT) 정규장 종가 대비, ses = 그 구간 이름 — 업종 표와 같은 값(사용자 2026-11-10 "정규장/프리·애프터 다 나오면")
// refresh = 떠 있는 동안 5초마다 다시 부를 함수(부른 화면의 최신 값) — 연 순간 값에 멈춰 늦었다(사용자 2026-11-23 "갱신이 늦어")
export interface TilePopupReq { title: string; refresh?: () => TilePopupReq["items"]; items: { sym: string; name: string; pct?: number | null; reg?: number | null; aft?: number | null; ses?: string; dim?: boolean; price?: number | null }[] }   // price = 부른 쪽이 이미 가진 값(일본 종목 등, 팝업이 따로 못 받는 시세)
export function openTilePopup(req: TilePopupReq) { window.dispatchEvent(new CustomEvent<TilePopupReq>(OPEN_TILE_POPUP, { detail: req })); }
