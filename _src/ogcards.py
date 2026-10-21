"""Per-page social cards (1200x630 JPEG) in the style of assets/og-image.png, made from the real app screenshots and gear
photos in assets/. Called by build.py. A card is only re-rendered when its spec changes (hash in assets/og/manifest.json),
so routine rebuilds (e.g. the Outlook refresh) don't churn images. If Pillow isn't installed the build keeps the committed cards."""
import hashlib, json, math
from pathlib import Path
ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "assets" / "og"
VERSION = "1"
FONTS = ["/usr/share/fonts/truetype/sand-box/google/Inter/Inter-VariableFont_opsz,wght.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"]
W, H = 1200, 630
NAVY, BLUE, AMBER, SKY, WHITE = (15, 23, 42), (3, 105, 161), (245, 158, 11), (125, 211, 252), (255, 255, 255)

def _font(size, weight="Bold"):
    from PIL import ImageFont
    for f in FONTS:
        if Path(f).exists():
            ft = ImageFont.truetype(f, size)
            try: ft.set_variation_by_name(weight)
            except Exception: pass
            return ft
    return ImageFont.load_default()

def _bg():
    from PIL import Image, ImageDraw
    # diagonal navy -> blue gradient, rendered small and scaled up (smooth and fast)
    g = Image.new("RGB", (120, 63)); px = g.load()
    for y in range(63):
        for x in range(120):
            t = max(0.0, min(1.0, (x / 120) * 0.55 + (y / 63) * 0.6 - 0.25))
            px[x, y] = tuple(int(NAVY[i] * (1 - t) + BLUE[i] * t) for i in range(3))
    im = g.resize((W, H), Image.BICUBIC); d = ImageDraw.Draw(im)
    for r, c in ((150, (120, 100, 40)), (260, (40, 90, 130)), (370, (30, 80, 120))):  # radar rings like og-image.png
        d.ellipse([1020 - r, 120 - r, 1020 + r, 120 + r], outline=c, width=2)
    d.rectangle([0, 0, W, 7], fill=AMBER)
    return im

def _wrap(d, text, f, maxw):
    words, lines, cur = text.split(), [], ""
    for w in words:
        t = (cur + " " + w).strip()
        if d.textlength(t, font=f) <= maxw or not cur: cur = t
        else: lines.append(cur); cur = w
    return lines + [cur]

def _phone(img_path, height, angle=2.0):
    from PIL import Image, ImageDraw
    im = Image.open(img_path).convert("RGB"); w = round(im.width * height / im.height); im = im.resize((w, height), Image.LANCZOS)
    r = 30; pad = 10
    mask = Image.new("L", (w, height), 0); ImageDraw.Draw(mask).rounded_rectangle([0, 0, w - 1, height - 1], r, fill=255)
    fr = Image.new("RGBA", (w + 2 * pad, height + 2 * pad), (0, 0, 0, 0))
    ImageDraw.Draw(fr).rounded_rectangle([0, 0, w + 2 * pad - 1, height + 2 * pad - 1], r + pad, fill=(2, 6, 23, 255), outline=(51, 65, 85, 255), width=2)
    fr.paste(im, (pad, pad), mask)
    return fr.rotate(-angle, resample=Image.BICUBIC, expand=True)

def _tile(img_path, size):
    from PIL import Image, ImageDraw
    im = Image.open(img_path).convert("RGBA"); im.thumbnail((size - 60, size - 60), Image.LANCZOS)
    t = Image.new("RGBA", (size, size), (0, 0, 0, 0)); ImageDraw.Draw(t).rounded_rectangle([0, 0, size - 1, size - 1], 36, fill=(255, 255, 255, 255))
    t.paste(im, ((size - im.width) // 2, (size - im.height) // 2), im); return t

def render(spec, out):
    from PIL import Image, ImageDraw, ImageFilter
    im = _bg().convert("RGBA")
    # right-hand visual
    vis = spec.get("visual", [])
    if spec.get("kind") == "tiles":
        xs = [(700, 150, 230), (930, 230, 230), (760, 385, 200)]
        for (x, y, s), p in zip(xs, vis): im.alpha_composite(_tile(ROOT / "assets" / p, s), (x, y))
    else:
        phones = [_phone(ROOT / "assets" / p, 500 if i == 0 else 440, 3 if i == 0 else -4) for i, p in enumerate(vis[:2])]
        if len(phones) == 2: im.alpha_composite(phones[1], (930, 120))
        if phones:
            sh = Image.new("RGBA", phones[0].size, (0, 0, 0, 0)); sh.putalpha(phones[0].getchannel("A").point(lambda a: int(a * .55)))
            sh = sh.filter(ImageFilter.GaussianBlur(18)); x = 740 if len(phones) == 2 else 830
            im.alpha_composite(sh, (x + 10, 70)); im.alpha_composite(phones[0], (x, 50))
    d = ImageDraw.Draw(im)
    # kicker pill
    fk = _font(24, "Bold"); k = spec["kicker"].upper(); tw = d.textlength(k, font=fk)
    d.rounded_rectangle([64, 70, 64 + tw + 40, 70 + 46], 23, fill=AMBER); d.text((84, 70 + 9), k, font=fk, fill=NAVY)
    # title + subtitle
    maxw = 620 if vis else 1000
    size = 64; ft = _font(size); lines = _wrap(d, spec["title"], ft, maxw)
    while len(lines) > 3 and size > 44: size -= 4; ft = _font(size); lines = _wrap(d, spec["title"], ft, maxw)
    y = 150
    for ln in lines: d.text((64, y), ln, font=ft, fill=WHITE); y += int(size * 1.15)
    fs = _font(30, "SemiBold"); y += 14
    for ln in _wrap(d, spec.get("sub", ""), fs, maxw)[:3]: d.text((64, y), ln, font=fs, fill=SKY); y += 40
    # brand footer
    ic = Image.open(ROOT / "assets" / "icon-192.png").convert("RGBA").resize((64, 64), Image.LANCZOS)
    m = Image.new("L", (64, 64), 0); ImageDraw.Draw(m).rounded_rectangle([0, 0, 63, 63], 16, fill=255); ic.putalpha(m)
    im.alpha_composite(ic, (64, H - 112))
    d.text((144, H - 110), "Your World Weather Radar", font=_font(28, "Bold"), fill=WHITE)
    d.text((144, H - 74), "weather.yourworldapps.si", font=_font(22, "Medium"), fill=(203, 213, 225))
    im.convert("RGB").save(out, "JPEG", quality=82, optimize=True, progressive=True)

def build(cards):
    """cards: {slug: spec}. Returns {slug: 'og/<slug>.jpg'} for slugs whose card file exists."""
    OUT.mkdir(parents=True, exist_ok=True)
    mf = OUT / "manifest.json"; man = json.loads(mf.read_text()) if mf.exists() else {}
    try: import PIL  # noqa
    except ImportError: PIL = None
    res = {}
    for slug, spec in cards.items():
        out = OUT / f"{slug}.jpg"
        src = b"".join((ROOT / "assets" / p).read_bytes() for p in spec.get("visual", []) if (ROOT / "assets" / p).exists())
        h = hashlib.sha1((VERSION + json.dumps(spec, sort_keys=True)).encode() + src).hexdigest()[:12]
        if (man.get(slug) != h or not out.exists()) and PIL is not None:
            render(spec, out); man[slug] = h
        if out.exists(): res[slug] = f"og/{slug}.jpg"
    mf.write_text(json.dumps(man, indent=1, sort_keys=True) + "\n")
    return res
