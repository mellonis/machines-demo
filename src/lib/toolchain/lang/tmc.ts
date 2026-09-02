// TM-1 `.tmc` source. Ported from the toolchains' editors/grammars/tmc.tmLanguage.json.
import type { StreamParser } from '@codemirror/language';
import { blockComment, IDENT, tokenTable } from './tokens.ts';
import type { CState } from './pmc.ts';

const KEYWORDS = /^(?:alphabet|machine|tape|state|routine|graph|namespace|export|entry|volatile|use|as|goto|call|then|return|stop|halt|graft|bind|write|move|map|with|debugger|writes|preserves)\b/;
const DECLARING = /^(?:alphabet|routine|graph|namespace|state)\b/;

type TState = CState & { expectName: boolean };

export const tmcParser: StreamParser<TState> = {
  name: 'tmc',
  startState: () => ({ inBlock: false, lineStart: true, expectName: false }),
  tokenTable,
  token(stream, state) {
    if (state.inBlock) return blockComment(stream, state);
    if (stream.sol()) {
      state.lineStart = true;
      if (stream.match(/^[ \t]*\?.*$/)) return 'doc';
      if (stream.match(/^[ \t]*!.*$/)) return 'cmt';
    }
    if (stream.eatSpace()) return null;
    state.lineStart = false;
    if (stream.match('//')) { stream.skipToEnd(); return 'cmt'; }
    if (stream.match('/*')) { state.inBlock = true; return blockComment(stream, state); }
    if (state.expectName && stream.match(IDENT)) { state.expectName = false; return 'type'; }
    state.expectName = false;
    if (stream.match(/^'(?:\\.|[^'\\])*'/)) return 'glyph';
    // `{c}` interpolation: consume the opening brace bare so the identifier itself
    // tokenizes through the normal IDENT rule below as `sym`, with no braces in its text.
    if (stream.match(/^\{(?=[A-Za-z_][A-Za-z0-9_]*\})/)) return null;
    // `{v+1}` and similar non-bare-identifier interpolation: one opaque `op` token.
    // Quotes/commas are excluded so an alphabet body like `{ '_', '0', '1' }` (a
    // list of glyphs, not interpolation) falls through to per-glyph tokenizing instead.
    if (stream.match(/^\{[^}\n,']*\}/)) return 'op';
    if (stream.match(/^(?:->|=>|\.\.|=)/)) return 'op';
    if (stream.match(/^\*(?![A-Za-z0-9_])/)) return 'wild';
    if (stream.match(/^(?:<|>|\.|-)(?=\s*[,\]])/)) return 'move';
    if (stream.match(/^[A-Za-z_][A-Za-z0-9_]*::/)) return 'ns';
    if (stream.match(DECLARING)) { state.expectName = true; return 'kw'; }
    if (stream.match(KEYWORDS)) return 'kw';
    if (stream.match(IDENT)) return 'sym';
    if (stream.match(/^\d+/)) return 'num';
    stream.next();
    return null;
  },
};
