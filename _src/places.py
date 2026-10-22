#!/usr/bin/env python3
"""Builds assets/places.json for the Trip Planner's destination search, from GeoNames (CC BY 4.0, commercial use allowed
with attribution: https://www.geonames.org/). Run by hand when you want fresher data: python3 _src/places.py
Needs network once (downloads cities5000.zip, admin1CodesASCII.txt, countryInfo.txt into /tmp). Not part of build.py.
Rows: [name, region, countryCode, lat, lon, population, asciiName?] where region is the US state code (e.g. "TN") or the
country name elsewhere. "z"[i] indexes "tz" (IANA time zone of rows[i], used to group MET Norway's UTC forecast into local days). US towns of 3,000+ (from US.zip), US national parks, and places of 75,000+ elsewhere."""
import csv, io, json, urllib.request, zipfile
from pathlib import Path
ROOT = Path(__file__).resolve().parent.parent
TMP = Path("/tmp/geonames"); TMP.mkdir(exist_ok=True)
BASE = "https://download.geonames.org/export/dump/"
def get(name):
    f = TMP / name
    if not f.exists(): f.write_bytes(urllib.request.urlopen(BASE + name, timeout=60).read())
    return f
NPS = {n + " National Park" for n in ("Acadia", "Arches", "Badlands", "Big Bend", "Biscayne", "Black Canyon of the Gunnison", "Bryce Canyon",
    "Canyonlands", "Capitol Reef", "Carlsbad Caverns", "Channel Islands", "Congaree", "Crater Lake", "Cuyahoga Valley", "Death Valley", "Denali",
    "Dry Tortugas", "Everglades", "Gates of the Arctic", "Glacier", "Grand Canyon", "Grand Teton", "Great Basin", "Great Sand Dunes",
    "Great Smoky Mountains", "Guadalupe Mountains", "Haleakala", "Hawai‘i Volcanoes", "Hot Springs", "Isle Royale", "Joshua Tree", "Katmai",
    "Kenai Fjords", "Kings Canyon", "Kobuk Valley", "Lake Clark", "Lassen Volcanic", "Mammoth Cave", "Mesa Verde", "North Cascades", "Olympic",
    "Petrified Forest", "Pinnacles", "Redwood", "Rocky Mountain", "Saguaro", "Sequoia", "Shenandoah", "Theodore Roosevelt", "Voyageurs",
    "Wind Cave", "Wrangell-Saint Elias", "Yellowstone", "Yosemite", "Zion")}
def main():
    countries = {}
    for line in get("countryInfo.txt").read_text(encoding="utf8").splitlines():
        if line and not line.startswith("#"):
            p = line.split("\t"); countries[p[0]] = p[4]
    countries.update({"US": "USA", "GB": "UK", "AE": "UAE"})
    z = zipfile.ZipFile(get("cities5000.zip")); rows = []
    for r in csv.reader(io.TextIOWrapper(z.open("cities5000.txt"), encoding="utf8"), delimiter="\t", quoting=csv.QUOTE_NONE):
        pop, cc = int(r[14] or 0), r[8]
        if r[7] in ("PPLX", "PPLH", "PPLQ", "PPLW"): continue    # city sections, historical, abandoned, destroyed
        if not ((cc == "US" and pop >= 5000) or pop >= 75000): continue
        region = r[10] if cc == "US" else countries.get(cc, cc)
        row = [r[1], region, cc, round(float(r[4]), 3), round(float(r[5]), 3), pop]
        if r[2] and r[2] != r[1]: row.append(r[2])
        rows.append((row, r[17]))
    rows = [x for x in rows if x[0][2] != "US"]
    zu = zipfile.ZipFile(get("US.zip")); parks = {}
    for r in csv.reader(io.TextIOWrapper(zu.open("US.txt"), encoding="utf8"), delimiter="\t", quoting=csv.QUOTE_NONE):
        pop = int(r[14] or 0)
        if r[6] == "P" and r[7] not in ("PPLX", "PPLH", "PPLQ", "PPLW") and pop >= 3000:
            row = [r[1], r[10], "US", round(float(r[4]), 3), round(float(r[5]), 3), pop]
            if r[2] and r[2] != r[1]: row.append(r[2])
            rows.append((row, r[17]))
        elif r[7] == "PRK" and r[1] in NPS and r[1] not in parks:
            parks[r[1]] = ([r[1], r[10], "US", round(float(r[4]), 3), round(float(r[5]), 3), 0], r[17])
    rows += parks.values()
    rows.sort(key=lambda x: -x[0][5])
    tz = sorted({z for _, z in rows}); ti = {z: i for i, z in enumerate(tz)}
    out = ROOT / "assets/places.json"
    out.write_text(json.dumps({"src": "GeoNames (CC BY 4.0) geonames.org", "rows": [r for r, _ in rows], "tz": tz, "z": [ti[z] for _, z in rows]},
                              ensure_ascii=False, separators=(",", ":")))
    print(len(rows), "places,", out.stat().st_size // 1024, "KB")
if __name__ == "__main__": main()
