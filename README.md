# ICN Flight Board

인천국제공항공사 **항공기 운항 현황 상세 조회** API로 만든 출발/도착 전광판 웹앱입니다. 별도 프레임워크나 빌드 도구 없이 GitHub에서 Vercel로 배포할 수 있습니다.

## 기능

- 출발/도착 전환, 날짜별 조회 (API 제공 범위 D-3~D+6)
- 항공편명, 항공사, 도시, 공항코드 검색
- 터미널과 운항 상태 필터
- 예정 시각, 변경 시각, 게이트, 운항 상태 표기
- 항공편 상세 화면: 출발 시 체크인 카운터, 도착 시 출구와 수하물 수취대
- 5분 간격 자동 갱신 및 수동 새로고침
- 모바일 대응, 키보드 탐색, 샘플 데이터 확인 모드

## 데이터 출처

https://www.data.go.kr/data/15140153/openapi.do

**주의:** 공공데이터포털 개발계정은 일 500회 호출 제한이 있습니다. 서버 응답은 Vercel CDN에서 5분 캐시합니다. 데이터 자체는 공항 운영 상황에 따라 바뀔 수 있으며 최종 확인은 항공사 또는 인천공항에서 해야 합니다.

## 배포 (GitHub + Vercel)

1. 공공데이터포털에서 위 API의 `활용신청`을 진행하고 **일반 인증키(Decoding)** 를 복사합니다.
2. 이 폴더 **안의 파일을 모두** GitHub 새 저장소의 최상위 경로에 올립니다. `index.html`, `style.css`, `script.js`, `api/flights.js`가 해당 위치에 있어야 합니다.
3. Vercel에서 새 프로젝트로 해당 저장소를 Import합니다.
4. `Framework Preset`은 **Other**, `Root Directory`는 **./** 로 설정합니다. Build Command, Output Directory는 지정할 필요가 없습니다.
5. `Environment Variables`에 `AIRPORT_API_KEY`를 생성하고 실제 발급받은 키를 Value에 입력합니다.
6. Deploy를 누르고 주소에 접속합니다. 코드를 바꾼 뒤 GitHub에 푸시하면 다시 배포됩니다.

**키를 GitHub에 올리지 마세요.** `.env.local`이나 인증키 문자열이 들어 있는 파일은 업로드하면 안 됩니다. 이 앱은 API 요청을 `api/flights.js` 서버 함수에서 처리하므로 브라우저에 비밀키가 노출되지 않습니다.

### API 키 없이 화면 미리 보기

배포 주소 뒤에 `?demo=1`을 붙입니다. 예를 들어 `https://사이트주소.vercel.app/?demo=1`입니다. 예시 데이터라고 명확히 표시되며 실제 운항 정보가 아닙니다.

### 직접 실행

HTML 디자인 확인은 로컬 정적 서버로 가능합니다. 실시간 데이터 요청은 Vercel 서버리스 환경에서 동작합니다.

```bash
python -m http.server 8080
```

브라우저에서 `http://localhost:8080/?demo=1`을 엽니다. API 단위 테스트는 `npm test`로 실행합니다.

## 파일 구조

```text
index.html          화면 구조
style.css           반응형 스타일
script.js           필터와 화면 동작
api/flights.js      API 프록시 (서버리스)
test/api.test.js    응답 정규화 및 오류 테스트
```

## 자주 발생하는 문제

- **API 키 없음**: Vercel 환경변수 `AIRPORT_API_KEY`를 등록하고 Redeploy하세요.
- **인증 오류**: 신청한 API와 인증키가 일치하는지 확인하세요. 일반 인증키(Decoding)를 권장합니다.
- **데이터 없음**: API는 조회일 기준 -3일부터 +6일까지만 제공합니다. 아직 승인되지 않은 미래 운항 스케줄은 없을 수 있습니다.
- **일부 결과만 표시**: API가 한 페이지 최대 수를 제한할 수 있으므로 화면에 표시되는 `조회 항공편 수 / 전체 항공편 수`를 확인하세요.
