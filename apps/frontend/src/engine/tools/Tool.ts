import { EditorAPI } from '../api/EditorAPI';
import { CameraSystem } from '../CameraSystem';
import * as React from 'react';

export interface ToolContext {
  editor: EditorAPI;
  camera: CameraSystem;
  setOverlayState?: (state: any) => void;
}

export interface Tool {
  id: string;
  cursor: string; // CSS cursor
  
  onPointerDown(ctx: ToolContext, e: any): void;
  onPointerMove(ctx: ToolContext, e: any): void;
  onPointerUp(ctx: ToolContext, e: any): void;
  onKeyDown?(ctx: ToolContext, e: KeyboardEvent): void;
  onKeyUp?(ctx: ToolContext, e: KeyboardEvent): void;
  
  renderOverlay?(ctx: ToolContext, overlayState: any): React.ReactNode;
  
  onActivate?(ctx: ToolContext): void;
  onDeactivate?(ctx: ToolContext): void;
}
