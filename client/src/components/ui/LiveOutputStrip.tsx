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
 * readout driven by useLiveStatus (SSE), as opposed to WLED's own native
 * /liveview page (which polls a 501-returning endpoint on firmware 16 and is
 * kept as a separate, opt-in iframe — see InfoTab.tsx).
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
          style={sw.state === 'on' || sw.state === 'off' ? { backgroundColor: sw.color } : undefined}
          title={STATE_LABEL[sw.state]}
          data-testid={`live-swatch-${sw.key}`}
        />
      ))}
    </div>
  );
}
