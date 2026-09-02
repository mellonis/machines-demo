// TM-1 `.tma` assembly. Ported from the toolchains' editors/grammars/tma.tmLanguage.json.
import type { StreamParser } from '@codemirror/language';
import { QUALIFIED, IDENT, tokenTable } from './tokens.ts';

const MNEMONICS = /^(?:call\.m|call\.s|wrmv|djmp|retx|trap|call|jmp|jnm|brk|ent|hlt|mov|mtc|nop|ret|stp|rd|jm|wr)\b/;

// `afterFunc` intentionally stays set for the rest of the line (mirrors
// pma.ts) so `local` after the function/routine name still tokenizes as a
// keyword, e.g. `.func main local`.
type AState = { afterFunc: boolean; afterSection: boolean };

export const tmaParser: StreamParser<AState> = {
  name: 'tma',
  startState: () => ({ afterFunc: false, afterSection: false }),
  tokenTable,
  token(stream, state) {
    if (stream.sol()) {
      state.afterFunc = false;
      state.afterSection = false;
      if (stream.match(/^[ \t]*[A-Za-z_][A-Za-z0-9_]*:/)) return 'label';
    }
    if (stream.eatSpace()) return null;
    if (stream.match(';')) { stream.skipToEnd(); return 'cmt'; }
    if (stream.match(/^\.section\b/)) { state.afterSection = true; return 'directive'; }
    if (stream.match(/^\.(?:func|routine)\b/)) { state.afterFunc = true; return 'directive'; }
    if (stream.match(/^\.(?:rept|endr|row|targets|target|frame|map|exits|byte)\b/)) return 'directive';
    if (state.afterSection && stream.match(IDENT)) { state.afterSection = false; return 'type'; }
    if (state.afterFunc) {
      if (stream.match(/^local\b/)) return 'kw';
      if (stream.match(/^[A-Za-z_][A-Za-z0-9_.:]*/)) return 'fn';
    }
    if (stream.match(/^\{[^}\n]*\}/)) return 'op';
    if (stream.match(/^(?:->|=>|#|=)/)) return 'op';
    if (stream.match(/^\*(?![A-Za-z0-9_])/)) return 'wild';
    if (stream.match(/^[<>](?![A-Za-z0-9_=])/)) return 'move';
    if (stream.match(MNEMONICS)) return 'kw';
    if (stream.match(QUALIFIED)) return 'fn';
    if (stream.match(/^@[A-Za-z_][\w.:]*/)) return 'sym';
    if (stream.match(/^-?(?:0x[0-9A-Fa-f]+|\d+)\b/)) return 'num';
    if (stream.match(IDENT)) return 'sym';
    stream.next();
    return null;
  },
};
