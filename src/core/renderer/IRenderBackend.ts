import type { GameState } from '../../game/GameState';
export type Quality = 'HIGH' | 'MEDIUM' | 'LOW';
export interface IRenderBackend {
  readonly canvas: HTMLCanvasElement;
  readonly backendName: string;
  init(): Promise<void>;
  resize(): void;
  sync(state: Readonly<GameState>, alpha: number, dt: number): void;
  render(): void;
  setQuality(quality: Quality): void;
  dispose(): void;
}
