import React, { createContext, useContext, useId, useRef, useState, useSyncExternalStore } from 'react';
import { ChevronRight, MoreHorizontal, Plus } from 'lucide-react';
import { Menu } from '../../menu/Menu';
import type { MenuEntry } from '../../menu/menuModel';
import { isSectionOpen, setSectionOpen, subscribeSections } from './sectionState';

/**
 * What the panel is showing, for keying remembered section state.
 *
 * Provided once by the panel ("shape:rect", "text", "multi") so sections do not
 * each have to be told what they are inside.
 */
export const PanelSubjectContext = createContext<string>('none');

export interface SectionProps {
  /** Stable id within the panel, e.g. "fill". Keys remembered open state. */
  id: string;
  title: string;
  /** Overrides the panel's subject for the open-state key. */
  subject?: string;
  /**
   * Offer a fold. Off by default: the panel is one flat scroll, and only long
   * subject sections and Info fold.
   */
  collapsible?: boolean;
  defaultOpen?: boolean;
  /** Shows a `+` in the header, e.g. "Add fill". */
  onAdd?: () => void;
  addLabel?: string;
  /** Offer several things to add: the `+` opens this menu instead of calling `onAdd`. */
  addMenu?: MenuEntry[];
  /** Section actions behind a `⋯`, e.g. "Remove all". */
  menu?: MenuEntry[];
  /**
   * The list this section holds is empty. The section shrinks to its header
   * and `+`, which is what keeps a plain rectangle's panel short.
   */
  empty?: boolean;
  /** Text after the title, quieter, e.g. a count. */
  meta?: React.ReactNode;
  children?: React.ReactNode;
}

function useSectionOpen(subject: string, id: string, fallback: boolean, enabled: boolean) {
  const read = () => (enabled ? isSectionOpen(subject, id, fallback) : true);
  return useSyncExternalStore(subscribeSections, read, read);
}

export const Section: React.FC<SectionProps> = ({
  id,
  title,
  subject,
  collapsible = false,
  defaultOpen = true,
  onAdd,
  addLabel,
  addMenu,
  menu,
  empty = false,
  meta,
  children,
}) => {
  const panelSubject = useContext(PanelSubjectContext);
  const key = subject ?? panelSubject;
  const open = useSectionOpen(key, id, defaultOpen, collapsible);
  const bodyId = useId();
  const menuButton = useRef<HTMLButtonElement>(null);
  const addButton = useRef<HTMLButtonElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const canAdd = Boolean(onAdd) || Boolean(addMenu && addMenu.length > 0);

  const showBody = !empty && open && children != null;
  const toggle = () => setSectionOpen(key, id, !open);

  return (
    <section
      className="pg-section"
      data-section={id}
      data-empty={empty || undefined}
      data-open={showBody || undefined}
      aria-label={title}
    >
      <div className="pg-section__head">
        {collapsible && !empty ? (
          <button
            type="button"
            className="pg-section__title pg-section__title--button"
            aria-expanded={open}
            aria-controls={bodyId}
            onClick={toggle}
          >
            <ChevronRight size={12} className="pg-section__chevron" aria-hidden="true" />
            <span className="pg-section__label">{title}</span>
            {meta != null && <span className="pg-section__meta">{meta}</span>}
          </button>
        ) : (
          <h3 className="pg-section__title">
            <span className="pg-section__label">{title}</span>
            {meta != null && <span className="pg-section__meta">{meta}</span>}
          </h3>
        )}
        <span className="pg-section__actions">
          {menu && menu.length > 0 && (
            <button
              ref={menuButton}
              type="button"
              className="pg-icon-btn"
              aria-label={`${title} options`}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              data-tooltip="Options"
              onClick={() => setMenuOpen((v) => !v)}
            >
              <MoreHorizontal size={14} aria-hidden="true" />
            </button>
          )}
          {canAdd && (
            <button
              ref={addButton}
              type="button"
              className="pg-icon-btn"
              aria-label={addLabel ?? `Add ${title.toLowerCase()}`}
              aria-haspopup={addMenu ? 'menu' : undefined}
              aria-expanded={addMenu ? addOpen : undefined}
              data-tooltip={addLabel ?? `Add ${title.toLowerCase()}`}
              onClick={() => (addMenu && addMenu.length > 0 ? setAddOpen((v) => !v) : onAdd?.())}
            >
              <Plus size={14} aria-hidden="true" />
            </button>
          )}
        </span>
      </div>
      {showBody && (
        <div id={bodyId} className="pg-section__body">
          {children}
        </div>
      )}
      {addOpen && addMenu && addButton.current && (
        <Menu
          entries={addMenu}
          label={addLabel ?? `Add ${title.toLowerCase()}`}
          anchor={{ kind: 'rect', rect: addButton.current.getBoundingClientRect(), align: 'end' }}
          onClose={() => setAddOpen(false)}
        />
      )}
      {menuOpen && menu && menuButton.current && (
        <Menu
          entries={menu}
          label={`${title} options`}
          anchor={{ kind: 'rect', rect: menuButton.current.getBoundingClientRect(), align: 'end' }}
          onClose={() => setMenuOpen(false)}
        />
      )}
    </section>
  );
};
