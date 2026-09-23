import { Bonjour } from 'bonjour-service';

function pickIPv4(addresses: string[] | undefined): string | undefined {
  if (!addresses?.length) return undefined;
  const v4 = addresses.find((a) => /^\d{1,3}(\.\d{1,3}){3}$/.test(a));
  return v4 || addresses[0];
}

export function scanOnce(timeoutMs = 3000): Promise<{ host: string; name: string }[]> {
  return new Promise((resolve) => {
    const bonjour = new Bonjour();
    const found = new Map<string, string>();

    const browser = bonjour.find({ type: 'wled' }, (service) => {
      const host = pickIPv4(service.addresses);
      if (host) found.set(host, service.name);
    });

    setTimeout(() => {
      browser.stop();
      bonjour.destroy();
      resolve(Array.from(found, ([host, name]) => ({ host, name })));
    }, timeoutMs);
  });
}
