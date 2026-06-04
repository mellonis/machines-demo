// Pure-function helper that turns an engine v7 `Graph` snapshot into a
// readable, screen-reader-friendly summary. Used by `MachineGraph.svelte`'s
// `.sr-only` text alternative (machines-demo#95 B1) — the rendered SVG
// carries no `<title>`/`<desc>`/text alternative, so without this the
// central simulator artifact is opaque to assistive tech.
//
// Output is plain prose, not Mermaid notation: e.g. "moves right" instead
// of the engine's `R` letter, "writes 'a'" instead of `'a'`. The rendered
// graph remains the source of truth for sighted users; this summary is
// the parallel structural view AT users get.

import type { Graph, GraphNode, GraphTransition } from '@turing-machine-js/machine';

export type GraphSummary = {
  stateCount: number;
  haltCount: number;
  states: SummaryState[];
};

export type SummaryState = {
  id: number;
  name: string;
  isWrapper: boolean;
  /** When `isWrapper` is true, the bare State id this wrapper delegates
   *  to. Useful for prose like "calls subroutine X". */
  bareStateId: number | null;
  transitions: SummaryTransition[];
};

export type SummaryTransition = {
  /** Decoded transition pattern as readable prose — e.g. `'a'`,
   *  `any symbol`, multi-tape `'a' on tape 1, blank on tape 2`. */
  readsPhrase: string;
  /** Per-tape write+move list, e.g. `writes 'b', moves right`. */
  commandsPhrase: string;
  /** Display name of the target State, or `halt` for halt markers. */
  targetName: string;
};

/** Build a screen-reader-friendly structural summary of the engine graph.
 *  Pure — no DOM, no engine instances, no side effects. */
export function summariseGraph(graph: Graph): GraphSummary {
  const nodes = Object.values(graph.nodes);
  // Sort by id so the summary order is stable across renders.
  const sorted = [...nodes].sort((a, b) => a.id - b.id);

  // Halt markers are emitted by the engine as separate sentinel nodes
  // (one per call site that reaches halt). For AT prose we group them
  // into a single "N halt markers" stat — listing each individually
  // adds noise without information.
  const regular = sorted.filter((n) => !n.isHaltMarker);
  const haltCount = sorted.length - regular.length;

  return {
    stateCount: regular.length,
    haltCount,
    states: regular.map((node) => summariseNode(node, graph)),
  };
}

function summariseNode(node: GraphNode, graph: Graph): SummaryState {
  return {
    id: node.id,
    name: node.name,
    isWrapper: node.isWrapper,
    bareStateId: node.bareStateId,
    transitions: node.transitions.map((t) => summariseTransition(t, graph)),
  };
}

function summariseTransition(
  transition: GraphTransition,
  graph: Graph,
): SummaryTransition {
  return {
    readsPhrase: formatReadsPhrase(transition.pattern),
    commandsPhrase: formatCommandsPhrase(transition.command),
    targetName: targetNameFor(transition.nextStateId, graph),
  };
}

function targetNameFor(id: number, graph: Graph): string {
  const target = graph.nodes[id];
  if (!target) return `state ${id}`;
  if (target.isHaltMarker || target.isHalt) return 'halt';
  return target.name;
}

/** Reformat the engine's pre-decoded pattern as readable prose. The engine
 *  emits Mermaid-style cells (`'a'`, `B`, `*`, `*='a'`) — `B` for blank,
 *  `*` for `ifOtherSymbol`, `*='X'` for wildcard with concrete match,
 *  `'X'` for literals. Multi-pattern alternations are `|`-joined,
 *  multi-tape cells `,`-joined. */
function formatReadsPhrase(pattern: string): string {
  if (!pattern) return 'any symbol';
  return pattern
    .split('|')
    .map((alt) => formatReadAlternative(alt.trim()))
    .join(' or ');
}

function formatReadAlternative(alt: string): string {
  const cells = alt.split(',').map((c) => c.trim());
  if (cells.length === 1) return readCellToPhrase(cells[0]);
  return cells.map((c, i) => `${readCellToPhrase(c)} on tape ${i + 1}`).join(', ');
}

function readCellToPhrase(cell: string): string {
  if (cell === '*' || cell === '?') return 'any symbol';
  if (cell === 'B') return 'blank';
  // Wildcard with a concrete match: engine renders as `*='X'` — preserve
  // that information in prose form.
  const wildcardMatch = /^\*='(.*)'$/.exec(cell);
  if (wildcardMatch) return `any symbol (matched ${quote(wildcardMatch[1])})`;
  const literalMatch = /^'(.*)'$/.exec(cell);
  if (literalMatch) return quote(literalMatch[1]);
  return cell;
}

function quote(symbol: string): string {
  return `'${symbol}'`;
}

function formatCommandsPhrase(
  commands: readonly { symbol: string; movement: string }[],
): string {
  return commands
    .map((cmd, i) => {
      const tapeLabel = commands.length > 1 ? `tape ${i + 1}: ` : '';
      const writePhrase = formatWritePhrase(cmd.symbol);
      const movePhrase = formatMovePhrase(cmd.movement);
      const parts = [writePhrase, movePhrase].filter((p) => p.length > 0);
      return tapeLabel + parts.join(', ');
    })
    .join('; ');
}

/** `GraphCommand.symbol` is already `decodeWriteSymbol`-d by the engine:
 *  `'X'` for literals, `K` (keep), `E` (erase), `K='X'` / `K=B` for keep
 *  with the engine-resolved current symbol. */
function formatWritePhrase(decoded: string): string {
  if (!decoded) return '';
  if (decoded === 'K') return 'keeps current symbol';
  if (decoded === 'E') return 'erases';
  // `K='X'` / `K=B` — keep with concrete read context.
  const keepMatch = /^K=(.+)$/.exec(decoded);
  if (keepMatch) {
    const read = keepMatch[1];
    if (read === 'B') return 'keeps current symbol (blank)';
    const lit = /^'(.*)'$/.exec(read);
    if (lit) return `keeps current symbol (${quote(lit[1])})`;
    return `keeps current symbol (${read})`;
  }
  const literal = /^'(.*)'$/.exec(decoded);
  if (literal) return `writes ${quote(literal[1])}`;
  return `writes ${decoded}`;
}

/** `GraphCommand.movement` is already `decodeMovement`-d: `L` / `R` / `S`. */
function formatMovePhrase(decoded: string): string {
  if (!decoded) return '';
  if (decoded === 'L') return 'moves left';
  if (decoded === 'R') return 'moves right';
  if (decoded === 'S') return 'stays';
  return `moves ${decoded}`;
}
