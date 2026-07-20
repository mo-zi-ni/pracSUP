import * as THREE from 'three';
import type { Shape, Vec2 } from './types';

/**
 * 장판 판정과 렌더링. 이 두 가지는 반드시 같은 정의를 써야 하므로
 * 한 파일에 둔다 — 보이는 것과 맞는 것이 다르면 연습 도구로서 무가치하다.
 */

/**
 * 월드 좌표 p가 장판 안에 있는가.
 *
 * origin 기준으로 facing 방향을 +X로 하는 로컬 좌표계로 변환해서 판정한다.
 * forward = (cos a, sin a) in (x, z)
 */
export function isInside(shape: Shape, origin: Vec2, angle: number, p: Vec2): boolean {
  const dx = p.x - origin.x;
  const dz = p.z - origin.z;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);

  // forward: facing 방향 성분, lateral: 좌우 성분
  const forward = dx * cos + dz * sin;
  const lateral = -dx * sin + dz * cos;
  const dist = Math.hypot(dx, dz);

  switch (shape.kind) {
    case 'circle':
      return dist <= shape.radius;
    case 'donut':
      return dist >= shape.inner && dist <= shape.outer;
    case 'fan':
      return dist <= shape.radius && Math.abs(Math.atan2(lateral, forward)) <= shape.arc / 2;
    case 'rect':
      return forward >= 0 && forward <= shape.length && Math.abs(lateral) <= shape.width / 2;
  }
}

/**
 * 장판의 지오메트리를 만든다. 로컬 +X를 facing으로 삼아 XY 평면에 그린 뒤
 * mesh.rotation.x = -PI/2 로 눕히는 규약을 따른다. (main에서 그룹을 Y축 회전)
 */
export function buildGeometry(shape: Shape): THREE.BufferGeometry {
  switch (shape.kind) {
    case 'circle':
      return new THREE.CircleGeometry(shape.radius, 64);
    case 'donut':
      return new THREE.RingGeometry(shape.inner, shape.outer, 64);
    case 'fan':
      // +X 중심으로 대칭이 되도록 thetaStart를 -arc/2 에서 시작
      return new THREE.CircleGeometry(shape.radius, 64, -shape.arc / 2, shape.arc);
    case 'rect': {
      // PlaneGeometry는 원점 중심이므로 +X로 length/2 만큼 밀어 origin에서 시작하게 한다
      const geo = new THREE.PlaneGeometry(shape.length, shape.width);
      geo.translate(shape.length / 2, 0, 0);
      return geo;
    }
  }
}

/** 장판을 담을 그룹. 눕히기 + facing 회전 규약을 여기에 가둔다. */
export function createTelegraphMesh(shape: Shape, material: THREE.Material): THREE.Group {
  const group = new THREE.Group();
  const mesh = new THREE.Mesh(buildGeometry(shape), material);
  mesh.rotation.x = -Math.PI / 2;
  group.add(mesh);
  return group;
}

/**
 * 월드 각도 a를 그룹의 Y회전으로 변환.
 * Y축 +a 회전은 (1,0,0)을 (cos a, 0, -sin a)로 보내므로 (x,z)각도는 -a가 된다.
 * 따라서 원하는 각도 a를 얻으려면 -a를 넣는다.
 */
export function applyFacing(group: THREE.Group, angle: number): void {
  group.rotation.y = -angle;
}
