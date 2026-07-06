import type { EngineSchema } from './types.ts';

export const TURING_SCHEMA: EngineSchema = {
  namespace: {
    Alphabet:        { kind: 'class', classRef: 'Alphabet', detail: 'tape alphabet (symbol list)' },
    State:           { kind: 'class', classRef: 'State', detail: 'transition node' },
    Tape:            { kind: 'class', classRef: 'Tape', detail: 'single tape' },
    TapeBlock:       { kind: 'class', classRef: 'TapeBlock', detail: 'multi-tape block' },
    TuringMachine:   { kind: 'class', classRef: 'TuringMachine', detail: 'machine' },
    haltState:       { kind: 'singleton', type: { kind: 'class', name: 'State' }, detail: 'global halt singleton' },
    abortState:      { kind: 'singleton', type: { kind: 'class', name: 'State' }, detail: 'global abort singleton (abnormal termination)' },
    ifOtherSymbol:   { kind: 'symbol', detail: 'catch-all pattern key' },
    movements:       { kind: 'constants', constantsRef: 'movements', detail: '{ left, right, stay }' },
    symbolCommands:  { kind: 'constants', constantsRef: 'symbolCommands', detail: '{ keep, erase }' },

    DebugSession:    { kind: 'class', classRef: 'DebugSession', detail: 'advanced: interactive debug session' },
    CallFrame:       { kind: 'class', classRef: 'CallFrame', detail: 'advanced: subroutine call frame' },
    Command:         { kind: 'class', classRef: 'Command', detail: 'advanced: precomputed command' },
    Reference:       { kind: 'class', classRef: 'Reference', detail: 'advanced: forward reference helper' },
    TapeCommand:     { kind: 'class', classRef: 'TapeCommand', detail: 'advanced: per-tape command' },

    toMermaid:       { kind: 'function', params: [{ name: 'graph', type: { kind: 'shape', name: 'Graph' } }], returns: { kind: 'primitive', name: 'string' }, detail: 'advanced: graph -> Mermaid source' },
    fromMermaid:     { kind: 'function', params: [{ name: 'src', type: { kind: 'primitive', name: 'string' } }], returns: { kind: 'shape', name: 'Graph' }, detail: 'advanced: Mermaid -> graph' },
    summarize:       { kind: 'function', params: [{ name: 'state', type: { kind: 'class', name: 'State' } }, { name: 'block', type: { kind: 'class', name: 'TapeBlock' } }], returns: { kind: 'shape', name: 'GraphSummary' }, detail: 'advanced: state summary' },
    summarizeGraph:  { kind: 'function', params: [{ name: 'graph', type: { kind: 'shape', name: 'Graph' } }], returns: { kind: 'shape', name: 'GraphSummary' }, detail: 'advanced: graph summary' },
    equivalentOn:    { kind: 'function', params: [{ name: 'cases', type: { kind: 'array', of: { kind: 'shape', name: 'EquivalenceCase' } } }], returns: { kind: 'shape', name: 'EquivalenceReport' }, detail: 'advanced: behavioral equivalence' },
    tapeViewport:    { kind: 'function', params: [{ name: 'snapshot', type: { kind: 'shape', name: 'TapeSnapshot' } }, { name: 'width', type: { kind: 'primitive', name: 'number' } }, { name: 'blank', type: { kind: 'primitive', name: 'string' } }], returns: { kind: 'shape', name: 'TapeSnapshot' }, detail: 'advanced: centered window over a snapshot' },
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
    Alphabet: {
      ctor: { params: [{ name: 'symbols', type: { kind: 'array', of: { kind: 'primitive', name: 'string' } } }] },
      members: [
        { name: 'symbols',     kind: 'property', type: { kind: 'array', of: { kind: 'primitive', name: 'string' } }, detail: 'symbol list' },
        { name: 'blankSymbol', kind: 'getter',   type: { kind: 'primitive', name: 'string' }, detail: 'first symbol (blank)' },
      ],
      detail: 'tape alphabet',
    },
    Tape: {
      ctor: { params: [{ name: 'options', type: { kind: 'shape', name: 'TapeOptions' }, detail: 'tape options' }], optionsShape: 'TapeOptions' },
      members: [
        { name: 'alphabet', kind: 'property', type: { kind: 'class', name: 'Alphabet' }, detail: 'alphabet' },
        { name: 'symbols',  kind: 'property', type: { kind: 'array', of: { kind: 'primitive', name: 'string' } }, detail: 'symbol list' },
        { name: 'position', kind: 'property', type: { kind: 'primitive', name: 'number' }, detail: 'head index' },
        { name: 'viewport', kind: 'getter',   type: { kind: 'array', of: { kind: 'primitive', name: 'string' } }, detail: 'centered window of cells' },
      ],
      detail: 'single tape',
    },
    TapeBlock: {
      ctor: { params: [{ name: 'options', type: { kind: 'shape', name: 'TapeBlockOptions' }, detail: 'tape-block options' }], optionsShape: 'TapeBlockOptions' },
      members: [
        { name: 'tapes',  kind: 'property', type: { kind: 'array', of: { kind: 'class', name: 'Tape' } }, detail: 'underlying tapes' },
        { name: 'symbol', kind: 'method',   type: { kind: 'symbol' }, params: [{ name: 'pattern', type: { kind: 'array', of: { kind: 'union', of: [{ kind: 'primitive', name: 'string' }, { kind: 'symbol' }] } } }], detail: 'compute a symbol-pattern key' },
      ],
      detail: 'multi-tape block',
    },
    TuringMachine: {
      ctor: { params: [{ name: 'options', type: { kind: 'shape', name: 'TuringMachineOptions' }, detail: 'machine options' }], optionsShape: 'TuringMachineOptions' },
      members: [],
      detail: 'machine',
    },

    DebugSession: { members: [], detail: 'interactive debug session' },
    CallFrame:    { members: [], detail: 'subroutine call frame' },
    Command:      { members: [], detail: 'precomputed command' },
    Reference:    { members: [], detail: 'forward reference helper' },
    TapeCommand:  { members: [], detail: 'per-tape command' },
  },

  shapes: {
    StateDebug: {
      keys: [
        { name: 'before', kind: 'property', type: { kind: 'primitive', name: 'boolean' }, detail: 'pause before this state' },
        { name: 'after',  kind: 'property', type: { kind: 'primitive', name: 'boolean' }, detail: 'pause after this state' },
      ],
    },
    StateSymbolMap: {
      keys: [
        { name: 'command',   kind: 'property', type: { kind: 'array', of: { kind: 'shape', name: 'Command' } }, detail: 'per-tape commands' },
        { name: 'nextState', kind: 'property', type: { kind: 'class', name: 'State' }, detail: 'next state (default: self)' },
      ],
    },
    Command: {
      keys: [
        { name: 'movement', kind: 'property', type: { kind: 'constants', name: 'movements' }, detail: 'head movement' },
        { name: 'symbol',   kind: 'property', type: { kind: 'primitive', name: 'string' }, optional: true, detail: 'symbol to write (omit = keep)' },
      ],
    },
    TapeOptions: {
      keys: [
        { name: 'alphabet',      kind: 'property', type: { kind: 'class', name: 'Alphabet' }, detail: 'tape alphabet' },
        { name: 'symbols',       kind: 'property', type: { kind: 'array', of: { kind: 'primitive', name: 'string' } }, optional: true, detail: 'initial symbols' },
        { name: 'viewportWidth', kind: 'property', type: { kind: 'primitive', name: 'number' }, optional: true, detail: 'viewport size (rendering hint)' },
      ],
    },
    TapeBlockOptions: {
      keys: [
        { name: 'tapes', kind: 'property', type: { kind: 'array', of: { kind: 'class', name: 'Tape' } }, detail: 'tapes in the block' },
      ],
    },
    TuringMachineOptions: {
      keys: [
        { name: 'tapeBlock', kind: 'property', type: { kind: 'class', name: 'TapeBlock' }, detail: 'tape-block to operate on' },
      ],
    },

    Graph:            { keys: [] },
    GraphSummary:     { keys: [] },
    EquivalenceCase:  { keys: [] },
    EquivalenceReport:{ keys: [] },
    TapeSnapshot:     { keys: [] },
  },

  constants: {
    movements:      { keys: ['left', 'right', 'stay'], detail: 'head movements' },
    symbolCommands: { keys: ['keep', 'erase'],         detail: 'symbol commands' },
  },
};
