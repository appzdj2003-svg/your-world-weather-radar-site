#!/usr/bin/env python3
"""Static site builder for Your World Weather Radar. Run: python3 _src/build.py  (writes HTML into the repo root).
Deals: fetched from the Slickdeals RSS at build time into assets/deals.json (keeps the old file if offline)."""
import json, re, html, datetime, urllib.parse, urllib.request, email.utils, sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))
from guides import GUIDES

ROOT = Path(__file__).resolve().parent.parent
SITE = "https://weather.yourworldapps.si/"
PKG = "com.yourworld.weatheranalyzer"
PLAY = f"https://play.google.com/store/apps/details?id={PKG}"
APP = "Your World Weather Radar"
PRICE_M, PRICE_Y = "4.99", "47.99"          # must match Google Play exactly
AMZ_TAG = "yourworldapps-20"
SUPPORT, PRIVACY_MAIL = "support@yourworldapps.si", "appzdj2003@gmail.com"
E = lambda s: html.escape(s, quote=True)
enc = lambda s: urllib.parse.quote(s, safe="")
PAGES = []

NAV = [("index.html", "Home"), ("features.html", "Features"), ("plan.html", "Alert Planner"), ("trip.html", "Trip Planner"),
       ("guides/", "Guides"), ("gear/", "Gear"), ("pricing.html", "Pricing"), ("support.html", "Support")]
PLAY_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M4 2.5v19l16-9.5z"/></svg>'

def play_ref(slug, sec):
    return PLAY + "&referrer=" + enc(f"utm_source=weathersite&utm_medium={slug}&utm_campaign={sec}")
def play_btn(slug, cls="primary", sec="cta", label="Get it on Google Play"):
    return f'<a class="btn {cls}" href="{E(play_ref(slug, sec))}" target="_blank" rel="noopener">{PLAY_SVG}{label}</a>'

def page(path, title, desc, body, hero=None, prio="0.6", scripts=(), jsonld=None, slug=None):
    depth = path.count("/"); p = "../" * depth
    url = SITE + ("" if path == "index.html" else path.replace("index.html", ""))
    cur = path.split("/")[0] + "/" if "/" in path else path
    nav = "".join(f'<a href="{p}{"" if h=="index.html" else h}"{" aria-current=page" if h==cur else ""}>{t}</a>' for h, t in NAV).replace('href=""', 'href="./"')
    slug = slug or (re.sub(r"[^a-z0-9]+", "-", path.replace(".html", "").replace("/index", "")).strip("-") or "home")
    lds = "".join(f'<script type="application/ld+json">{json.dumps(j, ensure_ascii=False)}</script>' for j in (jsonld or []))
    sc = "".join(f'<script src="{p}assets/{s}"></script>' for s in scripts)
    full = title if APP in title else f"{title} | {APP}"
    doc = f'''<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>{E(full)}</title><meta name="description" content="{E(desc)}"><link rel="canonical" href="{url}">
<meta property="og:type" content="website"><meta property="og:site_name" content="{APP}"><meta property="og:title" content="{E(full)}">
<meta property="og:description" content="{E(desc)}"><meta property="og:url" content="{url}"><meta property="og:image" content="{SITE}assets/og-image.png">
<meta name="twitter:card" content="summary_large_image"><meta name="theme-color" content="#0F172A">
<link rel="icon" href="{p}assets/favicon.png"><link rel="apple-touch-icon" href="{p}assets/icon-192.png">
<link rel="stylesheet" href="{p}assets/site.css">{lds}</head><body>
<header class="top"><div class="wrap"><a class="brand" href="{p or './'}"><img src="{p}assets/icon-192.png" width="34" height="34" alt="">{APP}</a><nav class="nav" aria-label="Main">{nav}</nav></div></header>
<main>{hero or ""}<div class="wrap">{body}</div></main>
<footer><div class="wrap"><div class="cols">
<div><h4>{APP}</h4><ul><li><a href="{E(play_ref(slug,"footer"))}" target="_blank" rel="noopener">Get it on Google Play</a></li><li><a href="{p}features.html">Features</a></li><li><a href="{p}pricing.html">Pricing</a></li><li><a href="{p}plan.html">Forecast &amp; Alert Planner</a></li><li><a href="{p}trip.html">Weather Trip Planner</a></li></ul></div>
<div><h4>Weather guides</h4><ul>{"".join(f'<li><a href="{p}guides/{g["slug"]}.html">{E(g["short"])}</a></li>' for g in GUIDES)}</ul></div>
<div><h4>More</h4><ul><li><a href="{p}gear/">Weather gear</a></li><li><a href="{p}support.html">Support</a></li><li><a href="{p}privacy.html">Privacy policy</a></li><li><a href="{p}affiliate-disclosure.html">Affiliate disclosure</a></li></ul></div>
</div><p class="fine">Forecasts and alerts are informational only, not official emergency, marine or aviation advice. Follow the National Weather Service and local officials. As an Amazon Associate I earn from qualifying purchases. &copy; {datetime.date.today().year} Your World Apps. Google Play is a trademark of Google LLC.</p></div></footer>
{sc}</body></html>'''
    doc = re.sub(r'href="' + re.escape(PLAY) + '"', f'href="{E(play_ref(slug, "inline"))}"', doc)
    out = ROOT / path; out.parent.mkdir(parents=True, exist_ok=True); out.write_text(doc)
    if path != "404.html": PAGES.append((url, prio))

def hero(h1, lead="", kicker=None, extra=""):
    return f'<section class="hero"><div class="wrap">{f"<span class=kicker>{E(kicker)}</span>" if kicker else ""}<h1>{E(h1)}</h1>{f"<p class=lead>{lead}</p>" if lead else ""}{extra}</div></section>'

def cta(p, slug, text):
    return f'<div class="cta"><img src="{p}assets/icon-192.png" alt=""><div class="grow"><h3>{APP}</h3><p>{E(text)}</p></div>{play_btn(slug)}</div>'

# ---------- features (from the app source; keep in sync) ----------
FEATURES = [
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

def home():
    h = f'''<section class="hero home"><div class="blip"></div><div class="wrap"><div>
<span class="kicker">⚡ Android · by Your World Apps</span><h1>See the storm before it reaches you.</h1>
<p class="lead">Live radar, National Weather Service alerts, AI briefings, hurricane tracks and nearby weather cams in one clean app. Text your location by satellite when there's no signal.</p>
<div class="btns">{play_btn("home","primary","hero")}<a class="btn ghost" href="plan.html">Plan alerts for a day out →</a></div>
<p class="small" style="color:#94A3B8">No account needed. No ads of our own. No tracking SDKs.</p></div>
<div class="phone"><img src="assets/shot-home.jpg" width="300" height="533" alt="Your World Weather Radar home screen"></div></div></section>'''
    b = f'''<h2>Everything you need when the weather turns</h2><p class="dim">Most of the app is free. Premium adds longer briefings, hurricane and hazard trackers, and Close-One.</p>{feature_cards()}
<div class="split" style="margin-top:40px"><div><h2 style="margin-top:0">An AI briefing for each part of the forecast</h2>
<div class="tabs"><span class="on">NOW</span><span>6–24H</span><span>2D</span><span>3D</span><span>4D</span><span>5D</span><span>7D</span><span>10D</span></div>
<p>Tap a tab and get a short, plain-English summary of that window. Built-in briefings are written on your phone from forecast data. With Premium you can download Gemma to write them on-device, or use your own AI provider key.</p>
<h2>Radar you can actually read</h2><p>Classic rain colors, snow that stays light blue, and a timeline you can scrub. Turn on lightning, hurricane, fire or earthquake layers only when you need them.</p></div>
<div class="shot"><img src="assets/shot-radar.jpg" width="320" height="569" alt="Radar screen" loading="lazy"></div></div>
<div class="split" style="margin-top:20px"><div class="shot"><img src="assets/shot-alerts.jpg" width="320" height="569" alt="Alerts screen" loading="lazy"></div>
<div><h2 style="margin-top:0">Weather cams near you, free</h2><p>Real camera views from USGS, NOAA, Windy.com and <strong>WebCOOS</strong> coastal cams (SECOORA / NOAA IOOS), plus YouTube live streams. Coastal imagery courtesy of WebCOOS.</p>
<h2>Off-Grid Safety, free for everyone</h2><p>When you're out of signal near a severe alert, the app helps you text your saved location to your emergency contacts. If your phone supports satellite texting, it can go out by satellite. Use Emergency SOS or call 911 first. <em>Satellite texting may require a compatible plan. Carrier message and data rates may apply.</em></p></div></div>
<h2>Plan ahead</h2><div class="grid">
<a class="card" href="plan.html" style="text-decoration:none"><div class="ico">🔔</div><h3>Forecast &amp; Alert Planner</h3><p>Tell us the place, activity and dates. You get a link and QR code that open the plan in the app.</p></a>
<a class="card" href="trip.html" style="text-decoration:none"><div class="ico">🧳</div><h3>Weather Trip Planner</h3><p>Destination, dates and how you're traveling, in one link for your phone.</p></a>
<a class="card" href="guides/" style="text-decoration:none"><div class="ico">📚</div><h3>Weather guides</h3><p>Reading radar, watches vs. warnings, hurricanes, lightning and more, sourced from NWS and NOAA.</p></a></div>
{cta("", "home", "Free on Google Play. Premium is $" + PRICE_M + "/month or $" + PRICE_Y + "/year.")}'''
    ld = [{"@context": "https://schema.org", "@type": "MobileApplication", "name": APP, "operatingSystem": "Android", "applicationCategory": "WeatherApplication",
           "author": {"@type": "Organization", "name": "Your World Apps"}, "installUrl": PLAY, "url": SITE,
           "offers": [{"@type": "Offer", "price": "0", "priceCurrency": "USD"}]}]
    page("index.html", f"{APP}: Live Radar, Storm Alerts & AI Briefings", "Live radar, NWS weather alerts, AI briefing tabs, hurricane tracking, free weather cams and Off-Grid Safety satellite texting for Android.", b, h, "1.0", jsonld=ld)

def features():
    b = feature_cards() + f'''<h2>Also in the app</h2><ul>
<li>Forecasts from several weather models, with how much they agree</li><li>Marine data: water temperature, waves, buoys and NOAA tides (Premium)</li>
<li>Aviation, boating and space overlays, including rocket launches (Premium)</li><li>Fire, earthquake and volcano layers (Premium)</li></ul>
<div class="callout">Forecasts and alerts are informational only. They aren't official emergency, marine or aviation advice. Follow the NWS and local officials.</div>{cta("", "features", "Get the free app on Google Play.")}'''
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
    b = '<div class="article" style="margin-top:24px">' + inner + f'<p class="dim small">This page mirrors the policy shown inside the app. Questions or deletion requests: <a href="mailto:{PRIVACY_MAIL}">{PRIVACY_MAIL}</a>.</p></div>'
    page("privacy.html", "Privacy Policy", "Privacy policy for Your World Weather Radar: what leaves your phone, who receives it, and why.", b, hero("Privacy Policy", f"{APP} for Android", "Privacy"), "0.4")

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
def guides():
    cards = "".join(f'<a class="card" href="{g["slug"]}.html" style="text-decoration:none"><div class="ico">{g["emoji"]}</div><h3>{E(g["short"])}</h3><p>{E(g["desc"])}</p></a>' for g in GUIDES)
    page("guides/index.html", "Weather Guides", "Plain-English weather safety guides sourced from the National Weather Service and NOAA.", f'<div class="grid" style="margin-top:24px">{cards}</div>', hero("Weather guides", "Short, practical and sourced from the National Weather Service and NOAA.", "Learn"), "0.8")
    for g in GUIDES:
        src = "".join(f'<li><a href="{u}" target="_blank" rel="noopener">{E(t)}</a></li>' for t, u in g["sources"])
        body = (f'<div class="article"><p class="crumbs"><a href="../">Home</a> / <a href="./">Guides</a> / {E(g["short"])}</p>{g["body"]}'
                f'{cta("../", "guide-" + g["slug"], g["app"])}<h2>Sources</h2><ul class="sources">{src}</ul><p class="dim small">Last reviewed {datetime.date.today():%B %Y}. General information only; follow official guidance in an emergency.</p></div>')
        ld = [{"@context": "https://schema.org", "@type": "Article", "headline": g["title"], "description": g["desc"], "author": {"@type": "Organization", "name": "Your World Apps"},
               "dateModified": datetime.date.today().isoformat(), "mainEntityOfPage": SITE + f'guides/{g["slug"]}.html'}]
        page(f'guides/{g["slug"]}.html', g["title"], g["desc"], body, hero(g["title"], "", "Guide"), "0.7", jsonld=ld)

# ---------- gear ----------
def amz(q): return f"https://www.amazon.com/s?k={enc(q)}&tag={AMZ_TAG}"
GEAR = [
 ("Weather radios", "📻", "NOAA Weather Radio receivers sound an alarm for warnings even with no cell signal.", [
   ("Midland WR120B NOAA Weather Radio", "Desktop alert radio with SAME county coding."),
   ("Midland ER310 emergency crank radio", "Hand-crank and solar NOAA radio with flashlight."),
   ("Eton American Red Cross FRX3 weather radio", "Hand-crank, solar and USB charging."),
   ("Sangean CL-100 weather alert radio", "Tabletop NOAA alert radio with SAME.")]),
 ("Rain gauges", "🌧️", "Measure what actually fell in your yard.", [
   ("Stratus Precision Rain Gauge RG202", "4-inch clear gauge, the type CoCoRaHS volunteers use."),
   ("AcuRite wireless digital rain gauge", "Reads rainfall on an indoor display.")]),
 ("Home weather stations", "🏠", "Your own temperature, wind, rain and pressure readings.", [
   ("Ambient Weather WS-2902 weather station", "Wi-Fi station with outdoor sensor array."),
   ("AcuRite Iris 5-in-1 weather station", "Wind, rain, temperature and humidity sensor."),
   ("Davis Instruments Vantage Vue", "Integrated wireless sensor suite."),
   ("La Crosse Technology wireless weather station", "Indoor display with outdoor sensor.")]),
 ("Outdoor and emergency", "🎒", "For trips past the edge of coverage.", [
   ("Kestrel 3000 pocket weather meter", "Handheld wind, temperature and humidity."),
   ("Garmin inReach Mini 2 satellite communicator", "Two-way satellite messaging (needs a subscription)."),
   ("Anker portable power bank", "Keep your phone charged during outages."),
   ("battery powered LED lantern", "Light for power outages.")]),
]
def gear():
    secs = ""
    for title, em, sub, items in GEAR:
        secs += f'<h2>{em} {E(title)}</h2><p class="dim">{E(sub)}</p><div class="grid">' + "".join(
            f'<div class="card gcard"><h3 style="margin-top:0">{E(n)}</h3><p>{E(d)}</p><a class="btn" href="{E(amz(n))}" target="_blank" rel="sponsored nofollow noopener">See on Amazon →</a></div>' for n, d in items) + "</div>"
    deals = load_deals()
    dl = "".join(f'<div class="deal"><a href="{E(d["link"])}" target="_blank" rel="nofollow noopener">{E(d["title"])}</a><time>{E(d["posted"][:10])}</time></div>' for d in deals[:12])
    dsec = f'<h2>🔥 Weather &amp; emergency deals</h2><p class="dim small">Latest matching headlines from the Slickdeals RSS feed, refreshed when the site is built. Prices and availability change fast.</p><div class="card">{dl}</div>' if dl else ""
    b = ('<p class="disclosure" style="margin-top:22px"><strong>Disclosure:</strong> Links go to Amazon search results for each product. We may earn a commission at no extra cost to you. As an Amazon Associate I earn from qualifying purchases. We don\'t show prices or ratings, so check details on Amazon. <a href="../affiliate-disclosure.html">Details</a></p>'
         + secs + dsec + cta("../", "gear", "Pair your gear with live radar and NWS alerts."))
    page("gear/index.html", "Weather Gear: Radios, Rain Gauges & Home Weather Stations", "NOAA weather radios, rain gauges, home weather stations and emergency gear for storm season.", b, hero("Weather gear", "Radios, gauges and stations worth owning before storm season.", "Gear"), "0.7")

DEAL_KW = ["weather radio", "weather station", "rain gauge", "generator", "power bank", "emergency radio", "lantern", "power station"]
def load_deals():
    f = ROOT / "assets/deals.json"; items = []
    try:
        for kw in DEAL_KW:
            u = "https://slickdeals.net/newsearch.php?mode=frontpage&searcharea=deals&searchin=first&rss=1&q=" + enc(kw)
            x = urllib.request.urlopen(urllib.request.Request(u, headers={"User-Agent": "Mozilla/5.0"}), timeout=15).read().decode("utf-8", "replace")
            for it in re.findall(r"<item>(.*?)</item>", x, re.S)[:4]:
                t = html.unescape(re.sub(r"<!\[CDATA\[|\]\]>", "", re.search(r"<title>(.*?)</title>", it, re.S).group(1))).strip()
                l = html.unescape(re.search(r"<link>(.*?)</link>", it, re.S).group(1)).strip()
                pd = re.search(r"<pubDate>(.*?)</pubDate>", it)
                posted = email.utils.parsedate_to_datetime(pd.group(1)).isoformat() if pd else ""
                if l and not any(i["link"] == l for i in items): items.append({"title": t, "link": l, "posted": posted})
        items.sort(key=lambda i: i["posted"], reverse=True)
        if items: f.write_text(json.dumps({"source": "Slickdeals RSS", "fetchedAt": datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds"), "items": items}, indent=1))
    except Exception as e:
        print("deals fetch failed, keeping cached deals.json:", e)
    return json.loads(f.read_text())["items"] if f.exists() else []

# ---------- planners ----------
def planner(path, kind):
    is_plan = kind == "plan"
    ex = ("Hiking in Asheville, NC this Saturday, warn me about lightning" if is_plan else "Road trip from Atlanta to Nashville Oct 30 - Nov 1")
    title = "Forecast & Alert Planner" if is_plan else "Weather Trip Planner"
    lead = ("Pick a place, what you're doing and when. Get a link and QR code that open the plan in the app." if is_plan
            else "Destination, dates and how you're traveling. Get a link and QR code that open the trip in the app.")
    b = f'''<div class="wiz"><div class="wcard" style="margin-bottom:16px"><h3 style="margin-top:0">⚡ Quick Plan: say it in one sentence</h3>
<div class="quick"><input type="text" id="qtext" placeholder="{E(ex)}" aria-label="Describe your plan"><button class="btn primary" id="qgo">Plan it</button></div>
<p class="note">Try: “{E(ex)}”. Parsed in your browser; nothing is sent anywhere.</p><div class="parsed" id="qout"></div></div>
<div class="wcard"><div class="prog"><i id="prog"></i></div><div id="wiz"></div></div>
<p class="note" style="text-align:center">Don't have the app? {play_btn(path.replace(".html",""), "dark", "planner", "Get it on Google Play")}</p></div>'''
    codec = "plancodec.js" if is_plan else "tripcodec.js"
    page(path, title, lead, b, hero(title, lead, "Planner"), "0.8",
         scripts=("vendor/qrcode.js", "codec-core.js", codec, "quickparse.js", "wizard.js", "plan.js" if is_plan else "trip.js"))

def misc():
    page("404.html", "Page not found", "Page not found.", f'<p style="margin-top:24px">That page isn\'t here. <a href="/">Go home</a>.</p>', hero("Page not found"))
    sm = "".join(f"<url><loc>{u}</loc><lastmod>{datetime.date.today()}</lastmod><priority>{p}</priority></url>" for u, p in PAGES)
    (ROOT / "sitemap.xml").write_text(f'<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">{sm}</urlset>\n')
    (ROOT / "robots.txt").write_text(f"User-agent: *\nAllow: /\nSitemap: {SITE}sitemap.xml\n")

if __name__ == "__main__":
    home(); features(); pricing(); privacy(); support(); disclosure(); guides(); gear(); planner("plan.html", "plan"); planner("trip.html", "trip"); misc()
    print(f"Built {len(PAGES)} pages")
