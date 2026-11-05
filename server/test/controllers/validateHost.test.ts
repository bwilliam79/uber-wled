import { describe, it, expect } from 'vitest';
import { RFC1918 } from '../../src/discovery/candidates.js';
import { assertValidHost } from '../../src/controllers/validateHost.js';

/** A class B address built from the RFC 1918 block discovery already names. */
const rfc1918ClassB = `${RFC1918.classB.first}.${RFC1918.classB.secondMin}.3.5`;

describe('assertValidHost', () => {
  it('accepts valid hostnames', () => {
    expect(() => assertValidHost('wled-porch')).not.toThrow();
    expect(() => assertValidHost('wled-porch.local')).not.toThrow();
    expect(() => assertValidHost('a.b.c')).not.toThrow();
  });

  it('accepts valid hostnames with a port', () => {
    expect(() => assertValidHost('wled-porch.local:80')).not.toThrow();
    expect(() => assertValidHost('wled-porch:8080')).not.toThrow();
  });

  it('accepts valid IPv4 addresses', () => {
    expect(() => assertValidHost('192.0.2.50')).not.toThrow();
    expect(() => assertValidHost('203.0.113.1')).not.toThrow();
    expect(() => assertValidHost('255.255.255.255')).not.toThrow();
    expect(() => assertValidHost('0.0.0.0')).not.toThrow();
  });

  it('accepts valid IPv4 addresses with a port', () => {
    expect(() => assertValidHost('192.0.2.50:80')).not.toThrow();
    expect(() => assertValidHost('203.0.113.1:65535')).not.toThrow();
  });

  it('does not reject private/RFC1918 IP ranges — these are where real WLED controllers live', () => {
    expect(() => assertValidHost('198.51.100.1')).not.toThrow();
    expect(() => assertValidHost('203.0.113.5')).not.toThrow();
    expect(() => assertValidHost(rfc1918ClassB)).not.toThrow();
  });

  it('rejects values containing a URL scheme', () => {
    expect(() => assertValidHost('http://192.0.2.50')).toThrow(/scheme/i);
    expect(() => assertValidHost('https://evil.example.com')).toThrow(/scheme/i);
  });

  it('rejects values containing a path', () => {
    expect(() => assertValidHost('192.0.2.50/admin')).toThrow(/path|query/i);
    expect(() => assertValidHost('wled-porch/../etc')).toThrow(/path|query/i);
  });

  it('rejects values containing whitespace', () => {
    expect(() => assertValidHost('192.0.2.50 ')).toThrow(/whitespace/i);
    expect(() => assertValidHost('192.0.2.50\n')).toThrow(/whitespace/i);
    expect(() => assertValidHost('192.0.2.50 extra')).toThrow(/whitespace/i);
  });

  it('rejects an empty or non-string host', () => {
    expect(() => assertValidHost('')).toThrow();
    // @ts-expect-error testing runtime guard against non-string input
    expect(() => assertValidHost(undefined)).toThrow();
    // @ts-expect-error testing runtime guard against non-string input
    expect(() => assertValidHost(null)).toThrow();
  });

  it('rejects a host with an invalid port', () => {
    expect(() => assertValidHost('192.0.2.50:notaport')).toThrow(/port/i);
    expect(() => assertValidHost('192.0.2.50:999999')).toThrow(/port/i);
    expect(() => assertValidHost('192.0.2.50:')).toThrow(/port|missing/i);
  });

  it('rejects garbage input', () => {
    expect(() => assertValidHost('..')).toThrow();
    expect(() => assertValidHost('-leading-hyphen')).toThrow();
    expect(() => assertValidHost('trailing-hyphen-')).toThrow();
    expect(() => assertValidHost('has a space and a scheme: http://x')).toThrow();
  });
});
