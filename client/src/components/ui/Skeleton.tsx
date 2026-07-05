export interface SkeletonProps {
  width?: string;
  height?: string;
  radius?: string;
}

export function Skeleton({ width = '100%', height = '1rem', radius = 'var(--radius-control)' }: SkeletonProps) {
  return <span className="ui-skeleton" aria-hidden="true" style={{ width, height, borderRadius: radius }} />;
}
