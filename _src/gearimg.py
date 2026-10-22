"""Gear card art: AI illustration assets/items/<key>.webp if present, else the inline SVG (gearart)."""
from pathlib import Path
import gearart
ROOT = Path(__file__).resolve().parent.parent
# product-name keyword -> image key (first match wins); else the gearart kind
MAP = [("rain suit","rainsuit"),("crank","crankradio"),("frx3","crankradio"),("headlamp","headlamp"),("lantern","lantern"),
       ("power station","powerstation"),("power bank","powerbank"),("first aid","firstaid"),
       ("cord","cord"),("generator","generator"),("solar panel","solarpanel"),("ups battery","ups"),("carbon monoxide","coalarm")]
def key(kind, name):
    n = name.lower()
    for kw, k in MAP:
        if kw in n: return k
    return {"light":"headlamp","power":"powerbank"}.get(kind, kind)
def art(kind, tone, name):
    k = key(kind, name)
    if (ROOT/f"assets/items/{k}.webp").exists():
        return f'<img class="gart" src="/assets/items/{k}.webp" width="560" height="420" loading="lazy" alt="" style="object-fit:cover">'
    return gearart.svg(kind, tone)
