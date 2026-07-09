import type { LiveOutputSwatch } from '../../lib/liveOutputSwatches';

export interface LiveOutputStripProps {
  swatches: LiveOutputSwatch[];
  size?: 'sm' | 'md';
  className?: string;
}

const STATE_LABEL: Record<LiveOutputSwatch['state'], string> = {
  on: 'on',
  off: 'off',
  unreachable: 'unreachable',
  pending: 'waiting for data'
};

/**
 * Compact horizontal strip of colored swatches — the real-time "live output"
 * readout. Each swatch's flat `color` comes from useLiveStatus (SSE, polling
 * /json/state — so it's only ever the segment's *configured* color slot, not
 * necessarily what's actually lit for animated effects). When a real frame
 * from the live-view WebSocket is available (see api/liveWsPixels.ts), `sw.
 * pixels` renders the segment's actual current per-pixel colors as a row of
 * discrete glowing dots (the design's per-pixel LED readout) instead.
 */
export function LiveOutputStrip({ swatches, size = 'md', className }: LiveOutputStripProps) {
  const cls = ['ui-live-strip', size === 'sm' ? 'ui-live-strip-sm' : '', className ?? '']
    .filter(Boolean).join(' ');
  return (
    <div className={cls} role="img" aria-label="Live output">
      {swatches.map((sw) =>
        sw.pixels ? (
          <span
            key={sw.key}
            className={`ui-live-swatch ui-live-swatch-${sw.state} ui-live-swatch-pixels`}
            style={{ flexGrow: sw.len, flexBasis: 0 }}
            title={STATE_LABEL[sw.state]}
            data-testid={`live-swatch-${sw.key}`}
          >
            {sw.pixels.map((c, i) => (
              <span
                key={i}
                className="ui-live-dot"
                style={{ backgroundColor: c, boxShadow: `0 0 4px ${c}` }}
              />
            ))}
          </span>
        ) : (
          <span
            key={sw.key}
            className={`ui-live-swatch ui-live-swatch-${sw.state}`}
            style={{
              flexGrow: sw.len,
              flexBasis: 0,
              ...(sw.state === 'on' || sw.state === 'off' ? { backgroundColor: sw.color } : undefined)
            }}
            title={STATE_LABEL[sw.state]}
            data-testid={`live-swatch-${sw.key}`}
          />
        )
      )}
    </div>
  );
}
