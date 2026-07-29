import { presenceStore } from './PresenceStore';
import { useStore } from '../hooks/useStore';

// Duplicated (not imported) from StickyRenderer.tsx's THEMES on purpose —
// that file pulls in react-konva at module scope, which this plain
// canvas-2d engine has no other reason to depend on. Keep the bg colors in
// sync if the palette there ever changes.
const STICKY_THEME_COLORS: Record<string, string> = {
  yellow: '#FDE047', mint: '#6EE7B7', sky: '#7DD3FC', pink: '#F9A8D4',
  lavender: '#D8B4FE', peach: '#FDBA74', white: '#FFFFFF', dark: '#1F2937',
};

export class MinimapEngine {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private frameId: number = 0;
  
  // Projection state
  private minX: number = 0;
  private minY: number = 0;
  private maxX: number = 0;
  private maxY: number = 0;
  private scale: number = 1;
  private xOffset: number = 0;
  private yOffset: number = 0;

  // Local viewport
  public localViewport: { x: number, y: number, zoom: number, width: number, height: number } | null = null;
  public onClick: ((worldX: number, worldY: number) => void) | null = null;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error("Could not get 2D context");
    this.ctx = ctx;

    this.canvas.addEventListener('mousedown', this.handleMouseDown);
    this.start();
  }

  private handleMouseDown = (e: MouseEvent) => {
    if (!this.onClick) return;
    const rect = this.canvas.getBoundingClientRect();
    const mapX = e.clientX - rect.left;
    const mapY = e.clientY - rect.top;
    
    // Reverse projection
    const worldX = (mapX - this.xOffset) / this.scale + this.minX;
    const worldY = (mapY - this.yOffset) / this.scale + this.minY;
    
    this.onClick(worldX, worldY);
  };

  private calculateBounds() {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

    Object.values(useStore.getState().objects).forEach((node) => {
      // A hidden object doesn't render on the real canvas but was still
      // counted here, so it could silently pull the radar's bounds/zoom out
      // to include empty space that isn't visible anywhere.
      if (node.hidden) return;

      const w = node.width * Math.abs(node.scaleX || 1);
      const h = node.height * Math.abs(node.scaleY || 1);

      minX = Math.min(minX, node.x);
      minY = Math.min(minY, node.y);
      maxX = Math.max(maxX, node.x + w);
      maxY = Math.max(maxY, node.y + h);
    });

    const activeUsers = presenceStore.getActiveUsers();
    activeUsers.forEach(u => {
      if (u.viewport) {
        minX = Math.min(minX, u.viewport.x);
        minY = Math.min(minY, u.viewport.y);
        maxX = Math.max(maxX, u.viewport.x + (u.viewport.width / u.viewport.zoom));
        maxY = Math.max(maxY, u.viewport.y + (u.viewport.height / u.viewport.zoom));
      }
    });

    if (this.localViewport) {
      minX = Math.min(minX, this.localViewport.x);
      minY = Math.min(minY, this.localViewport.y);
      maxX = Math.max(maxX, this.localViewport.x + (this.localViewport.width / this.localViewport.zoom));
      maxY = Math.max(maxY, this.localViewport.y + (this.localViewport.height / this.localViewport.zoom));
    }

    if (minX === Infinity) {
      minX = -1000; minY = -1000; maxX = 1000; maxY = 1000;
    }

    const padding = 250;
    this.minX = minX - padding;
    this.minY = minY - padding;
    this.maxX = maxX + padding;
    this.maxY = maxY + padding;

    const worldWidth = this.maxX - this.minX;
    const worldHeight = this.maxY - this.minY;
    const mapWidth = this.canvas.width;
    const mapHeight = this.canvas.height;

    const scaleX = mapWidth / worldWidth;
    const scaleY = mapHeight / worldHeight;
    this.scale = Math.min(scaleX, scaleY);

    this.xOffset = (mapWidth - worldWidth * this.scale) / 2;
    this.yOffset = (mapHeight - worldHeight * this.scale) / 2;
  }

  private worldToMini(x: number, y: number) {
    return {
      x: (x - this.minX) * this.scale + this.xOffset,
      y: (y - this.minY) * this.scale + this.yOffset
    };
  }

  private render = () => {
    // 1. Advance Interpolation (Presence Engine)
    presenceStore.updateInterpolation();

    // 2. Clear & Calculate Bounds
    const w = this.canvas.width;
    const h = this.canvas.height;
    this.ctx.clearRect(0, 0, w, h);
    
    // Doing bounds calculation every frame for simplicity. 
    // In a massive app, this would run every 10-20 frames, or on dirty rects.
    this.calculateBounds(); 

    // PASS 1: Draw Objects
    //
    // Read from the canonical store rather than the raw Y.Maps. Reading the
    // document directly bypasses normalization, so this drew from whatever
    // field layout happened to be persisted — most visibly it looked for a
    // sticky's colour under `appearance.theme`, which is the pre-v2 location,
    // so recolouring a sticky updated the canvas but left the radar showing
    // the old colour.
    Object.values(useStore.getState().objects).forEach((node) => {
      if (node.hidden) return;

      const width = node.width * Math.abs(node.scaleX || 1);
      const height = node.height * Math.abs(node.scaleY || 1);

      let fill = '#4B5563'; // fallback
      if (node.type === 'sticky') {
        fill = STICKY_THEME_COLORS[node.theme] || STICKY_THEME_COLORS.yellow;
      } else if (node.type === 'shape' || node.type === 'path') {
        const paint = node.appearance.fill?.[0];
        if (paint?.color && paint.color !== 'transparent') fill = paint.color;
      } else if (node.type === 'text') {
        fill = node.typography.color;
      }

      const { x, y } = this.worldToMini(node.x, node.y);
      const minW = Math.max(3, width * this.scale);
      const minH = Math.max(3, height * this.scale);

      this.ctx.fillStyle = fill;
      this.ctx.globalAlpha = 0.6;

      if (node.type === 'shape' && node.geometry.kind === 'ellipse') {
        this.ctx.beginPath();
        this.ctx.ellipse(x + minW / 2, y + minH / 2, minW / 2, minH / 2, 0, 0, Math.PI * 2);
        this.ctx.fill();
      } else {
        this.ctx.fillRect(x, y, minW, minH);
      }
    });

    this.ctx.globalAlpha = 1.0;

    // PASS 2: Draw Remote Users (Radar & Viewport)
    const activeUsers = presenceStore.getActiveUsers();
    const time = performance.now();
    
    activeUsers.forEach(u => {
      // Draw Viewport
      if (u.viewport) {
        const { x, y } = this.worldToMini(u.viewport.x, u.viewport.y);
        const vw = (u.viewport.width / u.viewport.zoom) * this.scale;
        const vh = (u.viewport.height / u.viewport.zoom) * this.scale;
        
        this.ctx.fillStyle = u.color;
        this.ctx.globalAlpha = 0.12;
        this.ctx.fillRect(x, y, Math.max(10, vw), Math.max(10, vh));
        
        this.ctx.strokeStyle = u.color;
        this.ctx.globalAlpha = 1.0;
        this.ctx.lineWidth = 1.5;
        this.ctx.strokeRect(x, y, Math.max(10, vw), Math.max(10, vh));
      }

      // Draw Cursor Radar
      if (u.cursor) {
        const { x, y } = this.worldToMini(u.cursor.currentX, u.cursor.currentY);
        
        // Base cursor dot
        this.ctx.beginPath();
        this.ctx.arc(x, y, 3, 0, Math.PI * 2);
        this.ctx.fillStyle = u.color;
        this.ctx.fill();

        // Activity Radar
        if (u.activity === 'typing' || u.activity === 'drawing' || u.activity === 'throwing') {
          // Pulsing circle
          const pulsePeriod = 1500;
          const phase = (time % pulsePeriod) / pulsePeriod; // 0 to 1
          const radius = 3 + phase * 15;
          const alpha = 1 - phase;
          
          this.ctx.beginPath();
          this.ctx.arc(x, y, radius, 0, Math.PI * 2);
          this.ctx.strokeStyle = u.color;
          this.ctx.globalAlpha = alpha;
          this.ctx.lineWidth = 1.5;
          this.ctx.stroke();
          this.ctx.globalAlpha = 1.0;
        }
      }

      // Draw Flight paths (throws)
      if (u.throws) {
        Object.values(u.throws).forEach(pos => {
          if (!pos) return;
          const { x, y } = this.worldToMini(pos.x, pos.y);
          this.ctx.beginPath();
          this.ctx.arc(x, y, 3, 0, Math.PI * 2);
          this.ctx.fillStyle = "#EF4444";
          this.ctx.fill();
        });
      }
    });

    // PASS 3: Local Viewport
    if (this.localViewport) {
      const { x, y } = this.worldToMini(this.localViewport.x, this.localViewport.y);
      const vw = (this.localViewport.width / this.localViewport.zoom) * this.scale;
      const vh = (this.localViewport.height / this.localViewport.zoom) * this.scale;
      
      this.ctx.strokeStyle = '#4F46E5'; // Indigo 600
      this.ctx.lineWidth = 2;
      this.ctx.strokeRect(x, y, Math.max(10, vw), Math.max(10, vh));
    }

    this.frameId = requestAnimationFrame(this.render);
  };

  public start() {
    if (!this.frameId) {
      this.frameId = requestAnimationFrame(this.render);
    }
  }

  public stop() {
    if (this.frameId) {
      cancelAnimationFrame(this.frameId);
      this.frameId = 0;
    }
  }

  public destroy() {
    this.stop();
    this.canvas.removeEventListener('mousedown', this.handleMouseDown);
  }
}
