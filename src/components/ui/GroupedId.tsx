/**
 * A Registration ID shown in its three parts (26 · 2 · 005: the year, online or desk, the
 * participant number), easier to read out and remember. The gaps are only spacing, so it is
 * still read, copied and typed as one number.
 */
import { idParts } from '../../lib/registration';
import './GroupedId.css';

export function GroupedId({ id, className }: { id: string; className?: string }) {
  const { parts } = idParts(id);
  return (
    <span className={`grouped-id${className ? ` ${className}` : ''}`}>
      {parts.map((part, index) => (
        <span key={index} className="grouped-id__part">
          {part}
        </span>
      ))}
    </span>
  );
}
