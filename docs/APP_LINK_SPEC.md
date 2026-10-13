# App-side link spec: /plan and /trip (NOT implemented in the app yet)

Site side is done: links are `https://weather.yourworldapps.si/plan#v1.<data>` and `https://weather.yourworldapps.si/trip#v1.<data>`,
and `/.well-known/assetlinks.json` (served thanks to `.nojekyll`) names `com.yourworld.weatheranalyzer` with the release signing cert
SHA-256 1B:4D:92:...:43:AE. On Android Chrome the site's "Open in the app" button also uses
`intent://plan#<tok>#Intent;scheme=yourworldweather;package=com.yourworld.weatheranalyzer;S.browser_fallback_url=<Play>;end`.
Without the app, the https link just loads the web page, which shows the plan and a Google Play button.

## 1. Manifest (MainActivity, which is already singleTask): add
```xml
<intent-filter android:autoVerify="true">
    <action android:name="android.intent.action.VIEW" />
    <category android:name="android.intent.category.DEFAULT" />
    <category android:name="android.intent.category.BROWSABLE" />
    <data android:scheme="https" android:host="weather.yourworldapps.si" android:path="/plan" />
    <data android:scheme="https" android:host="weather.yourworldapps.si" android:path="/trip" />
</intent-filter>
<intent-filter>
    <action android:name="android.intent.action.VIEW" />
    <category android:name="android.intent.category.DEFAULT" />
    <category android:name="android.intent.category.BROWSABLE" />
    <data android:scheme="yourworldweather" android:host="plan" />
    <data android:scheme="yourworldweather" android:host="trip" />
</intent-filter>
```
(Optional: add `/plan.html` and `/trip.html` paths too.) Verify after install with
`adb shell pm get-app-links com.yourworld.weatheranalyzer` (it should show `weather.yourworldapps.si: verified`).

## 2. Parse (in the existing deep-link handler, both onCreate and onNewIntent)
- `uri.host == "weather.yourworldapps.si"` with path `/plan` or `/trip`, or scheme `yourworldweather` with host `plan` or `trip`.
- `token = uri.fragment` (encodedFragment). It must start with `v1.`. Otherwise ignore it and open Home.
- Decode: base64url without padding (`Base64.decode(s, URL_SAFE or NO_PADDING or NO_WRAP)`), then **raw** inflate
  (`java.util.zip.Inflater(true)`, nowrap = deflate-raw RFC 1951), then UTF-8 JSON.
- Cap the decoded size (for example at 8 KB) and catch every exception, so a bad link never crashes the app.
- Plan JSON: `{v:1, loc?:String, lat?, lon?, act:GENERAL|HIKE|BOAT|FISH|BEACH|CAMP|EVENT|COMMUTE|FLY|GARDEN, sd:"YYYY-MM-DD", d:1..10, al:[SEVERE|RAIN|LIGHTNING|WIND|HEAT|COLD|SNOW|FLOOD|HURRICANE|MARINE|AIR]}`
- Trip JSON: `{v:1, from?, to?, lat?, lon?, stops?:[≤8 names], sd, d:1..30, act:SIGHTSEEING|HIKE|BEACH|SKI|CAMP|FISH|BOAT|EVENT|BUSINESS|FAMILY, mode:CAR|RV|FLY|BOAT|MOTORCYCLE|BIKE|FOOT}`
- Unknown keys: ignore. Unknown enum values: use the default (GENERAL, SIGHTSEEING or CAR).
- Behavior: geocode `loc`/`to` with the existing city search, then show a confirm sheet ("Add plan: Asheville, NC · Hiking · Oct 17–18 · alerts: ..."),
  which saves it as a saved place plus a watch window with those alert types. Nothing should be saved without a tap.
- The reference implementation is assets/plancodec.js, assets/tripcodec.js and assets/codec-core.js. Test vectors: node _src/tests/quickparse.test.js.

## Site navigation vs. App Links (2026-10-13)
The app claims exactly `/plan`, `/plan.html`, `/trip`, `/trip.html` (android:path). The website's planners therefore live at
`/alert-planner/` and `/trip-planner/` so site navigation never opens the app. Shared plan links still use `/plan#v1.…` and
`/trip#v1.…` (codec-core.js `webUrl`) so they open the app on purpose. The old paths are redirect pages that keep `?q=` and the `#v1.` hash.
Never add an app intent filter (path or pathPrefix) that matches `/alert-planner` or `/trip-planner`.
