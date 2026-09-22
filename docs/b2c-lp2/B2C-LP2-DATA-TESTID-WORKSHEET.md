# B2C LP2 — Recommended `data-testid` Worksheet

Use this when adding test IDs in a follow-up UI PR. Convention: `b2c-{screen}-{element}-{action}`.

| Screen | Element | Visible label / description | Recommended `data-testid` | Component file |
|--------|---------|----------------------------|---------------------------|----------------|
| Landing | Sticky CTA | Get Started | `b2c-landing-get-started-btn` | `Components/B2C/B2CStickyGetStarted/index.js` |
| Auth — Phone | Mobile input | Enter Mobile Number | `b2c-auth-phone-input` | `Components/B2C/AuthFlowPopup/steps/PhoneStep.js` |
| Auth — Phone | Consent checkbox | I accept Rupeek's Terms of Use... | `b2c-auth-consent-checkbox` | `PhoneStep.js` |
| Auth — Phone | Continue | Continue | `b2c-auth-phone-continue-btn` | `PhoneStep.js` |
| Auth — OTP | OTP input | Enter 4 Digit OTP | `b2c-auth-otp-input` | `Components/B2C/AuthFlowPopup/steps/OtpStep.js` |
| Auth — OTP | Continue | Continue | `b2c-auth-otp-continue-btn` | `OtpStep.js` |
| Auth — OTP + Name | First name | First Name | `b2c-auth-first-name-input` | `OtpWithNameStep.js` |
| Auth — OTP + Name | Last name | Last Name | `b2c-auth-last-name-input` | `OtpWithNameStep.js` |
| Auth — Pincode | Pincode input | Enter Pincode | `b2c-auth-pincode-input` | `PincodeStep.js` |
| Auth — Pincode | Continue | Continue | `b2c-auth-pincode-continue-btn` | `PincodeStep.js` |
| Auth — Pincode | Serviceable msg | We're serviceable in this area | `b2c-auth-pincode-serviceable-msg` | `PincodeStep.js` |
| Confirm details | Confirm PAN | Yes, That's Me | `b2c-confirm-pan-submit-btn` | `Components/B2C/ConfirmDetailsScreen/index.js` |
| Confirm details | Manual PAN | Enter PAN number | `b2c-confirm-pan-manual-input` | `ManualPanEntryScreen/index.js` |
| Confirm details | Edit PAN | Edit icon on PAN field | `b2c-confirm-pan-edit-btn` | `ConfirmDetailsScreen/index.js` |
| Loan type | Fresh card | Get New loan | `b2c-loan-type-fresh-card` | `pages/lp/b2c/loan-type/v1/index.js` |
| Loan type | Takeover card | Shift existing loan | `b2c-loan-type-takeover-card` | `loan-type/v1/index.js` |
| Loan type | Continue | Continue | `b2c-loan-type-continue-btn` | `loan-type/v1/index.js` |
| Gold weight | Loan amount card | Loan Amount | `b2c-gold-weight-loan-card` | `Components/Gold-marketplace/GoldRequirement/index.js` |
| Gold weight | Gold weight card | Gold Net Weight | `b2c-gold-weight-gold-card` | `GoldRequirement/index.js` |
| Gold weight | Loan input | ₹ loan amount input | `b2c-gold-weight-amount-input` | `GoldRequirement/index.js` |
| Gold weight | Low interest pref | Lowest Interest Rate | `b2c-gold-weight-pref-low-interest` | `GoldRequirementPriority/index.js` |
| Gold weight | High amount pref | Highest Loan Amount | `b2c-gold-weight-pref-high-amount` | `GoldRequirementPriority/index.js` |
| Gold weight | CTA | Show My Offers | `b2c-gold-weight-show-offers-btn` | `GoldRequirementPriority/index.js` |
| Feature preference | No preference option | No preference- show the best offer | `b2c-feature-pref-none` | `pages/lp/b2c/feature-preference/v1/index.js` |
| Feature preference | Confirm | Confirm | `b2c-feature-pref-confirm-btn` | `feature-preference/v1/index.js` |
| Offer page | First scheme card | First offer scheme card | `b2c-offer-first-card` | `pages/lp/b2c/offer-page/v1/index.js` |
| Offer page | Proceed | Proceed | `b2c-offer-proceed-btn` | `SelectedOfferDetails/index.js` |
| Loan summary | Submit | Submit | `b2c-loan-summary-submit-btn` | `pages/lp/b2c/loan-summary/v1/index.js` |
| Meeting slots | Date picker | First available date | `b2c-slots-date-first` | `pages/lp/b2c/meeting-slots/v1/index.js` |
| Meeting slots | Time slot | First Morning/Afternoon slot | `b2c-slots-time-first` | `meeting-slots/v1/index.js` |
| Meeting slots | Continue | Continue | `b2c-slots-continue-btn` | `meeting-slots/v1/index.js` |
| Meeting slots | Emergency CTA | Need an emergency slot? | `b2c-slots-emergency-btn` | `meeting-slots/v1/index.js` |
| Meeting slots | Emergency book | Book Emergency Slot | `b2c-slots-emergency-book-btn` | `EmergencySlotPopup.js` |
| Shift loan | Upload CTA | Upload | `b2c-shift-upload-btn` | `Components/B2C/ShiftLoan/FileUploadCtaBox.js` |
| Shift loan | Skip | Skip | `b2c-shift-skip-link` | `shift-your-loan/v1/index.js` |
| Shift loan | Show offers | Show My Offers | `b2c-shift-show-offers-btn` | `shift-your-loan/v1/index.js` |
| Shift loan | Modal — device | Upload From Device | `b2c-shift-upload-device-btn` | `FileUploadModals.js` |
| Thank you | Title | Loan request submitted | `b2c-thank-you-title` | `pages/lp/b2c/thank-you/v1/index.js` |

## Priority order for automation

1. `data-testid` (add per table above)
2. `aria-label`
3. `placeholder` / `name`
4. Visible button text (current bot approach — brittle on copy changes)
