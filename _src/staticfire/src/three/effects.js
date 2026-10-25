import { Effect, EffectAttribute } from "postprocessing";
import { Uniform, Vector2 } from "three";
// One convolution pass: heat shimmer around the plume + directional motion blur from camera shake
// + subtle chromatic split + exposure (eye adaptation) + G-force tunnel vision.
export class LensEffect extends Effect {
  constructor() {
    super("LensEffect", /* glsl */`
      uniform vec2 uHeatPos; uniform float uHeatR, uHeat, uTime, uExposure, uCA, uTunnel;
      uniform vec2 uBlur;
      float hh(vec2 p){ return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5453); }
      float nn(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f); return mix(mix(hh(i),hh(i+vec2(1,0)),f.x),mix(hh(i+vec2(0,1)),hh(i+vec2(1,1)),f.x),f.y); }
      void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor){
        vec2 d = (uv - uHeatPos) * vec2(1.0, 0.6); float m = uHeat * smoothstep(uHeatR, 0.0, length(d)) * step(uHeatPos.y - uHeatR*0.6, uv.y);
        vec2 off = (vec2(nn(uv*vec2(60.0,25.0) + vec2(0.0, -uTime*3.0)), nn(uv*vec2(55.0,28.0) + vec2(3.1, -uTime*2.6))) - 0.5) * 0.012 * m;
        vec2 u = uv + off;
        vec3 c = vec3(0.0); float wsum = 0.0;
        for (int i = 0; i < 6; i++) { float k = float(i) / 5.0 - 0.5; float w = 1.0 - abs(k);
          vec2 q = u + uBlur * k;
          vec2 ca = (q - 0.5) * uCA;
          vec3 g0 = texture2D(inputBuffer, q).rgb; vec3 sp = vec3(texture2D(inputBuffer, q + ca).r, g0.g, texture2D(inputBuffer, q - ca).b);
          float lum = max(max(g0.r, g0.g), g0.b); c += mix(sp, g0, smoothstep(1.5, 6.0, lum)) * w; wsum += w; }
        c /= wsum;
        float r = length((uv - 0.5) * vec2(1.0, 1.25));
        c *= mix(1.0, smoothstep(0.75, 0.15, r), uTunnel);       // tunnel vision at high g
        outputColor = vec4(c * uExposure, inputColor.a);
      }`, {
      attributes: EffectAttribute.CONVOLUTION,
      uniforms: new Map([["uHeatPos", new Uniform(new Vector2(0.5, 0.2))], ["uHeatR", new Uniform(0.2)], ["uHeat", new Uniform(0)], ["uTime", new Uniform(0)],
        ["uExposure", new Uniform(1)], ["uCA", new Uniform(0.0)], ["uTunnel", new Uniform(0)], ["uBlur", new Uniform(new Vector2())]])
    });
  }
}
