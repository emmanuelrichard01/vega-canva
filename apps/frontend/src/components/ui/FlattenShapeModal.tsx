import React, { useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useStore } from '../../hooks/useStore';
import { flattenToPath } from '../../engine/document/vectorOps';
import { pathEdit } from '../../engine/interaction/pathEdit';
import { editor } from '../../engine/api/EditorAPI';

/**
 * Dedicated compact vector edit icon for the inline banner.
 */
const VectorEditIcon: React.FC<{ size?: number }> = ({ size = 14 }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden style={{ display: 'block', flexShrink: 0 }}>
    <path d="M3 13 C 3 7, 9 9, 13 3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    <rect x="1.5" y="11.5" width="3" height="3" rx="0.5" fill="currentColor" stroke="currentColor" strokeWidth="0.5" />
    <rect x="11.5" y="1.5" width="3" height="3" rx="0.5" fill="currentColor" stroke="currentColor" strokeWidth="0.5" />
  </svg>
);

/**
 * Inline action banner replacing the jarring fullscreen confirmation modal.
 *
 * Instead of taking over the entire screen with a dark blurred backdrop,
 * this renders as an elegant floating action pill above the bottom dock —
 * matching professional creative suites (e.g. Figma/Sketch).
 *
 * Non-blocking: the canvas stays fully visible and interactive.
 *
 * ## Auto-dismiss & Keyboard
 * - Escape / Cancel: closes banner and returns tool cleanly to 'select'.
 * - Enter / Convert: converts shape to path, activates 'direct-select' and opens anchors.
 * - Tool switch or node deletion: automatically cleans up the banner.
 */
export const FlattenShapeModal: React.FC = () => {
  const flattenNodeId = useStore((s) => s.flattenConfirmNodeId);
  const setFlattenConfirmNodeId = useStore((s) => s.setFlattenConfirmNodeId);
  const node = useStore((s) => (flattenNodeId ? s.objects[flattenNodeId] : null));
  const confirmRef = useRef<HTMLButtonElement>(null);

  const handleClose = React.useCallback(() => {
    setFlattenConfirmNodeId(null);
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('legacy_tool_change', { detail: 'select' }));
    }
  }, [setFlattenConfirmNodeId]);

  const handleConfirm = React.useCallback(() => {
    if (!flattenNodeId) return;
    const targetId = flattenNodeId;
    setFlattenConfirmNodeId(null);
    const newId = flattenToPath(targetId);
    if (newId) {
      editor.select(newId);
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('legacy_tool_change', { detail: 'direct-select' }));
      }
      pathEdit.enter(newId);
    }
  }, [flattenNodeId, setFlattenConfirmNodeId]);

  // Keyboard: Enter confirms, Escape cancels
  useEffect(() => {
    if (!flattenNodeId) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        handleClose();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        handleConfirm();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [flattenNodeId, handleClose, handleConfirm]);

  // Auto-dismiss when tool changes away from direct-select
  useEffect(() => {
    if (!flattenNodeId) return;
    const onToolChange = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail && detail !== 'direct-select') {
        setFlattenConfirmNodeId(null);
      }
    };
    window.addEventListener('legacy_tool_change', onToolChange);
    return () => window.removeEventListener('legacy_tool_change', onToolChange);
  }, [flattenNodeId, setFlattenConfirmNodeId]);

  // Auto-dismiss when the underlying node is deleted or unmounted
  useEffect(() => {
    if (flattenNodeId && !node) {
      setFlattenConfirmNodeId(null);
    }
  }, [flattenNodeId, node, setFlattenConfirmNodeId]);

  // Focus the confirm button on mount for immediate keyboard accessibility
  useEffect(() => {
    if (flattenNodeId && node && confirmRef.current) {
      confirmRef.current.focus();
    }
  }, [flattenNodeId, node]);

  if (!flattenNodeId || !node || node.type !== 'shape') return null;

  const shapeKind = node.geometry?.kind || 'shape';
  const shapeName = shapeKind.charAt(0).toUpperCase() + shapeKind.slice(1);

  return (
    <AnimatePresence>
      <motion.div
        className="flatten-banner"
        role="alertdialog"
        aria-label={`Convert ${shapeName} to editable vector path`}
        initial={{ opacity: 0, y: 14, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 14, scale: 0.98 }}
        transition={{ type: 'spring', duration: 0.28, bounce: 0 }}
      >
        {/* Icon + Message */}
        <div className="flatten-banner-body">
          <span className="flatten-banner-icon" aria-hidden="true">
            <VectorEditIcon size={14} />
          </span>
          <span className="flatten-banner-text">
            Flatten <strong>{shapeName.toLowerCase()}</strong> to editable path?
          </span>
        </div>

        {/* Action buttons */}
        <div className="flatten-banner-actions">
          <button
            type="button"
            className="flatten-banner-btn flatten-banner-btn--cancel"
            onClick={handleClose}
          >
            Cancel
          </button>
          <button
            ref={confirmRef}
            type="button"
            className="flatten-banner-btn flatten-banner-btn--confirm"
            onClick={handleConfirm}
          >
            <VectorEditIcon size={12} />
            Convert &amp; Edit
          </button>
        </div>
      </motion.div>
    </AnimatePresence>
  );
};
