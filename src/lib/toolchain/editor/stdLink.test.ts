import { describe, expect, it } from 'vitest';
import { stdNameAt } from './stdLink.ts';

describe('stdNameAt', () => {
  it('T-stdlink-hit: a position inside `std::name` yields the name', () => {
    const text = '    1: @std::goToEnd();\n';
    expect(stdNameAt(text, text.indexOf('goToEnd') + 3)).toBe('goToEnd');
    expect(stdNameAt(text, text.indexOf('std'))).toBe('goToEnd');
  });
  it('T-stdlink-miss: outside any std:: reference → null', () => {
    expect(stdNameAt('right; mark;', 3)).toBeNull();
    expect(stdNameAt('use foo::bar;', 9)).toBeNull();
  });
  it('T-stdlink-asm: works on an assembly operand too', () => {
    const text = '        call    std::goToNumber #2';
    expect(stdNameAt(text, text.indexOf('Number'))).toBe('goToNumber');
  });
});
