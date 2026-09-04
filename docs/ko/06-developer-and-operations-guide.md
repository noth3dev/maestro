# 06. 개발자 및 운영 가이드 (Developer & Operations Guide)

본 가이드는 개발자 온보딩, 저장소 패키지 구조, 로컬 환경 설정, 테스트 실행 방법, CLI 명령어 사용법 및 운영 프로토콜을 안내합니다.

---

## 1. 모노레포 패키지 구조 (Monorepo Package Layout)

Maestro는 **npm workspaces** 기반의 모노레포 구조로 관리됩니다:

```text
├── apps/
│   ├── control-plane/     # Fastify 5 REST & SSE 제어 평면 백엔드 서버
│   ├── cli/               # Maestro 명령줄 인터페이스 (CLI)
│   ├── secretary/         # Next.js Concertmaster Office 웹 대시보드
│   └── firefly/           # 아웃오브밴드 Discord 인시던트 감지 데몬
├── packages/
│   ├── contracts/         # Zod 스키마, API 계약 및 이벤트 정의
│   ├── domain/            # 순수 비즈니스 도메인 모델 (Goal, TaskContract, HeadCouncil)
│   ├── persistence/       # PostgreSQL 17 / Drizzle ORM 레이어 및 마이그레이션
│   ├── authority/         # 보안 매트릭스 및 AuthorizedEffectExecutor
│   ├── evidence/          # SHA-256 증거 번들 생성 및 무결성 검증
│   ├── prime-adapter/     # Prime Agent SDK 어댑터 및 도메인 포트
│   ├── git-adapter/       # Git 워크트리, 브랜치 및 커밋 실행기
│   └── api-client/        # 타입 안전 API 클라이언트 라이브러리
```

---

## 2. 필수 요구사항 (Prerequisites)

* **Node.js**: `v24.x LTS` 이상
* **npm**: `v10.x` 이상
* **PostgreSQL**: `17.x` (통합 테스트 실행 시 필요)
* **Docker**: 로컬 PostgreSQL 테스트 컨테이너 (`Testcontainers`) 실행 시 필요
* **OS**: Linux (Prime Agent 보안 격리 정책상 권장)

---

## 3. 빌드 및 테스트 명령어 (Build & Test Commands)

### 1) TypeScript 전체 빌드
프로젝트 레퍼런스(`tsc -b`) 기반으로 모든 모노레포 패키지를 빌드합니다:
```bash
npm run build
```

### 2) 순수 단위 테스트 (Vitest)
비-DB 단위 테스트를 일괄 실행합니다:
```bash
npm test
```

### 3) 전체 검증 (`npm run check`)
TypeScript 빌드, 린팅, 모든 단위 테스트를 순차 실행합니다:
```bash
npm run check
```

### 4) PostgreSQL 통합 테스트
로컬 PostgreSQL 테스트 컨테이너 환경에서 통합 테스트를 수행합니다:
```bash
MAESTRO_TEST_DATABASE_URL=postgresql://maestro_test:maestro_test@127.0.0.1:55432/maestro_test npm test
```

### 5) Live Prime Agent SDK 테스트
실제 라이브 Prime Agent SDK 런타임과 연동 테스트를 수행합니다:
```bash
MAESTRO_LIVE_PRIME=1 npm test -- packages/prime-adapter/src/sdk.live.test.ts
```

---

## 4. CLI 도구 사용법 (CLI Usage)

Maestro CLI (`apps/cli`)는 제어 평면 HTTP REST API와 완전한 기능적 패리티를 제공합니다.

```bash
# Goal 상세 조회
node apps/cli/dist/main.js goal get <goalId>

# 도메인 이벤트 목록 조회
node apps/cli/dist/main.js events list --goalId <goalId>

# Metronome 챌린지 조회
node apps/cli/dist/main.js sentinel challenge <challengeId>

# Encore Council 심의 라운드 조회
node apps/cli/dist/main.js council round <roundId>

# Quality 인증서 조회
node apps/cli/dist/main.js certification get <certificationId>

# Concertmaster 최종 리포트 조회
node apps/cli/dist/main.js report get <goalId>
```

---

## 5. 운영 프로토콜 요약 (Operating Protocol Summary)

코드베이스 작업 시 운영 프로토콜 (`docs/OPERATING_PROTOCOL.md`)을 엄격히 준수해야 합니다:

1. **단일 브랜치 위생**: `main`이 유일하게 지속되는 브랜치입니다. 워크트리(`.worktrees/`) 및 기능 브랜치는 영구 유지하지 않고 병합 후 즉시 삭제합니다.
2. **Node Modules 심볼릭 링크**: 워크트리 생성 시 루트 `node_modules`를 심볼릭 링크(`ln -s ../../node_modules .worktrees/<slug>/node_modules`)하여 디스크 및 빌드 시간을 절약합니다.
3. **일회용 컨테이너 정제**: 테스트용 PostgreSQL 컨테이너는 슬러그명(e.g., `maestro-<slug>-postgres`)으로 생성하고 검증 직후 정제(`docker rm -f`)합니다.
4. **독립 검증 필수**: 에이전트가 작성한 코드는 `main`에 병합되기 전 반드시 독립적인(No-edit) 리뷰어를 통해 승인되어야 합니다.
