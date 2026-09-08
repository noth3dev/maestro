# 06. 개발자 및 운영 가이드 (Developer & Operations Guide)

본 가이드는 개발자 온보딩, 저장소 패키지 구조, 로컬 환경 설정, 테스트 실행 방법, CLI 명령어 사용법 및 운영 프로토콜을 안내합니다.

---

## 1. 모노레포 패키지 구조 (Monorepo Package Layout)

Maestro는 **npm workspaces** 기반의 모노레포 구조로 관리됩니다:

```text
├── apps/
│   ├── control-plane/     # Fastify 5 REST & SSE 제어 평면 백엔드 서버
│   ├── model-gateway/     # Provider SDK 및 credential 전용 프로세스
│   ├── cli/               # Maestro 명령줄 인터페이스 (CLI)
│   ├── secretary/         # Electron + React Concertmaster Office 데스크톱 클라이언트
│   └── discord/           # 아웃오브밴드 Discord 인시던트 감지 데몬
├── packages/
│   ├── contracts/         # Zod 스키마, API 계약 및 이벤트 정의
│   ├── domain/            # 순수 비즈니스 도메인 모델 (Goal, TaskContract, HeadCouncil)
│   ├── persistence/       # PostgreSQL 17 / pg 쿼리, 서비스 및 마이그레이션
│   ├── authority/         # 보안 매트릭스 및 AuthorizedEffectExecutor
│   ├── evidence/          # SHA-256 증거 번들 생성 및 무결성 검증
│   ├── agent-runtime/     # Maestro 소유 provider-neutral runtime 및 Tool loop
│   ├── model-provider-openai/ # OpenAI API key 및 Codex app-server adapter
│   ├── model-provider-anthropic/ # Anthropic API key adapter
│   ├── environment-adapter/      # Environment 및 browser 경계
│   ├── device-agent/      # Device protocol 및 grant 검증
│   ├── agent-runtime/     # 네이티브 실행 runtime
│   ├── git-adapter/       # Git 워크트리, 브랜치 및 커밋 실행기
│   └── api-client/        # 타입 안전 API 클라이언트 라이브러리
```

---

## 2. 필수 요구사항 (Prerequisites)

* **Node.js**: `v24.x LTS` 이상
* **npm**: `v10.x` 이상
* **PostgreSQL**: `17.x` (통합 테스트 실행 시 필요)
* **Docker**: disposable PostgreSQL 인스턴스를 시작할 때 선택적으로 사용합니다. 테스트는 `MAESTRO_TEST_DATABASE_URL`을 직접 사용하며 저장소에 Testcontainers 의존성은 없습니다.
* **OS**: Docker/PostgreSQL 및 프로세스 통합 테스트에는 Linux를 권장합니다. 네이티브 runtime은 인증된 Model Gateway로 provider를 격리합니다.

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
TypeScript 빌드와 모든 Vitest 테스트를 순차 실행합니다. 린트는 별도 명령입니다:
```bash
npm run check
npm run lint
```

### 4) PostgreSQL 통합 테스트
로컬 PostgreSQL 테스트 컨테이너 환경에서 통합 테스트를 수행합니다:
```bash
MAESTRO_TEST_DATABASE_URL=postgresql://maestro_test:maestro_test@127.0.0.1:55432/maestro_test npm test
```


### 5) CI와 동일한 PostgreSQL 실행
GitHub Actions는 정적 검사와 깨끗한 PostgreSQL 17 service job을 실행합니다. 병렬 schema race 없이 DB job을 로컬에서 재현하려면 다음을 사용합니다.
```bash
MAESTRO_TEST_DATABASE_URL=postgresql://maestro_test:maestro_test@127.0.0.1:55432/maestro_test npm test -- --pool forks --maxWorkers 1
```

### 6) 현재 TUI 및 runtime 경계
CLI TUI는 `@earendil-works/pi-tui` `0.85.1`을 터미널 렌더링, 입력, overlay 및 scrolling에 사용합니다. 실행 권한이 없으며 PostgreSQL이나 provider credential을 직접 쓰지 않습니다. 모든 실행 요청은 인증된 Control Plane과 native runtime을 통과합니다. Phase 1에서는 이 경계를 고정하고, Phase 3에서는 cursor 보존 재연결과 명시적 실패 상태를 포함한 CLI/App parity의 일부로 TUI를 승인합니다.

---



### Ensemble Router 구현 경계

A/D/E, B provider facts, C operational overlay와 순수 Goal snapshot, 4개 pressure band의 domain/wire artifact contract가 있습니다. Migration [`0072_ensemble_router_artifacts.sql`](../../packages/persistence/migrations/0072_ensemble_router_artifacts.sql)과 [`ensemble-router-artifacts.ts`](../../packages/persistence/src/ensemble-router-artifacts.ts)가 durable overlay/Goal snapshot 및 append-only routing evidence storage를 제공합니다. Domain `model_map` validator와 빈 human-owned `config/model_map.json` baseline도 있습니다. Router selection, fixed-model pin migration, host-tool write/effect 및 live acceptance는 남아 있습니다. Migration 전에는 `MAESTRO_NATIVE_MODEL`과 singleton `modelPolicy`를 automatic routing으로 설명하지 마세요. 이는 명시적 fixed-model/admission 경계입니다.
## 4. CLI 도구 사용법 (CLI Usage)

Maestro CLI (`apps/cli`)는 제어 평면 HTTP REST API와 완전한 기능적 패리티를 제공합니다.

```bash
# Goal 상세 조회
node apps/cli/dist/main.js goal get --project-id <projectId> --goal-id <goalId>

# 도메인 이벤트 목록 조회
node apps/cli/dist/main.js events list --project-id <projectId>

# Metronome 챌린지 조회
node apps/cli/dist/main.js metronome challenge <challengeId>

# Encore Council 심의 라운드 조회
node apps/cli/dist/main.js council round <roundId>

# Quality 인증서 조회
node apps/cli/dist/main.js certification get <certificationId>

# Concertmaster 최종 리포트 조회
node apps/cli/dist/main.js report get <goalId>
```

---

## 5. Runtime·tool·permission 경계

현재 production 동작은 다음과 같습니다:

- Control Plane은 인증된 route, PostgreSQL lease/fencing, project role, capability grant 및 idempotency를 소유합니다. gateway 또는 구체적인 effect adapter가 없으면 fail-closed입니다.
- Model Gateway만 provider credential, account admission, model identity, cancellation 및 managed login을 소유합니다.
- Native `ToolRegistry`는 등록된 도구의 이름·입력·출력 schema와 grant/data class를 검증하지만, production composition에는 현재 host tool이 **0개** 등록되어 있습니다. 미등록 도구는 거부됩니다.
- OpenAI Codex app-server adapter는 tool-bearing turn을 거부하고 read-only sandbox/no-approval로 동작합니다. 현재 native Worker는 제한된 text generation 경계입니다.
- Git adapter는 `AuthorizedEffectExecutor`를 통과하는 명시적 Control Plane Git 작업을 제공합니다. remote push와 critical effect는 별도 승인과 구체적 adapter가 필요합니다.
- CLI/TUI와 Secretary는 API client일 뿐 PostgreSQL, provider, gateway credential 또는 device transport에 직접 연결하지 않습니다.

도구·권한·파일시스템 범위·네트워크 범위를 문서화하려면 먼저 이름 있는 계약, action 분류, 구체적 adapter 및 실제 gateway/process acceptance가 필요합니다.

## 6. Phase 4 프로세스 경계

`apps/device-agent`는 별도 실행되는 mTLS 프로세스입니다. `MAESTRO_DEVICE_AGENT_CONFIG` JSON에 `databaseUrl`, `host`, `port`, `deviceId`, `identityFingerprint`, `issuerKeyId`, `issuerPublicKey`, `keyPath`, `certPath`, `caPath`, `statePath`, `projectRoot`가 필요하며 `maxReadBytes`는 선택 사항입니다. 등록된 device와 인증서 fingerprint가 일치해야 하고, `projectRoot` 아래의 제한된 파일 읽기만 signed Goal/grant/fencing 검증 후 수행합니다. Provider credential은 소유하지 않습니다.

`apps/discord`에는 `DISCORD_BUFFER_PATH`, `DISCORD_CREDENTIAL`이 필요합니다. `DISCORD_FLUSH_INTERVAL_MS`, `DISCORD_FRESHNESS_WINDOW_MS`는 기본값을 가지며 `DISCORD_TARGET_API_URL`, `DISCORD_TARGET_API_TOKEN`은 인증된 Control Plane 전송 시 선택적으로 설정합니다. 자세한 실행 예시는 각 앱 README를 참조하세요.

## 7. 운영 프로토콜 요약 (Operating Protocol Summary)

코드베이스 작업 시 운영 프로토콜 (`docs/OPERATING_PROTOCOL.md`)을 엄격히 준수해야 합니다:

1. **단일 브랜치 위생**: `main`이 유일하게 지속되는 브랜치입니다. 워크트리(`.worktrees/`) 및 기능 브랜치는 영구 유지하지 않고 병합 후 즉시 삭제합니다.
2. **Node Modules 심볼릭 링크**: 워크트리 생성 시 루트 `node_modules`를 심볼릭 링크(`ln -s ../../node_modules .worktrees/<slug>/node_modules`)하여 디스크 및 빌드 시간을 절약합니다.
3. **일회용 컨테이너 정제**: 테스트용 PostgreSQL 컨테이너는 슬러그명(e.g., `maestro-<slug>-postgres`)으로 생성하고 검증 직후 정제(`docker rm -f`)합니다.
4. **독립 검증 필수**: 에이전트가 작성한 코드는 `main`에 병합되기 전 반드시 독립적인(No-edit) 리뷰어를 통해 승인되어야 합니다.
