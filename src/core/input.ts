import * as THREE from 'three';
import type { Vec2 } from '../game/types';

/**
 * 입력. 로아처럼 클릭 이동을 기본으로 하되 WASD도 함께 받는다.
 * 패턴 연습에서는 WASD가 더 정밀해서 실제로 둘 다 쓰게 된다.
 */
export interface Input {
  /** 눌린 키 집합 (소문자) */
  keys: Set<string>;
  /** 이번 프레임에 새로 눌린 키 — 대시처럼 1회성 입력용 */
  pressed: Set<string>;
  /** 마지막 우클릭 이동 목표. 없으면 null */
  moveTarget: Vec2 | null;
  /** 커서가 가리키는 바닥 좌표 */
  cursor: Vec2;
  /** 마우스가 한 번이라도 움직였는가. 커서 기준 대시의 기본값 판단에 쓴다. */
  hasCursor: boolean;
  clearMoveTarget(): void;
  /** 프레임 끝에서 호출 — pressed를 비운다 */
  endFrame(): void;
  dispose(): void;
}

export function createInput(canvas: HTMLCanvasElement, camera: THREE.Camera, plane: THREE.Plane): Input {
  const keys = new Set<string>();
  const pressed = new Set<string>();
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const hit = new THREE.Vector3();

  const state: Input = {
    keys,
    pressed,
    moveTarget: null,
    cursor: { x: 0, z: 0 },
    hasCursor: false,
    clearMoveTarget: () => {
      state.moveTarget = null;
    },
    endFrame: () => pressed.clear(),
    dispose: () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('contextmenu', onContextMenu);
    },
  };

  function toGround(ev: PointerEvent): Vec2 | null {
    const rect = canvas.getBoundingClientRect();
    ndc.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
    ndc.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(ndc, camera);
    if (!raycaster.ray.intersectPlane(plane, hit)) return null;
    return { x: hit.x, z: hit.z };
  }

  function onKeyDown(ev: KeyboardEvent) {
    const k = ev.key.toLowerCase();
    // 스페이스로 페이지가 스크롤되면 연습에 방해가 된다
    if (k === ' ') ev.preventDefault();
    if (!keys.has(k)) pressed.add(k);
    keys.add(k);
  }
  function onKeyUp(ev: KeyboardEvent) {
    keys.delete(ev.key.toLowerCase());
  }
  /** 탭 전환 중 키가 눌린 채로 남는 것 방지 */
  function onBlur() {
    keys.clear();
  }
  function onPointerMove(ev: PointerEvent) {
    const p = toGround(ev);
    if (p) {
      state.cursor = p;
      state.hasCursor = true;
    }
  }
  function onPointerDown(ev: PointerEvent) {
    const p = toGround(ev);
    if (!p) return;
    state.cursor = p;
    state.hasCursor = true;
    // 로아와 동일하게 우클릭이 이동
    if (ev.button === 2) state.moveTarget = p;
  }
  function onContextMenu(ev: Event) {
    ev.preventDefault();
  }

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', onBlur);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('contextmenu', onContextMenu);

  return state;
}
