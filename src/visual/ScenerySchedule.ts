/** Authored encounters: large quiet intervals, no modulo/repeating scenery. */
export const SCENERY_MODELS = [
  'orbital-station',
  'hubble',
  'cassini',
  'juno',
  'curiosity',
  'insight',
  'europa-clipper',
  'osiris-rex',
  'voyager',
  'spitzer',
] as const;
export type SceneryModel = (typeof SCENERY_MODELS)[number];
export interface SceneryPass {
  model: SceneryModel;
  start: number;
  end: number;
  size: number;
  ground?: boolean;
}
export const SCENERY_SCHEDULE: readonly (readonly SceneryPass[])[] = [
  [
    { model: 'orbital-station', start: 0.04, end: 0.16, size: 6.8 },
    { model: 'hubble', start: 0.32, end: 0.46, size: 4.8 },
    { model: 'orbital-station', start: 0.62, end: 0.74, size: 6.8 },
  ],
  [
    { model: 'cassini', start: 0.12, end: 0.26, size: 4.2 },
    { model: 'juno', start: 0.6, end: 0.74, size: 5.8 },
  ],
  [
    { model: 'curiosity', start: 0.13, end: 0.27, size: 2.8, ground: true },
    { model: 'insight', start: 0.62, end: 0.76, size: 3.4, ground: true },
  ],
  [
    { model: 'europa-clipper', start: 0.14, end: 0.28, size: 6.2 },
    { model: 'osiris-rex', start: 0.61, end: 0.75, size: 4.2 },
  ],
  [
    { model: 'voyager', start: 0.1, end: 0.24, size: 5.5 },
    { model: 'spitzer', start: 0.61, end: 0.75, size: 4.2 },
  ],
];
export function sceneryPass(stage: number, progress: number) {
  return SCENERY_SCHEDULE[stage]?.find((pass) => progress >= pass.start && progress < pass.end);
}
