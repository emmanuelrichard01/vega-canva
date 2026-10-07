import React, { useSyncExternalStore } from 'react';
import { Crop, Download, ImageUp } from 'lucide-react';
import { cropMode } from '../../../engine/interaction/cropMode';
import { slotReframe } from '../../../engine/interaction/slotReframe';
import { pickImageFile, replaceImageFile } from '../../../engine/media/imageEdit';
import type { AnyNode, AudioNode, ImageNode } from '../../../engine/model/schema';
import { RailButton } from '../RailBase';
import { RailAnatomy } from './anatomy';
import { OpacityControl } from './controls';
import { downloadableSrc } from './imageActions';
import { KindLabel } from './kind';
import { kindOf } from './kindOf';
import { updateNode, type SingleRail } from './types';

/** A file name for a download: the object's title, or what it is. */
function fileNameFor(base: string, src: string, fallbackExt: string): string {
  const ext = /\.([a-z0-9]{2,5})(?:\?|#|$)/i.exec(src)?.[1] ?? fallbackExt;
  return `${base.replace(/[^\w-]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'download'}.${ext}`;
}

/** A link that saves `src`, disabled with a reason while there is nothing to save yet. */
const DownloadLink: React.FC<{ src: string | null; name: string; label: string }> = ({ src, name, label }) =>
  src ? (
    <a className="ctx-btn" href={src} download={name} data-tooltip={label} aria-label={label}>
      <Download size={16} />
    </a>
  ) : (
    <RailButton label={label} hint="Still uploading" disabled onClick={() => {}}>
      <Download size={16} />
    </RailButton>
  );

/**
 * A picture: crop or reframe it, swap it, take it away, see through it.
 *
 * A grid module owns its edges, so there the frame holds still and the
 * picture moves; the crop verb changes with who owns the edges.
 */
export const ImageRail: SingleRail<ImageNode> = ({ node, conditional, tail, tailControls }) => {
  const cropping = useSyncExternalStore(cropMode.subscribe, cropMode.getSnapshot, cropMode.getSnapshot);
  const reframing = useSyncExternalStore(slotReframe.subscribe, slotReframe.getSnapshot, slotReframe.getSnapshot);
  const isCropping = cropping?.nodeId === node.id;
  const isReframing = reframing?.nodeId === node.id;

  const crop = node.gridSlot ? (
    <RailButton
      label={isReframing ? 'Done reframing' : 'Reframe in module'}
      hint={isReframing ? 'Done reframing (Enter)' : 'Drag to move the picture, scroll to zoom'}
      pressed={isReframing}
      onClick={() => (isReframing ? slotReframe.commit() : slotReframe.enter({ nodeId: node.id, fit: node.gridSlot }))}
    >
      <Crop size={16} />
    </RailButton>
  ) : (
    <RailButton
      label={isCropping ? 'Done cropping' : 'Crop image'}
      hint={isCropping ? 'Done cropping (Enter)' : 'Crop image (double-click)'}
      pressed={isCropping}
      onClick={() =>
        isCropping
          ? cropMode.commit()
          : cropMode.enter({
              nodeId: node.id,
              node: { x: node.x, y: node.y, width: node.width, height: node.height },
              crop: node.crop,
            })
      }
    >
      <Crop size={16} />
    </RailButton>
  );

  return (
    <RailAnatomy
      verbs={[
        { id: 'crop', controls: 1, node: crop },
        {
          id: 'replace',
          controls: 1,
          node: (
            <RailButton
              label="Replace image"
              hint="Choose another picture for this frame. It is cropped to fill the same box."
              onClick={() => {
                void pickImageFile().then((file) => file && replaceImageFile(node, file));
              }}
            >
              <ImageUp size={16} />
            </RailButton>
          ),
        },
        {
          id: 'opacity',
          controls: 1,
          node: <OpacityControl value={node.opacity ?? 1} onChange={(opacity) => updateNode(node.id, { opacity })} />,
        },
        {
          id: 'download',
          controls: 1,
          node: (
            <DownloadLink
              src={downloadableSrc(node.src)}
              name={fileNameFor(node.title ?? 'image', node.src ?? '', 'png')}
              label="Download original"
            />
          ),
        },
      ]}
      conditional={conditional}
      tail={tail}
      tailControls={tailControls}
    />
  );
};

/** A voice note: take the recording away. */
export const AudioRail: SingleRail<AudioNode> = ({ node, conditional, tail, tailControls }) => (
  <RailAnatomy
    verbs={[
      {
        id: 'download',
        controls: 1,
        node: (
          <DownloadLink
            src={downloadableSrc(node.src)}
            name={fileNameFor(`voice-note-${node.author.name}`, node.src ?? '', 'webm')}
            label="Download recording"
          />
        ),
      },
    ]}
    conditional={conditional}
    tail={tail}
    tailControls={tailControls}
  />
);

/** Anything without a rail of its own: what it is, and the tail. */
export const DefaultRail: SingleRail<AnyNode> = ({ node, subject, conditional, tail, tailControls }) => {
  const kind = kindOf(node, subject);
  return (
    <RailAnatomy
      kind={<KindLabel icon={kind.icon} name={kind.name} />}
      conditional={conditional}
      tail={tail}
      tailControls={tailControls}
    />
  );
};
