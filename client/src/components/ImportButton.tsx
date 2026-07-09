import { useRef } from 'react';
import { Button, type ButtonProps } from './ui/Button';

/**
 * A file-picker button. Purely the picker — it hands the chosen File to the
 * parent, which owns parsing, the import call, and success/error messaging.
 * Resets its input after each pick so re-choosing the same file still fires.
 */
export function ImportButton({
  label,
  onFile,
  variant = 'secondary',
  size,
  disabled
}: {
  label: string;
  onFile: (file: File) => void;
  variant?: ButtonProps['variant'];
  size?: ButtonProps['size'];
  disabled?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept="application/json,.json"
        style={{ display: 'none' }}
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (file) onFile(file);
        }}
      />
      <Button variant={variant} size={size} disabled={disabled} onClick={() => inputRef.current?.click()}>
        {label}
      </Button>
    </>
  );
}
