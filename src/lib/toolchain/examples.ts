import type { Example } from '../defaultCode.ts';
import type { ToolchainEngine } from '../types.ts';
import UNARY_INCREMENT from './examples/unary-increment.pmc?raw';
import UNARY_INCREMENT_ASM from './examples/unary-increment.pma?raw';
import SUM from './examples/sum.pmc?raw';
import BINARY_INCREMENT from './examples/binary-increment.tmc?raw';
import BINARY_INCREMENT_ASM from './examples/binary-increment.tma?raw';
import TWO_TAPE_COPY from './examples/two-tape-copy.tmc?raw';
import POW2 from './examples/pow2.tmc?raw';

const PM1: readonly Example[] = [
  { id: 'unary-increment', title: 'Unary increment', code: UNARY_INCREMENT, description: 'Append one mark to a run of marks using the standard library.', seeds: [{ cells: ['*', '*', '*'], head: 0 }] },
  { id: 'sum', title: 'Unary sum', code: SUM, description: 'Add two unary numbers separated by a gap.', seeds: [{ cells: ['*', '*', '*', ' ', '*', '*'], head: 0 }] },
  { id: 'unary-increment-asm', title: 'Unary increment (assembly)', code: UNARY_INCREMENT_ASM, kind: 'asm', description: 'The same program as PM-1 assembly — the disassembly of the source example.', seeds: [{ cells: ['*', '*', '*'], head: 0 }] },
];

const TM1: readonly Example[] = [
  { id: 'binary-increment', title: 'Binary increment', code: BINARY_INCREMENT, description: 'Add one to a binary number; head on the least significant digit.', seeds: [{ cells: ['0', '1', '1'], head: 2 }] },
  { id: 'two-tape-copy', title: 'Two-tape copy', code: TWO_TAPE_COPY, description: 'Copy tape src onto tape dst, both heads moving right.', seeds: [{ cells: ['0', '1', '1', '0'], head: 0 }, { cells: [], head: 0 }] },
  { id: 'pow2', title: 'Unary power of two', code: POW2, description: 'Three tapes compute 2^N in unary; input s b 1×N k with the head on b.', seeds: [{ cells: ['s', 'b', '1', '1', '1', 'k'], head: 1 }, { cells: [], head: 0 }, { cells: [], head: 0 }] },
  { id: 'binary-increment-asm', title: 'Binary increment (assembly)', code: BINARY_INCREMENT_ASM, kind: 'asm', description: 'The same program as TM-1 assembly; bands are image-labelled (0, 1, 2).', seeds: [{ cells: ['1', '2', '2'], head: 2 }] },
];

export function toolchainExamples(engine: ToolchainEngine): readonly Example[] {
  return engine === 'pm1' ? PM1 : TM1;
}
