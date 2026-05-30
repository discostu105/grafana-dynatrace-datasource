// Monaco language registration for DQL — Dynatrace Query Language.
//
// Registers once globally via registerDqlLanguage(). Safe to call multiple
// times; subsequent calls are no-ops.
//
// Includes:
//   - Monarch tokenizer (verbs, operators, strings, numbers, durations,
//     comments).
//   - Bracket pairs + auto-closing for (, [, {, ", '.
//   - Completion provider stub — the real suggestions come from a backend
//     resource handler that proxies Grail's /query:autocomplete endpoint.

import type { languages, IPosition, editor } from 'monaco-editor';
import type { Monaco } from '@grafana/ui';

const LANGUAGE_ID = 'dql';
let registered = false;

// Verbs / commands — kept in sync with the dt-dql-essentials skill's
// "Commands" list.
const KEYWORDS = [
  'append',
  'data',
  'dedup',
  'describe',
  'expand',
  'fetch',
  'fields',
  'fieldsAdd',
  'fieldsFlatten',
  'fieldsKeep',
  'fieldsRemove',
  'fieldsRename',
  'fieldsSnapshot',
  'fieldsSummary',
  'filter',
  'filterOut',
  'join',
  'joinNested',
  'limit',
  'load',
  'lookup',
  'makeTimeseries',
  'metrics',
  'parse',
  'search',
  'smartscapeEdges',
  'smartscapeNodes',
  'sort',
  'summarize',
  'timeseries',
  'traverse',
];

// Function names kept in a future-friendly export but not currently wired
// into the tokenizer (the monarch pattern recognises any `ident(` as
// type.identifier). Suggestion-list fallback uses the Grail autocomplete
// API instead.
const OPERATORS = [
  '==',
  '!=',
  '<=',
  '>=',
  '<',
  '>',
  '&&',
  '||',
  'AND',
  'OR',
  'NOT',
  'and',
  'or',
  'not',
  '+',
  '-',
  '*',
  '/',
  '=',
];

export const monarchLanguage: languages.IMonarchLanguage = {
  defaultToken: '',
  ignoreCase: false,
  keywords: KEYWORDS,
  operators: OPERATORS,
  symbols: /[=><!~?:&|+\-*/^%]+/,
  tokenizer: {
    root: [
      // Comments (DQL uses // line comments and /* block */)
      [/\/\/.*$/, 'comment'],
      [/\/\*/, { token: 'comment.quote', next: '@comment' }],
      // DQL macros (kept first so they highlight inside other contexts)
      [/\$__[A-Za-z_]+(\([^)]*\))?/, 'variable.predefined'],
      [/\$\{[A-Za-z_][^}]*\}/, 'variable'],
      [/\$[A-Za-z_][A-Za-z0-9_]*/, 'variable'],
      // Strings
      [/"([^"\\]|\\.)*$/, 'string.invalid'],
      [/"/, { token: 'string.quote', next: '@string_double' }],
      [/'([^'\\]|\\.)*$/, 'string.invalid'],
      [/'/, { token: 'string.quote', next: '@string_single' }],
      // Duration literals: 5m, 30s, 1h, 24h, 7d, 100ms
      [/\b\d+(?:\.\d+)?(?:ns|us|µs|ms|s|m|h|d|w|y)\b/, 'number.float'],
      // Numbers
      [/\b\d+\.\d+([eE][+-]?\d+)?\b/, 'number.float'],
      [/\b\d+([eE][+-]?\d+)?\b/, 'number'],
      // Identifiers — match function calls first so they highlight
      [
        /[a-zA-Z][\w.]*(?=\s*\()/,
        {
          cases: {
            '@keywords': 'keyword',
            '@default': 'type.identifier',
          },
        },
      ],
      [
        /[a-zA-Z][\w.]*/,
        {
          cases: {
            '@keywords': 'keyword',
            '@default': 'identifier',
          },
        },
      ],
      // Punctuation
      [/[{}()\[\]]/, '@brackets'],
      [/[;,.]/, 'delimiter'],
      [
        /@symbols/,
        {
          cases: {
            '@operators': 'operator',
            '@default': '',
          },
        },
      ],
      [/\s+/, 'white'],
    ],
    comment: [
      [/[^/*]+/, 'comment'],
      [/\*\//, { token: 'comment.quote', next: '@pop' }],
      [/[/*]/, 'comment'],
    ],
    string_double: [
      [/[^\\"]+/, 'string'],
      [/\\./, 'string.escape'],
      [/"/, { token: 'string.quote', next: '@pop' }],
    ],
    string_single: [
      [/[^\\']+/, 'string'],
      [/\\./, 'string.escape'],
      [/'/, { token: 'string.quote', next: '@pop' }],
    ],
  },
};

// collapseWhitespace squashes runs of whitespace that fall outside string
// literals down to a single space, leaving string contents untouched.
function collapseWhitespace(s: string): string {
  let out = '';
  let inString: string | null = null;
  let pendingSpace = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    const prev = s[i - 1];
    if (inString) {
      out += ch;
      if (ch === inString && prev !== '\\') {
        inString = null;
      }
      continue;
    }
    if (ch === '"' || ch === "'") {
      if (pendingSpace) {
        out += ' ';
        pendingSpace = false;
      }
      inString = ch;
      out += ch;
      continue;
    }
    if (/\s/.test(ch)) {
      pendingSpace = out.length > 0;
      continue;
    }
    if (pendingSpace) {
      out += ' ';
      pendingSpace = false;
    }
    out += ch;
  }
  return out;
}

// formatDql pretty-prints a DQL query by putting each top-level pipe command on
// its own line. Pipes inside strings or brackets are left alone, and internal
// whitespace outside strings is normalised. It is a pure, idempotent function
// (formatting an already-formatted query returns it unchanged), which makes it
// safe to wire into both the Monaco formatting provider and the Format button.
export function formatDql(dql: string): string {
  if (!dql.trim()) {
    return dql;
  }
  const segments: string[] = [];
  let current = '';
  let inString: string | null = null;
  let depth = 0;
  for (let i = 0; i < dql.length; i++) {
    const ch = dql[i];
    const prev = dql[i - 1];
    if (inString) {
      current += ch;
      if (ch === inString && prev !== '\\') {
        inString = null;
      }
      continue;
    }
    if (ch === '"' || ch === "'") {
      inString = ch;
      current += ch;
      continue;
    }
    if (ch === '(' || ch === '[' || ch === '{') {
      depth++;
    } else if (ch === ')' || ch === ']' || ch === '}') {
      depth = Math.max(0, depth - 1);
    }
    if (ch === '|' && depth === 0) {
      segments.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  segments.push(current);

  const cleaned = segments.map((s) => collapseWhitespace(s).trim()).filter((s, idx) => idx === 0 || s.length > 0);
  return cleaned.map((s, idx) => (idx === 0 ? s : `| ${s}`)).join('\n');
}

export const languageConfig: languages.LanguageConfiguration = {
  comments: { lineComment: '//', blockComment: ['/*', '*/'] },
  brackets: [
    ['{', '}'],
    ['[', ']'],
    ['(', ')'],
  ],
  autoClosingPairs: [
    { open: '{', close: '}' },
    { open: '[', close: ']' },
    { open: '(', close: ')' },
    { open: '"', close: '"' },
    { open: "'", close: "'" },
  ],
  surroundingPairs: [
    { open: '{', close: '}' },
    { open: '[', close: ']' },
    { open: '(', close: ')' },
    { open: '"', close: '"' },
    { open: "'", close: "'" },
  ],
};

// Suggestion shape from Grail's /platform/storage/query/v1/query:autocomplete
// — we keep the keys we care about, ignore the rest. All fields are optional
// so the same shape can be shared with the datasource's autocomplete()
// method (which doesn't make hard guarantees about the proxied response).
export type GrailSuggestion = {
  suggestion?: string;
  alreadyTypedCharacters?: number;
  parts?: Array<{ type?: string; suggestion?: string; info?: string }>;
};
export type GrailAutocompleteResponse = { suggestions?: GrailSuggestion[] };

export type AutocompleteFetcher = (dql: string, position: number) => Promise<GrailAutocompleteResponse>;

function suggestionKind(monaco: Monaco, parts: GrailSuggestion['parts']): languages.CompletionItemKind {
  const ck = monaco.languages.CompletionItemKind;
  const t = parts?.[0]?.type ?? '';
  switch (t) {
    case 'COMMAND':
    case 'KEYWORD':
      return ck.Keyword;
    case 'DATA_OBJECT':
      return ck.Class;
    case 'FIELD':
    case 'PARAMETER_KEY':
      return ck.Field;
    case 'FUNCTION':
      return ck.Function;
    case 'OPERATOR':
      return ck.Operator;
    case 'LITERAL':
    case 'STRING_LITERAL':
      return ck.Constant;
    default:
      return ck.Text;
  }
}

export function registerDqlLanguage(monaco: Monaco, fetcher: AutocompleteFetcher): void {
  if (registered) {
    return;
  }
  registered = true;

  monaco.languages.register({ id: LANGUAGE_ID });
  monaco.languages.setMonarchTokensProvider(LANGUAGE_ID, monarchLanguage);
  monaco.languages.setLanguageConfiguration(LANGUAGE_ID, languageConfig);

  // Document formatter — one top-level pipe command per line. Enables the
  // built-in "Format Document" action (Shift+Alt+F) inside the editor.
  monaco.languages.registerDocumentFormattingEditProvider(LANGUAGE_ID, {
    provideDocumentFormattingEdits(model: editor.ITextModel) {
      return [{ range: model.getFullModelRange(), text: formatDql(model.getValue()) }];
    },
  });

  monaco.languages.registerCompletionItemProvider(LANGUAGE_ID, {
    triggerCharacters: ['.', ':', ' ', ',', '{', '|', '$'],
    async provideCompletionItems(model: editor.ITextModel, position: IPosition) {
      const text = model.getValue();
      const offset = model.getOffsetAt(position);

      let response: GrailAutocompleteResponse;
      try {
        response = await fetcher(text, offset);
      } catch {
        // Fall back to a static keyword list if the proxy fails so the user
        // still gets *something*.
        return {
          suggestions: KEYWORDS.map((k) => ({
            label: k,
            kind: monaco.languages.CompletionItemKind.Keyword,
            insertText: k,
            range: model.getWordUntilPosition(position) && {
              startLineNumber: position.lineNumber,
              endLineNumber: position.lineNumber,
              startColumn: model.getWordUntilPosition(position).startColumn,
              endColumn: model.getWordUntilPosition(position).endColumn,
            },
          })) as languages.CompletionItem[],
        };
      }

      const word = model.getWordUntilPosition(position);
      const range = {
        startLineNumber: position.lineNumber,
        endLineNumber: position.lineNumber,
        startColumn: word.startColumn,
        endColumn: word.endColumn,
      };

      const items: languages.CompletionItem[] = [];
      for (const s of response.suggestions ?? []) {
        if (!s.suggestion) {
          continue;
        }
        items.push({
          label: s.suggestion,
          kind: suggestionKind(monaco, s.parts),
          insertText: s.suggestion,
          detail: s.parts?.[0]?.type ?? '',
          documentation: s.parts?.[0]?.info,
          range,
        });
      }
      return { suggestions: items };
    },
  });
}

export const DQL_LANGUAGE_ID = LANGUAGE_ID;
