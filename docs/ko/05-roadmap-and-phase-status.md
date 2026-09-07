# 05. 단계별 로드맵 및 구현 현황 (Roadmap & Phase Status)

Maestro는 각 단계의 검증 증거가 완료되어야 다음 단계로 진입하는 엄격한 단계별(Phased) 릴리즈 모델을 따릅니다.

---

## 1. 단계별 로드맵 전체 현황 (Roadmap Matrix)

| 단계 | 명칭 | 코드 상태 | 검증 기준 및 운영 승인 게이트 |
| :--- | :--- | :---: | :--- |
| **Phase 1** | Technical Foundation & Durable Control Plane | **운영 게이트 1개(제품 결정) 대기** | REST/SSE, PostgreSQL 17 durability, fencing, 네이티브 runtime/provider gateway 경계, 실제 Worker acceptance 및 전체 suite 증거 완료. Production host-tool 계약은 제품 승인 대기 |
| **Phase 2** | Concertmaster Office Core & Hierarchical Execution | **구현 및 PostgreSQL 검증 완료** | Overture 접수, Task Contract, Head Council, Department Plans, Mission Bundle, native Worker admission 및 Git 격리 실행 |
| **Phase 3** | Encore, Certification & First Usable Release | **구현; 릴리스 게이트 대기** | Metronome loop, Encore, Quality 인증, 보고서, CLI/API parity 및 native process 증거 구현. TUI parity/reconnect와 host-tool 범위는 별도 게이트 |
| **Phase 4** | Isolated Environments, Devices & Discord Incidents | **구현; 독립 승인 대기** | Environment/browser/Discord 및 별도 실행 authenticated device-agent live gate 증거가 있음. 독립 review와 production deployment 승인은 남음 |
| **Phase 5** | Concurrent Goals & Portfolio Control | **활성 remediation/capacity 작업** | 프로젝트별 worker cap은 구현됨. Resource inventory, demand reservation 및 portfolio scheduling은 향후 작업 |
| **Phase 6** | Encore Learning & 10-Axis Adaptation | **Step 1 승인 완료** *(불변 다이제스트)* | Step 1: 프로젝트 전용·출처 바인딩 Improvement Digest. Step 2 이후(리플레이, 변경, 롤아웃, 적응, 프로젝트 간 승격)는 보류 |
| **Phase 7** | Full Concertmaster Office & Radial Control Surface | 예정 | Next.js 16 / React 19 웹 UI(Concertmaster Office), `@xyflow/react` 방사형 포트폴리오 대시보드 |
| **Phase 8** | Full-System Hardening & Release Certification | 예정 | 적대적 장애 주입, 보안 침투 감사, 지속 부하 검증 및 릴리즈 프리즈 |

### 네이티브 에이전트 백엔드 마이그레이션 — 현재 경계

Maestro 네이티브 런타임과 인증된 model gateway가 대화와 워커 실행을 모두 담당합니다. ChatGPT account-login recovery도 내구성 상태, fenced status/cancel 작업 및 metadata-only 저장을 포함하여 통합되었습니다. 네이티브 admission은 host context, immutable grant, 정확한 provider-qualified model policy, account binding 및 idempotency를 포함하며, 모든 native 호출 지점(Worker, Head, semantic review, Encore reviewer, team-lead helper)이 selected/actual 모델과 gateway binding identity를 append-only `native_execution_bindings` 테이블에 durable하게 기록합니다. 깨끗한 disposable 컨테이너에서 실행한 단일 worker 전체 real-PostgreSQL 재실행이 **162/162 파일, 1066/1066 테스트, 실패 0건**으로 통과했습니다(2026-09-08), kill/restart 복구, fencing, authority denial, loopback Model Gateway HTTP acceptance 테스트, 그리고 실제 Model Gateway를 사용하는 전체 Control Plane + PostgreSQL + Worker acceptance 테스트(`native-worker-acceptance.integration.test.ts`)를 포함합니다. 이 테스트를 만드는 과정에서 실제 wire-schema 결함(`limitsFor()`가 10분을 넘는 모든 Mission Bundle time ceiling에 대해 clamp되지 않은 per-call timeout을 보냄)도 발견해 수정했습니다. 남은 Phase 1 항목은 하나입니다: 실제 gateway 경로를 통한 production native host-tool 등록/집행 -- `ToolRegistry`는 fail-closed로 올바르게 구현되어 있지만 production에는 아직 등록된 Maestro-callback tool이 없고, OpenAI Codex adapter는 모든 세션을 read-only로 실행하므로 현재 native Worker는 텍스트 생성만 가능합니다.

CLI TUI는 `@earendil-works/pi-tui` `0.85.1` 터미널 primitive를 사용합니다. 이는 provider나 실행 권한이 없는 표현 계층 의존성입니다.

### TUI 단계 경계

TUI는 두 번째 Control Plane이 아니라 운영자 표시·명령 클라이언트입니다. 권위 있는 상태 조회와 명령 전송은 `@maestro/api-client` 및 인증된 Control Plane route를 통해서만 수행합니다. PostgreSQL, Model Gateway, provider API, device transport에 직접 연결하지 않습니다. 단계 승인에는 동일한 실제 Goal에 대한 API/TUI parity, SSE cursor 보존 재연결, 명시적인 loading/error/stale 상태 표시, terminal state와 로그에 credential·prompt·raw gateway binding·secret-bearing output이 없다는 증거가 필요합니다. 터미널 입력은 lease, fencing, capability grant, approval, idempotency를 우회할 수 없습니다.

### Phase 6 Step 1 — 승인된 경계

Phase 6 Step 1은 불변·프로젝트 전용 Improvement Digest slice로 승인되었습니다. 각 digest는 Goal과 프로젝트에 출처 바인딩되고, lease 권한과 멤버십 범위 조회로 보호되며, canonical content hash로 검증됩니다. 이 slice는 자동 변경, 리플레이, 롤아웃, persona 적응 또는 프로젝트 간 승격을 수행하지 않습니다. Phase 6 Step 2 이후는 별도 계획·구현·리뷰·승인 전까지 보류합니다.

---

## 2. 운영 사용성 감사 공지 (Operational Usability Audit)

> [!IMPORTANT]
> **운영 사용성 게이트 공지:**  
> 코드 및 PostgreSQL 증거는 릴리스 승인을 뜻하지 않습니다. Native conversation과 Worker는 실제 Model Gateway/PostgreSQL acceptance 및 restart/fencing 증거를 갖추었습니다. 남은 게이트는 production host-tool 제품 승인·구현, TUI parity/reconnect 증거, 별도 실행 authenticated device-agent protocol의 독립 review/production 승인입니다(실제 process gate 자체는 구현됨). 상세 상태는 `plan/operations/task_plan.md`에 기록합니다.

---

## 3. Post-Phase 8 향후 확장 기능

### 1) Luthiery (동적 MCP 공방)

**Luthiery**(Phase 9 후보)는 작업 실행 중 필요한 전용 **Model Context Protocol (MCP)** 서버 및 도구를 런타임에 안전하게 생성, 감사, 실행, 재사용할 수 있는 공방 모듈입니다 ([`plan/post-phase8-ideas.md`](../../plan/post-phase8-ideas.md)).

```mermaid
flowchart LR
    TASK[특수 도구 필요] --> LUTHIERY[Luthiery 공방]
    LUTHIERY --> GEN[MCP Server 코드 생성]
    GEN --> AST[AST 분석: AuthorizedEffectExecutor 강제]
    AST --> SEC{보안 검증 통과?}
    SEC -->|No| REJECT[SecurityBypassAttemptError 거부]
    SEC -->|Yes| RUN[Task 샌드박스 실행 & SHA-256 레지스트리 저장]
```

#### Luthiery 핵심 원칙
1. **조직 분리**: **Operations / Infrastructure Group** 소속으로 배치하여 Encore의 자가 감사 이해상충을 방지.
2. **샌드박스 프로세스 바인딩**: 동적 MCP 데몬 프로세스 PID를 Goal 펜싱 토큰 리스에 바인딩 (만료 시 `SIGTERM` 자동 정제).
3. **AST 정적 분석 강제**: 생성된 모든 도구 핸들러 코드는 반드시 `AuthorizedEffectExecutor.execute()` 호출을 포함해야 함.
4. **콘텐츠 주소 재사용**: 검증된 MCP 도구 바이너리는 SHA-256 해시로 저장되어 향후 동일 태스크에서 즉시 재사용.

---

### 2) Autonomous Treasury & Real Capital Wallet (자율 재무부 지갑)

**Autonomous Treasury**(Phase 9/10 후보)는 Maestro 시스템에 영속적인 자율 지갑을 내장하여, 외부 API, 클라우드 컴퓨팅 자원, Web3 스마트 컨트랙트 결제를 직접 집행할 수 있는 자산 자율성을 부여합니다 ([`plan/post-phase8-ideas.md`](../../plan/post-phase8-ideas.md)).

#### Treasury 핵심 원칙
1. **사용자 충전식 예치금 모델**: Conductor(사용자)가 미리 충전한 예치금(Web3 암호화폐 USDC/ETH/Solana 및 Stripe/Plaid 전통 금융 결제) 기반 작동.
2. **재무부(Treasury Department) 소속**: **Operations / Finance Group (Treasury Department)** 관할 하에 Head Council 기획 시 태스크별 Spending Ceiling 할당.
3. **자율 집행 및 옵션 2단계 승인**: 승인 예산 범위 내 지출은 `payment.spend` 액션으로 자율 집행되며, 고액 지출 시 Conductor 사전 승인 2-step 락 설정 가능.
4. **Audit-Before-Spend & Metronome 실시간 감시**: 결제 전 트랜잭션 의도 및 복식부기 영수증을 PostgreSQL에 먼저 기록하며, **Metronome**이 이상 지출 속도를 실시간 모니터링.
