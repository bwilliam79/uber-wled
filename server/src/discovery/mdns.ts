import { Bonjour } from 'bonjour-service';

export function scanOnce(timeoutMs = 3000): Promise<{ host: string; name: string }[]> {
  return new Promise((resolve) => {
    const bonjour = new Bonjour();
    const found = new Map<string, string>();

    const browser = bonjour.find({ type: 'wled' }, (service) => {
      const host = service.addresses?.[0];
      if (host) found.set(host, service.name);
    });

    setTimeout(() => {
      browser.stop();
      bonjour.destroy();
      resolve(Array.from(found, ([host, name]) => ({ host, name })));
    }, timeoutMs);
  });
}
