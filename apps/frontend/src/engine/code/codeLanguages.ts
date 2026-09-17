/**
 * The languages a code block can be read as.
 *
 * ## Why these, and why hand-written
 *
 * A board is not an IDE, and the languages people paste onto one are a short
 * list: the web stack, the backend stack, the data stack, config and docs. This
 * covers that list and stops. A general highlighter would bring hundreds of
 * grammars, a regex engine port or a WASM binary, and a dependency the canvas
 * renderer, the in-place editor and the SVG exporter would all have to load —
 * for colours on a sticky-note board.
 *
 * Each language is data: its comments, strings, word lists and which lexer
 * *mode* reads it. The modes are few because the families are few — C-like
 * code, markup, stylesheets, key-value config, prose — and one lexer per family
 * with a table per language is how a tokenizer stays small enough to test.
 */

export type LexMode = 'code' | 'markup' | 'css' | 'json' | 'yaml' | 'markdown' | 'plain';

export interface StringRule {
  open: string;
  close: string;
  /** Backslash escapes the next character. */
  escape?: boolean;
  /** May run across lines: a template literal, a triple-quoted string. */
  multiline?: boolean;
}

export interface CodeLanguage {
  id: string;
  label: string;
  /** Names people and fences use for it: `ts`, `py`, `sh`. */
  aliases: string[];
  /** Extension for "Download as file". */
  ext: string;
  mode: LexMode;
  lineComment?: string[];
  blockComment?: Array<[string, string]>;
  strings?: StringRule[];
  keywords?: string[];
  types?: string[];
  constants?: string[];
  builtins?: string[];
  /** SQL: keywords match in any case. */
  caseInsensitive?: boolean;
  /** `@decorator`, `@Override`, `@directive`. */
  decorators?: boolean;
  /** `$var` reads as a variable: PHP, shell, GraphQL. */
  dollarVariables?: boolean;
  /** Capitalised identifiers read as types: most typed languages. */
  capitalTypes?: boolean;
  /** Only whole lines at their start: Dockerfile instructions. */
  lineStartKeywords?: boolean;
}

const words = (s: string) => s.split(/\s+/).filter(Boolean);

const C_STRINGS: StringRule[] = [
  { open: '"', close: '"', escape: true },
  { open: "'", close: "'", escape: true },
];

const JS_KEYWORDS = words(
  'as async await break case catch class const continue debugger default delete do else export extends finally for from function get if import in instanceof let new of return set static super switch this throw try typeof var void while with yield'
);
const TS_EXTRA = words('abstract declare enum implements interface keyof namespace private protected public readonly satisfies type infer is');

export const CODE_LANGUAGES: readonly CodeLanguage[] = [
  {
    id: 'typescript', label: 'TypeScript', aliases: ['ts', 'tsx', 'typescript'], ext: 'ts', mode: 'code',
    lineComment: ['//'], blockComment: [['/*', '*/']],
    strings: [...C_STRINGS, { open: '`', close: '`', escape: true, multiline: true }],
    keywords: [...JS_KEYWORDS, ...TS_EXTRA],
    types: words('string number boolean any unknown never void object bigint symbol undefined Record Partial Readonly Promise Array Map Set'),
    constants: words('true false null undefined NaN Infinity'),
    builtins: words('console window document Math JSON Object Date Error'),
    decorators: true, capitalTypes: true,
  },
  {
    id: 'javascript', label: 'JavaScript', aliases: ['js', 'jsx', 'mjs', 'cjs', 'javascript', 'node'], ext: 'js', mode: 'code',
    lineComment: ['//'], blockComment: [['/*', '*/']],
    strings: [...C_STRINGS, { open: '`', close: '`', escape: true, multiline: true }],
    keywords: JS_KEYWORDS,
    constants: words('true false null undefined NaN Infinity'),
    builtins: words('console window document Math JSON Object Array Promise Date Error require module exports process'),
    capitalTypes: true,
  },
  {
    id: 'python', label: 'Python', aliases: ['py', 'python', 'python3'], ext: 'py', mode: 'code',
    lineComment: ['#'],
    strings: [
      { open: '"""', close: '"""', escape: true, multiline: true },
      { open: "'''", close: "'''", escape: true, multiline: true },
      ...C_STRINGS,
    ],
    keywords: words('and as assert async await break class continue def del elif else except finally for from global if import in is lambda nonlocal not or pass raise return try while with yield match case'),
    types: words('int float str bool list dict set tuple bytes object'),
    constants: words('True False None self cls'),
    builtins: words('print len range open enumerate zip map filter sorted sum min max isinstance super'),
    decorators: true, capitalTypes: true,
  },
  {
    id: 'sql', label: 'SQL', aliases: ['sql', 'postgres', 'postgresql', 'mysql', 'sqlite', 'psql'], ext: 'sql', mode: 'code',
    lineComment: ['--'], blockComment: [['/*', '*/']],
    strings: [{ open: "'", close: "'" }, { open: '"', close: '"' }],
    keywords: words('select from where and or not insert into values update set delete create table alter drop index view join inner left right outer full on as group by order having limit offset union all distinct case when then else end is null in between like exists primary key foreign references default returning with recursive asc desc cascade constraint unique check begin commit rollback transaction grant revoke'),
    types: words('int integer bigint smallint serial bigserial text varchar char boolean bool date timestamp timestamptz numeric decimal real float double uuid json jsonb bytea'),
    constants: words('true false null'),
    builtins: words('count sum avg min max coalesce now lower upper length concat cast extract date_trunc row_number over partition'),
    caseInsensitive: true,
  },
  {
    id: 'html', label: 'HTML', aliases: ['html', 'htm', 'xml', 'svg', 'vue'], ext: 'html', mode: 'markup',
  },
  {
    id: 'css', label: 'CSS', aliases: ['css', 'scss', 'less', 'sass'], ext: 'css', mode: 'css',
    blockComment: [['/*', '*/']], lineComment: [],
    strings: C_STRINGS,
  },
  { id: 'json', label: 'JSON', aliases: ['json', 'jsonc', 'json5'], ext: 'json', mode: 'json' },
  {
    id: 'bash', label: 'Bash', aliases: ['sh', 'bash', 'shell', 'zsh', 'console', 'terminal'], ext: 'sh', mode: 'code',
    lineComment: ['#'],
    strings: [{ open: '"', close: '"', escape: true }, { open: "'", close: "'" }],
    keywords: words('if then else elif fi for while until do done case esac function in return export local readonly select break continue exit'),
    builtins: words('echo cd ls pwd cat grep sed awk curl wget npm npx pnpm yarn node git docker kubectl sudo apt brew pip python make chmod mkdir rm cp mv source set unset read printf touch'),
    constants: words('true false'),
    dollarVariables: true,
  },
  {
    id: 'java', label: 'Java', aliases: ['java'], ext: 'java', mode: 'code',
    lineComment: ['//'], blockComment: [['/*', '*/']],
    strings: [{ open: '"""', close: '"""', escape: true, multiline: true }, ...C_STRINGS],
    keywords: words('abstract assert break case catch class continue default do else enum extends final finally for if implements import instanceof interface native new package private protected public return static super switch synchronized this throw throws try volatile while var record sealed permits yield'),
    types: words('int long short byte char float double boolean void String Integer Long Boolean Object List Map Set Optional'),
    constants: words('true false null'),
    decorators: true, capitalTypes: true,
  },
  {
    id: 'c', label: 'C', aliases: ['c', 'h'], ext: 'c', mode: 'code',
    lineComment: ['//'], blockComment: [['/*', '*/']], strings: C_STRINGS,
    keywords: words('auto break case const continue default do else enum extern for goto if inline register restrict return sizeof static struct switch typedef union volatile while #include #define #ifdef #ifndef #endif #if #else #pragma'),
    types: words('int long short char float double void unsigned signed size_t bool uint8_t uint16_t uint32_t uint64_t int32_t int64_t FILE'),
    constants: words('NULL true false'),
    builtins: words('printf scanf malloc free memcpy strlen sizeof'),
  },
  {
    id: 'cpp', label: 'C++', aliases: ['cpp', 'c++', 'cc', 'hpp', 'cxx'], ext: 'cpp', mode: 'code',
    lineComment: ['//'], blockComment: [['/*', '*/']], strings: C_STRINGS,
    keywords: words('auto break case catch class const constexpr continue default delete do else enum explicit export extern for friend goto if inline mutable namespace new noexcept operator override private protected public return sizeof static struct switch template this throw try typedef typename union using virtual volatile while co_await co_return #include #define #pragma #ifndef #endif'),
    types: words('int long short char float double void unsigned signed bool size_t string vector map unique_ptr shared_ptr std'),
    constants: words('nullptr true false NULL'),
    builtins: words('cout cin endl printf'),
    capitalTypes: true,
  },
  {
    id: 'csharp', label: 'C#', aliases: ['cs', 'csharp', 'c#'], ext: 'cs', mode: 'code',
    lineComment: ['//'], blockComment: [['/*', '*/']],
    strings: [{ open: '@"', close: '"' }, { open: '$"', close: '"', escape: true }, ...C_STRINGS],
    keywords: words('abstract as async await base break case catch class const continue default delegate do else enum event explicit extern finally fixed for foreach get if implicit in interface internal is lock namespace new operator out override params private protected public readonly record ref return sealed set sizeof static struct switch this throw try typeof using var virtual void when where while yield init'),
    types: words('int long short byte char float double decimal bool string object dynamic Task List Dictionary IEnumerable'),
    constants: words('true false null'),
    decorators: false, capitalTypes: true,
  },
  {
    id: 'go', label: 'Go', aliases: ['go', 'golang'], ext: 'go', mode: 'code',
    lineComment: ['//'], blockComment: [['/*', '*/']],
    strings: [{ open: '`', close: '`', multiline: true }, ...C_STRINGS],
    keywords: words('break case chan const continue default defer else fallthrough for func go goto if import interface map package range return select struct switch type var'),
    types: words('int int8 int16 int32 int64 uint uint8 uint16 uint32 uint64 float32 float64 string bool byte rune error any'),
    constants: words('true false nil iota'),
    builtins: words('make new len cap append copy delete panic recover print println fmt'),
    capitalTypes: true,
  },
  {
    id: 'rust', label: 'Rust', aliases: ['rs', 'rust'], ext: 'rs', mode: 'code',
    lineComment: ['//'], blockComment: [['/*', '*/']], strings: [{ open: '"', close: '"', escape: true, multiline: true }],
    keywords: words('as async await break const continue crate dyn else enum extern fn for if impl in let loop match mod move mut pub ref return self Self static struct super trait type unsafe use where while'),
    types: words('i8 i16 i32 i64 i128 isize u8 u16 u32 u64 u128 usize f32 f64 bool char str String Vec Option Result Box HashMap'),
    constants: words('true false None Some Ok Err'),
    builtins: words('println print format vec panic assert assert_eq todo unimplemented'),
    capitalTypes: true,
  },
  {
    id: 'php', label: 'PHP', aliases: ['php'], ext: 'php', mode: 'code',
    lineComment: ['//', '#'], blockComment: [['/*', '*/']], strings: C_STRINGS,
    keywords: words('abstract and as break case catch class clone const continue declare default do echo else elseif empty endforeach endif enum extends final finally fn for foreach function global if implements include instanceof interface isset match namespace new or print private protected public readonly require require_once return static switch throw trait try unset use var while yield <?php ?>'),
    types: words('int float string bool array object callable iterable void mixed self'),
    constants: words('true false null TRUE FALSE NULL'),
    dollarVariables: true, capitalTypes: true,
  },
  {
    id: 'dart', label: 'Dart', aliases: ['dart', 'flutter'], ext: 'dart', mode: 'code',
    lineComment: ['//'], blockComment: [['/*', '*/']],
    strings: [{ open: "'''", close: "'''", escape: true, multiline: true }, ...C_STRINGS],
    keywords: words('abstract as assert async await break case catch class const continue covariant default deferred do dynamic else enum export extends extension external factory final finally for get if implements import in interface is late library mixin new on operator part required rethrow return set show static super switch sync this throw try typedef var void while with yield'),
    types: words('int double num String bool List Map Set Future Stream Widget BuildContext Object'),
    constants: words('true false null'),
    decorators: true, capitalTypes: true,
  },
  {
    id: 'kotlin', label: 'Kotlin', aliases: ['kt', 'kotlin', 'kts'], ext: 'kt', mode: 'code',
    lineComment: ['//'], blockComment: [['/*', '*/']],
    strings: [{ open: '"""', close: '"""', multiline: true }, ...C_STRINGS],
    keywords: words('as break class companion continue data do else enum false for fun if import in interface is lateinit object open override package private protected public return sealed super suspend this throw try typealias val var when while by init inline internal'),
    types: words('Int Long Double Float Boolean String Char Unit Any List Map Set'),
    constants: words('true false null'),
    decorators: true, capitalTypes: true,
  },
  {
    id: 'swift', label: 'Swift', aliases: ['swift'], ext: 'swift', mode: 'code',
    lineComment: ['//'], blockComment: [['/*', '*/']],
    strings: [{ open: '"""', close: '"""', escape: true, multiline: true }, { open: '"', close: '"', escape: true }],
    keywords: words('actor associatedtype async await break case catch class continue default defer do else enum extension fallthrough fileprivate for func guard if import in init inout internal is let mutating nonisolated open operator private protocol public repeat rethrows return self Self some static struct subscript super switch throw throws try typealias var where while any'),
    types: words('Int Double Float Bool String Character Array Dictionary Set Optional View'),
    constants: words('true false nil'),
    decorators: true, capitalTypes: true,
  },
  {
    id: 'ruby', label: 'Ruby', aliases: ['rb', 'ruby'], ext: 'rb', mode: 'code',
    lineComment: ['#'], strings: C_STRINGS,
    keywords: words('alias and begin break case class def defined? do else elsif end ensure for if in module next not or redo rescue retry return self super then undef unless until when while yield attr_accessor attr_reader require require_relative private'),
    constants: words('true false nil'),
    builtins: words('puts print p raise lambda proc'),
    capitalTypes: true,
  },
  {
    id: 'yaml', label: 'YAML', aliases: ['yml', 'yaml'], ext: 'yaml', mode: 'yaml',
  },
  {
    id: 'markdown', label: 'Markdown', aliases: ['md', 'markdown', 'mdx'], ext: 'md', mode: 'markdown',
  },
  {
    id: 'graphql', label: 'GraphQL', aliases: ['graphql', 'gql'], ext: 'graphql', mode: 'code',
    lineComment: ['#'], strings: [{ open: '"""', close: '"""', multiline: true }, { open: '"', close: '"', escape: true }],
    keywords: words('query mutation subscription fragment on type input enum interface union scalar schema extend directive implements repeatable'),
    types: words('ID String Int Float Boolean'),
    constants: words('true false null'),
    decorators: true, dollarVariables: true, capitalTypes: true,
  },
  {
    id: 'dockerfile', label: 'Dockerfile', aliases: ['dockerfile', 'docker', 'containerfile'], ext: 'Dockerfile', mode: 'code',
    lineComment: ['#'], strings: [{ open: '"', close: '"', escape: true }, { open: "'", close: "'" }],
    keywords: words('FROM RUN CMD LABEL EXPOSE ENV ADD COPY ENTRYPOINT VOLUME USER WORKDIR ARG ONBUILD STOPSIGNAL HEALTHCHECK SHELL AS'),
    dollarVariables: true, lineStartKeywords: true,
  },
  {
    id: 'mermaid', label: 'Mermaid', aliases: ['mermaid', 'mmd'], ext: 'mmd', mode: 'code',
    lineComment: ['%%'], strings: [{ open: '"', close: '"' }],
    keywords: words('graph flowchart subgraph end direction sequenceDiagram participant actor classDiagram stateDiagram stateDiagram-v2 erDiagram gantt pie journey mindmap timeline gitGraph note loop alt else opt par critical class style classDef linkStyle click title section TD TB BT RL LR'),
  },
  { id: 'plaintext', label: 'Plain text', aliases: ['text', 'txt', 'plain', 'plaintext'], ext: 'txt', mode: 'plain' },
];

const BY_ID = new Map(CODE_LANGUAGES.map((l) => [l.id, l]));
const BY_ALIAS = new Map(CODE_LANGUAGES.flatMap((l) => [[l.id, l] as const, ...l.aliases.map((a) => [a, l] as const)]));

export function languageById(id: string): CodeLanguage {
  return BY_ID.get(id) ?? BY_ALIAS.get(id.toLowerCase()) ?? BY_ID.get('plaintext')!;
}

/** A fence tag or a file extension, as a language id — or `null` when unknown. */
export function languageForAlias(alias: string): string | null {
  const key = alias.trim().toLowerCase().replace(/^\./, '');
  return BY_ALIAS.get(key)?.id ?? null;
}

/** The language a filename implies: `api.ts` → typescript, `Dockerfile` → dockerfile. */
export function languageForFilename(filename: string): string | null {
  const base = filename.trim().split(/[\\/]/).pop() ?? '';
  if (/^dockerfile$/i.test(base)) return 'dockerfile';
  const dot = base.lastIndexOf('.');
  return dot > 0 ? languageForAlias(base.slice(dot + 1)) : null;
}

/** Grouped for the picker, so twenty-five names are a scan, not a read. */
export const LANGUAGE_GROUPS: Array<{ label: string; ids: string[] }> = [
  { label: 'Web', ids: ['typescript', 'javascript', 'html', 'css', 'graphql'] },
  { label: 'Backend', ids: ['python', 'go', 'java', 'rust', 'csharp', 'php', 'ruby', 'kotlin'] },
  { label: 'Systems and mobile', ids: ['c', 'cpp', 'swift', 'dart'] },
  { label: 'Data and config', ids: ['sql', 'json', 'yaml', 'bash', 'dockerfile'] },
  { label: 'Docs and diagrams', ids: ['markdown', 'mermaid', 'plaintext'] },
];
