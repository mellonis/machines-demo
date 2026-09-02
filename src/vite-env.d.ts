/// <reference types="svelte" />
/// <reference types="vite/client" />

declare module '*.svg?raw' {
  const content: string;
  export default content;
}

declare module '*.pmc?raw' { const content: string; export default content; }
declare module '*.tmc?raw' { const content: string; export default content; }
declare module '*.pma?raw' { const content: string; export default content; }
declare module '*.tma?raw' { const content: string; export default content; }

declare module 'virtual:lib-versions' {
  export const turingVersion: string;
  export const postVersion: string;
  export const visualsVersion: string;
  export const appVersion: string;
  export const toolchainsVersion: string;
}

declare module 'virtual:snippets' {
  import type { Snippet } from '@turing-machine-js/visuals';
  type SnippetWithMeta = Snippet & {
    engine: 'turing' | 'post';
    id: string;
    description?: string;
    intervalMs?: number;
  };
  const snippets: { turing: SnippetWithMeta[]; post: SnippetWithMeta[] };
  export default snippets;
}
