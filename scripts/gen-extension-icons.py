#!/usr/bin/env python3
"""확장 아이콘 생성 — extension/icons/icon{16,32,48,128}.png

수정 후 `python3 scripts/gen-extension-icons.py` 로 다시 만든다.
16px 에서도 읽혀야 하므로 형태는 최소한으로: 둥근 사각형 + 상승 막대 3개.
마지막 막대는 한국 관행대로 상승=빨강.
"""
from PIL import Image, ImageDraw

BG      = (30, 58, 138)     # blue-900 — 툴바 밝은/어두운 배경 양쪽에서 눈에 띈다
BAR     = (255, 255, 255)
BAR_UP  = (248, 113, 113)   # red-400 — 상승
SS      = 8                 # 슈퍼샘플 배율(안티에일리어싱)

def make(size: int) -> Image.Image:
    S = size * SS
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    d.rounded_rectangle([0, 0, S - 1, S - 1], radius=int(S * 0.22), fill=BG)

    # 막대 3개 — 왼→오 상승. 좌우 여백 18%, 막대 폭 18%, 간격 5%
    m, bw, gap = S * 0.18, S * 0.18, S * 0.05
    base = S - m                      # 막대 바닥
    heights = [0.26, 0.42, 0.60]      # 전체 높이 대비
    for i, h in enumerate(heights):
        x0 = m + i * (bw + gap)
        top = base - S * h
        color = BAR_UP if i == len(heights) - 1 else BAR
        d.rounded_rectangle([x0, top, x0 + bw, base],
                            radius=int(bw * 0.28), fill=color)

    return img.resize((size, size), Image.LANCZOS)

for s in (16, 32, 48, 128):
    p = f"extension/icons/icon{s}.png"
    make(s).save(p)
    print(f"  {p}")
print("완료")
