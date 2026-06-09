import { javascriptLanguage, localCompletionSource } from '@codemirror/lang-javascript';
import type { Extension } from '@codemirror/state';
import type { Engine } from '../types.ts';
import { getSchema } from './schema/index.ts';
import { localsField } from './scan/locals.ts';
import { memberAccess } from './contexts/memberAccess.ts';
import { debugAssignment } from './contexts/debugAssignment.ts';
import { namespaceIdentifier } from './contexts/namespaceIdentifier.ts';
import { optionsBag } from './contexts/optionsBag.ts';
import { destructureBag } from './contexts/destructureBag.ts';
import type { Env } from './contexts/types.ts';
import { signatureHelp } from './hints/signature.ts';

export function completionExtensions(engine: Engine): Extension[] {
  const env: Env = { engine, schema: getSchema(engine) };
  return [
    localsField,
    signatureHelp(env), // reads localsField via inferLocalsFor
    javascriptLanguage.data.of({ autocomplete: memberAccess(env) }),
    javascriptLanguage.data.of({ autocomplete: debugAssignment(env) }),
    javascriptLanguage.data.of({ autocomplete: optionsBag(env) }),
    javascriptLanguage.data.of({ autocomplete: namespaceIdentifier(env) }),
    javascriptLanguage.data.of({ autocomplete: destructureBag(env) }),
    javascriptLanguage.data.of({ autocomplete: localCompletionSource }),
  ];
}
