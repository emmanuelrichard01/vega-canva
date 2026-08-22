import { updateNode } from '../engine/document';

export type LayoutMode = 'smart' | 'radial' | 'tree' | 'grid';

interface SpatialObject {
  id: string;
  type: string;
  x: number;
  y: number;
  content?: any;
  scaleX?: number;
  scaleY?: number;
  createdAt?: number;
}

export const calculateLayout = (objects: Record<string, any>, mode: LayoutMode): Record<string, { x: number, y: number }> => {
  const objList: SpatialObject[] = Object.values(objects);
  if (objList.length === 0) return {};

  const targetPositions: Record<string, { x: number, y: number }> = {};

  // Calculate center of mass
  const totalX = objList.reduce((acc, o) => acc + o.x, 0);
  const totalY = objList.reduce((acc, o) => acc + o.y, 0);
  const centerX = totalX / objList.length;
  const centerY = totalY / objList.length;

  switch (mode) {
    case 'grid': {
      const cols = Math.ceil(Math.sqrt(objList.length));
      const spacingX = 240;
      const spacingY = 240;
      const startX = centerX - (cols * spacingX) / 2;
      const startY = centerY - (Math.ceil(objList.length / cols) * spacingY) / 2;

      objList.forEach((obj, idx) => {
        const row = Math.floor(idx / cols);
        const col = idx % cols;
        targetPositions[obj.id] = {
          x: startX + col * spacingX,
          y: startY + row * spacingY
        };
      });
      break;
    }

    case 'radial': {
      const radiusStep = 180;
      let currentRing = 0;
      let countInRing = 1;
      let angleOffset = 0;

      objList.forEach((obj, idx) => {
        if (idx === 0) {
          targetPositions[obj.id] = { x: centerX, y: centerY };
          return;
        }

        const ringRadius = currentRing * radiusStep;
        const angle = angleOffset + (idx % countInRing) * ((2 * Math.PI) / countInRing);
        targetPositions[obj.id] = {
          x: centerX + ringRadius * Math.cos(angle),
          y: centerY + ringRadius * Math.sin(angle)
        };

        if (idx % countInRing === countInRing - 1) {
          currentRing++;
          countInRing = Math.floor(2 * Math.PI * currentRing);
          angleOffset += 0.2;
        }
      });
      break;
    }

    case 'tree': {
      const levelHeight = 220;
      const siblingWidth = 220;
      // Group by type
      const groups: Record<string, SpatialObject[]> = {};
      objList.forEach(o => {
        const gKey = o.type;
        if (!groups[gKey]) groups[gKey] = [];
        groups[gKey].push(o);
      });

      let currentY = centerY - (Object.keys(groups).length * levelHeight) / 2;
      Object.values(groups).forEach(group => {
        const groupWidth = group.length * siblingWidth;
        const startX = centerX - groupWidth / 2;
        group.forEach((obj, i) => {
          targetPositions[obj.id] = {
            x: startX + i * siblingWidth,
            y: currentY
          };
        });
        currentY += levelHeight;
      });
      break;
    }

    case 'smart':
    default: {
      // Smart Clustering by Color & Proximity
      // Cluster by the object's dominant colour. Stickies are keyed by theme,
      // painted objects by their first fill, and text by its colour — reading
      // `content.color`/`content.fill` matched none of those any more, so
      // every object landed in a single "default" cluster and Tidy degenerated
      // into one undifferentiated ring.
      const colorClusters: Record<string, SpatialObject[]> = {};
      objList.forEach(o => {
        const node = o as any;
        const colorKey =
          node.theme ??
          node.appearance?.fill?.[0]?.color ??
          node.typography?.color ??
          'default';
        if (!colorClusters[colorKey]) colorClusters[colorKey] = [];
        colorClusters[colorKey].push(o);
      });

      const clusterKeys = Object.keys(colorClusters);
      const clusterAngleStep = (2 * Math.PI) / clusterKeys.length;
      const clusterDistance = Math.max(350, Math.sqrt(objList.length) * 120);

      clusterKeys.forEach((key, cIdx) => {
        const clusterObjs = colorClusters[key];
        const clusterAngle = cIdx * clusterAngleStep;
        const clusterCX = centerX + clusterDistance * Math.cos(clusterAngle);
        const clusterCY = centerY + clusterDistance * Math.sin(clusterAngle);

        const subCols = Math.ceil(Math.sqrt(clusterObjs.length));
        const spacing = 220;
        const subStartX = clusterCX - (subCols * spacing) / 2;
        const subStartY = clusterCY - (Math.ceil(clusterObjs.length / subCols) * spacing) / 2;

        clusterObjs.forEach((obj, idx) => {
          const r = Math.floor(idx / subCols);
          const c = idx % subCols;
          targetPositions[obj.id] = {
            x: subStartX + c * spacing,
            y: subStartY + r * spacing
          };
        });
      });
      break;
    }
  }

  // Preserve coordinates for pinned or locked objects so intentional structuring is never scrambled
  objList.forEach((obj) => {
    if ((obj as any).pinned === true || (obj as any).locked === true) {
      targetPositions[obj.id] = { x: obj.x, y: obj.y };
    }
  });

  return targetPositions;
};

// Smooth Spring Glide Animation Runner
let activeAnimationId: number | null = null;

export const animateToLayout = (
  objects: Record<string, any>,
  targetPositions: Record<string, { x: number, y: number }>
) => {
  if (activeAnimationId) {
    cancelAnimationFrame(activeAnimationId);
  }

  const currentPosMap: Record<string, { x: number, y: number, vx: number, vy: number }> = {};
  Object.entries(targetPositions).forEach(([id, _target]) => {
    const current = objects[id];
    if (current) {
      currentPosMap[id] = {
        x: current.x,
        y: current.y,
        vx: 0,
        vy: 0
      };
    }
  });

  const stiffness = 0.15;
  const damping = 0.75;
  const epsilon = 0.5;

  const step = () => {
    let allSettled = true;

    Object.entries(targetPositions).forEach(([id, target]) => {
      const cur = currentPosMap[id];
      if (!cur) return;

      const dx = target.x - cur.x;
      const dy = target.y - cur.y;

      // Spring physics
      const ax = dx * stiffness;
      const ay = dy * stiffness;

      cur.vx = (cur.vx + ax) * damping;
      cur.vy = (cur.vy + ay) * damping;

      cur.x += cur.vx;
      cur.y += cur.vy;

      if (Math.hypot(dx, dy) > epsilon || Math.hypot(cur.vx, cur.vy) > epsilon) {
        allSettled = false;
        updateNode(id, { x: cur.x, y: cur.y });
      } else {
        updateNode(id, { x: target.x, y: target.y });
      }
    });

    if (!allSettled) {
      activeAnimationId = requestAnimationFrame(step);
    } else {
      activeAnimationId = null;
    }
  };

  activeAnimationId = requestAnimationFrame(step);
};
