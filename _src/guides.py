"""SEO guides. Facts only from the official sources listed with each guide."""
NWS = "https://www.weather.gov"
GUIDES = [
dict(slug="how-to-read-weather-radar", short="How to read weather radar", emoji="📡",
 title="How to Read Weather Radar: Colors, dBZ and Storm Shapes",
 desc="A plain-English guide to weather radar: what the colors (dBZ) mean, how to spot heavy rain, hail and rotation, and the limits of radar.",
 body="""
<p>Weather radar sends out pulses of microwave energy and listens for the echo that bounces back off raindrops, snowflakes and hail. In the U.S., the National Weather Service runs a network of about 160 high-resolution Doppler radars called <strong>NEXRAD</strong> (WSR-88D), operated jointly by NOAA's National Weather Service, the FAA and the U.S. Air Force.</p>
<h2>What the colors mean</h2>
<p>Most radar maps show <strong>reflectivity</strong>, measured in dBZ (decibels of Z). The more energy that comes back, the higher the dBZ and the heavier the precipitation is likely to be.</p>
<div class="tbl"><table><tr><th>Reflectivity</th><th>Usual color</th><th>What it often means</th></tr>
<tr><td>Below ~20 dBZ</td><td>Light blue / light green</td><td>Very light rain, drizzle, light snow, or non-weather echoes</td></tr>
<tr><td>20–40 dBZ</td><td>Green to yellow</td><td>Light to moderate rain</td></tr>
<tr><td>40–50 dBZ</td><td>Yellow to orange</td><td>Heavy rain; thunderstorms</td></tr>
<tr><td>50–65 dBZ</td><td>Red</td><td>Very heavy rain, possibly small hail</td></tr>
<tr><td>65+ dBZ</td><td>Magenta / purple / white</td><td>Often hail</td></tr></table></div>
<p class="dim small">Ranges are approximate; color scales differ between apps.</p>
<h2>Shapes worth knowing</h2>
<ul><li><strong>Bow echo:</strong> a line of storms bulging outward like an archer's bow. It often brings damaging straight-line winds at the leading edge.</li>
<li><strong>Hook echo:</strong> a hook-shaped appendage on the back side of a supercell, which can indicate rotation and a possible tornado.</li>
<li><strong>Squall line:</strong> a long, narrow line of storms that can bring a burst of wind and heavy rain as it passes.</li></ul>
<h2>Velocity: seeing the wind</h2>
<p>Doppler radar also measures how fast precipitation moves toward or away from the radar. On velocity maps, green usually means motion toward the radar and red means away. A tight pairing of bright green and bright red side by side, called a <em>velocity couplet</em>, can signal rotation.</p>
<h2>Limits of radar</h2>
<ul><li>The radar beam travels in a straight line while the Earth curves away below it, so far from the radar the beam is high above the ground and can miss low clouds and light precipitation.</li>
<li>Mountains can block the beam.</li>
<li>Birds, insects, dust and ground clutter can show up as echoes, especially near the radar site.</li></ul>
<div class="callout">Radar shows where precipitation <em>is</em>. For official watches and warnings, always follow the National Weather Service and local officials.</div>
""",
 sources=[("NWS JetStream: Doppler radar", NWS + "/jetstream/doppler_intro"), ("NOAA NCEI: NEXRAD", "https://www.ncei.noaa.gov/products/radar/next-generation-weather-radar"), ("NWS: How to read radar (Radar Operations Center)", "https://www.roc.noaa.gov/")],
 app="The app's Radar plays rain past and ahead, keeps snow in light blue, and can add lightning and hurricane layers."),
dict(slug="watch-vs-warning", short="Watch vs. warning", emoji="⚠️",
 title="Watch vs. Warning vs. Advisory: What Weather Alerts Mean",
 desc="What a National Weather Service watch, warning and advisory mean, and what to do for each.",
 body="""
<p>The National Weather Service (NWS) uses three main alert levels. Knowing the difference tells you how much time you have.</p>
<div class="tbl"><table><tr><th>Alert</th><th>Meaning</th><th>What to do</th></tr>
<tr><td><strong>Watch</strong></td><td>Conditions are favorable for the hazard. It may happen, but it isn't happening yet.</td><td><strong>Be prepared.</strong> Review your plan and know where you'd shelter.</td></tr>
<tr><td><strong>Warning</strong></td><td>The hazard is happening or about to happen.</td><td><strong>Take action</strong> now to protect life and property.</td></tr>
<tr><td><strong>Advisory</strong></td><td>A less serious hazard that can still cause significant inconvenience.</td><td><strong>Be aware</strong> and use caution.</td></tr></table></div>
<h2>An easy way to remember</h2>
<p>NWS compares it to cooking: a <em>watch</em> means the ingredients for severe weather are in place; a <em>warning</em> means the recipe is happening now.</p>
<h2>Who issues them</h2>
<ul><li>Tornado and severe thunderstorm <strong>watches</strong> usually come from NOAA's Storm Prediction Center and cover large areas for several hours.</li>
<li><strong>Warnings</strong> come from your local NWS forecast office and are drawn as polygons around the threatened area.</li>
<li>Hurricane watches and warnings come from the National Hurricane Center.</li></ul>
<h2>Getting alerts</h2>
<p>Use more than one way to get warnings: Wireless Emergency Alerts on your phone, NOAA Weather Radio, local media and an alert app. Make sure your phone's emergency alerts are switched on.</p>
""",
 sources=[("NWS: Watch, warning and advisory explained", NWS + "/sjt/WatchWarningAdvisoryExplained"), ("NOAA Storm Prediction Center", "https://www.spc.noaa.gov/"), ("Ready.gov: Emergency alerts", "https://www.ready.gov/alerts")],
 app="The app shows NWS alerts as compact cards, and can notify you in the background."),
dict(slug="hurricane-preparedness", short="Hurricane preparedness", emoji="🌀",
 title="Hurricane Preparedness: Categories, Watches and a Simple Checklist",
 desc="The Saffir-Simpson scale, hurricane watch vs. warning timing, storm surge, and a practical preparedness checklist from NOAA and Ready.gov.",
 body="""
<p>The Atlantic hurricane season runs from <strong>June 1 to November 30</strong>; the eastern Pacific season starts May 15. The National Hurricane Center (NHC) issues forecasts, the forecast cone and watches and warnings.</p>
<h2>Saffir-Simpson Hurricane Wind Scale</h2>
<div class="tbl"><table><tr><th>Category</th><th>Sustained winds</th></tr>
<tr><td>1</td><td>74–95 mph</td></tr><tr><td>2</td><td>96–110 mph</td></tr><tr><td>3 (major)</td><td>111–129 mph</td></tr><tr><td>4 (major)</td><td>130–156 mph</td></tr><tr><td>5 (major)</td><td>157 mph or higher</td></tr></table></div>
<p>The scale covers wind only. Storm surge, rainfall flooding and tornadoes can be deadly at any category.</p>
<h2>Watch vs. warning timing</h2>
<ul><li><strong>Hurricane watch:</strong> hurricane conditions are <em>possible</em>, issued 48 hours before tropical-storm-force winds are expected.</li>
<li><strong>Hurricane warning:</strong> hurricane conditions are <em>expected</em>, issued 36 hours ahead of tropical-storm-force winds.</li></ul>
<h2>The cone is not the impact zone</h2>
<p>The NHC cone shows the probable track of the storm's <em>center</em>. Hazards, including surge and heavy rain, often reach far outside the cone.</p>
<h2>Storm surge</h2>
<p>Storm surge, the abnormal rise of seawater pushed ashore by the storm, has historically been the greatest threat to life along the coast. Know whether you live in an evacuation zone, and leave when local officials tell you to.</p>
<h2>Checklist</h2>
<ul><li>Know your evacuation zone and route.</li><li>Build a kit: water (one gallon per person per day for several days), food, medicines, flashlight, batteries, first aid, a battery or hand-crank radio, chargers.</li>
<li>Copy important documents and keep them waterproof.</li><li>Plan for pets.</li><li>Check insurance, including flood insurance, which often has a waiting period.</li></ul>
""",
 sources=[("NOAA NHC: Saffir-Simpson Hurricane Wind Scale", "https://www.nhc.noaa.gov/aboutsshws.php"), ("NWS: Hurricane preparedness", NWS + "/safety/hurricane"), ("NHC: Storm surge overview", "https://www.nhc.noaa.gov/surge/"), ("Ready.gov: Hurricanes", "https://www.ready.gov/hurricanes"), ("Ready.gov: Build a kit", "https://www.ready.gov/kit")],
 app="The app's hurricane tracker shows the NHC forecast track and cone on the radar map, and a HURRICANE briefing tab appears when a storm is active."),
dict(slug="lightning-safety", short="Lightning safety", emoji="⚡",
 title="Lightning Safety: When Thunder Roars, Go Indoors",
 desc="NWS lightning safety facts: why there's no safe place outside in a thunderstorm, the 30-minute rule, and what to do if you're caught outdoors.",
 body="""
<p>The National Weather Service's message is simple: <strong>When thunder roars, go indoors.</strong> If you can hear thunder, you're close enough to be struck. Lightning can strike as far as 10 miles from the storm.</p>
<h2>Safe shelter</h2>
<ul><li>A substantial building with electricity or plumbing.</li><li>A hard-topped metal vehicle with the windows up.</li></ul>
<p>Picnic shelters, tents, dugouts and open-sided structures do <strong>not</strong> protect you.</p>
<h2>Wait 30 minutes</h2>
<p>Stay inside until <strong>30 minutes after the last thunder</strong> you hear.</p>
<h2>If you're caught outside</h2>
<p>There's no safe place outdoors during a thunderstorm. If you can't reach shelter, NWS advises you to reduce your risk:</p>
<ul><li>Get off elevated areas such as hills, ridges and peaks.</li><li>Never lie flat on the ground, and never shelter under an isolated tree.</li>
<li>Stay away from water, and from objects that conduct electricity, such as wire fences and power lines.</li><li>If you're in a group, spread out.</li></ul>
<h2>Indoors</h2>
<p>Avoid corded phones, plumbing (showers, baths, sinks) and electrical equipment you're touching, and stay away from windows and doors.</p>
<h2>If someone is struck</h2>
<p>Call 911. Lightning victims don't carry an electrical charge and are safe to touch, so start CPR if needed.</p>
""",
 sources=[("NWS: Lightning safety", NWS + "/safety/lightning"), ("NWS: Lightning safety tips", NWS + "/safety/lightning-tips"), ("CDC: Lightning", "https://www.cdc.gov/lightning/")],
 app="The app's lightning layer shows strikes from NOAA satellite lightning data, and it can alert you when lightning is near."),
dict(slug="barometric-pressure-and-weather", short="Barometric pressure", emoji="🧭",
 title="Barometric Pressure and Weather: What Rising and Falling Pressure Means",
 desc="What barometric pressure is, standard sea-level pressure in inHg and hPa, and how pressure trends connect to fair and stormy weather.",
 body="""
<p>Barometric (air) pressure is the weight of the air above you. It's measured in inches of mercury (inHg) in U.S. reports and in hectopascals (hPa), also called millibars (mb), almost everywhere else.</p>
<div class="callout blue"><strong>Standard sea-level pressure:</strong> 29.92 inHg = 1013.25 hPa.</div>
<h2>High and low pressure</h2>
<ul><li><strong>High pressure</strong>: air sinks, which tends to bring drier, more settled weather.</li>
<li><strong>Low pressure</strong>: air rises, cools and condenses, which tends to bring clouds and precipitation. Storms form around low-pressure centers.</li></ul>
<h2>Watch the trend</h2>
<p>The change over a few hours tells you more than a single reading. Steadily <strong>falling</strong> pressure often means an approaching low and worsening weather; <strong>rising</strong> pressure often means clearing. A very rapid drop can signal a strong storm.</p>
<h2>Station vs. sea-level pressure</h2>
<p>Pressure falls as you go higher, so weather reports adjust readings to sea level so places at different elevations can be compared. A home barometer usually needs to be calibrated to your local reported sea-level pressure.</p>
""",
 sources=[("NWS JetStream: Air pressure", NWS + "/jetstream/pressure"), ("NWS JetStream: Highs and lows", NWS + "/jetstream/highlow"), ("NOAA NESDIS: What are high and low pressure systems?", "https://www.nesdis.noaa.gov/about/k-12-education/weather-forecasting/what-are-high-and-low-pressure-systems")],
 app="The app compares several forecast models and shows how much they agree, so you can see how confident a forecast is."),
dict(slug="off-grid-emergency-weather", short="Off-grid emergency weather", emoji="🛰️",
 title="Off-Grid Weather Safety: Staying Informed Without Cell Signal",
 desc="How to get weather warnings and send for help when you're outside cell coverage: NOAA Weather Radio, satellite messaging, and a simple plan.",
 body="""
<p>Hiking, camping, boating and back-road driving can take you out of cell coverage, where Wireless Emergency Alerts and apps can't reach you. Plan for that before you go.</p>
<h2>1. Check before you lose signal</h2>
<p>Look at the forecast and any watches or warnings for every place on your route before you leave coverage. Tell someone where you're going and when you'll be back.</p>
<h2>2. Carry NOAA Weather Radio</h2>
<p>NOAA Weather Radio All Hazards broadcasts NWS warnings, watches and forecasts 24 hours a day from more than 1,000 transmitters, on seven VHF frequencies between <strong>162.400 and 162.550 MHz</strong>. It needs no cell signal. Many radios support SAME codes so they only sound for your county.</p>
<h2>3. Know your phone's satellite features</h2>
<p>Some newer phones can send emergency or text messages by satellite when there's no cell or Wi-Fi signal. Availability depends on the phone model, the carrier, the country and your plan. Check your phone's settings before the trip and try any demo mode it offers. Carrier message and data rates may apply.</p>
<h2>4. Emergency first</h2>
<p>In a life-threatening emergency, call 911 or use your phone's Emergency SOS. In the U.S., you can text 911 in many areas. Where it isn't supported you'll get a bounce-back message, so call if you can.</p>
<h2>5. Pack the basics</h2>
<p>Water, food, layers, a light, a first-aid kit, a power bank and a paper map. Ready.gov's kit list is a good starting point.</p>
""",
 sources=[("NOAA Weather Radio All Hazards", NWS + "/nwr/"), ("FCC: Text to 911", "https://www.fcc.gov/consumers/guides/what-you-need-know-about-text-911"), ("Ready.gov: Build a kit", "https://www.ready.gov/kit"), ("NWS: Weather-Ready Nation", NWS + "/wrn/")],
 app="The app's free Off-Grid Safety tab saves your last location and helps you text it to emergency contacts. If your phone supports it, the text can go by satellite. Carrier message and data rates may apply."),
]

GUIDES += [
dict(slug="flood-safety-turn-around", short="Flood safety", emoji="🌊",
 title="Flood Safety: Turn Around, Don't Drown",
 desc="Why floodwater is so dangerous, how little moving water it takes to sweep away a person or a car, and what NWS says to do.",
 body="""
<p>Flooding is one of the deadliest weather hazards in the United States, and many flood deaths happen in vehicles. The National Weather Service's message is simple: <strong>Turn Around, Don't Drown.</strong></p>
<h2>Why floodwater is so dangerous</h2>
<ul><li>Just <strong>6 inches</strong> of fast-moving water can knock an adult off their feet.</li>
<li><strong>12 inches</strong> of moving water can carry away most cars.</li>
<li><strong>2 feet</strong> of moving water can carry away SUVs and trucks.</li></ul>
<p>You can't tell how deep the water is, or whether the road underneath has washed out.</p>
<h2>What to do</h2>
<ul><li>Never drive around barricades or into flooded roads. Find another route.</li>
<li>Take extra care at night, when flooded roads are harder to see.</li>
<li>During a <strong>Flash Flood Warning</strong>, move to higher ground right away. (For what a watch or a warning means, see <a href="watch-vs-warning.html">Watch vs. warning</a>.)</li>
<li>Stay out of floodwater on foot. It can hide debris, downed power lines and contamination.</li></ul>
""",
 sources=[("NWS: Turn Around Don't Drown", NWS + "/safety/flood-turn-around-dont-drown"), ("NWS: Flood safety", NWS + "/safety/flood"), ("Ready.gov: Floods", "https://www.ready.gov/floods")],
 related=["watch-vs-warning", "weather-emergency-kit", "how-to-read-weather-radar"],
 app="The app shows NWS flood alerts as compact cards, along with rain arrival notifications for your place."),
dict(slug="thunderstorm-lightning-safety", short="Severe thunderstorm safety", emoji="⛈️",
 title="Severe Thunderstorm Safety: Wind, Hail and What 'Severe' Means",
 desc="What makes a thunderstorm 'severe' by NWS criteria, the dangers of straight-line wind and hail, and how to stay safe.",
 body="""
<p>Every thunderstorm produces lightning. For lightning rules, such as when to go indoors and how long to wait, see our <a href="lightning-safety.html">lightning safety guide</a>. This page covers what makes a storm <em>severe</em>.</p>
<h2>What "severe" means</h2>
<p>The National Weather Service calls a thunderstorm severe when it produces at least one of:</p>
<ul><li>Hail <strong>1 inch</strong> in diameter or larger</li><li>Wind gusts of <strong>58 mph</strong> or stronger</li><li>A tornado</li></ul>
<h2>Damaging wind</h2>
<p>Most thunderstorm wind damage comes from straight-line winds, not tornadoes. They can down trees and power lines. On radar, a <a href="how-to-read-weather-radar.html">bow echo</a> is a classic sign.</p>
<h2>During a Severe Thunderstorm Warning</h2>
<ul><li>Go indoors to a sturdy building and stay away from windows.</li><li>Bring in or secure loose outdoor items before the storm if you can.</li>
<li>Don't drive through flooded roads (<a href="flood-safety-turn-around.html">Turn Around, Don't Drown</a>).</li>
<li>If the warning also mentions a possible tornado, follow your <a href="tornado-watch-vs-warning.html">tornado shelter plan</a>.</li></ul>
""",
 sources=[("NWS: Thunderstorm safety", NWS + "/safety/thunderstorm"), ("NOAA SPC: Severe weather FAQ", "https://www.spc.noaa.gov/faq/"), ("Ready.gov: Thunderstorms & lightning", "https://www.ready.gov/thunderstorms-lightning")],
 related=["lightning-safety", "tornado-watch-vs-warning", "how-to-read-weather-radar"],
 app="The app's radar and NWS alert cards help you see a severe storm coming, and the lightning layer shows strikes nearby."),
dict(slug="tornado-watch-vs-warning", short="Tornado safety", emoji="🌪️",
 title="Tornado Safety: Watch vs. Warning and Where to Shelter",
 desc="What a tornado watch and a tornado warning mean, and the safest places to shelter at home, in a mobile home or on the road.",
 body="""
<p>For how watches, warnings and advisories work in general, see <a href="watch-vs-warning.html">Watch vs. warning</a>. Here's what they mean for tornadoes.</p>
<ul><li><strong>Tornado Watch:</strong> conditions are favorable for tornadoes in and near the watch area. Review your plan and be ready to act.</li>
<li><strong>Tornado Warning:</strong> a tornado has been sighted or indicated by weather radar. Take shelter immediately.</li></ul>
<h2>Where to go</h2>
<ul><li>A basement, storm cellar, or the lowest floor of a sturdy building.</li>
<li>No basement? Pick a small interior room with no windows on the lowest floor, such as a closet, a bathroom or an interior hallway.</li>
<li>Get under something sturdy, and cover your head and neck with your arms, a blanket or a helmet.</li>
<li><strong>Mobile homes don't offer protection.</strong> Plan ahead to get to a sturdy building.</li></ul>
<h2>Have more than one way to get warnings</h2>
<p>Don't rely on outdoor sirens alone. Use NOAA Weather Radio, Wireless Emergency Alerts on your phone, local media and apps.</p>
""",
 sources=[("NWS: Tornado safety", NWS + "/safety/tornado"), ("Ready.gov: Tornadoes", "https://www.ready.gov/tornadoes"), ("NOAA SPC", "https://www.spc.noaa.gov/")],
 related=["watch-vs-warning", "thunderstorm-lightning-safety", "weather-emergency-kit"],
 app="The app shows NWS tornado watches and warnings as alert cards and can notify you in the background."),
dict(slug="weather-emergency-kit", short="Emergency kit", emoji="🧰",
 title="Build a Basic Weather Emergency Kit",
 desc="Ready.gov's basic emergency kit checklist for storms and power outages: water, food, radio, light, first aid and more.",
 body="""
<p>Severe storms can knock out power and water for days. Ready.gov recommends a basic kit you can grab quickly.</p>
<h2>Basic kit checklist</h2>
<ul><li><strong>Water:</strong> one gallon per person per day for several days.</li><li><strong>Food:</strong> several days' supply of non-perishable food, and a manual can opener.</li>
<li>A battery-powered or hand-crank radio, and a NOAA Weather Radio with tone alert.</li><li>A flashlight, a first-aid kit and extra batteries.</li>
<li>A whistle to signal for help, and a dust mask.</li><li>Moist towelettes, garbage bags and plastic ties for sanitation.</li>
<li>A wrench or pliers to turn off utilities, and local maps.</li><li>A cell phone with chargers and a backup battery.</li></ul>
<h2>Don't forget</h2>
<p>Prescription medicines, glasses, pet supplies, and copies of important documents. Check your kit and replace expired items regularly.</p>
<p>Shopping ideas: see our <a href="../gear/#emergency">weather gear page</a>.</p>
""",
 sources=[("Ready.gov: Build a kit", "https://www.ready.gov/kit"), ("NOAA Weather Radio", NWS + "/nwr/")],
 related=["hurricane-preparedness", "off-grid-emergency-weather", "tornado-watch-vs-warning"],
 app="The app's free Off-Grid Safety tab helps you text your saved location to emergency contacts, by satellite if your phone supports it. Carrier message and data rates may apply."),
]
REL = {"watch-vs-warning": ["tornado-watch-vs-warning", "thunderstorm-lightning-safety", "flood-safety-turn-around"],
       "lightning-safety": ["thunderstorm-lightning-safety", "off-grid-emergency-weather"],
       "hurricane-preparedness": ["weather-emergency-kit", "flood-safety-turn-around"],
       "how-to-read-weather-radar": ["thunderstorm-lightning-safety", "watch-vs-warning"],
       "barometric-pressure-and-weather": ["how-to-read-weather-radar"],
       "off-grid-emergency-weather": ["weather-emergency-kit", "lightning-safety"]}
for g in GUIDES: g.setdefault("related", REL.get(g["slug"], []))
