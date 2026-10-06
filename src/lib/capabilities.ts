/**
 * Decides whether a device can afford the animated WebGL background (GhostFibers) or should
 * keep the still CSS gradient, and how hard the background may work.
 * Kept as pure functions so the rules are easy to test and tune.
 */

export interface DeviceSignals {
  reducedMotion: boolean;
  saveData: boolean;
  webgl: boolean;
  /** Approximate RAM in GB (Chromium only). */
  deviceMemory?: number;
  hardwareConcurrency?: number;
}

export type BackdropMode = 'webgl' | 'css';

export function chooseBackdropMode(signals: DeviceSignals): BackdropMode {
  if (signals.reducedMotion || signals.saveData || !signals.webgl) return 'css';
  if (signals.deviceMemory !== undefined && signals.deviceMemory < 4) return 'css';
  if (signals.hardwareConcurrency !== undefined && signals.hardwareConcurrency < 4) return 'css';
  return 'webgl';
}

export interface BackdropQuality {
  /** Canvas pixels per CSS pixel; the soft fibres stay smooth when scaled up. */
  renderScale: number;
  maxFps: number;
  /** Fibre layers; each one is a full pass of the shader's loop. */
  layers: number;
}

export function backdropQuality(viewportWidth: number, coarsePointer: boolean): BackdropQuality {
  if (coarsePointer || viewportWidth < 768) {
    return { renderScale: 0.4, maxFps: 24, layers: 3 };
  }
  return { renderScale: 0.5, maxFps: 30, layers: 3 };
}

interface NavigatorHints {
  deviceMemory?: number;
  connection?: { saveData?: boolean };
}

export function readDeviceSignals(): DeviceSignals {
  const nav = navigator as Navigator & NavigatorHints;
  return {
    reducedMotion: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    saveData: nav.connection?.saveData === true,
    // GhostFibers' shader is GLSL ES 3.0, so it needs WebGL 2.
    webgl: 'WebGL2RenderingContext' in window,
    deviceMemory: nav.deviceMemory,
    hardwareConcurrency: nav.hardwareConcurrency || undefined,
  };
}
