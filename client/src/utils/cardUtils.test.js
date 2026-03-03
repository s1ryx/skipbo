import { getNextCardForPile } from './cardUtils';

describe('getNextCardForPile', () => {
  it('returns 1 for empty pile', () => {
    expect(getNextCardForPile([])).toBe(1);
  });

  it('returns next sequential value', () => {
    expect(getNextCardForPile([1])).toBe(2);
    expect(getNextCardForPile([1, 2, 3])).toBe(4);
    expect(getNextCardForPile([1, 2, 3, 4, 5])).toBe(6);
  });

  it('returns null when pile is complete (top card is 12)', () => {
    expect(getNextCardForPile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])).toBeNull();
  });

  it('handles SKIP-BO as top card by computing effective value', () => {
    expect(getNextCardForPile([1, 'SKIP-BO'])).toBe(3);
    expect(getNextCardForPile([1, 2, 'SKIP-BO'])).toBe(4);
  });

  it('handles multiple consecutive SKIP-BO cards', () => {
    expect(getNextCardForPile([1, 'SKIP-BO', 'SKIP-BO'])).toBe(4);
    expect(getNextCardForPile(['SKIP-BO'])).toBe(2);
    expect(getNextCardForPile(['SKIP-BO', 'SKIP-BO'])).toBe(3);
  });

  it('handles SKIP-BO completing a pile to 12', () => {
    const pile = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 'SKIP-BO'];
    expect(getNextCardForPile(pile)).toBeNull();
  });

  it('handles mixed SKIP-BO and number cards', () => {
    expect(getNextCardForPile([1, 'SKIP-BO', 3, 'SKIP-BO'])).toBe(5);
  });
});
