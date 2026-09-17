import type { TokenKind } from './codeTokenize';
import type { CodeThemeId } from './codeTypes';

/**
 * How a code block is coloured.
 *
 * Four, not forty. A board is looked at by several people on several screens,
 * and a theme is part of the object rather than a preference — so the set is
 * two darks and two lights that each hold AA contrast for body text on their
 * own ground, and one of each pair is warmer for boards that are not all
 * engineering. Every token colour is checked against its background in
 * `codeThemes.test.ts`.
 */
export interface CodeTheme {
  id: CodeThemeId;
  label: string;
  dark: boolean;
  background: string;
  header: string;
  border: string;
  text: string;
  muted: string;
  gutter: string;
  highlight: string;
  highlightBar: string;
  tokens: Record<TokenKind, string>;
}

export const CODE_THEMES: Record<CodeThemeId, CodeTheme> = {
  midnight: {
    id: 'midnight',
    label: 'Midnight',
    dark: true,
    background: '#0E1117',
    header: '#161B24',
    border: '#262D3A',
    text: '#D6DEEB',
    muted: '#8B95A7',
    gutter: '#566074',
    highlight: 'rgba(130, 170, 255, 0.13)',
    highlightBar: '#82AAFF',
    tokens: {
      plain: '#D6DEEB', keyword: '#C792EA', type: '#FFCB6B', constant: '#F78C6C', builtin: '#82AAFF',
      string: '#C3E88D', number: '#F78C6C', comment: '#7F8C98', function: '#82AAFF', property: '#80CBC4',
      operator: '#89DDFF', punctuation: '#9AA7BD', tag: '#F07178', attr: '#FFCB6B', meta: '#C792EA',
      variable: '#F07178', heading: '#82AAFF', emphasis: '#FFCB6B',
    },
  },
  daylight: {
    id: 'daylight',
    label: 'Daylight',
    dark: false,
    background: '#FFFFFF',
    header: '#F6F8FA',
    border: '#D8DEE4',
    text: '#1F2328',
    muted: '#57606A',
    gutter: '#8C959F',
    highlight: 'rgba(212, 167, 44, 0.16)',
    highlightBar: '#BF8700',
    tokens: {
      plain: '#1F2328', keyword: '#CF222E', type: '#953800', constant: '#0550AE', builtin: '#8250DF',
      string: '#0A3069', number: '#0550AE', comment: '#6E7781', function: '#8250DF', property: '#0550AE',
      operator: '#CF222E', punctuation: '#57606A', tag: '#116329', attr: '#0550AE', meta: '#8250DF',
      variable: '#953800', heading: '#0550AE', emphasis: '#953800',
    },
  },
  dusk: {
    id: 'dusk',
    label: 'Dusk',
    dark: true,
    background: '#1B1726',
    header: '#241F33',
    border: '#342D47',
    text: '#E9E3F5',
    muted: '#A59DBD',
    gutter: '#6F6789',
    highlight: 'rgba(255, 122, 198, 0.12)',
    highlightBar: '#FF7AC6',
    tokens: {
      plain: '#E9E3F5', keyword: '#FF7AC6', type: '#FFD479', constant: '#BD93F9', builtin: '#7EE6FF',
      string: '#A6E3A1', number: '#BD93F9', comment: '#8E86A6', function: '#89B4FA', property: '#8BD5CA',
      operator: '#F5A97F', punctuation: '#A59DBD', tag: '#FF7AC6', attr: '#FFD479', meta: '#F5A97F',
      variable: '#F38BA8', heading: '#89B4FA', emphasis: '#FFD479',
    },
  },
  paper: {
    id: 'paper',
    label: 'Paper',
    dark: false,
    background: '#FBF7EF',
    header: '#F1EADC',
    border: '#E2D8C5',
    text: '#3B3228',
    muted: '#6F624F',
    gutter: '#A2937C',
    highlight: 'rgba(161, 61, 45, 0.10)',
    highlightBar: '#A13D2D',
    tokens: {
      plain: '#3B3228', keyword: '#A13D2D', type: '#855400', constant: '#6A4C93', builtin: '#2E6A88',
      string: '#476F22', number: '#6A4C93', comment: '#736450', function: '#2E6A88', property: '#7A5230',
      operator: '#A13D2D', punctuation: '#6F624F', tag: '#A13D2D', attr: '#855400', meta: '#6A4C93',
      variable: '#855400', heading: '#2E6A88', emphasis: '#855400',
    },
  },
};

/** The monospace stack every surface draws code in, so their widths agree. */
export const CODE_FONT = `'JetBrains Mono', 'SF Mono', SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace`;
export const CODE_UI_FONT = `Inter, system-ui, -apple-system, sans-serif`;
