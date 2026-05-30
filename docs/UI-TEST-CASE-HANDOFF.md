# UI Test Case Handoff Document

**Purpose:** This document is for the **customer-landing-pages / B2C UI team** to define complete, automation-ready test cases for the gold loan booking journey at [https://rupeek.com/lp/b2c/2](https://rupeek.com/lp/b2c/2).

**Consumer:** The [automated-testing](https://github.com/your-org/automated-testing) repo reads a single JSON config file and runs AI-powered Playwright tests against the live site. **No TypeScript changes are needed** when tests are updated — only the JSON config.

**Target landing page:** `/lp/b2c/2` (Strapi slug: `b2c-landing-pages-2`)

**Last updated:** May 27, 2026

---

## Table of Contents

1. [What the UI team must deliver](#1-what-the-ui-team-must-deliver)
2. [How automation works (short)](#2-how-automation-works-short)
3. [Output format — JSON schema](#3-output-format--json-schema)
4. [Action & assertion reference](#4-action--assertion-reference)
5. [Template variables](#5-template-variables)
6. [B2C journey map (fill in per screen)](#6-b2c-journey-map-fill-in-per-screen)
7. [Error / negative test cases](#7-error--negative-test-cases)
8. [UI recommendations for testability](#8-ui-recommendations-for-testability)
9. [Fresh vs Takeover flows](#9-fresh-vs-takeover-flows)
10. [Submission checklist](#10-submission-checklist)
11. [Complete example (starter)](#11-complete-example-starter)
12. [Appendix: Known B2C routes & booking statuses](#12-appendix-known-b2c-routes--booking-statuses)

---

## 1. What the UI team must deliver

Please return **one JSON file** named `test-rules.config.json` (or fill in the template at [`docs/test-rules.template.json`](./test-rules.template.json)) containing:

| Section | Description | Owner fills in |
|---------|-------------|----------------|
| `site` | Base URL, display name, timeout | URL + name |
| `credentials` | Test mobile, OTP, PAN | QA provides test credentials |
| `loanDetails` | Default loan amount, gold weight, purity, purpose | Product defaults |
| `flow[]` | **Happy-path steps** — one object per screen | **UI team (primary)** |
| `errorCases[]` | **Negative tests** — wrong input, validation errors | UI + QA |
| `notifications` | Slack webhook, alert email | DevOps / optional |

For each step in `flow[]`, the UI team must specify:

- **Screen name** and **URL path** (after auth)
- **Actions** — what the user does (click, fill, select, upload, check)
- **Human-readable labels** for every interactive element (button text, field placeholder, aria-label)
- **Assertions** — what proves the step succeeded (URL change, visible element, no error toast)
- **Optional:** recommended `data-testid` values (strongly preferred — see Section 8)

---

## 2. How automation works (short)

```
test-rules.config.json  →  Claude AI reads labels + page HTML  →  finds CSS selectors
                         →  Playwright clicks/fills/uploads
                         →  Claude validates assertions
                         →  HTML report with pass/fail + screenshots
```

The automation agent **does not use hardcoded selectors** in source code. It uses your **labels** and page HTML to find elements at runtime. Clear, unique labels = reliable tests.

---

## 3. Output format — JSON schema

### Top-level structure

```json
{
  "site": {
    "baseUrl": "{{env.BASE_URL}}",
    "name": "Gold Loan Booking — B2C LP2",
    "timeout": 30000
  },
  "credentials": {
    "mobile": "{{env.TEST_MOBILE}}",
    "otp": "{{env.TEST_OTP}}",
    "pan": "ABCDE1234F"
  },
  "loanDetails": {
    "amount": 50000,
    "goldWeight": 20,
    "purity": "22K",
    "purpose": "Medical"
  },
  "flow": [ /* see Step object below */ ],
  "errorCases": [ /* see ErrorCase object below */ ],
  "schedule": "0 9 * * 1-5",
  "notifications": {
    "slackWebhook": "{{env.SLACK_WEBHOOK_URL}}",
    "email": "team@rupeek.com"
  }
}
```

### Step object (`flow[]`)

```json
{
  "step": 1,
  "name": "Human-readable step name",
  "url": "/optional/path/relative/to/baseUrl",
  "actions": [
    {
      "type": "fill | click | select | upload | check | assert_text",
      "label": "Exact visible label or description of the element",
      "value": "{{credentials.mobile}}",
      "file": "tests/fixtures/sample-aadhaar.pdf",
      "pattern": "GL-[0-9]{8}"
    }
  ],
  "assertions": [
    {
      "type": "url_contains | element_visible | text_matches | no_error_toast",
      "value": "/next-page-path",
      "label": "Element description",
      "pattern": "regex pattern"
    }
  ]
}
```

### Error case object (`errorCases[]`)

```json
{
  "name": "Wrong OTP",
  "step": 1,
  "override": { "credentials.otp": "000000" },
  "expectedError": "Invalid OTP"
}
```

Special override for file upload errors:

```json
{
  "name": "Oversized pledge card",
  "step": 8,
  "override": { "uploadFile": "tests/fixtures/large.pdf" },
  "expectedError": "File size"
}
```

---

## 4. Action & assertion reference

### Actions

| `type` | When to use | Required fields | Example label |
|--------|-------------|-----------------|---------------|
| `fill` | Text/number input | `label`, `value` | `"Mobile number input"`, `"PAN card field"` |
| `click` | Button, link, card, tab | `label` | `"Get Started button"`, `"Continue button"` |
| `select` | Dropdown / native select | `label`, `value` | `"Gold purity dropdown"`, value `"22K"` |
| `upload` | File input | `label`, `file` | `"Aadhaar upload field"`, `"Upload Pledge Card"` |
| `check` | Checkbox / consent | `label` | `"Terms and conditions checkbox"` |
| `assert_text` | Verify text on page (no click) | `label`, `value` | `"Summary amount"`, value `"50000"` |

### Assertions

| `type` | When to use | Required fields | Example |
|--------|-------------|-----------------|---------|
| `url_contains` | URL changed after step | `value` | `"/lp/b2c/confirm-details/v1"` |
| `element_visible` | Element must appear | `label` | `"Progress bar"`, `"Booking confirmation ID"` |
| `text_matches` | Text matches regex | `label`, `pattern` | `"Booking ID"`, pattern `"GL-[0-9]{8}"` |
| `no_error_toast` | No error/alert visible | — | Use after form submit |

---

## 5. Template variables

Use `{{path.to.value}}` in action `value` fields. Resolved at runtime from config + env.

| Token | Source | Example |
|-------|--------|---------|
| `{{env.BASE_URL}}` | `.env` / GitHub Secret | `https://rupeek.com/lp/b2c/2` |
| `{{env.TEST_MOBILE}}` | `.env` | `8930782208` |
| `{{env.TEST_OTP}}` | `.env` | `123456` |
| `{{env.SLACK_WEBHOOK_URL}}` | `.env` (optional) | Slack webhook URL |
| `{{credentials.mobile}}` | `credentials.mobile` | Phone number |
| `{{credentials.otp}}` | `credentials.otp` | OTP |
| `{{credentials.pan}}` | `credentials.pan` | PAN |
| `{{loanDetails.amount}}` | `loanDetails.amount` | Loan amount |
| `{{loanDetails.goldWeight}}` | `loanDetails.goldWeight` | Gold weight in grams |

**Never put real secrets directly in JSON** — use `{{env.*}}` for mobile, OTP, API keys.

---

## 6. B2C journey map (fill in per screen)

Route order is driven by Strapi **`webFlow`**, not hardcoded paths. For LP `/b2c/2`, two flows exist after loan-type selection.

### 6.1 Auth popup (before routed pages)

Triggered from landing page **Get Started** sticky CTA. This is a modal, not a separate URL.

| Sub-step | Screen | UI team: fill actions | UI team: fill assertions |
|----------|--------|----------------------|--------------------------|
| A1 | Phone | Fill mobile, check consent, click Continue | OTP screen visible |
| A2 | OTP (existing user) | Fill OTP, click Verify | Pincode screen visible |
| A2b | OTP + Name (new user) | Fill first name, last name, OTP | Pincode screen visible |
| A3 | Pincode | Fill pincode, click Confirm | First `webFlow` page loads |

**Suggested labels (verify against live UI):**

```json
{
  "step": 0,
  "name": "Auth — Phone",
  "actions": [
    { "type": "click", "label": "Get Started button" },
    { "type": "fill", "label": "Mobile number input", "value": "{{credentials.mobile}}" },
    { "type": "check", "label": "Consent checkbox" },
    { "type": "click", "label": "Continue button" }
  ],
  "assertions": [
    { "type": "element_visible", "label": "OTP input" }
  ]
}
```

```json
{
  "step": 0,
  "name": "Auth — OTP",
  "actions": [
    { "type": "fill", "label": "OTP input", "value": "{{credentials.otp}}" },
    { "type": "click", "label": "Verify OTP button" }
  ],
  "assertions": [
    { "type": "element_visible", "label": "Pincode input" }
  ]
}
```

```json
{
  "step": 0,
  "name": "Auth — Pincode",
  "actions": [
    { "type": "fill", "label": "Pincode input", "value": "560001" },
    { "type": "click", "label": "Confirm pincode button" }
  ],
  "assertions": [
    { "type": "url_contains", "value": "/lp/b2c/confirm-details/v1" }
  ]
}
```

> **Note:** Pincode `560001` should be replaced with a **serviceable test pincode** from QA.

---

### 6.2 Fresh loan flow (`b2c-landing-pages-2-fresh-flow`)

Typical route order:

```
Landing (/lp/b2c/2)
  → Auth popup
  → /lp/b2c/confirm-details/v1
  → /lp/b2c/loan-type/v1          [select "Get New Loan"]
  → /lp/b2c/gold-weight-details/v1
  → /lp/b2c/feature-preference/v1
  → /lp/b2c/offer-page/v1 or v2
  → /lp/b2c/loan-summary/v1
  → /lp/b2c/meeting-slots/v1
  → /lp/b2c/thank-you/v1
```

**UI team worksheet — copy one block per screen:**

---

#### Screen: Landing page

| Field | Value (UI team fills in) |
|-------|--------------------------|
| **URL** | `/lp/b2c/2` (baseUrl — no extra path) |
| **Step name** | `Landing — Get Started` |
| **Primary CTA label** | e.g. `"Get Started"` |
| **Key visible elements** | Navbar, hero, partner logos, sticky footer |
| **Expected after CTA** | Auth popup opens |

---

#### Screen: Confirm details (PAN)

| Field | Value |
|-------|-------|
| **URL** | `/lp/b2c/confirm-details/v1` |
| **Step name** | `Confirm PAN Details` |
| **Actions** | Confirm PAN / Edit PAN / Manual PAN entry |
| **Booking status (forward)** | `PAN_FETCHED` |
| **Assertions** | Progress bar visible, PAN card details shown |
| **Back behavior** | Returns to pincode / entry |

---

#### Screen: Loan type

| Field | Value |
|-------|-------|
| **URL** | `/lp/b2c/loan-type/v1` |
| **Step name** | `Select Loan Type — Fresh` |
| **Actions** | Click `"Get New Loan"` card, click `"Continue"` |
| **Booking status (forward)** | `LOAN_TYPE_CAPTURED` |
| **Assertions** | `url_contains`: `/lp/b2c/gold-weight-details/v1` |
| **WebFlow switch** | Selecting fresh fetches `b2c-landing-pages-2-fresh-flow` from Strapi |

---

#### Screen: Gold weight & loan amount

| Field | Value |
|-------|-------|
| **URL** | `/lp/b2c/gold-weight-details/v1` |
| **Step name** | `Gold Weight & Loan Amount` |
| **Actions** | Fill loan amount, fill/adjust gold weight, select primary preference, Continue |
| **Booking status (forward)** | `LOAN_DETAILS_CAPTURED` |
| **Assertions** | `url_contains`: `/lp/b2c/feature-preference/v1` |

---

#### Screen: Feature preference

| Field | Value |
|-------|-------|
| **URL** | `/lp/b2c/feature-preference/v1` |
| **Step name** | `Feature Preference` |
| **Actions** | Select secondary preference option(s), Continue |
| **Assertions** | `url_contains`: `/lp/b2c/offer-page` |

---

#### Screen: Offer page

| Field | Value |
|-------|-------|
| **URL** | `/lp/b2c/offer-page/v1` or `/lp/b2c/offer-page/v2` |
| **Step name** | `Select Offer` |
| **Actions** | Select first offer card, optional PL toggle, Continue |
| **Booking status (forward)** | `SCHEME_SELECTED` |
| **Assertions** | `url_contains`: `/lp/b2c/loan-summary/v1`, schemes loaded |
| **Note** | v1 and v2 share booking logic; test both if both are live |

---

#### Screen: Loan summary

| Field | Value |
|-------|-------|
| **URL** | `/lp/b2c/loan-summary/v1` |
| **Step name** | `Review Loan Summary` |
| **Actions** | Review amount, toggle PL add-on if applicable, Continue |
| **Assertions** | `url_contains`: `/lp/b2c/meeting-slots/v1` |

---

#### Screen: Meeting slots

| Field | Value |
|-------|-------|
| **URL** | `/lp/b2c/meeting-slots/v1` |
| **Step name** | `Book Meeting Slot` |
| **Actions** | Select date, select time slot, Confirm |
| **Booking status (forward)** | `SLOT_CONFIRMED` |
| **Assertions** | `url_contains`: `/lp/b2c/thank-you/v1` |
| **Edge cases** | No slots available → emergency slot popup; past slots filtered on today |

---

#### Screen: Thank you

| Field | Value |
|-------|-------|
| **URL** | `/lp/b2c/thank-you/v1` |
| **Step name** | `Booking Confirmed` |
| **Actions** | None (terminal screen) |
| **Assertions** | Confirmation message visible, booking reference if shown |
| **Booking status** | Final — no forward mutation |

---

### 6.3 Takeover flow (`b2c-landing-pages-2-takeover-flow`)

Typical route order:

```
Landing → Auth → confirm-details → loan-type [select "Shift Your Loan"]
  → /lp/b2c/shift-your-loan/v1
  → /lp/b2c/offer-page/v1 or v2
  → /lp/b2c/loan-summary/v1
  → /lp/b2c/meeting-slots/v1
  → /lp/b2c/thank-you/v1
```

#### Screen: Shift your loan (takeover only)

| Field | Value |
|-------|-------|
| **URL** | `/lp/b2c/shift-your-loan/v1` |
| **Step name** | `Shift Loan — Pledge Card Upload` |
| **Actions** | Upload pledge card (camera or file), fill gold weight per loan, Continue |
| **File fixture** | `tests/fixtures/sample-pledge-card.jpg` |
| **Assertions** | Upload success state, `no_error_toast` |
| **Guard** | Only shown when loan type = takeover / existing |

---

## 7. Error / negative test cases

UI team + QA should define at least these categories. Add to `errorCases[]`:

| # | Scenario | Step | Override | Expected error text (exact UI copy) |
|---|----------|------|----------|-------------------------------------|
| 1 | Invalid phone (not 10 digits) | Auth phone | `credentials.mobile`: `"123"` | *(fill exact message)* |
| 2 | Wrong OTP | Auth OTP | `credentials.otp`: `"000000"` | *(fill exact message)* |
| 3 | Invalid PAN | Confirm details | `credentials.pan`: `"INVALID"` | *(fill exact message)* |
| 4 | Unserviceable pincode | Auth pincode | custom override | *(fill exact message)* |
| 5 | Below minimum loan amount | Gold weight | `loanDetails.amount`: `500` | *(fill exact message)* |
| 6 | Oversized pledge card upload | Shift loan | `uploadFile`: large file | `"Upload failed."` or size error |
| 7 | No slot available | Meeting slots | *(describe setup)* | Emergency slot popup |
| 8 | Session expired / invalid token | Any protected page | *(describe setup)* | Redirect to landing |

**Important:** `expectedError` must match **exact visible text** on the page (toast, inline error, alert).

---

## 8. UI recommendations for testability

The automation agent prefers selectors in this order:

1. **`data-testid`** *(best — please add these)*
2. **`aria-label`**
3. **`name` / `placeholder`**
4. **Visible button text** *(last resort — brittle when copy changes)*

### Recommended `data-testid` naming convention

```
b2c-{screen}-{element}-{action}

Examples:
  b2c-landing-get-started-btn
  b2c-auth-phone-input
  b2c-auth-otp-input
  b2c-auth-continue-btn
  b2c-pincode-input
  b2c-loan-type-fresh-card
  b2c-loan-type-takeover-card
  b2c-gold-weight-amount-input
  b2c-offer-select-first-card
  b2c-slots-date-picker
  b2c-slots-time-slot-first
  b2c-thank-you-confirmation-text
```

Please add a column in your worksheet:

| Element | Visible label | Recommended data-testid | Component file |
|---------|---------------|---------------------------|----------------|
| Get Started CTA | Get Started | `b2c-landing-get-started-btn` | `B2CStickyGetStarted/index.js` |
| Phone input | *(placeholder)* | `b2c-auth-phone-input` | `AuthFlowPopup/steps/PhoneStep.js` |
| ... | ... | ... | ... |

---

## 9. Fresh vs Takeover flows

Provide **two separate `flow` arrays** or clearly mark steps that apply to only one flow.

| | Fresh | Takeover |
|---|-------|----------|
| Strapi webFlow slug | `b2c-landing-pages-2-fresh-flow` | `b2c-landing-pages-2-takeover-flow` |
| Loan type selection | "Get New Loan" | "Shift Your Loan" |
| Unique pages | `gold-weight-details`, `feature-preference` | `shift-your-loan` |
| Shared pages | confirm-details, loan-type, offer-page, loan-summary, meeting-slots, thank-you | same |

**Automation approach:** Either submit two config files (`test-rules-fresh.config.json`, `test-rules-takeover.config.json`) or one config with a `"flowVariant": "fresh"` field and documented step ranges.

---

## 10. Submission checklist

Before handing off to the QA / automation team:

- [ ] Every screen in both fresh and takeover flows has a `flow` step
- [ ] Every action has a **unique, human-readable `label`**
- [ ] Every step has at least one **assertion**
- [ ] URLs use full paths as seen in browser (e.g. `/lp/b2c/confirm-details/v1`)
- [ ] Error cases include **exact error message copy** from the UI
- [ ] Test credentials documented separately (not in JSON — use `{{env.*}}`)
- [ ] Serviceable test pincode confirmed with backend/QA
- [ ] `data-testid` attributes added or documented in worksheet
- [ ] Offer page version(s) to test specified (v1, v2, or both)
- [ ] File upload fixtures listed (pledge card, KYC docs)
- [ ] JSON validates (no trailing commas, valid syntax)

**Submit to:** automated-testing repo → `config/test-rules.config.json`

**Validate locally:**

```bash
cd automated-testing
cp .env.example .env   # fill in credentials
npm test               # full run
npm run test:happy     # happy path only
npm run report         # open HTML report
```

---

## 11. Complete example (starter)

Below is a **starter config** for LP `/b2c/2` fresh flow. UI team should replace labels with exact live copy and add missing steps.

```json
{
  "site": {
    "baseUrl": "{{env.BASE_URL}}",
    "name": "Rupeek B2C Gold Loan — LP2 Fresh",
    "timeout": 30000
  },
  "credentials": {
    "mobile": "{{env.TEST_MOBILE}}",
    "otp": "{{env.TEST_OTP}}",
    "pan": "ABCDE1234F"
  },
  "loanDetails": {
    "amount": 500000,
    "goldWeight": 50,
    "purity": "22K",
    "purpose": "Personal"
  },
  "flow": [
    {
      "step": 1,
      "name": "Landing — open auth",
      "actions": [
        { "type": "click", "label": "Get Started button" }
      ],
      "assertions": [
        { "type": "element_visible", "label": "Mobile number input" }
      ]
    },
    {
      "step": 2,
      "name": "Auth — phone & OTP",
      "actions": [
        { "type": "fill", "label": "Mobile number input", "value": "{{credentials.mobile}}" },
        { "type": "check", "label": "Consent checkbox" },
        { "type": "click", "label": "Continue button" },
        { "type": "fill", "label": "OTP input", "value": "{{credentials.otp}}" },
        { "type": "click", "label": "Verify OTP button" }
      ],
      "assertions": [
        { "type": "element_visible", "label": "Pincode input" }
      ]
    },
    {
      "step": 3,
      "name": "Auth — pincode",
      "actions": [
        { "type": "fill", "label": "Pincode input", "value": "560001" },
        { "type": "click", "label": "Confirm pincode button" }
      ],
      "assertions": [
        { "type": "url_contains", "value": "/lp/b2c/confirm-details/v1" }
      ]
    },
    {
      "step": 4,
      "name": "Confirm PAN",
      "actions": [
        { "type": "click", "label": "Confirm PAN button" }
      ],
      "assertions": [
        { "type": "url_contains", "value": "/lp/b2c/loan-type/v1" },
        { "type": "no_error_toast" }
      ]
    },
    {
      "step": 5,
      "name": "Loan type — Fresh",
      "actions": [
        { "type": "click", "label": "Get New Loan card" },
        { "type": "click", "label": "Continue button" }
      ],
      "assertions": [
        { "type": "url_contains", "value": "/lp/b2c/gold-weight-details/v1" }
      ]
    },
    {
      "step": 6,
      "name": "Gold weight & amount",
      "actions": [
        { "type": "fill", "label": "Loan amount input", "value": "{{loanDetails.amount}}" },
        { "type": "click", "label": "Continue button" }
      ],
      "assertions": [
        { "type": "url_contains", "value": "/lp/b2c/feature-preference/v1" }
      ]
    },
    {
      "step": 7,
      "name": "Feature preference",
      "actions": [
        { "type": "click", "label": "First preference option" },
        { "type": "click", "label": "Continue button" }
      ],
      "assertions": [
        { "type": "url_contains", "value": "/lp/b2c/offer-page" }
      ]
    },
    {
      "step": 8,
      "name": "Select offer",
      "actions": [
        { "type": "click", "label": "First offer card" },
        { "type": "click", "label": "Continue button" }
      ],
      "assertions": [
        { "type": "url_contains", "value": "/lp/b2c/loan-summary/v1" }
      ]
    },
    {
      "step": 9,
      "name": "Loan summary",
      "actions": [
        { "type": "click", "label": "Continue button" }
      ],
      "assertions": [
        { "type": "url_contains", "value": "/lp/b2c/meeting-slots/v1" }
      ]
    },
    {
      "step": 10,
      "name": "Book slot",
      "actions": [
        { "type": "click", "label": "First available date" },
        { "type": "click", "label": "First available time slot" },
        { "type": "click", "label": "Confirm booking button" }
      ],
      "assertions": [
        { "type": "url_contains", "value": "/lp/b2c/thank-you/v1" },
        { "type": "element_visible", "label": "Thank you confirmation message" }
      ]
    }
  ],
  "errorCases": [
    {
      "name": "Wrong OTP",
      "step": 2,
      "override": { "credentials.otp": "000000" },
      "expectedError": "Invalid OTP"
    },
    {
      "name": "Invalid PAN",
      "step": 4,
      "override": { "credentials.pan": "INVALID" },
      "expectedError": "Invalid PAN"
    }
  ],
  "schedule": "0 9 * * 1-5",
  "notifications": {
    "slackWebhook": "{{env.SLACK_WEBHOOK_URL}}",
    "email": "team@rupeek.com"
  }
}
```

---

## 12. Appendix: Known B2C routes & booking statuses

### Routes (customer-landing-pages)

| Path | Page file |
|------|-----------|
| `/lp/b2c/[...allParams]` | Landing |
| `/lp/b2c/confirm-details/v1` | PAN confirmation |
| `/lp/b2c/loan-type/v1` | Fresh vs takeover |
| `/lp/b2c/gold-weight-details/v1` | Fresh only |
| `/lp/b2c/feature-preference/v1` | Fresh only |
| `/lp/b2c/shift-your-loan/v1` | Takeover only |
| `/lp/b2c/offer-page/v1` | Offer selection (classic) |
| `/lp/b2c/offer-page/v2` | Offer selection (experimental) |
| `/lp/b2c/loan-summary/v1` | Review before slots |
| `/lp/b2c/meeting-slots/v1` | Slot booking |
| `/lp/b2c/thank-you/v1` | Success |

### Booking status progression

```
OTP_VERIFIED → PINCODE_CONFIRMED → PAN_FETCHED → LOAN_TYPE_CAPTURED
  → LOAN_DETAILS_CAPTURED → SCHEME_SELECTED → SLOT_CONFIRMED
```

### Key auth cookies (for QA setup)

| Cookie | Set by | Used for |
|--------|--------|----------|
| `token` | OtpStep / OtpWithNameStep | API authorization |
| `bookingId` | OtpStep only | Page guards |
| `leadId` | Lead store | Analytics / BRE |

### Related UI repo docs

- Internal B2C handoff: `customer-landing-pages/pages/lp/b2c/Claude.md`
- Flow navigation: `customer-landing-pages/Components/utils/flow.js`

---

## Contact & workflow

1. **UI team** fills screen worksheets + JSON (this document)
2. **QA** validates credentials, pincodes, error messages
3. **Automation team** drops JSON into `automated-testing/config/test-rules.config.json`
4. **CI** runs daily + on every push to `main`

Questions about JSON format → automated-testing repo README  
Questions about B2C flow behavior → B2C team / `Claude.md` in customer-landing-pages
