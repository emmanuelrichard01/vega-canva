export interface ViewportState {
  x: number;
  y: number;
  zoom: number;
}

export interface CursorState {
  x: number;
  y: number;
}

export interface PresenceState {
  id: string;
  name: string;
  color: string;
  cursor: CursorState | null;
  viewport: ViewportState | null;
  selection: string[];
  tool: string;
  activity: string | null;
  status: 'online' | 'away';
}
