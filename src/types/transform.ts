export type Position = { x: number; y: number; z: number };
export type Rotation = { x: number; y: number; z: number };
export type Scale = { x: number; y: number; z: number };
export type Transform = { pos: Position; rot: Rotation; scale?: Scale };
