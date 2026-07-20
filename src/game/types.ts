/**
 * 패턴을 "데이터"로 기술하기 위한 타입들.
 *
 * 이 파일이 프로젝트의 중심이다. 새 레이드 패턴을 추가할 때 게임 코드는
 * 건드리지 않고 이 타입에 맞는 객체 하나만 작성하면 된다.
 *
 * 좌표계: XZ 평면 (Y는 높이). 보스는 원점.
 * 각도: (x, z) 평면에서 forward = (cos θ, sin θ). 라디안.
 */

export interface Vec2 {
  x: number;
  z: number;
}

/**
 * 전투 공간의 모양.
 *
 * 대난투는 원형 아레나가 아니라 좌우가 파란 빛으로 막힌 좁고 긴 통로다.
 * 보스는 통로 안쪽 끝(-Z)에, 플레이어는 바깥쪽(+Z)에 선다.
 */
export type Arena =
  | { kind: 'circle'; radius: number }
  /** x는 ±halfWidth, z는 far(보스쪽, 음수) ~ near(플레이어쪽, 양수) */
  | { kind: 'corridor'; halfWidth: number; far: number; near: number };

export function circleArena(radius: number): Arena {
  return { kind: 'circle', radius };
}

export function corridorArena(halfWidth: number, far: number, near: number): Arena {
  return { kind: 'corridor', halfWidth, far, near };
}

/** 장판 모양. 실제 로아 장판의 대부분이 이 4개로 표현된다. */
export type Shape =
  /** 원형 장판 */
  | { kind: 'circle'; radius: number }
  /** 도넛 장판 — 안쪽이 안전지대 */
  | { kind: 'donut'; inner: number; outer: number }
  /** 부채꼴 장판. arc는 전체 각도(라디안), facing을 중심으로 좌우 대칭 */
  | { kind: 'fan'; radius: number; arc: number }
  /** 직선 장판. origin에서 facing 방향으로 length만큼 뻗어나감 */
  | { kind: 'rect'; width: number; length: number };

/** 장판이 어디서 생기는가 */
export type Anchor =
  /** 보스 위치 (원점) */
  | { kind: 'boss' }
  /** 시전 시점의 플레이어 위치를 스냅샷 — 로아의 "내 발밑 장판" */
  | { kind: 'player' }
  /** 고정 좌표 */
  | { kind: 'fixed'; at: Vec2 };

/** 장판이 어디를 보는가 */
export type Facing =
  /** 시전 시점의 플레이어 방향을 스냅샷 */
  | { kind: 'toward-player' }
  /** 고정 각도 */
  | { kind: 'absolute'; angle: number };

/**
 * 판정 규칙.
 * - dodge: 장판 안에 있으면 피격 (대부분의 패턴)
 * - stand: 장판 안에 있어야 생존 — 안전지대, 쫄 처리 구역 등
 */
export type Rule = 'dodge' | 'stand';

/** 장판 — 위치로 피하는 공격 */
export interface FieldCast {
  type?: 'field';
  /** 패턴 시작 후 이 시각(ms)에 장판이 나타난다 */
  at: number;
  /** 장판이 보인 뒤 터지기까지의 시간(ms). 곧 회피 가능 시간. */
  windup: number;
  shape: Shape;
  /** 기본값: 보스 */
  anchor?: Anchor;
  /** 기본값: 플레이어 방향 */
  facing?: Facing;
  /** 기본값: dodge */
  rule?: Rule;
  /** HUD에 표시될 이름 — "쫄작 후 카운터", "12시 안전" 등 */
  label?: string;
  /** 맞았을 때 깎이는 체력. 기본 1. 즉사 패턴은 999. */
  damage?: number;
}

/**
 * 보스의 공격 모션. 각각 예비동작의 결이 다르므로 이게 곧 타이밍 단서다.
 * 무기가 뜨는 순간부터 닿기까지의 흐름을 보고 가드를 넣어야 한다.
 */
export type GuardMotion =
  /** 빨간 낫을 머리 위로 들었다가 통로를 향해 던진다. 날아오는 시간이 있어 가장 읽기 쉽다. */
  | 'scythe'
  /** 망치를 크게 치켜들었다가 내려찍는다. 예비동작이 길고 임팩트가 갑작스럽다. */
  | 'hammer'
  /** 창을 뒤로 당겼다가 앞으로 내지른다. 예비동작이 짧아 제일 빠르다. */
  | 'thrust'
  /** 몸을 비틀었다가 통로 전체를 옆으로 훑는다. */
  | 'sweep';

/**
 * 저스트가드 — 위치가 아니라 타이밍으로 막는 공격. 대난투의 핵심.
 *
 * 장판과 근본적으로 다르다. 장판은 "어디에 서 있느냐"를 묻고,
 * 이건 "언제 막고 있느냐"를 묻는다.
 *
 * 판정은 공격이 닿는 순간(impact) 한 번만 일어난다. 그 순간 플레이어의
 * 가드 자세가 켜져 있으면 막힌 것이고, 아니면 맞는다. 즉 판정 창은 공격이
 * 아니라 플레이어가 들고 있는 것이다 — GUARD_STANCE(0.5초)가 그 창이다.
 */
export interface GuardCast {
  type: 'guard';
  /** 보스가 예비동작에 들어가는 시각(ms). 이때부터 무기가 보인다. */
  at: number;
  /**
   * 공격이 실제로 닿는 시각(ms). 이 한 순간에만 판정한다.
   * at → impact 사이가 예비동작이고, 그 길이가 곧 난이도다.
   */
  impact: number;
  /** 어떤 모션으로 때리는가 — 보스 애니메이션과 예고 연출이 갈린다 */
  motion: GuardMotion;
  /**
   * 이 공격이 속한 보스 패턴. 헛가드하면 같은 sequence의 남은 공격은
   * 전부 저스트가드가 막힌다 — 실제 대난투 규칙.
   * 생략하면 공격 하나가 곧 하나의 패턴이다.
   */
  sequence?: string;
  label?: string;
  /** 막지 못했을 때 깎이는 체력. 기본 1. */
  damage?: number;
}

export type TimelineEvent = FieldCast | GuardCast;

export function isGuard(event: TimelineEvent): event is GuardCast {
  return event.type === 'guard';
}

/**
 * 이 패턴이 무엇을 묻는 연습인가.
 *
 * 'field'는 "어디에 서 있느냐", 'guard'는 "언제 막고 있느냐"를 묻는다.
 * 조작도 판정도 완전히 다르므로 일시정지 화면에서 모드별로 나눠 보여준다.
 */
export type PatternMode = 'field' | 'guard';

export interface Pattern {
  id: string;
  name: string;
  mode: PatternMode;
  /** 이 패턴에서 무엇을 연습하는지 — HUD에 표시된다 */
  description?: string;
  /** 전투 공간의 모양 */
  arena: Arena;
  casts: TimelineEvent[];
  /** 명시하지 않으면 마지막 공격이 끝난 뒤 1.5초로 계산된다 */
  duration?: number;
}

/** 한 번의 시도 결과 */
export interface RunResult {
  cleared: boolean;
  hits: number;
  totalCasts: number;
  elapsed: number;
  /** 저스트가드 성공 횟수 / 전체 가드 공격 수 */
  justGuards: number;
  guardTotal: number;
  /** 성공 중에서도 자세를 늦게 세워 정확히 받아친 것 — 최고 등급 */
  excellents: number;
  /** 성공했지만 자세를 일찍 세워둔 것 */
  greats: number;
  /** 헛가드로 패턴이 잠긴 횟수 */
  whiffs: number;
  /**
   * 성공한 가드에서 "자세를 세운 뒤 몇 ms 만에 맞았는가"의 평균.
   * 0에 가까울수록 공격에 딱 맞춰 눌렀다는 뜻이고, 크면 미리 눌러두고
   * 기다린 것이다. 성공이 없으면 null.
   */
  avgLead: number | null;
}
