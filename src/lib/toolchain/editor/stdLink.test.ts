import { describe, expect, it } from 'vitest';
import { stdNameAt } from './stdLink.ts';

describe('stdNameAt', () => {
  it('T-stdlink-hit: a position inside `std::name` yields the qualified name', () => {
    const text = '    1: @std::goToEnd();\n';
    expect(stdNameAt(text, text.indexOf('goToEnd') + 3)).toEqual({ name: 'goToEnd', qualified: true });
    expect(stdNameAt(text, text.indexOf('std'))).toEqual({ name: 'goToEnd', qualified: true });
  });
  it('T-stdlink-bare: an imported name used without the `std::` prefix yields it unqualified', () => {
    const text = '    @goToEnd();\n';
    expect(stdNameAt(text, text.indexOf('goToEnd') + 3)).toEqual({ name: 'goToEnd', qualified: false });
    // The leading `@` belongs to the call, not the name.
    expect(stdNameAt(text, text.indexOf('@'))).toEqual({ name: 'goToEnd', qualified: false });
    // Any other identifier reads the same way — the orchestrator is what
    // decides that an unknown bare name simply isn't a stdlib reference.
    expect(stdNameAt('use foo::bar;', 9)).toEqual({ name: 'bar', qualified: false });
  });
  it('T-stdlink-miss: punctuation and whitespace → null', () => {
    expect(stdNameAt('right; mark;', 6)).toBeNull();
    expect(stdNameAt('use foo::bar;', 13)).toBeNull();
    expect(stdNameAt('    mark;', 1)).toBeNull();
  });
  it('T-stdlink-asm: works on an assembly operand too', () => {
    const text = '        call    std::goToNumber #2';
    expect(stdNameAt(text, text.indexOf('Number'))).toEqual({ name: 'goToNumber', qualified: true });
  });
});
