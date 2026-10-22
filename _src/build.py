#!/usr/bin/env python3
"""Static site builder for Your World Weather Radar. Run: python3 _src/build.py  (writes HTML into the repo root).
Deals: fetched from the Slickdeals RSS at build time into assets/deals.json (keeps the old file if offline)."""
import json, re, html, datetime, urllib.parse, urllib.request, email.utils, sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))
from guides import GUIDES
import outlook as OUTLOOK
import ogcards as OG

ROOT = Path(__file__).resolve().parent.parent
SITE = "https://weather.yourworldapps.si/"
PKG = "com.yourworld.weatheranalyzer"
PLAY = f"https://play.google.com/store/apps/details?id={PKG}"
APP = "Your World Weather Radar"
YOUTUBE = "https://www.youtube.com/channel/UCv_HP3UU30nKawvJ0AgHL3A"   # "Your World Apps" (@yourworldapps)
HUB = "https://yourworldapps.si/"
ORG = {"@type": "Organization", "name": "Your World Apps", "url": HUB, "logo": SITE + "assets/icon-512.png", "sameAs": [YOUTUBE, HUB]}
# Per-page social cards (1200x630), rendered by _src/ogcards.py from real app screenshots / gear photos. Keyed by page path.
OG_SPECS = {
 "index.html": dict(kicker="Free rain ETA", title="Know when rain hits your spot", sub="Live radar, storm tracks and weather alerts for Android", visual=["shot-home.jpg", "app-radar.jpg"]),
 "outlook.html": dict(kicker="Live now", title="The whole planet's weather, live", sub="Satellite loop, hurricanes and typhoons, US alerts and the Sun", visual=["app-radar.jpg"]),
 "features.html": dict(kicker="Features", title="What's free and what's Premium", sub="Rain ETA, radar, alerts, AI briefings, cams and more", visual=["app-hurricane.jpg", "shot-home.jpg"]),
 "pricing.html": dict(kicker="Pricing", title="Free to download. Premium from $4.99/mo", sub="$47.99/yr. 7-day free trial for new subscribers", visual=["shot-home.jpg"]),
 "alert-planner/index.html": dict(kicker="Alert Planner", title="Plan alerts for a day out", sub="Place, activity and dates in one link for your phone", visual=["app-hurricane.jpg"]),
 "trip-planner/index.html": dict(kicker="Trip Planner", title="Weather for your whole trip", sub="Destination, dates and how you're traveling", visual=["app-radar.jpg"]),
 "ask.html": dict(kicker="Ask Atlas", title="Weather safety answers in plain English", sub="Sourced from NWS and NOAA guides", visual=["shot-home.jpg"]),
 "gear/index.html": dict(kicker="Weather gear", title="Gear for when the weather turns", sub="Radios, rain gear, power and lights for storm days", visual=["app-hurricane.jpg", "app-radar.jpg"]),
 "guides/index.html": dict(kicker="Weather guides", title="Weather safety guides", sub="Radar, watches vs. warnings, hurricanes, lightning and more", visual=["app-radar.jpg"]),
 "launches/index.html": dict(kicker="Rocket launches", title="Next launch countdown and schedule", sub="Upcoming launches worldwide and weather at the main US launch sites", visual=["launch-teaser.jpg"]),
 "go/index.html": dict(kicker="Get the app", title="Know when rain hits your spot", sub="Free rain ETA, live radar and alerts on Google Play", visual=["shot-home.jpg", "app-hurricane.jpg"]),
}
OG_IMG = {}  # path -> "og/<slug>.jpg", filled by build_og()
def build_og():
    from guides import GUIDES as _G
    specs = dict(OG_SPECS)
    for i, g in enumerate(_G):
        specs[f"guides/{g['slug']}.html"] = dict(kicker="Weather guide", title=g["short"], sub="Sourced from the NWS and NOAA", visual=[("app-radar.jpg", "app-hurricane.jpg", "shot-home.jpg")[i % 3]])
    slugs = {path: (re.sub(r"[^a-z0-9]+", "-", path.replace(".html", "").replace("/index", "")).strip("-") or "home") for path in specs}
    made = OG.build({slugs[p]: specs[p] for p in specs})
    for p in specs:
        if slugs[p] in made: OG_IMG[p] = made[slugs[p]]
PRICE_M, PRICE_Y = "4.99", "47.99"          # must match Google Play exactly
TRIAL = f"Premium: 7-day free trial for new subscribers, then ${PRICE_M}/mo or ${PRICE_Y}/yr. Cancel anytime in Google Play."
def trial_line(cls="trial"): return f'<p class="{cls}"><span aria-hidden="true">🎁</span> {E(TRIAL)}</p>'
AMZ_TAG = "yourworldapps-20"
SUPPORT, PRIVACY_MAIL = "support@yourworldapps.si", "support@yourworldapps.si"
E = lambda s: html.escape(s, quote=True)
enc = lambda s: urllib.parse.quote(s, safe="")
PAGES = []
import hashlib
def V(name):  # cache-busting: short content hash of the asset
    f = ROOT / "assets" / name
    return name + ("?v=" + hashlib.sha1(f.read_bytes()).hexdigest()[:10] if f.exists() else "")

NAV = [("index.html", "Home"), ("features.html", "Features"), ("alert-planner/", "Alert Planner"), ("trip-planner/", "Trip Planner"), ("ask.html", "Ask Atlas"), ("outlook.html", "Outlook"), ("launches/", "Launches"),
       ("guides/", "Guides"), ("gear/", "Gear"), ("pricing.html", "Pricing"), ("support.html", "Support")]
MIC_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 15a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V22h2v-3.08A7 7 0 0 0 19 12z"/></svg>'
def mic(target, submit): return f'<button type="button" class="mic" data-voice-for="{target}" data-voice-submit="{submit}" aria-label="Speak your plan" aria-pressed="false" title="Speak">{MIC_SVG}</button>'
PLAY_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M4 2.5v19l16-9.5z"/></svg>'

def play_ref(slug, sec):
    return PLAY + "&referrer=" + enc(f"utm_source=weathersite&utm_medium={slug}&utm_campaign={sec}")
def play_btn(slug, cls="primary", sec="cta", label="Get it on Google Play"):
    return f'<a class="btn {cls}" href="{E(play_ref(slug, sec))}" target="_blank" rel="noopener">{PLAY_SVG}{label}</a>'

# ---------- Google Analytics 4 (website only) with Consent Mode v2 ----------
# Ads storage is always denied (no ads). Analytics storage defaults to denied for the EEA, UK and Switzerland (by Google's IP
# region) and granted elsewhere. Visitors whose device time zone looks European see a banner (site-ui.js) and gtag.js doesn't
# load for them until they tap Allow. A saved choice (localStorage) wins everywhere; "No thanks" means gtag.js never loads.
GA_ID = "G-BDB2EH3W4Z"
GA_REGIONS = ["AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE", "GR", "HU", "IE", "IT", "LV", "LT", "LU", "MT", "NL", "PL", "PT", "RO", "SK", "SI", "ES", "SE", "IS", "LI", "NO", "GB", "CH"]
GA_HEAD = ('<script>(function(){var w=window,d=document,ID="' + GA_ID + '",K="yw-analytics-consent",c=null,tz="",on=false;'
    'w.dataLayer=w.dataLayer||[];function g(){dataLayer.push(arguments)}w.gtag=g;'
    'try{c=localStorage.getItem(K)}catch(e){}if(c!=="granted"&&c!=="denied")c=null;'
    'try{tz=Intl.DateTimeFormat().resolvedOptions().timeZone||""}catch(e){}'
    'var eu=/^Europe\\//.test(tz)||/^(Atlantic\\/(Canary|Madeira|Azores|Reykjavik|Faroe)|Arctic\\/Longyearbyen)$/.test(tz);'
    'var A={ad_storage:"denied",ad_user_data:"denied",ad_personalization:"denied",wait_for_update:500};'
    'g("consent","default",Object.assign({analytics_storage:"denied",region:' + json.dumps(GA_REGIONS).replace(" ", "") + '},A));'
    'g("consent","default",Object.assign({analytics_storage:"granted"},A));'
    'if(c)g("consent","update",{analytics_storage:c});'
    'function load(){if(on)return;on=true;g("js",new Date());g("config",ID);var s=d.createElement("script");s.async=true;s.src="https://www.googletagmanager.com/gtag/js?id="+ID;d.head.appendChild(s)}'
    'w.YW_GA={eu:eu,choice:c,set:function(v){this.choice=v;try{localStorage.setItem(K,v)}catch(e){}g("consent","update",{analytics_storage:v});'
    'if(v==="granted")load();else d.cookie.split(";").forEach(function(x){var n=x.split("=")[0].trim();if(/^_ga/.test(n))["",";domain=.yourworldapps.si",";domain="+location.hostname].forEach(function(m){d.cookie=n+"=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/"+m})})}};'
    'if(c==="granted"||(!c&&!eu))load()})();</script>')

def page(path, title, desc, body, hero=None, prio="0.6", scripts=(), jsonld=None, slug=None, minimal=False, playbar=True, head_extra="", sitemap=True):
    depth = path.count("/"); p = "../" * depth
    url = SITE + ("" if path == "index.html" else path.replace("index.html", ""))
    cur = path.split("/")[0] + "/" if "/" in path else path
    nav = "".join(f'<a href="{p}{"" if h=="index.html" else h}"{" aria-current=page" if h==cur else ""}>{t}</a>' for h, t in NAV).replace('href=""', 'href="./"')
    slug = slug or (re.sub(r"[^a-z0-9]+", "-", path.replace(".html", "").replace("/index", "")).strip("-") or "home")
    lds = "".join(f'<script type="application/ld+json">{json.dumps(j, ensure_ascii=False)}</script>' for j in (jsonld or []))
    sc = "".join(f'<script src="{p}assets/{V(s)}"></script>' for s in scripts + ("site-ui.js",))
    menu = "" if minimal else f'<button type="button" class="menu-btn" aria-expanded="false" aria-controls="main-nav" aria-label="Open menu"><span class="mb-i" aria-hidden="true"></span><span class="mb-t">Menu</span></button><nav class="nav" id="main-nav" aria-label="Main">{nav}</nav>'
    bar = "" if not playbar else f'<div class="playbar" id="playbar" role="region" aria-label="Get the app"><img src="{p}assets/icon-192.png" width="36" height="36" alt=""><div class="pb-t"><b>{APP}</b><span>Free rain ETA &amp; live radar</span></div><a class="btn primary" href="{E(play_ref(slug, "stickybar"))}" target="_blank" rel="noopener">{PLAY_SVG}Get it on Google Play</a><button type="button" class="pb-x" aria-label="Dismiss">&times;</button></div>\n'

    full = title if APP in title else f"{title} | {APP}"
    ogi = OG_IMG.get(path, "og-image.png")
    doc = f'''<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>{E(full)}</title><meta name="description" content="{E(desc)}"><link rel="canonical" href="{url}">
<meta property="og:type" content="website"><meta property="og:site_name" content="{APP}"><meta property="og:title" content="{E(full)}">
<meta property="og:description" content="{E(desc)}"><meta property="og:url" content="{url}"><meta property="og:image" content="{SITE}assets/{V(ogi)}"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="{E(full)}"><meta name="twitter:description" content="{E(desc)}"><meta name="twitter:image" content="{SITE}assets/{V(ogi)}"><meta name="theme-color" content="#0F172A">
<link rel="icon" href="{p}assets/favicon.png"><link rel="apple-touch-icon" href="{p}assets/icon-192.png">
<link rel="stylesheet" href="{p}assets/{V('site.css')}">{head_extra}<noscript><style>.top .nav{{display:flex!important;overflow-x:auto}}.menu-btn{{display:none!important}}</style></noscript>{lds}<script>window.YW_ATLAS="/assets/{V('atlas.svg')}"</script>{GA_HEAD}</head><body>
<header class="top"><div class="wrap"><a class="brand" href="{p or './'}"><img src="{p}assets/icon-192.png" width="34" height="34" alt="">{APP}</a>{menu}</div></header>
<main>{hero or ""}<div class="wrap">{body}</div></main>
<footer><div class="wrap"><div class="cols">
<div><h4>{APP}</h4><ul><li><a href="{E(play_ref(slug,"footer"))}" target="_blank" rel="noopener">Get it on Google Play</a></li><li><a href="{p}features.html">Features</a></li><li><a href="{p}pricing.html">Pricing</a></li><li><a href="{p}alert-planner/">Forecast &amp; Alert Planner</a></li><li><a href="{p}trip-planner/">Weather Trip Planner</a></li><li><a href="{p}launches/">Rocket launches</a></li></ul></div>
<div><h4>Weather guides</h4><ul>{"".join(f'<li><a href="{p}guides/{g["slug"]}.html">{E(g["short"])}</a></li>' for g in GUIDES)}</ul></div>
<div><h4>More</h4><ul><li><a href="{p}gear/">Weather gear</a></li><li><a href="{p}support.html">Support</a></li><li><a href="{p}privacy.html">Privacy policy</a></li><li><a href="{p}privacy.html#website" data-cookie-settings>Cookie settings</a></li><li><a href="{p}affiliate-disclosure.html">Affiliate disclosure</a></li><li><a href="https://hunt.yourworldapps.si/" target="_blank" rel="noopener">Sister app: Your World Hunt</a></li><li><a href="{YOUTUBE}" target="_blank" rel="noopener">Watch on YouTube</a></li></ul></div>
</div><p class="fine">Forecasts and alerts are informational only, not official emergency, marine or aviation advice. Follow the National Weather Service and local officials. As an Amazon Associate I earn from qualifying purchases. &copy; {datetime.date.today().year} Your World Apps. Google Play is a trademark of Google LLC.</p></div></footer>
{bar}{sc}</body></html>'''
    doc = re.sub(r'href="' + re.escape(PLAY) + '"', f'href="{E(play_ref(slug, "inline"))}"', doc)
    out = ROOT / path; out.parent.mkdir(parents=True, exist_ok=True); out.write_text(doc)
    if path != "404.html" and sitemap: PAGES.append((url, prio))

def hero(h1, lead="", kicker=None, extra=""):
    return f'<section class="hero"><div class="wrap">{f"<span class=kicker>{E(kicker)}</span>" if kicker else ""}<h1>{E(h1)}</h1>{f"<p class=lead>{lead}</p>" if lead else ""}{extra}</div></section>'

def hero_atlas(h1, lead, kicker):
    return f'<section class="hero"><div class="wrap"><h1 class="atl-h1"><img src="/assets/{V("atlas.svg")}" width="72" height="72" alt="">{E(h1)}</h1><p class=lead>{lead}</p></div></section>'

def cta(p, slug, text):
    return f'<div class="cta"><img src="{p}assets/icon-192.png" alt=""><div class="grow"><h3>{APP}</h3><p>{E(text)}</p></div>{play_btn(slug)}</div>'

# ---------- Your World Weather Radar Outlook ----------
BASEMAP = "https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi?SERVICE=WMS&REQUEST=GetMap&VERSION=1.1.1&SRS=EPSG:4326&BBOX=-180,-90,180,90&WIDTH=1440&HEIGHT=720&FORMAT=image/jpeg&LAYERS=BlueMarble_ShadedRelief_Bathymetry"
PLAY_ICO = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M7 4.5v15l12-7.5z"/></svg>'
def owo_map(lite=False):
    return f'''<div class="owo-map" id="owo-map"{' data-lite="1"' if lite else ""}><img class="owo-base" src="{E(BASEMAP)}" alt="World map" width="1440" height="720">
<div class="owo-frames"></div><div class="owo-pins"></div><div class="owo-scan" aria-hidden="true"></div>
<div class="owo-live"><i></i>LIVE <span id="owo-time">Loading satellite…</span></div></div>
<p class="owo-attr">Infrared satellite loop (colder, brighter colors mark stronger storms): GOES-East, GOES-West and Himawari via NASA GIBS. Europe, Africa and the Indian Ocean: hourly Meteosat imagery via EUMETView. Contains modified EUMETSAT Meteosat data 2026 (CC BY 4.0)<span class="owo-gt">, latest <span id="owo-ev-t"></span></span>. Storm pins: NHC, JTWC and GDACS. Typhoon data: JTWC (US Navy), public domain.</p>'''
def owo_briefing():
    return f'''<div class="owo-brief"><button type="button" class="owo-play" id="owo-play">{PLAY_ICO}<span>Play live briefing</span></button>
<p class="dim small">A 1-minute spoken rundown of the live data on this page. Your browser's own voice reads it aloud.</p><div class="owo-cap" id="owo-cap" hidden aria-live="polite"></div></div>'''
TEASERS = [
 ("🧠", "AI storm briefings", "NOW, 6–24H and 2D to 10D tabs, written for your exact spot. NOW is free; the longer windows are Premium.",
  '<div class="tabs mini"><span class="on">NOW</span><span>6–24H</span><span>2D</span><span>5D</span><span>10D</span></div><i class="sk w90"></i><i class="sk w75"></i><i class="sk w85"></i><i class="sk w60"></i>'),
 ("🌀", "Hurricane tracking", "The NHC forecast track and cone right on your radar, plus a HURRICANE briefing tab when a storm is active.",
  '<svg class="cone" viewBox="0 0 200 90"><path d="M20 70 Q90 60 180 15 L190 40 Q100 80 20 74z" fill="rgba(255,255,255,.35)"/><path d="M20 72 Q95 62 185 27" stroke="#fff" stroke-width="2.5" fill="none" stroke-dasharray="5 5"/><circle cx="20" cy="72" r="6" fill="#F59E0B"/></svg>'),
 ("🔥", "Hazard layers", "Fire, earthquake and volcano layers, plus marine, aviation and space overlays, on the same map.",
  '<div class="chips"><span>🔥 Fire</span><span>🌋 Volcano</span><span>📳 Quakes</span><span>🌊 Marine</span><span>✈️ Aviation</span><span>🚀 Launches</span></div>'),
 ("👥", "Close-One", "Pick someone and their place. When a storm hits there, the app drafts a text for you to send.",
  '<div class="bubble">⚠️ Storm warning near Mom’s place<br><i class="sk w80"></i><i class="sk w55"></i></div>'),
]
def owo_teasers(slug):
    cards = "".join(f'<div class="owo-tease"><div class="owo-prev" aria-hidden="true">{prev}<div class="owo-lock">🔒 Premium</div></div><h3>{i} {E(t)}</h3><p>{E(d)}</p></div>' for i, t, d, prev in TEASERS)
    return f'''<section class="owo-prem"><span class="kicker">Taste of Premium</span><h2>This is the free sample. The app goes deeper.</h2>
<p class="dim">Premium is ${PRICE_M}/month or ${PRICE_Y}/year through Google Play. The radar, alerts, cams and NOW briefing stay free.</p>
<div class="owo-tgrid">{cards}</div><div class="btns" style="justify-content:center">{play_btn(slug, "primary glow", "outlook")}<a class="btn ghost-d" href="pricing.html">Compare Free and Premium</a></div></section>'''

SUN_CSS = '<style>.sun-sec{margin:34px 0 8px;padding:22px 18px;border-radius:24px;background:#030508;color:#DCE8F0;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,"Liberation Mono",monospace}.sun-sec h2{color:#2EE6D6;margin:0 0 4px;font-family:inherit;letter-spacing:.06em}.sun-sec .sun-lead{color:#7A8B99;margin:0 0 16px;font-size:.9rem}.sun-sec a{color:#2EE6D6}.sun-sec p,.sun-sec li,.sun-sec dd{color:#C9D6E0}.sun-sec .sun-foot,.sun-sec .sun-attr,.sun-sec .sun-lead,.sun-sec .sun-empty{color:#8A9BA9}.sun-sec .sun-lock,.sun-sec .sun-safe{color:#E8A317}.sun-top{display:grid;grid-template-columns:minmax(220px,320px) 1fr;gap:14px;align-items:start}.sun-disk{margin:0;background:#000;border-radius:16px;overflow:hidden;border:1px solid #1C3344}.sun-disk img{display:block;width:100%;height:auto;aspect-ratio:1}.sun-noimg{aspect-ratio:1;display:grid;place-items:center;color:#7A8B99;font-size:.85rem}.sun-disk figcaption{font-size:.72rem;color:#7A8B99;padding:7px 10px}.sun-disk figcaption i{display:inline-block;width:7px;height:7px;border-radius:50%;background:#FF4D5E;margin-right:6px;vertical-align:1px}.sun-disk figcaption i.off{background:#7A8B99}.sun-card{background:#0C131C;border:1px solid #1C3344;border-radius:10px;padding:12px}.sun-card h3{margin:0 0 10px;font:700 .78rem/1.2 inherit;letter-spacing:.14em;color:#2EE6D6;display:flex;justify-content:space-between;gap:8px}.sun-card h3 span{font-weight:400;letter-spacing:0;color:#7A8B99;font-size:.68rem}.sun-now{border-color:rgba(46,230,214,.45)}.sun-boxes{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}.sun-box{border:1px solid;border-radius:8px;padding:8px;text-align:center;display:grid;gap:2px}.sun-box b{font-size:1.35rem}.sun-box small{font-size:.6rem;letter-spacing:.1em;color:#7A8B99}.sun-box span{font-size:.72rem}.sun-box.ok{border-color:#22E07A;color:#22E07A;background:rgba(34,224,122,.07)}.sun-box.mid{border-color:#E8A317;color:#E8A317;background:rgba(232,163,23,.08)}.sun-box.hi{border-color:#FF3B4E;color:#FF3B4E;background:rgba(255,59,78,.08)}.sun-card dl{display:grid;grid-template-columns:70px 1fr;gap:4px 8px;margin:12px 0 0;font-size:.8rem}.sun-card dt{color:#7A8B99}.sun-card dd{margin:0}.sun-plain{list-style:none;padding:0;margin:12px 0 0;display:grid;gap:5px;font-size:.78rem;color:#B8C7D3}.sun-plain b{color:#2EE6D6;margin-right:4px}.sun-foot{font-size:.68rem;color:#7A8B99;margin:10px 0 0}.sun-row{display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:12px;margin-top:12px;align-items:start}.sun-next{border-color:rgba(232,163,23,.45)}.sun-next h3{color:#E8A317}.sun-days{display:grid;grid-template-columns:repeat(3,1fr);gap:6px}.sun-day{border:1px solid #1C3344;border-radius:8px;padding:7px;display:grid;gap:2px;text-align:center}.sun-day.on{border-color:#E8A317}.sun-day small{font-size:.62rem;color:#7A8B99}.sun-day b{font-size:.9rem}.sun-day i{font-style:normal;font-weight:700;font-size:.8rem}.sun-day span{font-size:.58rem;color:#7A8B99}.sun-day i.ok{color:#22E07A}.sun-day i.mid{color:#E8A317}.sun-day i.hi{color:#FF3B4E}.sun-aur{border-color:rgba(34,224,122,.45)}.sun-aur h3{color:#22E07A}.sun-aur p{font-size:.8rem;margin:0 0 8px}.sun-lock{color:#E8A317}.sun-ecls{border-color:rgba(179,157,219,.45)}.sun-ecls h3{color:#B39DDB}.sun-ecl{display:grid;grid-template-columns:52px 1fr auto;gap:8px;align-items:baseline;padding:6px 0;border-top:1px solid #1C3344;text-decoration:none;color:#DCE8F0;font-size:.78rem}.sun-ecl:first-of-type{border-top:0}.sun-ecl small{font-size:.62rem;color:#7A8B99}.sun-ecl b{display:block;font-size:.9rem}.sun-ecl b.solar{color:#E8A317}.sun-ecl em{font-style:normal;font-size:.68rem;color:#7A8B99}.sun-ecl .k{font-size:.7rem;text-align:right}.sun-safe{color:#E8A317;font-size:.7rem;margin:8px 0 0}.sun-cta{margin-top:14px;border:1px solid rgba(46,230,214,.35);border-radius:12px;padding:16px;background:linear-gradient(180deg,#070B10,#0C131C)}.sun-cta h3{margin:0 0 6px;color:#DCE8F0;font-family:inherit}.sun-cta p{margin:0 0 10px;font-size:.8rem;color:#B8C7D3}.sun-cta ul{margin:0 0 12px;padding-left:18px;font-size:.8rem;display:grid;gap:3px}.sun-cta li::marker{content:"🔒 "}.sun-cta .btn{font-family:system-ui,-apple-system,"Segoe UI",sans-serif}.sun-attr{font-size:.68rem;color:#7A8B99;margin:12px 0 0}.sun-empty{color:#7A8B99}@media(max-width:720px){.sun-top{grid-template-columns:1fr}.sun-disk{max-width:340px;margin:0 auto;width:100%}}</style>'
SUN_SEC = '\n<section class="sun-sec" id="sun" aria-labelledby="sun-h"><h2 id="sun-h">☀️ Sun Outlook</h2><p class="sun-lead">Today\'s Sun and the space weather it\'s sending our way, from the same NOAA and NASA feeds as the app\'s Sun tab.</p>\n<div id="owo-sun"><p class="owo-empty shimmer">Loading the Sun…</p></div>\n<div class="sun-cta"><h3>See the full Sun tab in Your World Weather Radar</h3><p>Free in the app: the live Sun with active regions, space weather now, the next 3 days, eclipses visible from your location, alerts for strong (G3+) geomagnetic storms and a reminder the day before an eclipse. Premium adds:</p>\n<ul><li>A 6-hour Sun loop</li><li>Extra layers: visible light, magnetic field, corona and AIA 193</li><li>The live Sky radar animation</li><li>Aurora chance at your location, with where to look</li><li>More solar alerts: radio blackouts, radiation storms, aurora at your location and extra eclipse reminders</li></ul>\n<div class="btns">{btn}</div></div>\n<p class="sun-attr">Sun data: <a href="https://www.swpc.noaa.gov/" target="_blank" rel="noopener">NOAA SWPC</a> and <a href="https://sdo.gsfc.nasa.gov/" target="_blank" rel="noopener">NASA SDO</a> (Sun image: NASA/SDO and the AIA science team). Eclipse dates: <a href="https://eclipse.gsfc.nasa.gov/" target="_blank" rel="noopener">NASA eclipse catalog</a> (Espenak &amp; Meeus). Refreshed with each site update. Informational only, not an official warning: for alerts, follow <a href="https://www.swpc.noaa.gov/" target="_blank" rel="noopener">NOAA SWPC</a>.</p></section>\n'

YT_SHORT = ("T2bragifDqc", "The whole planet's weather in 25 seconds")
def yt_short():
    vid, t = YT_SHORT
    return f'''<section class="yt-wrap" aria-label="Video"><a class="yt-facade" href="https://www.youtube.com/shorts/{vid}" data-yt="{vid}" data-yt-title="{E(t)}" target="_blank" rel="noopener" aria-label="Play video: {E(t)}">
<img src="assets/{V(f'yt-{vid}.jpg')}" width="360" height="640" alt="" loading="lazy"><span class="yt-play" aria-hidden="true"></span></a>
<div class="yt-txt"><span class="kicker">▶ Short</span><h2>{E(t)}</h2><p class="dim">A 25-second look at the planet's weather from our YouTube channel. Nothing loads from YouTube until you tap play.</p>
<p><a href="{YOUTUBE}" target="_blank" rel="noopener">More on our YouTube channel →</a></p></div></section>'''

def outlook_page():
    sun = SUN_SEC.replace("{btn}", play_btn("outlook", "primary glow", "sun", "See the Sun tab on Google Play"))
    b = f'''<div class="owo">{owo_map()}{owo_briefing()}
<div class="owo-stats-row"><div><b id="owo-storm-n">–</b><span>active tropical cyclones</span></div><div><b id="owo-alert-n">–</b><span>severe US alerts</span></div></div>
{yt_short()}
<h2>🌀 Active tropical storms</h2><div class="owo-storms" id="owo-storms"><p class="owo-empty shimmer">Loading NHC, JTWC and GDACS…</p></div>
<p class="owo-attr">Sources: <a href="https://www.nhc.noaa.gov/" target="_blank" rel="noopener">NOAA National Hurricane Center</a> (Atlantic &amp; Pacific, refreshed with each site update; cone graphics by NHC) and <a href="https://www.gdacs.org/" target="_blank" rel="noopener">GDACS</a> (global, live; European Commission JRC &amp; UN OCHA). Typhoon data: <a href="https://www.metoc.navy.mil/jtwc/jtwc.html" target="_blank" rel="noopener">JTWC (US Navy)</a>, public domain (Western Pacific, Indian Ocean and Southern Hemisphere; refreshed with each site update). JTWC shading is the 34-kt wind area, not a cone of uncertainty. Not an official local warning: always follow official advisories and your local weather service.</p>
<h2>🚨 US severe weather alerts</h2><div id="owo-alerts" data-limit="5"><p class="owo-empty shimmer">Loading NWS alerts…</p></div>
<p class="owo-attr">Source: <a href="https://www.weather.gov/" target="_blank" rel="noopener">National Weather Service</a> (api.weather.gov), live.</p>
{SUN_CSS}{sun}
<h2 id="launches">🚀 Today's launches</h2><div class="owo-launches" id="owo-launch"><p class="owo-empty shimmer">Loading the launch schedule…</p></div>
<p class="ln-all"><a class="btn dark" href="launches/">See all launches, countdowns and pad weather →</a></p>
<h2>🌍 Today around the world</h2><div class="owo-cities" id="owo-cities"><p class="owo-empty shimmer">Loading…</p></div>
<p class="owo-attr"><span id="owo-cities-at">Airport observations (METAR).</span> Source: <a href="https://aviationweather.gov/" target="_blank" rel="noopener">NOAA Aviation Weather Center</a>.</p>
{owo_teasers("outlook")}</div>'''
    page("outlook.html", "Your World Weather Radar Outlook", "Live world weather: an animated satellite loop, active hurricanes and typhoons, US severe weather alerts and conditions in major cities, from NOAA, NWS, NASA and GDACS.",
         b, hero("Your World Weather Radar Outlook", "Live storms, warnings and weather around the globe, updated as you watch.", "🌍 Live"), "0.9", scripts=("outlook.js",))

def home_outlook():
    return f'''<section class="owo owo-home"><span class="kicker">🌍 Live now</span><h2 style="margin-top:.2em">Your World Weather Radar Outlook</h2>
<p class="dim">What the planet's weather is doing right now: storms, warnings and cities.</p>{owo_map(lite=False)}
<div class="owo-stats-row"><div><b id="owo-storm-n">–</b><span>active tropical cyclones</span></div><div><b id="owo-alert-n">–</b><span>severe US alerts</span></div></div>
<div class="owo-storms" id="owo-storms" data-limit="2"><p class="owo-empty shimmer">Loading storms…</p></div>
<div class="btns" style="justify-content:center"><a class="btn primary glow" href="outlook.html">See the full live Outlook →</a></div></section>'''

HUNT = "https://hunt.yourworldapps.si/"
def hunt_promo():
    return f'''<a class="hunt-promo" href="{HUNT}" target="_blank" rel="noopener"><div class="hp-ico" aria-hidden="true">🦌</div><div class="hp-body">
<span class="hp-kick">Sister app</span><h3>Hunt smarter with Your World Hunt</h3><ul>
<li>🧭 Hunting map with GPS return and directions</li><li>💨 Wind, barometric pressure, moon and sun times, plus deer feeding times (Premium)</li>
<li>🗺️ Trip Planner with Ask Hawk and Top spots: public refuges and private lodges near you</li><li>🎧 Guides with a Listen button, in English and Spanish</li></ul>
<span class="hp-go">Visit hunt.yourworldapps.si →</span></div></a>'''

# ---------- features (from the app source; keep in sync) ----------
FEATURES = [
 ("☔", "Rain ETA", "free", "An early heads-up on when rain should reach your exact spot, worked out from live radar, with an optional notification. Included free."),
 ("📡", "Live radar", "free", "Rain in classic colors with snow kept light blue. Play the loop back and ahead, and add layers for lightning, hurricanes, fire, quakes and more."),
 ("🚨", "Weather alerts", "free", "National Weather Service alerts as compact cards, with rain and storm notifications in the background."),
 ("🧠", "AI Briefing tabs", "mix", "A short briefing for each window: NOW, 6–24H and day tabs from 2D to 10D. NOW is free; the longer windows are Premium."),
 ("📱", "On-device Gemma AI", "prem", "Optionally download Google's Gemma 3 (1B) model to write briefings on your phone. Your forecast never leaves the device, and it works offline after the download."),
 ("🌀", "Hurricane tracking", "prem", "NHC forecast track and cone on the map, plus a HURRICANE briefing tab when a storm is active."),
 ("🎥", "Weather cams", "free", "Live cameras near you from USGS, NOAA, Windy.com and WebCOOS coastal cams, plus YouTube live streams."),
 ("🛰️", "Off-Grid Safety", "free", "Save your last location and text it to emergency contacts. If your phone supports satellite texting, it can go out with no cell signal. Carrier message and data rates may apply."),
 ("👥", "Close-One", "prem", "Pick someone and their place. When a storm hits there, the app drafts a text for you to send."),
 ("🪶", "Lite mode", "free", "Gentler on older phones and slow Wi-Fi: Radar loads overlays gradually and caps heavy layers."),
]
TAG = {"free": '<span class="tag free">Free</span>', "prem": '<span class="tag prem">Premium</span>', "mix": '<span class="tag free">NOW free</span><span class="tag prem">More with Premium</span>'}
def feature_cards():
    return '<div class="grid">' + "".join(f'<div class="card"><div class="ico">{i}</div><h3>{E(t)} {TAG[k]}</h3><p>{E(d)}</p></div>' for i, t, k, d in FEATURES) + "</div>"

HOME_DESC = "Know when rain hits your spot: a free rain ETA for your exact location, plus live radar, storm tracks and weather alerts. For Android."
def home():
    h = f'''<section class="hero home"><div class="blip"></div><div class="wrap"><div>
<h1>Know when rain hits your spot.</h1>
<p class="lead">A free rain ETA for your exact location, plus live radar, National Weather Service alerts, AI briefings, hurricane tracks and nearby weather cams in one clean app. Text your location by satellite when there's no signal.</p>
<div class="btns">{play_btn("home","primary","hero")}<a class="btn ghost" href="alert-planner/">Plan alerts for a day out →</a></div>
{trial_line("trial on-dark")}
<p class="small" style="color:#94A3B8">No account needed. No ads of our own, no ad tracking, and we never sell your data. Optional anonymous crash and usage reports can be turned off in Settings.</p></div>
<div class="phone"><img src="assets/{V('shot-home.jpg')}" width="300" height="533" alt="Your World Weather Radar home screen"></div></div></section>'''
    b = f'''{sun_feature()}{ftl_home()}{home_outlook()}<h2>Everything you need when the weather turns</h2><p class="dim">Most of the app is free. Premium adds longer briefings, hurricane and hazard trackers, and Close-One.</p>{feature_cards()}
<div class="split" style="margin-top:40px"><div><h2 style="margin-top:0">An AI briefing for each part of the forecast</h2>
<div class="tabs"><span class="on">NOW</span><span>6–24H</span><span>2D</span><span>3D</span><span>4D</span><span>5D</span><span>7D</span><span>10D</span></div>
<p>Tap a tab and get a short, plain-English summary of that window. Built-in briefings are written on your phone from forecast data. With Premium you can download Gemma to write them on-device, or use your own AI provider key.</p>
<h2>Radar you can actually read</h2><p>Classic rain colors, snow that stays light blue, and a timeline you can scrub. Turn on lightning, hurricane, fire or earthquake layers only when you need them.</p></div>
<div class="shot"><img src="assets/{V('app-radar.jpg')}" width="320" height="569" alt="Radar screen with live rain over Richmond, Virginia, and the loop timeline" loading="lazy"></div></div>
<div class="split" style="margin-top:20px"><figure style="margin:0;justify-self:center;max-width:280px"><div class="shot" style="max-width:280px"><img src="assets/{V('app-cams.jpg')}" width="600" height="1398" alt="The app's Cams view: live webcams near Reykjavik, Iceland, with thumbnails credited to Windy" loading="lazy"></div><figcaption class="dim small" style="text-align:center;margin-top:8px">In the app: live cams near you (Reykjavik, Iceland shown). Webcam images via Windy.</figcaption></figure>
<div><h2 style="margin-top:0">Weather cams near you, free</h2><p>Real camera views from USGS, NOAA, Windy.com and <strong>WebCOOS</strong> coastal cams (SECOORA / NOAA IOOS), plus YouTube live streams. Coastal imagery courtesy of WebCOOS.</p>
<h2>Off-Grid Safety, free for everyone</h2><p>When you're out of signal near a severe alert, the app helps you text your saved location to your emergency contacts. If your phone supports satellite texting, it can go out by satellite. Use Emergency SOS or call 911 first. <em>Satellite texting may require a compatible plan. Carrier message and data rates may apply.</em></p></div></div>
<h2>Plan ahead</h2><div class="grid">
<a class="card" href="alert-planner/" style="text-decoration:none"><div class="ico">🔔</div><h3>Forecast &amp; Alert Planner</h3><p>Tell us the place, activity and dates. You get a link and QR code that open the plan in the app.</p></a>
<a class="card" href="trip-planner/" style="text-decoration:none"><div class="ico">🧳</div><h3>Weather Trip Planner</h3><p>Destination, dates and how you're traveling, in one link for your phone.</p></a>
<a class="card" href="guides/" style="text-decoration:none"><div class="ico">📚</div><h3>Weather guides</h3><p>Reading radar, watches vs. warnings, hurricanes, lightning and more, sourced from NWS and NOAA.</p></a></div>
{hunt_promo()}{cta("", "home", "Free on Google Play. Premium is $" + PRICE_M + "/month or $" + PRICE_Y + "/year.")}'''
    ld = [{"@context": "https://schema.org", "@type": "MobileApplication", "name": APP, "operatingSystem": "Android", "applicationCategory": "WeatherApplication",
           "author": ORG, "installUrl": PLAY, "url": SITE,
           "offers": [{"@type": "Offer", "price": "0", "priceCurrency": "USD"}]},
          dict({"@context": "https://schema.org"}, **ORG),
          {"@context": "https://schema.org", "@type": "WebSite", "name": APP, "url": SITE, "publisher": ORG}]
    page("index.html", f"{APP}: Live Radar, Storm Alerts & AI Briefings", HOME_DESC, b, h, "1.0", jsonld=ld, scripts=("outlook.js", "teaser.js"), head_extra=SHOW_CSS())

def features():
    b = f'''<div class="trial-box">{trial_line("trial")}<p class="dim small">Everything marked Free is included free, with no subscription.</p></div>''' + feature_cards() + f'''<h2>Also in the app</h2><ul>
<li>Forecasts from several weather models, with how much they agree</li><li>Marine data: water temperature, waves, buoys and NOAA tides (Premium)</li>
<li>Aviation, boating and space overlays, including rocket launches (Premium)</li><li>Fire, earthquake and volcano layers (Premium)</li></ul>
<div class="callout">Forecasts and alerts are informational only. They aren't official emergency, marine or aviation advice. Follow the NWS and local officials.</div>{cta("", "features", "Get the free app on Google Play. " + TRIAL)}'''
    page("features.html", "Features", "Every feature in Your World Weather Radar: radar, alerts, AI briefings, Gemma on-device AI, hurricane tracking, weather cams, Off-Grid Safety and Lite mode.", b, hero("Features", "What's free, what's Premium, and how each part works.", "The app"), "0.8")

def pricing():
    b = f'''<div class="prices"><div class="price"><h3>Free</h3><div class="amt">$0</div><ul><li>Live radar</li><li>NWS alerts and rain/storm notifications</li><li>NOW AI briefing</li><li>Nearby weather cams</li><li>Off-Grid Safety</li><li>Lite mode</li></ul></div>
<div class="price"><h3>Premium monthly</h3><div class="amt">${PRICE_M}<span class="per"> / month</span></div><ul><li>6–24H and 2D–10D AI briefings</li><li>On-device Gemma AI</li><li>Hurricane and hazard trackers</li><li>Close-One</li><li>Marine, aviation and space overlays</li></ul></div>
<div class="price best"><h3>Premium yearly</h3><div class="amt">${PRICE_Y}<span class="per"> / year</span></div><ul><li>Everything in Premium</li><li>Billed once a year</li></ul></div></div>
<p class="dim small">Prices in USD, billed through Google Play. Prices in other countries are set by Google Play in local currency. Manage or cancel any time in Google Play → Payments &amp; subscriptions.</p>{cta("", "pricing", "Download free on Google Play.")}'''
    page("pricing.html", "Pricing", f"Your World Weather Radar is free. Premium is ${PRICE_M} per month or ${PRICE_Y} per year through Google Play.", b, hero("Simple pricing", "Free to download. Premium unlocks the deeper forecast tools.", "Pricing"), "0.8")

def privacy():
    src = (Path(__file__).parent / "privacy_source.html").read_text()
    inner = re.search(r"<body>(.*)</body>", src, re.S).group(1)
    inner = re.sub(r"<h1>.*?</h1>", "", inner, count=1, flags=re.S)
    b = '<div class="article" style="margin-top:24px">' + inner + f'<h2 id="website">This website</h2><p>This website (not the app) uses <strong>Google Analytics 4</strong> to count visits and clicks, including taps on the Google Play link. It sets first-party cookies (<code>_ga</code> and <code>_ga_*</code>) to tell new visits from returning ones. Google processes this data for us under <a href="https://policies.google.com/privacy" target="_blank" rel="noopener">Google&#39;s privacy policy</a>, including your IP address and browser details, as with any website you visit. We don&#39;t use it for ads or ad personalization: ad storage and ad signals are always turned off. Visitors in the EU, the UK and Switzerland are asked first: if your device is set to a European time zone, you see a short banner and Google Analytics doesn&#39;t load until you tap Allow, and if Google places you in those countries, it sets no analytics cookies unless you allow them (Google may still receive basic visit counts without cookies). You can change your choice at any time with the <a href="#website" data-cookie-settings>Cookie settings</a> link in the footer; choosing No thanks stops Google Analytics from loading and removes its cookies. You can also use Google&#39;s <a href="https://tools.google.com/dlpage/gaoptout" target="_blank" rel="noopener">opt-out browser add-on</a>.</p><p>The live Outlook (on the home page and the Outlook page) loads some data straight from public sources in your browser: satellite imagery and the world map from NASA GIBS and EUMETSAT, storm events from GDACS and US alerts from the National Weather Service, so those services receive your IP address, as with any website you visit. Hurricane data from the National Hurricane Center, typhoon and cyclone warnings from the U.S. Navy&#39;s Joint Typhoon Warning Center (JTWC), airport observations, the launch schedule, and the Sun Outlook&#39;s NOAA Space Weather Prediction Center data and NASA Solar Dynamics Observatory Sun image are fetched by our site every few hours and served from this site, so viewing them doesn&#39;t contact those agencies. The Sun Outlook&#39;s eclipse dates are a fixed list from NASA&#39;s eclipse catalog, built into the page. The Outlook page includes a YouTube video. Nothing is loaded from YouTube until you tap play. When you do, the video loads from YouTube in privacy-enhanced mode (youtube-nocookie.com), so YouTube receives your IP address and may set cookies or similar storage under <a href="https://policies.google.com/privacy" target="_blank" rel="noopener">Google&#39;s privacy policy</a>. The Android app\'s optional, anonymous usage and crash reports (Google Firebase) are described above.</p><p class="dim small">The app policy above mirrors the policy shown inside the app. Questions or deletion requests: <a href="mailto:{PRIVACY_MAIL}">{PRIVACY_MAIL}</a>.</p></div>'
    page("privacy.html", "Privacy Policy", "Privacy policy for Your World Weather Radar: what leaves your phone, who receives it, and why.", b, hero("Privacy Policy", f"{APP} for Android and iPhone", "Privacy"), "0.4")

def support():
    b = f'''<div class="grid" style="margin-top:24px"><div class="card"><div class="ico">✉️</div><h3>Email support</h3><p><a href="mailto:{SUPPORT}">{SUPPORT}</a></p><p class="dim small">Tell us your phone model, Android version and app version (Settings → About).</p></div>
<div class="card"><div class="ico">🔒</div><h3>Privacy and data deletion</h3><p><a href="mailto:{PRIVACY_MAIL}">{PRIVACY_MAIL}</a></p><p class="dim small">See the <a href="privacy.html">privacy policy</a>.</p></div>
<div class="card"><div class="ico">💳</div><h3>Subscriptions</h3><p>Premium is billed by Google Play. Manage or cancel it in Google Play → Payments &amp; subscriptions.</p></div></div>
<h2>Common questions</h2>
<h3>Alerts aren't arriving on time</h3><p>Check that notifications are allowed for the app, and let it ignore battery optimization when it asks. Some phones delay background work.</p>
<h3>The radar is slow on my phone</h3><p>Turn on <strong>Lite mode</strong> in Settings. Radar then loads overlays gradually and caps the heavy layers.</p>
<h3>How does Off-Grid satellite texting work?</h3><p>The app saves your last location and opens a text to your emergency contacts. Your phone and carrier handle satellite sending, if your phone supports it. Satellite texting may require a compatible plan, and carrier message and data rates may apply. In an emergency, use Emergency SOS or call 911 first.</p>
<h3>Do I need an account?</h3><p>No. The app has no accounts.</p>'''
    page("support.html", "Support", "Get help with Your World Weather Radar.", b, hero("Support", "We read every message.", "Help"), "0.5")

def disclosure():
    page("affiliate-disclosure.html", "Affiliate disclosure", "How affiliate links work on this site.",
         '<div class="article" style="margin-top:24px"><p>Some links in the Gear section are Amazon affiliate links (tag <code>yourworldapps-20</code>). If you buy through them, we may earn a commission at no extra cost to you. <strong>As an Amazon Associate I earn from qualifying purchases.</strong></p><p>We don\'t show prices, ratings or reviews, because they change. Always check the details on the retailer\'s site. Deal headlines come from the public Slickdeals RSS feed and aren\'t endorsements.</p></div>',
         hero("Affiliate disclosure"), "0.2")

# ---------- guides ----------
BYSLUG = {g["slug"]: g for g in GUIDES}
def related(g):
    r = [BYSLUG[x] for x in g.get("related", []) if x in BYSLUG]
    return ('<h2 data-nolisten>Related guides</h2><div class="grid">' + "".join(f'<a class="card" href="{x["slug"]}.html" style="text-decoration:none"><div class="ico">{x["emoji"]}</div><h3>{E(x["short"])}</h3></a>' for x in r) + "</div>") if r else ""
def guides():
    cards = "".join(f'<a class="card" href="{g["slug"]}.html" style="text-decoration:none"><div class="ico">{g["emoji"]}</div><h3>{E(g["short"])}</h3><p>{E(g["desc"])}</p></a>' for g in GUIDES)
    page("guides/index.html", "Weather Guides", "Plain-English weather safety guides sourced from the National Weather Service and NOAA.", f'<div class="grid" style="margin-top:24px">{cards}</div>', hero("Weather guides", "Short, practical and sourced from the National Weather Service and NOAA.", "Learn"), "0.8")
    for g in GUIDES:
        src = "".join(f'<li><a href="{u}" target="_blank" rel="noopener">{E(t)}</a></li>' for t, u in g["sources"])
        body = (f'<div class="listen" data-listen=".article" hidden></div><div class="article"><p class="crumbs"><a href="../">Home</a> / <a href="./">Guides</a> / {E(g["short"])}</p>{g["body"]}'
                f'{related(g)}{cta("../", "guide-" + g["slug"], g["app"])}<h2 data-nolisten>Sources</h2><ul class="sources">{src}</ul>{hunt_promo()}<p class="dim small">Last reviewed {datetime.date.today():%B %Y}. General information only; follow official guidance in an emergency.</p></div>')
        ld = [{"@context": "https://schema.org", "@type": "Article", "headline": g["title"], "description": g["desc"], "author": {"@type": "Organization", "name": "Your World Apps"},
               "dateModified": datetime.date.today().isoformat(), "mainEntityOfPage": SITE + f'guides/{g["slug"]}.html'}]
        page(f'guides/{g["slug"]}.html', g["title"], g["desc"], body, hero(g["title"], "", "Guide"), "0.7", jsonld=ld, scripts=("listen.js",))

# ---------- gear ----------
def amz(q): return f"https://www.amazon.com/s?k={enc(q)}&tag={AMZ_TAG}"
def amz_dp(asin): return f"https://www.amazon.com/dp/{asin}?tag={AMZ_TAG}"  # verified product page
import gearart, gearimg
# (section id, title, intro, tone, [(art, product name, note[, asin, label])]). Real named products; links are Amazon searches for the exact name,
# or the product page when an ASIN is given (all sections; ASINs checked on amazon.com 2026-10-22). "Best value" = list-price discount >=25% verified that day. Labels are our picks; never prices.
GEAR = [
 ("rain", "☔ Rain gear", "Stay dry from the driveway to the trailhead.", "rain", [
   ("umbrella", "Repel windproof travel umbrella", "Compact auto open/close umbrella built for wind.", "B0160HYB8S", "Best value"),
   ("umbrella", "totes compact auto open umbrella", "Classic auto open/close folding umbrella.", "B071CWYNNW", "Best value"),
   ("jacket", "Columbia men's Watertight II rain jacket", "Packable waterproof shell for everyday rain.", "B0FYHTD33N", "Best value"),
   ("boots", "Hunter women's Original Tall rain boot", "Tall waterproof rubber rain boot.", "B01DJ3S8F8", "Best value"),
   ("jacket", "Frogg Toggs Ultra-Lite2 rain suit", "Budget jacket and pants set that packs small.", "B07VZH1GSG", "Budget pick"),
   ("boots", "KEEN men's Targhee 4 waterproof hiking boot", "Waterproof mid hiker for wet trails.", "B0CNF7PV5T", "Top pick"),
   ("jacket", "Marmot men's PreCip Eco rain jacket", "Lightweight waterproof, breathable jacket for hiking.", "B0CMRS1Q55", ""),
   ("drybag", "Earth Pak waterproof dry bag", "Roll-top bag with shoulder strap.", "B06XD2N14J", "Top pick"),
   ("boots", "XTRATUF men's 6 inch ankle deck boot", "Waterproof rubber boot for docks, boats and puddles.", "B074NGKL9G", ""),
   ("poncho", "Frogg Toggs Ultra-Lite2 poncho", "Covers you and a small pack.", "B00DIGKQH0", "Budget pick"),
   ("drybag", "Sea to Summit Lightweight Dry Bag", "Keeps phone, clothes and papers dry.", "B0BVWG3DGM", ""),
   ("poncho", "Sea to Summit Ultra-Sil Nano Tarp-Poncho", "Works as a poncho, pack cover or small shelter tarp.", "B00HUL25Q4", "Premium pick"),
 ]),
 ("radios", "📻 NOAA weather radios", "Alarms for warnings even with no cell signal or power.", "gear", [
   ("radio", "Midland WR120B NOAA weather radio", "Desktop alert radio with SAME county coding.", "B00176T9OY", "Budget pick"),
   ("radio", "Midland ER310 emergency crank radio", "Hand-crank and solar NOAA radio with flashlight.", "B015QIC1PW", "Top pick"),
   ("radio", "Midland WR400 NOAA weather radio", "Larger tabletop alert radio with SAME and battery backup.", "B071HFV836", ""),
   ("radio", "Eton American Red Cross FRX3 weather radio", "Hand-crank, solar and USB charging.", "B007KFLVTM", "Premium pick"),
 ]),
 ("stations", "🏠 Weather stations & instruments", "Your own readings for your own yard.", "gear", [
   ("thermo", "ThermoPro TP50 thermometer hygrometer", "Indoor temperature and humidity.", "B01H1R0K68", "Best value"),
   ("gauge", "AcuRite wireless digital rain gauge", "Self-emptying collector reads rainfall on an indoor display.", "B004V1XJW0", ""),
   ("lightning", "AcuRite 02020 portable lightning detector", "Counts strikes and estimates storm distance, up to 25 miles.", "B00EO1H3X8", ""),
   ("station", "Ambient Weather WS-2902 weather station", "Wi-Fi station with outdoor sensor array.", "B01N5TEHLI", "Top pick"),
   ("station", "AcuRite Iris 5-in-1 weather station", "Wind, rain, temperature and humidity on a color display.", "B00N1XCA9M", ""),
   ("station", "Davis Instruments Vantage Vue weather station", "Integrated wireless sensor suite.", "B00481TX32", "Premium pick"),
   ("gauge", "AcuRite 5 inch magnifying rain gauge", "Simple clear gauge for the yard.", "B000A3IMP2", "Budget pick"),
   ("thermo", "Govee H5075 thermometer hygrometer", "Bluetooth temperature and humidity logger.", "B07Y36FWTT", ""),
   ("anemo", "Kestrel 3000 pocket weather meter", "Handheld wind, temperature and humidity.", "B001JEPJZ2", "Premium pick"),
   ("anemo", "BTMETER BT-100 handheld anemometer", "Pocket wind speed meter.", "B07J64TCBQ", "Budget pick"),
 ]),
 ("emergency", "🔦 Emergency & power", "For outages, storms and trips past the edge of coverage.", "power", [
   ("light", "Energizer WeatheReady PRO-360 LED lantern", "Battery lantern for power outages.", "B01N5MBY3J", "Best value"),
   ("kit", "Ready America 70280 emergency kit", "2-person, 3-day backpack with food, water and supplies.", "B000FJQQVI", "Best value"),
   ("power", "Anker 10,000mAh power bank", "Slim pocket charger for phones.", "B0D5CLSMFB", "Budget pick"),
   ("light", "Black Diamond Spot 400 headlamp", "Hands-free light, rated waterproof.", "B0H1R7G7VN", "Top pick"),
   ("power", "Jackery Explorer 300 portable power station", "Runs small devices and charges phones in outages.", "B082TMBYR6", ""),
   ("kit", "First Aid Only 298 piece first aid kit", "All-purpose first-aid kit.", "B000069EYA", "Safety pick"),
 ]),
 ("generators", "⚡ Generators & generator safety", "Keep the fridge, lights and phones going through a long outage.", "power", [
   ("power", "Westinghouse iGen5000DFc dual fuel inverter generator", "Gas or propane, remote electric start, quiet inverter power.", "B099KSY4XG", "Best value"),
   ("power", "PowerSmart 2500 watt inverter generator", "Light gas inverter for the basics: fridge, lights, chargers.", "B089FDFDH5", "Budget pick"),
   ("power", "Champion 4000-watt dual fuel inverter generator", "Gas or propane, RV ready, a step up in power.", "B0D6SQR1L1", "Top pick"),
   ("power", "Honda EU2200i inverter generator", "Quiet, proven 2200 W gas inverter.", "B079YF1HF6", "Premium pick"),
   ("power", "Kidde battery carbon monoxide alarm", "A CO alarm on every level is a must if you run a generator.", "B004Y6V5CI", "Safety pick"),
   ("power", "Champion 25 ft 30 amp generator power cord", "L14-30 cord for a manual transfer switch your electrician installs.", "B076HQ2THC", ""),
   ("power", "HUANCHAIN 50 ft 12 gauge outdoor extension cord", "Heavy-duty cord so the generator can sit well away from the house.", "B09WR4ZHRD", ""),
 ]),
 ("batteries", "🔋 Power stations & solar", "Quiet battery backup you can run indoors. Recharge from the wall, a car or the sun.", "power", [
   ("power", "Anker SOLIX C1000 portable power station", "1,056 Wh LiFePO4 battery, 1800 W AC output.", "B0C5C89QKZ", "Best value"),
   ("power", "EcoFlow RIVER 3 portable power station", "Small 245 Wh unit for phones, lights and a router.", "B0DB1S36YP", "Budget pick"),
   ("power", "Jackery Explorer 1000 v2 portable power station", "1,070 Wh LiFePO4 battery, 1500 W AC output.", "B0D7PPG25F", "Top pick"),
   ("power", "BLUETTI AC180 portable power station", "1,152 Wh LiFePO4 battery, 1800 W AC output.", "B0C1SMJTDT", ""),
   ("power", "EcoFlow 220W bifacial portable solar panel", "Folding panel to recharge a power station when the grid is down.", "B09TKM8PBQ", ""),
 ]),
 ("outage", "🔌 Outage backup for home & phone", "Keep Wi-Fi, phones and lights on when the power flickers or fails.", "power", [
   ("light", "Glocusent rechargeable LED lantern", "Bright rechargeable lantern that can also charge a phone.", "B0FL22QSGP", "Best value"),
   ("power", "INIU 20000mAh power bank", "Slim 20,000 mAh charger to keep phones going.", "B0FX7T4H7D", "Budget pick"),
   ("power", "CyberPower CP1500PFCLCD UPS battery backup", "Bigger sine-wave UPS for a computer plus network gear.", "B00429N19W", ""),
   ("power", "APC BE600M1 UPS battery backup", "Keeps a modem and router online through short outages.", "B01FWAZEIU", "Top pick"),
 ]),
]
GEN_SAFETY = ('<p class="callout"><strong>Generator safety:</strong> Run a generator outdoors only, far from windows, doors and vents. '
              'Never run one indoors, in a garage, basement or shed, even with the door open. Exhaust has carbon monoxide, which you can\'t see or smell. '
              'Never plug a generator into a wall outlet; use extension cords or a transfer switch installed by a licensed electrician.</p>')
def gear():
    jump = '<div class="tabs" style="margin-top:18px">' + "".join(f'<a href="#{sid}" class="btn" style="padding:7px 14px;font-size:.85rem">{E(t)}</a>' for sid, t, *_ in GEAR) + "</div>"
    secs = ""; seen = set()
    def gid(k, n):  # anchor on the first card of each image key, e.g. /gear/#g-jacket (Trip Planner gear card links here)
        g = gearimg.key(k, n)
        if g in seen: return ""
        seen.add(g); return f' id="g-{g}"'
    def card(k, n, d, asin="", label=""):
        tag = f'<i class="pc-tag">{E(label)}</i>' if label else ""
        return (f'<a class="pcard"{gid(k, n)} href="{E(amz_dp(asin) if asin else amz(n))}" target="_blank" rel="sponsored nofollow noopener"><span class="pc-art">{gearimg.art(k, tone, n)}</span>'
                f'<span class="pc-body">{tag}<b>{E(n)}</b><span>{E(d)}</span><em>See on Amazon →</em></span></a>')
    for sid, title, sub, tone, items in GEAR:
        safety = GEN_SAFETY if sid == "generators" else ""
        secs += f'<h2 id="{sid}">{E(title)}</h2><p class="dim">{E(sub)}</p>{safety}<div class="pgrid">' + "".join(card(*it) for it in items) + "</div>"
    deals = load_deals()
    # Storm-power deals can be older than the newest rain/radio headlines, so the newest generator, power station and
    # UPS battery backup deal each keep a slot in the 12 shown; the rest fill by date. Same filters and age limit as every other deal.
    pw = [d for d in (next((d for d in deals if rx.search(d["title"])), None) for rx in STORM_POWER) if d]
    deals = sorted(pw + [d for d in deals if d not in pw][:12 - len(pw)], key=lambda d: d["posted"], reverse=True)
    dl = "".join(f'<div class="deal"><a href="{E(d["link"])}" target="_blank" rel="nofollow noopener">{E(d["title"])}</a><time>{E(d["posted"][:10])}</time></div>' for d in deals[:12])
    dsec = f'<h2 id="deals">🔥 Weather &amp; emergency deals</h2><p class="dim small">Latest matching headlines from the Slickdeals RSS feed, refreshed when the site is built. Prices and availability change fast.</p><div class="card">{dl}</div>' if dl else ""
    b = ('<p class="disclosure" style="margin-top:22px"><strong>Disclosure:</strong> Cards link to Amazon search results or product pages for each named product. We may earn a commission at no extra cost to you. As an Amazon Associate I earn from qualifying purchases. Labels like “Top pick” are our own picks, not Amazon deals. We don\'t show prices or ratings because they change daily, so check the current price on Amazon. Card art is our own illustration, not a product photo. <a href="../affiliate-disclosure.html">Details</a></p>'
         + jump + secs + dsec + cta("../", "gear", "Pair your gear with live radar and NWS alerts."))
    page("gear/index.html", "Weather Gear: Rain Gear, Weather Radios, Stations & Emergency Kits", "Rain jackets, ponchos, boots, dry bags, NOAA weather radios, home weather stations, rain gauges, lightning detectors, generators, power stations, UPS battery backups and emergency gear.", b, hero("Weather gear", "Rain gear, radios, instruments, backup power and emergency kit worth owning before storm season.", "Gear"), "0.7")

DEAL_KW = ["weather radio", "weather station", "rain gauge", "rain jacket", "umbrella", "rain boots", "dry bag", "power bank", "power station", "inverter generator", "portable generator", "battery backup", "emergency radio", "lantern", "headlamp", "flashlight", "first aid kit", "poncho"]
# Slickdeals search RSS is loose (a "lantern" query returns floor lamps, "umbrella" returns patio umbrellas, and some results
# match nothing at all: lawn sweepers, Halloween lights, AV receivers). So a headline is only kept when it names weather,
# outdoor, emergency or rain gear (DEAL_OK) and names nothing off-topic (DEAL_BAD). Deals older than DEAL_MAX_DAYS are
# dropped because their prices are likely gone. The same filter runs on the cached deals.json, so an offline build stays clean.
DEAL_OK = re.compile(r"weather radio|noaa|emergency (weather )?radio|hand[- ]?crank|crank radio|weather station|rain gauge|barometer|anemometer"
                     r"|lightning detector|weather alert|two-way radio|walkie[- ]?talkie|\brain\b[\w\s'’&-]{0,25}\b(jacket|coat|boots?|pants|suit|poncho|gear|shell)\b"
                     r"|raincoat|rainboots?|poncho|waterproof[\w\s-]{0,15}\b(jacket|coat|boots?|bag|pants)\b|\bumbrellas?\b|dry bag|power bank|portable charger"
                     r"|power station|generator|solar panel|\bups\b[\w\s/-]{0,30}battery backup|lantern|headlamp|flashlight|first[- ]aid|emergency kit|survival kit|emergency blanket", re.I)
DEAL_BAD = re.compile(r"halloween|christmas|holiday|xmas|patio|market umbrella|beach umbrella|\blamp\b|floor|desk fan|\bfan\b|duster|vacuum|\bmop\b"
                      r"|receiver|sweeper|lawn|leaf|xbox|playstation|ps5|nintendo|switch|\bgame|vinyl|\blp\b|album|lego|ceiling|hook|grill"
                      r"|docking station|\bnas\b|jump starter|magsafe|qi2|wireless charging|\bcap\b|\bhats?\b|backpack|storage bag|ice pack|cooler|\btoys?\b|inflatable|decor|fairy|string lights|squirrel|feeder|picnic|flicker|flame|hanging|garden|pathway|landscape|yard", re.I)
DEAL_MAX_DAYS = 60
STORM_POWER = [re.compile(r"generator", re.I), re.compile(r"power station", re.I), re.compile(r"battery backup", re.I)]
def deal_ok(d):
    t = d.get("title", "")
    if not DEAL_OK.search(t) or DEAL_BAD.search(t): return False
    try: age = (datetime.datetime.now(datetime.timezone.utc) - datetime.datetime.fromisoformat(d["posted"])).days
    except Exception: return False
    return age <= DEAL_MAX_DAYS
def load_deals():
    f = ROOT / "assets/deals.json"; items = []
    try:
        for kw in DEAL_KW:
            u = "https://slickdeals.net/newsearch.php?mode=frontpage&searcharea=deals&searchin=first&rss=1&q=" + enc(kw)
            x = urllib.request.urlopen(urllib.request.Request(u, headers={"User-Agent": "Mozilla/5.0"}), timeout=15).read().decode("utf-8", "replace")
            n = 0
            for it in re.findall(r"<item>(.*?)</item>", x, re.S):
                if n >= 4: break
                t = html.unescape(re.sub(r"<!\[CDATA\[|\]\]>", "", re.search(r"<title>(.*?)</title>", it, re.S).group(1))).strip()
                l = html.unescape(re.search(r"<link>(.*?)</link>", it, re.S).group(1)).strip()
                pd = re.search(r"<pubDate>(.*?)</pubDate>", it)
                posted = email.utils.parsedate_to_datetime(pd.group(1)).isoformat() if pd else ""
                d = {"title": t, "link": l, "posted": posted}
                if l and deal_ok(d) and not any(i["link"] == l or i["title"] == t for i in items): items.append(d); n += 1
        items.sort(key=lambda i: i["posted"], reverse=True)
        if items: f.write_text(json.dumps({"source": "Slickdeals RSS", "fetchedAt": datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds"), "items": items}, indent=1))
    except Exception as e:
        print("deals fetch failed, keeping cached deals.json:", e)
    return [d for d in json.loads(f.read_text())["items"] if deal_ok(d)] if f.exists() else []

# ---------- planners ----------
# The app's verified App Links claim exactly /plan, /plan.html, /trip and /trip.html (android:path, not pathPrefix), so the
# planners live at /alert-planner/ and /trip-planner/ and site navigation stays in the browser. Shared plan links keep using
# /plan#v1.… and /trip#v1.… so they DO open the app. The old paths remain as tiny redirect pages for browsers without the app.
def legacy_planners():
    for old, new, t in (("plan.html", "alert-planner/", "Forecast & Alert Planner"), ("trip.html", "trip-planner/", "Weather Trip Planner")):
        (ROOT / old).write_text(f'''<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>{E(t)} | {APP}</title><link rel="canonical" href="{SITE}{new}"><meta name="robots" content="noindex">
<script>location.replace("/{new}" + location.search + location.hash);</script></head>
<body style="font-family:system-ui;padding:24px"><p>The {E(t)} has moved: <a href="/{new}">{SITE}{new}</a></p></body></html>''')

def planner(path, kind):
    is_plan = kind == "plan"
    ex = ("Hiking in Asheville, NC this Saturday, warn me about lightning" if is_plan else "Road trip from Atlanta to Nashville Oct 30 - Nov 1")
    title = "Forecast & Alert Planner" if is_plan else "Weather Trip Planner"
    lead = ("Pick a place, what you're doing and when. Get a link and QR code that open the plan in the app." if is_plan
            else "Destination, dates and how you're traveling. Get a link and QR code that open the trip in the app.")
    head = (f'<div class="atl-head"><img class="atl-av" src="/assets/{V('atlas.svg')}" width="44" height="44" alt=""><div><b>Ask Atlas</b><span>Describe your trip, or ask a weather question</span></div></div>'
            if not is_plan else '<h3 style="margin-top:0">⚡ Quick Plan: say it in one sentence</h3>')
    b = f'''<div class="wiz"><div class="wcard" style="margin-bottom:16px">{head}
<div class="quick"><input type="text" id="qtext" placeholder="{E(ex)}" aria-label="{"Describe your plan" if is_plan else "Ask Atlas about your trip"}">{mic("qtext", "qgo")}<button class="btn primary" id="qgo">{"Plan it" if is_plan else "Ask"}</button></div>
<p class="note">Try: “{E(ex)}”. Tap 🎤 to speak. Parsed in your browser; this site sends nothing anywhere (your browser's own speech service handles voice).</p><div class="parsed" id="qout"></div></div>
<div class="wcard"><div class="prog"><i id="prog"></i></div><div id="wiz"></div></div>
<p class="note" style="text-align:center">Don't have the app? {play_btn("plan" if is_plan else "trip", "dark", "planner", "Get it on Google Play")}</p></div>'''
    codec = "plancodec.js" if is_plan else "tripcodec.js"
    page(path, title, lead, b, hero(title, lead, "Planner"), "0.8",
         scripts=("vendor/qrcode.js", "codec-core.js", codec, "quickparse.js") + (() if is_plan else ("askdata.js", "ask.js")) + ("wizard.js",) + (("plan.js",) if is_plan else ("tripgear.js", "trip.js")) + ("voice.js", "listen.js"))

def ask():
    import askdata
    qa = [{"k": k, "q": q, "a": a, "u": f"/guides/{u}.html", "t": BYSLUG[u]["short"]} for k, q, a, u in askdata.QA]
    qa += [{"k": k, "q": q, "a": a, "u": "/" + u[3:], "t": "More"} for k, q, a, u in askdata.APP_QA]
    (ROOT / "assets/askdata.js").write_text("/* generated by _src/build.py from _src/askdata.py */\nwindow.YW_ASK = " + json.dumps(qa, ensure_ascii=False) + ";\n")
    sugg = ["Hiking in Asheville, NC this Saturday", "Road trip from Atlanta to Nashville Oct 30 - Nov 1", "Where should I shelter from a tornado?", "What do the radar colors mean?", "How much water can sweep away a car?", "How much is Premium?"]
    b = f'''<div class="wiz"><div class="wcard"><div class="ask-log" id="log" aria-live="polite"><div class="msg bot"><b><img class="atl-ic" src="/assets/{V('atlas.svg')}" width="24" height="24" alt="">Atlas<button type="button" class="lsay" data-say="msg" aria-label="Listen" title="Listen">🔊</button></b><p>Hi! Ask me a weather safety question, or describe a day out or a trip, and I'll set up a forecast plan you can open in the app.</p></div></div>
<form class="quick" id="askf" style="margin-top:14px"><input type="text" id="askq" placeholder="Ask about storms, radar, hurricanes, or plan a trip…" aria-label="Ask Atlas" autocomplete="off">{mic("askq", "askf")}<button class="btn primary">Ask</button></form>
<div class="parsed" id="sugg" style="margin-top:12px">{"".join(f'<button type="button" class="sug">{E(x)}</button>' for x in sugg)}</div>
<p class="note">Atlas runs entirely in your browser from our guides. Nothing you type is sent anywhere, and there's no AI service behind it. Voice input uses your browser's own speech service. For emergencies, follow the NWS and local officials.</p></div></div>'''
    page("ask.html", "Ask Atlas", "Ask Atlas: quick weather safety answers from NWS and NOAA sourced guides, plus one-sentence forecast and trip planning.", b,
         hero_atlas("Ask Atlas", "Weather safety answers and one-line planning, sourced from the NWS and NOAA.", "Ask"), "0.7", scripts=("codec-core.js", "quickparse.js", "askdata.js", "ask.js", "voice.js", "listen.js"))

# ---------- /go/ social bio landing page (+ /tiktok/ and /facebook/ aliases) ----------
# ?src= is whitelisted; it becomes the Play install referrer (utm_source=<src>&utm_medium=social&utm_campaign=bio) and is
# copied into the page URL as UTMs before Google Analytics is configured, so the visit is attributed to the platform.
GO_SRCS = ("tiktok", "facebook", "reddit", "x", "youtube", "instagram")
GO_ALIASES = ("tiktok", "facebook")
def go_page():
    fallback = play_ref("go", "bio")
    head = ('<script>(function(){var W=' + json.dumps(list(GO_SRCS)) + ',q=new URLSearchParams(location.search),s=(q.get("src")||q.get("utm_source")||"").toLowerCase();'
            'if(W.indexOf(s)<0)return;window.YW_GO_SRC=s;if(q.get("utm_source")!==s||q.has("src")){q.delete("src");q.set("utm_source",s);q.set("utm_medium","social");q.set("utm_campaign","bio");'
            'try{history.replaceState(null,"",location.pathname+"?"+q.toString()+location.hash)}catch(e){}}})();</script>')
    shots = "".join(f'<figure class="go-shot"><img src="../assets/{V(f)}" width="300" height="533" alt="{E(a)}" loading="{l}"><figcaption>{E(c)}</figcaption></figure>'
                    for f, a, c, l in (("shot-home.jpg", "Your World Weather Radar home screen with a rain ETA", "Rain ETA for your spot", "eager"),
                                       ("app-radar.jpg", "Radar screen with live rain", "Live radar you can scrub", "lazy"),
                                       ("app-hurricane.jpg", "Hurricane track on the radar", "Hurricane tracks (Premium)", "lazy")))
    big = f'<a class="btn primary go-play" data-go-play href="{E(fallback)}" target="_blank" rel="noopener">{PLAY_SVG}Get it on Google Play</a>'
    h = f'''<section class="hero go-hero"><div class="wrap"><img class="go-ico" src="../assets/icon-192.png" width="72" height="72" alt="">
<h1>{APP}</h1><p class="lead">Know when rain hits your spot. Free rain ETA, live radar, storm tracks and weather alerts for Android.</p>
{big}{trial_line("trial on-dark")}<p class="small go-free">Free to download. Rain ETA, radar and alerts are included free.</p></div></section>'''
    b = f'''<ul class="go-list"><li><b>☔ Rain ETA</b><span>An early heads-up on when rain should reach your exact location.</span></li>
<li><b>📡 Live radar &amp; storm tracks</b><span>Scrub the radar loop, and follow NHC hurricane and JTWC typhoon tracks on our live Outlook.</span></li>
<li><b>🚨 Weather alerts</b><span>National Weather Service alerts as compact cards, with rain and storm notifications.</span></li></ul>
<div class="go-shots">{shots}</div>
<div class="go-again">{big}{trial_line("trial")}</div>
<p class="dim small" style="text-align:center"><a href="../">Visit the full website</a> · <a href="../outlook.html">Live storm Outlook</a> · <a href="../pricing.html">Pricing</a></p>
<script>(function(){{var s=window.YW_GO_SRC;if(!s)return;var u="{PLAY}&referrer="+encodeURIComponent("utm_source="+s+"&utm_medium=social&utm_campaign=bio");
document.querySelectorAll("[data-go-play]").forEach(function(a){{a.href=u}})}})();</script>'''
    page("go/index.html", f"Get {APP} on Google Play", "Know when rain hits your spot: free rain ETA, live radar, storm tracks and NWS alerts for Android.", b, h, "0.5",
         slug="go", minimal=True, playbar=False, head_extra=head, sitemap=False)
    for a in GO_ALIASES:
        (ROOT / a).mkdir(exist_ok=True)
        (ROOT / a / "index.html").write_text(f'''<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>{APP}</title><link rel="canonical" href="{SITE}go/"><meta name="robots" content="noindex">
<script>var q=new URLSearchParams(location.search);q.set("src","{a}");location.replace("/go/?"+q.toString()+location.hash);</script>
<noscript><meta http-equiv="refresh" content="0;url=/go/?src={a}"></noscript></head>
<body style="font-family:system-ui;padding:24px"><p><a href="/go/?src={a}">Get {APP} on Google Play</a></p></body></html>''')

def misc():
    page("404.html", "Page not found", "Page not found.", f'<p style="margin-top:24px">That page isn\'t here. <a href="/">Go home</a>.</p>', hero("Page not found"))
    sm = "".join(f"<url><loc>{u}</loc><lastmod>{datetime.date.today()}</lastmod><priority>{p}</priority></url>" for u, p in PAGES)
    (ROOT / "sitemap.xml").write_text(f'<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">{sm}</urlset>\n')
    (ROOT / "robots.txt").write_text(f"User-agent: *\nAllow: /\nSitemap: {SITE}sitemap.xml\n")


# ---------- Sun feature + FEEL THE LAUNCH teaser (home) and the /launches/ page ----------
# Free vs Premium below is checked against the app source (keep in sync):
#  - Rocket launches on the radar map = the Space overlays: RadarOverlayPrefs.freeTierOnly() sets spaceLaunches=false and
#    hasPremiumOverlays() includes anySpace, so pins, countdowns and launch cards are Premium.
#  - Launch push alerts (T-1 h reminder + liftoff) are Premium (SysSheet ROCKET LAUNCHES toggle is locked for free users).
#  - The FEEL THE LAUNCH button on a launch card has no entitlement check of its own (LaunchDeckLink.kt), so it is NOT
#    labeled Premium here. The Launch Deck site itself is never linked from this website.
def SHOW_CSS(p="/"): return f'<link rel="stylesheet" href="{p}assets/{V("launches.css")}">'

def sun_feature():
    return f'''<section class="sunf" aria-labelledby="sunf-h"><div class="sunf-shot"><img src="assets/{V('app-sun.jpg')}" width="540" height="1080" alt="The Sun tab in Your World Weather Radar: today's Sun from NASA SDO and space weather now from NOAA" loading="lazy"></div>
<div class="sunf-t"><span class="kicker">☀️ New: the Sun tab</span><h2 id="sunf-h">Today's Sun, in plain words</h2>
<p>See the live Sun from NASA's Solar Dynamics Observatory with its active regions marked, and NOAA's solar storm, radio blackout and radiation levels explained in plain words, plus the next 3 days, the aurora outlook and eclipses you can see from where you are.</p>
<ul class="sunf-l"><li><span class="tag free">Free</span> Live Sun image, space weather now, the next 3 days, eclipses visible from your location, and alerts for strong (G3+) geomagnetic storms</li>
<li><span class="tag prem">Premium</span> A 6-hour Sun loop, extra layers (visible light, magnetic field, corona), the live Sky radar animation and aurora chance at your location</li></ul>
<div class="btns"><a class="btn dark" href="outlook.html#sun">See today's Sun →</a>{play_btn("home", "primary", "sun", "Get the Sun tab")}</div>
<p class="dim small">Sun data from NOAA SWPC and NASA SDO. Informational only, not an official space weather warning.</p></div></section>'''

def ftl_video(p, slug, sec):
    poster = f"{p}assets/{V('launch-teaser.jpg')}"
    webm = f'<source src="{p}assets/{V("launch-teaser.webm")}" type="video/webm">' if (ROOT / "assets/launch-teaser.webm").exists() else ""
    # MP4 (H.264 Main, yuv420p, faststart) first: it plays everywhere, including Samsung Internet and Safari.
    return f'''<div class="ftl is-idle"><video muted playsinline webkit-playsinline preload="none" poster="{poster}" width="720" height="1280" disablepictureinpicture aria-label="FEEL THE LAUNCH: a 15-second simulated practice run, countdown to liftoff"><source src="{p}assets/{V("launch-teaser.mp4")}" type="video/mp4">{webm}</video>
<button type="button" class="ftl-hit" aria-label="Play the 15-second teaser"><span class="ftl-play" aria-hidden="true"><svg viewBox="0 0 24 24"><path fill="currentColor" d="M7 4.5v15l12-7.5z"/></svg></span></button>
<div class="ftl-end" hidden><b>FEEL THE LAUNCH</b><p>Countdown, liftoff, inside and outside views, in 3D.</p>{play_btn(slug, "primary glow ftl-cta", sec, "Feel the full launch: get the app")}<button type="button" class="ftl-again">↺ Watch again</button></div></div>'''

def ftl_home():
    return f'''<section class="ftlh" aria-labelledby="ftlh-h">{ftl_video("", "home", "feel-the-launch")}
<div class="ftlh-t"><span class="kicker">🚀 Rocket launches</span><h2 id="ftlh-h">Feel the launch</h2>
<p>Tap <b>FEEL THE LAUNCH</b> on a launch card in the app and an immersive 3D view of that launch opens in your browser: the countdown, liftoff and climb, from outside or inside the rocket. A practice run lets you try it any time.</p>
<p class="dim small">The clip is a simulated practice run, not footage of a real launch.</p>
<div class="btns"><a class="btn dark" href="launches/">See upcoming launches →</a></div></div></section>'''

def _static_launches():
    """Build-time fallback (no-JS and search engines): the snapshot's next launches as plain text. assets/launches.js replaces it."""
    try: items = json.loads((ROOT / "assets/outlook.json").read_text())["launches"]["items"]
    except Exception: return "", ""
    now = datetime.datetime.now(datetime.timezone.utc); rows = []
    for l in items:
        try: t = datetime.datetime.fromisoformat(l["net"].replace("Z", "+00:00"))
        except Exception: continue
        if t < now - datetime.timedelta(hours=2) and l.get("status") not in ("Success", "Failure"): continue
        rows.append((t, l))
    if not rows: return "", ""
    t0, n = rows[0]
    hero = f'<div class="ln-next"><span class="ln-stat">{E(n.get("statusName") or n.get("status") or "")}</span><h2 class="ln-mission">{E(n.get("mission") or n.get("name") or "")}</h2><p class="ln-when">{t0:%a %b %-d, %H:%M} UTC</p><p>{E(n.get("rocket") or "")} · {E(n.get("provider") or "")}<br>{E(n.get("pad") or "")}, {E(n.get("site") or "")}</p></div>'
    lst = "".join(f'<article class="ln-card"><div class="ln-cb"><h3>{E(l.get("mission") or l.get("name") or "")}</h3><p>{t:%b %-d, %H:%M} UTC · {E(l.get("rocket") or "")} · {E(l.get("provider") or "")}</p><p class="dim">{E(l.get("site") or "")}</p></div></article>' for t, l in rows[1:25])
    return hero, lst

TIPS = [
 ("⏱️", "Times slip. Check before you go", "Launch times move often, and scrubs on the day are common. Check the launch provider's website or social accounts for the latest time before you head out."),
 ("🌅", "Twilight launches put on the best show", "Shortly after sunset or before sunrise, sunlight can still hit the exhaust plume high up while the sky is dark where you are, which can make it glow. It depends on the time and the sky."),
 ("🔭", "Distance and the sound delay", "You can see a launch from far away when the sky is clear, but the rocket looks small. Binoculars help. If you're close enough to hear it, the rumble arrives seconds after liftoff."),
 ("🏖️", "Florida's Space Coast", "Around Cape Canaveral and Kennedy, people watch from public parks, beaches and riverfronts in places like Titusville, Cocoa Beach and Port Canaveral. Kennedy Space Center Visitor Complex sells viewing tickets for some launches."),
 ("🌉", "Vandenberg and Starbase", "Vandenberg launches are often visible from many parts of Southern California when the sky is clear. Near Starbase, the road and beach close for launches; follow the local closure notices."),
 ("🚧", "Respect closures", "Stay out of closed roads, beaches and restricted areas, and don't fly drones near launch sites. If you can't be there, the provider's webcast is the best seat."),
]

def launches_page():
    hero_s, list_s = _static_launches()
    tips = "".join(f'<div class="ln-tip"><span aria-hidden="true">{i}</span><h3>{E(t)}</h3><p>{E(d)}</p></div>' for i, t, d in TIPS)
    show = f'''<section class="ln-show" aria-labelledby="ln-show-h"><div class="wrap ln-show-in">{ftl_video("../", "launches", "feel-the-launch")}
<div class="ln-show-t"><span class="kicker">In the app</span><h2 id="ln-show-h">FEEL THE LAUNCH</h2><p>Tap it on a launch card in {APP} for an immersive 3D view of that launch: countdown, liftoff and climb, outside or inside the rocket.</p>
<p class="dim small">Clip: simulated practice run, not a real launch.</p><a class="ln-show-next" href="#ln-next-h">Next launch countdown ↓</a></div></div></section>'''
    h = show + f'''<section class="hero ln-hero"><div class="wrap"><span class="kicker">🚀 Rocket launches</span><h1 id="ln-next-h">Next launch</h1>
<div id="ln-hero">{hero_s or '<p class="ln-empty">Loading the launch schedule…</p>'}</div><p class="ln-age" id="ln-age">Times from the latest schedule snapshot.</p></div></section>'''
    b = f'''<section aria-labelledby="ln-up-h"><h2 id="ln-up-h">Upcoming launches</h2><p class="dim">The next launches around the world, with live countdowns. Times are targets and often change.</p>
<div class="ln-filters" id="ln-filters"></div><div class="ln-list" id="ln-list">{list_s}</div></section>
<section id="pad-weather" aria-labelledby="ln-pw-h"><h2 id="ln-pw-h">🌤️ Weather at the main US launch sites</h2><p class="dim">Latest observations from the airfield nearest each launch site. This is the weather right now, not a launch weather forecast.</p>
<div class="ln-pads" id="ln-pads"><p class="ln-empty">Loading pad weather…</p></div>
<p class="owo-attr"><span id="ln-pads-at"></span>Observations (METAR): <a href="https://aviationweather.gov/" target="_blank" rel="noopener">NOAA Aviation Weather Center</a>. The go/no-go weather call for a launch comes from the launch provider and range weather officers, not from this page.</p></section>
<section aria-labelledby="ln-tips-h"><h2 id="ln-tips-h">🔭 Watching a launch</h2><div class="ln-tips">{tips}</div></section>
<section class="ln-app" aria-labelledby="ln-app-h"><span class="kicker">In the app</span><h2 id="ln-app-h">Launches in {APP}</h2>
<div class="ln-appgrid">
<div class="ln-feats"><div class="ln-feat"><h3>🚀 Rocket launches on the radar map <span class="tag prem">Premium</span></h3><p>Part of the space overlays: pad pins with a T−0 countdown, and the ascent arc once the rocket lifts off. Tap a pad for its launch card.</p></div>
<div class="ln-feat"><h3>🔔 Launch alerts <span class="tag prem">Premium</span></h3><p>A reminder an hour before liftoff, and an alert when the launch is in flight.</p></div>
<div class="ln-feat"><h3>🎢 FEEL THE LAUNCH</h3><p>A button on each launch card (see the clip at the top of this page). It opens an immersive 3D view of that launch in your browser: the countdown, liftoff and climb, from outside or inside the rocket, with a practice run you can try any time.</p></div>
<p class="dim small">Launch cards are on the radar map, which shows launches with the Premium space overlays. Premium is ${PRICE_M}/month or ${PRICE_Y}/year, with a 7-day free trial for new subscribers.</p>
<div class="btns">{play_btn("launches", "primary glow", "app-pitch")}<a class="btn" href="../pricing.html">Compare Free and Premium</a></div></div></div></section>
<p class="owo-attr ln-credit">Launch data: <a href="https://thespacedevs.com/llapi" target="_blank" rel="noopener">Launch Library 2 by The Space Devs</a>, refreshed with each site update (about every 3 hours). Times change often and launches can slip or scrub without notice: check the launch provider for official times and information. Countdowns run in your browser from the snapshot and don't update by themselves when a launch moves. Launch-weather odds appear only when an official launch weather forecast is published.</p>'''
    ld = [{"@context": "https://schema.org", "@type": "WebPage", "name": "Rocket launches: next launch countdown, schedule and pad weather", "url": SITE + "launches/",
           "isPartOf": {"@type": "WebSite", "name": APP, "url": SITE}}]
    page("launches/index.html", "Rocket Launches: Next Launch Countdown, Schedule & Pad Weather",
         "Countdown to the next rocket launch, the upcoming launch schedule worldwide, weather at the main US launch sites and tips for watching a launch.",
         b, h, "0.8", scripts=("launches.js", "teaser.js"), jsonld=ld, head_extra=SHOW_CSS("../"))


if __name__ == "__main__":
    OUTLOOK.build(); build_og(); home(); outlook_page(); features(); pricing(); privacy(); support(); disclosure(); guides(); gear(); ask(); planner("alert-planner/index.html", "plan"); planner("trip-planner/index.html", "trip"); legacy_planners(); go_page(); launches_page(); misc()
    print(f"Built {len(PAGES)} pages")
