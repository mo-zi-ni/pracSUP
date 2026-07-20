import * as THREE from 'three';
import type { Input } from '../core/input';
import { applyFacing, createTelegraphMesh, isInside } from './shapes';
import { GUARD_WHIFF_LOCKOUT, type Player } from './player';
import {
  isGuard,
  type FieldCast,
  type GuardCast,
  type Pattern,
  type Rule,
  type RunResult,
  type Vec2,
} from './types';

/**
 * 패턴 타임라인 실행기.
 *
 * 두 종류의 공격을 다룬다:
 *  - 장판(FieldCast): 위치로 판정. windup이 끝나는 순간 플레이어 좌표를 본다.
 *  - 가드(GuardCast): 시간으로 판정. 타격 시점 기준 입력 시각의 오차를 본다.
 *
 * 시간은 바깥에서 주입받는다 — 슬로우모션이 dt 스케일만으로 해결되게 하려는 것.
 */

type FieldState = 'telegraphing' | 'resolved';

interface LiveField {
  cast: FieldCast;
  state: FieldState;
  /** 시전 시점에 확정된 위치·각도 */
  origin: Vec2;
  angle: number;
  group: THREE.Group;
  fill: THREE.MeshBasicMaterial;
  /** 터진 뒤 잔상이 사라지기까지 남은 시간(ms) */
  fadeLeft: number;
}

/**
 * telegraphing: 예고 중, 아직 타격 전
 * grace:       타격은 지났지만 "늦게 눌렀다"를 감지하기 위해 잠깐 살려둔다
 * done:        판정 끝
 */
type GuardState = 'telegraphing' | 'grace' | 'done';

interface LiveGuard {
  cast: GuardCast;
  state: GuardState;
  group: THREE.Group;
  incoming: THREE.Mesh;
  incomingMat: THREE.MeshBasicMaterial;
  windowMat: THREE.MeshBasicMaterial;
  /** 판정이 끝난 뒤 링이 사라지기까지 남은 시간(ms) */
  graceLeft: number;
  /** graceLeft의 초기값 — 페이드 비율 계산용 */
  fadeTotal: number;
}

/** 저스트가드 성공 시 링이 사라지는 시간(ms) */
const GUARD_SUCCESS_FADE = 180;

const BURST_FADE = 260;
const COLOR_DODGE = 0xff4d5e;
const COLOR_STAND = 0x49e08a;

/** 가드 예고 링이 줄어드는 구간. 바깥에서 시작해 안쪽 고정 링에 닿는 순간이 타격이다. */
const GUARD_RING_START = 4.6;
const GUARD_RING_TARGET = 1.15;

export type Feedback = {
  text: string;
  tone: 'just' | 'good' | 'bad';
};

export interface Encounter {
  readonly time: number;
  readonly duration: number;
  readonly finished: boolean;
  /** 지금 화면에 떠 있는 공격들의 라벨 */
  activeLabels(): { text: string; rule: Rule | 'guard' }[];
  update(dt: number, input: Input): void;
  restart(): void;
  result(): RunResult;
  dispose(): void;
}

export function createEncounter(
  pattern: Pattern,
  scene: THREE.Scene,
  player: Player,
  onHit: () => void,
  onFeedback: (feedback: Feedback) => void,
): Encounter {
  const boss = createBoss();
  scene.add(boss);

  const duration =
    pattern.duration ?? Math.max(...pattern.casts.map((c) => c.at + c.windup)) + 1500;

  const guardTotal = pattern.casts.filter(isGuard).length;

  let fields: LiveField[] = [];
  let guards: LiveGuard[] = [];
  let time = 0;
  let hits = 0;
  let justGuards = 0;
  let offsets: number[] = [];

  // ---------- 장판 ----------

  function spawnField(cast: FieldCast): LiveField {
    const anchor = cast.anchor ?? { kind: 'boss' };
    const origin: Vec2 =
      anchor.kind === 'boss'
        ? { x: 0, z: 0 }
        : anchor.kind === 'player'
          ? { ...player.pos }
          : { ...anchor.at };

    const facing = cast.facing ?? { kind: 'toward-player' };
    const angle =
      facing.kind === 'absolute'
        ? facing.angle
        : Math.atan2(player.pos.z - origin.z, player.pos.x - origin.x);

    const rule = cast.rule ?? 'dodge';
    const fill = new THREE.MeshBasicMaterial({
      color: rule === 'stand' ? COLOR_STAND : COLOR_DODGE,
      transparent: true,
      opacity: 0.18,
      side: THREE.DoubleSide,
      depthWrite: false,
    });

    const group = createTelegraphMesh(cast.shape, fill);
    applyFacing(group, angle);
    group.position.set(origin.x, 0.06, origin.z);
    scene.add(group);

    return { cast, state: 'telegraphing', origin, angle, group, fill, fadeLeft: 0 };
  }

  function resolveField(entry: LiveField) {
    const rule = entry.cast.rule ?? 'dodge';
    const inside = isInside(entry.cast.shape, entry.origin, entry.angle, player.pos);
    // stand 규칙은 "안에 없으면" 피격. dodge는 "안에 있으면" 피격.
    const wouldHit = rule === 'stand' ? !inside : inside;

    entry.state = 'resolved';
    entry.fadeLeft = BURST_FADE;
    entry.fill.opacity = 0.55;

    if (wouldHit && !player.invulnerable) {
      hits++;
      player.hp -= entry.cast.damage ?? 1;
      onHit();
    } else {
      // 회피 성공은 초록으로 — 대시 타이밍이 맞았는지 즉시 보이게 한다
      entry.fill.color.set(COLOR_STAND);
    }
  }

  // ---------- 저스트가드 ----------

  function spawnGuard(cast: GuardCast): LiveGuard {
    const group = new THREE.Group();

    // 눌러야 하는 순간을 나타내는 고정 링
    const target = new THREE.Mesh(
      new THREE.RingGeometry(GUARD_RING_TARGET - 0.06, GUARD_RING_TARGET + 0.06, 48),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, side: THREE.DoubleSide }),
    );
    target.rotation.x = -Math.PI / 2;
    group.add(target);

    // 판정 창의 바깥 경계 — 이 링 안쪽으로 들어오면 눌러도 성공한다
    const windowRadius =
      GUARD_RING_TARGET + (cast.window / cast.windup) * (GUARD_RING_START - GUARD_RING_TARGET);
    const windowMat = new THREE.MeshBasicMaterial({
      color: 0x49e08a,
      transparent: true,
      opacity: 0.35,
      side: THREE.DoubleSide,
    });
    const windowRing = new THREE.Mesh(
      new THREE.RingGeometry(GUARD_RING_TARGET, windowRadius, 48),
      windowMat,
    );
    windowRing.rotation.x = -Math.PI / 2;
    group.add(windowRing);

    // 줄어드는 링. 스케일로 반지름을 바꾼다.
    const incomingMat = new THREE.MeshBasicMaterial({
      color: 0xffe066,
      transparent: true,
      opacity: 0.95,
      side: THREE.DoubleSide,
    });
    const incoming = new THREE.Mesh(new THREE.RingGeometry(0.94, 1, 48), incomingMat);
    incoming.rotation.x = -Math.PI / 2;
    group.add(incoming);

    group.position.set(player.pos.x, 0.09, player.pos.z);
    scene.add(group);

    return {
      cast,
      state: 'telegraphing',
      group,
      incoming,
      incomingMat,
      windowMat,
      graceLeft: 0,
      fadeTotal: 1,
    };
  }

  /** 타격까지 남은 시간(ms) */
  function timeToImpact(entry: LiveGuard): number {
    return entry.cast.at + entry.cast.windup - time;
  }

  function onGuardPress() {
    if (player.guardLockout > 0) return;

    // 1) 판정 창 안에 들어온 공격이 있으면 저스트가드
    const hittable = guards
      .filter((g) => g.state === 'telegraphing' && timeToImpact(g) <= g.cast.window)
      .sort((a, b) => timeToImpact(a) - timeToImpact(b))[0];

    if (hittable) {
      // 이르게 누를수록 음수. 정확히 맞추면 0.
      const offset = Math.round(-timeToImpact(hittable));
      justGuards++;
      offsets.push(offset);
      hittable.state = 'done';
      hittable.graceLeft = GUARD_SUCCESS_FADE;
      hittable.fadeTotal = GUARD_SUCCESS_FADE;
      hittable.incomingMat.color.set(COLOR_STAND);
      player.guardFlash = 220;
      onFeedback({
        text: offset === 0 ? '저스트가드 PERFECT' : `저스트가드 ${offset}ms`,
        tone: 'just',
      });
      return;
    }

    // 2) 이미 맞은 직후라면 "늦었다"고 알려준다. 이건 진짜 시도였으니 경직은 없다.
    const late = guards.find((g) => g.state === 'grace');
    if (late) {
      const offset = Math.round(-timeToImpact(late));
      late.state = 'done';
      onFeedback({ text: `늦음 +${offset}ms`, tone: 'bad' });
      return;
    }

    // 3) 아무것도 없는데 눌렀다 — 헛가드. 경직이 없으면 연타로 다 막힌다.
    player.guardLockout = GUARD_WHIFF_LOCKOUT;
    onFeedback({ text: '헛가드 — 경직', tone: 'bad' });
  }

  function resolveGuard(entry: LiveGuard) {
    // 타격 순간까지 못 막았다 — 피해를 입고, 늦은 입력을 감지할 시간을 잠깐 준다
    entry.state = 'grace';
    // window가 0이면 나눗셈이 깨지므로 최소값을 둔다
    entry.graceLeft = Math.max(1, entry.cast.window);
    entry.fadeTotal = entry.graceLeft;
    entry.incomingMat.color.set(COLOR_DODGE);
    entry.windowMat.opacity = 0;

    hits++;
    player.hp -= entry.cast.damage ?? 1;
    onHit();
  }

  function updateGuard(entry: LiveGuard, dt: number) {
    // 링은 항상 플레이어를 따라다닌다 — 움직이면서도 타이밍을 봐야 한다
    entry.group.position.set(player.pos.x, 0.09, player.pos.z);

    if (entry.state === 'telegraphing') {
      const left = timeToImpact(entry);
      if (left <= 0) {
        resolveGuard(entry);
        return;
      }
      const progress = 1 - left / entry.cast.windup;
      const radius =
        GUARD_RING_START - progress * (GUARD_RING_START - GUARD_RING_TARGET);
      entry.incoming.scale.setScalar(radius);
      // 판정 창에 들어오면 링이 초록으로 — 지금 누르라는 신호
      entry.incomingMat.color.set(left <= entry.cast.window ? COLOR_STAND : 0xffe066);
      return;
    }

    entry.graceLeft -= dt;
    entry.incoming.scale.setScalar(GUARD_RING_TARGET);
    entry.incomingMat.opacity = Math.max(0, entry.graceLeft / entry.fadeTotal);
    entry.windowMat.opacity = 0;
  }

  // ---------- 루프 ----------

  return {
    get time() {
      return time;
    },
    duration,
    get finished() {
      return time >= duration || player.hp <= 0;
    },

    activeLabels() {
      const fieldLabels = fields
        .filter((e) => e.state === 'telegraphing' && e.cast.label)
        .map((e) => ({ text: e.cast.label!, rule: (e.cast.rule ?? 'dodge') as Rule }));
      const guardLabels = guards
        .filter((g) => g.state === 'telegraphing' && g.cast.label)
        .map((g) => ({ text: g.cast.label!, rule: 'guard' as const }));
      return [...guardLabels, ...fieldLabels];
    },

    update(dt, input) {
      const prev = time;
      time += dt;

      // 이번 프레임 구간에 진입한 공격을 띄운다
      for (const event of pattern.casts) {
        if (event.at > prev && event.at <= time) {
          if (isGuard(event)) guards.push(spawnGuard(event));
          else fields.push(spawnField(event));
        }
      }

      // 가드 입력은 판정 갱신보다 먼저 본다.
      // 나중에 보면 같은 프레임에 타격이 처리돼 정확히 맞춘 입력이 "늦음"이 된다.
      if (input.pressed.has('shift')) onGuardPress();

      for (const entry of guards) updateGuard(entry, dt);

      for (const entry of fields) {
        if (entry.state === 'telegraphing') {
          const progress = (time - entry.cast.at) / entry.cast.windup;
          if (progress >= 1) {
            resolveField(entry);
          } else {
            // 터질수록 진해진다 — 남은 시간을 색으로 읽을 수 있게
            entry.fill.opacity = 0.18 + progress * 0.32;
          }
        } else if (entry.fadeLeft > 0) {
          entry.fadeLeft -= dt;
          entry.fill.opacity = Math.max(0, (entry.fadeLeft / BURST_FADE) * 0.55);
        }
      }

      // 다 사라진 것들 정리
      const doneFields = fields.filter((e) => e.state === 'resolved' && e.fadeLeft <= 0);
      for (const entry of doneFields) disposeGroup(scene, entry.group);
      if (doneFields.length) fields = fields.filter((e) => !doneFields.includes(e));

      const doneGuards = guards.filter((g) => g.state !== 'telegraphing' && g.graceLeft <= 0);
      for (const entry of doneGuards) {
        // 끝까지 아무 입력도 없었다면 그것도 정보다
        if (entry.state === 'grace') onFeedback({ text: '무입력', tone: 'bad' });
        disposeGroup(scene, entry.group);
      }
      if (doneGuards.length) guards = guards.filter((g) => !doneGuards.includes(g));

      boss.rotation.y += dt * 0.0004;
    },

    restart() {
      for (const entry of fields) disposeGroup(scene, entry.group);
      for (const entry of guards) disposeGroup(scene, entry.group);
      fields = [];
      guards = [];
      time = 0;
      hits = 0;
      justGuards = 0;
      offsets = [];
    },

    result(): RunResult {
      return {
        cleared: player.hp > 0 && time >= duration,
        hits,
        totalCasts: pattern.casts.length,
        elapsed: time,
        justGuards,
        guardTotal,
        avgOffset: offsets.length
          ? Math.round(offsets.reduce((a, b) => a + b, 0) / offsets.length)
          : null,
      };
    },

    dispose() {
      for (const entry of fields) disposeGroup(scene, entry.group);
      for (const entry of guards) disposeGroup(scene, entry.group);
      fields = [];
      guards = [];
      scene.remove(boss);
    },
  };
}

function disposeGroup(scene: THREE.Scene, group: THREE.Group): void {
  scene.remove(group);
  group.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      o.geometry.dispose();
      const mat = o.material;
      if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
      else mat.dispose();
    }
  });
}

function createBoss(): THREE.Group {
  const group = new THREE.Group();

  const body = new THREE.Mesh(
    new THREE.CylinderGeometry(1.6, 2.2, 3.4, 8),
    new THREE.MeshStandardMaterial({ color: 0x8b5cf6, roughness: 0.5 }),
  );
  body.position.y = 1.7;
  group.add(body);

  const crown = new THREE.Mesh(
    new THREE.OctahedronGeometry(0.9),
    new THREE.MeshStandardMaterial({ color: 0xd8b4fe, emissive: 0x4c1d95 }),
  );
  crown.position.y = 4.2;
  group.add(crown);

  return group;
}
