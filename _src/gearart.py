"""Original inline-SVG card art for gear categories (drawn for this site, no third-party images, no brand marks)."""
BG = {"rain": ("#0EA5E9", "#0C4A6E"), "gear": ("#334155", "#0F172A"), "power": ("#F59E0B", "#B45309")}
S = 'stroke="#0F172A" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"'
W, A, K, B = "#fff", "#F59E0B", "#0F172A", "#7DD3FC"
ART = {
 "radio": f'<rect x="40" y="70" width="120" height="80" rx="12" fill="{W}" {S}/><line x1="140" y1="70" x2="165" y2="30" {S}/><circle cx="80" cy="110" r="22" fill="{B}" {S}/><rect x="112" y="92" width="34" height="14" rx="3" fill="{A}" {S}/><circle cx="120" cy="128" r="5" fill="{K}"/><circle cx="138" cy="128" r="5" fill="{K}"/>',
 "station": f'<line x1="100" y1="60" x2="100" y2="168" {S}/><line x1="60" y1="60" x2="140" y2="60" {S}/><circle cx="60" cy="52" r="10" fill="{A}" {S}/><circle cx="140" cy="52" r="10" fill="{A}" {S}/><path d="M100 60 l0 -25 l25 8 z" fill="{W}" {S}/><rect x="80" y="95" width="40" height="40" rx="6" fill="{W}" {S}/><line x1="84" y1="108" x2="116" y2="108" {S}/><line x1="84" y1="121" x2="116" y2="121" {S}/>',
 "gauge": f'<path d="M80 40 h40 l-6 130 h-28 z" fill="{W}" fill-opacity=".85" {S}/><path d="M88 110 h24 l-2 58 h-20 z" fill="{B}"/><g {S}><line x1="98" y1="70" x2="112" y2="70"/><line x1="98" y1="90" x2="112" y2="90"/><line x1="98" y1="110" x2="112" y2="110"/><line x1="98" y1="130" x2="112" y2="130"/></g><path d="M60 30 q5 -12 10 0 a5 5 0 0 1 -10 0z M135 20 q5 -12 10 0 a5 5 0 0 1 -10 0z" fill="{B}"/>',
 "thermo": f'<rect x="45" y="50" width="110" height="100" rx="16" fill="{W}" {S}/><text x="100" y="98" font-family="Arial" font-weight="900" font-size="34" text-anchor="middle" fill="{K}">72°</text><text x="100" y="132" font-family="Arial" font-weight="700" font-size="20" text-anchor="middle" fill="#0369A1">45%</text>',
 "lightning": f'<path d="M50 80 a35 35 0 0 1 60 -25 a28 28 0 0 1 45 25 a20 20 0 0 1 -5 40 h-95 a20 20 0 0 1 -5 -40z" fill="{W}" {S}/><path d="M105 110 l-20 35 h18 l-10 35 l35 -48 h-18 l12 -22z" fill="{A}" {S}/>',
 "anemo": f'<line x1="100" y1="80" x2="100" y2="170" {S}/><g {S} fill="{W}"><line x1="100" y1="80" x2="55" y2="60"/><line x1="100" y1="80" x2="145" y2="60"/><line x1="100" y1="80" x2="100" y2="35"/><circle cx="55" cy="60" r="14"/><circle cx="145" cy="60" r="14"/><circle cx="100" cy="35" r="14"/></g><path d="M30 120 q20 -10 40 0 M130 130 q20 -10 40 0 M30 145 q25 -10 50 0" fill="none" stroke="{B}" stroke-width="5" stroke-linecap="round"/>',
 "jacket": f'<path d="M75 45 l25 15 l25 -15 l35 25 l-12 30 l-13 -8 v78 h-70 v-78 l-13 8 l-12 -30z" fill="{A}" {S}/><path d="M80 45 q20 -20 40 0" fill="{A}" {S}/><line x1="100" y1="60" x2="100" y2="170" {S}/>',
 "poncho": f'<circle cx="100" cy="45" r="16" fill="{A}" {S}/><path d="M100 58 l-65 95 q65 25 130 0z" fill="{A}" {S}/><path d="M60 50 q5 -12 10 0 a5 5 0 0 1 -10 0z M140 70 q5 -12 10 0 a5 5 0 0 1 -10 0z" fill="{B}"/>',
 "umbrella": f'<path d="M30 100 a70 65 0 0 1 140 0 q-17 -12 -35 0 q-17 -12 -35 0 q-17 -12 -35 0 q-18 -12 -35 0z" fill="{A}" {S}/><path d="M100 100 v58 q0 14 -14 14 q-12 0 -12 -12" fill="none" {S}/><line x1="100" y1="35" x2="100" y2="25" {S}/>',
 "boots": f'<path d="M55 40 h40 v95 l45 10 q15 4 15 20 v8 h-100z" fill="{A}" {S}/><line x1="55" y1="160" x2="155" y2="160" {S}/><line x1="55" y1="60" x2="95" y2="60" {S}/>',
 "drybag": f'<path d="M65 60 h70 l8 105 q0 8 -8 8 h-70 q-8 0 -8 -8z" fill="{A}" {S}/><path d="M62 45 h76 v15 h-76z" fill="{W}" {S}/><path d="M80 45 q20 -30 40 0" fill="none" {S}/><path d="M78 100 h44" stroke="{K}" stroke-width="3" stroke-dasharray="6 5"/>',
 "light": f'<path d="M55 85 l30 -15 h30 l30 15 v20 h-90z" fill="{W}" {S}/><rect x="80" y="105" width="40" height="65" rx="8" fill="{K}" {S}/><circle cx="100" cy="125" r="6" fill="{A}"/><path d="M60 55 l-15 -15 M100 50 v-22 M140 55 l15 -15" stroke="{A}" stroke-width="6" stroke-linecap="round"/>',
 "power": f'<rect x="60" y="45" width="80" height="125" rx="14" fill="{W}" {S}/><path d="M105 70 l-22 40 h17 l-6 35 l25 -45 h-17 l8 -30z" fill="{A}" {S}/><g fill="{K}"><circle cx="85" cy="158" r="4"/><circle cx="100" cy="158" r="4"/><circle cx="115" cy="158" r="4"/></g>',
 "kit": f'<rect x="40" y="65" width="120" height="95" rx="12" fill="#DC2626" {S}/><path d="M80 65 v-15 h40 v15" fill="none" {S}/><path d="M92 90 h16 v16 h16 v16 h-16 v16 h-16 v-16 h-16 v-16 h16z" fill="{W}" {S}/>',
}
def svg(kind, tone):
    a, b = BG[tone]; gid = f"g-{kind}-{tone}"
    return (f'<svg viewBox="0 0 200 200" class="gart" preserveAspectRatio="xMidYMid slice" role="img" aria-hidden="true"><defs><linearGradient id="{gid}" x1="0" y1="0" x2="1" y2="1">'
            f'<stop offset="0" stop-color="{a}"/><stop offset="1" stop-color="{b}"/></linearGradient></defs><rect width="200" height="200" fill="url(#{gid})"/>'
            f'<g fill="#fff" opacity=".12"><circle cx="170" cy="30" r="40"/><circle cx="20" cy="190" r="50"/></g>{ART[kind]}</svg>')
