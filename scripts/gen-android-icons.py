#!/usr/bin/env python3
"""안드로이드 앱 아이콘 생성 — android/app/src/main/res/mipmap-*/

앱 파비콘(public/favicon.svg)에서 직접 뽑는다. 확장 아이콘(gen-extension-icons.py)과
같은 소스·같은 방식이라 셋(앱·확장·안드로이드)이 저절로 같은 로고를 쓴다.
로고를 바꾸면 두 스크립트만 다시 돌리면 된다.

    python3 scripts/gen-android-icons.py

만드는 것 (밀도별):
  ic_launcher.png            레거시 런처 아이콘 (48~192)
  ic_launcher_round.png      원형 런처용 (같은 그림 — 마스크는 런처가 씌운다)
  ic_launcher_foreground.png 적응형(Adaptive) 전경 (108~432)

적응형 아이콘은 런처가 바깥을 잘라낸다. 108dp 캔버스 중 실제로 보이는 건 가운데
66dp 남짓이라, 전경은 그 안전 영역 안에만 그린다 — 안 그러면 로고 가장자리가 잘린다.
배경은 res/values/ic_launcher_background.xml 의 흰색이 그대로 깔린다.

SVG 래스터화는 macOS 의 qlmanage(QuickLook)를 쓴다(확장 스크립트와 동일).
다른 환경에서는 512px 이상 PNG 를 만들어 --from 으로 넘기면 된다.
"""
import argparse
import subprocess
import sys
import tempfile
from pathlib import Path

from PIL import Image

SVG = Path("public/favicon.svg")
RES = Path("android/app/src/main/res")

# 밀도 → (레거시 런처 px, 적응형 전경 px)
DENSITIES = {
    "mdpi":    (48, 108),
    "hdpi":    (72, 162),
    "xhdpi":   (96, 216),
    "xxhdpi":  (144, 324),
    "xxxhdpi": (192, 432),
}

MARGIN = 0.06        # 레거시 아이콘 여백 — 확장과 같은 값
SAFE_RATIO = 0.62    # 적응형 전경에서 로고가 차지할 비율 (108dp 중 ~66dp 안전 영역)
WHITE_CUT = 240      # 이 값 이상이 R·G·B 모두면 배경으로 본다


def rasterize(svg: Path, px: int = 1024) -> Image.Image:
    with tempfile.TemporaryDirectory() as tmp:
        subprocess.run(["qlmanage", "-t", "-s", str(px), "-o", tmp, str(svg)],
                       capture_output=True, check=False)
        made = list(Path(tmp).glob("*.png"))
        if not made:
            sys.exit("❌ qlmanage 로 SVG 를 변환하지 못했습니다. --from 으로 PNG 를 직접 주세요.")
        return Image.open(made[0]).convert("RGBA")


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


def extract_logo(img: Image.Image) -> Image.Image:
    """qlmanage 는 SVG 투명 배경을 못 살린다 — 흰색을 지우고 로고 경계를 다시 잡는다."""
    img = white_to_alpha(img)
    box = img.getchannel("A").point(lambda a: 255 if a > 16 else 0).getbbox()
    if not box:
        sys.exit("❌ 로고를 찾지 못했습니다(전부 흰색).")
    return img.crop(box)


def square(logo: Image.Image, fill_ratio: float) -> Image.Image:
    """로고를 정사각 캔버스 가운데에, 지정 비율만 차지하게 놓는다."""
    side = int(max(logo.size) / fill_ratio)
    canvas = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    canvas.paste(logo, ((side - logo.width) // 2, (side - logo.height) // 2), logo)
    return canvas


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--from", dest="src", help="래스터화 대신 쓸 PNG 경로")
    args = ap.parse_args()

    img = Image.open(args.src).convert("RGBA") if args.src else rasterize(SVG)
    logo = extract_logo(img)

    legacy = square(logo, 1 / (1 + MARGIN * 2))   # 여백만 살짝
    adaptive = square(logo, SAFE_RATIO)           # 안전 영역 안으로

    for density, (icon_px, fg_px) in DENSITIES.items():
        out = RES / f"mipmap-{density}"
        out.mkdir(parents=True, exist_ok=True)
        legacy.resize((icon_px, icon_px), Image.LANCZOS).save(out / "ic_launcher.png")
        legacy.resize((icon_px, icon_px), Image.LANCZOS).save(out / "ic_launcher_round.png")
        adaptive.resize((fg_px, fg_px), Image.LANCZOS).save(out / "ic_launcher_foreground.png")
        print(f"  mipmap-{density}: {icon_px}px / 전경 {fg_px}px")

    print("완료 — 앱 파비콘·확장과 동일한 로고")


if __name__ == "__main__":
    main()
