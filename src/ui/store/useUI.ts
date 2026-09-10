import { create } from 'zustand';
import type { Status, Weapon } from '../../game/GameState';
import type { Quality } from '../../core/renderer/IRenderBackend';
export interface RecordEntry {
  score: number;
  weapon: Weapon;
  level: number;
  credits: number;
  cleared: boolean;
  kills: number;
  seconds: number;
  practice: boolean;
}
export interface UIState {
  ready: boolean;
  error: string;
  backend: string;
  status: Status;
  stageIndex: number;
  stageName: string;
  bossName: string;
  score: number;
  level: number;
  lives: number;
  credits: number;
  creditsUsed: number;
  mode: number;
  optionCount: number;
  shield: number;
  graze: number;
  time: number;
  kills: number;
  boss: boolean;
  bossHp: number;
  bossPhase: number;
  bossTime: number;
  notice: string;
  noticeTime: number;
  charge: number[];
  skills: number[];
  effects: number[];
  skillUnlocked: boolean;
  continueTime: number;
  fps: number;
  frameMs: number;
  drawCalls: number;
  triangles: number;
  geometries: number;
  bullets: number;
  memory: number | null;
  quality: Quality;
  autoQuality: boolean;
  gamepad: boolean;
  bonus: number;
  maxGraze: number;
  deaths: number;
  records: RecordEntry[];
}
export const useUI = create<UIState>(() => ({
  ready: false,
  error: '',
  backend: 'INITIALIZING',
  status: 'menu',
  stageIndex: 0,
  stageName: 'ORBITAL GATE',
  bossName: 'GATEKEEPER',
  score: 0,
  level: 1,
  lives: 3,
  credits: 3,
  creditsUsed: 1,
  mode: 0,
  optionCount: 0,
  shield: 0,
  graze: 1,
  time: 0,
  kills: 0,
  boss: false,
  bossHp: 0,
  bossPhase: 1,
  bossTime: 0,
  notice: '',
  noticeTime: 0,
  charge: [0, 0, 0],
  skills: [0, -1, -1],
  effects: [0, 0, 0, 0, 0, 0],
  skillUnlocked: false,
  continueTime: 10,
  fps: 0,
  frameMs: 0,
  drawCalls: 0,
  triangles: 0,
  geometries: 0,
  bullets: 0,
  memory: null,
  quality: 'HIGH',
  autoQuality: true,
  gamepad: false,
  bonus: 0,
  maxGraze: 1,
  deaths: 0,
  records: [],
}));
