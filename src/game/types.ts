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
 * 저스트가드 — 위치가 아니라 타이밍으로 막는 공격. 대난투의 핵심.
 *
 * 장판과 근본적으로 다르다. 장판은 "어디에 서 있느냐"를 묻고,
 * 이건 "언제 누르느냐"를 묻는다. 그래서 판정도 시간축에서 이뤄진다.
 */
export interface GuardCast {
  type: 'guard';
  /**
   * 보스가 노랗게 반짝이는 시각(ms). 이때부터 가드 입력이 유효하다.
   * 이보다 먼저 누르면 헛가드다.
   */
  at: number;
  /**
   * 느낌표가 뜨는 시각(ms) — 실제로 눌러야 하는 타이밍.
   * 패턴 시작 기준 절대 시각이라 영상에서 읽은 값을 그대로 넣으면 된다.
   */
  cue: number;
  /**
   * cue 기준 허용 오차(ms). |누른시각 - cue| 가 이 안이면 저스트가드.
   * 좁을수록 어렵다. 모르면 150에서 시작해 체감으로 조절한다.
   */
  window: number;
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

export interface Pattern {
  id: string;
  name: string;
  /** 이 패턴에서 무엇을 연습하는지 — HUD에 표시된다 */
  description?: string;
  /** 원형 아레나 반지름 */
  arenaRadius: number;
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
  /** 헛가드로 패턴이 잠긴 횟수 */
  whiffs: number;
  /**
   * 저스트가드 성공 시 평균 입력 오차(ms). 음수는 이르다는 뜻.
   * 성공이 없으면 null. 이 값이 0에 가까울수록 타이밍이 정확하다.
   */
  avgOffset: number | null;
}
