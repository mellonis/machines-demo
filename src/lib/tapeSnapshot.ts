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

  return obj as unknown as TapeSnapshotPayload;
}
