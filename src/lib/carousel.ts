/** What can hold the circular carousel's autoplay still. */
export interface PauseInputs {
  pauseOnHover: boolean;
  /** Mouse is over the carousel. */
  hover: boolean;
  /** A finger is on the carousel. */
  touchHold: boolean;
  /** The carousel has keyboard focus. */
  keyboardFocus: boolean;
  drag: boolean;
  /** Timestamp (ms) until which autoplay stays paused after an interaction. */
  holdUntil: number;
}

export function isCarouselPaused(inputs: PauseInputs, now: number): boolean {
  return (
    (inputs.pauseOnHover && (inputs.hover || inputs.touchHold)) ||
    inputs.keyboardFocus ||
    inputs.drag ||
    now < inputs.holdUntil
  );
}
