---
name: jobkit
description: >-
  한국 채용 시장용 구직 명령 센터 -- 공고 평가, 자기소개서·경력기술서 작성,
  이력서 생성, 공고 수집, 지원 현황 추적. 사용자가 채용 공고 URL이나 공고
  본문을 붙여넣거나, 공고를 모아달라고 하거나, 이력서·PDF를 만들어달라고
  하거나, 자소서 문항에 답해야 하거나, 지원 현황을 정리하거나, 면접을
  준비하거나, jobkit 모드를 실행해달라고 할 때 사용한다.
arguments: mode
user_invocable: true
user-invocable: true
argument-hint: "[gonggo | jiwon | jasoseo | gyeongryeok | scan | discover | deep | pdf | text | latex | latex-tex | cover | email | add | expand | oferta | ofertas | apply | batch | tracker | agent-inbox | pipeline | contacto | training | project | interview-prep | interview | interview/plan | interview/practice | interview/debrief | interview-redflag | patterns | offer-prep | titles | upskill | followup | reply-watch | outcome | update]"
license: MIT
---

# jobkit-kr -- Router

jobkit-kr is a Korean-market job-search command center, forked from career-ops. The routing below is shared across supported agent CLIs even when the invocation surface differs.

**기본 시장은 한국이다.** `config/profile.yml`에 `language` 블록이 없으면
`language.output: ko`, `language.modes_dir: modes/ko`로 간주하고 한국어 모드를
읽는다. 영어권 공고를 주로 본다면 후보자가 profile.yml에서 이 값을 바꾼다.

## Project Root Resolution

Before reading any repo-relative path, derive `PROJECT_ROOT` from this loaded `SKILL.md`: start at the skill file's directory and walk upward until the nearest directory containing both `AGENTS.md` and `modes/`. Resolve every path in this router (`modes/`, `config/`, `data/`, scripts, templates, and output paths) against `PROJECT_ROOT`, never against the process's current working directory. This is required even when the checkout itself is nested (for example `Development\\career-ops`) or the command starts from a subdirectory. If those two sentinels cannot be found, stop and locate the jobkit-kr checkout before reading or writing files.

## Invocation Notes

- CLIs with slash-command registration can expose this router as `/jobkit`.
- In Cursor, this skill lives at `.cursor/skills/jobkit/` and is auto-discovered; ask for a mode by name, or paste a JD/URL to trigger auto-pipeline.
- Interactive Codex sessions use `codex` in the repo root. Slash commands are not guaranteed in Codex, so ask Codex to run the same mode by name if `/jobkit` is unavailable.
- Headless Codex workers use `codex exec "prompt"`.
- The routing semantics below stay the same regardless of whether the entrypoint is a slash command or a natural-language prompt.

Codex prompt examples that map to the same router semantics:

```text
Evaluate this JD with the jobkit auto-pipeline: https://company.com/jobs/123
Run the jobkit scan mode and summarize new matches.
Run the jobkit pipeline mode for data/pipeline.md.
Run the jobkit pdf mode for the latest evaluated role.
Run the jobkit tracker mode and summarize the current statuses.
```

## Mode Routing

Determine the mode from `$mode`:

| Input | Mode |
|-------|------|
| (empty / no args) | `discovery` -- Show command menu |
| JD text or URL (no sub-command) | **`auto-pipeline`** |
| `gonggo` / `공고` | `ko/gonggo` -- 공고 전체 평가 (블록 A-G) |
| `jiwon` / `지원` | `ko/jiwon` -- 지원 폼 작성 보조 |
| `jasoseo` / `자소서` / `자기소개서` | `ko/jasoseo` -- 자소서 문항별 답변 초안 |
| `gyeongryeok` / `경력기술서` | `ko/gyeongryeok` -- 경력기술서 작성 |
| `oferta` | `oferta` |
| `ofertas` | `ofertas` |
| `contacto` | `contacto` |
| `deep` | `deep` |
| `interview-prep` | `interview-prep` |
| `interview` | `interview` |
| `eu-swe` | `regional/eu-swe` |
| `eu-fintech` | `regional/eu-fintech` |
| `interview/plan` | `interview/plan` |
| `interview/practice` | `interview/practice` |
| `interview/debrief` | `interview/debrief` |
| `pdf` | `pdf` |
| `text` | `text` |
| `latex` | `latex` |
| `latex-tex` | `latex-tex` |
| `email` | `email` |
| `add` | `add` |
| `expand` | `expand` |
| `training` | `training` |
| `project` | `project` |
| `tracker` | `tracker` |
| `agent-inbox` | `agent-inbox` |
| `inbox` | `agent-inbox` |
| `pipeline` | `pipeline` |
| `apply` | `apply` |
| `scan` | `scan` |
| `discover` | `discover` |
| `batch` | `batch` |
| `patterns` | `patterns` |
| `offer-prep` | `offer-prep` |
| `titles` | `titles` |
| `upskill` | `upskill` |
| `followup` | `followup` |
| `reply-watch` | `reply-watch` |
| `outcome` | `outcome` |
| `interview-redflag` | `interview-redflag` |
| `update` | `update` |
| `cover` | `cover` |

**Auto-pipeline detection:** If `$mode` is not a known sub-command AND contains JD text (keywords: "responsibilities", "requirements", "qualifications", "about the role", "we're looking for", company name + role) or a URL to a JD, execute `auto-pipeline`.

If `$mode` is not a sub-command AND doesn't look like a JD, show discovery.

---

## Output Language Directive

Before executing any mode, read `config/profile.yml` if it exists and resolve:

- `language.output` → ISO language code for human-facing output. **Default in this fork: `ko`.**
- `language.modes_dir` → optional market-mode directory. This controls market vocabulary and local evaluation rules only. **Default in this fork: `modes/ko`.**

Inject this directive after loading the mode instructions and before producing any user-visible content:

> Write all human-facing output in `{language.output}` regardless of the language of these instructions or of the job description. This includes reports, tracker notes, PDFs, cover letters, outreach, interview prep, form answers, and summaries. If `language.modes_dir` supplies market-specific vocabulary, keep the market logic but explain terms in `{language.output}` when needed.

`language.output` is authoritative for prose. `modes_dir` is market context; it must not force the prose language.

---

## Discovery Mode (no arguments)

If your CLI supports `/jobkit`, show this menu. In Codex, surface the same options in plain text and map the requested mode the same way.

Concrete equivalents for Codex prompt-driven sessions:

```text
/jobkit {JD}           ↔ "Evaluate this JD with the jobkit auto-pipeline: {JD or URL}"
/jobkit scan           ↔ "Run the jobkit scan mode and summarize new matches."
/jobkit pipeline       ↔ "Run the jobkit pipeline mode for data/pipeline.md."
/jobkit pdf            ↔ "Run the jobkit pdf mode for the latest evaluated role."
/jobkit email          ↔ "Run the jobkit email mode for the latest evaluated role."
/jobkit tracker        ↔ "Run the jobkit tracker mode and summarize the current statuses."
```

Show this menu:

```
jobkit-kr -- 한국 구직 명령 센터

Available commands:
  /jobkit {JD}      → AUTO-PIPELINE: evaluate + report + PDF + tracker (paste text or URL)
  /jobkit pipeline  → Process pending URLs from inbox (data/pipeline.md)
  /jobkit gonggo    → 공고 평가 A-G (한국 법제 반영, PDF 자동 생성 없음)
  /jobkit jasoseo   → 자기소개서 문항별 초안 (글자수 계산 포함)
  /jobkit gyeongryeok → 경력기술서 (프로젝트별 역할·성과)
  /jobkit oferta    → Evaluation only A-G (no auto PDF)
  /jobkit ofertas   → Compare and rank multiple offers
  /jobkit contacto  → LinkedIn power move: find contacts + draft message
  /jobkit deep      → Deep research prompt about company
  /jobkit interview-prep → Generate company-specific interview prep doc
  /jobkit interview    → Interactive profile/CV onboarding interview
  /jobkit eu-swe    → Calibrate a European SWE application before CV/apply/interview
  /jobkit eu-fintech → Scan 21 EU fintech portals for Product Manager roles (zero-token)
  /jobkit interview/plan → Time-blocked prep plan for an upcoming interview
  /jobkit interview/practice → Practice interview, one question at a time with feedback
  /jobkit interview/debrief → Post-interview debrief: close gaps, predict next round
  /jobkit pdf       → PDF only, ATS-optimized CV
  /jobkit text      → Tailored markdown CV (mirrors cv.md, no PDF)
  /jobkit latex     → Export CV as LaTeX/Overleaf .tex
  /jobkit latex-tex → Tailor your own resume.tex in place (opt-in; cv.md stays default)
  /jobkit cover     → Cover letter: standalone JD paste or /jobkit cover {slug}
  /jobkit email     → Formal application email draft (draft-only; never sends, submits, or clicks)
  /jobkit add       → Add a project/paper/role to your CV (fetch + preview + confirm)
  /jobkit expand    → Auto-discover and add missing competencies from profile links
  /jobkit training  → Evaluate course/cert against North Star
  /jobkit project   → Evaluate portfolio project idea
  /jobkit tracker   → Application status overview
  /jobkit agent-inbox → Queue/drain requests for the next session (data/agent-inbox.md)
  /jobkit apply     → Live application assistant (reads form + generates answers)
  /jobkit scan      → Scan portals and discover new offers
  /jobkit discover  → Resolve a company list to scannable ATS boards + append to portals.yml (zero-token)
  /jobkit batch     → Batch processing with parallel workers
  /jobkit patterns  → Analyze rejection patterns and improve targeting
  /jobkit offer-prep → Read a received offer/contract with the candidate: clause walk + lawyer questions (not legal advice)
  /jobkit titles    → Suggest adjacent job titles from your CV to broaden the search
  /jobkit upskill   → Aggregate skill-gap analysis from your evaluated reports
  /jobkit followup  → Follow-up cadence tracker: flag overdue, generate drafts
  /jobkit outcome   → Record application outcome & archive artifacts
  /jobkit update    → Update career-ops system files with diff preview + compat check

Inbox: add URLs to data/pipeline.md → /jobkit pipeline
Or paste a JD directly to run the full pipeline.
```

---

## Context Loading by Mode

After determining the mode, load the necessary files before executing:

If `modes/_custom.md` exists, read it after `modes/_profile.md` and before the selected mode file. It contains user house rules and procedural preferences. It may override workflow/style defaults, but it never adds factual claims about the candidate.

### Modes that require `_shared.md` + their mode file

Read `modes/_shared.md` + `modes/_profile.md` (if exists) + `modes/_custom.md` (if exists) + `modes/{mode}.md`

Applies to: `auto-pipeline`, `oferta`, `ofertas`, `pdf`, `text`, `contacto`, `apply`, `pipeline`, `scan`, `batch`

### 한국어 모드 (`modes/ko/`)

Read `modes/ko/_shared.md` + `modes/_profile.md` (if exists) + `modes/_custom.md` (if exists) + `modes/ko/{mode}.md`

Applies to: `ko/gonggo`, `ko/jiwon`, `ko/jasoseo`, `ko/gyeongryeok`, `ko/pipeline`

한국어 모드는 영문 `modes/_shared.md`가 아니라 `modes/ko/_shared.md`를 읽는다.
한국 채용 시장의 보상·계약 조건(정규직·계약직·수습기간·포괄임금제·퇴직금·
4대 보험·성과급·스톡옵션)이 그 파일에 들어 있다.

`ko/`에 해당 모드가 없으면 영문 모드로 내려가되, 산출물 언어는
`language.output`을 따른다.

### Standalone modes with profile and custom context

Read `modes/_profile.md` (if exists) + `modes/_custom.md` (if exists) + `modes/{mode}.md`

Applies to: `tracker`, `agent-inbox`, `deep`, `interview-prep`, `interview`, `regional/eu-swe`, `interview/plan`, `interview/practice`, `interview/debrief`, `latex`, `latex-tex`, `training`, `project`, `patterns`, `titles`, `upskill`, `followup`, `reply-watch`, `outcome`, `cover`, `email`, `add`, `offer-prep`, `discover`

### Modes delegated to subagent

For `scan`, `apply` (with Playwright), and `pipeline` (3+ URLs): launch as a worker/subagent with the content of `_shared.md` + `_profile.md` (if exists) + `_custom.md` (if exists) + `modes/{mode}.md` injected into the worker prompt. If your CLI exposes an `Agent(...)` primitive, the call looks like this:

```python
Agent(
  subagent_type="general-purpose",
  prompt="[output language directive]\n\n[content of modes/_shared.md]\n\n[content of modes/_profile.md if exists]\n\n[content of modes/_custom.md if exists]\n\n[content of modes/{mode}.md]\n\n[invocation-specific data]",
  description="career-ops {mode}"
)
```

Execute the instructions from the loaded mode file.
