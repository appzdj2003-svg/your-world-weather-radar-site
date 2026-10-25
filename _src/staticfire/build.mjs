// Bundles the static fire simulator into ../../assets/static-fire/ (sf.js: page UI + HUD + Lite view; sf3d.js: 3D, loaded on demand).
// Usage (from _src/staticfire): npm i && node build.mjs   — then run python3 _src/build.py as usual.
import { build } from "esbuild";
import fs from "node:fs";
const out = new URL("../../assets/static-fire/", import.meta.url).pathname;
fs.mkdirSync(out, { recursive: true });
const common = { bundle: true, format: "iife", minify: true, target: ["es2020", "safari15"], legalComments: "none", define: { "process.env.NODE_ENV": '"production"' } };
await build({ ...common, entryPoints: ["src/app.js"], outfile: out + "sf.js" });
await build({ ...common, entryPoints: ["src/scene-entry.js"], outfile: out + "sf3d.js" });
const lic = [["three", "three.js"], ["postprocessing", "postprocessing"], ["suncalc", "SunCalc"]].map(([p, n]) =>
  `==== ${n} (${JSON.parse(fs.readFileSync(`node_modules/${p}/package.json`, "utf8")).license}) ====\n` + fs.readFileSync(["LICENSE", "LICENSE.md"].map(f => `node_modules/${p}/${f}`).find(f => fs.existsSync(f)), "utf8").trim()).join("\n\n");
fs.writeFileSync(out + "LICENSES.txt", "Third-party code bundled in sf3d.js\n\n" + lic + "\n\n==== Sky HDRIs (hdri/) ====\nPoly Haven (polyhaven.com), CC0.\n");
console.log("built", fs.readdirSync(out));
