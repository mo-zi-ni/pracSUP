import type { Cast, Pattern } from './types';

/**
 * 패턴 라이브러리.
 *
 * 여기 있는 건 전부 데이터다. 새 패턴을 만들려면 이 파일에 객체 하나를
 * 추가하기만 하면 되고, 다른 코드는 손대지 않는다.
 */

/** 시계 방향 위치를 각도로. 12시가 화면 위쪽(-Z). */
export function clock(hour: number): number {
  return -Math.PI / 2 + (hour / 12) * Math.PI * 2;
}

const deg = (d: number) => (d * Math.PI) / 180;

const BASICS: Pattern = {
  id: 'basics',
  name: '기본기 — 장판 읽기',
  description: '원형 · 부채꼴 · 직선 장판을 하나씩. 대시(Space)를 아껴 쓰지 말고 감을 잡으세요.',
  arenaRadius: 18,
  casts: [
    { at: 1200, windup: 1600, shape: { kind: 'circle', radius: 7 }, label: '보스 중심 원형 — 밖으로' },
    {
      at: 4000,
      windup: 1500,
      shape: { kind: 'fan', radius: 16, arc: deg(90) },
      label: '전방 부채꼴 — 옆으로',
    },
    {
      at: 6800,
      windup: 1400,
      shape: { kind: 'rect', width: 5, length: 20 },
      label: '직선 돌진 — 좌우로',
    },
    {
      at: 9400,
      windup: 1300,
      shape: { kind: 'circle', radius: 4.5 },
      anchor: { kind: 'player' },
      label: '내 발밑 장판 — 흘리기',
    },
    {
      at: 12000,
      windup: 1600,
      shape: { kind: 'donut', inner: 6, outer: 18 },
      label: '도넛 — 보스 안쪽으로',
    },
  ],
};

const SAFE_ZONE: Pattern = {
  id: 'safe-zone',
  name: '안전지대 판별',
  description: '초록 장판은 그 "안에" 있어야 삽니다. 빨강과 섞여 나오니 색을 먼저 보세요.',
  arenaRadius: 18,
  casts: [
    {
      at: 1000,
      windup: 2000,
      shape: { kind: 'fan', radius: 18, arc: deg(80) },
      facing: { kind: 'absolute', angle: clock(12) },
      rule: 'stand',
      label: '12시 안전지대 — 들어가기',
    },
    {
      at: 4200,
      windup: 1800,
      shape: { kind: 'donut', inner: 5, outer: 9 },
      rule: 'stand',
      label: '중거리 링 안으로',
    },
    // 안전지대 안에서 다시 피해야 하는 구간 — 두 규칙을 동시에 읽는 연습
    {
      at: 7000,
      windup: 2200,
      shape: { kind: 'fan', radius: 18, arc: deg(100) },
      facing: { kind: 'absolute', angle: clock(6) },
      rule: 'stand',
      label: '6시 안전지대',
    },
    {
      at: 8000,
      windup: 1200,
      shape: { kind: 'circle', radius: 5 },
      anchor: { kind: 'fixed', at: { x: 0, z: 9 } },
      label: '동시에 발밑 원형 회피',
    },
    {
      at: 11000,
      windup: 1500,
      shape: { kind: 'donut', inner: 11, outer: 18 },
      label: '외곽 도넛 — 안으로',
    },
  ],
};

const COMBO: Pattern = {
  id: 'combo',
  name: '연속 패턴 — 대시 관리',
  description: '장판이 겹쳐서 들어옵니다. 대시 쿨(1.6초)을 계산하며 움직여야 합니다.',
  arenaRadius: 18,
  casts: [
    { at: 800, windup: 1200, shape: { kind: 'fan', radius: 18, arc: deg(120) }, label: '광역 부채꼴' },
    {
      at: 2200,
      windup: 900,
      shape: { kind: 'rect', width: 6, length: 20 },
      label: '연계 직선',
    },
    { at: 3400, windup: 900, shape: { kind: 'circle', radius: 5 }, anchor: { kind: 'player' } },
    {
      at: 4400,
      windup: 800,
      shape: { kind: 'circle', radius: 5 },
      anchor: { kind: 'player' },
      label: '2연속 발밑 — 흘리며 이동',
    },
    { at: 6000, windup: 1400, shape: { kind: 'donut', inner: 7, outer: 18 }, label: '붙기' },
    {
      at: 7600,
      windup: 1100,
      shape: { kind: 'circle', radius: 8 },
      label: '즉시 다시 빠지기',
    },
    // 십자 직선 — 대각선 사분면이 안전
    ...crossBeams(9400, 1500),
    {
      at: 12000,
      windup: 1800,
      shape: { kind: 'fan', radius: 18, arc: deg(70) },
      facing: { kind: 'absolute', angle: clock(9) },
      rule: 'stand',
      label: '마무리 — 9시 안전지대',
      damage: 999,
    },
  ],
};

/** 십자 모양으로 뻗는 4개의 직선 장판 */
function crossBeams(at: number, windup: number): Cast[] {
  return [0, 3, 6, 9].map((hour, i) => ({
    at,
    windup,
    shape: { kind: 'rect' as const, width: 5, length: 20 },
    facing: { kind: 'absolute' as const, angle: clock(hour) },
    label: i === 0 ? '십자 — 대각선으로' : undefined,
  }));
}

export const PATTERNS: Pattern[] = [BASICS, SAFE_ZONE, COMBO];
