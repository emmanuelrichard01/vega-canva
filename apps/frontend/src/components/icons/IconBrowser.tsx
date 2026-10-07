import React, { memo, useCallback, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ICON_GAP, ICON_TILE_W, iconGrid } from './IconBrowserLayout';
import { Search, X } from 'lucide-react';
import { cameraSystem } from '../../engine/CameraSystem';
import { notify } from '../../engine/ui/notices';
import { canEditObjects } from '../../engine/model/permissions';
import { artFor, drawArt } from '../../engine/icons/iconCache';
import {
  catalogueNow,
  iconEntryNow,
  loadCatalogue,
  loadPackIndex,
  packIndexFailed,
  packIndexNow,
  subscribeIconPacks,
  iconPacksEpoch,
} from '../../engine/icons/iconPacks';
import { placeIcon } from '../../engine/icons/iconPlace';
import { searchCatalogue } from '../../engine/icons/iconSearch';
import { closeIconBrowser, readRecentIcons, useIconBrowser } from '../../engine/icons/iconStore';
import type { IconCatalogue, IconPackInfo } from '../../engine/icons/iconTypes';
import './iconBrowser.css';

/**
 * The icon library: a docked, searchable, categorised browser over the packs.
 *
 * Packs load when they are looked at. The catalogue (names only) arrives with
 * the first view of a pack; artwork loads per category as its tiles scroll into
 * view. The grid is virtualised, so a pack of a thousand icons mounts about
 * forty tiles.
 *
 * Placing: click puts the icon at the viewport centre and selects it; dragging
 * drops it at the pointer; Shift keeps the browser open for placing several.
 */

const TILE_W = ICON_TILE_W;
const ROW_H = 92;
const HEAD_H = 34;
const GAP = ICON_GAP;
const DRAG_START_PX = 6;

interface Item {
  iconId: string;
  name: string;
}
type Row =
  | { kind: 'head'; key: string; name: string; count: number; top: number }
  | { kind: 'tiles'; key: string; items: Item[]; top: number; index: number };

const useEpoch = () => {
  const [, force] = useReducer((n: number) => n + 1, 0);
  useEffect(() => subscribeIconPacks(force), []);
  return iconPacksEpoch();
};

// -------------------------------------------------------------------- thumbnail

/** One icon, drawn from the shared cache onto a small canvas. */
const IconThumb = memo(function IconThumb({ pack, iconId, size }: { pack: string; iconId: string; size: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [, bump] = useReducer((n: number) => n + 1, 0);
  const entry = iconEntryNow(pack, iconId);

  useEffect(() => {
    if (entry !== undefined) return;
    return subscribeIconPacks(() => {
      if (iconEntryNow(pack, iconId) !== undefined) bump();
    });
  }, [entry, pack, iconId]);

  useLayoutEffect(() => {
    const canvas = ref.current;
    if (!canvas || !entry) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(size * dpr);
    canvas.height = Math.round(size * dpr);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    drawArt(ctx, artFor(`${pack}:${iconId}`, entry), size, size);
  }, [entry, pack, iconId, size]);

  if (entry === undefined) return <span className="icb-skel" style={{ width: size, height: size }} aria-hidden="true" />;
  if (entry === null) return <span className="icb-missing" style={{ width: size, height: size }} aria-hidden="true" />;
  return <canvas ref={ref} className="icb-thumb" style={{ width: size, height: size }} aria-hidden="true" />;
});

// -------------------------------------------------------------------- browser

const safeUrl = (u: string) => (/^https:\/\//.test(u) ? u : undefined);

export const IconBrowser: React.FC = () => {
  const { pack: requestedPack, query: requestedQuery, nonce } = useIconBrowser();
  const epoch = useEpoch();
  const index = packIndexNow();
  const [pack, setPack] = useState<string | undefined>(requestedPack);
  const [query, setQuery] = useState(requestedQuery ?? '');
  const [active, setActive] = useState(0);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewH, setViewH] = useState(400);
  const [viewW, setViewW] = useState(400);
  const [drag, setDrag] = useState<{ x: number; y: number; item: Item } | null>(null);

  const panelRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const dragRef = useRef<{ item: Item; sx: number; sy: number; moved: boolean } | null>(null);

  // A fresh open call resets the browser, even with the same options.
  useEffect(() => {
    setPack(requestedPack);
    setQuery(requestedQuery ?? '');
    setActive(0);
  }, [nonce, requestedPack, requestedQuery]);

  useEffect(() => {
    void loadPackIndex();
  }, []);
  useEffect(() => {
    searchRef.current?.focus();
  }, [nonce]);

  // Settle on the first pack that shipped once the index arrives.
  const packs = index?.packs ?? [];
  const unavailable = index?.unavailable ?? [];
  const currentPack = pack ?? packs[0]?.id;
  const info: IconPackInfo | undefined = packs.find((p) => p.id === currentPack);
  const missing = unavailable.find((u) => u.id === currentPack);

  useEffect(() => {
    if (info) void loadCatalogue(info.id);
  }, [info]);
  const catalogue: IconCatalogue | undefined = info ? catalogueNow(info.id) : undefined;
  void epoch;

  // ---- rows
  const { rows, tileRows, totalH, total } = useMemo(() => {
    const out: Row[] = [];
    const tiles: Array<Extract<Row, { kind: 'tiles' }>> = [];
    let top = 0;
    let count = 0;
    const { cols } = iconGrid(viewW);
    const section = (key: string, name: string, items: Item[]) => {
      if (!items.length) return;
      out.push({ kind: 'head', key: `h-${key}`, name, count: items.length, top });
      top += HEAD_H;
      for (let i = 0; i < items.length; i += cols) {
        const row = { kind: 'tiles' as const, key: `${key}-${i}`, items: items.slice(i, i + cols), top, index: tiles.length };
        out.push(row);
        tiles.push(row);
        top += ROW_H;
      }
      count += items.length;
    };
    if (info && catalogue) {
      if (query.trim()) {
        const hits = searchCatalogue(catalogue, query);
        section('results', `${hits.length} ${hits.length === 1 ? 'result' : 'results'}`, hits.map((h) => ({ iconId: h.iconId, name: h.name })));
      } else {
        const names = new Map(catalogue.icons.map(([id, name]) => [id, name]));
        const recent = readRecentIcons()
          .filter((r) => r.pack === info.id && names.has(r.iconId))
          .slice(0, 12)
          .map((r) => ({ iconId: r.iconId, name: names.get(r.iconId) ?? '' }));
        section('recent', 'Recent', recent);
        const byCat = new Map<string, Item[]>();
        for (const [iconId, name] of catalogue.icons) {
          const cat = iconId.slice(0, iconId.indexOf('/'));
          if (!byCat.has(cat)) byCat.set(cat, []);
          byCat.get(cat)!.push({ iconId, name });
        }
        for (const [cat, catName] of catalogue.cats) section(cat, catName, byCat.get(cat) ?? []);
      }
    }
    return { rows: out, tileRows: tiles, totalH: top, total: count };
  }, [info, catalogue, query, viewW]);

  const activeSafe = Math.min(active, Math.max(0, tileRows.length ? tileRows.reduce((n, r) => n + r.items.length, 0) - 1 : 0));
  const locate = useCallback(
    (flat: number) => {
      let n = flat;
      for (const r of tileRows) {
        if (n < r.items.length) return { row: r, col: n };
        n -= r.items.length;
      }
      return null;
    },
    [tileRows],
  );
  const flatOf = (rowIndex: number, col: number) => tileRows.slice(0, rowIndex).reduce((n, r) => n + r.items.length, 0) + col;
  const activeLoc = locate(activeSafe);
  const activeItem = activeLoc ? activeLoc.row.items[activeLoc.col] : undefined;

  // ---- measure
  useLayoutEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const measure = () => {
      setViewH(el.clientHeight);
      setViewW(el.clientWidth);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [info?.id, missing?.id]);

  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = 0;
    setScrollTop(0);
    setActive(0);
  }, [currentPack, query]);

  // ---- window
  const visible = useMemo(() => {
    const from = scrollTop - ROW_H * 2;
    const to = scrollTop + viewH + ROW_H * 2;
    return rows.filter((r) => r.top + (r.kind === 'head' ? HEAD_H : ROW_H) >= from && r.top <= to);
  }, [rows, scrollTop, viewH]);

  const scrollToRow = (row: { top: number }) => {
    const el = listRef.current;
    if (!el) return;
    if (row.top < el.scrollTop + HEAD_H) el.scrollTop = Math.max(0, row.top - HEAD_H);
    else if (row.top + ROW_H > el.scrollTop + el.clientHeight) el.scrollTop = row.top + ROW_H - el.clientHeight;
  };

  // ---- placing
  const place = useCallback(
    (item: Item, at: { x: number; y: number } | null, keepOpen: boolean) => {
      if (!info) return;
      const world = at ?? cameraSystem.screenToWorld(window.innerWidth / 2, window.innerHeight / 2);
      const entry = iconEntryNow(info.id, item.iconId) ?? undefined;
      const id = placeIcon({ pack: info.id, iconId: item.iconId }, world, entry);
      if (!id) {
        notify({ message: canEditObjects() ? 'That icon could not be placed' : 'You need edit access to place icons' });
        return;
      }
      if (!keepOpen) closeIconBrowser();
    },
    [info],
  );

  // ---- pointer: click places, drag drops
  const onTileDown = (e: React.PointerEvent, item: Item) => {
    if (e.button !== 0) return;
    dragRef.current = { item, sx: e.clientX, sy: e.clientY, moved: false };
    const move = (ev: PointerEvent) => {
      const d = dragRef.current;
      if (!d) return;
      if (!d.moved && Math.hypot(ev.clientX - d.sx, ev.clientY - d.sy) < DRAG_START_PX) return;
      d.moved = true;
      setDrag({ x: ev.clientX, y: ev.clientY, item: d.item });
    };
    const up = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancel);
      const d = dragRef.current;
      dragRef.current = null;
      setDrag(null);
      if (!d || !d.moved) return;
      const over = document.elementFromPoint(ev.clientX, ev.clientY);
      if (panelRef.current?.contains(over)) return;
      place(d.item, cameraSystem.screenToWorld(ev.clientX, ev.clientY), ev.shiftKey);
    };
    const cancel = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancel);
      dragRef.current = null;
      setDrag(null);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancel);
  };

  // ---- keyboard
  const onListKey = (e: React.KeyboardEvent) => {
    if (!activeLoc) return;
    const { row, col } = activeLoc;
    let next: number | null = null;
    const perRow = tileRows[0]?.items.length ?? 1;
    switch (e.key) {
      case 'ArrowRight': next = activeSafe + 1; break;
      case 'ArrowLeft': next = activeSafe - 1; break;
      case 'ArrowDown': {
        const r = tileRows[row.index + 1];
        next = r ? flatOf(r.index, Math.min(col, r.items.length - 1)) : activeSafe;
        break;
      }
      case 'ArrowUp': {
        const r = tileRows[row.index - 1];
        if (r) next = flatOf(r.index, Math.min(col, r.items.length - 1));
        else {
          searchRef.current?.focus();
          e.preventDefault();
          return;
        }
        break;
      }
      case 'Home': next = 0; break;
      case 'End': next = tileRows.reduce((n, r) => n + r.items.length, 0) - 1; break;
      case 'PageDown': next = activeSafe + perRow * 4; break;
      case 'PageUp': next = activeSafe - perRow * 4; break;
      case 'Enter':
      case ' ':
        if (activeItem) place(activeItem, null, e.shiftKey);
        e.preventDefault();
        return;
      default:
        return;
    }
    e.preventDefault();
    const total2 = tileRows.reduce((n, r) => n + r.items.length, 0);
    next = Math.max(0, Math.min(total2 - 1, next ?? 0));
    setActive(next);
    const loc = locate(next);
    if (loc) scrollToRow(loc.row);
  };

  const onSearchKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown' && tileRows.length) {
      e.preventDefault();
      listRef.current?.focus();
    } else if (e.key === 'Enter' && activeItem) {
      e.preventDefault();
      place(activeItem, null, e.shiftKey);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      if (query) setQuery('');
      else closeIconBrowser();
    }
  };

  const onPanelKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape' && e.target !== searchRef.current) {
      e.preventDefault();
      e.stopPropagation();
      closeIconBrowser();
    }
  };

  // ---- tabs
  const allTabs = [
    ...packs.map((p) => ({ id: p.id, name: p.name, ok: true })),
    ...unavailable.map((u) => ({ id: u.id, name: u.name, ok: false })),
  ];
  const onTabKey = (e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    const i = allTabs.findIndex((t) => t.id === currentPack);
    const n = allTabs[(i + (e.key === 'ArrowRight' ? 1 : -1) + allTabs.length) % allTabs.length];
    if (n) {
      e.preventDefault();
      setPack(n.id);
      (e.currentTarget.querySelector(`[data-pack="${n.id}"]`) as HTMLElement | null)?.focus();
    }
  };

  /** Where the grid starts, so it sits centred in the list. See `iconGrid`. */
  const gridInset = iconGrid(viewW).inset;
  const loading = !index && !packIndexFailed();
  const catalogueLoading = Boolean(info) && !catalogue;

  return (
    <>
      <div
        ref={panelRef}
        className="icb"
        role="dialog"
        aria-label="Icon library"
        data-portal-surface="icon-browser"
        onKeyDown={onPanelKey}
      >
        <div className="icb__top">
          <label className="icb__search">
            <Search size={15} aria-hidden="true" />
            <input
              ref={searchRef}
              type="search"
              value={query}
              placeholder={info ? `Search ${info.name} icons` : 'Search icons'}
              aria-label="Search icons"
              aria-controls="icb-list"
              spellCheck={false}
              autoComplete="off"
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={onSearchKey}
            />
          </label>
          <button type="button" className="icb__close" aria-label="Close icon library" onClick={closeIconBrowser}>
            <X size={15} aria-hidden="true" />
          </button>
        </div>

        <div className="icb__tabs" role="tablist" aria-label="Icon libraries" onKeyDown={onTabKey}>
          {loading && [0, 1, 2, 3].map((i) => <span key={i} className="icb-skel icb-skel--tab" aria-hidden="true" />)}
          {allTabs.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              data-pack={t.id}
              aria-selected={t.id === currentPack}
              aria-disabled={!t.ok || undefined}
              tabIndex={t.id === currentPack ? 0 : -1}
              className="icb__tab"
              data-unavailable={!t.ok || undefined}
              onClick={() => setPack(t.id)}
            >
              {t.name}
            </button>
          ))}
        </div>

        <div className="icb__body">
          {packIndexFailed() && !index && (
            <div className="icb__empty" role="status">
              <p>The icon libraries could not be loaded.</p>
              <button type="button" className="icb__retry" onClick={() => void loadPackIndex()}>Try again</button>
            </div>
          )}
          {missing && (
            <div className="icb__empty" role="status">
              <p className="icb__empty-title">{missing.name} icons are not included</p>
              <p>{missing.reason}</p>
            </div>
          )}
          {info && (
            <div
              id="icb-list"
              ref={listRef}
              className="icb__list"
              role="listbox"
              tabIndex={0}
              aria-label={`${info.name} icons`}
              aria-activedescendant={activeItem ? `icb-${activeItem.iconId.replace(/[^\w-]/g, '_')}` : undefined}
              onKeyDown={onListKey}
              onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
            >
              {catalogueLoading && (
                <div className="icb__skeletons" aria-hidden="true">
                  {Array.from({ length: 24 }, (_, i) => (
                    <span key={i} className="icb-skel icb-skel--tile" />
                  ))}
                </div>
              )}
              {catalogue && total === 0 && (
                <div className="icb__empty" role="status">
                  <p>No icons match “{query}”.</p>
                </div>
              )}
              <div className="icb__space" style={{ height: totalH }}>
                {visible.map((r) =>
                  r.kind === 'head' ? (
                    <div key={r.key} className="icb__head" style={{ top: r.top, height: HEAD_H, paddingInline: gridInset + 8 }} role="presentation">
                      <span>{r.name}</span>
                      <span className="icb__count">{r.count}</span>
                    </div>
                  ) : (
                    <div key={r.key} className="icb__row" style={{ top: r.top, height: ROW_H, left: gridInset }} role="presentation">
                      {r.items.map((item) => {
                        const isActive = activeItem?.iconId === item.iconId && activeLoc?.row.key === r.key;
                        return (
                          <div
                            key={item.iconId}
                            id={`icb-${item.iconId.replace(/[^\w-]/g, '_')}`}
                            role="option"
                            aria-selected={isActive}
                            aria-label={item.name}
                            className="icb__tile"
                            data-active={isActive || undefined}
                            style={{ width: TILE_W, height: ROW_H - GAP }}
                            title={item.name}
                            onPointerDown={(e) => onTileDown(e, item)}
                            onClick={(e) => {
                              setActive(flatOf(r.index, r.items.indexOf(item)));
                              if (!dragRef.current?.moved) place(item, null, e.shiftKey);
                            }}
                          >
                            <IconThumb pack={info.id} iconId={item.iconId} size={44} />
                            <span className="icb__name">{item.name}</span>
                          </div>
                        );
                      })}
                    </div>
                  ),
                )}
              </div>
            </div>
          )}
        </div>

        {info && (
          <div className="icb__foot">
            <span className="icb__attr" title={info.attribution}>
              {info.licence}
            </span>
            {safeUrl(info.licenceUrl) && (
              <a href={safeUrl(info.licenceUrl)} target="_blank" rel="noopener noreferrer">
                Terms
              </a>
            )}
            {safeUrl(info.source) && (
              <a href={safeUrl(info.source)} target="_blank" rel="noopener noreferrer">
                Source
              </a>
            )}
          </div>
        )}
      </div>

      {drag &&
        createPortal(
          <div className="icb-ghost" style={{ left: drag.x, top: drag.y }} aria-hidden="true">
            {info && <IconThumb pack={info.id} iconId={drag.item.iconId} size={48} />}
          </div>,
          document.body,
        )}
    </>
  );
};
