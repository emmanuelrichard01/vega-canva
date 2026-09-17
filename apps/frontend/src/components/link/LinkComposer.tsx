import React from 'react';
import { ClipboardPaste, CornerDownLeft, Link2, Play } from 'lucide-react';
import { useStore } from '../../hooks/useStore';
import { parseLink, providerFor } from '../../engine/link/linkProviders';
import { createLink, replaceLinkUrl } from '../../engine/link/linkApply';
import { PORTAL_SURFACE_ATTR } from '../ui/portalSurface';
import './link.css';

/**
 * The field the Link tool opens where you clicked.
 *
 * ## It says what the link will become, before it is one
 *
 * As the address is typed the field names the provider and how it will
 * arrive — "YouTube · plays on the board", "GitHub · Pull request #42" — from
 * the same adapters that will build the card. A link that will embed says so
 * here, so nobody is surprised by a player where they expected a card.
 *
 * ## The clipboard, without asking
 *
 * If the clipboard already holds a link and the browser has *already* granted
 * permission to read it, the field offers it in one press. It never triggers a
 * permission prompt to find out: a dialog asking to read your clipboard, in
 * answer to clicking a board, is exactly the wrong feeling.
 */
export const LinkComposer: React.FC = () => {
  const at = useStore((s) => s.linkComposer);
  const close = React.useCallback(() => useStore.getState().setLinkComposer(null), []);
  if (!at) return null;
  return <Composer key={`${at.clientX},${at.clientY},${at.replaceId ?? ''}`} at={at} onClose={close} />;
};

const Composer: React.FC<{
  at: NonNullable<ReturnType<typeof useStore.getState>['linkComposer']>;
  onClose: () => void;
}> = ({ at, onClose }) => {
  const replacing = at.replaceId ? useStore.getState().objects[at.replaceId] : null;
  const [value, setValue] = React.useState(replacing && replacing.type === 'link' ? replacing.link.url : '');
  const [clip, setClip] = React.useState<string | null>(null);
  const [error, setError] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const rootRef = React.useRef<HTMLFormElement>(null);

  React.useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
    let cancelled = false;
    (async () => {
      try {
        const perm = await navigator.permissions?.query({ name: 'clipboard-read' as PermissionName });
        if (perm?.state !== 'granted') return;
        const text = await navigator.clipboard.readText();
        if (!cancelled && parseLink(text)) setClip(text.trim());
      } catch {
        /* no permission API, or no clipboard: nothing to offer */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  React.useEffect(() => {
    const onDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) onClose();
    };
    window.addEventListener('pointerdown', onDown, true);
    return () => window.removeEventListener('pointerdown', onDown, true);
  }, [onClose]);

  const parsed = parseLink(value);
  const provider = parsed ? providerFor(parsed.url) : null;
  const willEmbed = Boolean(provider?.embed && ['video', 'audio', 'design'].includes(provider.kind));

  const submit = (raw: string) => {
    if (replacing && replacing.type === 'link') {
      if (!replaceLinkUrl(replacing, raw)) {
        setError(true);
        return;
      }
      onClose();
      return;
    }
    const id = createLink(raw, { x: at.x, y: at.y });
    if (!id) {
      setError(true);
      return;
    }
    window.dispatchEvent(new CustomEvent('requestSelectNodes', { detail: { ids: [id] } }));
    onClose();
  };

  const left = Math.max(12, Math.min(at.clientX - 170, window.innerWidth - 352));
  const top = Math.max(12, Math.min(at.clientY + 12, window.innerHeight - 140));

  return (
    <form
      ref={rootRef}
      className="lnk-composer"
      style={{ left, top }}
      data-error={error || undefined}
      {...{ [PORTAL_SURFACE_ATTR]: 'link-composer' }}
      onSubmit={(e) => {
        e.preventDefault();
        submit(value);
      }}
    >
      <div className="lnk-composer__field">
        <Link2 size={15} aria-hidden className="lnk-composer__glyph" />
        <input
          ref={inputRef}
          value={value}
          placeholder={replacing ? 'Replace the link' : 'Paste or type a link'}
          spellCheck={false}
          autoCapitalize="off"
          aria-label="Link address"
          aria-invalid={error || undefined}
          onChange={(e) => {
            setValue(e.target.value);
            setError(false);
          }}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Escape') {
              e.preventDefault();
              onClose();
            }
          }}
          onPaste={(e) => {
            e.stopPropagation();
            // A pasted link is a finished thought: place it now.
            const text = e.clipboardData.getData('text');
            if (parseLink(text)) {
              e.preventDefault();
              submit(text);
            }
          }}
        />
        <button type="submit" className="lnk-composer__go" disabled={!parsed} aria-label={replacing ? 'Replace link' : 'Add link'}>
          <CornerDownLeft size={14} />
        </button>
      </div>

      {error ? (
        <p className="lnk-composer__hint lnk-composer__hint--error">That does not look like a web address.</p>
      ) : provider && parsed ? (
        <p className="lnk-composer__hint">
          <span className="lnk-composer__chip" style={{ background: provider.accent }} aria-hidden />
          <strong>{provider.id === 'web' ? parsed.host : provider.name}</strong>
          {provider.detail && <span> · {provider.detail}</span>}
          <span className="lnk-composer__how">
            {willEmbed ? (
              <>
                <Play size={11} aria-hidden /> plays on the board
              </>
            ) : (
              'arrives as a card'
            )}
          </span>
        </p>
      ) : clip ? (
        <button type="button" className="lnk-composer__clip" onClick={() => submit(clip)}>
          <ClipboardPaste size={13} aria-hidden />
          <span>Use the link on your clipboard</span>
          <span className="lnk-composer__clip-url">{parseLink(clip)?.display}</span>
        </button>
      ) : (
        <p className="lnk-composer__hint lnk-composer__hint--idle">Videos, Figma and Spotify play in place. Everything else becomes a card.</p>
      )}
    </form>
  );
};
