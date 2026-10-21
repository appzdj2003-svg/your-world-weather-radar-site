"""Build-time snapshot for the Your World Weather Radar Outlook: NHC CurrentStorms.json + cone images, JTWC (US Navy) typhoon and
cyclone warnings, NOAA SWPC space weather + a NASA SDO Sun image, METAR city and launch-pad observations from aviationweather.gov and LL2 launches. Served from our site, so visitors' browsers
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

SWPC = "https://services.swpc.noaa.gov"
SDO_304 = "https://sdo.gsfc.nasa.gov/assets/img/latest/latest_512_0304.jpg"

def _num(v, lo, hi):
    try: v = float(v)
    except (TypeError, ValueError): return None
    return v if lo <= v <= hi else None

def sun_image(prev):
    """Today's Sun (NASA SDO/AIA 304, public domain): cropped like the app's FLARES layer, 320 px JPEG (~13 KB), embedded
    in outlook.json so visitors load it from our site. Refetched only when the saved one is 5 h+ old, to keep the repo light."""
    now = datetime.datetime.now(datetime.timezone.utc)
    if prev and prev.get("data") and prev.get("at"):
        try:
            if now - datetime.datetime.fromisoformat(prev["at"]) < datetime.timedelta(hours=5): return prev
        except ValueError: pass
    import io, base64, email.utils
    from PIL import Image
    r = urllib.request.urlopen(urllib.request.Request(SDO_304, headers=UA), timeout=25)
    if not r.headers.get("Content-Type", "").startswith("image/"): raise ValueError("not an image")
    raw = r.read(2_500_000)
    lm = r.headers.get("Last-Modified")
    at = email.utils.parsedate_to_datetime(lm).astimezone(datetime.timezone.utc) if lm else now
    im = Image.open(io.BytesIO(raw)).convert("RGB"); w, h = im.size; half = 0.3926 * 1.17
    im = im.crop((round((0.5 - half) * w), round((0.5 - half) * h), round((0.5 + half) * w), round((0.5 + half) * h))).resize((320, 320), Image.LANCZOS)
    b = io.BytesIO(); im.save(b, "JPEG", quality=72, optimize=True, progressive=True)
    return {"at": at.isoformat(timespec="seconds"), "data": "data:image/jpeg;base64," + base64.b64encode(b.getvalue()).decode()}

def sun():
    """Space weather from NOAA SWPC (same feeds and rules as the app's Sun tab) + the SDO image. Each part keeps its old value
    if its fetch fails; raises (keeping the whole old block) only when the scales and Kp feeds both fail."""
    try: old = json.loads((ROOT / "assets" / "outlook.json").read_text()).get("sun", {}).get("items", {}) or {}
    except Exception: old = {}
    out, ok = dict(old), 0
    now = datetime.datetime.now(datetime.timezone.utc)
    try:
        d = json.loads(get(SWPC + "/products/noaa-scales.json")); z = d.get("0") or {}
        sc = lambda x: int(_num(x, 0, 5) or 0)
        out["scales"] = {"g": sc((z.get("G") or {}).get("Scale")), "r": sc((z.get("R") or {}).get("Scale")), "s": sc((z.get("S") or {}).get("Scale")),
            "days": [{"date": (d.get(k) or {}).get("DateStamp"), "g": sc(((d.get(k) or {}).get("G") or {}).get("Scale")),
                      "r1": _num(((d.get(k) or {}).get("R") or {}).get("MinorProb"), 0, 100), "r3": _num(((d.get(k) or {}).get("R") or {}).get("MajorProb"), 0, 100),
                      "s1": _num(((d.get(k) or {}).get("S") or {}).get("Prob"), 0, 100)} for k in ("1", "2", "3") if d.get(k)]}
        ok += 1
    except Exception as e: print("outlook: sun scales failed:", e)
    try:
        rows = json.loads(get(SWPC + "/products/noaa-planetary-k-index-forecast.json"))
        obs, fc = [], []
        for r in rows:
            if not isinstance(r, dict): continue
            kp = _num(r.get("kp", r.get("Kp")), 0, 9.5)
            try: t = datetime.datetime.fromisoformat(str(r.get("time_tag")).replace("Z", "")).replace(tzinfo=datetime.timezone.utc)
            except ValueError: continue
            if kp is None: continue
            kind = str(r.get("observed", "")).lower()
            (obs if kind == "observed" or (kind == "estimated" and t <= now) else fc).append((t, kp))
        obs.sort(); fc.sort()
        k = {"now": obs[-1][1] if obs else None, "nowAt": obs[-1][0].isoformat() if obs else None,
             "max24h": max([v for t, v in obs if now - t <= datetime.timedelta(hours=24)], default=None),
             "next24h": max([v for t, v in fc if t <= now + datetime.timedelta(hours=24)], default=None), "byDate": {}}
        for t, v in fc: k["byDate"][t.date().isoformat()] = max(v, k["byDate"].get(t.date().isoformat(), 0))
        out["kp"] = k; ok += 1
    except Exception as e: print("outlook: sun kp failed:", e)
    try:
        a = (json.loads(get(SWPC + "/products/summary/solar-wind-speed.json")) or [{}])[0]
        b = (json.loads(get(SWPC + "/products/summary/solar-wind-mag-field.json")) or [{}])[0]
        sp, bz = _num(a.get("proton_speed"), 100, 3500), _num(b.get("bz_gsm"), -500, 500)
        if sp is not None or bz is not None: out["wind"] = {"speed": sp, "bz": bz, "bt": _num(b.get("bt"), 0, 500), "at": a.get("time_tag") or b.get("time_tag")}
    except Exception as e: print("outlook: sun wind failed:", e)
    try:
        f = (json.loads(get(SWPC + "/json/goes/primary/xray-flares-latest.json")) or [{}])[0]
        cls = lambda c: c if isinstance(c, str) and re.fullmatch(r"[ABCMX]\d+(\.\d+)?", c) else None
        out["flare"] = {"current": cls(f.get("current_class")), "max": cls(f.get("max_class")), "maxAt": f.get("max_time")}
    except Exception as e: print("outlook: sun flare failed:", e)
    try: out["image"] = sun_image(old.get("image"))
    except Exception as e: print("outlook: sun image failed, keeping cached:", e)
    if not ok: raise RuntimeError("SWPC scales and Kp both failed")
    return out

def metar():
    ids = ",".join(c for c, _ in CITIES); names = dict(CITIES)
    rows = json.loads(get(f"https://aviationweather.gov/api/data/metar?ids={ids}&format=json"))
    keep = ("icaoId", "obsTime", "temp", "dewp", "wdir", "wspd", "wgst", "wxString", "cover", "clouds", "rawOb", "lat", "lon")
    by = {r["icaoId"]: {**{k: r.get(k) for k in keep}, "city": names.get(r["icaoId"])} for r in rows if r.get("icaoId") in names}
    return [by[c] for c, _ in CITIES if c in by]

# Main US launch sites -> nearest NOAA/NWS airport weather station (METAR via aviationweather.gov, public domain, the same
# feed as the city cards). One extra request per build. "match" = words in LL2's site name that map a launch to its pad weather.
PADS = [("cape", "Cape Canaveral & Kennedy, FL", ("KXMR", "KTTS"), "Cape Canaveral SFS Skid Strip", ("Cape Canaveral", "Kennedy Space Center")),
        ("vandenberg", "Vandenberg SFB, CA", ("KVBG",), "Vandenberg airfield", ("Vandenberg",)),
        ("starbase", "Starbase, TX", ("KBRO",), "Brownsville airport, about 35 km west of the pad", ("Starbase", "Boca Chica")),
        ("wallops", "Wallops Island, VA", ("KWAL",), "Wallops Flight Facility airfield", ("Wallops", "Mid-Atlantic Regional Spaceport"))]

def pads():
    ids = ",".join(i for _, _, st, _, _ in PADS for i in st)
    rows = {r["icaoId"]: r for r in json.loads(get(f"https://aviationweather.gov/api/data/metar?ids={ids}&format=json")) if r.get("icaoId")}
    keep = ("icaoId", "obsTime", "temp", "dewp", "wdir", "wspd", "wgst", "visib", "wxString", "cover", "clouds", "rawOb", "lat", "lon")
    out = []
    for key, name, st, where, match in PADS:
        r = next((rows[i] for i in st if i in rows and rows[i].get("temp") is not None), None)
        if r: out.append({**{k: r.get(k) for k in keep}, "pad": key, "city": name, "station": where, "match": list(match)})
    if not out: raise RuntimeError("no pad observations")
    return out

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
                    "probability": l.get("probability"), "weatherConcerns": l.get("weather_concerns"), "image": l.get("image"),
                    "precision": (l.get("net_precision") or {}).get("abbrev"), "country": loc.get("country_code"),
                    "providerType": (l.get("launch_service_provider") or {}).get("type")})
    return out

def build():
    f = ROOT / "assets" / "outlook.json"
    old = json.loads(f.read_text()) if f.exists() else {}
    now = datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds")
    new = dict(old)
    for key, fn in (("nhc", nhc), ("jtwc", jtwc), ("sun", sun), ("metar", metar), ("pads", pads), ("launches", launches)):
        try: new[key] = {"fetchedAt": now, "items": fn()}
        except Exception as e: print(f"outlook: {key} fetch failed, keeping cached:", e)
    f.write_text(json.dumps(new, ensure_ascii=False, indent=1))
    return new

if __name__ == "__main__":  # standalone refresh (used by the scheduled GitHub Action)
    d = build()
    print("outlook.json:", {k: len(v.get("items", [])) for k, v in d.items() if isinstance(v, dict)})
