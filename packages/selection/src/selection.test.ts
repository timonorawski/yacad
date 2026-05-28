import { describe, expect, it } from 'vitest';
import { Selection } from './selection';

describe('Selection', () => {
  it('starts with no selection', () => {
    const sel = new Selection();
    expect(sel.selectedId).toBeNull();
    expect(sel.isSelected('$')).toBe(false);
  });

  it('select() sets the selected id and emits to subscribers', () => {
    const sel = new Selection();
    const events: (string | null)[] = [];
    sel.subscribe((id) => events.push(id));

    sel.select('$/0');

    expect(sel.selectedId).toBe('$/0');
    expect(sel.isSelected('$/0')).toBe(true);
    expect(sel.isSelected('$')).toBe(false);
    expect(events).toEqual(['$/0']);
  });

  it('selecting the same id again is a no-op (no event)', () => {
    const sel = new Selection();
    sel.select('$/0');
    const events: (string | null)[] = [];
    sel.subscribe((id) => events.push(id));

    sel.select('$/0');

    expect(events).toEqual([]);
  });

  it('clear() resets to null and emits null', () => {
    const sel = new Selection();
    sel.select('$/0');
    const events: (string | null)[] = [];
    sel.subscribe((id) => events.push(id));

    sel.clear();

    expect(sel.selectedId).toBeNull();
    expect(events).toEqual([null]);
  });

  it('subscribe returns a working unsubscribe function', () => {
    const sel = new Selection();
    const events: (string | null)[] = [];
    const unsubscribe = sel.subscribe((id) => events.push(id));
    unsubscribe();
    sel.select('$/0');
    expect(events).toEqual([]);
  });

  it('subscribers added during dispatch do not see the in-flight event', () => {
    const sel = new Selection();
    const received: string[] = [];
    sel.subscribe(() => {
      sel.subscribe(() => received.push('LATE'));
    });

    sel.select('$/0');

    expect(received).toEqual([]);
    // The late subscriber sees subsequent events, not the in-flight one.
    sel.select('$/1');
    expect(received).toEqual(['LATE']);
  });

  it('a throwing subscriber does not block other subscribers', () => {
    const sel = new Selection();
    const received: string[] = [];
    sel.subscribe(() => {
      throw new Error('subscriber A boom');
    });
    sel.subscribe(() => received.push('B'));

    const origErr = console.error;
    console.error = () => {};
    try {
      sel.select('$/0');
    } finally {
      console.error = origErr;
    }

    expect(received).toEqual(['B']);
  });
});
