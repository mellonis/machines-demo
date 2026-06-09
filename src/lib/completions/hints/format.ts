import type { TypeRef } from '../schema/types.ts';

export function formatTypeRef(t: TypeRef): string {
  switch (t.kind) {
    case 'primitive':
      return t.name;
    case 'class':
    case 'shape':
    case 'constants':
      return t.name;
    case 'symbol':
      return 'symbol';
    case 'array': {
      const inner = formatTypeRef(t.of);
      return t.of.kind === 'union' ? `(${inner})[]` : `${inner}[]`;
    }
    case 'union':
      return t.of.map(formatTypeRef).join(' | ');
    case 'literal':
      return typeof t.value === 'string' ? `"${t.value}"` : String(t.value);
  }
}
