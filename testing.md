# Rupeek LeadFusion — UI Testing Walkthrough

> **Staging Base URL:** `https://leadfusion-qa.rupeek.co`
> **Primary focus:** `/leads/ongoing/NOT_STARTED?activityStatus=NOT_STARTED`

---

## Environment Details

| Item | Detail |
|------|--------|
| Staging URL | `https://leadfusion-qa.rupeek.co` |
| Mobile number format | 10 digits, numeric only |
| OTP length | **4 digits** (both login OTP and meeting verify-OTP) |
| OTP resend timer | 30-second cooldown before "Send Again" is available |
| Credentials needed | Registered phone number (login), no PAN/Aadhaar/DOB required at login |
| File uploads | Used during check-in/check-out (selfie photo) and meeting Add Details step (selfie photo); no document type upload on leads pages |
| Selfie | Camera capture only (no file upload) |
| Roles | `agent`, `manager1`, `manager2`, `regionalHead`, `admin` — role affects what UI is visible |

---

## Flow Overview (Happy Path)

```
Sign In → Check In → Dashboard → Leads List (NOT_STARTED tab)
       → Lead Detail → [Call] → Disposition → [Meeting Flow if scheduled]
       → Check Out
```

---

## Screen 1 — Sign In / Login

**URL:** `/sign-in`

### User Actions (Phase 1 — Enter Phone)
1. The page loads with the heading **"Login"** and subheading **"Rupeek Sales App"**.
2. Fill the **phone number** field (numeric, 10 digits max).
3. Click **"Send OTP"** button.
4. Wait for OTP to be delivered via SMS.

### User Actions (Phase 2 — Enter OTP)
5. The form switches to the OTP input (shows the phone number with an edit option).
6. Fill the **4-digit OTP** field.
7. Click **"Login"** button.

### Success Indicator
- Redirected to `/` (Dashboard/Home).
- If already authenticated, page auto-redirects immediately.

### Data-testid Attributes
- None currently set in code.

### Error Scenarios
| Error | Trigger |
|-------|---------|
| Button shows "Please wait..." spinner | API call in-flight |
| OTP invalid / toast error | Wrong 4-digit OTP submitted |
| Login blocked | Phone not registered in system |

---

## Screen 2 — Check-In

**URL:** `/check-in`

> **Prerequisite:** User must be authenticated but NOT already checked in. If already checked in, page auto-redirects to `/`.

### Info Banner
- Blue alert: **"Great to see you! Check in now to begin today's journey."**

### User Actions (Vertical Stepper)

**Step 1 — Add Location**
1. The Location component auto-requests GPS. Browser shows a permissions prompt.
2. User grants location permission.
3. Location is captured automatically (no manual input needed).
4. Step 1 is marked complete once GPS coordinates are obtained.

**Step 2 — Take Selfie**
5. "Take Selfie" step becomes active only after location is captured.
6. Click the camera/selfie button to open the camera.
7. Capture the selfie photo.
8. Photo preview appears.

**Submit**
9. Click **"Check-In"** button (bottom bar).
   - For `manager1`, `manager2`, `admin`, `regionalHead` roles: a **"Skip"** button also appears alongside "Check-In".

### Geo-Fencing Error Flow
- If location is outside the catchment area, a **geo-fencing reason popup** appears.
- User must select a reason (radio list).
- If reason is "Others", an additional **remark text field** appears.
- Click confirm to complete check-in with the override reason.

### Success Indicator
- Redirected to `/` (Dashboard).

### Error Scenarios
| Error | Trigger |
|-------|---------|
| "Check-In" button disabled | Photo not yet taken |
| Geo-fencing reason popup | Check-in location outside catchment area (HTTP 400 from API) |
| Spinner shown | API call in-flight |

---

## Screen 3 — Dashboard / Home

**URL:** `/` (index)

### Contents
- **Check-Out alert banner** (if checked in): Success-style green alert — "You've made great progress today! Ready to check out?" with link to `/check-out`.
- **Check-In link** (if NOT checked in): "Check In >" link to `/check-in`.
- **Team Attendance** card (role-dependent).
- **Today's Schedule** card.
- **Upcoming Meetings** card — shows upcoming meeting leads.
- **Backlog** card — shows overdue/backlog activities.
- **Summary** card — performance summary.

### User Actions
- Pull down to refresh all sections.
- Click **"Check In >"** link → navigates to `/check-in`.
- Click any upcoming meeting / backlog item → navigates to that lead's detail.

### Success Indicator
- Dashboard data loaded; cards show counts/items.

---

## Screen 4 — Leads List Page (Primary Focus)

**URL:** `/leads/ongoing/NOT_STARTED?activityStatus=NOT_STARTED`

**Route pattern:** `/leads/[segment]/[activityStatus]`
- `segment` values: `ongoing`, `upcoming`
- `activityStatus` values: `NOT_STARTED`, `IN_PROGRESS`, `COMPLETED`

### Page Layout

**Tab bar (top)** — three tabs:

| Tab Label | URL |
|-----------|-----|
| **Action Required** | `/leads/ongoing/NOT_STARTED` |
| **In Progress** | `/leads/ongoing/IN_PROGRESS` |
| **Completed** | `/leads/ongoing/COMPLETED` |

**Lead count label** (below tabs, above list):
```
showing XX of YY leads
```

**Filter button** (top-right, next to lead count) — opens the filter drawer.

**Lead cards list** (scrollable) — each card shows:
- Phone number (top)
- Customer name (bottom of header)
- Loan Amount, Loan Type, Lead Stage
- Lead Source badge (footer)
- Lead Disposition (footer, color-coded)
- Last modified timestamp
- Hot-lead urgency banner (if urgent action needed — shows urgency text + time)
- Pledge card badge (if pledge card uploaded)

---

### 4A — Filter Panel

**Trigger:** Click the **filter icon** (top-right of leads list).

**Filter Drawer contents:**

| Filter | Type | Options |
|--------|------|---------|
| Search by phone / email | Text input | 10-digit phone OR email (admin + team view only) |
| **Hot leads** toggle | Switch | On = show only hot leads (forces Source to B2C) |
| **Pledge card uploaded** toggle | Switch | On = show only leads with pledge card |
| **Lead Disposition** | Multi-select checkboxes | Ready to transact, May Transact, RNR, Reschedule, Not interested, Disqualified |
| **Lead Status** | Multi-select checkboxes | Schedule meet, Hot, Warm, Cold, RNR, Blacklisted, Other City, Area Not Serviceable, Gold not able to pledge |
| **Lead Stage** | Multi-select checkboxes | (stage values from API) |
| **Source** | Multi-select checkboxes | b2c, BTL, referral, etc. (forced to B2C-only when hot leads/pledge card toggle is on) |
| **Meeting date follow up** | Date range picker | From/To date (future dates, max 2 weeks from now) |
| **Submit date** | Date range picker | From/To date (past dates only, max = today) |

**User Actions in Filter:**
1. Click filter icon → drawer slides in from right.
2. Toggle **"Hot leads"** switch ON/OFF.
3. Toggle **"Pledge card uploaded"** switch ON/OFF.
4. Select checkboxes under Lead Disposition, Lead Status, Lead Stage, Source.
5. Select from/to dates under "Meeting date follow up".
6. Select from/to dates under "Submit date".
7. (Admin + team view) Switch search type between "Lead" (phone) and "Agent" (email), type the value.
8. Click **"Apply (N)"** button at the bottom — N = count of active filters.
9. OR click the **X** (close icon) in the filter header to dismiss without applying.
10. To clear filters: click the **reset/clear** icon on the filter button in the list header.

**Success indicator:** List refreshes with filtered results. Filter count badge appears on the filter button.

---

### 4B — Lead Card Interactions

**Long Press** (admin only):
- Long-pressing any lead card activates **multiselect mode**.
- A **"Select All"** checkbox + lead count appears at top.
- An **X** button appears to exit multiselect mode.
- Individual lead card checkboxes become active.

**Multiselect Mode (admin only):**

| Action | UI |
|--------|----|
| Tap checkbox on a card | Selects/deselects that lead |
| "Select All" checkbox | Selects all visible leads |
| X button | Exits multiselect, clears selection |
| **"Assign to"** button (bottom bar) | Navigates to `/leads/assignment` |
| **"Delete"** button (bottom bar) | Opens confirmation alert dialog |

**Delete Confirmation Dialog:**
- Text: `"Are you sure you want to delete N lead(s)?"`
- **"Yes"** → bulk delete API call → success popup "Successfully Deleted" → list refreshes.
- **"No"** → dismiss dialog.

**Tap lead card header** (normal, not multiselect):
- Navigates to **Lead Detail page**: `/leads/details/[leadId]`

**Pagination / Infinite Scroll:**
- Scroll to the bottom → next page loads automatically.
- Label shows `showing XX of YY leads` updating as more pages load.
- No further load when `leads.length >= totalElements`.

**Pull-to-refresh:**
- Pull down → resets to page 0 and re-fetches.

**Empty state:**
```
No leads found!!
```
(shown in a red-tinted box when the list is empty)

---

### 4C — Tab Navigation

| Action | Result |
|--------|--------|
| Click "Action Required" tab | URL → `/leads/ongoing/NOT_STARTED`, loads NOT_STARTED leads |
| Click "In Progress" tab | URL → `/leads/ongoing/IN_PROGRESS`, loads IN_PROGRESS leads |
| Click "Completed" tab | URL → `/leads/ongoing/COMPLETED`, loads COMPLETED leads |

Tab change resets multiselect selection automatically.

---

## Screen 5 — Lead Detail Page

**URL:** `/leads/details/[leadId]`

**Contains (top to bottom):**
1. **Lead card** (disabled/non-interactive, no caret) — shows customer phone, name, loan amount, loan type, stage, source, disposition.
2. **Disposition Selector card** — visible only after a call has been logged (`callCount > 0`).
3. **Send Booking Link card** — visible after a call is logged (B2C leads: allows sending a booking link).
4. **Book/Modify Slot card** — visible if `eventName === "SCHEME_SELECTED"`.
5. **Meeting Scheduled card** — visible if a MEETING_BTL is scheduled (`meetingScheduled = true`).
6. **Information card** — Address details (city, area, pincode, geo location).
7. **Loan/Collection Details card** — varies by B2C vs non-B2C lead.
8. **Referee Details card** — visible only for `REFERRAL_ACTIVITY` leads.
9. **Fixed bottom bar** — **"Dialer call"** button.

### User Actions

**1. Make a Call**
- Click **"Dialer call"** button (fixed bottom bar).
- Device dialer opens with the lead's phone number.
- Call history is logged automatically via API.
- After the call is logged, the Disposition Selector becomes active.
- Disposition must now be marked before navigating away.

**2. Disposition Selector (appears after call)**

The Disposition card shows two dropdowns:
- **"Lead Disposition"** (left)
- **"Lead Status"** (right — disabled until disposition is selected)

**Lead Disposition options vary by loan type:**

*Default (no specific loan type):*
- Ready to transact, May Transact, RNR, Reschedule, Not interested, Disqualified

*B2C Fresh loan (`loanType = FRESH` or `1`):*
- May Transact, Txn Completed, Ready to transact, RNR, Reschedule, Not Interested, Disqualified

*B2C Takeover loan (`loanType = TAKEOVER` or `2`):*
- May Transact, Txn Completed, Will share PC, PC Shared, Meeting Pushed/ RO offer Generated, Meeting completed, RNR, Reschedule, Not Interested, Disqualified

**Lead Status options depend on selected disposition:**

| Lead Disposition | Lead Status options |
|-----------------|---------------------|
| Ready to Transact | Skips status → goes directly to calendar (date picker) |
| Will share PC | Skips status → goes directly to calendar |
| PC Shared | Skips status → goes directly to calendar |
| Meeting Pushed | Skips status → goes directly to calendar |
| May Transact | Schedule meet, Hot, Warm, RNR |
| Reschedule | Cold, RNR |
| Not Interested | Cold |
| Disqualified | Black Listed, Other City, Area Not Serviceable, Gold not able to pledge |
| RNR | Schedule meet, Hot, Warm, Cold, RNR |

**Calendar date picker** (for scheduling follow-up/meeting):
- Appears for dispositions that require a future date.
- RESCHEDULE, MAY_TRANSACT, READY_TO_TRANSACT, WILL_SHARE_PC, PC_SHARED, MEETING_PUSHED cap the date to **max 7 days from today**.
- A **comment field** is shown alongside the calendar.

**Success popups after disposition update:**
- `"Follow up Scheduled"` — when FOLLOW_UP activity + followUpDate set.
- `"Meeting Scheduled"` — when MEETING_BTL activity + meetingScheduled set.

**3. View History**
- Click **"View History"** link → navigates to `/leads/details/history`.

**4. View Pledge Card** (B2C leads with uploaded pledge card)
- Click **"View Pledge Card"** link → opens pledge card selection popup.
- If multiple pledge cards: popup shows card count, user selects which one.
- Selected card opens as an image.

**5. Back Navigation with Disposition Pending**
- If a call was made but disposition not yet set, clicking back shows a toast:
  - **Toast:** `"Disposition required"` / `"Please mark the lead disposition before going back."`
  - The Disposition popup opens automatically.
- Browser back button, header back button, and hardware back are all blocked.

**6. Pull-to-refresh** — reloads lead data.

### Success Indicator
- Disposition update → respective success popup (Meeting Scheduled / Follow up Scheduled).
- Page stays open (does not auto-navigate away).

### Error Scenarios
| Error | Trigger |
|-------|---------|
| Toast: "Disposition required..." | Trying to navigate back before marking disposition after a call |
| Toast: error message | API failure on disposition update |
| Toast: "No pledge card found" | Pledge card link clicked but no card IDs available |
| Toast: "Unable to open pledge card" | Missing document ID or image fetch failure |

---

## Screen 5a — Meeting Scheduled Card (within Lead Detail)

**Shown when:** `runningActivityDetail.activityType === "MEETING_BTL"` AND `meetingScheduled === true` AND `callCount > 0`.

### Contents
- Header: **"Meeting Scheduled"** / **"Meeting Done"**
- Scheduled date/time (e.g., `"12th Jul, 02:30 pm"`) with edit pencil icon.
- Text: **"Arrived at customers place?"**
- Horizontal stepper (shows current step: Add Details / Verify OTP / Meet / Feedback).
- **"Continue"** button.

### User Actions

**Start Meeting Flow:**
1. Click **"Continue"** → navigates to Step 1: Add Details (`/leads/details/meeting/addDetails`).

**Edit/Reschedule Meeting:**
1. Click the date/time text with pencil icon → opens bottom sheet with options:
   - **"Reschedule"** → opens calendar picker (max 7 days) with comment field → confirm → success popup "Reschedule Successful" with new date shown.
   - **"Cancel Meeting"** → opens alert dialog: "Are you sure you want to cancel the meeting?" → **"Yes"** → meeting cancelled → success popup "Meeting Cancelled". **"No"** → dismiss.

**View Feedback (when meeting status = COMPLETED):**
1. Click **"View Feedback"** button → opens bottom sheet showing feedback/disposition text and agent's comments.

---

## Screen 6 — Meeting Step 1: Add Details

**URL:** `/leads/details/meeting/addDetails`

**Horizontal stepper at top:** Step 1 highlighted (Add Details).

### User Actions (Vertical Stepper)

**Step 1 — Add Location:**
1. Location component requests GPS.
2. Grant location permission.
3. Location is captured (info text: "Please provide the location where you met the customer").

**Step 2 — Take Selfie:**
4. Becomes active only after location is set.
5. Click camera/selfie button.
6. Capture selfie.

**Submit:**
7. Click **"Continue"** button (fixed bottom bar).
   - Disabled until photo is taken.
   - Shows loader during API call.

### Success Indicator
- Navigates automatically to **Step 2: Verify OTP**.

### Error Scenarios
| Error | Trigger |
|-------|---------|
| "Continue" button disabled | Photo not captured |
| Toast: "Something Went Wrong, please try again" | API failure on location/photo upload |

---

## Screen 7 — Meeting Step 2: Verify OTP

**URL:** `/leads/details/meeting/verify-otp`

**Horizontal stepper at top:** Step 2 highlighted (Verify OTP).

### Contents
- Heading: **"Verify your mobile number"**
- Subtext: "Enter the 4 digit OTP sent via SMS to"
- Customer's phone number (underlined)
- **4-digit OTP input** (placeholder: `"0000"`, maxLength: 4, numeric)
- X clear button (appears when OTP field has value)
- "Didn't receive OTP?" + resend timer / "Send Again" button

### Automatic Action
- OTP is **automatically sent** when the page loads (no user action required for the initial OTP).

### User Actions
1. Wait for OTP SMS (sent automatically on page load).
2. Enter the **4-digit OTP**.
3. (Optional) Click **X** to clear the OTP field.
4. If OTP not received after 30 seconds:
   - Timer shows "Retry in 00:XX" (counting down from 30).
   - After countdown, click **"Send Again"** button (outline pill style).
5. Click **"Verify Now"** button (fixed bottom bar).
   - Disabled until exactly 4 digits entered.
   - Shows loader during API call.

### Success Indicator
- Navigates automatically to **Step 3: Meet**.

### Error Scenarios
| Error | Trigger |
|-------|---------|
| "Verify Now" disabled | OTP input has fewer than 4 digits |
| Red error under input: "Please check the otp entered" | Wrong OTP submitted |
| Toast: error message | API failure or OTP code 403 |
| "Send Again" hidden | 30-second cooldown timer active |

---

## Screen 8 — Meeting Step 3: Meet

**URL:** `/leads/details/meeting/meet`

**Horizontal stepper at top:** Step 3 highlighted (Meet).

### Contents — Vertical stepper:

**Step 1 — Meeting Started:**
- Shows "Start" button (initially shows loading spinner, disabled).
- Loader auto-clears on page load (meeting start is auto-logged).

**Step 2 — End Meeting:**
- **"End"** button.

### User Actions
1. Wait for the "Meeting Started" loader to clear (auto).
2. Click **"End"** button to end the meeting.
   - Calls `updateMeetStatus` API.

### Success Indicator
- Navigates automatically to **Step 4: Feedback**.

### Error Scenarios
| Error | Trigger |
|-------|---------|
| Toast: "Something Went Wrong, please try again" | API failure on end meeting |

---

## Screen 9 — Meeting Step 4: Feedback

**URL:** `/leads/details/meeting/feedback`

**Horizontal stepper at top:** Step 4 highlighted (Feedback).

### Contents
- Multi-line **text area** (placeholder: `"Add your comments"`, resizable via expand icon in bottom-right corner).
- **"Update Feedback"** button (fixed bottom bar).

### User Actions
1. Type feedback/comments in the text area.
2. Click **"Update Feedback"** button.
   - Disabled if text area is empty.
   - Calls `updateMeetStatus` API with feedback text.

### Success Indicator
- Navigates back to **Lead Detail page** (`/leads/details/[leadId]`).
- The **Lead Disposition popup opens automatically** on return.

### Error Scenarios
| Error | Trigger |
|-------|---------|
| "Update Feedback" disabled | Empty text area |
| Toast: error message | API failure |

---

## Screen 10 — Check-Out

**URL:** `/check-out`

> **Prerequisite:** User must be checked in. If not, auto-redirects to `/check-in`.

### Info Banner
- Green/success alert: **"You've made great progress today! Ready to check out?"**

### User Actions
Same stepper as Check-In:

**Step 1 — Add Location:**
1. GPS location captured automatically.

**Step 2 — Take Selfie:**
2. Click camera button → capture selfie.

**Submit:**
3. Click **"Check-Out"** button (bottom bar).
   - Disabled until photo taken.

### Success Indicator
- Redirected to `/` (Dashboard).

### Error Scenarios
| Error | Trigger |
|-------|---------|
| Button disabled | Photo not captured |
| API error | Toast with error message |

---

## A — All Flow Variants

### Variant 1: Standard (non-B2C) Lead Flow
- Lead source is NOT "b2c".
- Disposition options: Ready to transact, May Transact, RNR, Reschedule, Not Interested, Disqualified.
- Loan details card shows: Agent Rupeek ID, Sales Visit ID, Agent Name, Agent Code, Agent Role, Loan Application ID.
- No pledge card, no booking link.

### Variant 2: B2C Lead — Fresh Loan
- `lead.leadSource === "b2c"` AND `loanType === FRESH` (value `1`).
- Extra disposition option: **Txn Completed**.
- Loan details card shows: Agent Rupeek ID, 1st Preference, Loan Amount, Pan Card, Event Name, Lender Selected, Takeover fields.
- Booking link card visible.
- If pledge card uploaded: "View Pledge Card" link visible.

### Variant 3: B2C Lead — Takeover Loan
- `lead.leadSource === "b2c"` AND `loanType === TAKEOVER` (value `2`).
- Extra disposition options: Will share PC, PC Shared, Meeting Pushed/ RO offer Generated, Meeting completed.
- These extra dispositions skip Lead Status picker → go straight to calendar (date capped at 7 days).
- Book/Modify Slot card visible if `eventName === "SCHEME_SELECTED"`.

### Variant 4: Referral Lead
- `lead.leadSource === "REFERRAL_ACTIVITY"`.
- Extra **Referee Details** card on lead detail page (Referee Name, Referee Contact No).
- Remark text shown on lead card footer.

### Variant 5: Hot Lead (Urgent)
- `lead.actionInfo.urgency` is set.
- Lead card shows a colored urgency banner at the top.
  - Red (`danger`) for urgent states (e.g., CALL IMMEDIATELY).
  - Amber (`caution`) for SCHEME_SELECTED / RESCHEDULE / SCHEDULED urgency.
- Urgency text displayed (e.g., "CALL IMMEDIATELY", "RESCHEDULE").
- Time since/until action shown alongside clock icon.

### Variant 6: Meeting BTL Lead (with Scheduled Meeting)
- `runningActivityDetail.activityType === "MEETING_BTL"` and `meetingScheduled = true`.
- Meeting Scheduled card appears on lead detail.
- Full 4-step meeting flow: Add Details → Verify OTP → Meet → Feedback.

### Variant 7: Follow-Up Activity
- `runningActivityDetail.activityType === "FOLLOW_UP"`.
- Disposition card is active after a call.
- No Meeting Scheduled card.
- Disposition update with a followUpDate triggers "Follow up Scheduled" success popup.

### Variant 8: Admin vs Agent Role

| Feature | Agent | Admin / Manager |
|---------|-------|-----------------|
| Long press multiselect on leads list | No | Yes |
| "Assign to" bulk button | No | Yes |
| "Delete" bulk button | No | Yes |
| "Skip" on check-in | No | Yes (`manager1`, `manager2`, `admin`, `regionalHead`) |
| Agent email filter in filter drawer | No | Yes |
| `assignedTo` label on lead card footer | No | Yes |

---

## B — Error Scenarios Per Screen

### Sign In
| Message | Trigger |
|---------|---------|
| API error toast | Invalid phone or OTP |
| "Please wait..." spinner | Loading state |

### Check-In / Check-Out
| Message | Trigger |
|---------|---------|
| Button disabled | No selfie taken |
| Geo-fencing reason popup | Location outside catchment (HTTP 400) |

### Leads List
| Message | Trigger |
|---------|---------|
| `No leads found!!` | No leads match current tab/filter |
| Delete confirmation dialog | Admin clicks "Delete" with leads selected |

### Lead Detail
| Message | Trigger |
|---------|---------|
| Toast: "Disposition required" | Back navigation attempted before disposition marked after a call |
| Toast: "No pledge card found" | View Pledge Card clicked, no cards uploaded |
| Toast: "Unable to open pledge card" | Missing document ID or fetch failure |

### Verify OTP
| Message | Trigger |
|---------|---------|
| "Please check the otp entered" (red inline) | Wrong OTP submitted |
| Toast with API error | HTTP failure or 403 response |
| "Verify Now" disabled | Input < 4 digits |

### Meeting — Add Details
| Message | Trigger |
|---------|---------|
| "Continue" disabled | Photo not taken |
| Toast: "Something Went Wrong..." | API failure |

### Meeting — Meet / Feedback
| Message | Trigger |
|---------|---------|
| Toast: "Something Went Wrong..." | API failure on End Meeting or Submit Feedback |
| "Update Feedback" disabled | Empty text area |

---

## C — Data-Testid Attributes

No `data-testid` attributes are currently set on any interactive elements. Automation should use text/label-based selectors until these are added.

**Recommended selectors:**

| Element | Suggested Selector |
|---------|--------------------|
| Login phone input | Input field (first input on page) |
| "Send OTP" button | Button text: `"Send OTP"` |
| OTP input (login) | Placeholder: `"0000"` or second input on page |
| "Login" button | Button text: `"Login"` |
| Tab: "Action Required" | Text: `"Action Required"` |
| Tab: "In Progress" | Text: `"In Progress"` |
| Tab: "Completed" | Text: `"Completed"` |
| Filter icon | Top-right button beside lead count label |
| "Apply" filter button | Text matching `/Apply/` |
| Lead count label | Text matching `/showing \d+ of \d+ leads/` |
| Lead card | Pressable containing phone + name text |
| "Dialer call" button | Button text: `"Dialer call"` |
| Lead Disposition select | Label text: `"Lead Disposition"` |
| Lead Status select | Label text: `"Lead Status"` |
| OTP input (meeting) | Placeholder: `"0000"` |
| "Verify Now" button | Button text: `"Verify Now"` |
| "Send Again" button | Button text: `"Send Again"` |
| "End" button (meet step) | Button text: `"End"` |
| "Update Feedback" button | Button text: `"Update Feedback"` |
| "Continue" button | Button text: `"Continue"` |
| "Check-In" button | Button text: `"Check-In"` |
| "Check-Out" button | Button text: `"Check-Out"` |
| "View History" link | Text: `"View History"` |
| "View Pledge Card" link | Text: `"View Pledge Card"` |
| Delete confirm "Yes" | Text: `"Yes"` inside alert dialog |
| "Select All" checkbox | Label: `"Select All"` |
| "Assign to" button | Button text: `"Assign to"` |
| "Delete" button (bulk) | Button text: `"Delete"` |

> **Recommendation:** Add `data-testid` attributes to all interactive elements before building automated tests. Priority: lead card header, all CTA buttons in the leads list, filter controls, and all meeting flow buttons.

---

## D — Document Uploads

There are **no document uploads** (file picker, PDF, image file) on the leads list or lead detail pages.

The only "uploads" are **in-app camera captures**:

| Where | What | How |
|-------|------|-----|
| Check-In | Agent selfie | In-app camera capture |
| Check-Out | Agent selfie | In-app camera capture |
| Meeting — Add Details (Step 1) | Selfie at customer location | In-app camera capture |

- File format: JPEG/PNG from camera (base64 encoded, prefix stripped before API call).
- No file size limit visible in code.
- No `<input type="file">` — camera only, no manual file picker.
