import { describe, expect, it } from 'vitest';
import { centsToAmountInput, centsToInput, dayLabel, formatAmountInput, parseCents, todayLocal } from './money';

describe('money input', () => {
  it('parses dollar text to cents without floats', () => {
    expect(parseCents('10')).toBe(1000);
    expect(parseCents('10.5')).toBe(1050);
    expect(parseCents('$1,234.56')).toBe(123456);
    expect(parseCents('.05')).toBe(5);
    expect(parseCents('')).toBeUndefined();
    expect(parseCents('1.234')).toBeUndefined();
    expect(parseCents('abc')).toBeUndefined();
  });

  it('adds thousands commas as you type', () => {
    expect(formatAmountInput('4000')).toBe('4,000');
    expect(formatAmountInput('1234567.5')).toBe('1,234,567.5');
    expect(formatAmountInput('12.345')).toBe('12.34');
    expect(formatAmountInput('007')).toBe('7');
  });

  it('shows stored cents in a field', () => {
    expect(centsToInput(1050)).toBe('10.50');
    expect(centsToInput(undefined)).toBe('');
    expect(centsToAmountInput(400_000)).toBe('4,000');
    expect(centsToAmountInput(5_520)).toBe('55.20');
  });
});

describe('dates', () => {
  it('uses the local calendar date', () => {
    expect(todayLocal(new Date(2027, 1, 5, 23, 59))).toBe('2027-02-05');
  });

  it('labels a day', () => {
    expect(dayLabel('2027-02-03')).toBe('Wed 2/3');
  });
});
