# 개발자 가이드 (Developer Guide)

Maestro 코드베이스의 프로젝트 구조, 로컬 환경 설정, 빌드 및 테스트 실행 방법을 안내합니다.

---

## 1. 프로젝트 패키지 구조 (Monorepo Layout)

Maestro는 **npm workspaces** 기반의 모노레포 구조로 관리됩니다.

```text
├── apps/
│   ├── control-plane/     # Fastify 기반 제어 평면 백엔드 REST & SSE 서버
│   ├── cli/               # Maestro 명령줄 인터페이스 (CLI)
│   └── secretary/         # Secretary Office React 웹 대시보드
├── packages/
│   ├── contracts/         # Zod 스키마, API 엔드포인트 및 이벤트 계약
│   ├── domain/            # 순수 비즈니스 도메인 모델 (Goal, TaskContract, Council 등)
│   ├── persistence/       # PostgreSQL/Drizzle 영속성 레이어 및 마이그레이션
│   ├── authority/         # 보안 및 권한 평가 게이트웨이 (AuthorizedEffectExecutor)
│   ├── evidence/          # SHA-256 증거 번들 생성 및 무결성 검증
│   ├── prime-adapter/     # Prime Agent SDK 연동 전용 어댑터
│   ├── git-adapter/       # Git 격리 워크트리/브랜치/커밋 실행기
│   └── api-client/        # control-plane과 통신하는 타입 안전 클라이언트 라이브러리
```

---

## 2. 필수 요구사항 (Prerequisites)

* **Node.js**: `v24.0.0` 이상
* **npm**: `v10.0.0` 이상
* **PostgreSQL**: `17.x` (통합 테스트 실행 시 필요)
* **Linux OS**: Prime Agent 보안 격리 정책상 Linux 환경 권장

---

## 3. 빌드 및 테스트 실행

### 1) 전체 TypeScript 빌드
프로젝트의 모든 패키지를 프로젝트 레퍼런스(`tsc -b`) 기반으로 빌드합니다:
```bash
npm run build
```

### 2) 전체 테스트 실행 (Vitest)
비-DB 단위 테스트 및 순수 도메인 테스트를 일괄 실행합니다:
```bash
npm test
```

### 3) 빌드 및 테스트 일괄 검증 (Check)
```bash
npm run check
```

### 4) PostgreSQL 통합 테스트 실행 (DB 컨테이너 필요 시)
로컬 PostgreSQL 테스트 컨테이너가 실행 중일 때 통합 테스트를 수행하는 방법:
```bash
MAESTRO_TEST_DATABASE_URL=postgresql://maestro_test:maestro_test@127.0.0.1:55432/maestro_test npm test
```

### 5) Live Prime Agent 연동 테스트 실행
```bash
MAESTRO_LIVE_PRIME=1 npm test -- packages/prime-adapter/src/sdk.live.test.ts
```

---

## 4. CLI 도구 사용법 (`apps/cli`)

CLI 도구를 통해 control-plane 서버와 통신하며 시스템 상태를 조회하고 명령을 내릴 수 있습니다.

```bash
# Goal 상세 조회
node apps/cli/dist/main.js goal get <goalId>

# 도메인 이벤트 목록 조회
node apps/cli/dist/main.js events list --goalId <goalId>

# Sentinel 챌린지 상태 조회
node apps/cli/dist/main.js sentinel challenge <challengeId>

# Overwatch Council 심의 라운드 조회
node apps/cli/dist/main.js council round <roundId>

# Quality 인증서 조회
node apps/cli/dist/main.js certification get <certificationId>

# Sane 최종 리포트 조회
node apps/cli/dist/main.js report get <goalId>
```
