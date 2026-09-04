<p align="center">
  <a href="../../README.md">
    <img alt="Maestro" src="../assets/logo.svg" width="240" style="max-width: 100%;">
  </a>
</p>

# Maestro 문서 (Korean Documentation)

Maestro는 **Prime Agent SDK** 기반의 **내구성 있는(Durable) 계층형 AI 오케스트레이션 시스템**입니다.  
본 문서는 Maestro의 시스템 아키텍처, 계층형 오케스트레이션 구조, 내구성 제어 평면, 보안 모델, 단계별 로드맵 및 개발 가이드를 설명합니다.

---

## 📚 문서 목차 (Documentation Index)

### 1. [시스템 개요 (System Overview)](file:///home/ubuntu/projects/ms/docs/ko/01-system-overview.md)
* 아키텍처 철학, 핵심 설계 원칙, 권력 분립 및 모노레포 구조.
* Prime Agent SDK 경계 vs Maestro 제어 평면(Control Plane)의 역할 분담.

### 2. [계층형 오케스트레이션 (Hierarchical Orchestration)](file:///home/ubuntu/projects/ms/docs/ko/02-hierarchical-orchestration.md)
* 전체 실행 파이프라인: Conductor ➔ Concertmaster ➔ Overture Crew ➔ 부서장(Department Heads) ➔ Head Council ➔ 워커(Workers) ➔ Encore / 검증(Certification).
* 영구 그룹 및 부서 구조, 페르소나, 필요 시 깨어나는 Wake-on-Demand 매커니즘.

### 3. [내구성 제어 평면 및 장애 복구 (Durable Control Plane)](file:///home/ubuntu/projects/ms/docs/ko/03-durable-control-plane.md)
* PostgreSQL 17 단일 신뢰 원천, Drizzle ORM, Append-only 이벤트 로그(`goal_events`) 및 트랜잭셔널 아웃박스(Transactional Outbox).
* 단조 증가 펜싱 토큰 리스(`goal_leases`), Signed `bigint` 정밀도 처리, 멱등성 명령 처리(`Idempotency-Key`) 및 재시작 복구(Reconciliation).

### 4. [보안 및 권한 모델 (Security & Authority Model)](file:///home/ubuntu/projects/ms/docs/ko/04-security-and-authority-model.md)
* `AuthorizedEffectExecutor`에 의한 Fail-Closed 및 Default-Deny 기본 거부 원칙.
* 액션 분류 체계 (`ordinary`, `critical`, `forbidden`, `ambiguous`) 및 단일 실행 승인(Single Launch Confirmation).
* 봉인 제출(Sealed Submission) 프로토콜 및 SHA-256 불변 정규화 JSON 스냅샷.

### 5. [단계별 로드맵 및 구현 현황 (Roadmap & Phase Status)](file:///home/ubuntu/projects/ms/docs/ko/05-roadmap-and-phase-status.md)
* Phase 1 ~ Phase 8 핵심 마일스톤, 검증 코드 현황 및 실운영 승인 게이트.
* Post-Phase 8 확장: **Luthiery** (동적 MCP 공방) & **Autonomous Treasury** (자율 재무부 지갑).

### 6. [개발자 및 운영 가이드 (Developer & Operations Guide)](file:///home/ubuntu/projects/ms/docs/ko/06-developer-and-operations-guide.md)
* 모노레포 패키지 구성, Node.js 24 & TypeScript 개발 환경.
* 빌드 (`npm run build`), 테스트 (`npm test`), 전체 검증 (`npm run check`) 워크플로우.
* 실 PostgreSQL 통합 테스트, Live Prime Agent 연동, CLI 명령어 및 운영 프로토콜.
