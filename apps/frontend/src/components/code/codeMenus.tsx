import { Sparkles } from 'lucide-react';
import { LANGUAGE_GROUPS, languageById } from '../../engine/code/codeLanguages';
import type { MenuEntry } from '../menu/menuModel';
import type { CodeNode } from '../../engine/model/schema';
import { detectLanguage } from '../../engine/code/codeDetect';
import { updateCode } from '../../engine/code/codeApply';
import { CodeTool } from '../../engine/tools/CodeTool';

/**
 * The language menu, for every place a code block's language is chosen.
 *
 * Grouped, because twenty-five names in a flat list is a read, and the menu's
 * type-ahead means a person who knows what they want types "py" and is there.
 * "Detect automatically" leads: most blocks arrive by paste, and the right
 * answer for those is usually to let the code say what it is.
 */
export function languageMenuEntries(
  current: string,
  detected: boolean,
  onPick: (language: string | 'auto') => void
): MenuEntry[] {
  const entries: MenuEntry[] = [
    {
      kind: 'item',
      id: 'auto',
      label: 'Detect automatically',
      icon: <Sparkles size={14} />,
      detail: detected ? `Reading it as ${languageById(current).label}` : 'Follow what the code looks like',
      onSelect: () => onPick('auto'),
    },
  ];
  for (const group of LANGUAGE_GROUPS) {
    entries.push({ kind: 'separator', id: `sep-${group.label}` });
    entries.push({ kind: 'heading', id: `h-${group.label}`, label: group.label });
    for (const id of group.ids) {
      entries.push({
        kind: 'item',
        id,
        label: languageById(id).label,
        checked: !detected && current === id,
        onSelect: () => onPick(id),
      });
    }
  }
  return entries;
}

/**
 * Apply a pick from `languageMenuEntries` to a block.
 *
 * "Detect automatically" reads the code again now rather than waiting for the
 * next edit, and keeps the current language when the reading is only "plain
 * text" — a guess of nothing should not undo a guess of something. A deliberate
 * pick also becomes what the next new block starts as.
 */
export function pickCodeLanguage(node: CodeNode, pick: string | 'auto'): void {
  if (pick === 'auto') {
    const found = detectLanguage(node.code.source);
    updateCode(node, {
      language: found.language === 'plaintext' ? node.code.language : found.language,
      detected: true,
    });
    return;
  }
  CodeTool.language = pick;
  updateCode(node, { language: pick, detected: false });
}
