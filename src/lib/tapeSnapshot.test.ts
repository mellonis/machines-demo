import { describe, expect, it } from 'vitest';
import {
  SNAPSHOT_FORMAT,
  SNAPSHOT_VERSION,
  parse,
  serialize,
} from './tapeSnapshot.ts';
import type { Alphabets, TapeSnapshot } from './types.ts';

describe('tapeSnapshot', () => {
  describe('roundtrip', () => {
    it('R-snapshot-roundtrip: serialize → parse returns a deep-equal payload', () => {
      const tapes: TapeSnapshot[] = [
        { symbols: [' ', 'a', 'b', ' '], position: 2 },
      ];
      const alphabets: Alphabets = [[' ', 'a', 'b']];

      const text = serialize(tapes, alphabets);
      const parsed = parse(text);

      expect(parsed).toEqual({
        format: SNAPSHOT_FORMAT,
        version: SNAPSHOT_VERSION,
        tapes,
        alphabets,
      });
    });
  });

  describe('parse-not-json', () => {
    it('R-snapshot-parse-not-json: returns { reason: "not-json" } on JSON.parse failure', () => {
      expect(parse('not valid json')).toEqual({ reason: 'not-json' });
      expect(parse('{ unterminated')).toEqual({ reason: 'not-json' });
      expect(parse('')).toEqual({ reason: 'not-json' });
    });
  });

  describe('parse-wrong-format', () => {
    it('R-snapshot-parse-wrong-format: returns { reason: "wrong-format" } when format field is missing or wrong', () => {
      // Missing format.
      const missing = JSON.stringify({
        version: 1,
        tapes: [{ symbols: [' '], position: 0 }],
        alphabets: [[' ']],
      });
      expect(parse(missing)).toEqual({ reason: 'wrong-format', got: undefined });

      // Wrong format string.
      const wrong = JSON.stringify({
        format: 'something-else',
        version: 1,
        tapes: [{ symbols: [' '], position: 0 }],
        alphabets: [[' ']],
      });
      expect(parse(wrong)).toEqual({ reason: 'wrong-format', got: 'something-else' });

      // Top-level not an object.
      expect(parse('null')).toEqual({ reason: 'wrong-format', got: undefined });
      expect(parse('"a string"')).toEqual({ reason: 'wrong-format', got: undefined });
      expect(parse('[]')).toEqual({ reason: 'wrong-format', got: undefined });
    });
  });

  describe('parse-unsupported-version', () => {
    it('R-snapshot-parse-unsupported-version: returns { reason: "unsupported-version", got: N } for version !== 1', () => {
      const v99 = JSON.stringify({
        format: SNAPSHOT_FORMAT,
        version: 99,
        tapes: [{ symbols: [' '], position: 0 }],
        alphabets: [[' ']],
      });
      expect(parse(v99)).toEqual({ reason: 'unsupported-version', got: 99 });

      const v0 = JSON.stringify({
        format: SNAPSHOT_FORMAT,
        version: 0,
        tapes: [{ symbols: [' '], position: 0 }],
        alphabets: [[' ']],
      });
      expect(parse(v0)).toEqual({ reason: 'unsupported-version', got: 0 });

      // Non-number version → still treated as unsupported (with whatever value as the `got`).
      const vStr = JSON.stringify({
        format: SNAPSHOT_FORMAT,
        version: 'one',
        tapes: [{ symbols: [' '], position: 0 }],
        alphabets: [[' ']],
      });
      const result = parse(vStr);
      expect(result).toMatchObject({ reason: 'unsupported-version' });
    });
  });

  describe('parse-wrong-shape-tapes', () => {
    const baseValid = {
      format: SNAPSHOT_FORMAT,
      version: 1,
      alphabets: [[' ', 'a']],
    };

    const expectWrongShape = (text: string): void => {
      const result = parse(text);
      expect(result).toMatchObject({ reason: 'wrong-shape' });
    };

    it('R-snapshot-parse-wrong-shape-tapes: missing or non-array tapes', () => {
      expectWrongShape(JSON.stringify({ ...baseValid }));
      expectWrongShape(JSON.stringify({ ...baseValid, tapes: 'not-array' }));
      expectWrongShape(JSON.stringify({ ...baseValid, tapes: null }));
      expectWrongShape(JSON.stringify({ ...baseValid, tapes: {} }));
    });

    it('R-snapshot-parse-wrong-shape-tapes: tape entry missing symbols or position', () => {
      expectWrongShape(JSON.stringify({ ...baseValid, tapes: [{ position: 0 }] }));
      expectWrongShape(JSON.stringify({ ...baseValid, tapes: [{ symbols: [' '] }] }));
    });

    it('R-snapshot-parse-wrong-shape-tapes: symbols must be array of strings', () => {
      expectWrongShape(JSON.stringify({ ...baseValid, tapes: [{ symbols: 'abc', position: 0 }] }));
      expectWrongShape(JSON.stringify({ ...baseValid, tapes: [{ symbols: [1, 2], position: 0 }] }));
    });

    it('R-snapshot-parse-wrong-shape-tapes: position must be non-negative integer in range', () => {
      expectWrongShape(JSON.stringify({ ...baseValid, tapes: [{ symbols: [' ', 'a'], position: -1 }] }));
      expectWrongShape(JSON.stringify({ ...baseValid, tapes: [{ symbols: [' ', 'a'], position: 2 }] }));   // out of range
      expectWrongShape(JSON.stringify({ ...baseValid, tapes: [{ symbols: [' ', 'a'], position: 0.5 }] })); // not integer
      expectWrongShape(JSON.stringify({ ...baseValid, tapes: [{ symbols: [], position: 0 }] }));            // empty symbols
    });
  });

  describe('parse-wrong-shape-alphabets', () => {
    const baseValid = {
      format: SNAPSHOT_FORMAT,
      version: 1,
      tapes: [{ symbols: [' ', 'a'], position: 0 }],
    };

    const expectWrongShape = (text: string): void => {
      const result = parse(text);
      expect(result).toMatchObject({ reason: 'wrong-shape' });
    };

    it('R-snapshot-parse-wrong-shape-alphabets: missing or non-array alphabets', () => {
      expectWrongShape(JSON.stringify({ ...baseValid }));
      expectWrongShape(JSON.stringify({ ...baseValid, alphabets: 'not-array' }));
      expectWrongShape(JSON.stringify({ ...baseValid, alphabets: null }));
    });

    it('R-snapshot-parse-wrong-shape-alphabets: alphabet entry must be array of strings', () => {
      expectWrongShape(JSON.stringify({ ...baseValid, alphabets: ['not-array'] }));
      expectWrongShape(JSON.stringify({ ...baseValid, alphabets: [[1, 2, 3]] }));
      expectWrongShape(JSON.stringify({ ...baseValid, alphabets: [null] }));
    });
  });
});
