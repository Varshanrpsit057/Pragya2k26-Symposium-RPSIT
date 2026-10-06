import { Mesh, Program, Renderer, Triangle } from 'ogl';
import { useEffect, useRef } from 'react';
import './GhostFibers.css';

/*
 * Adapted from React Bits' Ghost Fibers (ogl). Changes so it can run behind the whole page
 * on modest phones without slowing the rest of the site:
 *  - renders below CSS resolution (`renderScale`); the soft fibres hide the upscaling;
 *  - draws at most `maxFps` frames, waiting with a timer in between, so the browser is not
 *    woken on every display refresh just to skip a frame;
 *  - film grain and the light mode are left out of the shader, and everything that is the
 *    same for every pixel (rotation, drifting cloud, tones) is worked out once per frame here;
 *  - no pointer interaction; stops entirely while `paused` or the tab is hidden, and keeps
 *    its animation time continuous across pauses;
 *  - reports failure (no WebGL 2, shader error) through `onError` so the caller can keep CSS.
 */

const vertex = /* glsl */ `#version 300 es
in vec2 position;

void main() {
  gl_Position = vec4(position, 0.0, 1.0);
}
`;

const fragment = /* glsl */ `#version 300 es
precision highp float;

uniform vec2 uResolution;
uniform float uTime;
uniform float uInvScale;
uniform mat2 uRotation;
uniform vec2 uCloudOffset;
uniform float uLayers;
uniform float uWaveAmplitude;
uniform float uWaveFrequency;
uniform float uWaveSpeed;
uniform float uLayerSpeed;
uniform float uTwist;
uniform float uTwistFrequency;
uniform float uTwistSpeed;
uniform float uLineFrequency;
uniform float uLineSpacing;
uniform float uLineSharpness;
uniform float uGlowFalloff;
uniform float uGlowIntensity;
uniform float uBrightness;
uniform float uBlueBoost;
uniform float uVignette;
uniform vec3 uLineColor;
uniform vec3 uGlowColor;
uniform vec3 uCenterTone;
uniform vec3 uCloudTone;
uniform vec3 uBackground;

out vec4 fragColor;

#define MAX_LAYERS 10

void main() {
  vec2 uv = (2.0 * gl_FragCoord.xy - uResolution) / uResolution.y;
  vec2 p = uRotation * (uv * uInvScale);
  vec3 color = vec3(0.0);

  for (int index = 0; index < MAX_LAYERS; index++) {
    float fi = float(index) + 1.0;
    if (fi > uLayers) break;

    p += uWaveAmplitude * sin(p.yx * fi * uWaveFrequency + uTime * (uWaveSpeed + fi * uLayerSpeed));

    float radius = length(p);
    float polarAngle = atan(p.y, p.x) + sin(radius * uTwistFrequency - uTime * uTwistSpeed + fi) * uTwist;
    p = vec2(cos(polarAngle), sin(polarAngle)) * radius;

    float lines = abs(sin(p.x * (uLineFrequency + fi * uLineSpacing) + sin(p.y * 3.0 + uTime)));
    color += uLineColor * pow(max(0.0, 1.0 - lines), uLineSharpness) / fi;

    float glow = exp(-uGlowFalloff * abs(sin(p.x * 3.0 + uTime + fi)));
    color += uGlowColor * glow * uGlowIntensity / (fi * 2.0);
  }

  color += uCenterTone * exp(-2.2 * dot(uv, uv));
  color += uCloudTone * exp(-1.5 * length(uv + uCloudOffset));

  float vignette = 1.0 - smoothstep(0.35, 1.45, length(uv));
  color *= mix(1.0 - uVignette, 1.0, vignette);
  color = 1.0 - exp(-color * uBrightness);
  color.b *= uBlueBoost;

  fragColor = vec4(clamp(uBackground + color, 0.0, 1.0), 1.0);
}
`;

const hexToRgb = (hex: string): [number, number, number] => {
  const value = hex.trim().replace(/^#/, '');
  const normalized = value.length === 3 ? value.replace(/./g, (channel) => channel + channel) : value;
  const match = /^([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(normalized);
  if (!match) return [1, 1, 1];
  return [parseInt(match[1], 16) / 255, parseInt(match[2], 16) / 255, parseInt(match[3], 16) / 255];
};

export interface GhostFibersProps {
  /** Colour of the thin fibre cores. */
  lineColor?: string;
  /** Colour of the broad luminous bands. */
  glowColor?: string;
  /** Colour under the fibres (the original's fixed backdrop is #120F17). */
  backgroundColor?: string;
  speed?: number;
  scale?: number;
  /** Static rotation in degrees. */
  rotation?: number;
  rotationSpeed?: number;
  /** Fibre layers, 1 to 10. */
  layers?: number;
  waveAmplitude?: number;
  waveFrequency?: number;
  waveSpeed?: number;
  layerSpeed?: number;
  twist?: number;
  twistFrequency?: number;
  twistSpeed?: number;
  lineFrequency?: number;
  lineSpacing?: number;
  lineSharpness?: number;
  glowFalloff?: number;
  glowIntensity?: number;
  brightness?: number;
  blueBoost?: number;
  vignette?: number;
  /** Canvas pixels per CSS pixel. Below 1 trades sharpness for GPU time. */
  renderScale?: number;
  maxFps?: number;
  /** Holds the current frame and stops drawing. */
  paused?: boolean;
  className?: string;
  onReady?: () => void;
  onError?: () => void;
}

export default function GhostFibers({
  lineColor = '#140E35',
  glowColor = '#3437A0',
  backgroundColor = '#120F17',
  speed = 0.2,
  scale = 2,
  rotation = 0,
  rotationSpeed = 0.25,
  layers = 4,
  waveAmplitude = 0.015,
  waveFrequency = 3,
  waveSpeed = 0.15,
  layerSpeed = 0.08,
  twist = 0.1,
  twistFrequency = 5,
  twistSpeed = 1.2,
  lineFrequency = 5,
  lineSpacing = 2,
  lineSharpness = 16,
  glowFalloff = 10,
  glowIntensity = 1.6,
  brightness = 2,
  blueBoost = 1.25,
  vignette = 0.8,
  renderScale = 1,
  maxFps = 60,
  paused = false,
  className,
  onReady,
  onError,
}: GhostFibersProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const pausedRef = useRef(paused);
  const resumeRef = useRef<() => void>(() => {});
  const callbacksRef = useRef({ onReady, onError });

  useEffect(() => {
    callbacksRef.current = { onReady, onError };
  }, [onReady, onError]);

  useEffect(() => {
    pausedRef.current = paused;
    if (!paused) resumeRef.current();
  }, [paused]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let renderer: Renderer;
    try {
      renderer = new Renderer({
        webgl: 2,
        alpha: false,
        antialias: false,
        depth: false,
        dpr: Math.min(Math.max(renderScale, 0.25), 2),
        powerPreference: 'low-power',
      });
    } catch {
      callbacksRef.current.onError?.();
      return;
    }
    const gl = renderer.gl;
    if (!renderer.isWebgl2) {
      gl.getExtension('WEBGL_lose_context')?.loseContext();
      callbacksRef.current.onError?.();
      return;
    }

    const lineRgb = hexToRgb(lineColor);
    const glowRgb = hexToRgb(glowColor);
    // Per-pixel constants of the original, worked out once.
    const centerTone = lineRgb.map((value, i) => Math.max(value * 0.85567 - glowRgb[i] * 0.06186, 0));
    const cloudTone = lineRgb.map((value, i) => value * 0.19588 + glowRgb[i] * 0.2268);

    const program = new Program(gl, {
      vertex,
      fragment,
      uniforms: {
        uResolution: { value: new Float32Array([1, 1]) },
        uTime: { value: 0 },
        uInvScale: { value: 1 / Math.max(scale, 0.05) },
        uRotation: { value: new Float32Array([1, 0, 0, 1]) },
        uCloudOffset: { value: new Float32Array([0, 0]) },
        uLayers: { value: Math.min(Math.max(Math.round(layers), 1), 10) },
        uWaveAmplitude: { value: waveAmplitude },
        uWaveFrequency: { value: waveFrequency },
        uWaveSpeed: { value: waveSpeed },
        uLayerSpeed: { value: layerSpeed },
        uTwist: { value: twist },
        uTwistFrequency: { value: twistFrequency },
        uTwistSpeed: { value: twistSpeed },
        uLineFrequency: { value: lineFrequency },
        uLineSpacing: { value: lineSpacing },
        uLineSharpness: { value: lineSharpness },
        uGlowFalloff: { value: glowFalloff },
        uGlowIntensity: { value: glowIntensity },
        uBrightness: { value: brightness },
        uBlueBoost: { value: blueBoost },
        uVignette: { value: vignette },
        uLineColor: { value: new Float32Array(lineRgb) },
        uGlowColor: { value: new Float32Array(glowRgb) },
        uCenterTone: { value: new Float32Array(centerTone) },
        uCloudTone: { value: new Float32Array(cloudTone) },
        uBackground: { value: new Float32Array(hexToRgb(backgroundColor)) },
      },
    });
    if (!gl.getProgramParameter(program.program, gl.LINK_STATUS)) {
      gl.getExtension('WEBGL_lose_context')?.loseContext();
      callbacksRef.current.onError?.();
      return;
    }
    const mesh = new Mesh(gl, { geometry: new Triangle(gl), program });
    const uniforms = program.uniforms;

    /** Moves the animation to `seconds` (wall-clock time the animation has been running). */
    const setTime = (seconds: number) => {
      const time = seconds * speed;
      const angle = (rotation * Math.PI) / 180 + time * rotationSpeed;
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      uniforms.uTime.value = time;
      uniforms.uRotation.value.set([cos, -sin, sin, cos]);
      uniforms.uCloudOffset.value.set([Math.sin(time * 0.3) * 0.25, Math.cos(time * 0.25) * 0.18]);
    };
    const render = () => renderer.render({ scene: mesh });

    const canvas = gl.canvas;
    canvas.setAttribute('aria-hidden', 'true');
    container.appendChild(canvas);

    let running = false;
    let rafId = 0;
    let timer = 0;
    let lastFrame = 0;
    let elapsed = 0;
    let readyReported = false;
    const frameInterval = 1000 / Math.min(Math.max(maxFps, 1), 60);

    const frame = (now: number) => {
      rafId = 0;
      if (pausedRef.current || document.hidden) {
        running = false;
        return;
      }
      // Woken a little early: wait for the next display refresh rather than draw too often.
      if (lastFrame !== 0 && now - lastFrame < frameInterval - 2) {
        rafId = requestAnimationFrame(frame);
        return;
      }
      elapsed += lastFrame === 0 ? 0 : Math.min(now - lastFrame, 100);
      lastFrame = now;
      setTime(elapsed / 1000);
      render();

      if (!readyReported) {
        readyReported = true;
        callbacksRef.current.onReady?.();
      }
      // Sleep through most of the frame budget, then draw on a display refresh.
      timer = window.setTimeout(() => {
        timer = 0;
        rafId = requestAnimationFrame(frame);
      }, Math.max(0, frameInterval - 12));
    };

    const resume = () => {
      if (running || pausedRef.current || document.hidden) return;
      running = true;
      lastFrame = 0;
      rafId = requestAnimationFrame(frame);
    };
    resumeRef.current = resume;

    const resize = () => {
      renderer.setSize(Math.max(1, container.clientWidth), Math.max(1, container.clientHeight));
      uniforms.uResolution.value.set([gl.drawingBufferWidth, gl.drawingBufferHeight]);
      // While paused, redraw the held frame at the new size instead of leaving it stretched.
      if (!running) render();
    };
    resize();
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(container);

    const handleVisibility = () => {
      if (!document.hidden) resume();
    };
    document.addEventListener('visibilitychange', handleVisibility);

    resume();

    return () => {
      cancelAnimationFrame(rafId);
      window.clearTimeout(timer);
      running = false;
      resumeRef.current = () => {};
      resizeObserver.disconnect();
      document.removeEventListener('visibilitychange', handleVisibility);
      canvas.remove();
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    };
  }, [
    lineColor,
    glowColor,
    backgroundColor,
    speed,
    scale,
    rotation,
    rotationSpeed,
    layers,
    waveAmplitude,
    waveFrequency,
    waveSpeed,
    layerSpeed,
    twist,
    twistFrequency,
    twistSpeed,
    lineFrequency,
    lineSpacing,
    lineSharpness,
    glowFalloff,
    glowIntensity,
    brightness,
    blueBoost,
    vignette,
    renderScale,
    maxFps,
  ]);

  return <div ref={containerRef} className={`ghost-fibers-container ${className ?? ''}`.trim()} />;
}
