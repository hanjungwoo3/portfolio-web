// 종목 묶음 타일 팝업 열기 — 어디서든(업종 한눈에 칸 이름 등). 실제 창은 TilePopupHost(App·Mobile 최상위)
export const OPEN_TILE_POPUP = "open-tile-popup";
export interface TilePopupReq { title: string; items: { sym: string; name: string; pct?: number | null }[] }
export function openTilePopup(req: TilePopupReq) { window.dispatchEvent(new CustomEvent<TilePopupReq>(OPEN_TILE_POPUP, { detail: req })); }
