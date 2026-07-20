import * as THREE from 'three';
import type { Input } from '../core/input';
import { CAMERA_YAW } from '../core/view';
import type { Vec2 } from './types';

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
  object: THREE.Group;
  update(dt: number, input: Input, arenaRadius: number): void;
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

  const bodyMat = body.material as THREE.MeshStandardMaterial;

  const player: Player = {
    pos: { ...spawn },
    angle: -Math.PI / 2,
    hp: maxHp,
    maxHp,
    cooldown: 0,
    dashElapsed: null,
    dashDir: { x: 0, z: -1 },
    get invulnerable() {
      return this.dashElapsed !== null && this.dashElapsed < DASH_IFRAME;
    },
    object,

    update(dt, input, arenaRadius) {
      const seconds = dt / 1000;
      this.cooldown = Math.max(0, this.cooldown - dt);

      // 대시 중에는 다른 입력을 받지 않는다 (로아의 경직과 같은 역할)
      if (this.dashElapsed !== null) {
        const step = (DASH_DISTANCE / DASH_DURATION) * dt;
        this.pos.x += this.dashDir.x * step;
        this.pos.z += this.dashDir.z * step;
        this.dashElapsed += dt;
        if (this.dashElapsed >= DASH_DURATION) this.dashElapsed = null;
        clampToArena(this.pos, arenaRadius);
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

      if (input.pressed.has(' ') && this.cooldown === 0) {
        // 이동 중이면 이동 방향, 정지 상태면 바라보는 방향으로 대시
        this.dashDir = dir ?? { x: Math.cos(this.angle), z: Math.sin(this.angle) };
        this.angle = Math.atan2(this.dashDir.z, this.dashDir.x);
        this.dashElapsed = 0;
        this.cooldown = DASH_COOLDOWN;
      }

      clampToArena(this.pos, arenaRadius);
      this.sync();
    },

    reset() {
      this.pos = { ...spawn };
      this.angle = -Math.PI / 2;
      this.hp = maxHp;
      this.cooldown = 0;
      this.dashElapsed = null;
      this.sync();
    },

    sync() {
      object.position.set(this.pos.x, 0, this.pos.z);
      // shapes.ts와 같은 규약: 월드 각도 a → Y회전 -a
      object.rotation.y = -this.angle;
      bodyMat.color.set(this.invulnerable ? 0xfff08a : 0x63d2ff);
      bodyMat.emissive.set(this.invulnerable ? 0x6b5b00 : 0x000000);
    },
  };

  player.sync();
  return player;
}

function readKeyboardDirection(input: Input): Vec2 | null {
  // 화면이 45도 돌아가 있으므로 화면 기준 WASD를 월드 축으로 회전시킨다.
  // 이걸 안 하면 W를 눌렀을 때 대각선으로 가서 조작이 어긋난 느낌이 든다.
  let sx = 0;
  let sz = 0;
  if (input.keys.has('w')) sz -= 1;
  if (input.keys.has('s')) sz += 1;
  if (input.keys.has('a')) sx -= 1;
  if (input.keys.has('d')) sx += 1;
  if (sx === 0 && sz === 0) return null;

  const cos = Math.cos(CAMERA_YAW);
  const sin = Math.sin(CAMERA_YAW);
  const x = sx * cos + sz * sin;
  const z = -sx * sin + sz * cos;
  const len = Math.hypot(x, z);
  return { x: x / len, z: z / len };
}

function clampToArena(pos: Vec2, radius: number): void {
  const limit = radius - PLAYER_RADIUS;
  const dist = Math.hypot(pos.x, pos.z);
  if (dist > limit) {
    pos.x = (pos.x / dist) * limit;
    pos.z = (pos.z / dist) * limit;
  }
}
