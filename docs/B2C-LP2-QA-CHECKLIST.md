# B2C LP2 Automation — QA Sign-off Checklist

Complete before running configs in the `automated-testing` repo.

## Config files

| File | Flow |
|------|------|
| `config/test-rules-fresh.config.json` | Fresh loan (12 steps) |
| `config/test-rules-takeover.config.json` | Takeover / shift loan (11 steps) |

## Environment variables

| Variable | Required | Notes |
|----------|----------|-------|
| `BASE_URL` | Yes | `https://rupeek.com/lp/b2c/2` (or staging equivalent) |
| `TEST_MOBILE` | Yes | 10-digit existing-user number for happy path |
| `TEST_OTP` | Yes | **4 digits** — matches `OtpStep` `maxLength={4}` |
| `TEST_PAN` | Yes | Valid active PAN for manual-path / edit flows |
| `TEST_PINCODE` | Yes | 6-digit **serviceable** pincode (confirms green message) |
| `SLACK_WEBHOOK_URL` | Optional | Alerting |
| `TEST_VARIANT` | Optional | `fresh` (default) or `takeover` |

## Run commands

```bash
npm run test:fresh              # fresh happy + errors
npm run test:takeover           # takeover happy + errors
npm run test:happy:fresh        # fresh happy path only
npm run test:happy:takeover     # takeover happy path only
npm run test:errors:fresh       # fresh error cases only
```

## Staging validation

- [ ] Happy path **fresh**: completes through thank-you (`Loan request submitted`)
- [ ] Happy path **takeover**: completes (upload fixture or Skip path)
- [ ] Wrong OTP message matches `errorCases` entry
- [ ] Unserviceable pincode shows: `Sorry, we're not serviceable in this area`
- [ ] Offer page version confirmed: **v1** vs **v2** in Strapi `webFlow` for LP2
- [ ] First offer card selectable after schemes load (45s timeout configured)
- [ ] Meeting slots: Morning/Afternoon slots or emergency path works

## Fixtures (takeover)

- [ ] `tests/fixtures/sample-pledge-card.jpg`
- [ ] `tests/fixtures/invalid-pledge-card.pdf`
- [ ] `tests/fixtures/corrupt-pledge-card.jpg`

## Copy verification

Re-verify on live/staging if copy changes:

- `Get New loan` / `Shift existing loan` (lowercase **loan** on fresh card)
- `Yes, That's Me` (PAN confirm)
- `Show My Offers` / `Proceed` / `Submit` / `Continue`

## Sign-off

| Role | Name | Date |
|------|------|------|
| QA | | |
| UI / B2C | | |
