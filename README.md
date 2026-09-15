# jobkit-kr

한국에서 이직·취업을 준비하는 사람이 쓰라고 만든 구직 파이프라인이다.
[career-ops](https://github.com/santifer/career-ops)를 포크해서 한국 채용 시장에
맞게 고쳤다.

원본은 Greenhouse·Lever·Workday·Ashby 같은 서구권 채용 시스템 90여 곳을 읽는다.
대만, 베트남, 싱가포르, 폴란드, 독일까지 들어 있는데 한국만 비어 있었다.
이 포크는 그 자리를 채운다.

## 무엇이 다른가

| 구분 | 원본 career-ops | jobkit-kr |
|---|---|---|
| 한국 공고 수집 | 없음 | 원티드·점핏 (공개 API, 인증 불필요) |
| 한국 서류 | 커버레터만 | 자기소개서(문항별·글자수)·경력기술서 |
| 기본 설정 | 미국·유럽 기준 2,700줄 | 한국 기준 한 파일 |
| 필터 | 영문 직무명 | 한국 공고 제목·근무지 표기 그대로 |

## 이 도구가 하지 않는 것

| 항목 | 내용 |
|---|---|
| 자동 지원 | <!-- hitl: absolute guarantee. Do not add "automatically", "by itself", "without your permission" or any other hedge — this is an absolute prohibition, not a default setting. --> 지원서를 대신 제출하지 않는다 (never submits an application). 초안까지만 만들고, 제출 버튼은 사람이 누른다 |
| 경력 생성 | 이력서에 없는 경력·수치·기간·자격증을 만들지 않는다 |
| 합격 예측 | 합격률이나 서류 통과 가능성을 숫자로 말하지 않는다 |

이건 설정으로 끌 수 있는 기본값이 아니라 규칙이다. 자소서·경력기술서 모드는
`cv.md`에 없는 내용을 만나면 지어내는 대신 사용자에게 되묻는다.

원본의 나머지 기능은 그대로 살아 있다. 공고를 내 이력서·기준과 대조해서
`일치 / 충돌 / 확인 필요`로 갈라주는 평가, 지원 현황 tracker, 이력서 PDF 생성,
지원서 작성 보조까지 원본 문서([README.upstream.md](README.upstream.md))가 설명하는
그대로 쓸 수 있다.

## 시작하기

### 먼저 있어야 하는 것 두 개

1. **Node.js 22 이상** — [nodejs.org](https://nodejs.org)에서 받는다. 터미널에
   `node -v`를 쳐서 `v22` 이상이 나오면 이미 있는 것이다.
2. **AI CLI 하나** — Claude Code, Codex, Cursor 중 아무거나. 공고를 모으는 것까지는
   CLI 없이 되지만, 공고를 이력서와 대조하고 서류를 쓰는 일은 CLI 안에서 한다.

터미널을 한 번도 안 써봤어도 된다. 아래 명령을 그대로 복사해 붙여넣으면 되고,
이 저장소에서 직접 치는 건 두 줄뿐이다.

### 설치

```bash
git clone https://github.com/dingcodingco/jobkit-kr.git
cd jobkit-kr
npm install

cp templates/portals.kr.example.yml portals.yml
cp config/profile.example.yml config/profile.yml
cp templates/cv.kr.example.md cv.md
```

마지막 줄은 **예시 이력서**다. 가상 인물의 경력이 들어 있어서 이대로 한 번 돌려보고
결과 모양을 확인한 다음 본인 경력으로 바꿀 수 있다.

### 내 것으로 바꿀 파일 세 개

| 파일 | 무엇을 적나 |
|---|---|
| `portals.yml` | `title_filter`에 **본인이 지원할 직무명**. 이걸 안 바꾸면 남의 기준으로 공고를 거른다 |
| `config/profile.yml` | 이름·지역·희망 연봉·목표 직무 |
| `cv.md` | 이력서. 파일이 없으면 새로 만든다. 경력·프로젝트·숫자를 적어두면 공고와 대조할 때 근거로 쓴다 |

`cv.md`가 "회사 / 기간 / 한 줄" 수준이면 경력기술서 모드가 초안 대신 질문을 낸다.
지어내지 않으려고 그렇게 만들었다.

### 이력서를 손으로 쓸 필요는 없다

가진 파일이 있으면 AI CLI에 그 파일을 열어둔 채 옮겨 달라고 하면 된다.

```
내 이력서 파일이야. 이걸 cv.md 형식으로 옮겨줘.
templates/cv.kr.example.md 구조를 그대로 따라줘.
없는 내용은 지어내지 말고 비워두고, 뭘 더 물어봐야 하는지 마지막에 목록으로 알려줘.
```

정리된 게 없으면 물어보게 시킨다.

```
이력서를 만들려고 해. 나한테 질문해서 cv.md를 채워줘.
한 번에 한 가지씩 물어보고, 내 대답에 숫자가 없으면 다시 물어봐.
```

**"없는 내용은 지어내지 말고"를 꼭 넣는다.** 안 넣으면 그럴듯한 숫자가 붙고, 그게
면접에서 그대로 질문으로 돌아온다.

### 더 넣어도 되는 파일 하나

공고를 보기 전에 본인 기준을 먼저 고정해 두고 싶으면 하나 더 복사한다. 없어도
도구는 돈다.

```bash
cp templates/criteria.kr.example.md data/나의_지원기준.md
```

`gonggo` 모드가 이 파일을 읽으면 공고 요건을 본인의 필수·선호·제외와 한 줄씩
대조해 준다. **도구는 이 파일을 고치지 않는다** — 공고에 맞춰 기준을 느슨하게
바꿔주는 것이 제일 해로운 일이라서 어긋난 사실만 적는다.

```bash
node verify-portals.mjs   # 보드가 살아 있는지 확인
node scan.mjs             # 공고 수집 → data/pipeline.md
```

## AI CLI에서 부르기

공고를 모으는 것까지는 위 명령으로 되고, **공고를 내 기준과 대조하고 서류를
쓰는 일은 AI CLI 안에서** 한다. 저장소를 연 상태로 CLI를 띄우면 스킬이 붙는다.

```
/jobkit gonggo          공고 하나를 내 이력서·기준과 대조 (블록 A-G)
/jobkit jasoseo         자기소개서 문항별 초안 + 글자수 계산
/jobkit gyeongryeok     경력기술서 (프로젝트별 역할·성과)
/jobkit jiwon           지원 폼 작성 보조 (제출은 사람이 한다)
/jobkit pipeline        모아둔 공고 URL을 한 번에 처리
/jobkit tracker         지원 현황 정리
```

Claude Code·Cursor처럼 슬래시 명령을 등록하는 CLI는 `/jobkit`을 그대로 쓴다.
**Codex는 슬래시 명령이 보장되지 않으므로** 같은 모드를 말로 부르면 된다
("jobkit gonggo 모드로 이 공고 평가해줘"). 헤드리스로 돌릴 때는
`codex exec "..."` 형태를 쓴다 (slash commands are not guaranteed in Codex — ask for the mode in plain language instead). CLI별 차이는 [docs/CODEX.md](docs/CODEX.md)와
[docs/SUPPORTED_CLIS.md](docs/SUPPORTED_CLIS.md)에 정리돼 있다.

산출물 언어는 `config/profile.yml`의 `language.output`이 정한다. 이 포크는
기본값이 `ko`다.

## 수집 대상

**원티드** (`provider: wanted`) — 국내 최대 테크·스타트업 보드.
필터 없는 전체 공고를 최신순으로 순회한다. 회사명·근무지·고용형태가 목록
응답에 함께 온다. 특정 직군만 보려면 `job_group_id`를 넣는다.

**점핏** (`provider: jumpit`) — 사람인이 운영하는 개발자 전용 보드.
목록 응답에 기술 스택이 함께 와서 "Kotlin 쓰는 곳만" 같은 조건이 바로 걸린다.
2026-09-14 기준 702건.

**사람인·잡코리아**는 공개 JSON API가 없어서 프로바이더로 붙이지 못했다.
`portals.yml`의 `search_queries`에서 `site:` 검색으로 훑거나, 카카오
[PlayMCP의 사람인 MCP](https://playmcp.kakao.com/mcp/119)를 붙여 쓴다.
검색 경로는 캐시된 과거 공고를 물고 오는 일이 잦으니 원문 URL을 반드시 다시
열어보고 마감 여부를 확인해야 한다.

## 한국 공고를 읽을 때 주의할 점

프로바이더를 쓰면서 실제로 데이터에 부딪힌 것들이다.

- **원티드의 `annual_from` / `annual_to`는 연봉이 아니라 경력 연차다.**
  연차(年次)가 payload에서 annual로 줄어 있다. 연봉으로 읽으면 "2"와 "7"이
  급여 필터에 들어가서 공고가 통째로 사라진다. 이 포크는 둘 다 급여로
  매핑하지 않는다.
- **원티드의 `reward`도 연봉이 아니다.** 추천인에게 주는 보상금이다.
- **점핏의 `closedAt`은 마감일이지 게시일이 아니다.** 최신순 정렬에 쓰면
  "곧 마감되는 공고"가 "방금 올라온 공고"로 둔갑한다. 두 보드 모두 게시일을
  안 주기 때문에 이 포크는 게시일을 비워둔다. 지어내지 않는다.
- **제목에 고용 형태가 섞여 있다.** "마케터 채용_계약직"처럼 제목 하나에
  직무와 형태가 같이 붙는다. `title_filter.negative`에 형태 키워드를 넣어두면
  걸러지는 양이 꽤 된다.

## 라이선스

MIT. 원저작권자는 Santiago Fernández de Valderrama이고 원문은 [LICENSE](LICENSE)에
그대로 있다. 포크 경위와 상표 관련 사항은 [NOTICE](NOTICE)를 보면 된다.
이 프로젝트는 career-ops 측이 만들거나 보증하거나 후원하지 않는다.
