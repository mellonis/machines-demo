import type { EngineSchema } from './types.ts';

export const TURING_SCHEMA: EngineSchema = {
  namespace: {
    Alphabet:        { kind: 'class', classRef: 'Alphabet', detail: 'tape alphabet (symbol list)' },
    State:           { kind: 'class', classRef: 'State', detail: 'transition node' },
    Tape:            { kind: 'class', classRef: 'Tape', detail: 'single tape' },
    TapeBlock:       { kind: 'class', classRef: 'TapeBlock', detail: 'multi-tape block' },
    TuringMachine:   { kind: 'class', classRef: 'TuringMachine', detail: 'machine' },
    haltState:       { kind: 'singleton', type: { kind: 'class', name: 'State' }, detail: 'global halt singleton' },
    ifOtherSymbol:   { kind: 'symbol', detail: 'catch-all pattern key' },
    movements:       { kind: 'constants', constantsRef: 'movements', detail: '{ left, right, stay }' },
    symbolCommands:  { kind: 'constants', constantsRef: 'symbolCommands', detail: '{ keep, erase }' },
  },

  classes: {
    State: {
      ctor: {
        params: [
          { name: 'symbolToData', type: { kind: 'shape', name: 'StateSymbolMap' }, detail: 'symbol-pattern -> transition' },
          { name: 'name', type: { kind: 'primitive', name: 'string' }, optional: true, detail: 'display name' },
        ],
      },
      members: [
        { name: 'debug',                   kind: 'property', type: { kind: 'shape', name: 'StateDebug' }, detail: 'breakpoint config' },
        { name: 'tag',                     kind: 'method',   type: { kind: 'class', name: 'State' }, params: [{ name: 'tags', type: { kind: 'array', of: { kind: 'primitive', name: 'string' } } }], detail: 'tag this state (returns self)' },
        { name: 'withOverriddenHaltState', kind: 'method',   type: { kind: 'class', name: 'State' }, params: [{ name: 'continuation', type: { kind: 'class', name: 'State' } }], detail: 'wrap as callable subtree' },
      ],
      detail: 'transition node',
    },
    Alphabet:      { ctor: { params: [{ name: 'symbols', type: { kind: 'array', of: { kind: 'primitive', name: 'string' } } }] }, members: [], detail: 'tape alphabet' },
    Tape:          { ctor: { params: [{ name: 'options', type: { kind: 'shape', name: 'TapeOptions' }, detail: 'tape options' }], optionsShape: 'TapeOptions' }, members: [], detail: 'single tape' },
    TapeBlock:     { ctor: { params: [{ name: 'options', type: { kind: 'shape', name: 'TapeBlockOptions' }, detail: 'tape-block options' }], optionsShape: 'TapeBlockOptions' }, members: [], detail: 'multi-tape block' },
    TuringMachine: { ctor: { params: [{ name: 'options', type: { kind: 'shape', name: 'TuringMachineOptions' }, detail: 'machine options' }], optionsShape: 'TuringMachineOptions' }, members: [], detail: 'machine' },
  },

  shapes: {
    StateDebug: {
      keys: [
        { name: 'before', kind: 'property', type: { kind: 'primitive', name: 'boolean' }, detail: 'pause before this state' },
        { name: 'after',  kind: 'property', type: { kind: 'primitive', name: 'boolean' }, detail: 'pause after this state' },
      ],
    },
    StateSymbolMap: { keys: [] },
    TapeOptions: { keys: [] },
    TapeBlockOptions: { keys: [] },
    TuringMachineOptions: { keys: [] },
  },

  constants: {
    movements:      { keys: ['left', 'right', 'stay'], detail: 'head movements' },
    symbolCommands: { keys: ['keep', 'erase'],         detail: 'symbol commands' },
  },
};
