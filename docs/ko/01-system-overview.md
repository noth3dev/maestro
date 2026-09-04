# 01. 시스템 개요 (System Overview)

## 1. 아키텍처 철학 (Architectural Philosophy)

Maestro는 단일 에이전트 루프 시스템의 근본적인 신뢰성 부족, 메모리 표류(Memory Drift), 권한 유출 문제를 해결하기 위해 설계되었습니다. 단일 프롬프트 루프에 의존하는 대신, Maestro는 엄격한 **권력 분립(Separation of Powers)**, **내구성 있는 영속성(Durable Persistence)**, **Fail-Closed 보안 게이트**를 갖춘 **기업 조직 모델**을 구현합니다.

```mermaid
flowchart TD
    subgraph UserLayer [Conductor / 사용자]
        CONDUCTOR[Conductor / 사용자<br/>• 자연어 목표 및 범위 정의<br/>• 단일 단행 승인 Single Launch Confirmation]
    end

    subgraph ControlPlaneLayer [Maestro 제어 평면 Control Plane]
        CONCERTMASTER[🎼 Concertmaster / 비서실<br/>• 목표 수신 및 라이프사이클 상태 머신 제어]
        OVERTURE[🎶 Overture Intake Crew<br/>• Conversation Lead • Architecture Analyst • Security Evaluator<br/>• task.md 작업 계약서 작성]
        DEPARTMENTS[👥 영구 부서장 Wake-on-Demand<br/>• Product • Tech • Intelligence • Assurance 그룹<br/>• Head Council 봉인 심의 Sealed Submissions]
    end

    subgraph ExecutionSecurityLayer [실행 및 보안 격리]
        WORKERS[🛠️ Scout & Execution 워커<br/>• Prime Agent 서브에이전트 세션<br/>• 격리된 Git Worktrees .worktrees/ ]
        EXECUTOR[🛡️ AuthorizedEffectExecutor<br/>• Default-Deny 기본 거부 & 액션 분류<br/>• Audit-Before-Effect DB 사전 감사 커밋<br/>• 단조 펜싱 토큰 리스 검증]
    end

    subgraph PersistenceOversightLayer [내구성 저장소 및 검증/자가개선]
        ENCORE[⏱️ Encore & Quality 인증<br/>• Metronome: 이벤트 스트림 실시간 무결성<br/>• Quality Dept: 독립적 테스트 수행 및 검증<br/>• 자가 검증 Self-Certify 금지]
        POSTGRES[(💾 PostgreSQL 17 Control Plane<br/>• 단일 운영 신뢰 원천 Single Source of Truth<br/>• Append-only 이벤트 로그 goal_events<br/>• 단조 펜싱 리스 goal_leases<br/>• 트랜잭셔널 아웃박스 & 멱등성)]
        ENCORE_LAB[👁️ Encore 자가 개선 연구소<br/>• 마일스톤 Improvement Digest 큐레이션<br/>• Replay / Synthetic Shadow 평가<br/>• 10축 페르소나 맞춤 적응]
    end

    CONDUCTOR -->|1. 자연어 목표 전달| CONCERTMASTER
    CONCERTMASTER -->|2. 분석 및 프레이밍| OVERTURE
    OVERTURE -->|3. task.md 해시| CONDUCTOR
    CONDUCTOR -->|4. 단일 실행 승인| DEPARTMENTS
    DEPARTMENTS -->|5. Mission Bundle 하사| WORKERS
    WORKERS -->|6. 도구 실행| EXECUTOR
    EXECUTOR -->|7. 사전 감사 로그| POSTGRES
    WORKERS -->|8. SHA-256 증거 번들| ENCORE
    ENCORE -->|9. 인증 상태 리포트| CONCERTMASTER
    ENCORE -.->|10. 마일스톤 실행 증거| ENCORE_LAB
    ENCORE_LAB -.->|11. Shadow/Replay 피드백| DEPARTMENTS
```

---

## 2. 핵심 설계 원칙 (Core Design Principles)

1. **내구성 있는 진실 우선 (Durable Truth First)**: PostgreSQL 17이 모든 도메인 애그리게이트, 이벤트 및 트랜잭셔널 아웃박스의 단일 신뢰 원천입니다. 메모리 내 상태는 비정규 프로젝션일 뿐입니다.
2. **권력 분립 (Separation of Powers)**: 실행 에이전트(Workers/Heads)는 자신의 작업 결과를 스스로 승인하거나 검증할 수 없습니다. 검증은 Quality 및 Encore (Metronome & Encore Council)에 의해 독립적으로 수행됩니다.
3. **Fail-Closed & Default-Deny 보안**: 모든 도구 호출 및 부작용(Side Effects)은 `AuthorizedEffectExecutor`를 통과해야 합니다. 분류되지 않거나 권한이 없거나 범위 밖의 액션은 즉시 거부됩니다.
4. **암호화적 감사 가능성 (Content-Addressed Auditability)**: 모든 입력, 계획, 의견서 및 결과물은 SHA-256 정규화 직렬화(`Sealed Submission`)를 사용하여 해시화되어 불변의 감사 이력을 보장합니다.
5. **투기적 재발명 금지 (No Speculative Re-invention)**: Maestro는 **Prime Agent SDK**의 기본 기능(세션 추적, 재귀적 서브에이전트 스폰, 도구 호출)을 기반으로 구축하되, 도메인 권한 및 통제는 제어 평면(Control Plane) 내에 유지합니다.
6. **증거 기반 자가 개선 (Shadow-First Self-Improvement & Evolution)**: 앙코르(Encore)가 마일스톤 실행 증거를 **Improvement Digest**로 큐레이션하여 Shadow/Replay 실행 모드에서 페르소나 10축, 역할 가이드라인 및 라우팅 템플릿을 피드백하고 최적화하되, 보안 권한이나 안전 경계를 임의 변경하지 못하도록 엄격히 격리합니다.

---

## 3. Prime Agent 경계 vs 제어 평면 (Control Plane)

Maestro는 실행 커널과 제어 평면 사이에 명확한 경계를 유지합니다:

| 책임 영역 | Prime Agent SDK (`packages/prime-adapter`) | Maestro 제어 평면 (`apps/control-plane`) |
| :--- | :--- | :--- |
| **모델 & 세션 관리** | 모델 세션 라이프사이클, 프롬프트 제출, 토큰 사용량, 서브에이전트 위임 | Goal 라이프사이클 상태 머신, 부서 할당, 예산 한도 |
| **도구 실행** | 네이티브 스킬 로딩, 도구 호출 디스패치, 환경 실행 | `AuthorizedEffectExecutor`를 통한 권한 검사 및 사전 감사 로그 |
| **영속성 & 진실** | 진단 로그, 원시 세션 트랜스크립트 | PostgreSQL 17 도메인 이벤트 로그(`goal_events`), 단조 리스 |
| **감시 & 품질** | 원시 에이전트 출력물 | Metronome 무결성 검증, Quality 독립 인증, Conductor 보고 |

---

## 4. 저장소 구조 개요 (Repository Layout Overview)

Maestro는 **npm workspaces** 기반의 모노레포 구조로 정리되어 있습니다:

* **`apps/control-plane`**: 내구성 있는 명령 및 실시간 상태 스트리밍을 위한 Fastify 5 REST & SSE 서버.
* **`apps/cli`**: 제어 평면 API와 완전한 기능적 패리티를 제공하는 명령줄 인터페이스.
* **`apps/secretary`**: 방사형 포트폴리오 그래프를 제공하는 Next.js 16 / React 19 웹 애플리케이션 (Concertmaster Office).
* **`apps/firefly`**: 인시던트 감지 및 시스템 상태 프로브를 위한 독립 외곽 Discord 데몬.
* **`packages/domain`**: 순수 TypeScript 도메인 모델 (Goal, TaskContract, HeadCouncil, DepartmentPlan).
* **`packages/contracts`**: 공통 Zod 스키마, HTTP REST 계약 및 SSE 이벤트 페이로드.
* **`packages/persistence`**: PostgreSQL 17 스키마 정의, Drizzle ORM 쿼리 및 마이그레이션.
* **`packages/authority`**: 권한 평가 엔진, 액션 분류 행렬 및 `AuthorizedEffectExecutor`.
* **`packages/evidence`**: SHA-256 증거 번들 생성기 및 암호화 검증.
* **`packages/prime-adapter`**: Prime Agent SDK 연동 전용 어댑터 및 포트.
* **`packages/git-adapter`**: 격리된 Git 워크트리 관리자, 브랜치 실행기 및 디프 수집기.
* **`packages/api-client`**: 타입 안전 HTTP 및 SSE 클라이언트 SDK.
