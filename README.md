# 수학의힘외대HS 메신저 MVP

수학의힘외대HS 학원 전용 메신저 플랫폼의 첫 구현본입니다.
현재 버전은 `Supabase + 정적 프론트엔드` 기반으로 바로 띄워볼 수 있는 MVP이며, 다음 기능을 포함합니다.

## 포함 기능

- 이메일/비밀번호 로그인
- 채널 목록 조회
- 채널별 메시지 조회
- 메시지 전송
- 스레드 답글
- `@이름` 멘션 저장
- 읽음 확인 upsert
- 온라인/오프라인 프레전스 갱신
- 파일 업로드 후 공개 URL 저장
- 멤버 목록 및 상태 표시
- 메시지 검색

## 파일 구성

- `index.html`: 앱 레이아웃
- `styles.css`: 브랜딩 중심 UI 스타일
- `app.js`: Supabase 연동 로직
- `schema.sql`: Supabase 테이블/RLS 정책 예시

## 실행 방법

1. Supabase 프로젝트를 생성합니다.
2. `schema.sql`을 SQL Editor에서 실행합니다.
3. Storage 버킷 `messenger-files`를 public 으로 생성합니다.
4. `profiles`, `messenger_channels`, `messenger_channel_members`에 기본 데이터를 넣습니다.
5. 브라우저에서 `index.html`을 열고 다음 값을 입력합니다.
   - Supabase URL
   - Supabase anon key
   - 로그인 이메일/비밀번호

## 권장 초기 데이터

### 채널

- 공지사항
- 외대HS 1반
- 외대HS 2반
- 강사진
- 운영팀

### 프로필 role 예시

- admin
- teacher
- student
- staff

## 구현 가정

- PDF 원문 전체를 자동 추출할 수 없는 환경이라, 사용자가 제공한 API 패턴과 메신저 메타프롬프트 제목을 기준으로 MVP 범위를 복원했습니다.
- 프로필 테이블 이름은 `profiles` 로 가정했습니다.
- 멘션 문법은 `@사용자이름` 으로 가정했습니다.
- 파일 업로드 URL은 `messenger_messages.attachment_url` 에 저장되도록 설계했습니다.

## 다음 확장 후보

1. 반별 권한 분리와 관리자 콘솔
2. 안 읽은 메시지 배지와 멘션 알림함
3. 공지 pin, 일정, 상담 예약 연동
4. 학부모/학생/강사 권한별 화면 분기
