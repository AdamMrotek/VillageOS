"""Generate the synthetic golden images for the vision-extraction eval.

The three cases mirror the real-world inputs vision extraction targets — a
clean flyer, a chat screenshot, and an angled phone photo — without containing
any real children's data (everything is invented). All printed dates are
consistent with the eval's FROZEN_TODAY (Sunday 2026-05-10): 16 May 2026 is a
Saturday, 15 May a Friday, 19 June a Friday.

Run once (Pillow is a dev-only dependency, not in requirements):
    .venv/bin/pip install pillow
    .venv/bin/python scripts/generate_golden_images.py
"""

import random
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

GOLDEN_DIR = Path(__file__).resolve().parents[1] / "tests/golden"
FONTS = "/System/Library/Fonts/Supplemental"


def font(name: str, size: int) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(f"{FONTS}/{name}.ttf", size)


def centred(draw: ImageDraw.ImageDraw, y: int, text: str, f, fill="black", width=900) -> int:
    box = draw.textbbox((0, 0), text, font=f)
    draw.text(((width - (box[2] - box[0])) / 2, y), text, font=f, fill=fill)
    return y + (box[3] - box[1]) + 28


def leaflet_07() -> None:
    img = Image.new("RGB", (900, 1100), "#fdf8ee")
    d = ImageDraw.Draw(img)
    d.rectangle([30, 30, 870, 1070], outline="#2b6e4f", width=6)
    y = 90
    y = centred(d, y, "ST MARY'S PRIMARY SCHOOL", font("Arial Bold", 40), "#2b6e4f")
    y = centred(d, y + 10, "SUMMER FAIR", font("Arial Black", 88), "#c0392b")
    y = centred(d, y + 30, "Saturday 16 May 2026", font("Arial Bold", 52))
    y = centred(d, y, "11:00am – 2:00pm", font("Arial", 46))
    y = centred(d, y, "On the school field", font("Arial", 40))
    y = centred(d, y + 40, "Entry £2 per adult — children free", font("Arial Bold", 38), "#2b6e4f")
    y = centred(d, y + 20, "Stalls · Raffle · Face painting · BBQ", font("Arial Italic", 32))
    y = centred(d, y + 20, "Raising money for the PTA", font("Arial Bold", 32), "#c0392b")
    centred(d, y + 50, "Please bring cake donations to the office", font("Arial", 30), "#444444")
    img.save(GOLDEN_DIR / "img_07_leaflet.jpg", quality=88)


def whatsapp_08() -> None:
    img = Image.new("RGB", (750, 900), "#e5ddd5")
    d = ImageDraw.Draw(img)
    d.rectangle([0, 0, 750, 90], fill="#075e54")
    d.text((30, 28), "Year 4 Parents", font=font("Arial Bold", 34), fill="white")

    body = font("Arial", 28)
    meta = font("Arial", 20)

    def bubble(y: int, who: str | None, lines: list[str], when: str, mine: bool) -> int:
        w = max(d.textbbox((0, 0), t, font=body)[2] for t in lines) + 40
        h = 34 * len(lines) + (34 if who else 0) + 50
        x0 = 720 - w if mine else 30
        d.rounded_rectangle([x0, y, x0 + w, y + h], 14, fill="#dcf8c6" if mine else "white")
        ty = y + 12
        if who:
            d.text((x0 + 18, ty), who, font=font("Arial Bold", 24), fill="#d35400")
            ty += 34
        for t in lines:
            d.text((x0 + 18, ty), t, font=body, fill="#111111")
            ty += 34
        d.text((x0 + w - 80, y + h - 32), when, font=meta, fill="#888888")
        return y + h + 24

    y = 130
    y = bubble(
        y,
        "Jess",
        ["Don't forget the swimming gala", "this Friday at 3pm at the", "leisure centre!"],
        "08:14",
        False,
    )
    y = bubble(y, None, ["thanks! do they need anything?"], "08:21", True)
    bubble(y, "Jess", ["Just swimsuit and towel.", "Spectators welcome \U0001f44f"], "08:23", False)
    img.save(GOLDEN_DIR / "img_08_whatsapp.png")


def photo_09() -> None:
    flat = Image.new("RGB", (900, 1100), "#ffffff")
    d = ImageDraw.Draw(flat)
    y = 110
    y = centred(d, y, "OAKWOOD JUNIOR SCHOOL", font("Arial Bold", 42), "#1a3c6e")
    y = centred(d, y + 10, "SPORTS DAY", font("Arial Black", 92), "#1a3c6e")
    y = centred(d, y + 30, "Friday 19th June", font("Arial Bold", 56))
    y = centred(d, y, "9:30am start — on the playing field", font("Arial", 38))
    y = centred(d, y + 40, "Children to wear PE kit", font("Arial", 36))
    y = centred(d, y, "and bring a water bottle", font("Arial", 36))
    centred(d, y + 50, "Parents welcome from 9:15am", font("Arial Italic", 32), "#444444")

    # Phone-photo treatment: slight rotation against a dark table background,
    # mild blur and sensor-ish noise so OCR isn't pixel-perfect.
    photo = flat.rotate(3.5, expand=True, fillcolor="#3a342c", resample=Image.BICUBIC)
    photo = photo.filter(ImageFilter.GaussianBlur(0.7))
    rng = random.Random(7)
    px = photo.load()
    for _ in range(28000):
        x, y2 = rng.randrange(photo.width), rng.randrange(photo.height)
        r, g, b = px[x, y2]
        n = rng.randint(-14, 14)
        px[x, y2] = (max(0, min(255, r + n)), max(0, min(255, g + n)), max(0, min(255, b + n)))
    photo.save(GOLDEN_DIR / "img_09_photo_no_year.jpg", quality=80)


if __name__ == "__main__":
    leaflet_07()
    whatsapp_08()
    photo_09()
    for name in ["img_07_leaflet.jpg", "img_08_whatsapp.png", "img_09_photo_no_year.jpg"]:
        print(f"{name}: {(GOLDEN_DIR / name).stat().st_size // 1024} KB")
