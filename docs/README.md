# Maestro Documentation

Maestro는 **Prime Agent SDK** 기반의 **내구성 있는(Durable) 계층형 AI 오케스트레이션 시스템**입니다.  
본 문서는 Maestro의 시스템 아키텍처, 계층형 오케스트레이션 구조, 데이터 무결성 및 보안 모델을 체계적으로 설명합니다.

---

## 📚 목차 (Documentation Index)

### 1. 아키텍처 (Architecture)
* **[계층형 오케스트레이션 구조 (Hierarchical Orchestration)](file:///home/ubuntu/projects/ms/docs/architecture/orchestration.md)**
  * CEO ➔ Sane ➔ Overture Crew ➔ Department Heads ➔ Head Council ➔ Workers ➔ Overwatch / Certification 파이프라인
  * 조직 분립 및 영구 부서(Department)와 역할(Persona)
* **[내구성 제어 평면 및 복구 (Control Plane & Durability)](file:///home/ubuntu/projects/ms/docs/architecture/control-plane-and-durability.md)**
  * PostgreSQL 17 단일 신뢰 원천, 이벤트 소싱, Transactional Outbox
  * Monotonic Fencing Token Lease를 통한 유령 쓰기 방지 및 프로세스 재시작 복구(Reconciliation)
* **[보안 및 권한 모델 (Authority & Security)](file:///home/ubuntu/projects/ms/docs/architecture/authority-and-security.md)**
  * Fail-Closed & Default-Deny 원칙 (`AuthorizedEffectExecutor`)
  * 액션 분류(`ordinary`, `critical`, `forbidden`, `ambiguous`) 및 단일 승인(Single Confirmation)
  * 봉인 제출(Sealed Submission)과 SHA-256 불변 스냅샷 무결성

### 2. 로드맵 (Roadmap)
* **[단계별 로드맵 및 구현 현황 (Phases & Roadmap)](file:///home/ubuntu/projects/ms/docs/roadmap/phases.md)**
  * Phase 1 ~ Phase 8 핵심 마일스톤 및 완료 현황
  * Post-Phase 8 아이디어: Luthiery (동적 MCP 및 도구 제작 공방)

### 3. 개발자 가이드 (Guides)
* **[개발 환경 및 사용 가이드 (Developer Guide)](file:///home/ubuntu/projects/ms/docs/guides/developer-guide.md)**
  * 모노레포 패키지 구성, TypeScript 빌드, 테스트 실행, CLI 명령어
