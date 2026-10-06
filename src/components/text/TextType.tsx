import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ElementType,
  type ReactNode,
} from 'react';
import { useInView } from '../../hooks/useInView';
import { usePrefersReducedMotion } from '../../hooks/useMediaQuery';
import './TextType.css';

/*
 * Adapted from React Bits' TextType. Differences from the original:
 *  - the cursor blinks with a CSS animation instead of GSAP (no dependency);
 *  - typing pauses while the element is off screen;
 *  - users who prefer reduced motion see `staticText` instead of the animation;
 *  - every state change happens in a timer callback, never synchronously in an effect.
 */

interface TextTypeProps {
  text: string | string[];
  as?: ElementType;
  typingSpeed?: number;
  initialDelay?: number;
  pauseDuration?: number;
  deletingSpeed?: number;
  loop?: boolean;
  className?: string;
  showCursor?: boolean;
  hideCursorWhileTyping?: boolean;
  cursorCharacter?: ReactNode;
  cursorClassName?: string;
  /** Seconds for one blink half-cycle. */
  cursorBlinkDuration?: number;
  textColors?: string[];
  variableSpeed?: { min: number; max: number };
  onSentenceComplete?: (sentence: string, index: number) => void;
  /** Shown instead of the animation when the user prefers reduced motion. */
  staticText?: string;
  'aria-hidden'?: boolean;
}

type Phase = 'typing' | 'deleting';

interface TypingState {
  index: number;
  count: number;
  phase: Phase;
}

const GAP_AFTER_DELETE = 260;

export default function TextType({
  text,
  as: Component = 'div',
  typingSpeed = 50,
  initialDelay = 0,
  pauseDuration = 2000,
  deletingSpeed = 30,
  loop = true,
  className = '',
  showCursor = true,
  hideCursorWhileTyping = false,
  cursorCharacter = '|',
  cursorClassName = '',
  cursorBlinkDuration = 0.5,
  textColors = [],
  variableSpeed,
  onSentenceComplete,
  staticText,
  'aria-hidden': ariaHidden,
}: TextTypeProps) {
  const texts = useMemo(() => (Array.isArray(text) ? text : [text]), [text]);
  const containerRef = useRef<HTMLElement>(null);
  const hasStarted = useRef(false);
  const [state, setState] = useState<TypingState>({ index: 0, count: 0, phase: 'typing' });

  const reducedMotion = usePrefersReducedMotion();
  const inView = useInView(containerRef);
  const running = inView && !reducedMotion;

  useEffect(() => {
    if (!running) return;

    const current = texts[state.index] ?? '';
    const isLast = state.index === texts.length - 1;
    let delay: number;
    let next: TypingState;

    if (state.phase === 'typing') {
      if (state.count < current.length) {
        const speed = variableSpeed
          ? Math.random() * (variableSpeed.max - variableSpeed.min) + variableSpeed.min
          : typingSpeed;
        delay = hasStarted.current ? speed : initialDelay;
        next = { ...state, count: state.count + 1 };
      } else {
        if (!loop && isLast) return;
        delay = pauseDuration;
        next = { ...state, phase: 'deleting' };
      }
    } else if (state.count > 0) {
      delay = deletingSpeed;
      next = { ...state, count: state.count - 1 };
    } else {
      delay = GAP_AFTER_DELETE;
      next = { index: (state.index + 1) % texts.length, count: 0, phase: 'typing' };
    }

    const timer = window.setTimeout(() => {
      hasStarted.current = true;
      if (state.phase === 'deleting' && state.count === 0) {
        onSentenceComplete?.(current, state.index);
      }
      setState(next);
    }, delay);

    return () => window.clearTimeout(timer);
  }, [
    running,
    state,
    texts,
    typingSpeed,
    initialDelay,
    pauseDuration,
    deletingSpeed,
    loop,
    variableSpeed,
    onSentenceComplete,
  ]);

  const current = texts[state.index] ?? '';
  const displayed = reducedMotion ? (staticText ?? texts[0]) : current.slice(0, state.count);
  const color = textColors.length > 0 ? textColors[state.index % textColors.length] : undefined;
  const isTyping = state.phase === 'deleting' || state.count < current.length;
  const hideCursor = reducedMotion || (hideCursorWhileTyping && isTyping);

  return (
    <Component ref={containerRef} className={`text-type ${className}`.trim()} aria-hidden={ariaHidden}>
      <span className="text-type__content" style={color ? { color } : undefined}>
        {displayed}
      </span>
      {showCursor && (
        <span
          className={`text-type__cursor ${cursorClassName} ${hideCursor ? 'text-type__cursor--hidden' : ''}`}
          style={{ '--text-type-blink': `${cursorBlinkDuration}s` } as CSSProperties}
          aria-hidden="true"
        >
          {cursorCharacter}
        </span>
      )}
    </Component>
  );
}
