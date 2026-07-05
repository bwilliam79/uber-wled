import type { Cfg } from '../configPatches';

/** Contract between ConfigTab (owns the dry-run→diff→confirm pipeline) and every config form. */
export interface ConfigFormProps {
  cfg: Cfg;
  busy: boolean;
  onSave: (patch: Cfg) => void;
}
