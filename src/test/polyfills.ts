// Runs before any test imports React. jsdom has no AnimationEvent, which makes React
// listen for the prefixed `webkitAnimationEnd` instead of `animationend`. Real browsers
// all have AnimationEvent, so define a minimal one to match them.
if (typeof window !== 'undefined' && !('AnimationEvent' in window)) {
  class AnimationEventPolyfill extends Event {
    readonly animationName: string;
    readonly elapsedTime: number;
    readonly pseudoElement: string;

    constructor(type: string, init: AnimationEventInit = {}) {
      super(type, init);
      this.animationName = init.animationName ?? '';
      this.elapsedTime = init.elapsedTime ?? 0;
      this.pseudoElement = init.pseudoElement ?? '';
    }
  }

  Object.defineProperty(window, 'AnimationEvent', { value: AnimationEventPolyfill, configurable: true });
}
