# AI-Powered UI Test Automation

Config-driven end-to-end UI testing for the gold loan booking flow. Claude API interprets test rules and plans browser actions; Playwright executes them against the live site.

## What this repo does

- Reads all test steps from `config/test-rules.config.json` — no code changes when the UI changes slightly
- Uses Claude (`claude-sonnet-4-20250514`) to resolve selectors and validate assertions
- Runs the full booking flow: Login → Eligibility → Loan Details → Branch & Slot → KYC → Confirm → Success
- Tests error cases: wrong OTP, invalid PAN, below-minimum amount, oversized file upload
- Generates self-contained HTML reports with screenshots
- Runs on push to `main`, daily schedule, and manual trigger via GitHub Actions

## Prerequisites

- Node.js 20+
- Anthropic API key
- Test credentials for the target site

## Local setup

```bash
git clone <repo-url>
cd automated-testing

npm install
npx playwright install chromium

cp .env.example .env
# Edit .env with your API key and test credentials

# Update config/test-rules.config.json if needed (URLs, step labels)

npm test              # full suite (happy path + error cases)
npm run test:happy    # happy path only
npm run test:errors   # error cases only
npm run report        # open latest HTML report
```

## Environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `ANTHROPIC_API_KEY` | Yes | Claude API key |
| `BASE_URL` | Yes | Gold loan booking site base URL |
| `TEST_MOBILE` | Yes | Test phone number (fresh/takeover linear flows) |
| `TEST_MOBILE_FRESH` | Yes* | Fresh-loan mobile for state-management scenarios |
| `TEST_MOBILE_TAKEOVER` | Yes* | Takeover mobile for state-management scenarios |
| `INTERACTIVE_OTP` | No | If `true`, prompt for OTP at runtime in terminal (recommended locally) |
| `TEST_OTP` | No | OTP fallback when `INTERACTIVE_OTP=false` (e.g. CI with static OTP) |
| `TEST_PAN` | Yes | Valid test PAN |
| `TEST_PINCODE` | Yes | Serviceable 6-digit pincode |
| `SLACK_WEBHOOK_URL` | No | Slack webhook for failure alerts |
| `TEST_VARIANT` | No | `fresh`, `takeover`, or `state-management` (default: fresh) |
| `AUTO_HEAL` | No | Enable AI self-healing on failures (default: `true`; set `false` to disable) |
| `AUTO_HEAL_MAX_ATTEMPTS` | No | Max heal retries per action/assertion (default: `3`) |
| `HEADLESS` | No | Run browser headless (default: `true`; set `false` for local debugging) |

Never commit `.env`. Credentials in the rules config use `{{env.VAR_NAME}}` template syntax.

## GitHub Secrets

Set in **Settings → Secrets and variables → Actions**:

- `ANTHROPIC_API_KEY`
- `BASE_URL`
- `TEST_MOBILE`
- `TEST_OTP` (only if your env supports a static OTP)
- `SLACK_WEBHOOK_URL` (optional)

## Project structure

```
automated-testing/
├── config/test-rules.config.json   # Single source of truth for all test data
├── src/
│   ├── runner.ts                   # Main entry point
│   ├── flow-step.ts                # Flow step execution with self-heal loops
│   ├── healer.ts                   # Config backup, patch, heal session
│   ├── agent.ts                    # Claude API orchestration
│   ├── browser.ts                  # Playwright browser control
│   ├── reporter.ts                 # HTML report generator
│   ├── run-output.ts               # Per-run dated output folders
│   └── types.ts                    # TypeScript definitions
├── config/backups/                 # Auto-heal config backups (gitignored)
├── tests/fixtures/                 # Sample KYC documents for upload tests
├── reports/                        # Per-run folders (gitignored, see below)
├── mcp.config.json                 # MCP servers for IDE debugging
└── .github/workflows/test.yml      # CI/CD pipeline
```

## Updating tests

Test configs for Rupeek B2C LP2:

| File | Flow |
|------|------|
| [`config/test-rules-fresh.config.json`](config/test-rules-fresh.config.json) | Fresh loan — 12 steps |
| [`config/test-rules-takeover.config.json`](config/test-rules-takeover.config.json) | Takeover — 11 steps |
| [`config/test-rules-state-management.config.json`](config/test-rules-state-management.config.json) | Drop/resume, back navigation, reload — 10 scenarios |

```bash
npm run test:fresh              # fresh: happy + errors
npm run test:takeover           # takeover: happy + errors
npm run test:state-management   # state-management scenarios only
npm run test:state-management:all  # scenarios + regression error cases
npm run test:happy:fresh        # fresh happy path only
npm run test:happy:takeover     # takeover happy path only
npm run test:auto:fresh         # fresh happy path with self-healing enabled
npm run test:auto:takeover      # takeover happy path with self-healing enabled
npm run test:auto:state-management  # state-management with self-healing
```

**State-management suite notes:** Scenarios run in booking-stage order (back-nav → gold-weight → offer) on a single `TEST_MOBILE_FRESH`. The runner clears cookies and `sessionStorage` between scenarios; backend booking state still advances per mobile. If the first scenario deep-links to offer instead of loan-type, cancel/reset the fresh booking once before re-running. Config auto-patching is disabled for this variant — failures will not rewrite the JSON.

## Self-healing

When `AUTO_HEAL=true` (default), the runner automatically diagnoses failures using Claude + page screenshot/HTML and attempts recovery:

- **retry** — new selector or action value
- **skip_action** — redundant/harmful action (e.g. re-clicking an already-selected card)
- **wait_then_retry** — wait for async UI transitions
- **patch_config** — auto-edit the active flow step in config when confidence is high (with backup)

Config backups are saved to `config/backups/{variant}-{timestamp}.config.json`. A detailed heal log is written to `heal-log.json` inside each run folder and shown in the HTML report.

## Reports and screenshots

Each test run creates a dated folder under `reports/`:

```
reports/
  2026-05-31_01-03-45_fresh-happy/
    report.html
    result.json
    heal-log.json       # when self-healing ran
    screenshots/
      step-1-action-1.png
      ...
  latest/               # shortcut to most recent run
    report.html
    result.json
```

Open the latest report with `npm run report`.

Disable self-healing with `--no-auto-heal` or `AUTO_HEAL=false`:

```bash
npm run test:happy:fresh -- --no-auto-heal
HEADLESS=false npm run test:auto:fresh   # watch healing in browser
```

UI team handoff docs:

- [`docs/UI-TEST-CASE-HANDOFF.md`](docs/UI-TEST-CASE-HANDOFF.md) — format spec for UI team
- [`docs/B2C-LP2-DATA-TESTID-WORKSHEET.md`](docs/B2C-LP2-DATA-TESTID-WORKSHEET.md) — recommended test IDs
- [`docs/B2C-LP2-QA-CHECKLIST.md`](docs/B2C-LP2-QA-CHECKLIST.md) — QA sign-off before runs

To add a step, edit the appropriate config file `flow` array:

```json
{
  "step": 7,
  "name": "Post-booking: View loan status",
  "url": "/my-loans",
  "actions": [{ "type": "click", "label": "View loan button" }],
  "assertions": [
    { "type": "url_contains", "value": "/loan-status" },
    { "type": "element_visible", "label": "Loan status badge" }
  ]
}
```

To add an error case:

```json
{
  "name": "Expired session",
  "step": 1,
  "override": { "credentials.otp": "expired" },
  "expectedError": "Session expired"
}
```

## Security

- API keys and credentials must never be hardcoded in source files
- `reports/` is gitignored (may contain PII); each run folder includes its own screenshots
- Use GitHub Secrets for CI credentials

## Architecture note

The test runner uses Playwright directly for browser control (CI-compatible). The `mcp.config.json` file configures MCP servers for Claude Code / Cursor IDE debugging workflows.

## Exit codes

- `0` — all steps passed
- `1` — one or more steps failed (CI will block on failure)
