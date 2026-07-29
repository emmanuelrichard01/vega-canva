import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { X, Image as ImageIcon, FileJson, Download, CheckCircle2, Loader2, PenTool } from 'lucide-react';
import { ExportService } from '../../engine/export';
import { useFocusTrap } from '../../hooks/useFocusTrap';
import type { ExportFormat } from '../../engine/export/ExportTypes';

interface Props {
  onClose: () => void;
  title: string;
}

export const ExportModal: React.FC<Props> = ({ onClose, title }) => {
  const [format, setFormat] = useState<ExportFormat>('png');
  const [isExporting, setIsExporting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [hoveredFormat, setHoveredFormat] = useState<ExportFormat | null>(null);
  const [cancelHovered, setCancelHovered] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Escape to dismiss, Tab confined to the dialog, focus restored on close.
  const dialogRef = useFocusTrap(true, onClose);

  const handleExport = async () => {
    setIsExporting(true);
    setSuccess(false);
    setError(null);

    try {
      await ExportService.export(format, {
        filename: `${title.replace(/\s+/g, '-').toLowerCase()}-export.${format}`,
        // `scale` is the option the exporters actually read — `pixelRatio` was not a
        // valid ExportOptions key, so this request was silently dropped.
        scale: 2,
        // PNGExporter throws without this — it was never being passed here at
        // all, so every PNG export from this modal failed unconditionally.
        stage: (window as any)._konva_stage,
      });
      
      setSuccess(true);
      setTimeout(onClose, 1200); // Auto close on success
    } catch (e) {
      // A blocking `alert()` here stole focus out of the dialog, could not be
      // styled or read in context, and told the user nothing about what went
      // wrong. Surfacing the reason inline keeps the dialog usable and lets
      // them simply pick another format.
      console.error(e);
      setError(e instanceof Error ? e.message : 'Export failed. Please try again.');
    } finally {
      setIsExporting(false);
    }
  };

  const formats: { id: ExportFormat, name: string, desc: string, icon: any }[] = [
    { id: 'png', name: 'PNG Image', desc: 'High-resolution raster image (2x). Best for sharing.', icon: ImageIcon },
    { id: 'svg', name: 'SVG Vector', desc: 'Scalable vector graphics. Best for editing in Illustrator.', icon: PenTool },
    { id: 'json', name: 'JSON Data', desc: 'Raw document structure. Best for backups and version control.', icon: FileJson },
  ];

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 9999999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, background: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(8px)' }}>
      <motion.div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="export-modal-title"
        initial={{ opacity: 0, scale: 0.95, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 10 }}
        transition={{ type: 'spring', stiffness: 400, damping: 30 }}
        className="panel-surface"
        style={{ width: 440, borderRadius: 'var(--radius-2xl)', boxShadow: 'var(--shadow-overlay)', position: 'relative', overflow: 'hidden' }}
      >
        {/* Header */}
        <div style={{ padding: '24px 24px 16px', borderBottom: '1px solid var(--border-divider)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
            <h2 id="export-modal-title" style={{ margin: 0, fontSize: 18, fontWeight: 600, color: 'var(--text-primary)', letterSpacing: '-0.01em' }}>Export Canvas</h2>
            <button onClick={onClose} className="btn-icon" style={{ padding: 4 }} aria-label="Close">
              <X size={20} />
            </button>
          </div>
          <p style={{ margin: 0, fontSize: 13, color: 'var(--text-secondary)' }}>Download a high-fidelity copy of your work.</p>
        </div>

        {/* Content — a radio group, so arrow keys move between formats and a
            screen reader announces the selected one. */}
        <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 12 }} role="radiogroup" aria-label="Export format">
          {formats.map((f) => (
            <button
              key={f.id}
              role="radio"
              aria-checked={format === f.id}
              onClick={() => setFormat(f.id)}
              onMouseEnter={() => setHoveredFormat(f.id)}
              onMouseLeave={() => setHoveredFormat(null)}
              style={{
                display: 'flex', alignItems: 'flex-start', gap: 16, padding: 16,
                background: (format === f.id || hoveredFormat === f.id) ? 'var(--surface-hover)' : 'transparent',
                border: `1.5px solid ${(format === f.id || hoveredFormat === f.id) ? 'var(--amber-500)' : 'var(--border-divider)'}`,
                borderRadius: 12, cursor: 'pointer', textAlign: 'left',
                transition: 'all 0.15s ease'
              }}
            >
              <div style={{ 
                width: 40, height: 40, borderRadius: 10, 
                background: format === f.id ? 'var(--amber-500)' : 'var(--surface-elevated)', 
                color: format === f.id ? '#fff' : 'var(--text-secondary)',
                display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0
              }}>
                <f.icon size={20} />
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 2 }}>{f.name}</div>
                <div style={{ fontSize: 12, color: 'var(--text-tertiary)', lineHeight: 1.4 }}>{f.desc}</div>
              </div>
              <div style={{ 
                width: 20, height: 20, borderRadius: '50%', border: `2px solid ${format === f.id ? 'var(--amber-500)' : 'var(--border-divider)'}`,
                display: 'flex', alignItems: 'center', justifyContent: 'center'
              }}>
                {format === f.id && <div style={{ width: 10, height: 10, borderRadius: '50%', background: 'var(--amber-500)' }} />}
              </div>
            </button>
          ))}
        </div>

        {error && (
          <div
            role="alert"
            style={{
              margin: '0 24px 16px', padding: '10px 12px', borderRadius: 'var(--radius-lg)',
              background: 'color-mix(in srgb, var(--status-danger) 12%, transparent)',
              border: '1px solid color-mix(in srgb, var(--status-danger) 40%, transparent)',
              color: 'var(--text-primary)', fontSize: 'var(--text-sm)', lineHeight: 1.4,
            }}
          >
            {error}
          </div>
        )}

        {/* Footer */}
        <div style={{ padding: '16px 24px', background: 'var(--surface-elevated)', borderTop: '1px solid var(--border-divider)', display: 'flex', justifyContent: 'flex-end', gap: 12 }}>
          <button
            onClick={onClose}
            onMouseEnter={() => setCancelHovered(true)}
            onMouseLeave={() => setCancelHovered(false)}
            style={{ padding: '8px 16px', borderRadius: 8, fontSize: 14, fontWeight: 500, color: 'var(--text-secondary)', background: cancelHovered ? 'var(--surface-hover)' : 'transparent', border: 'none', cursor: 'pointer', transition: 'background 0.15s ease' }}
          >
            Cancel
          </button>
          <button 
            onClick={handleExport}
            disabled={isExporting || success}
            style={{ 
              padding: '8px 20px', borderRadius: 8, fontSize: 14, fontWeight: 600, 
              color: '#fff', background: success ? '#10B981' : 'var(--amber-500)', 
              border: 'none', cursor: isExporting ? 'default' : 'pointer',
              display: 'flex', alignItems: 'center', gap: 8,
              transition: 'background 0.2s',
              opacity: isExporting ? 0.8 : 1
            }}
          >
            {isExporting ? <Loader2 size={16} className="animate-spin" /> : 
             success ? <CheckCircle2 size={16} /> : 
             <Download size={16} />}
            {isExporting ? 'Exporting...' : success ? 'Done' : 'Export'}
          </button>
        </div>
      </motion.div>
    </div>
  );
};
