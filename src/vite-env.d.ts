/// <reference types="svelte" />
/// <reference types="vite/client" />

declare module '*.svg?raw' {
  const content: string;
  export default content;
}

declare module 'virtual:lib-versions' {
  export const turingVersion: string;
  export const postVersion: string;
}
