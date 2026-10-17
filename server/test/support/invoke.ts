import { Readable, Writable } from 'node:stream';
import type express from 'express';

export interface Invoked {
  status: number;
  body: any;
  text: string;
  headers: Record<string, string>;
}

/**
 * Runs an Express app without binding a socket. supertest listens on
 * 0.0.0.0, which some sandboxes reject with EPERM; the app is still a
 * (req, res) function, so a duck-typed pair is enough.
 */
export function invoke(
  app: express.Express,
  method: string,
  url: string,
  payload?: unknown,
  requestHeaders?: Record<string, string>
): Promise<Invoked> {
  const raw = payload === undefined ? null : Buffer.from(JSON.stringify(payload));
  return new Promise((resolve, reject) => {
    const req = Readable.from(raw ? [raw] : []) as Readable & {
      method: string;
      url: string;
      headers: Record<string, string>;
      socket: { remoteAddress: string };
    };
    req.method = method;
    req.url = url;
    req.headers = {
      'content-type': 'application/json',
      'content-length': raw ? String(raw.length) : '0',
      ...Object.fromEntries(
        Object.entries(requestHeaders ?? {}).map(([name, value]) => [name.toLowerCase(), value])
      )
    };
    req.socket = { remoteAddress: '127.0.0.1' };

    const chunks: Buffer[] = [];
    let statusCode = 200;
    const headers: Record<string, string> = {};
    const res = new Writable({
      write(chunk, _enc, cb) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        cb();
      }
    }) as Writable & {
      statusCode: number;
      headers: Record<string, string>;
      setHeader: (name: string, value: unknown) => typeof res;
      getHeader: (name: string) => string | undefined;
      removeHeader: (name: string) => void;
      writeHead: (code: number, extra?: Record<string, unknown>) => typeof res;
      end: (chunk?: unknown) => typeof res;
    };
    res.statusCode = statusCode;
    res.headers = headers;
    res.setHeader = (name, value) => {
      headers[name.toLowerCase()] = String(value);
      return res;
    };
    res.getHeader = (name) => headers[name.toLowerCase()];
    res.removeHeader = (name) => {
      delete headers[name.toLowerCase()];
    };
    res.writeHead = (code, extra) => {
      res.statusCode = code;
      statusCode = code;
      if (extra) for (const [k, v] of Object.entries(extra)) res.setHeader(k, v);
      return res;
    };
    const finish = (chunk?: unknown) => {
      if (chunk !== undefined && chunk !== null) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
      }
      const text = Buffer.concat(chunks).toString('utf8');
      let body: unknown = text;
      if (text) {
        try {
          body = JSON.parse(text);
        } catch {
          body = text;
        }
      } else {
        body = undefined;
      }
      resolve({ status: res.statusCode, body, text, headers });
    };
    res.end = (chunk?: unknown) => {
      finish(chunk);
      return res;
    };
    res.on('error', reject);
    app(req as unknown as express.Request, res as unknown as express.Response);
  });
}
