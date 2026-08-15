/**
 * Onboarding illustrations, as inline SVG.
 *
 * Inline rather than files: they are theme-aware (they read the same CSS custom
 * properties as the rest of the app, so they recolour in dark mode for free)
 * and they add nothing to the network waterfall on the first screen a new user
 * ever sees.
 *
 * All three are marked aria-hidden — the heading beside them already carries
 * the meaning, and describing decorative art to a screen reader is noise.
 */

const cardShadow = 'drop-shadow(0 8px 20px rgb(15 16 32 / 0.10))';

export function MatchIllustration({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 320 240" className={className} aria-hidden="true" fill="none">
      <defs>
        <linearGradient id="il-match-a" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="var(--brand)" />
          <stop offset="100%" stopColor="var(--violet-800, #4a2eae)" />
        </linearGradient>
      </defs>

      {/* Back cards — the stack of roles being sorted through */}
      <g style={{ filter: cardShadow }}>
        <rect x="66" y="34" width="188" height="60" rx="14" fill="var(--bg-surface)" opacity="0.5" />
        <rect x="56" y="52" width="208" height="64" rx="15" fill="var(--bg-surface)" opacity="0.75" />
      </g>

      {/* Front card */}
      <g style={{ filter: cardShadow }}>
        <rect x="44" y="74" width="232" height="86" rx="16" fill="var(--bg-surface)" />
        <rect x="44.5" y="74.5" width="231" height="85" rx="15.5" stroke="var(--border-default)" />
        <rect x="62" y="92" width="42" height="42" rx="12" fill="url(#il-match-a)" />
        <rect x="118" y="96" width="104" height="10" rx="5" fill="var(--fg-default)" opacity="0.82" />
        <rect x="118" y="114" width="72" height="8" rx="4" fill="var(--fg-muted)" opacity="0.45" />
        <rect x="118" y="130" width="46" height="8" rx="4" fill="var(--brand)" opacity="0.28" />
        <rect x="170" y="130" width="38" height="8" rx="4" fill="var(--brand)" opacity="0.28" />
      </g>

      {/* Match score badge */}
      <g style={{ filter: 'drop-shadow(0 6px 16px rgb(18 185 129 / 0.35))' }}>
        <rect x="222" y="132" width="64" height="30" rx="15" fill="var(--success)" />
        <path
          d="m236 147 5 5 9-10"
          stroke="#fff"
          strokeWidth="2.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <text
          x="258"
          y="152"
          fill="#fff"
          fontSize="12"
          fontWeight="700"
          fontFamily="Inter, sans-serif"
        >
          92%
        </text>
      </g>

      {/* Floating skill chips */}
      <rect x="30" y="180" width="70" height="24" rx="12" fill="var(--brand-subtle)" />
      <rect x="42" y="189" width="46" height="6" rx="3" fill="var(--brand)" opacity="0.55" />
      <rect x="112" y="186" width="58" height="24" rx="12" fill="var(--accent-subtle)" />
      <rect x="124" y="195" width="34" height="6" rx="3" fill="var(--accent)" opacity="0.65" />
      <rect x="182" y="180" width="64" height="24" rx="12" fill="var(--brand-subtle)" />
      <rect x="194" y="189" width="40" height="6" rx="3" fill="var(--brand)" opacity="0.55" />
    </svg>
  );
}

export function PipelineIllustration({ className }: { className?: string }) {
  const stages = [
    { x: 34, height: 44, fill: 'var(--brand)', opacity: 1 },
    { x: 106, height: 44, fill: 'var(--brand)', opacity: 0.72 },
    { x: 178, height: 44, fill: 'var(--brand)', opacity: 0.44 },
    { x: 250, height: 44, fill: 'var(--border-strong)', opacity: 1 },
  ];

  return (
    <svg viewBox="0 0 320 240" className={className} aria-hidden="true" fill="none">
      {/* Track connecting the stages */}
      <path
        d="M52 120h216"
        stroke="var(--border-default)"
        strokeWidth="3"
        strokeLinecap="round"
        strokeDasharray="1 10"
      />

      {stages.map((stage, index) => (
        <g key={stage.x} style={{ filter: index < 3 ? cardShadow : undefined }}>
          <rect
            x={stage.x}
            y={98}
            width={stage.height}
            height={stage.height}
            rx="14"
            fill={stage.fill}
            opacity={stage.opacity}
          />
          {index < 3 && (
            <path
              d={`m${stage.x + 13} 120 5 5 10-11`}
              stroke="#fff"
              strokeWidth="2.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          )}
        </g>
      ))}

      {/* Stage labels as abstract bars — real text would need translating and
          would fight the heading for attention. */}
      {stages.map((stage) => (
        <rect
          key={`label-${stage.x}`}
          x={stage.x + 4}
          y={156}
          width={36}
          height={7}
          rx="3.5"
          fill="var(--fg-muted)"
          opacity="0.32"
        />
      ))}

      {/* Candidate card entering the pipeline */}
      <g style={{ filter: cardShadow }}>
        <rect x="96" y="30" width="128" height="46" rx="14" fill="var(--bg-surface)" />
        <rect x="96.5" y="30.5" width="127" height="45" rx="13.5" stroke="var(--border-default)" />
        <circle cx="120" cy="53" r="13" fill="var(--accent)" opacity="0.85" />
        <rect x="142" y="44" width="62" height="8" rx="4" fill="var(--fg-default)" opacity="0.8" />
        <rect x="142" y="58" width="40" height="7" rx="3.5" fill="var(--fg-muted)" opacity="0.4" />
      </g>

      <path
        d="M160 80v12"
        stroke="var(--brand)"
        strokeWidth="3"
        strokeLinecap="round"
        strokeDasharray="1 7"
      />
    </svg>
  );
}

export function NetworkIllustration({ className }: { className?: string }) {
  const nodes = [
    { cx: 160, cy: 118, r: 30, fill: 'var(--brand)' },
    { cx: 66, cy: 66, r: 18, fill: 'var(--accent)' },
    { cx: 258, cy: 74, r: 20, fill: 'var(--brand)' },
    { cx: 58, cy: 172, r: 16, fill: 'var(--brand)' },
    { cx: 254, cy: 176, r: 22, fill: 'var(--accent)' },
    { cx: 160, cy: 26, r: 14, fill: 'var(--brand)' },
  ];

  return (
    <svg viewBox="0 0 320 240" className={className} aria-hidden="true" fill="none">
      {/* Connections drawn first so nodes sit on top of the lines */}
      <g stroke="var(--brand)" strokeWidth="2" opacity="0.28" strokeLinecap="round">
        <path d="M160 118 66 66M160 118l98-44M160 118 58 172M160 118l94 58M160 118V26" />
      </g>
      <g stroke="var(--border-strong)" strokeWidth="1.5" opacity="0.5" strokeDasharray="4 6">
        <path d="M66 66 58 172M258 74l-4 102M66 66h94" />
      </g>

      {nodes.map((node, index) => (
        <g key={`${node.cx}-${node.cy}`}>
          <circle
            cx={node.cx}
            cy={node.cy}
            r={node.r + 6}
            fill={node.fill}
            opacity={index === 0 ? 0.16 : 0.1}
          />
          <circle cx={node.cx} cy={node.cy} r={node.r} fill={node.fill} opacity={index === 0 ? 1 : 0.85} />
          {index === 0 && (
            <>
              <circle cx={160} cy={110} r={9} fill="#fff" opacity="0.95" />
              <path
                d="M145 134a15 15 0 0 1 30 0"
                fill="#fff"
                opacity="0.95"
              />
            </>
          )}
        </g>
      ))}

      {/* Verified badge on one node — the trust signal from FR-1106 */}
      <g style={{ filter: 'drop-shadow(0 4px 10px rgb(18 185 129 / 0.4))' }}>
        <circle cx="276" cy="58" r="11" fill="var(--success)" />
        <path
          d="m271 58 3.5 3.5 6.5-7"
          stroke="#fff"
          strokeWidth="2.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </g>
    </svg>
  );
}
