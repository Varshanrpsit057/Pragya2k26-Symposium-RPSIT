import { describe, expect, it } from 'vitest';
import { backdropQuality, chooseBackdropMode, type DeviceSignals } from './capabilities';

const capable: DeviceSignals = {
  reducedMotion: false,
  saveData: false,
  webgl: true,
  deviceMemory: 8,
  hardwareConcurrency: 8,
};

describe('chooseBackdropMode', () => {
  it('uses WebGL on a capable device', () => {
    expect(chooseBackdropMode(capable)).toBe('webgl');
  });

  it('uses WebGL when the browser hides memory and core counts', () => {
    expect(
      chooseBackdropMode({ ...capable, deviceMemory: undefined, hardwareConcurrency: undefined }),
    ).toBe('webgl');
  });

  it.each<[string, Partial<DeviceSignals>]>([
    ['reduced motion', { reducedMotion: true }],
    ['data saver', { saveData: true }],
    ['no WebGL', { webgl: false }],
    ['low memory', { deviceMemory: 2 }],
    ['few CPU cores', { hardwareConcurrency: 2 }],
  ])('falls back to CSS for %s', (_, override) => {
    expect(chooseBackdropMode({ ...capable, ...override })).toBe('css');
  });
});

describe('backdropQuality', () => {
  it('animates at 30fps on computers and 24fps on phones and touch devices', () => {
    expect(backdropQuality(1440, false).maxFps).toBe(30);
    expect(backdropQuality(390, true).maxFps).toBe(24);
    expect(backdropQuality(700, false).maxFps).toBe(24);
  });

  it('renders at most half resolution, less on phones', () => {
    expect(backdropQuality(1440, false).renderScale).toBeLessThanOrEqual(0.5);
    expect(backdropQuality(390, true).renderScale).toBeLessThan(backdropQuality(1440, false).renderScale);
  });

  it('draws three fibre layers instead of the original four', () => {
    expect(backdropQuality(1440, false).layers).toBe(3);
    expect(backdropQuality(390, true).layers).toBe(3);
  });
});
