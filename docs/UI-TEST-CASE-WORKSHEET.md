# UI Team — Per-Screen Test Case Worksheet

**Landing page:** https://rupeek.com/lp/b2c/2  
**Flow variant:** ☐ Fresh  ☐ Takeover  
**Filled by:** _______________  **Date:** _______________

Copy one section per screen. Return completed worksheets + JSON to the automation team.

---

## Screen ___ of ___

| Field | Your answer |
|-------|-------------|
| **Step number** | |
| **Step name** | |
| **URL path** (after `https://rupeek.com`) | |
| **Applies to flow** | ☐ Fresh only  ☐ Takeover only  ☐ Both |
| **Booking status on forward** | e.g. `PAN_FETCHED`, `LOAN_TYPE_CAPTURED` |
| **Prerequisites** | e.g. must be logged in, bookingId cookie set |

### Actions (what the user does)

| # | Type (`fill`/`click`/`select`/`upload`/`check`) | Label (exact UI text or description) | Value / file | data-testid (recommended) |
|---|------------------------------------------------|--------------------------------------|--------------|----------------------------|
| 1 | | | | |
| 2 | | | | |
| 3 | | | | |

### Assertions (what must be true after the step)

| # | Type (`url_contains`/`element_visible`/`text_matches`/`no_error_toast`) | Label or value | Pattern (if regex) |
|---|--------------------------------------------------------------------------|----------------|---------------------|
| 1 | | | |
| 2 | | | |

### Error states on this screen

| Scenario | Trigger | Exact error message shown |
|----------|---------|---------------------------|
| | | |
| | | |

### Screenshots / notes

_(attach screenshot or Figma link)_

---

## Quick reference — B2C screens to cover

### Auth popup (modal)
- [ ] Phone + consent
- [ ] OTP (existing user)
- [ ] OTP + name (new user)
- [ ] Pincode

### Fresh flow
- [ ] Landing `/lp/b2c/2`
- [ ] Confirm details `/lp/b2c/confirm-details/v1`
- [ ] Loan type `/lp/b2c/loan-type/v1`
- [ ] Gold weight `/lp/b2c/gold-weight-details/v1`
- [ ] Feature preference `/lp/b2c/feature-preference/v1`
- [ ] Offer page `/lp/b2c/offer-page/v1` or `v2`
- [ ] Loan summary `/lp/b2c/loan-summary/v1`
- [ ] Meeting slots `/lp/b2c/meeting-slots/v1`
- [ ] Thank you `/lp/b2c/thank-you/v1`

### Takeover-only
- [ ] Shift your loan `/lp/b2c/shift-your-loan/v1`
- [ ] Pledge card upload (camera + file picker)
- [ ] Upload success / failure states

### Cross-cutting
- [ ] Back button behavior per screen
- [ ] Progress bar step indicator
- [ ] Token expired → redirect to landing
- [ ] Unserviceable pincode
- [ ] No slots available → emergency slot popup

---

**Return completed worksheets to:** automated-testing team  
**Full spec:** [UI-TEST-CASE-HANDOFF.md](./UI-TEST-CASE-HANDOFF.md)
