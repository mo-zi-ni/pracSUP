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
 * 보스의 공격 모션. 세르카 1관문 대난투에서 나오는 다섯 가지다.
 *
 * 각각 예비동작의 결이 다르므로 이게 곧 타이밍 단서다. 순서는 매 판
 * 무작위로 섞이기 때문에, 외워야 하는 건 순서가 아니라 모션 자체다.
 */
export type GuardMotion =
  /** 빨간 낫을 머리 위로 들었다가 통로를 향해 던진다. 날아오는 시간이 따로 있다. */
  | 'scythe'
  /** 망치를 머리 위로 빙글 돌린 뒤 곧바로 찍는다. 돌리는 동작이 짧아 빠르다. */
  | 'hammer-spin'
  /** 망치를 천천히 들어올렸다가 느리게 찍는다. 제일 길고 읽기 쉽다. */
  | 'hammer-slow'
  /** 커다란 물레방아를 머리 위에서 돌리다가 내려찍는다. */
  | 'waterwheel'
  /** 빗자루를 천천히 들었다가 느리게 찍는다. */
  | 'broom';

/**
 * 저스트가드 — 위치가 아니라 타이밍으로 막는 공격. 대난투의 핵심.
 *
 * 장판과 근본적으로 다르다. 장판은 "어디에 서 있느냐"를 묻고,
 * 이건 "언제 막고 있느냐"를 묻는다.
 *
 * 판정은 공격이 닿는 순간(impact) 한 번만 일어난다. 그 순간 플레이어의
 * 가드 자세가 켜져 있으면 성공, 아니면 실패 — 그 둘뿐이다. 즉 판정 창은
 * 공격이 아니라 플레이어가 들고 있는 것이고, GUARD_STANCE(0.5초)가 그 창이다.
 */
export interface GuardCast {
  type: 'guard';
  /**
   * 보스가 반짝이는 시각(ms) — 공격이 온다는 신호.
   * 실제 모션은 여기서 FLASH_LEAD(1초) 뒤에 시작된다.
   */
  at: number;
  /**
   * 공격이 실제로 닿는 시각(ms). 이 한 순간에만 판정한다.
   * 모션 시작(at + FLASH_LEAD)부터 여기까지가 예비동작이고, 그 길이가 곧 난이도다.
   */
  impact: number;
  /** 어떤 모션으로 때리는가 — 보스 애니메이션과 예고 연출이 갈린다 */
  motion: GuardMotion;
  label?: string;
  /** 막지 못했을 때 깎이는 체력. 기본 1. */
  damage?: number;
}

export type TimelineEvent = FieldCast | GuardCast;

export function isGuard(event: TimelineEvent): event is GuardCast {
  return event.type === 'guard';
}

/**
 * 보스가 반짝인 뒤 실제 모션이 시작되기까지의 시간(ms).
 *
 * 실전에서 반짝임은 "온다"는 신호일 뿐이고, 그걸 보고 바로 누르면 한참
 * 이르다. 반짝임 → 1초 → 모션 → 임팩트의 리듬을 몸에 붙이는 게 대난투
 * 연습의 절반이라 이 간격을 명시적으로 둔다.
 */
export const FLASH_LEAD = 1000;

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
  /**
   * 이 패턴의 공격들.
   *
   * 함수를 주면 판이 시작될 때마다 새로 불린다 — 대난투처럼 모션 순서가
   * 매번 섞여야 하는 패턴이 이걸 쓴다. 배열이면 항상 같은 타임라인이다.
   */
  casts: TimelineEvent[] | (() => TimelineEvent[]);
  /** 명시하지 않으면 마지막 공격이 끝난 뒤 1.5초로 계산된다 */
  duration?: number;
}

/** 한 번의 시도 결과 */
export interface RunResult {
  cleared: boolean;
  hits: number;
  totalCasts: number;
  elapsed: number;
  /** 저스트가드 성공 횟수 / 전체 가드 공격 수. 성공 아니면 실패, 등급은 없다. */
  justGuards: number;
  guardTotal: number;
  /** 아무것도 안 오는데 자세를 세운 횟수 */
  whiffs: number;
  /**
   * 성공한 가드에서 "자세를 세운 뒤 몇 ms 만에 맞았는가"의 평균.
   * 0에 가까울수록 공격에 딱 맞춰 눌렀다는 뜻이고, 크면 미리 눌러두고
   * 기다린 것이다. 성공이 없으면 null.
   */
  avgLead: number | null;
}
