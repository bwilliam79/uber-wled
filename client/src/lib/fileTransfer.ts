/**
 * Trigger a browser download of a same-origin URL. The backup/export
 * endpoints respond with `Content-Disposition: attachment`, so navigating an
 * anchor to them downloads the file instead of routing away from the SPA.
 */
export function triggerDownload(url: string): void {
  const a = document.createElement('a');
  a.href = url;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/** Read a user-picked File as parsed JSON, throwing a friendly error if it
 *  can't be read or isn't valid JSON. Uses FileReader (rather than the newer
 *  Blob.text()) for the widest compatibility. */
export function readJsonFile(file: File): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(`Could not read "${file.name}".`));
    reader.onload = () => {
      try {
        resolve(JSON.parse(String(reader.result)));
      } catch {
        reject(new Error(`"${file.name}" isn't a valid JSON file.`));
      }
    };
    reader.readAsText(file);
  });
}
