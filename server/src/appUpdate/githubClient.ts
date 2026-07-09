// Checks the canonical uber-wled repo for a newer version than what this
// instance is running — same "is there something new upstream" idea as the
// WLED firmware check (firmware/githubClient.ts), but against this project's
// own repo rather than a per-controller device. The repo has no GitHub
// Releases/tags (unlike WLED's), so there's nothing to list — instead this
// reads server/package.json straight off the tip of main via GitHub's raw
// content CDN, which is unauthenticated and not subject to the api.github.com
// rate limit.
const PACKAGE_JSON_URL = 'https://raw.githubusercontent.com/bwilliam79/uber-wled/main/server/package.json';
export const REPO_URL = 'https://github.com/bwilliam79/uber-wled';

export async function fetchLatestAppVersion(): Promise<string> {
  const res = await fetch(PACKAGE_JSON_URL);
  if (!res.ok) throw new Error(`GitHub raw content request failed: ${res.status}`);
  const pkg = (await res.json()) as { version?: string };
  if (!pkg.version) throw new Error('server/package.json on main has no version field');
  return pkg.version;
}
