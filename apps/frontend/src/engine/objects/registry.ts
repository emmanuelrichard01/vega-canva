import React from 'react';
import type { AnyNode } from '../model/schema';

// The capabilities that an object can expose to the UI
export interface ObjectCapabilities {
  supportsFill?: boolean;
  supportsStroke?: boolean;
  supportsTypography?: boolean;
  supportsRadius?: boolean;
  supportsOpacity?: boolean;
  supportsShadow?: boolean;
  /**
   * Whether a shadow on this type can have spread.
   *
   * Separate from `supportsShadow` because it is drawn differently: the
   * silhouette is grown by stroking the same path, which works for a closed
   * primitive and not for a pen path (already stroked) or a freehand blob
   * (already an outline), where a second stroke would change the shape rather
   * than the shadow.
   */
  supportsShadowSpread?: boolean;
  supportsReactions?: boolean;
  supportsComments?: boolean;
}

export interface ObjectRendererProps<T extends AnyNode = AnyNode> {
  obj: T;
  isSelected: boolean;
  isEditing: boolean;
  stageScale: number;
  editText?: string;
  setEditText?: (t: string) => void;
  onEditComplete?: () => void;
}

export interface ObjectInspectorProps<T extends AnyNode = AnyNode> {
  obj: T;
  onChange: (updates: Partial<T>) => void;
}

export interface ObjectToolbarProps<T extends AnyNode = AnyNode> {
  obj: T;
  onChange: (updates: Partial<T>) => void;
}

// The contract for every object on the canvas
export interface CanvasObjectDef<T extends AnyNode = AnyNode> {
  type: string;
  capabilities: ObjectCapabilities;
  
  // Default data when created
  defaultProperties: () => Partial<T>;

  /**
   * Canvas renderer for this type.
   *
   * Optional because rendering currently still lives in the monolithic
   * ObjectRenderer switch; every definition used to satisfy this required
   * field with a literal `renderer: () => null`, which made the "renderer
   * registry decouples logic from draw calls" design read as implemented
   * when nothing was ever dispatched through it. An absent renderer is an
   * honest "not migrated yet"; a stub that renders nothing is not.
   */
  renderer?: React.ComponentType<ObjectRendererProps<T>>;

  // Render the property panel sections specific to this object
  inspector?: React.ComponentType<ObjectInspectorProps<T>>;
  
  // Render the floating toolbar items specific to this object
  toolbar?: React.ComponentType<ObjectToolbarProps<T>>;
  
  // Optional: Custom physics logic
  onTickPhysics?: (obj: T, dt: number) => void;
}

export class ObjectRegistry {
  private objects = new Map<string, CanvasObjectDef<any>>();

  register<T extends AnyNode>(def: CanvasObjectDef<T>) {
    this.objects.set(def.type, def);
  }

  get(type: string): CanvasObjectDef<any> | undefined {
    return this.objects.get(type);
  }

  getAll(): CanvasObjectDef<any>[] {
    return Array.from(this.objects.values());
  }
}

export const objectRegistry = new ObjectRegistry();
