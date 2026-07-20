# 레이드 패턴 연습장

로스트아크식 쿼터뷰 레이드에서 **패턴 인지 → 포지셔닝 → 회피**만 떼어낸 연습 도구.
성장·아이템·클래스는 없다. 장판을 읽고 피하는 것만 있다.

Three.js + Vite + TypeScript, 서버 없이 브라우저에서 전부 동작.

## 실행

```bash
npm install
npm run dev      # 개발 서버
npm run build    # dist/ 생성
npm start        # dist/ 를 정적 서빙 (배포용)
```

## 조작

| 입력 | 동작 |
|---|---|
| 우클릭 | 해당 위치로 이동 |
| WASD | 이동 (화면 기준) |
| Space | 대시 — 시작 후 180ms 무적, 쿨타임 1.6초 |
| Shift | 가드 (저스트가드) |
| R | 재시작 |

상단 슬라이더로 **재생 속도를 25%까지** 낮출 수 있다. 어려운 구간은 느리게 반복하다가
속도를 올리는 게 이 도구의 정석적인 사용법이다.

`?p=guard-rhythm` 으로 특정 패턴을 바로 열 수 있다.
`?t=5300` 을 붙이면 그 시각(ms)에 멈춘다 — 패턴 타이밍을 맞출 때 쓴다.

## 패턴 추가하기

패턴은 전부 데이터다. [src/game/patterns.ts](src/game/patterns.ts)에 객체 하나를
추가하고 `PATTERNS` 배열에 넣으면 끝이다. 다른 코드는 건드리지 않는다.

```ts
{
  id: 'my-pattern',
  name: '내 패턴',
  arenaRadius: 18,
  casts: [
    {
      at: 1200,        // 시작 후 1.2초에 장판 등장
      windup: 1600,    // 1.6초 뒤 터짐 = 회피 가능 시간
      shape: { kind: 'fan', radius: 16, arc: Math.PI / 2 },
      anchor: { kind: 'boss' },           // boss | player | fixed
      facing: { kind: 'toward-player' },  // toward-player | absolute
      rule: 'dodge',                      // dodge | stand
      label: '전방 부채꼴',
    },
  ],
}
```

**shape** — `circle` / `donut` / `fan` / `rect` 네 가지로 실제 레이드 장판의 대부분이 표현된다.

**rule** — `dodge`는 장판 안에 있으면 피격(빨강), `stand`는 장판 밖에 있으면 피격(초록).
안전지대·쫄 처리 구역이 `stand`다.

**anchor: player** — 시전 순간의 플레이어 위치에 장판이 생긴다. 로아의 "발밑 장판".

### 저스트가드 (대난투)

장판이 "어디에 서 있느냐"를 묻는다면 저스트가드는 "언제 누르느냐"를 묻는다.
그래서 타입이 따로 있다.

```ts
{
  type: 'guard',
  at: 600,       // 예고가 뜨는 시각
  windup: 1400,  // 예고 → 타격까지. 즉 at+windup = 2000ms에 맞는다
  window: 150,   // 타격 기준 150ms 전부터 누르면 성공
  label: '돌진 2연타',
}
```

플레이어 발밑에 링 세 개가 뜬다. 흰 링이 타격 지점, 초록 띠가 판정 창,
줄어드는 링이 타격까지 남은 시간이다. 줄어드는 링이 초록 띠에 들어오면
색이 바뀌므로 **그때 Shift**를 누르면 된다.

판정 결과는 화면 중앙에 오차(ms)로 표시된다.

| 표시 | 뜻 |
|---|---|
| `저스트가드 -40ms` | 성공. 40ms 일찍 눌렀다 |
| `저스트가드 PERFECT` | 오차 0 |
| `늦음 +60ms` | 타격 후 60ms에 눌렀다. 실패 |
| `무입력` | 끝까지 안 눌렀다 |
| `헛가드 — 경직` | 아무 공격도 없는데 눌렀다. **0.7초 경직** |

헛가드 경직([`GUARD_WHIFF_LOCKOUT`](src/game/player.ts))이 핵심이다.
이게 없으면 Shift 연타로 전부 막혀서 타이밍 연습이 무의미해진다.
난이도가 안 맞으면 이 값과 `window`를 조절하면 된다.

결과 화면에는 저스트가드 성공률과 **평균 오차**가 나온다. 평균이 한쪽으로
치우쳐 있으면(예: `-45ms (이름)`) 그게 교정할 습관이다.

> ⚠️ **측정 정밀도**: 입력은 프레임 단위로 감지되므로 오차 표시의 해상도는
> 프레임 간격(60fps에서 약 16ms)이 한계다. 밀리초 단위 정밀도가 필요하면
> keydown 이벤트의 타임스탬프를 쓰도록 고쳐야 한다.

각도는 [`clock(hour)`](src/game/patterns.ts) 헬퍼로 시계 방향 표기를 쓸 수 있다.
`clock(12)`이 화면 위쪽. 아레나 바닥의 굵은 눈금이 12/3/6/9시다.

## 구조

```
src/
  core/
    view.ts       쿼터뷰 카메라 + 아레나. 렌더러는 한 번만 만들고 재사용
    input.ts      우클릭 레이캐스트 + 키보드
  game/
    types.ts      패턴 데이터 포맷 — 이 프로젝트의 중심
    shapes.ts     장판 판정과 지오메트리. 둘이 어긋나면 안 되므로 한 파일에 둔다
    player.ts     이동 + 무적 대시
    encounter.ts  타임라인 실행기
    patterns.ts   패턴 라이브러리 (데이터)
  ui/hud.ts       DOM 오버레이
server.js         dist/ 정적 서버 — 의존성 없음
```

시간은 전부 바깥에서 `dt`로 주입되므로 슬로우모션이 `timeScale` 하나로 해결된다.

## Railway 배포

[railway.json](railway.json)에 빌드/실행 명령이 들어 있어 별도 설정이 필요 없다.

1. 이 저장소를 GitHub에 push
2. Railway → New Project → Deploy from GitHub repo
3. 빌드 후 Settings → Networking → **Generate Domain**

`server.js`가 `process.env.PORT`를 읽고 `0.0.0.0`에 바인딩하므로 Railway에서
포트 설정을 따로 할 필요가 없다.

## 앞으로

- 패턴 추가가 가장 싸다. `patterns.ts`에 계속 쌓으면 된다.
- 시도별 기록(피격 횟수 추이)을 남기면 연습 도구로서 훨씬 쓸모 있어진다.
- 멀티플레이는 지금 구조상 `encounter.ts`의 시간 주입 지점을 서버로 옮기는 작업이 된다.
  `server.js`가 그 확장 지점이다.
