import { describe, expect, it } from 'vitest';
import { mergeOrder } from './useCardOrder';

describe('mergeOrder', () => {
  const defaults = ['a', 'b', 'c'];
  it('uses the defaults when nothing is saved', () => {
    expect(mergeOrder(null, defaults)).toEqual(['a', 'b', 'c']);
    expect(mergeOrder('junk', defaults)).toEqual(['a', 'b', 'c']);
  });
  it('keeps a saved order', () => {
    expect(mergeOrder(['c', 'a', 'b'], defaults)).toEqual(['c', 'a', 'b']);
  });
  it('drops unknown and repeated ids and appends new cards', () => {
    expect(mergeOrder(['b', 'x', 'b', 7], defaults)).toEqual(['b', 'a', 'c']);
  });
});
