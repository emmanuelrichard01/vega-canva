import React, { useMemo } from 'react';
import { qrMatrix, qrPath } from '../../engine/share/qr';

/**
 * The link as something a phone can see.
 *
 * ## Why a board needs this
 *
 * The moment a whiteboard tool meets a real room, somebody is standing at a
 * screen and everyone else is holding a phone. Reading a URL aloud — with a
 * room code, or worse a signed token — is the single worst part of that, and
 * it is the part every one of these products eventually adds a QR code to.
 *
 * ## Why it is drawn rather than fetched
 *
 * Every obvious way to do this sends the link to somebody else's server to be
 * turned into a picture. On a product whose entire permission model is "the
 * link is the key", pasting private board links into a third-party image URL —
 * from the one dialog that exists to talk about who can see the board — is not
 * a trade worth making for a few hundred bytes of arithmetic. See `qr.ts`.
 *
 * ## Drawn to be scanned
 *
 * The quiet zone is real (four modules, as the format requires — a code
 * cropped tight to its edge is the most common reason a scan fails), the
 * modules are square and crisp because `shape-rendering: crispEdges` keeps
 * them off half-pixels at any size, and the colours are fixed dark-on-white
 * rather than themed. A scanner needs contrast in one direction; a QR code
 * rendered in a dark theme's inverted palette is a decoration.
 */
export const ShareQr: React.FC<{ url: string; label: string }> = ({ url, label }) => {
  const drawing = useMemo(() => {
    const matrix = qrMatrix(url);
    return matrix ? { size: matrix.length, path: qrPath(matrix) } : null;
  }, [url]);

  // Only when the link is too long for the largest version this encodes. The
  // rest of the dialog is unaffected: a QR code is an extra way to hand a link
  // over, never the only one.
  if (!drawing) return null;

  const quiet = 4;
  const side = drawing.size + quiet * 2;

  return (
    <svg
      className="share-qr"
      viewBox={`0 0 ${side} ${side}`}
      role="img"
      aria-label={`QR code for the ${label} link. Point a phone camera at it to open the board.`}
      shapeRendering="crispEdges"
    >
      <rect width={side} height={side} fill="#FFFFFF" />
      <g transform={`translate(${quiet} ${quiet})`}>
        <path d={drawing.path} fill="#161616" />
      </g>
    </svg>
  );
};
