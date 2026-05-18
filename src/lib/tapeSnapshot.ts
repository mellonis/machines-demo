import type { Alphabets, TapeSnapshot } from './types.ts';

export const SNAPSHOT_FORMAT = 'machines-demo.tape-snapshot';
export const SNAPSHOT_VERSION = 1;

export type TapeSnapshotPayload = {
  format: typeof SNAPSHOT_FORMAT;
  version: number;
  tapes: TapeSnapshot[];
  alphabets: Alphabets;
};

export type ParseError =
  | { reason: 'not-json' }
  | { reason: 'wrong-format'; got: unknown }
  | { reason: 'unsupported-version'; got: number }
  | { reason: 'wrong-shape'; detail: string };

export function serialize(tapes: TapeSnapshot[], alphabets: Alphabets): string {
  const payload: TapeSnapshotPayload = {
    format: SNAPSHOT_FORMAT,
    version: SNAPSHOT_VERSION,
    tapes,
    alphabets,
  };
  return JSON.stringify(payload, null, 2);
}

export function parse(text: string): TapeSnapshotPayload | ParseError {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { reason: 'not-json' };
  }

  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { reason: 'wrong-format', got: undefined };
  }

  const obj = raw as Record<string, unknown>;
  if (obj.format !== SNAPSHOT_FORMAT) {
    return { reason: 'wrong-format', got: obj.format };
  }

  if (obj.version !== SNAPSHOT_VERSION) {
    return { reason: 'unsupported-version', got: obj.version as number };
  }

  if (!Array.isArray(obj.tapes)) {
    return { reason: 'wrong-shape', detail: 'tapes missing or not an array' };
  }

  for (let i = 0; i < obj.tapes.length; i++) {
    const t = obj.tapes[i];
    if (typeof t !== 'object' || t === null || Array.isArray(t)) {
      return { reason: 'wrong-shape', detail: `tapes[${i}] is not an object` };
    }
    const tape = t as Record<string, unknown>;
    if (!Array.isArray(tape.symbols) || !tape.symbols.every((s) => typeof s === 'string')) {
      return { reason: 'wrong-shape', detail: `tapes[${i}].symbols must be string[]` };
    }
    if (typeof tape.position !== 'number' || !Number.isInteger(tape.position)) {
      return { reason: 'wrong-shape', detail: `tapes[${i}].position must be an integer` };
    }
    if (tape.position < 0 || tape.position >= tape.symbols.length) {
      return { reason: 'wrong-shape', detail: `tapes[${i}].position ${tape.position} out of range [0, ${tape.symbols.length})` };
    }
  }

  if (!Array.isArray(obj.alphabets)) {
    return { reason: 'wrong-shape', detail: 'alphabets missing or not an array' };
  }

  for (let i = 0; i < obj.alphabets.length; i++) {
    const a = obj.alphabets[i];
    if (!Array.isArray(a) || !a.every((s) => typeof s === 'string')) {
      return { reason: 'wrong-shape', detail: `alphabets[${i}] must be string[]` };
    }
  }

  if (obj.tapes.length !== obj.alphabets.length) {
    return {
      reason: 'wrong-shape',
      detail: `tape count (${obj.tapes.length}) does not match alphabet count (${obj.alphabets.length})`,
    };
  }

  return obj as unknown as TapeSnapshotPayload;
}
