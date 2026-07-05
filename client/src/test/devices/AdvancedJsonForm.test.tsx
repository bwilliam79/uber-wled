import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AdvancedJsonForm } from '../../sections/devices/config/AdvancedJsonForm';
import { probedCfg } from './fixtures';

function renderForm(onSave = vi.fn()) {
  render(<AdvancedJsonForm cfg={probedCfg()} busy={false} onSave={onSave} />);
  return onSave;
}

describe('AdvancedJsonForm', () => {
  it('seeds the editor with the full pretty-printed cfg (usermods included)', () => {
    renderForm();
    const editor = screen.getByLabelText('cfg.json') as HTMLTextAreaElement;
    expect(editor.value).toContain('"cabinet-lights"');
    expect(editor.value).toContain('"AudioReactive"');
  });

  it('invalid JSON shows a parse error and never calls onSave', () => {
    const onSave = renderForm();
    fireEvent.change(screen.getByLabelText('cfg.json'), { target: { value: '{ nope' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save raw config' }));
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(onSave).not.toHaveBeenCalled();
  });

  it('a top-level non-object is rejected', () => {
    const onSave = renderForm();
    fireEvent.change(screen.getByLabelText('cfg.json'), { target: { value: '[1,2]' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save raw config' }));
    expect(screen.getByRole('alert').textContent).toMatch(/JSON object/);
    expect(onSave).not.toHaveBeenCalled();
  });

  it('an edited usermod value round-trips with every other field intact', () => {
    const onSave = renderForm();
    const cfg = probedCfg();
    cfg.um.AudioReactive.config.gain = 35;
    fireEvent.change(screen.getByLabelText('cfg.json'),
      { target: { value: JSON.stringify(cfg, null, 2) } });
    fireEvent.click(screen.getByRole('button', { name: 'Save raw config' }));
    const patch = onSave.mock.calls[0][0];
    expect(patch.um.AudioReactive.config.gain).toBe(35);
    expect(patch.hw.led.ins[0].ledma).toBe(55);
  });
});
