"""Build-time snapshot for the World Weather Outlook (feeds with no browser CORS): NHC CurrentStorms.json + cone images,
and METAR city observations from aviationweather.gov. Writes assets/outlook.json; keeps the old file if a feed fails."""
import json, re, datetime, urllib.request
from pathlib import Path
ROOT = Path(__file__).resolve().parent.parent
UA = {"User-Agent": "YourWorldWeatherRadar-site/1.0 (support@yourworldapps.si)"}
CITIES = [("KJFK", "New York"), ("EGLL", "London"), ("LFPG", "Paris"), ("OMDB", "Dubai"), ("VABB", "Mumbai"),
          ("RJTT", "Tokyo"), ("YSSY", "Sydney"), ("FACT", "Cape Town"), ("SBGR", "São Paulo"), ("MMMX", "Mexico City")]

def get(url, t=25):
    return urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=t).read()

def nhc():
    d = json.loads(get("https://www.nhc.noaa.gov/CurrentStorms.json"))
    out = []
    for s in d.get("activeStorms", []):
        g = (s.get("forecastGraphics") or {}).get("url")
        cone = None
        if g:
            try:
                m = re.search(r'src="([^"]*5day_cone[^"]*\.png)"', get(g).decode("utf-8", "ignore"))
                if m:
                    src = "https://www.nhc.noaa.gov" + m.group(1) if m.group(1).startswith("/") else m.group(1)
                    d = ROOT / "assets" / "cones"; d.mkdir(exist_ok=True)
                    for old in d.glob(f"{s.get('id')}*.png"): old.unlink()
                    name = f"{s.get('id')}-{re.sub(r'[^0-9A-Za-z]', '', (s.get('publicAdvisory') or {}).get('advNum', ''))}-5day.png"
                    full = re.sub(r"_5day_cone_sm\+png/(\d+)_5day_cone_sm\.png$", r"_5day_cone+png/\1.png", src)  # full-res (~900px) graphic
                    try: data = get(full)
                    except Exception: data = get(src)
                    if not data.startswith(b"\x89PNG"): data = get(src)
                    (d / name).write_bytes(data); cone = "cones/" + name
            except Exception: pass
        keep = {k: s.get(k) for k in ("id", "binNumber", "name", "classification", "intensity", "pressure", "latitudeNumeric", "longitudeNumeric", "movementDir", "movementSpeed", "lastUpdate")}
        keep["advisory"] = (s.get("publicAdvisory") or {}).get("url"); keep["graphics"] = g; keep["cone"] = cone
        out.append(keep)
    return out

def metar():
    ids = ",".join(c for c, _ in CITIES); names = dict(CITIES)
    rows = json.loads(get(f"https://aviationweather.gov/api/data/metar?ids={ids}&format=json"))
    keep = ("icaoId", "obsTime", "temp", "dewp", "wdir", "wspd", "wgst", "wxString", "cover", "clouds", "rawOb", "lat", "lon")
    by = {r["icaoId"]: {**{k: r.get(k) for k in keep}, "city": names.get(r["icaoId"])} for r in rows if r.get("icaoId") in names}
    return [by[c] for c, _ in CITIES if c in by]

def launches():
    """Launch Library 2 (The Space Devs), same source the app's space overlay uses. One call per build (free tier: 15/hour)."""
    d = json.loads(get("https://ll.thespacedevs.com/2.2.0/launch/upcoming/?limit=25&mode=detailed&hide_recent_previous=true"))
    out = []
    for l in d.get("results", []):
        pad = l.get("pad") or {}; loc = pad.get("location") or {}; m = l.get("mission") or {}
        out.append({"id": l.get("id"), "name": l.get("name"), "net": l.get("net"), "windowStart": l.get("window_start"), "windowEnd": l.get("window_end"),
                    "status": (l.get("status") or {}).get("abbrev"), "statusName": (l.get("status") or {}).get("name"),
                    "rocket": ((l.get("rocket") or {}).get("configuration") or {}).get("full_name") or ((l.get("rocket") or {}).get("configuration") or {}).get("name"),
                    "provider": (l.get("launch_service_provider") or {}).get("name"), "mission": m.get("name"), "orbit": (m.get("orbit") or {}).get("abbrev"),
                    "pad": pad.get("name"), "site": loc.get("name"), "lat": pad.get("latitude"), "lon": pad.get("longitude"),
                    "probability": l.get("probability"), "weatherConcerns": l.get("weather_concerns"), "image": l.get("image")})
    return out

def build():
    f = ROOT / "assets" / "outlook.json"
    old = json.loads(f.read_text()) if f.exists() else {}
    now = datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds")
    new = dict(old)
    for key, fn in (("nhc", nhc), ("metar", metar), ("launches", launches)):
        try: new[key] = {"fetchedAt": now, "items": fn()}
        except Exception as e: print(f"outlook: {key} fetch failed, keeping cached:", e)
    f.write_text(json.dumps(new, ensure_ascii=False, indent=1))
    return new

if __name__ == "__main__":  # standalone refresh (used by the scheduled GitHub Action)
    d = build()
    print("outlook.json:", {k: len(v.get("items", [])) for k, v in d.items() if isinstance(v, dict)})
