# weather.yourworldapps.si: Your World Weather Radar website
Build: `python3 _src/build.py` (writes HTML; refreshes assets/deals.json from the Slickdeals RSS). Tests: `node _src/tests/quickparse.test.js`.
Theme: assets/site.css variables. Planners: plan.html (assets/plan.js + plancodec.js) and trip.html (assets/trip.js + tripcodec.js), both built on wizard.js and quickparse.js.
App links: see docs/APP_LINK_SPEC.md. Hosting: GitHub Pages + CNAME (not set up yet). Pages cache for about 10 minutes, so add ?v=2 to see a fresh copy.
