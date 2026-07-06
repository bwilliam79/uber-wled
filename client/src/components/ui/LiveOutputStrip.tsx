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
 * gradient` renders the segment's actual current per-pixel colors instead.
 */
export function LiveOutputStrip({ swatches, size = 'md', className }: LiveOutputStripProps) {
  const cls = ['ui-live-strip', size === 'sm' ? 'ui-live-strip-sm' : '', className ?? '']
    .filter(Boolean).join(' ');
  return (
    <div className={cls} role="img" aria-label="Live output">
      {swatches.map((sw) => (
        <span
          key={sw.key}
          className={`ui-live-swatch ui-live-swatch-${sw.state}`}
          style={{
            flexGrow: sw.len,
            flexBasis: 0,
            ...(sw.gradient
              ? { background: sw.gradient }
              : sw.state === 'on' || sw.state === 'off' ? { backgroundColor: sw.color } : undefined)
          }}
          title={STATE_LABEL[sw.state]}
          data-testid={`live-swatch-${sw.key}`}
        />
      ))}
    </div>
  );
}
