#!/usr/bin/env python3
"""확장 아이콘 생성 — extension/icons/icon{16,32,48,128}.png

앱 파비콘(public/favicon.svg)에서 직접 뽑는다. 앱 로고를 바꾸면 이 스크립트만 다시
돌리면 확장 아이콘도 따라간다 — 두 곳을 손으로 맞추다 어긋나는 일을 없앤다.

    python3 scripts/gen-extension-icons.py

SVG 래스터화는 macOS 의 qlmanage(QuickLook)를 쓴다. 별도 설치가 필요 없는 대신
macOS 전용이다. 다른 환경에서는 rsvg-convert 등으로 512px PNG 를 만들어
--from 으로 넘기면 된다.
"""
import argparse
import subprocess
import sys
import tempfile
from pathlib import Path

from PIL import Image

SVG = Path("public/favicon.svg")
OUT = Path("extension/icons")
SIZES = (16, 32, 48, 128)
MARGIN = 0.06   # 가장자리 여백 비율 — 툴바에서 잘려 보이지 않게 아주 조금만

def rasterize(svg: Path, px: int = 1024) -> Image.Image:
    with tempfile.TemporaryDirectory() as tmp:
        subprocess.run(["qlmanage", "-t", "-s", str(px), "-o", tmp, str(svg)],
                       capture_output=True, check=False)
        made = list(Path(tmp).glob("*.png"))
        if not made:
            sys.exit("❌ qlmanage 로 SVG 를 변환하지 못했습니다. --from 으로 PNG 를 직접 주세요.")
        return Image.open(made[0]).convert("RGBA")

WHITE_CUT = 240   # 이 값 이상이 R·G·B 모두면 배경으로 본다

def white_to_alpha(img: Image.Image) -> Image.Image:
    """흰 배경 → 투명. 로고가 보라·파랑 계열이라 흰색만 지우면 안전하다."""
    px = img.load()
    w, h = img.size
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            if r >= WHITE_CUT and g >= WHITE_CUT and b >= WHITE_CUT:
                px[x, y] = (r, g, b, 0)
    return img

def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--from", dest="src", help="래스터화 대신 쓸 PNG 경로")
    args = ap.parse_args()

    img = Image.open(args.src).convert("RGBA") if args.src else rasterize(SVG)

    # qlmanage 는 SVG 의 투명 배경을 살리지 않는다 — 로고를 정사각 캔버스 한쪽에
    # 그려 넣고 나머지를 '불투명 흰색' 으로 채운다. 그래서 알파 기준 crop 은 못 쓴다
    # (캔버스 전체가 alpha=255 라 경계가 안 잡히고 로고가 구석에 남는다).
    # → '흰색이 아닌 픽셀' 로 경계를 잡고, 흰 배경은 투명으로 되돌린다.
    img = white_to_alpha(img)
    box = img.getchannel("A").point(lambda a: 255 if a > 16 else 0).getbbox()
    if not box:
        sys.exit("❌ 로고를 찾지 못했습니다(전부 흰색).")
    logo = img.crop(box)

    # 정사각으로 맞추고 여백을 준다(로고 자체가 세로로 길어 그대로 두면 찌그러진다).
    side = int(max(logo.size) * (1 + MARGIN * 2))
    canvas = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    canvas.paste(logo, ((side - logo.width) // 2, (side - logo.height) // 2), logo)

    OUT.mkdir(parents=True, exist_ok=True)
    for s in SIZES:
        p = OUT / f"icon{s}.png"
        canvas.resize((s, s), Image.LANCZOS).save(p)
        print(f"  {p}")
    print("완료 — 앱 파비콘과 동일한 로고")

if __name__ == "__main__":
    main()
