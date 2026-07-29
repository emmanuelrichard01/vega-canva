export type CursorStateId = 
  | 'idle' 
  | 'hover' 
  | 'select' 
  | 'move' 
  | 'drag' 
  | 'resize-nwse' 
  | 'resize-nesw'
  | 'resize-ew'
  | 'resize-ns'
  | 'rotate' 
  | 'draw' 
  | 'typing' 
  | 'comment' 
  | 'recording' 
  | 'loading' 
  | 'disabled' 
  | 'presentation' 
  | 'laser'
  | 'audio';

export interface CursorConfig {
  x: number;
  y: number;
  state: CursorStateId;
  label?: string; // E.g., user name for remote cursor
  activity?: string; // E.g., "Editing", "Recording"
  color?: string; // Overrides theme color (used for remote users)
}
