/**
 * The PRAGYA 2K26 emblem, drawn in code: three flame-feather blades (the technical
 * cool-to-violet, then violet to the creative pink and gold) rising inside a glowing ring,
 * in the site's own colours (tokens.css: synapse, cortex, flare, solar). A soft aura fades
 * it into the sky behind it, so it never sits on the page like a cut-out picture.
 *
 * Decorative: the heading beside it says "PRAGYA 2026".
 */
export function PragyaEmblem({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 400 400" aria-hidden="true" focusable="false">
      <defs>
        <radialGradient id="pe-aura" cx="50%" cy="50%" r="50%">
          <stop offset="0" stopColor="#8c6cff" stopOpacity="0.42" />
          <stop offset="0.5" stopColor="#3437a0" stopOpacity="0.2" />
          <stop offset="1" stopColor="#05061a" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="pe-ring" x1="0.1" y1="0" x2="0.9" y2="1">
          <stop offset="0" stopColor="#45e3ff" />
          <stop offset="0.5" stopColor="#8c6cff" />
          <stop offset="1" stopColor="#ff5cc8" />
        </linearGradient>
        <linearGradient id="pe-blade-a" x1="0.2" y1="1" x2="0.7" y2="0">
          <stop offset="0" stopColor="#8c6cff" />
          <stop offset="1" stopColor="#45e3ff" />
        </linearGradient>
        <linearGradient id="pe-blade-b" x1="0.3" y1="1" x2="0.6" y2="0">
          <stop offset="0" stopColor="#5b3fd6" />
          <stop offset="0.55" stopColor="#b65cff" />
          <stop offset="1" stopColor="#ff5cc8" />
        </linearGradient>
        <linearGradient id="pe-blade-c" x1="0.25" y1="1" x2="0.65" y2="0">
          <stop offset="0" stopColor="#ff5cc8" />
          <stop offset="0.6" stopColor="#ff8a7a" />
          <stop offset="1" stopColor="#ffc15a" />
        </linearGradient>
        <linearGradient id="pe-gloss" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0.05" stopColor="#ffffff" stopOpacity="0.38" />
          <stop offset="0.45" stopColor="#ffffff" stopOpacity="0" />
        </linearGradient>
        <linearGradient id="pe-core" x1="0.5" y1="1" x2="0.5" y2="0">
          <stop offset="0" stopColor="#ffffff" stopOpacity="0.95" />
          <stop offset="1" stopColor="#ffc15a" stopOpacity="0.2" />
        </linearGradient>
        <filter id="pe-soft" x="-40%" y="-40%" width="180%" height="180%">
          <feGaussianBlur stdDeviation="10" />
        </filter>
        <filter id="pe-haze" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="3" />
        </filter>
      </defs>

      <circle cx="200" cy="200" r="200" fill="url(#pe-aura)" />

      {/* The ring: a soft halo, the bright line, an inner trace and a dotted orbit */}
      <circle cx="200" cy="200" r="166" fill="none" stroke="url(#pe-ring)" strokeWidth="12" opacity="0.28" filter="url(#pe-haze)" />
      <circle cx="200" cy="200" r="166" fill="none" stroke="url(#pe-ring)" strokeWidth="2.4" />
      <circle cx="200" cy="200" r="148" fill="none" stroke="#8c6cff" strokeOpacity="0.22" strokeWidth="1" />
      <circle
        cx="200"
        cy="200"
        r="184"
        fill="none"
        stroke="url(#pe-ring)"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeDasharray="0.1 10"
        opacity="0.75"
      />

      {/* Glow behind the flame */}
      <g filter="url(#pe-soft)" opacity="0.8">
        <path d="M198 322 C 158 268 162 192 208 136 C 228 110 236 80 226 44 C 274 74 306 138 290 202 C 278 250 238 292 198 322 Z" fill="#ff5cc8" />
        <path d="M188 322 C 134 296 110 234 132 178 C 142 150 158 124 180 100 C 178 152 180 224 204 272 Z" fill="#8c6cff" />
      </g>

      {/* Flame-feather blades, back to front */}
      <path d="M184 322 C 128 308 94 262 100 212 C 103 188 112 166 128 148 C 126 196 140 242 178 278 C 188 290 191 306 184 322 Z" fill="url(#pe-blade-a)" />
      <path
        d="M190 322 C 136 296 112 234 132 178 C 142 150 158 124 180 100 C 178 152 180 222 206 270 C 212 286 206 306 190 322 Z"
        fill="url(#pe-blade-b)"
        stroke="#05061a"
        strokeOpacity="0.35"
        strokeWidth="1.5"
      />
      <path
        d="M198 322 C 158 268 162 192 208 136 C 228 110 236 80 226 44 C 274 74 306 138 290 202 C 278 250 238 292 198 322 Z"
        fill="url(#pe-blade-c)"
        stroke="#05061a"
        strokeOpacity="0.35"
        strokeWidth="1.5"
      />
      <path d="M202 316 C 178 270 182 200 226 146 C 214 196 216 252 202 316 Z" fill="#b8327c" fillOpacity="0.38" />
      <path d="M198 322 C 158 268 162 192 208 136 C 228 110 236 80 226 44 C 274 74 306 138 290 202 C 278 250 238 292 198 322 Z" fill="url(#pe-gloss)" />

      {/* Feather barbs */}
      <g fill="none" stroke="#ffffff" strokeLinecap="round">
        <path d="M204 312 C 224 250 244 170 232 60" strokeOpacity="0.6" strokeWidth="2" />
        <path d="M214 268 C 234 256 256 238 272 210" strokeOpacity="0.24" strokeWidth="1.3" />
        <path d="M222 228 C 242 214 262 192 276 164" strokeOpacity="0.24" strokeWidth="1.3" />
        <path d="M232 188 C 250 172 266 150 274 122" strokeOpacity="0.24" strokeWidth="1.3" />
        <path d="M240 140 C 254 124 262 106 262 88" strokeOpacity="0.24" strokeWidth="1.3" />
        <path d="M194 306 C 164 266 156 210 174 142" strokeOpacity="0.3" strokeWidth="1.3" />
      </g>

      {/* The bright core at the root */}
      <path d="M198 320 C 186 298 190 270 210 248 C 214 272 218 294 198 320 Z" fill="url(#pe-core)" />
    </svg>
  );
}
