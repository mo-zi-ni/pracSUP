import {
  circleArena,
  corridorArena,
  FLASH_LEAD,
  type FieldCast,
  type GuardCast,
  type GuardMotion,
  type Pattern,
} from './types';

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
  mode: 'field',
  description: '원형 · 부채꼴 · 직선 장판을 하나씩. 대시(Space)를 아껴 쓰지 말고 감을 잡으세요.',
  arena: circleArena(18),
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
  mode: 'field',
  description: '초록 장판은 그 "안에" 있어야 삽니다. 빨강과 섞여 나오니 색을 먼저 보세요.',
  arena: circleArena(18),
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
  mode: 'field',
  description: '장판이 겹쳐서 들어옵니다. 대시 쿨(1.6초)을 계산하며 움직여야 합니다.',
  arena: circleArena(18),
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
function crossBeams(at: number, windup: number): FieldCast[] {
  return [0, 3, 6, 9].map((hour, i) => ({
    at,
    windup,
    shape: { kind: 'rect' as const, width: 5, length: 20 },
    facing: { kind: 'absolute' as const, angle: clock(hour) },
    label: i === 0 ? '십자 — 대각선으로' : undefined,
  }));
}
// ---------------------------------------------------------------------------
// 대난투 — 저스트가드
//
// 가드 공격 하나는 시각 두 개와 모션 하나로 기술한다:
//   at     = 보스가 반짝이는 순간 (온다는 신호)
//   impact = 공격이 닿는 순간 — 판정은 여기 한 번뿐이다
//   motion = 어떤 무기로 어떻게 때리는가
//
// 실제 모션은 반짝임에서 FLASH_LEAD(1초) 뒤에 시작된다. 즉 리듬은
//   반짝 → 1초 → 모션 시작 → windup → 임팩트
// 이고, 반짝임만 보고 누르면 한참 이르다.
//
// 판정 창은 공격이 아니라 플레이어가 들고 있다. G를 누르면 0.5초짜리 방어
// 자세가 서고, impact 순간 그 자세가 살아 있으면 성공, 아니면 실패다.
// 등급은 없다 — 막았거나 못 막았거나 둘 중 하나다.
//
// 대난투에는 연타가 없다. 공격은 하나씩 따로 들어온다.
// ---------------------------------------------------------------------------

/**
 * 모션별 예비동작 길이(ms) — 모션 시작부터 임팩트까지.
 *
 * 영상에서 "가드!" 알림이 뜨는 순간을 임팩트로 잡고, 보스가 무기를 들기
 * 시작하는 지점부터 역산한 값이다. 다섯 모션 모두 1.0~1.4초 사이라
 * 무기를 보고 반응할 시간은 비슷하고, 차이는 동작의 결에서 온다.
 */
const WINDUP: Record<GuardMotion, number> = {
  'hammer-spin': 1000, // 머리 위로 빙글 돌린 뒤 곧바로 — 다섯 중 제일 급하다
  scythe: 1150, // 던지고 날아오는 시간까지 포함
  waterwheel: 1250, // 크게 들어올렸다가 내려찍는다
  'hammer-slow': 1400, // 천천히 들었다 느리게
  broom: 1400, // 천천히 들었다 느리게
};

/** 다섯 모션 전부. 순서는 판마다 섞인다. */
const MOTIONS: GuardMotion[] = [
  'scythe',
  'hammer-spin',
  'hammer-slow',
  'waterwheel',
  'broom',
];

/** 모션 이름 — 라벨에 띄워 무엇을 맞았는지 알게 한다 */
const MOTION_NAME: Record<GuardMotion, string> = {
  scythe: '빨간 낫 던지기',
  'hammer-spin': '망치 돌리고 찍기',
  'hammer-slow': '망치 들다가 느리게 찍기',
  waterwheel: '물레방아 돌리다가 내려찍기',
  broom: '빗자루 들다가 느리게 찍기',
};

/** 제자리 섞기 (Fisher-Yates) */
function shuffled<T>(items: T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * 공격 하나. impact를 기준으로 모션 시작과 반짝임 시각을 역산한다.
 * 라벨에 모션 이름을 넣어 맞고 나서 무엇이었는지 확인할 수 있게 한다.
 */
function guard(impact: number, motion: GuardMotion): GuardCast {
  return {
    type: 'guard',
    at: impact - WINDUP[motion] - FLASH_LEAD,
    impact,
    motion,
    label: MOTION_NAME[motion],
  };
}

/**
 * 다섯 모션을 무작위 순서로 배치한다.
 *
 * 임팩트 시각은 고정이고 어떤 모션이 오는지만 바뀐다. 그래야 판 길이가
 * 일정하면서도 "순서를 외우는" 편법이 통하지 않는다.
 */
function randomBout(impacts: number[]): GuardCast[] {
  const order = shuffled(MOTIONS);
  return impacts.map((impact, i) => guard(impact, order[i % order.length]));
}

const GUARD_BASICS: Pattern = {
  id: 'guard-basics',
  name: '저스트가드 입문 — 모션 익히기',
  mode: 'guard',
  description:
    '보스가 반짝이고 1초 뒤에 공격 모션이 시작됩니다. G를 누르면 0.5초 동안 방어 자세가 서고, 그 사이에 공격이 닿으면 성공입니다. 다섯 모션이 넉넉한 간격으로 하나씩 나옵니다.',
  arena: corridorArena(7.5, -17, 15),
  // 간격 4초 — 한 모션을 충분히 곱씹고 다음으로 넘어간다
  casts: () => randomBout([3200, 7200, 11200, 15200, 19200]),
};

/**
 * 세르카 1관문 대난투.
 *
 * 좌우가 파란 빛으로 막힌 통로에서 1:1로 붙는 구간. 다섯 모션이 무작위
 * 순서로 들어오고, 간격도 입문보다 좁다.
 *
 * 모션별 예비동작 길이는 영상에서 "가드!" 알림이 뜨는 순간을 임팩트로 잡아
 * 역산했다. 절대 시각(몇 초에 오는가)은 연습용으로 정한 값이다.
 */
const SERKA_G1: Pattern = {
  id: 'serka-g1',
  name: '세르카 1관문 대난투',
  mode: 'guard',
  description:
    '다섯 모션이 매번 다른 순서로 들어옵니다. 순서를 외울 수 없으니 반짝임을 보고 준비했다가 무기를 보고 눌러야 합니다. 성공 아니면 실패, 그 둘뿐입니다.',
  arena: corridorArena(7.5, -17, 15),
  casts: () => randomBout([3000, 6200, 9400, 12600, 15800]),
};

export const PATTERNS: Pattern[] = [BASICS, SAFE_ZONE, COMBO, GUARD_BASICS, SERKA_G1];
