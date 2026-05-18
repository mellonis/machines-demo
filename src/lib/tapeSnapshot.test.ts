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
});
