import * as THREE from 'three';
import type { Input } from '../core/input';
import { getCameraYaw } from '../core/view';
import type { Arena, Vec2 } from './types';

/**
 * 플레이어. 이동 + 대시(무적).
 *
 * 무적 프레임이 있는 대시는 로아 패턴 연습의 핵심이다. 대부분의 패턴은
 * "피할 수 있느냐"가 아니라 "대시를 언제 쓰느냐"의 문제이기 때문에,
 * 대시 성능(거리/무적시간/쿨타임)은 여기서 한 곳으로 모아 조정한다.
 */
export const MOVE_SPEED = 9; // units/s
export const DASH_DISTANCE = 6.5;
export const DASH_DURATION = 220; // ms
export const DASH_IFRAME = 180; // ms — 대시 시작 후 무적이 유지되는 시간
export const DASH_COOLDOWN = 1600; // ms
export const PLAYER_RADIUS = 0.45;

/**
 * 가드 자세가 유지되는 시간(ms) — 0.5초, 60fps 기준 30프레임.
 *
 * 저스트가드 판정의 전부가 이 값에 걸려 있다. G를 누르면 그 순간 판정이
 * 나는 게 아니라 이 시간만큼 "막고 있는 상태"가 되고, 그 사이에 공격이
 * 닿으면 막힌다. 즉 판정 창을 들고 있는 쪽은 보스가 아니라 플레이어다.
 */
export const GUARD_STANCE = 500;
/**
 * 자세가 끝난 뒤 다시 가드할 수 없는 시간(ms).
 * 이게 없으면 G를 연타해 사실상 상시 무적이 되어 타이밍 연습이 무의미해진다.
 */
export const GUARD_RECOVERY = 350;

export interface Player {
  pos: Vec2;
  /** 바라보는 각도 — (cos, sin) in (x, z) */
  angle: number;
  hp: number;
  maxHp: number;
  /** 남은 대시 쿨타임(ms) */
  cooldown: number;
  /** 대시 중이면 경과 시간(ms), 아니면 null */
  dashElapsed: number | null;
  dashDir: Vec2;
  readonly invulnerable: boolean;
  /**
   * 가드 자세를 잡은 뒤 경과 시간(ms). 자세가 아니면 null.
   * 이 값이 GUARD_STANCE 미만인 동안 들어온 공격이 막힌다.
   */
  guardElapsed: number | null;
  /** 자세가 끝난 뒤 남은 경직(ms) */
  guardRecovery: number;
  /** 지금 막고 있는가 — 저스트가드 판정의 유일한 조건 */
  readonly guarding: boolean;
  /** 지금 G가 먹히는가 (자세 중도 경직 중도 아님) */
  readonly canGuard: boolean;
  /** 가드 성공 이펙트를 보여줄 남은 시간(ms) */
  guardFlash: number;
  /** 가드 자세를 시작한다. 경직 중이면 false. */
  startGuard(): boolean;
  object: THREE.Group;
  update(dt: number, input: Input, arena: Arena): void;
  reset(): void;
  sync(): void;
}

export function createPlayer(spawn: Vec2 = { x: 0, z: 12 }, maxHp = 3): Player {
  const object = new THREE.Group();

  const body = new THREE.Mesh(
    new THREE.CapsuleGeometry(PLAYER_RADIUS, 1.1, 6, 16),
    new THREE.MeshStandardMaterial({ color: 0x63d2ff, roughness: 0.4 }),
  );
  body.position.y = 1.0;
  object.add(body);

  // 어느 쪽을 보는지 — 부채꼴/직선 장판을 읽을 때 기준이 된다
  const nose = new THREE.Mesh(
    new THREE.ConeGeometry(0.28, 0.7, 12),
    new THREE.MeshStandardMaterial({ color: 0xffffff }),
  );
  nose.rotation.z = -Math.PI / 2;
  nose.position.set(0.75, 1.0, 0);
  object.add(nose);

  // 발밑 원 — 장판과의 거리 감각을 잡아준다
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(PLAYER_RADIUS, PLAYER_RADIUS + 0.12, 32),
    new THREE.MeshBasicMaterial({ color: 0x63d2ff, transparent: true, opacity: 0.9 }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.05;
  object.add(ring);

  // 가드 성공 시 잠깐 뜨는 방패 — 막았다는 걸 즉시 알아야 다음 타를 준비한다
  const shield = new THREE.Mesh(
    new THREE.RingGeometry(1.15, 1.5, 40),
    new THREE.MeshBasicMaterial({
      color: 0xffe066,
      transparent: true,
      opacity: 0,
      side: THREE.DoubleSide,
      depthWrite: false,
    }),
  );
  shield.rotation.x = -Math.PI / 2;
  shield.position.y = 0.12;
  object.add(shield);

  // 가드 자세 — 보스 쪽(-Z)을 향해 세우는 방패막.
  // 성공 이펙트와 달리 "누르고 있는 0.5초 동안" 계속 보여야 한다.
  // 그래야 자기가 언제부터 언제까지 막고 있었는지 눈으로 배운다.
  const stance = new THREE.Mesh(
    new THREE.CylinderGeometry(1.35, 1.35, 1.9, 24, 1, true, -Math.PI / 2.6, Math.PI / 1.3),
    new THREE.MeshBasicMaterial({
      color: 0x8fd4ff,
      transparent: true,
      opacity: 0,
      side: THREE.DoubleSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }),
  );
  stance.position.y = 1.0;
  object.add(stance);

  const bodyMat = body.material as THREE.MeshStandardMaterial;
  const shieldMat = shield.material as THREE.MeshBasicMaterial;
  const stanceMat = stance.material as THREE.MeshBasicMaterial;

  const player: Player = {
    pos: { ...spawn },
    angle: -Math.PI / 2,
    hp: maxHp,
    maxHp,
    cooldown: 0,
    dashElapsed: null,
    dashDir: { x: 0, z: -1 },
    guardElapsed: null,
    guardRecovery: 0,
    guardFlash: 0,
    get invulnerable() {
      return this.dashElapsed !== null && this.dashElapsed < DASH_IFRAME;
    },
    get guarding() {
      return this.guardElapsed !== null && this.guardElapsed < GUARD_STANCE;
    },
    get canGuard() {
      return this.guardElapsed === null && this.guardRecovery === 0;
    },

    startGuard() {
      if (!this.canGuard) return false;
      this.guardElapsed = 0;
      return true;
    },

    object,

    update(dt, input, arena) {
      const seconds = dt / 1000;
      this.cooldown = Math.max(0, this.cooldown - dt);
      this.guardFlash = Math.max(0, this.guardFlash - dt);

      // 가드 자세 → 경직 → 해제. 자세 중에는 발이 묶인다.
      if (this.guardElapsed !== null) {
        this.guardElapsed += dt;
        if (this.guardElapsed >= GUARD_STANCE) {
          this.guardElapsed = null;
          this.guardRecovery = GUARD_RECOVERY;
        }
        clampToArena(this.pos, arena);
        this.sync();
        return;
      }
      this.guardRecovery = Math.max(0, this.guardRecovery - dt);

      // 대시 중에는 다른 입력을 받지 않는다 (로아의 경직과 같은 역할)
      if (this.dashElapsed !== null) {
        const step = (DASH_DISTANCE / DASH_DURATION) * dt;
        this.pos.x += this.dashDir.x * step;
        this.pos.z += this.dashDir.z * step;
        this.dashElapsed += dt;
        if (this.dashElapsed >= DASH_DURATION) this.dashElapsed = null;
        clampToArena(this.pos, arena);
        this.sync();
        return;
      }

      // WASD가 있으면 우선, 없으면 우클릭 목표로 이동
      let dir = readKeyboardDirection(input);
      if (dir) {
        input.clearMoveTarget();
      } else if (input.moveTarget) {
        const dx = input.moveTarget.x - this.pos.x;
        const dz = input.moveTarget.z - this.pos.z;
        const len = Math.hypot(dx, dz);
        // 목표에 도달하면 멈춘다
        if (len < 0.15) input.clearMoveTarget();
        else dir = { x: dx / len, z: dz / len };
      }

      if (dir) {
        this.pos.x += dir.x * MOVE_SPEED * seconds;
        this.pos.z += dir.z * MOVE_SPEED * seconds;
        this.angle = Math.atan2(dir.z, dir.x);
      }

      if (input.pressed.has('Space') && this.cooldown === 0) {
        // 로아와 동일하게 마우스 커서 방향으로 돌진한다.
        // 이동 방향과 무관하므로 "옆으로 달리면서 뒤로 빼기" 같은 조작이 된다.
        this.dashDir = directionToCursor(this.pos, input) ??
          dir ?? { x: Math.cos(this.angle), z: Math.sin(this.angle) };
        this.angle = Math.atan2(this.dashDir.z, this.dashDir.x);
        this.dashElapsed = 0;
        this.cooldown = DASH_COOLDOWN;
      }

      clampToArena(this.pos, arena);
      this.sync();
    },

    reset() {
      this.pos = { ...spawn };
      this.angle = -Math.PI / 2;
      this.hp = maxHp;
      this.cooldown = 0;
      this.dashElapsed = null;
      this.guardElapsed = null;
      this.guardRecovery = 0;
      this.guardFlash = 0;
      this.sync();
    },

    sync() {
      object.position.set(this.pos.x, 0, this.pos.z);
      // 가드 중에는 보스 쪽(-Z)을 향해 몸을 돌린다 — 막는 방향이 보여야 한다.
      // shapes.ts와 같은 규약: 월드 각도 a → Y회전 -a
      object.rotation.y = -(this.guardElapsed !== null ? -Math.PI / 2 : this.angle);

      bodyMat.color.set(
        this.invulnerable ? 0xfff08a : this.guarding ? 0x9fe0ff : 0x63d2ff,
      );
      bodyMat.emissive.set(
        this.invulnerable ? 0x6b5b00 : this.guarding ? 0x1d4a6b : 0x000000,
      );

      shieldMat.opacity = Math.min(1, this.guardFlash / 200) * 0.85;

      // 자세가 끝나갈수록 옅어진다. 남은 시간이 눈에 보여야
      // "너무 일찍 눌렀다"를 스스로 알아챈다.
      const left = this.guardElapsed === null ? 0 : 1 - this.guardElapsed / GUARD_STANCE;
      stanceMat.opacity = Math.max(0, left) * 0.55;
    },
  };

  player.sync();
  return player;
}

/**
 * 커서를 향하는 단위 벡터. 마우스가 아직 안 움직였거나 커서가 발밑이면 null.
 * null이면 호출부가 이동 방향으로 대체한다.
 */
function directionToCursor(pos: Vec2, input: Input): Vec2 | null {
  if (!input.hasCursor) return null;
  const dx = input.cursor.x - pos.x;
  const dz = input.cursor.z - pos.z;
  const len = Math.hypot(dx, dz);
  if (len < 0.4) return null;
  return { x: dx / len, z: dz / len };
}

function readKeyboardDirection(input: Input): Vec2 | null {
  // 화면이 45도 돌아가 있으므로 화면 기준 WASD를 월드 축으로 회전시킨다.
  // 이걸 안 하면 W를 눌렀을 때 대각선으로 가서 조작이 어긋난 느낌이 든다.
  let sx = 0;
  let sz = 0;
  if (input.keys.has('KeyW')) sz -= 1;
  if (input.keys.has('KeyS')) sz += 1;
  if (input.keys.has('KeyA')) sx -= 1;
  if (input.keys.has('KeyD')) sx += 1;
  if (sx === 0 && sz === 0) return null;

  const yaw = getCameraYaw();
  const cos = Math.cos(yaw);
  const sin = Math.sin(yaw);
  const x = sx * cos + sz * sin;
  const z = -sx * sin + sz * cos;
  const len = Math.hypot(x, z);
  return { x: x / len, z: z / len };
}

function clampToArena(pos: Vec2, arena: Arena): void {
  if (arena.kind === 'circle') {
    const limit = arena.radius - PLAYER_RADIUS;
    const dist = Math.hypot(pos.x, pos.z);
    if (dist > limit) {
      pos.x = (pos.x / dist) * limit;
      pos.z = (pos.z / dist) * limit;
    }
    return;
  }

  // 통로는 축별로 자른다. 좌우는 파란 빛 벽, 앞뒤는 통로 양 끝.
  const xLimit = arena.halfWidth - PLAYER_RADIUS;
  pos.x = Math.max(-xLimit, Math.min(xLimit, pos.x));
  pos.z = Math.max(arena.far + PLAYER_RADIUS, Math.min(arena.near - PLAYER_RADIUS, pos.z));
}
