/* Flight tracker core (pure logic, no DOM): /flight/open#v1.<data> (app) + /flight# (web page) link codec, flight-number parsing, route legs, geometry,
   METAR/TAF reading, SIGMETs on the route, the rules-based delay estimate, the "how much time do I have" math and the
   transport modes. Node-testable: node _src/tests/flightcore.test.js
   Link data: {v:1, fn:"DL809", d?:"YYYY-MM-DD", dep?, arr?, ndep?: ISO-8601 UTC, from?, to?: IATA/ICAO} */
(function (root) {
  const core = typeof module !== "undefined" ? require("./codec-core.js") : root.YWCore;
  // Airline IATA designator -> ICAO operator (radio callsign prefix). Major carriers only; ICAO input is used as-is.
  const IATA_ICAO = { UA:"UAL", AA:"AAL", DL:"DAL", WN:"SWA", B6:"JBU", AS:"ASA", F9:"FFT", NK:"NKS", SY:"SCX", G4:"AAY", MX:"MXY", XP:"VXP", HA:"HAL",
    OO:"SKW", MQ:"ENY", YX:"RPA", QX:"QXE", YV:"ASH", G7:"GJS", OH:"JIA", PT:"PDT", "9E":"EDV", ZW:"AWI", C5:"UCA", PD:"POE", QK:"JZA", RV:"ROU",
    AC:"ACA", WS:"WJA", TS:"TSC", AM:"AMX", Y4:"VOI", VB:"VIV", AV:"AVA", LA:"LAN", JJ:"TAM", G3:"GLO", AD:"AZU", CM:"CMP",
    BA:"BAW", VS:"VIR", AF:"AFR", KL:"KLM", LH:"DLH", LX:"SWR", OS:"AUA", SN:"BEL", IB:"IBE", VY:"VLG", EI:"EIN", TP:"TAP", AZ:"ITY", SK:"SAS",
    AY:"FIN", DY:"NAX", FI:"ICE", LO:"LOT", A3:"AEE", TK:"THY", FR:"RYR", U2:"EZY", W6:"WZZ", EW:"EWG", DE:"CFG", LS:"EXS", BY:"TOM", UX:"AEA",
    EK:"UAE", QR:"QTR", EY:"ETD", SV:"SVA", ET:"ETH", MS:"MSR", AI:"AIC", SQ:"SIA", CX:"CPA", JL:"JAL", NH:"ANA", KE:"KAL", OZ:"AAR", BR:"EVA", CI:"CAL",
    CA:"CCA", MU:"CES", CZ:"CSN", QF:"QFA", NZ:"ANZ", VA:"VOZ", PR:"PAL", TG:"THA", MH:"MAS", GA:"GIA", FX:"FDX", "5X":"UPS" };
  // Regional airlines that fly under their own callsign for a mainline brand (helps explain "not found").
  const REGIONALS = { DL:["SKW","EDV","RPA"], UA:["SKW","RPA","GJS","ASH","UCA","AWI"], AA:["ENY","JIA","PDT","RPA","SKW","ASH","AWI"], AS:["QXE","SKW"], AC:["JZA"] };
  // Mainline brand for a regional ICAO (canceled → rebook with the marketing carrier).
  const ICAO_MAINLINE = { SKW:["UA","DL","AS"], EDV:["DL"], RPA:["UA","AA","DL"], GJS:["UA"], ASH:["UA","AA"], UCA:["UA"], AWI:["UA","AA"],
    ENY:["AA"], JIA:["AA"], PDT:["AA"], QXE:["AS"], JZA:["AC"], ROU:["AC"] };
  const AIRLINE_NAME = { UA:"United", AA:"American", DL:"Delta", WN:"Southwest", AS:"Alaska", B6:"JetBlue", NK:"Spirit", F9:"Frontier",
    HA:"Hawaiian", SY:"Sun Country", G4:"Allegiant", AC:"Air Canada", OO:"SkyWest", MQ:"Envoy", YX:"Republic", QX:"Horizon" };
  // Airline manage-trip / rebooking pages (public URLs; passenger still signs in on the airline site).
  const AIRLINE_REBOOK = {
    UA: { name: "United", url: "https://www.united.com/en/us/fly/travel/manage-trips.html" },
    AA: { name: "American", url: "https://www.aa.com/reservation/view/findBookingAccess.do" },
    DL: { name: "Delta", url: "https://www.delta.com/mytrips/findPnr" },
    WN: { name: "Southwest", url: "https://www.southwest.com/air/manage-reservation/" },
    AS: { name: "Alaska", url: "https://www.alaskaair.com/booking/reservation-lookup" },
    B6: { name: "JetBlue", url: "https://www.jetblue.com/manage" },
    NK: { name: "Spirit", url: "https://www.spirit.com/en-us/manage" },
    F9: { name: "Frontier", url: "https://www.flyfrontier.com/manage-travel/" },
    HA: { name: "Hawaiian", url: "https://www.hawaiianairlines.com/manage" },
    AC: { name: "Air Canada", url: "https://www.aircanada.com/us/en/aco/home/book/manage-bookings.html" }
  };
  const DOT_REFUNDS = "https://www.transportation.gov/individuals/aviation-consumer-protection/refunds";

  function mainlineIata(p) {
    if (!p) return "";
    if (p.iata && AIRLINE_REBOOK[p.iata]) return p.iata;
    const icao = p.icao || "";
    if (ICAO_MAINLINE[icao]) return ICAO_MAINLINE[icao][0];
    const fromIcao = Object.keys(IATA_ICAO).find(k => IATA_ICAO[k] === icao);
    return fromIcao && AIRLINE_REBOOK[fromIcao] ? fromIcao : (p.iata || "");
  }
  function rebookFor(p) {
    const iata = mainlineIata(p);
    return iata && AIRLINE_REBOOK[iata] ? { iata, ...AIRLINE_REBOOK[iata] } : null;
  }
  function peersForPair(index, fromIcao, toIcao) {
    if (!index || !fromIcao || !toIcao) return [];
    const a = String(fromIcao).toUpperCase(), b = String(toIcao).toUpperCase();
    const fwd = index[a + "-" + b] || [], rev = index[b + "-" + a] || [];
    const seen = new Set(), out = [];
    for (const cs of fwd.concat(rev)) {
      const c = String(cs || "").toUpperCase();
      if (!c || seen.has(c)) continue; seen.add(c);
      const airline = c.slice(0, 3);
      out.push({ cs: c, airline, name: AIRLINE_NAME[Object.keys(IATA_ICAO).find(k => IATA_ICAO[k] === airline) || ""] || airline });
    }
    return out;
  }
  function matchLivePeers(peers, liveList) {
    const by = new Map();
    for (const a of liveList || []) {
      const cs = String(a.flight || a.cs || "").toUpperCase().replace(/\s+/g, "");
      if (!cs) continue;
      by.set(cs, a);
    }
    return (peers || []).map(p => {
      const live = by.get(p.cs);
      if (!live) return { ...p, live: null };
      const alt = live.alt;
      const airborne = alt != null && alt !== "ground" && (+alt > 0);
      return { ...p, live: { airborne, alt, gs: live.gs, lat: live.lat, lon: live.lon } };
    });
  }
  function nearbyAirports(origin, list, maxNm) {
    if (!origin || !isFinite(origin.lat) || !list) return [];
    const lim = maxNm == null ? 100 : maxNm;
    const oi = (origin.icao || "").toUpperCase(), oa = (origin.iata || "").toUpperCase();
    return list.map(a => {
      const nm = distNm(origin, a);
      return { ...a, nm };
    }).filter(a => a.nm > 5 && a.nm <= lim && (a.icao || "").toUpperCase() !== oi && (a.iata || "").toUpperCase() !== oa)
      .sort((x, y) => x.nm - y.nm).slice(0, 6);
  }
  function googleFlightsUrl(fromIata, toIata, dateYmd) {
    const fr = String(fromIata || "").toUpperCase(), to = String(toIata || "").toUpperCase();
    const d = dateYmd || new Date().toISOString().slice(0, 10);
    const q = encodeURIComponent(`Flights from ${fr} to ${to} on ${d} oneway`);
    return `https://www.google.com/travel/flights?q=${q}`;
  }

  // Semi-private / regional carriers with publicly listed airports (IATA). Matched when origin or dest
  // is within ~60 mi of any listed airport. URLs are public booking/home pages — never claim seats.
  // Scheduled regional / semi-private. `routes` are undirected airport pairs from public maps.
  // Show only when a route touches near BOTH origin and dest (~60 mi), or optionally "Gets you closer".
  const SEMI_PRIVATE = [
    { id: "cape_air", name: "Cape Air", kind: "regional", url: "https://www.capeair.com/",
      routes: [
        ["BOS","HYA"],["BOS","ACK"],["BOS","MVY"],["BOS","AUG"],["BOS","BHB"],["BOS","LEB"],["BOS","RKD"],["BOS","RUT"],
        ["BOS","SLK"],["BOS","ISP"],["BOS","PVC"],["HYA","ACK"],["HYA","MVY"],["HYA","JFK"],["ACK","MVY"],["ACK","EWB"],
        ["ACK","JFK"],["MVY","EWB"],["MVY","JFK"],["MVY","HPN"],["LEB","HPN"],["JFK","SLK"],
        ["BIL","GDV"],["BIL","GGW"],["BIL","HVR"],["BIL","OLF"],["BIL","SDY"],
        ["SJU","STT"],["SJU","STX"],["SJU","CPX"],["SJU","VQS"],["SJU","MAZ"],["SJU","EIS"],["SJU","VIJ"],
        ["STT","STX"],["STT","NEV"],["STT","SKB"],["STT","AXA"],["STT","SBH"],["STT","VQS"],["STT","EIS"],
        ["STX","NEV"],["STX","VQS"],["SKB","NEV"],["CPX","VQS"]
      ] },
    { id: "jsx", name: "JSX", kind: "semi-private", url: "https://www.jsx.com/",
      routes: [
        ["BUR","LAS"],["BUR","OAK"],["BUR","SCF"],["BUR","MRY"],["BUR","RNO"],["BUR","SLC"],["BUR","APC"],["BUR","DAL"],["BUR","ABQ"],
        ["LAS","SNA"],["LAS","LAX"],["LAS","OAK"],["LAS","CLD"],["LAS","SCF"],["LAS","SMO"],["LAS","DAL"],["LAS","SLC"],["LAS","CCR"],
        ["SNA","SCF"],["SNA","OAK"],["SNA","MRY"],["SNA","RNO"],["SNA","SLC"],["SNA","APA"],
        ["OAK","CLD"],["CLD","SCF"],["CLD","TSM"],
        ["DAL","HOU"],["DAL","SCF"],["DAL","GUC"],["DAL","TSM"],["DAL","DSI"],["DAL","APA"],["DAL","OPF"],["DAL","CSL"],
        ["SCF","SLC"],["SCF","BJC"],
        ["HPN","OPF"],["HPN","PBI"],["HPN","FXE"],["HPN","APF"],["HPN","BCT"],
        ["TEB","OPF"],["TEB","PBI"],["TEB","FXE"],["MMU","OPF"],["MMU","PBI"],["MMU","APF"],["MMU","BCT"],
        ["LAX","CSL"]
      ] },
    { id: "southern", name: "Southern Airways Express", kind: "regional", url: "https://www.iflysouthern.com/",
      routes: [
        ["LAX","IPL"],["IPL","PHX"],
        ["DFW","HOT"],["DFW","HRO"],["DFW","ELD"],
        ["MEM","HOT"],["MEM","HRO"],["MEM","ELD"],
        ["BNA","JBR"],["STL","JBR"],
        ["PIT","BFD"],["PIT","DUJ"],["IAD","BFD"],["IAD","DUJ"],
        ["HNL","MKK"],["HNL","LUP"],["HNL","JHM"],["HNL","LNY"],
        ["OGG","HNM"],["OGG","MKK"],["OGG","MUE"],["OGG","LNY"],["MKK","LUP"],["MUE","KOA"]
      ] },
    { id: "boutique", name: "Boutique Air", kind: "regional", url: "https://www.boutiqueair.com/",
      routes: [["BOS","MSS"],["PDX","PDT"]] },
    { id: "contour", name: "Contour Airlines", kind: "regional", url: "https://www.contourairlines.com/",
      // Conservative EAS/hub spokes only — no invented cross-country pairs.
      routes: [
        ["BNA","UIN"],["BNA","CGI"],["BNA","TUP"],["BNA","MSL"],
        ["CLT","AOO"],["CLT","LWB"],["CLT","SHD"],
        ["DFW","ELD"],["DFW","GLH"],["DFW","CNM"],
        ["IAD","PBG"],["IAD","PKB"],["IAD","BKW"],
        ["ORD","BRL"],["ORD","IRK"],["ORD","UIN"],["ORD","OWB"],
        ["PHX","SOW"],["PHX","PGA"],["ABQ","CNM"],["ABQ","TSM"],
        ["LAS","VEL"],["LAS","CNY"],["LAX","MCE"]
      ] },
    { id: "advanced", name: "Advanced Air", kind: "regional", url: "https://advancedairlines.com/",
      routes: [
        ["HHR","MMH"],["HHR","CEC"],["HHR","IPL"],
        ["OAK","CEC"],["PHX","GUP"],["PHX","IPL"],
        ["ABQ","AXX"],["ABQ","SVC"],["CLD","MMH"]
      ] },
    { id: "aero", name: "Aero", kind: "semi-private", url: "https://aero.com/",
      // Hub at VNY. Leisure pairs only; omit transcon until TEB service is verified current.
      routes: [
        ["VNY","LAS"],["VNY","APC"],["VNY","ASE"],["VNY","SUN"],["VNY","TRM"],
        ["VNY","SJD"],["VNY","CSL"],["VNY","OGG"]
      ] }
  ];
  // Charter marketplaces. Blade only when near its NYC-area airports; general search always available.
  const CHARTER_OPTS = [
    { id: "blade", name: "Blade", url: "https://www.blade.com/",
      airports: ["JFK","EWR","LGA","HPN","TEB"],
      blurb: "NYC-area airport transfers and charter — check availability on their site." },
    { id: "charter_search", name: "On-demand charter search", url: "https://www.google.com/search?q=private+jet+charter+near+me",
      airports: null,
      blurb: "Compare charter operators near you — pricing is on their sites." }
  ];
  // Amtrak: airport IATA → station code + city. Only claim a corridor when both ends are in AMTRAK_ROUTES.
  const AMTRAK_NEAR = {    BOS: { stn: "BOS", city: "Boston" }, PVD: { stn: "PVD", city: "Providence" },
    BDL: { stn: "NYP", city: "New York" }, // Hartford trains continue; use NYP corridor carefully — map HFD separately
    HFD: { stn: "HFD", city: "Hartford" }, NHV: { stn: "NHV", city: "New Haven" },
    JFK: { stn: "NYP", city: "New York" }, LGA: { stn: "NYP", city: "New York" }, EWR: { stn: "NYP", city: "New York" },
    TEB: { stn: "NYP", city: "New York" }, HPN: { stn: "NYP", city: "New York" }, ISP: { stn: "NYP", city: "New York" },
    PHL: { stn: "PHL", city: "Philadelphia" }, BWI: { stn: "BAL", city: "Baltimore" },
    DCA: { stn: "WAS", city: "Washington" }, IAD: { stn: "WAS", city: "Washington" }, WAS: { stn: "WAS", city: "Washington" },
    RIC: { stn: "RVR", city: "Richmond" }, ORF: { stn: "NFK", city: "Norfolk" },
    CLT: { stn: "CLT", city: "Charlotte" }, RDU: { stn: "RGH", city: "Raleigh" },
    ATL: { stn: "ATL", city: "Atlanta" }, SAV: { stn: "SAV", city: "Savannah" }, JAX: { stn: "JAX", city: "Jacksonville" },
    TPA: { stn: "TPA", city: "Tampa" }, MIA: { stn: "MIA", city: "Miami" }, FLL: { stn: "FTL", city: "Fort Lauderdale" },
    MSY: { stn: "NOL", city: "New Orleans" }, MEM: { stn: "MEM", city: "Memphis" }, BNA: { stn: "NASH", city: "Nashville" },
    CHI: { stn: "CHI", city: "Chicago" }, ORD: { stn: "CHI", city: "Chicago" }, MDW: { stn: "CHI", city: "Chicago" },
    DET: { stn: "DET", city: "Detroit" }, DTW: { stn: "DET", city: "Detroit" }, CLE: { stn: "CLE", city: "Cleveland" },
    PIT: { stn: "PGH", city: "Pittsburgh" }, CMH: { stn: "COL", city: "Columbus" },
    STL: { stn: "STL", city: "St. Louis" }, KAN: { stn: "KCY", city: "Kansas City" }, MCI: { stn: "KCY", city: "Kansas City" },
    MSP: { stn: "MSP", city: "Minneapolis" }, DEN: { stn: "DEN", city: "Denver" },
    ABQ: { stn: "ABQ", city: "Albuquerque" }, PHX: { stn: "PHX", city: "Phoenix" },
    LAX: { stn: "LAX", city: "Los Angeles" }, BUR: { stn: "BUR", city: "Burbank" }, SNA: { stn: "IRV", city: "Irvine" },
    SAN: { stn: "SAN", city: "San Diego" }, SBA: { stn: "SBA", city: "Santa Barbara" },
    SFO: { stn: "SFC", city: "San Francisco" }, OAK: { stn: "OKJ", city: "Oakland" }, SJC: { stn: "SJC", city: "San Jose" },
    SAC: { stn: "SAC", city: "Sacramento" }, SMF: { stn: "SAC", city: "Sacramento" },
    PDX: { stn: "PDX", city: "Portland" }, SEA: { stn: "SEA", city: "Seattle" },
    DAL: { stn: "DAL", city: "Dallas" }, DFW: { stn: "DAL", city: "Dallas" }, AUS: { stn: "AUS", city: "Austin" },
    HOU: { stn: "HOU", city: "Houston" }, IAH: { stn: "HOU", city: "Houston" }, SAT: { stn: "SAS", city: "San Antonio" },
    MSY: { stn: "NOL", city: "New Orleans" }
  };
  // Verified Amtrak corridors (station codes). Pair is unordered.
  const AMTRAK_ROUTES = [
    { a: "BOS", b: "NYP", name: "Northeast Corridor" },
    { a: "NYP", b: "PHL", name: "Northeast Corridor" },
    { a: "NYP", b: "WAS", name: "Northeast Corridor" },
    { a: "PHL", b: "WAS", name: "Northeast Corridor" },
    { a: "BAL", b: "WAS", name: "Northeast Corridor" },
    { a: "BAL", b: "NYP", name: "Northeast Corridor" },
    { a: "WAS", b: "RVR", name: "Northeast Corridor / Carolinian" },
    { a: "WAS", b: "CLT", name: "Carolinian / Crescent" },
    { a: "NYP", b: "CHI", name: "Lake Shore Limited" },
    { a: "BOS", b: "CHI", name: "Lake Shore Limited" },
    { a: "CHI", b: "STL", name: "Lincoln Service" },
    { a: "CHI", b: "MSP", name: "Empire Builder / Borealis" },
    { a: "CHI", b: "DEN", name: "California Zephyr / Southwest Chief" },
    { a: "CHI", b: "NOL", name: "City of New Orleans" },
    { a: "CHI", b: "DET", name: "Wolverine" },
    { a: "DEN", b: "SFC", name: "California Zephyr" },
    { a: "LAX", b: "SFC", name: "Coast Starlight / Pacific Surfliner connections" },
    { a: "LAX", b: "SAN", name: "Pacific Surfliner" },
    { a: "LAX", b: "ABQ", name: "Southwest Chief" },
    { a: "SEA", b: "PDX", name: "Cascades" },
    { a: "SEA", b: "SFC", name: "Coast Starlight" },
    { a: "PDX", b: "SFC", name: "Coast Starlight" },
    { a: "NYP", b: "MIA", name: "Silver Service" },
    { a: "WAS", b: "MIA", name: "Silver Service" },
    { a: "NYP", b: "NOL", name: "Crescent" },
    { a: "DAL", b: "CHI", name: "Texas Eagle" },
    { a: "DAL", b: "SAS", name: "Texas Eagle" },
    { a: "SAS", b: "LAX", name: "Sunset Limited / Texas Eagle" },
    { a: "NOL", b: "LAX", name: "Sunset Limited" },
    { a: "SAC", b: "SFC", name: "Capitol Corridor" },
    { a: "OKJ", b: "SAC", name: "Capitol Corridor" },
    { a: "BUR", b: "SAN", name: "Pacific Surfliner" },
    { a: "IRV", b: "LAX", name: "Pacific Surfliner" }
  ];

  // Coords for carrier airports not in airports-na.json (public FAA/ourairports).
  const EXTRA_AIRPORTS = [
    { iata: "TEB", icao: "KTEB", name: "Teterboro", lat: 40.8501, lon: -74.0608 },
    { iata: "VNY", icao: "KVNY", name: "Van Nuys", lat: 34.2098, lon: -118.490 },
    { iata: "APC", icao: "KAPC", name: "Napa County", lat: 38.2132, lon: -122.281 },
    { iata: "SMO", icao: "KSMO", name: "Santa Monica", lat: 34.0158, lon: -118.451 },
    { iata: "HHR", icao: "KHHR", name: "Hawthorne Municipal", lat: 33.9228, lon: -118.335 },
    { iata: "MSS", icao: "KMSS", name: "Massena International", lat: 44.9358, lon: -74.8455 },
    { iata: "PDT", icao: "KPDT", name: "Eastern Oregon Regional", lat: 45.6951, lon: -118.841 },
    { iata: "MMU", icao: "KMMU", name: "Morristown Municipal", lat: 40.7994, lon: -74.4149 },
    { iata: "BFD", icao: "KBFD", name: "Bradford Regional", lat: 41.8031, lon: -78.6401 },
    { iata: "HOT", icao: "KHOT", name: "Memorial Field Hot Springs", lat: 34.4780, lon: -93.0962 }
  ];
  function airportIndex(list) {
    const by = {};
    for (const a of EXTRA_AIRPORTS.concat(list || [])) {
      if (a.iata) by[String(a.iata).toUpperCase()] = a;
      if (a.icao) by[String(a.icao).toUpperCase()] = a;
    }
    return by;
  }
  function resolveApt(code, by, tips) {
    const c = String(code || "").toUpperCase();
    if (by[c]) return by[c];
    if (by["K" + c]) return by["K" + c];
    for (const p of tips || []) {
      if (!p) continue;
      if ((p.iata || "").toUpperCase() === c) return p;
      if ((p.icao || "").toUpperCase() === c || (p.icao || "").toUpperCase() === "K" + c) return p;
    }
    return null;
  }
  function carrierAirports(c) {
    const set = new Set();
    for (const r of c.routes || []) { if (r[0]) set.add(String(r[0]).toUpperCase()); if (r[1]) set.add(String(r[1]).toUpperCase()); }
    for (const a of c.airports || []) if (a) set.add(String(a).toUpperCase());
    return [...set];
  }
  function nearTip(tip, code, by, limNm) {
    if (!tip || !isFinite(tip.lat)) return null;
    const tipI = (tip.iata || "").toUpperCase(), tipK = (tip.icao || "").replace(/^K/i, "").toUpperCase();
    if (tipI === code || tipK === code) return { code, nm: 0, mi: 0, near: tipI || tip.icao, name: tip.name };
    const apt = resolveApt(code, by, [tip]);
    if (!apt || !isFinite(apt.lat)) return null;
    const nm = distNm(tip, apt);
    if (nm > limNm) return null;
    return { code, nm, mi: nm * 1.15078, near: tipI || tip.icao, name: apt.name };
  }
  // One-end proximity (Blade / legacy). Prefer carrierForRoute for scheduled carriers.
  function carriersNear(origin, dest, carriers, airportsList, maxMi) {
    const lim = (maxMi == null ? 60 : maxMi) / 1.15078;
    const by = airportIndex(airportsList);
    return (carriers || []).filter(c => {
      for (const code of carrierAirports(c)) {
        if (nearTip(origin, code, by, lim) || nearTip(dest, code, by, lim)) return true;
      }
      return false;
    }).map(c => {
      let best = null;
      for (const code of carrierAirports(c)) {
        for (const tip of [origin, dest]) {
          const hit = nearTip(tip, code, by, 1e9);
          if (hit && (!best || hit.nm < best.nm)) best = hit;
        }
      }
      return { ...c, nearest: best };
    });
  }
  // Scheduled carrier for a trip: both-ends route match, else optional "Gets you closer" hop.
  function carriersForRoute(origin, dest, carriers, airportsList, maxMi) {
    const lim = (maxMi == null ? 60 : maxMi) / 1.15078;
    const by = airportIndex(airportsList);
    if (!origin || !dest || !isFinite(origin.lat) || !isFinite(dest.lat)) return { match: [], closer: [] };
    const tripNm = distNm(origin, dest);
    const match = [], closer = [];
    for (const c of carriers || []) {
      const routes = c.routes || [];
      let bestBoth = null, bestCloser = null;
      for (const r of routes) {
        const a = String(r[0] || "").toUpperCase(), b = String(r[1] || "").toUpperCase();
        if (!a || !b) continue;
        // Direct alternative: one end near origin, other near dest (either orientation).
        const oA = nearTip(origin, a, by, lim), dB = nearTip(dest, b, by, lim);
        const oB = nearTip(origin, b, by, lim), dA = nearTip(dest, a, by, lim);
        if (oA && dB) {
          const score = oA.nm + dB.nm;
          if (!bestBoth || score < bestBoth.score)
            bestBoth = { score, from: oA, to: dB, pair: a + "–" + b };
        }
        if (oB && dA) {
          const score = oB.nm + dA.nm;
          if (!bestBoth || score < bestBoth.score)
            bestBoth = { score, from: oB, to: dA, pair: b + "–" + a };
        }
        // Gets you closer: hop from near origin lands ≥50% closer to dest.
        if (tripNm > 0) {
          for (const [oHit, landCode] of [[oA, b], [oB, a]]) {
            if (!oHit) continue;
            const land = resolveApt(landCode, by, [dest]);
            if (!land || !isFinite(land.lat)) continue;
            const rem = distNm(land, dest);
            if (rem <= tripNm * 0.5) {
              const cut = 1 - rem / tripNm;
              if (!bestCloser || cut > bestCloser.cut)
                bestCloser = { cut, from: oHit, land: { code: landCode, nm: rem, mi: rem * 1.15078 }, pair: oHit.code + "→" + landCode };
            }
          }
        }
      }
      if (bestBoth) {
        match.push({ ...c, nearest: bestBoth.from, other: bestBoth.to, via: bestBoth.pair, role: "match" });
      } else if (bestCloser) {
        closer.push({ ...c, nearest: bestCloser.from, land: bestCloser.land, via: bestCloser.pair, role: "closer", cutPct: Math.round(bestCloser.cut * 100) });
      }
    }
    return { match, closer };
  }
  function charterNear(origin, dest, airportsList, maxMi) {
    const always = CHARTER_OPTS.filter(c => !c.airports);
    const gated = carriersNear(origin, dest, CHARTER_OPTS.filter(c => c.airports), airportsList, maxMi);
    return gated.concat(always);
  }

  // Drive vs next-flight estimate. Road ≈ 1.25 × GC at 60 mph. No OSRM / paid APIs.
  const DRIVE_ROAD = 1.25, DRIVE_MPH = 60, AIRPORT_OVERHEAD_MIN = 90, REBOOK_WAIT_MIN = [240, 360];
  function driveVsFly(origin, dest, opts) {
    opts = opts || {};
    if (!origin || !dest || !isFinite(origin.lat) || !isFinite(dest.lat)) return null;
    const gcNm = distNm(origin, dest), gcMi = gcNm * 1.15078;
    const roadMi = gcMi * DRIVE_ROAD;
    const driveMin = Math.round(roadMi / DRIVE_MPH * 60);
    // Cruise ~450 mph → nm/min ≈ 7.5
    const flightMin = Math.max(25, Math.round(gcNm / 7.5));
    let waitMin = opts.nextFlightWaitMin;
    if (waitMin == null || !isFinite(waitMin)) waitMin = Math.round((REBOOK_WAIT_MIN[0] + REBOOK_WAIT_MIN[1]) / 2);
    const overheadMin = AIRPORT_OVERHEAD_MIN;
    const flyTotal = waitMin + flightMin + overheadMin;
    const delta = driveMin - flyTotal;
    return {
      gcMi: Math.round(gcMi), roadMi: Math.round(roadMi), driveMin, flightMin, waitMin, overheadMin, flyTotal,
      driveFaster: driveMin <= flyTotal, withinHour: Math.abs(delta) <= 60,
      showDrive: driveMin <= flyTotal + 60, hide: driveMin > flyTotal + 180,
      mapsUrl: `https://www.google.com/maps/dir/?api=1&origin=${origin.lat},${origin.lon}&destination=${dest.lat},${dest.lon}&travelmode=driving`
    };
  }
  function amtrakFor(origin, dest) {
    const oa = (origin && (origin.iata || "")).toUpperCase(), da = (dest && (dest.iata || "")).toUpperCase();
    const A = AMTRAK_NEAR[oa], B = AMTRAK_NEAR[da];
    const q = encodeURIComponent(`${(A && A.city) || oa} to ${(B && B.city) || da}`);
    const searchUrl = `https://www.amtrak.com/home.html?q=${q}`;
    if (!A || !B || A.stn === B.stn) return { linked: !!(A || B), route: null, searchUrl, cityA: A && A.city, cityB: B && B.city };
    const hit = AMTRAK_ROUTES.find(r => (r.a === A.stn && r.b === B.stn) || (r.a === B.stn && r.b === A.stn));
    return { linked: true, route: hit ? hit.name : null, searchUrl, cityA: A.city, cityB: B.city };
  }

  function parseFlight(s) {
    s = String(s || "").toUpperCase().replace(/[\s\-]/g, "");
    let m;
    m = s.match(/^([A-Z0-9]{2})(\d{1,4})([A-Z]?)$/);
    if (m && /[A-Z]/.test(m[1])) { const icao = IATA_ICAO[m[1]]; if (!icao) return { fn: s, iata: m[1], num: String(+m[2]) + m[3], unknownAirline: true };
      return { fn: s, iata: m[1], icao, num: String(+m[2]) + m[3], cs: icao + (+m[2]) + m[3] }; }
    m = s.match(/^([A-Z]{3})(\d{1,4})([A-Z]?)$/);
    if (m) return { fn: s, icao: m[1], num: String(+m[2]) + m[3], cs: m[1] + (+m[2]) + m[3], iata: Object.keys(IATA_ICAO).find(k => IATA_ICAO[k] === m[1]) || "" };
    return null;
  }
  const isIso = s => typeof s === "string" && isFinite(Date.parse(s)) && /^\d{4}-\d{2}-\d{2}T/.test(s);
  const isApt = s => /^[A-Z0-9]{3,4}$/.test(s || "");
  function validate(t) {
    if (!t || t.v !== 1) throw new Error("Unsupported flight link version");
    t.fn = String(t.fn || "").toUpperCase().replace(/\s/g, "");
    if (!parseFlight(t.fn)) throw new Error("Missing flight number");
    if (!core.isDate(t.d)) delete t.d;
    for (const k of ["dep", "arr", "ndep"]) if (!isIso(t[k])) delete t[k];
    for (const k of ["from", "to"]) { if (t[k]) t[k] = String(t[k]).toUpperCase(); if (!isApt(t[k])) delete t[k]; }
    // Optional open-in-app extras (ignored by the web UI when absent).
    if (t.cs) { t.cs = String(t.cs).toUpperCase().replace(/\s/g, ""); if (!t.cs) delete t.cs; } else delete t.cs;
    for (const k of ["lat", "lon", "alt"]) {
      if (t[k] == null || t[k] === "") { delete t[k]; continue; }
      const n = +t[k];
      if (!isFinite(n)) { delete t[k]; continue; }
      if (k === "lat" && (n < -90 || n > 90)) { delete t[k]; continue; }
      if (k === "lon" && (n < -180 || n > 180)) { delete t[k]; continue; }
      t[k] = n;
    }
    if (t.lat == null || t.lon == null) { delete t.lat; delete t.lon; }
    return t;
  }

  // ---------- geometry ----------
  const R = 3440.065, rad = d => d * Math.PI / 180, deg = r => r * 180 / Math.PI;   // R in nautical miles
  function distNm(a, b) { const dl = rad(b.lat - a.lat), dn = rad(b.lon - a.lon);
    const h = Math.sin(dl / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dn / 2) ** 2; return 2 * R * Math.asin(Math.min(1, Math.sqrt(h))); }
  function bearing(a, b) { const y = Math.sin(rad(b.lon - a.lon)) * Math.cos(rad(b.lat)), x = Math.cos(rad(a.lat)) * Math.sin(rad(b.lat)) - Math.sin(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.cos(rad(b.lon - a.lon));
    return (deg(Math.atan2(y, x)) + 360) % 360; }
  function gcPoints(a, b, n) { const out = [], d = distNm(a, b) / R; if (d < 1e-6) return [a, b];
    for (let i = 0; i <= n; i++) { const f = i / n, A = Math.sin((1 - f) * d) / Math.sin(d), B = Math.sin(f * d) / Math.sin(d);
      const x = A * Math.cos(rad(a.lat)) * Math.cos(rad(a.lon)) + B * Math.cos(rad(b.lat)) * Math.cos(rad(b.lon));
      const y = A * Math.cos(rad(a.lat)) * Math.sin(rad(a.lon)) + B * Math.cos(rad(b.lat)) * Math.sin(rad(b.lon)), z = A * Math.sin(rad(a.lat)) + B * Math.sin(rad(b.lat));
      out.push({ lat: deg(Math.atan2(z, Math.hypot(x, y))), lon: deg(Math.atan2(y, x)) }); } return out; }
  const angDiff = (a, b) => { const d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d; };
  function inPoly(p, poly) { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const [yi, xi] = poly[i], [yj, xj] = poly[j];
    if ((yi > p.lat) !== (yj > p.lat) && p.lon < (xj - xi) * (p.lat - yi) / (yj - yi) + xi) c = !c; } return c; }

  // Point reached from p after nm nautical miles on an initial bearing (great circle).
  function destPt(p, brg, nm) { const d = nm / R, b = rad(brg), la = rad(p.lat), lo = rad(p.lon);
    const la2 = Math.asin(Math.sin(la) * Math.cos(d) + Math.cos(la) * Math.sin(d) * Math.cos(b));
    const lo2 = lo + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(la), Math.cos(d) - Math.sin(la) * Math.sin(la2));
    return { lat: la2 * 180 / Math.PI, lon: ((lo2 * 180 / Math.PI + 540) % 360) - 180 }; }
  // Dead reckoning between live fixes: carry the last reported position forward at its reported speed and track.
  // Capped (default 90 s) so a stale fix is never stretched into a guess; on the ground we don't move it.
  function project(ac, nowMs, maxSec) {
    if (!ac || !isFinite(ac.lat) || !isFinite(ac.lon)) return null; const at = ac.seenAt || ac.fixAt || nowMs;
    const sec = Math.max(0, Math.min(maxSec || 90, (nowMs - at) / 1000));
    if (ac.alt === "ground" || !isFinite(ac.gs) || ac.gs < 40 || !isFinite(ac.track) || !sec) return { lat: ac.lat, lon: ac.lon, sec, moved: false };
    return { ...destPt(ac, ac.track, ac.gs * sec / 3600), sec, moved: true }; }

  // Official display names when open datasets still use a retired name (IATA / ICAO).
  // Only entries verified against the airport authority / FAA / state DOT.
  const APT_NAME = {
    LAS: "Harry Reid International Airport", KLAS: "Harry Reid International Airport",
    CMH: "John Glenn Columbus International Airport", KCMH: "John Glenn Columbus International Airport",
    SDF: "Louisville Muhammad Ali International Airport", KSDF: "Louisville Muhammad Ali International Airport",
    HNL: "Daniel K. Inouye International Airport", PHNL: "Daniel K. Inouye International Airport",
    ICT: "Wichita Dwight D. Eisenhower National Airport", KICT: "Wichita Dwight D. Eisenhower National Airport",
    LIT: "Bill and Hillary Clinton National Airport", KLIT: "Bill and Hillary Clinton National Airport",
    ATW: "Appleton International Airport", KATW: "Appleton International Airport",
    BZN: "Bozeman Yellowstone International Airport", KBZN: "Bozeman Yellowstone International Airport"
  };
  function applyAptName(apt) {
    if (!apt) return apt;
    const n = APT_NAME[apt.iata] || APT_NAME[apt.icao];
    return n && apt.name !== n ? { ...apt, name: n } : apt;
  }

  // ---------- route legs (adsb.lol / VRS standing data, CC0) ----------
  function legs(routeJson) {
    const a = (routeJson && routeJson._airports || []).filter(x => isFinite(x.lat) && isFinite(x.lon)).map(applyAptName);
    const out = []; for (let i = 0; i + 1 < a.length; i++) out.push({ from: a[i], to: a[i + 1], i }); return out;
  }
  const aptMatch = (apt, code) => !!code && !!apt && (apt.iata === code || apt.icao === code);
  // Which leg is the plane flying now? Closest to the leg line, heading roughly toward its destination.
  function liveLeg(L, ac) {
    if (!ac || !L.length) return null; let best = null;
    for (const l of L) { const p = { lat: ac.lat, lon: ac.lon }, toD = distNm(p, l.to), fromD = distNm(p, l.from), len = distNm(l.from, l.to);
      const off = toD + fromD - len, head = isFinite(ac.track) ? angDiff(ac.track, bearing(p, l.to)) : 0;
      const score = off + (head > 100 ? 400 : head * 0.5); if (!best || score < best.score) best = { leg: l, score }; }
    return best.leg;
  }
  function userLeg(L, from, to) {
    return L.find(l => (!from || aptMatch(l.from, from)) && (!to || aptMatch(l.to, to)) && (from || to)) || null;
  }

  // ---------- weather ----------
  const WX = [["TS", "thunderstorms"], ["FZRA", "freezing rain"], ["FZDZ", "freezing drizzle"], ["FZFG", "freezing fog"], ["SN", "snow"], ["PL", "ice pellets"], ["GR", "hail"],
    ["GS", "small hail"], ["FG", "fog"], ["SQ", "squalls"], ["FC", "funnel cloud"], ["VA", "volcanic ash"], ["DS", "dust storm"], ["SS", "sandstorm"], ["RA", "rain"], ["DZ", "drizzle"], ["BR", "mist"], ["HZ", "haze"], ["FU", "smoke"]];
  function wxWords(str) { const out = [];
    for (const tok of String(str || "").split(/\s+/).filter(Boolean)) { let first = true;
      for (const [c, w] of WX) if (tok.replace(/^[-+]/, "").includes(c) && !(c === "RA" && /FZRA/.test(tok)) && !(c === "DZ" && /FZDZ/.test(tok)) && !(c === "FG" && /FZFG/.test(tok))) {
        const word = (tok[0] === "+" && first ? "heavy " : "") + (/^[-+]?VC/.test(tok) ? "nearby " : "") + w; first = false;
        if (!out.some(o => o.endsWith(w))) out.push(word); } }
    return out; }
  const visNum = v => { if (v === undefined || v === null || v === "") return null; if (typeof v === "number") return v; const s = String(v).replace("+", "");
    if (/^\d+\/\d+$/.test(s)) { const [a, b] = s.split("/"); return a / b; } const n = parseFloat(s); return isFinite(n) ? n : null; };
  const ceiling = clouds => { let c = null; for (const k of clouds || []) if (/BKN|OVC|OVX|VV/.test(k.cover) && isFinite(k.base)) c = c === null ? k.base : Math.min(c, k.base); return c; };
  function fltCat(vis, ceil) { if ((vis !== null && vis < 1) || (ceil !== null && ceil < 500)) return "LIFR";
    if ((vis !== null && vis < 3) || (ceil !== null && ceil < 1000)) return "IFR"; if ((vis !== null && vis <= 5) || (ceil !== null && ceil <= 3000)) return "MVFR"; return "VFR"; }
  // Read a raw METAR string (used when only NWS observations are available).
  function readMetar(raw) {
    raw = String(raw || ""); const body = raw.split(" RMK")[0], t = body.split(/\s+/);
    let vis = null, gust = null, wind = null; const clouds = [];
    for (const x of t) { let m;
      if ((m = x.match(/^(\d{3}|VRB)(\d{2,3})(G(\d{2,3}))?KT$/))) { wind = +m[2]; gust = m[4] ? +m[4] : null; }
      else if ((m = x.match(/^(M)?(\d+)?(\/)?(\d+)?SM$/))) { vis = m[3] ? (m[2] && m[4] ? m[2] / m[4] : null) : +m[2]; if (m[1] && vis !== null) vis = Math.min(vis, 0.24); }
      else if ((m = x.match(/^(FEW|SCT|BKN|OVC|VV)(\d{3})/))) clouds.push({ cover: m[1], base: +m[2] * 100 }); }
    const wxs = t.filter(x => /^[-+]?(VC)?(MI|PR|BC|DR|BL|SH|TS|FZ)?(DZ|RA|SN|SG|IC|PL|GR|GS|UP|BR|FG|FU|VA|DU|SA|HZ|PO|SQ|FC|SS|DS)+$|^[-+]?(VC)?TS$/.test(x)).join(" ");
    const vis2 = / (\d+) (\d)\/(\d)SM/.exec(body); if (vis2) vis = +vis2[1] + vis2[2] / vis2[3];
    return { raw, vis, wind, gust, clouds, wxString: wxs, fltCat: fltCat(vis, ceiling(clouds)) };
  }
  function fromAwcMetar(m) { if (!m) return null; const r = readMetar(m.rawOb);
    return { raw: m.rawOb, obsTime: m.obsTime ? m.obsTime * 1000 : null, temp: m.temp, wind: m.wspd ?? r.wind, gust: m.wgst ?? r.gust, vis: visNum(m.visib) ?? r.vis,
      wxString: m.wxString || r.wxString, fltCat: m.fltCat || r.fltCat, name: m.name }; }
  // TAF periods overlapping [t0, t1] (ms). Returns the worst-case reading with plain words.
  function tafWindow(taf, t0, t1) {
    if (!taf || !Array.isArray(taf.fcsts)) return null; let words = [], worst = "VFR", gust = null, any = false, prob = false;
    const rank = { VFR: 0, MVFR: 1, IFR: 2, LIFR: 3 };
    for (const f of taf.fcsts) { const a = f.timeFrom * 1000, b = f.timeTo * 1000; if (b < t0 || a > t1) continue; any = true;
      const c = fltCat(visNum(f.visib), ceiling(f.clouds)); if (rank[c] > rank[worst]) worst = c;
      if (f.fcstChange === "PROB" || f.fcstChange === "TEMPO" || f.probability) prob = true;
      if (f.wgst) gust = Math.max(gust || 0, f.wgst); for (const w of wxWords(f.wxString)) if (!words.includes(w)) words.push(w); }
    return any ? { fltCat: worst, words, gust, possible: prob } : null;
  }
  const CAT_WORDS = { VFR: "Good visibility", MVFR: "Some low cloud or haze", IFR: "Low cloud or poor visibility", LIFR: "Very low cloud or fog" };

  // ---------- SIGMETs on the route ----------
  const HAZ = { CONVECTIVE: "thunderstorms", TS: "thunderstorms", TSGR: "thunderstorms with hail", TURB: "turbulence", ICE: "icing", VA: "volcanic ash", TC: "tropical cyclone",
    MTW: "mountain waves", IFR: "low cloud and fog", "MT OBSC": "mountains hidden in cloud", DS: "dust storm", SS: "sandstorm", RDOACT: "radioactive cloud" };
  function sigmetsOnLeg(list, leg, now, ac) {
    if (!leg || !Array.isArray(list)) return []; const pts = gcPoints(leg.from, leg.to, Math.max(20, Math.round(distNm(leg.from, leg.to) / 15)));
    const out = [];
    for (const s of list) { if (s.type && !/SIGMET|AIRMET/i.test(s.type)) continue; if (s.to && s.to * 1000 < now) continue;
      const poly = s.coords; let hitAt = -1; for (let i = 0; i < pts.length; i++) if (inPoly(pts[i], poly)) { hitAt = i; break; }
      if (hitAt < 0) continue;
      let ahead = null; if (ac) { const done = distNm(leg.from, ac), at = distNm(leg.from, pts[hitAt]); ahead = at >= done - 20; }
      out.push({ ...s, words: HAZ[s.hazard] || String(s.hazard || "hazard").toLowerCase(), alongNm: Math.round(distNm(leg.from, pts[hitAt])), ahead }); }
    return out;
  }

  // ---------- FAA NAS (US airports only) ----------
  const faaCode = apt => apt && apt.countryiso2 === "US" ? (apt.iata || (apt.icao || "").replace(/^K/, "")) : null;
  const toMin = s => { s = String(s || ""); let m = 0, h = s.match(/(\d+)\s*hour/), mm = s.match(/(\d+)\s*minute/); if (h) m += 60 * h[1]; if (mm) m += +mm[1]; return h || mm ? m : null; };
  // Short place label for AI copy: prefer town/airport name over raw ICAO.
  function shortPlaceName(name, fallback) {
    let s = String(name || "").trim();
    if (!s || /^null\b/i.test(s)) return fallback || "";
    s = s.split(",")[0].trim().split("/")[0].trim();
    s = s.replace(/\b(International|Intl\.?|Regional|Municipal|Muni|Airport|Fld|Field|Cnty|County|AFB|Air Force Base)\b\.?/gi, "").replace(/\s+/g, " ").trim();
    return s || fallback || "";
  }
  function aptPlace(apt) {
    if (!apt) return "";
    return shortPlaceName(apt.name, "") || apt.iata || apt.icao || "";
  }
  // AWC METAR name → town; fall back to ICAO only if no name.
  function metarPlace(m) {
    if (!m) return "en route";
    return shortPlaceName(m.name, "") || m.icaoId || "en route";
  }
  // Strip FAA ARTCC center codes (ZDV, ZAU, …) from reason text for passenger copy.
  function cleanFaaReason(r) {
    if (!r) return "";
    let s = String(r).replace(/\bZ[A-Z]{2}\s*\/\s*/g, "").trim();
    s = s.replace(/^WX:\s*/i, "").trim();
    if (!s) return "";
    // "Fog" / "FG" → fog
    const low = s.toLowerCase();
    if (/^(fg|fog)$/i.test(s)) return "fog";
    if (/thunder|ts\b/i.test(s)) return "thunderstorms";
    if (/wind/i.test(s)) return "wind";
    if (/snow|ice|freezing/i.test(s)) return low;
    return low;
  }
  function fmtFaaSpan(minStr, maxStr) {
    const a = toMin(minStr), b = toMin(maxStr);
    if (a != null && b != null) return `${fmtMin(a)} to ${fmtMin(b)}`;
    if (a != null) return fmtMin(a);
    if (b != null) return fmtMin(b);
    const raw = [minStr, maxStr].filter(Boolean);
    return raw.length ? raw.join(" to ") : "";
  }
  function nasFor(nas, apt) {
    const c = faaCode(apt); if (!nas || !c) return [];
    const place = aptPlace(apt) || c;
    const out = [];
    for (const g of nas.groundStops || []) if (g.arpt === c) {
      const rawR = g.reason || "", cleanR = cleanFaaReason(rawR);
      const full = `FAA ground stop at ${c}${rawR ? ` (${rawR})` : ""}${g.until ? `, listed until ${g.until}` : ""}.`;
      const why = `FAA ground stop at ${place}${cleanR ? ` (${cleanR})` : ""}${g.until ? `, listed until ${g.until}` : ""}.`;
      out.push({ kind: "stop", lvl: 2, text: full, why });
    }
    for (const g of nas.groundDelays || []) if (g.arpt === c) { const avg = toMin(g.avg);
      const rawR = g.reason || "", cleanR = cleanFaaReason(rawR);
      const avgFmt = avg != null ? fmtMin(avg) : (g.avg || "");
      const maxM = toMin(g.max), maxFmt = maxM != null ? fmtMin(maxM) : (g.max || "");
      const full = `FAA ground delay program for flights into ${c}${rawR ? ` (${rawR})` : ""}: average ${g.avg}${g.max ? `, max ${g.max}` : ""} (FAA figures).`;
      const why = `FAA ground delay program for flights into ${place}${cleanR ? ` (${cleanR})` : ""}: average ${avgFmt}${maxFmt ? `, max ${maxFmt}` : ""} (FAA figures).`;
      out.push({ kind: "gdp", lvl: avg !== null && avg >= 45 ? 2 : 1, text: full, why }); }
    for (const d of nas.delays || []) if (d.arpt === c) { const mx = toMin(d.max);
      const rawR = d.reason || "", cleanR = cleanFaaReason(rawR);
      const span = fmtFaaSpan(d.min, d.max);
      const spanRaw = d.min ? `${d.min}${d.max ? ` to ${d.max}` : ""}` : "";
      const full = `FAA reports ${(d.type || "general").toLowerCase()} delays at ${c}${spanRaw ? `: ${spanRaw}` : ""}${d.trend ? `, ${d.trend.toLowerCase()}` : ""}${rawR ? ` (${rawR})` : ""}.`;
      const why = `FAA reports ${(d.type || "general").toLowerCase()} delays at ${place}${span ? `: ${span}` : ""}${d.trend ? `, ${d.trend.toLowerCase()}` : ""}${cleanR ? ` (${cleanR})` : ""}.`;
      out.push({ kind: "delay", dir: (d.type || "").toLowerCase(), lvl: mx !== null && mx >= 45 ? 2 : 1, text: full, why }); }
    for (const a of nas.closures || []) if (a.arpt === c && !a.gaOnly) {
      const full = `FAA lists ${c} as closed${a.reopen ? `, reopening ${a.reopen.replace(/\.$/, "")}` : ""}.`;
      const why = `FAA lists ${place} as closed${a.reopen ? `, reopening ${a.reopen.replace(/\.$/, "")}` : ""}.`;
      out.push({ kind: "closure", lvl: 2, text: full, why });
    }
    return out;
  }

  // ---------- live position vs schedule ----------
  const TURN_MIN = 35;   // planning assumption for a narrow-body turnaround; shown to the user as an assumption
  // Descent/approach buffer (minutes): great-circle cruise time alone understates arrival. Not airline ETA.
  function approachBufferMin(toNm, phase) {
    if (toNm < 12) return phase === "descending" ? 6 : 10;
    if (toNm < 40) return 12;
    if (toNm < 100) return 18;
    return 25;
  }
  function progress(ac, leg, now) {
    if (!ac || !leg) return null; const p = { lat: ac.lat, lon: ac.lon }, toNm = distNm(p, leg.to), fromNm = distNm(p, leg.from);
    const onGround = ac.alt === "ground" || (isFinite(ac.alt) && ac.alt < 300 && (ac.gs || 0) < 60);
    const out = { toNm, fromNm, totalNm: distNm(leg.from, leg.to), onGround };
    if (onGround) out.at = toNm < 5 ? "dest" : fromNm < 5 ? "origin" : null;
    else {
      out.phase = isFinite(ac.vs) && ac.vs < -500 ? "descending" : isFinite(ac.vs) && ac.vs > 500 ? "climbing" : "cruising";
      if ((ac.gs || 0) >= 80) {
        const buf = approachBufferMin(toNm, out.phase);
        out.bufferMin = buf;
        out.etaMs = now + toNm / ac.gs * 3600e3 + buf * 60e3;   // GC at current GS + descent/approach buffer
      }
    }
    if (!out.phase) out.phase = onGround ? "ground" : "cruising";
    return out;
  }

  // One shared arrival ETA (ms): same formula the AI card, headline clock, and 1s tick must all use.
  function liveEtaMs(ac, leg, now) {
    if (!ac || !leg) return null;
    const pr = progress(ac, leg, now);
    return pr && pr.etaMs ? pr.etaMs : null;
  }
    // Minutes late(+) / early(−). Airborne with a solid position ETA: live track is primary.
  // FAA arrival programs then add a capped holding/spacing cushion on top — they do not replace the live ETA.
  // Before takeoff (or with no solid live ETA), the FAA program delay applies normally.
  function delayEstimate(c) {
    const now = c.now, out = { liveMin: null, faaMin: null, lateMin: null, etaMs: null, source: "", basis: "", faaAddMin: null, airborne: false };
    const pr = c.progress;
    // Position-based (airborne)
    if (pr && pr.etaMs && c.arrMs) {
      out.liveMin = Math.round((pr.etaMs - c.arrMs) / 60e3);
      out.etaMs = pr.etaMs;
      out.basis = `live track + ${pr.bufferMin || 0}-min approach buffer`;
    }
    // Pre-departure: past scheduled dep, still on ground / not seen
    if (c.depMs && now > c.depMs) {
      const stillHeld = !pr || (pr.onGround && pr.at === "origin") || (!pr && !c.inbound);
      if (stillHeld) {
        const hold = Math.round((now - c.depMs) / 60e3);
        if (out.liveMin == null || hold > out.liveMin) { out.liveMin = hold; out.basis = "past scheduled departure, still on the ground"; if (c.arrMs) out.etaMs = c.arrMs + hold * 60e3; }
      }
    }
    // Inbound aircraft still arriving for this departure
    if (c.inbound && c.inbound.etaMs && c.depMs) {
      const ready = c.inbound.etaMs + TURN_MIN * 60e3, late = Math.round((ready - c.depMs) / 60e3);
      if (late > 0 && (out.liveMin == null || late > out.liveMin)) { out.liveMin = late; out.basis = `inbound landing + ${TURN_MIN}-min turnaround`; }
    }
    // FAA: largest published program minutes at origin/dest
    let faa = 0, faaTxt = "";
    for (const apt of [c.origin, c.dest]) {
      for (const n of nasFor(c.nas, apt)) {
        let m = 0;
        if (n.kind === "stop" || n.kind === "closure") m = 90;
        else if (n.kind === "gdp") { const g = (c.nas.groundDelays || []).find(x => x.arpt === faaCode(apt)); m = toMin(g && g.avg) || 45; }
        else if (n.kind === "delay") { const d = (c.nas.delays || []).find(x => x.arpt === faaCode(apt)); m = toMin(d && d.max) || toMin(d && d.min) || 30; }
        if (m > faa) { faa = m; faaTxt = n.text; }
      }
    }
    out.faaMin = faa || null;
    const live = out.liveMin;
    // Solid airborne fix: in the air with a position-based ETA (not on the ground at origin/dest).
    const airborne = !!(pr && !pr.onGround && pr.etaMs && c.arrMs && live != null);
    out.airborne = airborne;
    if (airborne) {
      out.lateMin = live; // primary vs schedule — never replaced by airport-wide FAA minutes
      out.source = "live track";
      if (faa > 0) {
        // Holding / spacing risk on top of the live ETA. Cap so a 46–60 min airport program
        // becomes a modest 10–30 min cushion, not a rewritten arrival time.
        const addLo = Math.min(10, Math.max(5, Math.round(faa * 0.15)));
        const addHi = Math.min(30, Math.max(addLo + 10, Math.round(faa * 0.4)));
        out.faaAddMin = [addLo, addHi];
        out.source = "live track + FAA spacing";
        out.basis = (out.basis ? out.basis + "; " : "") + "FAA spacing risk on top of live ETA";
      }
    } else if (faa && (live == null || faa > Math.max(0, live || 0))) {
      out.lateMin = faa; out.source = "FAA"; out.basis = faaTxt || "FAA program";
      if (!out.etaMs && c.arrMs) out.etaMs = c.arrMs + faa * 60e3;
    } else if (live != null) {
      out.lateMin = live; out.source = "live track";
    } else if (faa) {
      out.lateMin = faa; out.source = "FAA"; out.basis = faaTxt || "FAA program";
      if (!out.etaMs && c.arrMs) out.etaMs = c.arrMs + faa * 60e3;
    }
    return out;
  }

  // ---------- the estimate (deterministic weighted rules; plain-English "AI delay read") ----------
  const LV = ["Low", "Medium", "High"];
  function routeWxFlags(list) {
    // METARs sampled along the GC route (from /route-wx). Flag fog/LIFR, low ceilings, TS, gusts, snow/ice.
    // Fog bullets only when visibility is actually under 3 mi (LIFR from ceiling alone is not "fog").
    const out = []; if (!Array.isArray(list)) return out;
    for (const m of list) {
      const cat = m.fltCat || fltCat(visNum(m.visib), ceiling(m.clouds));
      const words = wxWords(m.wxString), gust = m.wgst || 0, place = metarPlace(m), id = m.icaoId || place;
      const vis = visNum(m.visib);
      const fogWord = /fog/.test(words.join(" "));
      if ((fogWord || cat === "LIFR") && vis != null && vis < 3) {
        out.push({ lvl: 2, text: `Fog or very low cloud near ${place} along the route (visibility ${vis} mi).`,
          full: `Fog or very low cloud near ${id} along the route (${cat}, visibility ${m.visib} mi).`, kind: "fog" });
      } else if (cat === "LIFR" && (vis == null || vis >= 3)) {
        // Low ceiling, not fog — keep for All signals; milder main copy without claiming fog.
        out.push({ lvl: 1, text: `Very low ceilings near ${place} along the route.`,
          full: `Very low ceilings near ${id} along the route (${cat}${m.visib != null ? `, visibility ${m.visib} mi` : ""}).`, kind: "ifr" });
      } else if (cat === "IFR") {
        out.push({ lvl: 1, text: `Low cloud or poor visibility near ${place} along the route.`,
          full: `Low cloud or poor visibility near ${id} along the route (${cat}).`, kind: "ifr" });
      }
      if (words.some(w => /thunder/.test(w))) out.push({ lvl: 2, text: `Thunderstorms reported near ${place} along the route.`, full: `Thunderstorms reported near ${id} along the route.`, kind: "ts" });
      if (words.some(w => /freezing|snow|ice/.test(w))) out.push({ lvl: 1, text: `${words.filter(w => /freezing|snow|ice/.test(w)).join(", ")} near ${place} along the route.`, full: `${words.filter(w => /freezing|snow|ice/.test(w)).join(", ")} near ${id} along the route.`, kind: "ice" });
      if (gust >= 35) out.push({ lvl: 1, text: `Wind gusts to ${gust} kt near ${place} along the route.`, full: `Wind gusts to ${gust} kt near ${id} along the route.`, kind: "wind" });
    }
    return out;
  }
  function assess(c) {
    const R = [], todo = [], why = [], now = c.now;
    // text = passenger-facing (why bullets); full (optional) = All signals with codes.
    const add = (lvl, text, src, kind, full) => { R.push({ lvl, text: full || text, src, kind: kind || "" }); if (lvl >= 1) why.push(text); };
    const ap = x => x && (x.iata || x.icao);
    const place = x => aptPlace(x) || ap(x) || "";
    for (const [apt, role] of [[c.origin, "dep"], [c.dest, "arr"]]) {
      if (!apt) continue;
      for (const n of nasFor(c.nas, apt)) { if (n.kind === "delay" && n.dir && n.dir !== "general" && ((role === "dep") !== (n.dir === "departure"))) n.lvl = Math.min(n.lvl, 1);
        add(n.lvl, n.why || n.text, "FAA", n.kind, n.text);
        if (n.kind === "stop") todo.push(c.progress && !c.progress.onGround && role === "arr" ? `Ground stop at ${place(apt)}. Planes already in the air may hold or divert. Follow your airline app.` : `Ground stop at ${place(apt)}. Check your airline app for a new departure time or rebooking.`);
        else if (n.kind === "gdp") todo.push(`Flights into ${place(apt)} are being held by the FAA. Check your airline app before heading to the gate.`);
        else if (n.kind === "closure") todo.push(`${place(apt)} is listed as closed. Contact your airline about rebooking.`); }
      const w = c.wx && c.wx[apt.icao]; if (!w) continue;
      const tWin = role === "dep" ? c.depMs : c.arrMs, win = tafWindow(w.taf, (tWin || now) - 3600e3, (tWin || now) + 3600e3), cur = w.metar;
      const words = new Set([...(cur ? wxWords(cur.wxString) : []), ...(win ? win.words : [])]);
      const when = tWin ? (role === "dep" ? "around departure" : "around arrival") : "now or in the next hours";
      const pl = place(apt), code = ap(apt);
      if ([...words].some(x => /thunder/.test(x))) { add(1, `Thunderstorms ${cur && /TS/.test(cur.wxString || "") ? "reported" : "forecast" + (win && win.possible ? " (possible)" : "")} at ${pl} ${when}.`, "NWS/AWC", "ts",
          `Thunderstorms ${cur && /TS/.test(cur.wxString || "") ? "reported" : "forecast" + (win && win.possible ? " (possible)" : "")} at ${code} ${when}.`);
        todo.push(`Storms at ${pl} can pause ramp work and cause holding. Keep an eye on your airline app.`); }
      if ([...words].some(x => /freezing|snow|ice pellets/.test(x))) add(1, `${[...words].filter(x => /freezing|snow|ice/.test(x)).join(", ")} at ${pl} ${when}: de-icing and slower operations are common.`, "NWS/AWC", "ice",
          `${[...words].filter(x => /freezing|snow|ice/.test(x)).join(", ")} at ${code} ${when}: de-icing and slower operations are common.`);
      const cat = [cur && cur.fltCat, win && win.fltCat].filter(Boolean).sort((a, b) => ["VFR", "MVFR", "IFR", "LIFR"].indexOf(b) - ["VFR", "MVFR", "IFR", "LIFR"].indexOf(a))[0];
      if (cat === "LIFR" || (cat === "IFR" && role === "arr")) {
        const visBit = cur && cur.vis != null ? `, visibility ${cur.vis} mi` : "";
        const whyWx = `${CAT_WORDS[cat]} at ${pl} ${when}${cur && cur.vis != null && cur.vis < 3 ? ` (visibility ${cur.vis} mi)` : ""}. Airports often space flights out in these conditions.`;
        const fullWx = `${CAT_WORDS[cat]} at ${code} ${when} (${cat}${visBit}). Airports often space flights out in these conditions.`;
        add(cat === "LIFR" ? 2 : 1, whyWx, "NWS/AWC", cat === "LIFR" ? "fog" : "ifr", fullWx);
      }
      const g = Math.max(cur && cur.gust || 0, win && win.gust || 0); if (g >= 35) add(1, `Wind gusts to ${g} kt at ${pl} ${when}.`, "NWS/AWC", "wind", `Wind gusts to ${g} kt at ${code} ${when}.`);
    }
    for (const f of routeWxFlags(c.routeWx)) add(f.lvl, f.text, "AWC route sample", f.kind, f.full);
    for (const s of c.sigmets || []) { if (s.ahead === false) continue; const strong = /volcanic|tropical|thunder/.test(s.words);
      add(strong ? 2 : 1, `${s.type === "AIRMET" || s.type === "G-AIRMET" ? "AIRMET" : "SIGMET"} for ${s.words} along the route, about ${Math.round(s.alongNm * 1.15078)} mi from ${ap(c.origin) || "the origin"}${s.ahead ? ", ahead of the plane" : ""}. Flights may reroute or hold.`, "AWC", /thunder/.test(s.words) ? "ts" : "sig"); }
    const de = delayEstimate(c), pr = c.progress;
    if (de.liveMin != null && de.source !== "FAA") {
      const late = de.liveMin;
      if (late > 45) add(2, `At its current speed, with an approach buffer, it's about ${fmtMin(late)} behind the scheduled arrival (${de.basis}).`, "adsb.lol", "live");
      else if (late > 15) add(1, `At its current speed, with an approach buffer, it's about ${fmtMin(late)} behind the scheduled arrival (${de.basis}).`, "adsb.lol", "live");
      else if (late < -10) add(0, `On its current track and speed it looks set to arrive ahead of schedule.`, "adsb.lol", "live");
      else add(0, `On its current track and speed it looks close to the scheduled arrival.`, "adsb.lol", "live");
    }
    if (c.inbound && c.inbound.etaMs && c.depMs) { const ready = c.inbound.etaMs + TURN_MIN * 60e3, late = Math.round((ready - c.depMs) / 60e3);
      if (late > 0) { add(late > 30 ? 2 : 1, `Your plane is still on its way in. Landing plus a typical ${TURN_MIN}-minute turnaround puts it about ${fmtMin(late)} past the scheduled departure.`, "adsb.lol", "inbound");
        todo.push("Your plane is running late on its way in. Your airline app will show the official new time."); } }
    if (pr && pr.onGround && pr.at === "origin" && c.depMs && now - c.depMs > 20 * 60e3) add(1, `Scheduled to leave ${fmtMin(Math.round((now - c.depMs) / 60e3))} ago and it's still on the ground at ${ap(c.origin)}.`, "adsb.lol", "hold");
    // Weighted level: weather/FAA reasons + magnitude of the *primary* delay (live when airborne)
    let level = R.reduce((m, r) => Math.max(m, r.lvl), 0);
    const late = de.lateMin;
    // Only the primary lateMin (live when airborne) bumps level — not the raw airport-wide FAA minutes.
    if (late != null && late > 60) level = Math.max(level, 2);
    else if (late != null && late > 25) level = Math.max(level, 1);
    if (!R.length) R.push({ lvl: 0, text: "No FAA programs, storms, low visibility or SIGMETs found for this flight right now.", src: "" });
    if (!todo.length) todo.push(level ? "Keep your airline app handy; it has the official times and gate." : "Nothing to do for now. Your airline app has the official times and gate.");
    // Likely-delay range. Airborne + FAA/weather disagreeing with an on-time live track → capped spacing cushion.
    let lo = 0, hi = 0, rangeKind = "delay";
    const disagree = de.airborne && late != null && late <= 10 && (de.faaAddMin || level >= 1);
    if (disagree && de.faaAddMin) { lo = de.faaAddMin[0]; hi = de.faaAddMin[1]; rangeKind = "spacing"; }
    else if (disagree) { lo = level >= 2 ? 10 : 10; hi = level >= 2 ? 30 : 20; rangeKind = "spacing"; }
    else if (late != null && late > 0) { lo = Math.max(5, Math.round(late * 0.7)); hi = Math.round(late * 1.4 + (level >= 2 ? 20 : 10)); }
    else if (level >= 2) { lo = 30; hi = 90; }
    else if (level === 1) { lo = 15; hi = 45; }
    // Plain-English headline. Must never contradict the projected arrival (live ETA) on the same card.
    const top = R.filter(r => r.lvl >= 1).sort((a, b) => b.lvl - a.lvl)[0];
    const dest = ap(c.dest) || "arrival", origin = ap(c.origin) || "departure";
    // {ETA} is filled by the UI from the same etaMs as Projected arrival / live tick — never bake a clock here.
    const destName = (c.dest && (c.dest.name || "").replace(/\b(International|Intl\.?|Regional|Municipal|Airport)\b.*/i, "").trim()) || dest;
    let headline;
    if (disagree) {
      const track = late != null && late < -5 ? `Tracking about ${fmtMin(-late)} early` : "Tracking about on time";
      const wxBits = [];
      if (top && /fog|LIFR|visibility/i.test(top.text)) wxBits.push("Fog");
      if (top && /thunder/i.test(top.text)) wxBits.push("Storms");
      if (de.faaMin || (top && /FAA|ground|delay|spacing/i.test(top.text))) wxBits.push("FAA spacing");
      if (!wxBits.length && top) wxBits.push("Weather");
      const who = wxBits.length ? wxBits.join(" and ") : "Conditions";
      headline = `${track}${de.etaMs ? " ({ETA})" : ""}. ${who} at ${destName || dest} could add ${fmtMin(lo)} to ${fmtMin(hi)}.`;
    } else if (top && /fog|LIFR|visibility/i.test(top.text)) {
      const vis = (c.wx && c.dest && c.wx[c.dest.icao] && c.wx[c.dest.icao].metar && c.wx[c.dest.icao].metar.vis);
      headline = `Fog at ${dest}${vis != null ? ` (visibility ${vis} mile${vis === 1 ? "" : "s"})` : ""}.`;
      if (late != null && late > 10) headline += ` Likely ${fmtMin(lo)} to ${fmtMin(hi)} late.`;
      else if (level >= 1) headline += ` Likely ${fmtMin(lo)} to ${fmtMin(hi)} of delay risk.`;
    } else if (top && /thunder|SIGMET for thunderstorms/i.test(top.text)) {
      headline = `Thunderstorms near ${/origin|dep/i.test(top.text) ? origin : dest}.`;
      if (late != null && late > 10) headline += ` Likely ${fmtMin(lo)} to ${fmtMin(hi)} late.`;
      else if (level >= 1) headline += ` Likely ${fmtMin(lo)} to ${fmtMin(hi)} of delay risk.`;
    } else if (top && /FAA|ground (stop|delay)|closed/i.test(top.text) && !de.airborne) {
      headline = top.text.replace(/\.$/, "") + ".";
      if (late != null && late > 10) headline += ` Likely ${fmtMin(lo)} to ${fmtMin(hi)} late.`;
    } else if (late != null && late > 15) {
      headline = `Running about ${fmtMin(late)} behind on the live track. Likely ${fmtMin(lo)} to ${fmtMin(hi)} late.`;
    } else if (top) {
      headline = top.text.replace(/\.$/, "") + ".";
      if (level >= 1) headline += ` Likely ${fmtMin(lo)} to ${fmtMin(hi)} of delay risk.`;
      else headline += " Looking close to on time.";
    } else {
      headline = "No major delay signals right now. Looking close to on time.";
    }
    if (!disagree) {
      if (level >= 2) headline += " Rising risk.";
      else if (level === 1) headline += " Watch closely.";
    }
    const read = { headline, level, label: LV[level], lateMin: late, range: [lo, hi], rangeKind, why: why.slice(0, 5),
      source: de.source || (level ? "weather/rules" : "clear"), basis: de.basis, etaMs: de.etaMs, faaMin: de.faaMin, liveMin: de.liveMin,
      faaAddMin: de.faaAddMin, airborne: de.airborne,
      disclaimer: "AI estimate, not the airline's official status" };
    return { level, label: LV[level], reasons: R.sort((a, b) => b.lvl - a.lvl), todo: [...new Set(todo)], delay: de, read };
  }
  function fmtMin(m) { m = Math.abs(Math.round(m)); const h = Math.floor(m / 60), r = m % 60; return h ? `${h} h${r ? ` ${r} min` : ""}` : `${r} min`; }

  // ---------- "How much time do I have?" ----------
  // Transport modes are data, so new ones (e.g. eVTOL air taxis) can be switched on per airport without code changes.
  // Speeds/waits are planning assumptions (shown on the page), not routing results.
  const MODES = [
    { id: "walk", label: "Walk", icon: "🚶", kmh: 4.5, waitMin: 0, maxKm: 1.6, enabled: true },
    { id: "ride", label: "Rideshare or taxi", icon: "🚕", kmh: 35, waitMin: 10, enabled: true, links: ["uber", "lyft"] },
    { id: "transit", label: "Train or transit", icon: "🚆", kmh: null, needsStation: true, enabled: true },   // times: Google Maps only (no free timetable source wired up)
    // eVTOL air taxi: no public passenger service operates at any airport yet (checked Oct 26, 2026: Joby/Archer not launched,
    // no FAA type certificate). Turn on per airport only once a real service is selling seats there.
    { id: "evtol", label: "Air taxi (eVTOL)", icon: "🚁", kmh: null, enabled: false, airports: {} },
    // Tesla Robotaxi (Model Y / Cybercab), booked in Tesla's Robotaxi app. Checked Oct 26, 2026: public rides in Austin, Dallas,
    // Houston, Miami, Orlando and Tampa (no airport pickups in any of them; MIA/MCO zones stop short of the terminals) and a
    // supervised Bay Area service with a safety driver. The only airport that lists Tesla as an authorized app ride is SJC
    // (flysanjose.com/app-based-rideshares: pickup Terminal A Stop 1, Terminal B Stop 8; drop-off at departures curbs).
    // Off by default; shown only at airports listed here. Add an airport only when the airport or Tesla publishes it.
    { id: "robotaxi", label: "Tesla Robotaxi", icon: "🚘", kmh: null, enabled: false, url: "https://www.tesla.com/robotaxi",
      airports: { SJC: { note: "Book in the Tesla Robotaxi app. Bay Area rides have a safety driver aboard. Pickup at Terminal A Stop 1 or Terminal B Stop 8 (per SJC); drop-off at the departures curb. Check the app for its service area and price.",
        src: "https://www.flysanjose.com/app-based-rideshares", checked: "2026-10-26" } } }
  ];
  const ROAD = 1.4;   // straight-line -> road distance factor (assumption)
  const VISIT = { restaurant: 60, cafe: 25, fast_food: 25, museum: 90, attraction: 45, park: 40, cinema: 150 };
  const modesFor = apt => MODES.filter(m => m.enabled || (m.airports && apt && (m.airports[apt.iata] || m.airports[apt.icao])));
  function tripMinutes(km, mode) { if (mode.id === "walk") return Math.round(km * ROAD / mode.kmh * 60); if (!mode.kmh) return null; return Math.round(km * ROAD / mode.kmh * 60 + mode.waitMin); }
  function plan(o) {   // o: {now, depMs, boardMin, secMin, places:[{c, km}], apt}
    const backBy = o.depMs - o.boardMin * 60e3, gateMin = Math.floor((backBy - o.now) / 60e3), outMin = gateMin - o.secMin;
    const modes = modesFor(o.apt);
    const items = (o.places || []).map(p => { const visit = VISIT[p.c] || 45, walk = modes.find(m => m.id === "walk"), ride = modes.find(m => m.id === "ride");
      const mode = walk && p.km <= walk.maxKm ? walk : ride, one = tripMinutes(p.km, mode), total = one * 2 + visit, slack = outMin - total;
      return { ...p, visit, mode: mode.id, oneWay: one, total, fit: slack >= Math.max(20, total * 0.25) ? "fits" : slack >= 0 ? "tight" : "nofit" }; });
    return { backBy, gateMin, outMin, items };
  }

  const base = core.make("flight", validate);
  const OPEN = "flight/open";
  const api = Object.assign(base, {
    WEB: base.WEB.replace(/flight$/, OPEN),
    webUrl: tok => base.WEB.replace(/flight$/, OPEN) + "#" + tok,
    validate, parseFlight, IATA_ICAO, REGIONALS, AIRLINE_REBOOK, DOT_REFUNDS, mainlineIata, rebookFor, peersForPair, matchLivePeers, nearbyAirports, googleFlightsUrl, SEMI_PRIVATE, CHARTER_OPTS, AMTRAK_NEAR, AMTRAK_ROUTES, carriersNear, carriersForRoute, charterNear, driveVsFly, amtrakFor, DRIVE_ROAD, DRIVE_MPH, distNm, bearing, gcPoints, inPoly, destPt, project, legs, liveLeg, userLeg, aptMatch,
    wxWords, readMetar, fromAwcMetar, tafWindow, fltCat, CAT_WORDS, sigmetsOnLeg, nasFor, faaCode, toMin, shortPlaceName, aptPlace, metarPlace, cleanFaaReason, fmtFaaSpan, progress, liveEtaMs, approachBufferMin, delayEstimate, routeWxFlags, assess, fmtMin, TURN_MIN, MODES, ROAD, VISIT, modesFor, tripMinutes, plan, LV, applyAptName, APT_NAME });
  if (typeof module !== "undefined") module.exports = api; else root.YWFlight = api;
})(this);
