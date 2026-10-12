// Run: node _src/tests/voice.test.js — voice.js with a fake SpeechRecognition and a tiny DOM stub.
const assert = require("assert"), fs = require("fs"), path = require("path");
const src = fs.readFileSync(path.join(__dirname, "../../assets/voice.js"), "utf8");
function setup(SR) {
  const els = {}, made = [];
  const mk = (id, tag = "INPUT") => els[id] = { id, tagName: tag, value: "", clicks: 0, click() { this.clicks++; } };
  const input = mk("qtext"), go = mk("qgo", "BUTTON");
  const btn = { dataset: { voiceFor: "qtext", voiceSubmit: "qgo" }, cls: new Set(), attrs: {}, h: null,
    classList: { add: c => btn.cls.add(c), remove: c => btn.cls.delete(c) }, setAttribute(k, v) { this.attrs[k] = v; },
    addEventListener(_, f) { this.h = f; }, closest: () => ({ insertAdjacentElement: (_, n) => { els[n.id] = n; } }), parentNode: null };
  global.window = SR ? { SpeechRecognition: SR } : {};
  global.document = { documentElement: { lang: "en" }, getElementById: id => els[id], querySelectorAll: () => [btn],
    createElement: () => { const n = { setAttribute() {} }; made.push(n); return n; } };
  eval(src); return { btn, input, go, els };
}
let last; class FakeSR { constructor() { last = this; } start() { this.started = true; } stop() { this.onend(); } }
// supported: interim then final -> field updates, listening class, auto-submit
let t = setup(FakeSR); t.btn.h();
assert.ok(last.started && last.lang === "en-US" && last.interimResults); assert.ok(t.btn.cls.has("listening"));
last.onresult({ resultIndex: 0, results: [Object.assign([{ transcript: "hiking in asheville" }], { isFinal: false })] });
assert.strictEqual(t.input.value, "hiking in asheville"); assert.strictEqual(t.go.clicks, 0);
last.onresult({ resultIndex: 0, results: [Object.assign([{ transcript: "hiking in Asheville this Saturday" }], { isFinal: true })] });
last.onend(); assert.strictEqual(t.input.value, "hiking in Asheville this Saturday"); assert.strictEqual(t.go.clicks, 1); assert.ok(!t.btn.cls.has("listening"));
// permission denied -> message, no submit
t = setup(FakeSR); t.btn.h(); last.onerror({ error: "not-allowed" }); last.onend();
assert.match(t.els["qtext-vmsg"].textContent, /blocked/); assert.strictEqual(t.go.clicks, 0);
// unsupported -> graceful message, button still present
t = setup(null); t.btn.h(); assert.strictEqual(t.els["qtext-vmsg"].textContent, "Voice input isn't supported in this browser, type your plan instead.");
console.log("All voice input tests passed");
