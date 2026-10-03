#!/usr/bin/env python
"""Генератор графики для сайта debtbot.

Делает:
  assets/og-image.png        1200x630 — превью для Telegram/соцсетей
  assets/icon-192.png        иконка для манифеста
  assets/icon-512.png        иконка для манифеста (maskable)
  apple-touch-icon.png       180x180 для iOS
  favicon.ico                16/32/48 многоразмерный
  favicon.svg                векторный (пишется отдельно, см. ASSETS ниже)

Запуск:  python tools/make-assets.py
"""

from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parent.parent
ASSETS = ROOT / "assets"
ASSETS.mkdir(exist_ok=True)

FONT_REGULAR = r"C:\Windows\Fonts\segoeui.ttf"
FONT_BOLD = r"C:\Windows\Fonts\segoeuib.ttf"
FONT_SEMIBOLD = r"C:\Windows\Fonts\segoeuisl.ttf"

# Палитра сайта
NAVY = (15, 23, 42)
NAVY_DEEP = (8, 14, 30)
SKY = (14, 165, 233)
INDIGO = (99, 102, 241)
PINK = (236, 72, 153)
WHITE = (255, 255, 255)
MUTED = (148, 163, 184)


def font(path: str, size: int) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(path, size)


def radial_glow(size: tuple[int, int], center: tuple[float, float], radius: float,
                color: tuple[int, int, int], strength: float) -> Image.Image:
    """Мягкое радиальное свечение как отдельный RGB-слой."""
    w, h = size
    yy, xx = np.mgrid[0:h, 0:w]
    dist = np.sqrt((xx - center[0]) ** 2 + (yy - center[1]) ** 2) / radius
    falloff = np.clip(1.0 - dist, 0.0, 1.0) ** 2 * strength
    layer = np.zeros((h, w, 3), dtype=np.float64)
    for i in range(3):
        layer[:, :, i] = color[i] * falloff
    return Image.fromarray(layer.astype(np.uint8), "RGB")


def vertical_gradient(size: tuple[int, int], top: tuple[int, int, int],
                      bottom: tuple[int, int, int]) -> Image.Image:
    w, h = size
    t = np.linspace(0.0, 1.0, h)[:, None]
    row = (np.array(top) * (1 - t) + np.array(bottom) * t)
    arr = np.repeat(row[:, None, :], w, axis=1)
    return Image.fromarray(arr.astype(np.uint8), "RGB")


def add_glow(base: Image.Image, glows) -> Image.Image:
    """Складывает свечения с базой через screen-подобное смешивание."""
    out = np.asarray(base, dtype=np.float64).copy()
    for center, radius, color, strength in glows:
        glow = np.asarray(radial_glow(base.size, center, radius, color, strength),
                          dtype=np.float64)
        out = 255.0 - (255.0 - out) * (255.0 - glow) / 255.0
    return Image.fromarray(np.clip(out, 0, 255).astype(np.uint8), "RGB")


def rounded_mask(size: tuple[int, int], radius: int) -> Image.Image:
    mask = Image.new("L", size, 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, size[0] - 1, size[1] - 1],
                                           radius=radius, fill=255)
    return mask


def logo_mark(px: int, radius_ratio: float = 0.28) -> Image.Image:
    """Иконка: скруглённый квадрат с градиентом и белым ромбом."""
    size = (px * 4, px * 4)  # суперсэмплинг для гладких краёв
    grad = Image.new("RGB", size)
    w, h = size
    for y in range(h):
        t = y / max(h - 1, 1)
        c = tuple(int(SKY[i] * (1 - t) + INDIGO[i] * t) for i in range(3))
        ImageDraw.Draw(grad).line([(0, y), (w, y)], fill=c)

    mask = rounded_mask(size, int(px * 4 * radius_ratio))
    icon = Image.new("RGBA", size, (0, 0, 0, 0))
    icon.paste(grad, (0, 0), mask)

    d = ImageDraw.Draw(icon)
    cx, cy = w / 2, h / 2
    r = px * 4 * 0.34
    d.polygon([(cx, cy - r), (cx + r, cy), (cx, cy + r), (cx - r, cy)], fill=WHITE)

    return icon.resize((px, px), Image.LANCZOS)


def text_size(draw: ImageDraw.ImageDraw, text: str, f: ImageFont.FreeTypeFont):
    box = draw.textbbox((0, 0), text, font=f)
    return box[2] - box[0], box[3] - box[1], box


def make_og() -> None:
    W, H = 1200, 630
    img = vertical_gradient((W, H), NAVY_DEEP, NAVY)
    img = add_glow(img, [
        ((140, -60), 700, SKY, 0.55),
        ((1120, 60), 620, PINK, 0.30),
        ((640, 700), 700, INDIGO, 0.28),
    ])

    draw = ImageDraw.Draw(img)
    margin = 80

    # Логотип
    mark = logo_mark(116)
    img.paste(mark, (margin, 72), mark)

    # Пилюля с версией — намеренно без номера версии, чтобы не устаревала
    pill_font = font(FONT_SEMIBOLD, 26)
    pill_text = "обновления и поддержка"
    tw, th, _ = text_size(draw, pill_text, pill_font)
    pill_w, pill_h = tw + 92, 62
    px0, py0 = W - margin - pill_w, 84
    draw.rounded_rectangle([px0, py0, px0 + pill_w, py0 + pill_h],
                           radius=pill_h // 2, fill=(255, 255, 255),
                           outline=(226, 232, 240), width=2)
    dx = px0 + 30
    dy = py0 + pill_h // 2
    draw.polygon([(dx, dy - 11), (dx + 11, dy), (dx, dy + 11), (dx - 11, dy)],
                 fill=SKY)
    draw.text((dx + 26, py0 + pill_h // 2 - th / 2 - 4), pill_text,
              font=pill_font, fill=(51, 65, 85))

    # Заголовок
    h1 = font(FONT_BOLD, 96)
    h1_text = "@debts_newbot"
    tw, th, box = text_size(draw, h1_text, h1)
    ty = 300
    draw.text((margin - box[0], ty), h1_text, font=h1, fill=WHITE)

    # Подзаголовок — «градиентный» текст, рисуем посимвольно с интерполяцией цвета
    sub = font(FONT_SEMIBOLD, 44)
    sub_text = "Учёт долгов в Telegram"
    sub_y = ty + th + 34
    x = margin
    for i, ch in enumerate(sub_text):
        t = i / max(len(sub_text) - 1, 1)
        c = tuple(int(SKY[k] * (1 - t) + INDIGO[k] * t) for k in range(3))
        draw.text((x, sub_y), ch, font=sub, fill=c)
        x += draw.textlength(ch, font=sub)

    # Нижняя строка
    foot = font(FONT_REGULAR, 28)
    foot_text = "частичное погашение  ·  сроки возврата  ·  напоминания  ·  статистика"
    draw.text((margin, 520), foot_text, font=foot, fill=(148, 163, 184))

    img.save(ASSETS / "og-image.png", "PNG", optimize=True)
    print("assets/og-image.png", img.size)


def make_icon(px: int, name: str, maskable: bool = False) -> None:
    if maskable:
        # Безопасная зона maskable-иконки — центральные 80%
        canvas = Image.new("RGBA", (px, px), SKY + (255,))
        inner = logo_mark(int(px * 0.68))
        off = (px - inner.width) // 2
        canvas.paste(inner, (off, off), inner)
    else:
        canvas = logo_mark(px)
    canvas.save(ASSETS / name, "PNG", optimize=True)
    print(f"assets/{name}", canvas.size)


def make_apple_touch() -> None:
    px = 180
    bg = Image.new("RGB", (px, px), NAVY)
    grad = vertical_gradient((px, px), (14, 40, 80), NAVY)
    bg.paste(grad, (0, 0))
    img = bg.convert("RGBA")
    inner = logo_mark(int(px * 0.72))
    off = (px - inner.width) // 2
    img.paste(inner, (off, off), inner)
    img.convert("RGB").save(ROOT / "apple-touch-icon.png", "PNG", optimize=True)
    print("apple-touch-icon.png", img.size)


def make_favicon_ico() -> None:
    sizes = [16, 32, 48]
    imgs = [logo_mark(s) for s in sizes]
    imgs[0].save(ROOT / "favicon.ico", format="ICO",
                 sizes=[(s, s) for s in sizes])
    print("favicon.ico", sizes)


if __name__ == "__main__":
    make_og()
    make_icon(192, "icon-192.png")
    make_icon(512, "icon-512.png", maskable=True)
    make_apple_touch()
    make_favicon_ico()
    print("готово")
