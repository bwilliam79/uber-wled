// Matches a single DNS label: alphanumeric, may contain internal hyphens,
// must not start or end with a hyphen. 1-63 chars per RFC 1035.
const LABEL = '[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?';

// A hostname is one or more dot-separated labels (e.g. `wled-porch`,
// `wled-porch.local`).
const HOSTNAME_RE = new RegExp(`^${LABEL}(?:\\.${LABEL})*$`);

// A dotted-quad IPv4 address. Deliberately not range-restricted: real WLED
// controllers live on private/RFC1918 ranges (10.x, 192.168.x, etc.) and this
// app is intentionally LAN-only with no auth, so private IPs must stay valid.
const IPV4_OCTET = '(25[0-5]|2[0-4][0-9]|1[0-9]{2}|[1-9]?[0-9])';
const IPV4_RE = new RegExp(`^${IPV4_OCTET}(?:\\.${IPV4_OCTET}){3}$`);

const PORT_RE = /^[0-9]{1,5}$/;

/**
 * Validates that `host` is a syntactically plausible hostname or IPv4
 * address, optionally followed by `:<port>`.
 *
 * This is format validation only — it does NOT allowlist/blocklist any IP
 * ranges. Rejecting private/RFC1918 ranges would break the app's core use
 * case (controllers on a home LAN). The goal is only to reject garbage,
 * malformed, or URL-like input (e.g. values containing a scheme, a path,
 * or whitespace) before it's persisted or used to build an outbound
 * request URL.
 *
 * Throws an Error with a clear message if `host` is invalid.
 */
export function assertValidHost(host: string): void {
  if (typeof host !== 'string' || host.length === 0) {
    throw new Error('host must be a non-empty string');
  }
  if (host.length > 253) {
    throw new Error(`host is too long: ${host}`);
  }
  if (/\s/.test(host)) {
    throw new Error(`host must not contain whitespace: ${host}`);
  }
  if (host.includes('://')) {
    throw new Error(`host must not include a URL scheme: ${host}`);
  }
  if (host.includes('/') || host.includes('?') || host.includes('#')) {
    throw new Error(`host must not include a path or query: ${host}`);
  }

  let hostPart = host;
  const lastColon = host.lastIndexOf(':');
  if (lastColon !== -1) {
    hostPart = host.slice(0, lastColon);
    const portPart = host.slice(lastColon + 1);
    if (!PORT_RE.test(portPart) || Number(portPart) > 65535) {
      throw new Error(`host has an invalid port: ${host}`);
    }
    if (hostPart.length === 0) {
      throw new Error(`host is missing before the port: ${host}`);
    }
  }

  if (IPV4_RE.test(hostPart)) {
    return;
  }
  if (HOSTNAME_RE.test(hostPart)) {
    return;
  }

  throw new Error(`host is not a valid hostname or IPv4 address: ${host}`);
}
