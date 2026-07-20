import { circleArena, corridorArena, type FieldCast, type GuardCast, type Pattern } from './types';

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
// 가드 공격은 시각 두 개로 기술한다:
//   at  = 보스가 노랗게 반짝이는 순간 (이때부터 가드 입력이 유효)
//   cue = 느낌표가 뜨는 순간 (실제로 눌러야 하는 타이밍)
// 둘 다 패턴 시작 기준 절대 시각(ms)이라 영상에서 읽은 값을 그대로 넣으면 된다.
//
// sequence가 같은 공격들은 하나의 보스 패턴이다. 그 안에서 헛가드를 내면
// 남은 공격의 저스트가드가 전부 막힌다.
// ---------------------------------------------------------------------------

/** 반짝임 → 느낌표 간격의 기본값. 실제 데이터가 오면 개별 지정한다. */
const DEFAULT_TELL = 900;

/**
 * 느낌표 시각 목록으로 가드 연타를 만든다.
 * tell을 주면 반짝임이 그만큼 앞서고, 안 주면 기본값을 쓴다.
 */
function guards(
  cues: number[],
  opts: { window: number; sequence: string; tell?: number; label?: string },
): GuardCast[] {
  const tell = opts.tell ?? DEFAULT_TELL;
  return cues.map((cue, i) => ({
    type: 'guard' as const,
    at: cue - tell,
    cue,
    window: opts.window,
    sequence: opts.sequence,
    label: i === 0 ? opts.label : undefined,
  }));
}

const GUARD_BASICS: Pattern = {
  id: 'guard-basics',
  name: '저스트가드 입문',
  description:
    '보스가 노랗게 반짝이면 준비, 느낌표가 뜨면 G. 판정 창 ±200ms — 넉넉합니다. 헛가드하면 그 패턴은 끝까지 막을 수 없습니다.',
  arena: circleArena(12),
  casts: [
    ...guards([2000], { window: 200, sequence: 'a', label: '단타 — 느낌표에 G' }),
    ...guards([4800], { window: 200, sequence: 'b' }),
    ...guards([7600], { window: 200, sequence: 'c' }),
    ...guards([10400], { window: 200, sequence: 'd' }),
  ],
};

const GUARD_RHYTHM: Pattern = {
  id: 'guard-rhythm',
  name: '저스트가드 — 연타 리듬',
  description:
    '한 패턴에 여러 대가 들어옵니다. 첫 타에서 헛가드하면 나머지도 전부 못 막으니, 애매하면 차라리 안 누르는 게 낫습니다. 판정 창 ±130ms.',
  arena: circleArena(12),
  casts: [
    ...guards([2200, 3100, 4000], {
      window: 130,
      sequence: 'r1',
      label: '3연타 — 등간격',
    }),
    ...guards([6800, 8400, 9100, 10400], {
      window: 130,
      sequence: 'r2',
      tell: 700,
      label: '변속 4연타 — 간격을 보고',
    }),
  ],
};

/**
 * 세르카 1관문 대난투.
 *
 * 좌우가 파란 빛으로 막힌 통로에서 1:1로 붙는 구간. 보스가 금색 파동을
 * 터뜨리면 바닥 장판이 차오르기 시작하고, 가득 차는 순간이 저스트가드 타이밍이다.
 *
 * ⚠ 아래 at/cue 값은 전부 임시다. 실제 영상에서 읽은
 * "파동 시각 → 장판이 가득 차는 시각"으로 교체해야 한다.
 * 구조(통로, 연타 수, 잠금 단위)만 실제와 맞춰둔 상태다.
 */
const SERKA_G1: Pattern = {
  id: 'serka-g1',
  name: '세르카 1관문 대난투 (타이밍 미확정)',
  description:
    '⚠ 타이밍은 임시값입니다. 금색 파동 → 장판 차오름 → 가득 차는 순간 G. 헛가드하면 그 패턴은 끝까지 막을 수 없습니다.',
  arena: corridorArena(7.5, -17, 15),
  casts: [
    ...guards([2400, 3600], { window: 150, sequence: 's1', label: '1패턴 — 2연타' }),
    ...guards([7000, 8100, 9200], { window: 150, sequence: 's2', label: '2패턴 — 3연타' }),
    ...guards([13000], { window: 150, sequence: 's3', tell: 1100, label: '3패턴 — 단타' }),
    ...guards([17000, 17900], { window: 150, sequence: 's4', tell: 800, label: '4패턴 — 빠른 2연타' }),
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
