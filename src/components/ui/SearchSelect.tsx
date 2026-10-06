import { useEffect, useMemo, useRef, useState, type FocusEvent, type KeyboardEvent } from 'react';
import './SearchSelect.css';

/*
 * A dropdown with a search box, styled like the form's own fields.
 *
 * The closed field is a button (Enter, Space or the arrow keys open it). Open, it shows a
 * search box over the list: type to filter, ↑/↓ to move, Enter to choose, Esc to close.
 * The list follows the WAI-ARIA combobox / listbox pattern so screen readers announce it.
 */

interface SearchSelectProps {
  /** id of the button; the field's <label htmlFor> points at it. */
  id: string;
  /** id of that visible label, which also names the list. */
  labelId: string;
  options: readonly string[];
  /** '' while nothing is chosen. */
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  searchPlaceholder: string;
  /** Announced name of the search box, e.g. 'Search departments'. */
  searchLabel: string;
  /** Shown when the search matches nothing. */
  emptyText?: (query: string) => string;
  invalid?: boolean;
  describedBy?: string;
}

/** Lowercase words, ignoring punctuation: 'Data Science (AI & DS)' → data, science, ai, ds. */
const words = (text: string) => text.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);

/**
 * Options in which every word of the search appears inside one of the option's words,
 * in their original order. 'cse' finds '(CSE)' but not 'Mechatronics Engineering'.
 */
export function filterOptions(options: readonly string[], query: string): string[] {
  const wanted = words(query);
  if (wanted.length === 0) return [...options];
  return options.filter((option) => {
    const optionWords = words(option);
    return wanted.every((word) => optionWords.some((optionWord) => optionWord.includes(word)));
  });
}

export function SearchSelect({
  id,
  labelId,
  options,
  value,
  onChange,
  placeholder,
  searchPlaceholder,
  searchLabel,
  emptyText = (query) => `Nothing matches “${query}”.`,
  invalid,
  describedBy,
}: SearchSelectProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);

  const filtered = useMemo(() => filterOptions(options, query), [options, query]);
  const listId = `${id}-list`;
  const optionId = (option: string) => `${id}-option-${options.indexOf(option)}`;
  const activeOption = filtered[Math.min(active, filtered.length - 1)];
  const activeId = open && activeOption !== undefined ? optionId(activeOption) : undefined;

  const openList = () => {
    setQuery('');
    setActive(Math.max(0, options.indexOf(value)));
    setOpen(true);
  };

  const closeList = (returnFocus = true) => {
    setOpen(false);
    if (returnFocus) triggerRef.current?.focus();
  };

  const choose = (option: string) => {
    onChange(option);
    closeList();
  };

  // On opening: focus the search box (on touch screens the list instead, so the on-screen
  // keyboard does not cover it), and scroll the form just enough to show the whole list.
  useEffect(() => {
    if (!open) return;
    const finePointer = window.matchMedia?.('(pointer: fine)').matches ?? true;
    (finePointer ? searchRef.current : listRef.current)?.focus({ preventScroll: true });
    popupRef.current?.scrollIntoView?.({ block: 'nearest' });
  }, [open]);

  // Keep the highlighted option in view while moving through the list.
  useEffect(() => {
    if (activeId) document.getElementById(activeId)?.scrollIntoView?.({ block: 'nearest' });
  }, [activeId]);

  // A tap or click anywhere else closes the list without choosing.
  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', closeOutside);
    return () => document.removeEventListener('pointerdown', closeOutside);
  }, [open]);

  // Tabbing away closes it too.
  const handleBlur = (event: FocusEvent<HTMLDivElement>) => {
    if (open && !rootRef.current?.contains(event.relatedTarget as Node | null)) setOpen(false);
  };

  const move = (step: number) =>
    setActive((current) => Math.min(Math.max(Math.min(current, filtered.length - 1) + step, 0), filtered.length - 1));

  const handleListKey = (event: KeyboardEvent<HTMLElement>) => {
    const inList = event.currentTarget === listRef.current;
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        move(1);
        break;
      case 'ArrowUp':
        event.preventDefault();
        move(-1);
        break;
      case 'PageDown':
        event.preventDefault();
        move(5);
        break;
      case 'PageUp':
        event.preventDefault();
        move(-5);
        break;
      case 'Home':
      case 'End':
        // In the search box these move the text cursor instead.
        if (!inList) break;
        event.preventDefault();
        setActive(event.key === 'Home' ? 0 : filtered.length - 1);
        break;
      case ' ':
        // In the search box Space types a space ("Data Science").
        if (!inList) break;
        event.preventDefault();
        if (activeOption !== undefined) choose(activeOption);
        break;
      case 'Enter':
        // Never submits the form from here.
        event.preventDefault();
        if (activeOption !== undefined) choose(activeOption);
        break;
      case 'Escape':
        // Closes only the list, not the window around the form.
        event.preventDefault();
        event.stopPropagation();
        closeList();
        break;
    }
  };

  const handleTriggerKey = (event: KeyboardEvent<HTMLButtonElement>) => {
    // Enter and Space press the button, which opens the list.
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      openList();
    }
  };

  return (
    <div ref={rootRef} className={`search-select${open ? ' is-open' : ''}`} onBlur={handleBlur}>
      <button
        ref={triggerRef}
        id={id}
        type="button"
        className="search-select__trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-labelledby={`${labelId} ${id}-value`}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        onClick={() => (open ? closeList() : openList())}
        onKeyDown={handleTriggerKey}
      >
        <span id={`${id}-value`} className={value ? 'search-select__value' : 'search-select__placeholder'}>
          {value || placeholder}
        </span>
        <svg className="search-select__chevron" width="12" height="8" viewBox="0 0 12 8" aria-hidden="true" focusable="false">
          <path d="M1 1.5l5 5 5-5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      </button>

      {open && (
        <div ref={popupRef} className="search-select__popup">
          <div className="search-select__search">
            <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
              <g fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <circle cx="11" cy="11" r="6.5" />
                <path d="M16 16l4.5 4.5" />
              </g>
            </svg>
            <input
              ref={searchRef}
              className="search-select__input"
              type="text"
              role="combobox"
              aria-label={searchLabel}
              aria-expanded="true"
              aria-controls={listId}
              aria-autocomplete="list"
              aria-activedescendant={activeId}
              placeholder={searchPlaceholder}
              autoComplete="off"
              spellCheck={false}
              value={query}
              onChange={(changeEvent) => {
                setQuery(changeEvent.target.value);
                setActive(0);
              }}
              onKeyDown={handleListKey}
            />
          </div>

          <ul
            ref={listRef}
            id={listId}
            className="search-select__list"
            role="listbox"
            aria-labelledby={labelId}
            aria-activedescendant={activeId}
            tabIndex={-1}
            onKeyDown={handleListKey}
          >
            {filtered.map((option, index) => {
              const selected = option === value;
              return (
                <li
                  key={option}
                  id={optionId(option)}
                  role="option"
                  aria-selected={selected}
                  className={[
                    'search-select__option',
                    selected && 'is-selected',
                    option === activeOption && 'is-active',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  // Keeps focus in the search box while the option is pressed.
                  onMouseDown={(mouseEvent) => mouseEvent.preventDefault()}
                  onMouseMove={() => {
                    if (index !== active) setActive(index);
                  }}
                  onClick={() => choose(option)}
                >
                  <span>{option}</span>
                  {selected && (
                    <svg className="search-select__check" width="16" height="16" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                      <path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  )}
                </li>
              );
            })}
          </ul>

          {filtered.length === 0 && (
            <p className="search-select__empty" role="status">
              {emptyText(query.trim())}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
