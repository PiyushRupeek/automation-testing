# B2C LP2 Test Config — Frontend Claude Prompt

**Purpose:** Give this document (especially Section 2) to **frontend Claude AI** so it can generate or update JSON test configs for Rupeek B2C LP2. Output files go in the `automated-testing` repo under `config/`. No TypeScript changes are needed — only JSON.

**Canonical reference:** [`config/test-rules-fresh.config.json`](../config/test-rules-fresh.config.json)

**Note:** [`src/common/config/config.module.ts`](../src/common/config/config.module.ts) is NestJS `.env` loading only. Test steps live in `config/test-rules-*.config.json`, not in that module.

---

## 1. Copy-paste prompt for Claude

Paste the block below into Claude when working in the **customer-landing-pages** repo (or with live UI context). Attach or paste the current `test-rules-fresh.config.json` as a few-shot example.

```
You are generating test rule JSON for Rupeek B2C LP2 automated UI testing (automated-testing repo).

Output ONLY valid JSON — no markdown fences, no explanation.

Target files:
- Fresh flow → test-rules-fresh.config.json (set "flowVariant": "fresh")
- Takeover flow → test-rules-takeover.config.json (set "flowVariant": "takeover")

Rules:
1. Follow the schema in docs/B2C-LP2-CONFIG-GENERATOR-PROMPT.md
2. Use exact visible UI labels from the live app (button text, headings, placeholders)
3. Never hardcode secrets — use {{env.VAR}} and {{credentials.*}} / {{loanDetails.*}}
4. OTP step must use value "{{prompt.otp}}" (runtime prompt, not static OTP in JSON)
5. Match current LP2 routing: auth is a modal on /lp/b2c/2; fresh flow bypasses feature-preference and loan-summary
6. Prefer element_visible assertions when URL does not change (SPA auth modal)
7. Add "notes" on steps with non-obvious behavior (pre-selected cards, skipped screens, emergency slot fallback)
8. errorCases[].expectedError must be exact error copy from the UI

When updating an existing config, preserve step numbering and error case names unless the UI changed.
Reference: config/test-rules-fresh.config.json in automated-testing repo.
```

---

## 2. JSON schema (minimal)

### Top-level

| Field | Required | Description |
|-------|----------|-------------|
| `flowVariant` | yes | `"fresh"` or `"takeover"` |
| `site` | yes | `baseUrl`, `name`, `timeout` (ms) |
| `credentials` | yes | `mobile`, `otp`, `pan` — use templates |
| `loanDetails` | yes | `amount`, `goldWeight`, `purity`, `purpose`, optional `pincode` |
| `flow` | yes | Array of step objects (happy path) |
| `errorCases` | yes | Array of negative test cases |
| `schedule` | yes | Cron string (e.g. `"0 9 * * 1-5"`) |
| `notifications` | yes | `slackWebhook`, `email` |

### Step object

```json
{
  "step": 1,
  "name": "Landing — open auth",
  "url": "/lp/b2c/2",
  "actions": [
    { "type": "click", "label": "Get Started" }
  ],
  "assertions": [
    { "type": "element_visible", "label": "Enter Mobile Number" }
  ],
  "notes": "Optional — LP2 quirks for the automation runner"
}
```

### Action types

| `type` | Use for | Fields |
|--------|---------|--------|
| `click` | Buttons, cards, tabs | `label` |
| `fill` | Text inputs | `label`, `value` |
| `select` | Dropdowns | `label`, `value` |
| `upload` | File inputs | `label`, `file` |
| `check` / `uncheck` | Checkboxes | `label` |
| `navigate` | Direct URL jump | `value` (path or URL) |
| `reload` | Page reload | — |
| `clear_storage` | sessionStorage/localStorage | optional `target` |

### Assertion types

| `type` | Use for | Fields |
|--------|---------|--------|
| `element_visible` | Heading/text appears on page | `label` |
| `url_contains` | URL changed | `value` (path fragment) |
| `text_matches` | Regex on element text | `label`, `pattern` |
| `no_error_toast` | No error toast visible | — |

### Template variables

| Token | Resolves from |
|-------|----------------|
| `{{env.BASE_URL}}` | `.env` |
| `{{env.TEST_MOBILE}}`, `{{env.TEST_PAN}}`, `{{env.TEST_PINCODE}}` | `.env` |
| `{{env.SLACK_WEBHOOK_URL}}` | `.env` |
| `{{credentials.mobile}}`, `{{credentials.pan}}` | `credentials` block |
| `{{loanDetails.pincode}}`, `{{loanDetails.amount}}` | `loanDetails` block |
| `{{prompt.otp}}` | Runtime OTP prompt (step 3) |

### Error case object

```json
{
  "name": "Wrong OTP",
  "step": 3,
  "override": { "credentials.otp": "0000" },
  "expectedError": "Failed to verify OTP. Please try again."
}
```

Special overrides: `uncheckConsent: true`, `uploadFile: "tests/fixtures/..."`, `clearCookies: ["token"]`

---

## 3. Fresh flow map (12 steps — current LP2)

| Step | Name | Key assertion / URL | Notes |
|------|------|---------------------|-------|
| 1 | Landing — open auth | `Enter Mobile Number` | `url`: `/lp/b2c/2`, click Get Started |
| 2 | Auth — phone and consent | `Enter 4 Digit OTP` | Consent pre-checked — do not toggle checkbox |
| 3 | Auth — OTP | `Enter Pincode` | OTP value: `{{prompt.otp}}` |
| 4 | Auth — pincode | `Yes, That's Me` | Modal stays on `/lp/b2c/2` — no URL change yet |
| 5 | Confirm PAN details | `/lp/b2c/loan-type/v1` | Click "Yes, That's Me" |
| 6 | Loan type — Fresh | `/lp/b2c/gold-weight-details/v1` | Get New loan card + Continue |
| 7 | Gold weight and primary preference | `/lp/b2c/offer-page`, `Total Loan Amount` | Select preference + Show My Offers; do not re-click Loan Amount card |
| 8 | Feature preference | *(skipped)* | `actions: []` — LP2 bypasses this screen |
| 9 | Select offer | `/lp/b2c/meeting-slots/v1` | Proceed skips loan-summary |
| 10 | Loan summary | *(skipped)* | `actions: []` — bypassed in LP2 fresh |
| 11 | Book meeting slot | `/lp/b2c/thank-you/v1` | Date + time slot + Continue; emergency slot fallback in notes |
| 12 | Booking confirmed — thank you | confirmation text | Terminal — no navigation |

Takeover differs after step 6: selects "Shift Your Loan", uses `/lp/b2c/shift-your-loan/v1` instead of gold-weight. See [`config/test-rules-takeover.config.json`](../config/test-rules-takeover.config.json).

---

## 4. LP2 rules (critical)

- **Auth is a modal** on the landing URL until loan-type — use `element_visible`, not `url_contains`, for auth sub-steps.
- **Labels, not selectors** — automation finds elements via Claude + page HTML using your `label` text. Use unique, exact copy.
- **Add `data-testid`** on new UI elements when possible — see [`B2C-LP2-DATA-TESTID-WORKSHEET.md`](./B2C-LP2-DATA-TESTID-WORKSHEET.md).
- **Fresh LP2 skips** feature-preference (step 8) and loan-summary (step 10) — keep placeholder steps with empty `actions` and explanatory `notes`.
- **Gold weight page:** Loan Amount tab is pre-selected; re-clicking resets to ₹0 — do not add a click/fill for amount unless testing that field explicitly.
- **Show My Offers** is a div-styled control, not a native `<button>` — label it clearly in config.
- **Meeting slots:** use label `"First available Morning or Afternoon time slot on selected date"` for the time-slot action. Document emergency slot fallback in step 11 `notes`.
- **Do not navigate** to a step URL if the previous step already landed there (see notes on steps 6, 9, 12).

---

## 5. Fresh error cases (preserve or update copy)

| # | Name | Step | Override | Expected error (verify live UI) |
|---|------|------|----------|--------------------------------|
| 1 | Invalid phone — not 10 digits | 2 | `credentials.mobile`: `"123"` | Please enter a valid 10-digit mobile number |
| 2 | Consent not accepted | 2 | `uncheckConsent`: true | Please accept the terms and conditions to proceed |
| 3 | Wrong OTP | 3 | `credentials.otp`: `"0000"` | Failed to verify OTP. Please try again. |
| 4 | Unserviceable pincode | 4 | `loanDetails.pincode`: `"999999"` | Sorry, we're not serviceable in this area |
| 5 | Invalid PAN — manual entry | 5 | `credentials.pan`: `"INVALID1"` | Please enter a valid and active PAN number. |
| 6 | Invalid PAN — validation failure | 5 | `credentials.pan`: `"ABCDE1234G"` | The PAN number you entered is not correct... |
| 7 | Session expired — missing token | 6 | `clearCookies`: `["token"]` | Redirect to landing or auth entry |

---

## 6. Validation checklist

Before submitting JSON to `automated-testing/config/`:

- [ ] Valid JSON (no trailing commas, no comments)
- [ ] `flowVariant` set correctly
- [ ] Sequential `step` numbers in `flow[]`
- [ ] Every step has at least one assertion
- [ ] All action `label` values match **live UI copy**
- [ ] Secrets use `{{env.*}}` — not real phone/PAN in committed JSON
- [ ] Error messages match **exact toast/inline copy** from UI
- [ ] Skipped LP2 steps (8, 10) documented with `notes`

---

## 7. Test after generating

In the `automated-testing` repo:

```bash
cp .env.example .env   # fill ANTHROPIC_API_KEY, BASE_URL, TEST_MOBILE, etc.
npm run test:happy:fresh
npm run report
```

---

## Related docs

| Doc | Use |
|-----|-----|
| [`config/test-rules-fresh.config.json`](../config/test-rules-fresh.config.json) | Canonical fresh config |
| [`docs/test-rules.template.json`](./test-rules.template.json) | Empty template |
| [`docs/B2C-LP2-DATA-TESTID-WORKSHEET.md`](./B2C-LP2-DATA-TESTID-WORKSHEET.md) | Recommended test IDs |
| [`docs/UI-TEST-CASE-HANDOFF.md`](./UI-TEST-CASE-HANDOFF.md) | Long-form handoff (some routes outdated — prefer this doc for LP2) |
