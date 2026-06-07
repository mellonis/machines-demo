import type { EngineSchema } from './types.ts';

export const POST_SCHEMA: EngineSchema = {
  namespace: {
    PostMachine:   { kind: 'class', classRef: 'PostMachine', detail: 'Post machine' },
    Tape:          { kind: 'class', classRef: 'Tape', detail: 'single tape (re-exported from engine)' },
    State:         { kind: 'class', classRef: 'State', detail: 'transition node (re-exported from engine)' },
    haltState:     { kind: 'singleton', type: { kind: 'class', name: 'State' }, detail: 'global halt singleton' },

    alphabet:      { kind: 'singleton', type: { kind: 'primitive', name: 'unknown' }, detail: 'default Post alphabet (blank, mark)' },
    blankSymbol:   { kind: 'singleton', type: { kind: 'primitive', name: 'string' }, detail: "default blank symbol (' ')" },
    markSymbol:    { kind: 'singleton', type: { kind: 'primitive', name: 'string' }, detail: "default mark symbol ('*')" },

    mark:          { kind: 'post-instruction', detail: 'mark current cell' },
    erase:         { kind: 'post-instruction', detail: 'erase current cell' },
    noop:          { kind: 'post-instruction', detail: 'no-op' },
    stop:          { kind: 'post-instruction', detail: 'halt (return to caller inside a subroutine)' },

    left:          { kind: 'post-instruction', params: [{ name: 'jumpTo', type: { kind: 'union', of: [{ kind: 'primitive', name: 'string' }, { kind: 'primitive', name: 'number' }] }, optional: true, detail: 'jump-to label' }], detail: 'step left (optionally jump)' },
    right:         { kind: 'post-instruction', params: [{ name: 'jumpTo', type: { kind: 'union', of: [{ kind: 'primitive', name: 'string' }, { kind: 'primitive', name: 'number' }] }, optional: true, detail: 'jump-to label' }], detail: 'step right (optionally jump)' },

    call:          { kind: 'post-instruction', params: [{ name: 'label', type: { kind: 'primitive', name: 'string' } }], detail: 'call subroutine by name' },
    check:         { kind: 'post-instruction', params: [
                      { name: 'thenLabel', type: { kind: 'union', of: [{ kind: 'primitive', name: 'string' }, { kind: 'primitive', name: 'number' }] } },
                      { name: 'elseLabel', type: { kind: 'union', of: [{ kind: 'primitive', name: 'string' }, { kind: 'primitive', name: 'number' }] } },
                    ], detail: 'branch on mark/blank' },
    $tag:          { kind: 'post-instruction', params: [{ name: 'tag', type: { kind: 'primitive', name: 'string' } }], detail: 'tag current instruction (passthrough)' },
  },

  classes: {
    PostMachine: {
      ctor: {
        params: [
          { name: 'instructions', type: { kind: 'shape', name: 'PostInstructions' }, detail: 'instruction map' },
          { name: 'options', type: { kind: 'shape', name: 'PostMachineOptions' }, optional: true, detail: 'machine options' },
        ],
        optionsShape: 'PostMachineOptions',
      },
      members: [],
      detail: 'Post machine',
    },
    Tape:  { members: [], detail: 'single tape' },
    State: { members: [], detail: 'transition node' },
  },

  shapes: {
    PostMachineOptions: { keys: [] },
    PostInstructions: { keys: [] },
  },

  constants: {},
};
