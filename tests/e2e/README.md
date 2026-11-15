# P0 프로덕션 회귀 검사

이미 빌드한 게임의 디렉터리와 검수할 때 기록한 SHA-256 manifest를 입력한다. 스크립트가 해당 파일을 메모리에 읽고 검증한 뒤 격리된 브라우저의 `https://orbit-switch.test` 요청에 응답한다. 게임 서버, 외부 네트워크, 배포 계정은 필요 없다.

## 실행

검증 환경은 Node 24, Playwright 1.62.1, 설치된 Microsoft Edge다. 실행용 Playwright는 프로젝트 밖에 설치해도 된다. 예를 들어 PowerShell에서 다음과 같이 준비한다.

```powershell
$qaTools = Join-Path $env:TEMP 'orbit-switch-qa-tools'
npm install --prefix $qaTools playwright@1.62.1
$env:ORBIT_PLAYWRIGHT_MODULE = Join-Path $qaTools 'node_modules/playwright'
$env:ORBIT_BROWSER_CHANNEL = 'msedge'
node tests/e2e/p0-regression.mjs '../7-candidate/dist' fcd563147fec2b91bcd63937067aa366f734f59336868ee33951fe2a68bfc403
```

마지막 명령은 후보 빌드가 형제 worktree에 있는 경우다. 다른 위치에서는 첫 인자를 실제 빌드 경로로 바꾼다. Playwright와 브라우저 설치는 검사 전에 완료한다. 기본 Chromium 실행 환경은 `ORBIT_BROWSER_CHANNEL`을 생략할 수 있다.

## 확인하는 동작

- 360×800 화면에서 Canvas와 시작 버튼의 배치를 측정한다. 스페이스와 실제 포인터 입력 후 플레이어 색상의 Canvas 픽셀들로 논리 궤도 반지름을 측정한다.
- 초기 파일 로딩 후 컨텍스트를 오프라인으로 전환하고 모든 추가 요청을 거절한다. 첫 실패 후 실제 재도전 버튼을 20회 누르고, 매회 카운트다운·플레이·결과로 이어지는지 확인한다.
- 같은 페이지에서 대기 중인 RAF의 최댓값, 같은 프레임의 중복 콜백, 게임 스크립트의 이벤트 등록 수를 비교한다. 매번 첫 장애물에 충돌해 같은 기록이 나오므로 저장소 읽기는 시작 시 한 번과 각 결과당 한 번, 쓰기는 첫 최고 기록 한 번이 기대값이다.
- 연결을 복원해 새로고침 후 최고 기록을 읽는다. 별도 컨텍스트에서 손상 JSON, 저장소 접근 차단, 쓰기 예외를 재현하고 각 경우 결과와 다음 판의 기록을 확인한다.
- 격리한 브라우저의 두 탭을 전환해 실제 visibilitychange 관찰값을 기록한다. 숨김을 전달하지 않는 브라우저에서는 플레이 중인 새 프레임에 모의 이벤트를 보내 `RUNNING → PAUSED → PAUSED`를 검사하고 실제 탭 숨김을 미검증으로 표시한다. 계속하기로 재개한 뒤에는 별도로 310ms 프레임 공백을 만들어 안전 정지를 확인한다.

검사 중 기대값이 어긋나면 오류와 함께 종료한다. 마지막 JSON에는 관찰한 콜백·리스너·저장 호출 수, 실제 입력 결과, 콘솔 오류와 추가 요청, 브라우저 버전이 포함된다. 화면 크기는 브라우저 모의이며 게임 난이도와 재미에 대한 사람 평가는 별도다.
