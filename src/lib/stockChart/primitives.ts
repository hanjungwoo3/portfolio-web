// 사용자 그리기 렌더러 — lightweight-charts v5 의 공식 확장점(ISeriesPrimitive)을 쓴다.
//
// 왜 primitive 인가 — 차트 위에 별도 <canvas> 를 겹치면 줌·팬·리사이즈마다 우리가 직접
//   동기화해야 하고 한 프레임씩 어긋난다. primitive 는 라이브러리가 다시 그릴 때 같이
//   불려서 좌표가 항상 맞는다(사양서 §6 "현재 차트 변환 API로 다시 렌더링").
//
// 역할 분담: 수평선·가격선은 라이브러리의 createPriceLine 이 그린다(우측 축 배지를
//   공짜로 얻는다). 여기서는 추세선·피보나치·미리보기·선택 표시만 그린다.

import type {
  IPrimitivePaneRenderer, IPrimitivePaneView, ISeriesPrimitive,
  SeriesAttachedParameter, Time,
} from "lightweight-charts";
import type { CanvasRenderingTarget2D } from "fancy-canvas";
import type { Drawing, Anchor } from "./types";
import { FIB_LEVELS } from "./types";
import { fibLevels } from "./geometry";

export interface PreviewShape {
  type: "trend" | "fibonacci";
  a: Anchor;
  b: Anchor | null;   // 아직 끝점을 안 찍었으면 null (첫 점 핸들만 그린다)
  color: string;
}

/** 앵커 → 화면 좌표. 변환할 수 없으면 null(사양서 §6 — 그 부분만 안 그리고 원본은 유지). */
export type Project = (a: Anchor) => { x: number; y: number } | null;

export interface DrawingLayerState {
  drawings: Drawing[];
  selectedId: string | null;
  preview: PreviewShape | null;
  project: Project;
  priceFormat: (v: number) => string;
}

const HANDLE_R = 5;

function setDash(ctx: CanvasRenderingContext2D, line: "solid" | "dashed") {
  ctx.setLineDash(line === "dashed" ? [6, 4] : []);
}

function drawHandle(ctx: CanvasRenderingContext2D, x: number, y: number, color: string) {
  ctx.save();
  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.arc(x, y, HANDLE_R, 0, Math.PI * 2);
  ctx.fillStyle = "#ffffff";
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = color;
  ctx.stroke();
  ctx.restore();
}

class DrawingPaneRenderer implements IPrimitivePaneRenderer {
  private readonly state: DrawingLayerState;
  constructor(state: DrawingLayerState) { this.state = state; }

  draw(target: CanvasRenderingTarget2D): void {
    target.useMediaCoordinateSpace(scope => {
      const ctx = scope.context;
      const W = scope.mediaSize.width;
      const { drawings, selectedId, preview, project, priceFormat } = this.state;

      for (const d of drawings) {
        const selected = d.id === selectedId;
        if (d.type === "trend") this.paintTrend(ctx, d, selected, project);
        else if (d.type === "fibonacci") this.paintFib(ctx, d, selected, project, W, priceFormat);
        else if (selected) this.paintLevelSelection(ctx, d.price, d.style.color, project, W);
      }

      if (preview) this.paintPreview(ctx, preview, project, W, priceFormat);
    });
  }

  private paintTrend(
    ctx: CanvasRenderingContext2D,
    d: Extract<Drawing, { type: "trend" }>, selected: boolean, project: Project,
  ) {
    const pa = project(d.a), pb = project(d.b);
    if (!pa || !pb) return;
    ctx.save();
    ctx.strokeStyle = d.style.color;
    ctx.lineWidth = d.style.width + (selected ? 1 : 0);
    setDash(ctx, d.style.line);
    ctx.beginPath();
    ctx.moveTo(pa.x, pa.y);
    ctx.lineTo(pb.x, pb.y);
    ctx.stroke();
    ctx.restore();
    if (selected) {
      drawHandle(ctx, pa.x, pa.y, d.style.color);
      drawHandle(ctx, pb.x, pb.y, d.style.color);
    }
  }

  private paintFib(
    ctx: CanvasRenderingContext2D,
    d: Extract<Drawing, { type: "fibonacci" }>, selected: boolean, project: Project,
    width: number, priceFormat: (v: number) => string,
  ) {
    const pa = project(d.a), pb = project(d.b);
    if (!pa || !pb) return;
    const x1 = Math.min(pa.x, pb.x), x2 = Math.max(pa.x, pb.x);
    const levels = fibLevels(d.a.price, d.b.price, d.levels.length > 0 ? d.levels : FIB_LEVELS);

    ctx.save();
    ctx.lineWidth = selected ? d.style.width + 0.5 : d.style.width;
    for (const { ratio, price } of levels) {
      const p = project({ time: d.a.time, price });
      if (!p) continue;
      ctx.strokeStyle = d.style.color;
      ctx.globalAlpha = ratio === 0 || ratio === 1 ? 1 : 0.65;
      setDash(ctx, ratio === 0 || ratio === 1 ? "solid" : "dashed");
      ctx.beginPath();
      ctx.moveTo(x1, p.y);
      ctx.lineTo(x2, p.y);
      ctx.stroke();

      ctx.globalAlpha = 1;
      ctx.setLineDash([]);
      ctx.font = "10px system-ui, -apple-system, sans-serif";
      ctx.fillStyle = d.style.color;
      ctx.textBaseline = "bottom";
      const label = `${(ratio * 100).toFixed(1)}%  ${priceFormat(price)}`;
      // 좌측에 붙이되 화면 밖으로 나가면 선 안쪽으로 당긴다.
      const tx = Math.max(2, Math.min(x1 + 2, width - ctx.measureText(label).width - 2));
      ctx.fillText(label, tx, p.y - 1);
    }
    // A→B 연결 가이드
    ctx.globalAlpha = 0.5;
    ctx.setLineDash([2, 3]);
    ctx.strokeStyle = d.style.color;
    ctx.beginPath();
    ctx.moveTo(pa.x, pa.y);
    ctx.lineTo(pb.x, pb.y);
    ctx.stroke();
    ctx.restore();

    if (selected) {
      drawHandle(ctx, pa.x, pa.y, d.style.color);
      drawHandle(ctx, pb.x, pb.y, d.style.color);
    }
  }

  /** 수평선·가격선은 createPriceLine 이 그린다 — 선택됐을 때만 강조를 덧그린다. */
  private paintLevelSelection(
    ctx: CanvasRenderingContext2D, price: number, color: string, project: Project, width: number,
  ) {
    const p = project({ time: { kind: "date", value: "" }, price });
    if (!p) return;
    ctx.save();
    ctx.strokeStyle = color;
    ctx.globalAlpha = 0.28;
    ctx.lineWidth = 9;
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(0, p.y);
    ctx.lineTo(width, p.y);
    ctx.stroke();
    ctx.restore();
  }

  private paintPreview(
    ctx: CanvasRenderingContext2D, pv: PreviewShape, project: Project,
    width: number, priceFormat: (v: number) => string,
  ) {
    const pa = project(pv.a);
    if (!pa) return;
    if (!pv.b) { drawHandle(ctx, pa.x, pa.y, pv.color); return; }
    const pb = project(pv.b);
    if (!pb) { drawHandle(ctx, pa.x, pa.y, pv.color); return; }

    ctx.save();
    ctx.globalAlpha = 0.85;
    ctx.strokeStyle = pv.color;
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 4]);
    if (pv.type === "trend") {
      ctx.beginPath();
      ctx.moveTo(pa.x, pa.y);
      ctx.lineTo(pb.x, pb.y);
      ctx.stroke();
    } else {
      const x1 = Math.min(pa.x, pb.x), x2 = Math.max(pa.x, pb.x);
      for (const { ratio, price } of fibLevels(pv.a.price, pv.b.price, FIB_LEVELS)) {
        const p = project({ time: pv.a.time, price });
        if (!p) continue;
        ctx.beginPath();
        ctx.moveTo(x1, p.y);
        ctx.lineTo(x2, p.y);
        ctx.stroke();
        ctx.globalAlpha = 1;
        ctx.setLineDash([]);
        ctx.font = "10px system-ui, -apple-system, sans-serif";
        ctx.fillStyle = pv.color;
        ctx.textBaseline = "bottom";
        const label = `${(ratio * 100).toFixed(1)}%  ${priceFormat(price)}`;
        ctx.fillText(label, Math.max(2, Math.min(x1 + 2, width - 80)), p.y - 1);
        ctx.globalAlpha = 0.85;
        ctx.setLineDash([5, 4]);
      }
    }
    ctx.restore();
    drawHandle(ctx, pa.x, pa.y, pv.color);
    drawHandle(ctx, pb.x, pb.y, pv.color);
  }
}

class DrawingPaneView implements IPrimitivePaneView {
  private readonly state: DrawingLayerState;
  constructor(state: DrawingLayerState) { this.state = state; }
  zOrder() { return "top" as const; }
  renderer(): IPrimitivePaneRenderer { return new DrawingPaneRenderer(this.state); }
}

/**
 * 그리기 레이어. React state 를 매 프레임 갱신하지 않기 위해 가변 객체를 들고 있다가
 * `update()` 로 갈아끼우고 라이브러리에 다시 그리라고만 알린다(사양서 §8).
 */
export class DrawingLayer implements ISeriesPrimitive<Time> {
  private state: DrawingLayerState;
  private readonly views: IPrimitivePaneView[];
  private requestUpdate?: () => void;

  constructor(initial: DrawingLayerState) {
    this.state = initial;
    // 캐시 때문에 매번 새 배열을 만들면 안 된다 — 뷰 객체는 고정하고 내용만 바꾼다.
    this.views = [new DrawingPaneView(this.state)];
  }

  update(next: Partial<DrawingLayerState>): void {
    Object.assign(this.state, next);
    this.requestUpdate?.();
  }

  attached(p: SeriesAttachedParameter<Time>): void { this.requestUpdate = p.requestUpdate; }
  detached(): void { this.requestUpdate = undefined; }
  updateAllViews(): void { /* state 는 참조로 공유돼 별도 계산이 없다 */ }
  paneViews(): readonly IPrimitivePaneView[] { return this.views; }
}
