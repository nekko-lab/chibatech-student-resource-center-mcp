import type { TextItem } from "./types.ts";
export interface Box { str: string; x0: number; x1: number; cx: number; y: number; h: number }
export interface Line { y: number; h: number; boxes: Box[] }
export interface Span { x0: number; x1: number }
const todo = (): never => { throw new Error("not implemented"); };
export function toBoxes(_items: TextItem[]): Box[] { return todo(); }
export function groupLines(_boxes: Box[], _tolerance = 0.35): Line[] { return todo(); }
export function groupWords(_line: Line, _gapRatio: number): Box[] { return todo(); }
export function columnBoundaries(_headers: Span[], _content: Span[]): number[] { return todo(); }
export function columnOf(_boundaries: number[], _x: number): number { return todo(); }
export function normalize(_s: string): string { return todo(); }
