/**
 * Haptic feedback, light and only at moments that matter (a save, a delete, picking up and dropping a card).
 * iPhone Safari has no vibration API, but toggling a hidden `<input type="checkbox" switch>` plays the
 * system switch tick (iOS 18 and later); elsewhere navigator.vibrate is used. Both only work during a tap.
 * On or off is a per-device preference in localStorage (not in backups).
 */
export type Feel = 'tap' | 'warn';

const KEY = 'budget-tracker-haptics';

export function hapticsOn(): boolean {
  try {
    return localStorage.getItem(KEY) !== 'off';
  } catch {
    return true;
  }
}

export function setHapticsOn(on: boolean): void {
  try {
    localStorage.setItem(KEY, on ? 'on' : 'off');
  } catch {
    // Storage blocked: the choice is lost on reload, which is harmless.
  }
}

function tick(): void {
  const label = document.createElement('label');
  label.ariaHidden = 'true';
  label.style.display = 'none';
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.setAttribute('switch', '');
  label.appendChild(input);
  document.head.appendChild(label);
  label.click();
  label.remove();
}

/** One tick for a save or a pick-up, two for a delete or anything that takes something away. */
export function haptic(feel: Feel = 'tap'): void {
  if (typeof window === 'undefined' || !hapticsOn()) return;
  try {
    if (typeof navigator.vibrate === 'function') {
      navigator.vibrate(feel === 'warn' ? [14, 60, 14] : 10);
      return;
    }
    tick();
    if (feel === 'warn') setTimeout(tick, 90);
  } catch {
    // No haptics here: nothing to do.
  }
}
