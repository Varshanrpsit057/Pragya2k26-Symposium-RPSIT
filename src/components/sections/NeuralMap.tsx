import { useRef, type CSSProperties } from 'react';
import { categoryLabels, eventAnchor, eventsByCategory } from '../../content/events';
import type { SymposiumEvent } from '../../content/types';
import { useInView } from '../../hooks/useInView';
import { eventIconPaths } from '../icons/EventIcon';
import './NeuralMap.css';

/*
 * The programme as a small neural network: each event is a node wired into the
 * PRAGYA core, shown as its icon on a track-coloured tile. Technical signals flow in,
 * non-technical signals flow out. Pulses run only while the figure is on screen.
 * Nodes link to their event cards.
 */

const VIEW_W = 520;
const VIEW_H = 440;
const HUB = { x: 260, y: 220 };
const TILE = 38;
const HALO = 54;
/** Scales the 24-unit icon artwork to sit inside a tile. */
const ICON_SCALE = 0.9;

const LEFT_POSITIONS = [
  { x: 92, y: 92 },
  { x: 156, y: 162 },
  { x: 62, y: 218 },
  { x: 142, y: 292 },
  { x: 90, y: 366 },
];
const RIGHT_POSITIONS = LEFT_POSITIONS.map(({ x, y }) => ({ x: VIEW_W - x, y }));

interface PlacedNode {
  event: SymposiumEvent;
  x: number;
  y: number;
}

function place(list: SymposiumEvent[], positions: { x: number; y: number }[]): PlacedNode[] {
  return list.map((event, i) => ({ event, ...positions[i % positions.length] }));
}

/** Gentle curve between a node and the hub. */
function curve(from: { x: number; y: number }, to: { x: number; y: number }): string {
  const cx = (from.x + to.x) / 2;
  return `M${from.x} ${from.y} Q${cx} ${from.y} ${to.x} ${to.y}`;
}

const technical = place(eventsByCategory('technical'), LEFT_POSITIONS);
const nonTechnical = place(eventsByCategory('non-technical'), RIGHT_POSITIONS);

export function NeuralMap() {
  const ref = useRef<SVGSVGElement>(null);
  const live = useInView(ref, { rootMargin: '0px 0px -10% 0px' });

  const clusters: { nodes: PlacedNode[]; inbound: boolean }[] = [
    { nodes: technical, inbound: true },
    { nodes: nonTechnical, inbound: false },
  ];

  return (
    <svg
      ref={ref}
      className={`neural-map ${live ? 'is-live' : ''}`}
      viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
      role="group"
      aria-label="Event map: five technical and five non-technical events connected to PRAGYA 2026"
    >
      <defs>
        <radialGradient id="neural-map-hub" cx="50%" cy="40%" r="60%">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset=".45" stopColor="#b9a8ff" />
          <stop offset="1" stopColor="#8c6cff" />
        </radialGradient>
        {/* Same track gradients as the hovered event-card icon tiles */}
        <linearGradient id="neural-map-technical" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#45e3ff" />
          <stop offset="1" stopColor="#8c6cff" />
        </linearGradient>
        <linearGradient id="neural-map-non-technical" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#ff5cc8" />
          <stop offset="1" stopColor="#ffc15a" />
        </linearGradient>
      </defs>

      <text className="neural-map__caption" x="28" y="34" data-category="technical">
        {categoryLabels.technical}
      </text>
      <text
        className="neural-map__caption"
        x={VIEW_W - 28}
        y="34"
        textAnchor="end"
        data-category="non-technical"
      >
        {categoryLabels['non-technical']}
      </text>

      {clusters.map(({ nodes, inbound }) => (
        <g key={inbound ? 'in' : 'out'} data-category={nodes[0]?.event.category}>
          {/* Wiring within the cluster */}
          {nodes.slice(1).map((node, i) => (
            <line
              key={`chain-${node.event.id}`}
              className="neural-map__wire neural-map__wire--faint"
              x1={nodes[i].x}
              y1={nodes[i].y}
              x2={node.x}
              y2={node.y}
            />
          ))}

          {nodes.map((node, i) => {
            const d = inbound ? curve(node, HUB) : curve(HUB, node);
            return (
              <g key={node.event.id}>
                <path className="neural-map__wire" d={d} />
                <path
                  className="neural-map__pulse"
                  d={d}
                  pathLength={100}
                  style={{ '--delay': `${i * 0.55 + (inbound ? 0 : 0.3)}s` } as CSSProperties}
                />
              </g>
            );
          })}

          {nodes.map((node) => (
            <a
              key={`node-${node.event.id}`}
              className="neural-map__node"
              href={`#${eventAnchor(node.event)}`}
              aria-label={`${node.event.name}, ${categoryLabels[node.event.category]} event`}
            >
              <title>{node.event.name}</title>
              <g className="neural-map__node-body">
                <rect
                  className="neural-map__halo"
                  x={node.x - HALO / 2}
                  y={node.y - HALO / 2}
                  width={HALO}
                  height={HALO}
                  rx={HALO * 0.32}
                />
                <rect
                  className="neural-map__tile"
                  x={node.x - TILE / 2}
                  y={node.y - TILE / 2}
                  width={TILE}
                  height={TILE}
                  rx={TILE * 0.3}
                  fill={`url(#neural-map-${node.event.category})`}
                />
                <g
                  className="neural-map__icon"
                  transform={`translate(${node.x - 12 * ICON_SCALE} ${node.y - 12 * ICON_SCALE}) scale(${ICON_SCALE})`}
                >
                  {eventIconPaths[node.event.icon]}
                </g>
              </g>
            </a>
          ))}
        </g>
      ))}

      <g className="neural-map__hub">
        <circle cx={HUB.x} cy={HUB.y} r="34" className="neural-map__hub-ring" />
        <circle cx={HUB.x} cy={HUB.y} r="22" className="neural-map__hub-ring neural-map__hub-ring--inner" />
        <circle cx={HUB.x} cy={HUB.y} r="12" fill="url(#neural-map-hub)" />
      </g>
    </svg>
  );
}
