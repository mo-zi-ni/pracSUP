import {
  circleArena,
  corridorArena,
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
// 가드 공격은 시각 두 개와 모션 하나로 기술한다:
//   at     = 보스가 무기를 들고 예비동작에 들어가는 순간
//   impact = 공격이 실제로 닿는 순간 — 판정은 여기 한 번뿐이다
//   motion = 어떤 무기로 어떻게 때리는가
//
// 판정 창은 공격이 아니라 플레이어가 들고 있다. G를 누르면 0.5초짜리 방어
// 자세가 서고, impact 순간 그 자세가 살아 있으면 막힌다. 그래서 패턴을 짤 때
// 신경 쓸 것은 "예비동작 길이(impact - at)"와 "연타 간격"이다.
//
// 예비동작이 짧을수록 어렵고, 연타 간격이 0.5초보다 좁으면 한 번의 자세로
// 두 대를 막을 수 있다 — 이게 대난투 연타의 핵심 판단이다.
//
// sequence가 같은 공격들은 하나의 보스 패턴이다. 그 안에서 헛가드를 내면
// 남은 공격의 저스트가드가 전부 막힌다.
// ---------------------------------------------------------------------------

/** 모션별 기본 예비동작 길이(ms). 무기가 무거울수록 길다. */
const WINDUP: Record<GuardMotion, number> = {
  hammer: 1200, // 크게 치켜들었다 내려찍는다 — 제일 읽기 쉽다
  scythe: 1000, // 들었다 던지고, 날아오는 시간까지 있다
  sweep: 850,
  thrust: 620, // 짧게 당겼다 내지른다 — 제일 빠르다
};

/**
 * 닿는 시각 목록으로 가드 연타를 만든다.
 * windup을 주면 예비동작 길이를 덮어쓴다 — 같은 모션도 빠르게 낼 수 있다.
 */
function guards(
  impacts: number[],
  opts: { motion: GuardMotion; sequence: string; windup?: number; label?: string },
): GuardCast[] {
  const windup = opts.windup ?? WINDUP[opts.motion];
  return impacts.map((impact, i) => ({
    type: 'guard' as const,
    at: impact - windup,
    impact,
    motion: opts.motion,
    sequence: opts.sequence,
    label: i === 0 ? opts.label : undefined,
  }));
}

const GUARD_BASICS: Pattern = {
  id: 'guard-basics',
  name: '저스트가드 입문 — 모션 익히기',
  mode: 'guard',
  description:
    'G를 누르면 0.5초 동안 방어 자세가 섭니다. 그 사이에 공격이 닿으면 막힙니다. 무기마다 예비동작 길이가 다르니 모션을 보고 익히세요. 늦게 세운 가드일수록 높은 등급.',
  arena: corridorArena(7.5, -17, 15),
  casts: [
    ...guards([2600], { motion: 'hammer', sequence: 'a', label: '망치 내려찍기 — 가장 느림' }),
    ...guards([5600], { motion: 'scythe', sequence: 'b', label: '빨간 낫 던지기' }),
    ...guards([8400], { motion: 'sweep', sequence: 'c', label: '횡베기' }),
    ...guards([11000], { motion: 'thrust', sequence: 'd', label: '찌르기 — 가장 빠름' }),
  ],
};

const GUARD_RHYTHM: Pattern = {
  id: 'guard-rhythm',
  name: '저스트가드 — 연타 리듬',
  mode: 'guard',
  description:
    '연타 간격이 0.5초보다 좁으면 자세 한 번으로 두 대를 받아낼 수 있습니다. 넓으면 따로 눌러야 하고, 자세가 끝난 뒤 0.35초는 다시 못 누릅니다. 간격을 보고 판단하세요.',
  arena: corridorArena(7.5, -17, 15),
  casts: [
    // 0.35초 간격 — 한 번의 자세로 둘 다 막힌다
    ...guards([2600, 2950], { motion: 'thrust', sequence: 'r1', label: '빠른 2연타 — 한 번에' }),
    // 0.9초 간격 — 자세가 끊기므로 두 번 눌러야 한다
    ...guards([6000, 6900], { motion: 'hammer', sequence: 'r2', label: '느린 2연타 — 따로' }),
    // 섞어서 3연타 — 앞의 둘은 한 번에, 마지막은 따로
    ...guards([10000, 10350], { motion: 'sweep', sequence: 'r3', label: '변속 3연타' }),
    ...guards([11600], { motion: 'thrust', sequence: 'r3', windup: 700 }),
  ],
};

/**
 * 세르카 1관문 대난투.
 *
 * 좌우가 파란 빛으로 막힌 통로에서 1:1로 붙는 구간. 보스가 무기를 들면
 * 바닥에 예고 장판이 깔려 플레이어 쪽으로 밀려오고, 그것이 발밑에 닿는
 * 순간이 impact다.
 *
 * ⚠ 아래 시각은 영상에서 읽은 구조(연타 수, 모션 순서, 잠금 단위)를 따르되
 * 절대 시각은 근사치다. 프레임 단위로 맞추려면 ?t= 로 특정 시각을 정지시켜
 * 영상과 나란히 놓고 조정하면 된다.
 */
const SERKA_G1: Pattern = {
  id: 'serka-g1',
  name: '세르카 1관문 대난투',
  mode: 'guard',
  description:
    '망치 → 낫 → 횡베기 → 찌르기 순으로 몰아칩니다. 뒤로 갈수록 예비동작이 짧아지니 모션을 미리 외워두세요. 헛가드하면 그 패턴은 끝까지 막을 수 없습니다.',
  arena: corridorArena(7.5, -17, 15),
  casts: [
    // 1패턴 — 망치 2연타. 예비동작이 길어 첫 인사로 적당하다.
    ...guards([2800, 4000], { motion: 'hammer', sequence: 's1', label: '1패턴 — 망치 2연타' }),

    // 2패턴 — 낫을 연달아 던진다. 날아오는 시간이 있어 실제 간격보다 촘촘하게 느껴진다.
    ...guards([7600, 8700, 9800], { motion: 'scythe', sequence: 's2', label: '2패턴 — 낫 3연타' }),

    // 3패턴 — 횡베기로 훑고 곧바로 찌르기. 모션이 바뀌는 지점이 함정이다.
    // 간격 300ms — 자세 한 번(0.5초)으로 둘 다 받아낼 수 있다.
    ...guards([13200], { motion: 'sweep', sequence: 's3', label: '3패턴 — 횡베기 후 찌르기' }),
    ...guards([13500], { motion: 'thrust', sequence: 's3', windup: 600 }),

    // 4패턴 — 마무리. 간격 350ms로 조금 더 좁다.
    ...guards([17400, 17750], { motion: 'thrust', sequence: 's4', windup: 560, label: '4패턴 — 마무리 2연타' }),
  ],
};

export const PATTERNS: Pattern[] = [
  BASICS,
  SAFE_ZONE,
  COMBO,
  GUARD_BASICS,
  GUARD_RHYTHM,
  SERKA_G1,
];
