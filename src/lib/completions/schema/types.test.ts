import { describe, it, expect } from 'vitest';
import type { EngineSchema, TypeRef, NamespaceEntry } from './types.ts';
import { TURING_SCHEMA } from './turing.ts';
import { POST_SCHEMA } from './post.ts';
import { getSchema } from './index.ts';

describe('schema/types', () => {
  it('S-schema-types-roundtrip — example TypeRef constructions compile', () => {
    const prim: TypeRef = { kind: 'primitive', name: 'string' };
    const cls: TypeRef = { kind: 'class', name: 'State' };
    const ns: NamespaceEntry = { kind: 'class', classRef: 'State', detail: '' };
    const schema: EngineSchema = {
      namespace: {},
      classes: {},
      shapes: {},
      constants: {},
    };
    expect([prim.kind, cls.kind, ns.kind, Object.keys(schema).length]).toEqual([
      'primitive',
      'class',
      'class',
      4,
    ]);
  });
});

describe('TURING_SCHEMA (Phase 1)', () => {
  it('S-schema-turing-has-required-namespace-entries — covers the State debug surface', () => {
    const required = ['Alphabet', 'State', 'Tape', 'TapeBlock', 'TuringMachine', 'haltState', 'ifOtherSymbol', 'movements', 'symbolCommands'];
    for (const name of required) {
      expect(TURING_SCHEMA.namespace[name], `missing namespace entry: ${name}`).toBeDefined();
    }
  });

  it('S-schema-turing-state-class-has-debug-members — needed for Phase 1 memberAccess', () => {
    const memberNames = TURING_SCHEMA.classes.State.members.map((m) => m.name);
    expect(memberNames).toEqual(expect.arrayContaining(['debug', 'tag', 'withOverriddenHaltState']));
  });

  it('S-schema-turing-statedebug-shape-has-before-after', () => {
    expect(TURING_SCHEMA.shapes.StateDebug.keys.map((k) => k.name)).toEqual(['before', 'after']);
  });

  it('S-schema-turing-movements-constants', () => {
    expect(TURING_SCHEMA.constants.movements.keys).toEqual(['left', 'right', 'stay']);
  });

  it('S-schema-turing-symbolCommands-constants', () => {
    expect(TURING_SCHEMA.constants.symbolCommands.keys).toEqual(['keep', 'erase']);
  });
});

describe('POST_SCHEMA (Phase 1)', () => {
  it('S-schema-post-has-required-namespace-entries', () => {
    const required = [
      'PostMachine', 'Tape', 'State', 'haltState', 'abortState',
      'alphabet', 'blankSymbol', 'markSymbol',
      'mark', 'erase', 'noop', 'left', 'right', 'stop', 'abort', 'call', 'check', '$tag',
    ];
    for (const name of required) {
      expect(POST_SCHEMA.namespace[name], `missing namespace entry: ${name}`).toBeDefined();
    }
  });

  it('S-schema-post-instruction-bare', () => {
    expect(POST_SCHEMA.namespace.mark.kind).toBe('post-instruction');
  });

  it('S-schema-post-instruction-parameterized', () => {
    expect(POST_SCHEMA.namespace.call.kind).toBe('post-instruction');
    const callEntry = POST_SCHEMA.namespace.call;
    if (callEntry.kind === 'post-instruction') {
      expect(callEntry.params).toEqual([
        { name: 'subRoutineName', type: { kind: 'primitive', name: 'string' } },
        { name: 'jumpTo', type: { kind: 'primitive', name: 'number' }, optional: true, detail: 'instruction index to jump to after returning' },
      ]);
    }
  });
});

describe('TURING_SCHEMA (Phase 2)', () => {
  it('S-schema-turing-tape-members', () => {
    const ns = TURING_SCHEMA.classes.Tape.members.map((m) => m.name);
    expect(ns).toEqual(expect.arrayContaining(['alphabet', 'symbols', 'position', 'viewport']));
  });

  it('S-schema-turing-tapeblock-members', () => {
    const ns = TURING_SCHEMA.classes.TapeBlock.members.map((m) => m.name);
    expect(ns).toEqual(expect.arrayContaining(['tapes', 'symbol']));
  });

  it('S-schema-turing-alphabet-members', () => {
    const ns = TURING_SCHEMA.classes.Alphabet.members.map((m) => m.name);
    expect(ns).toEqual(expect.arrayContaining(['symbols', 'blankSymbol']));
  });

  it('S-schema-turing-options-shape-tape', () => {
    const keys = TURING_SCHEMA.shapes.TapeOptions.keys.map((k) => k.name);
    expect(keys).toEqual(expect.arrayContaining(['alphabet', 'symbols', 'viewportWidth']));
  });

  it('S-schema-turing-options-shape-tapeblock', () => {
    const keys = TURING_SCHEMA.shapes.TapeBlockOptions.keys.map((k) => k.name);
    expect(keys).toEqual(['tapes']);
  });

  it('S-schema-turing-options-shape-turingmachine', () => {
    const keys = TURING_SCHEMA.shapes.TuringMachineOptions.keys.map((k) => k.name);
    expect(keys).toEqual(['tapeBlock']);
  });

  it('S-schema-turing-state-symbol-map-keys', () => {
    const keys = TURING_SCHEMA.shapes.StateSymbolMap.keys.map((k) => k.name);
    expect(keys).toEqual(expect.arrayContaining(['command', 'nextState']));
  });
});

describe('POST_SCHEMA (Phase 2)', () => {
  it('S-schema-post-postmachine-members', () => {
    const ns = POST_SCHEMA.classes.PostMachine.members.map((m) => m.name);
    expect(ns).toEqual(expect.arrayContaining(['tape', 'replaceTapeWith', 'setBreakpoint']));
  });

  it('S-schema-post-options-shape', () => {
    const keys = POST_SCHEMA.shapes.PostMachineOptions.keys.map((k) => k.name);
    expect(keys).toEqual(expect.arrayContaining(['blankSymbol', 'markSymbol']));
  });
});

describe('getSchema', () => {
  it('S-schema-getSchema-turing', () => {
    expect(getSchema('turing').namespace.State.kind).toBe('class');
  });

  it('S-schema-getSchema-post', () => {
    expect(getSchema('post').namespace.PostMachine.kind).toBe('class');
  });
});
