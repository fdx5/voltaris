import stage01 from '../../data/stages/stage-01.json';
import stage02 from '../../data/stages/stage-02.json';
import stage03 from '../../data/stages/stage-03.json';
import stage04 from '../../data/stages/stage-04.json';
import stage05 from '../../data/stages/stage-05.json';

/** Stages in play order. A run advances through them carrying its loadout. */
export const STAGES = [stage01, stage02, stage03, stage04, stage05];
export type StageDef = (typeof STAGES)[number];
