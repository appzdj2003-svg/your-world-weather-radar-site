"""Build-time snapshot for the Your World Weather Radar Outlook: NHC CurrentStorms.json + cone images, JTWC (US Navy) typhoon and
cyclone warnings, METAR city observations from aviationweather.gov and LL2 launches. Served from our site, so visitors' browsers
don't contact these agencies. Writes assets/outlook.json; keeps the old data for a feed if it fails."""
import json, re, time, datetime, urllib.request
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

JTWC = "https://www.metoc.navy.mil/jtwc/"

def jget(url, tries=3):
    """JTWC's server sometimes drops TLS handshakes; retry a couple of times."""
    for k in range(tries):
        try: return get(url, 20).decode("utf-8", "ignore")
        except Exception:
            if k == tries - 1: raise
            time.sleep(2)

def jtwc():
    """Active JTWC warnings (public domain): the RSS lists them, each storm's .tcw holds the coded forecast + past track.
    Skips formation alerts (invests 90-99) and final warnings. The raw .tcw text is stored; assets/outlook.js parses it."""
    rss = jget(JTWC + "rss/jtwc.rss")
    seen, active = set(), []
    for block in re.split(r"</ul>", rss, flags=re.I):
        m = re.search(r"products/([a-z]{2})(\d{2})(\d{2})\.tcw", block, re.I)
        if not m: continue
        pid = (m.group(1) + m.group(2) + m.group(3)).lower()
        head = re.split(r"<ul", block, flags=re.I)[0][-400:]
        if pid in seen or int(m.group(2)) >= 90 or re.search(r"final warning|formation alert", head, re.I): continue
        seen.add(pid); active.append(pid)
    try: prev = {i["pid"]: i for i in json.loads((ROOT / "assets" / "outlook.json").read_text())["jtwc"]["items"]}
    except Exception: prev = {}
    out, failed = [], 0
    for pid in active[:8]:
        try: t = jget(JTWC + "products/" + pid + ".tcw")
        except Exception: t = None  # falls back to the storm's previous snapshot (still listed as active by the RSS)
        if t is not None and re.search(r"^T000\s", t, re.M): out.append({"pid": pid, "tcw": t.replace("\r", "")})
        else:  # fetch failed, or the file was mid-update (no T000 line): keep the previous snapshot
            failed += t is None
            if pid in prev: out.append(prev[pid])
    if active and not out and failed: raise RuntimeError("all JTWC .tcw fetches failed")
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
    for key, fn in (("nhc", nhc), ("jtwc", jtwc), ("metar", metar), ("launches", launches)):
        try: new[key] = {"fetchedAt": now, "items": fn()}
        except Exception as e: print(f"outlook: {key} fetch failed, keeping cached:", e)
    f.write_text(json.dumps(new, ensure_ascii=False, indent=1))
    return new

if __name__ == "__main__":  # standalone refresh (used by the scheduled GitHub Action)
    d = build()
    print("outlook.json:", {k: len(v.get("items", [])) for k, v in d.items() if isinstance(v, dict)})
