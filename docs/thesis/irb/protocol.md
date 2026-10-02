# Research Protocol (draft for the Ethics Committee)

> Draft prepared from the project's code and plan. Fields in **[brackets]** must be
> completed by the researcher. Adapt the headings to Metropolitan University's own
> ethics application form if it prescribes one.

## 1. Study details

| Item | Value |
|------|-------|
| Title | AEGIS BOT SHIELD: Distinguishing Human and Automated Web Traffic with Behavioural and Network Signals |
| Principal investigator | Dipro Debnath, B.Sc. CSE student, Metropolitan University, Sylhet |
| Supervisor | Rishad Amin Pulok, Lecturer, Department of CSE |
| Contact | **[student e-mail and phone]** |
| Planned period | Data collection **[start date, after approval]** – **[end date]** (about two weeks) |
| Funding | None |

## 2. Purpose

Automated programs ("bots") imitate people on websites to steal accounts, scrape
content and abuse forms. This study tests whether a detection system can tell
real people from bots using **how** a page is used (timing of mouse movements,
key presses and scrolling) together with network information, without
CAPTCHAs. Human sessions from volunteers are compared with bot sessions that the
researcher generates. Results are reported in the B.Sc. thesis and may
be submitted to a conference.

## 3. Participants

- **Number:** 30–50 adults.
- **Inclusion:** aged 18 or over; able to use a computer or smartphone browser.
- **Exclusion:** none beyond the above. Participants who withdraw are excluded from analysis.
- **Recruitment:** voluntary invitation to students and acquaintances (notice in
  class / message). No pressure, no academic credit or grade effect, no payment
  **[or state any small token of appreciation]**. Students taught by the supervisor
  are told explicitly that participation has no effect on their marks.

## 4. Procedure (about 10–15 minutes per participant)

1. The participant reads the information sheet and signs the consent form
   (English or Bangla).
2. The researcher gives the participant a study code (P01, P02 …) and opens the
   study website on a lab computer or the participant's own device.
3. The participant performs ordinary tasks on a test shop website: log in with a
   **dummy account provided by the researcher**, search for a product, open
   product pages, add an item to the cart and complete a fake checkout (no real
   payment details). They use the site as they normally would.
4. While the site is used, the browser computes summary numbers about mouse,
   keyboard, scroll and touch behaviour and sends them to the study server (see
   `data_dictionary.md`).
5. The participant may stop at any time.

Bot sessions are produced separately by the researcher, using automation tools
(Python requests, Selenium, Puppeteer, Playwright, Scrapy) against the same
test website only. No third-party website is targeted.

## 5. Data collected

Listed field by field in `data_dictionary.md`. In summary:

- **Stored:** 50 aggregate behavioural/network numbers per report, a random
  session id hash, the study code, detection scores.
- **Not stored:** IP address, browser user-agent, device fingerprint hash (used
  only in memory during the visit).
- **Never collected:** which keys were pressed or any typed text, passwords
  (dummy values are supplied), screenshots, recordings, camera, microphone,
  location, browsing outside the study site.

## 6. Risks and how they are reduced

| Risk | Level | Mitigation |
|------|-------|------------|
| Re-identification from behaviour data | Low | Only aggregates are stored; no raw keystrokes or pointer paths; study code kept separately from the data |
| Exposure of personal credentials | None | Dummy accounts and fake checkout; participants are told not to enter real data |
| Discomfort / time | Minimal | 10–15 min; can stop anytime without giving a reason |
| Data breach | Low | Encrypted storage, access limited to researcher and supervisor, no direct identifiers in the dataset |

No deception is used. The study is believed to be **minimal risk**; the
researcher requests **[expedited/exempt]** review if the committee's rules allow it.

## 7. Confidentiality and storage

- The signed consent forms and the code key list (name ↔ study code) are kept
  on paper in a locked place / in an encrypted file held by the researcher,
  separate from the dataset.
- The dataset (no names) is stored on an encrypted drive and in a private
  repository accessible only to the researcher and supervisor. Server request
  logs are disabled or store only truncated IP prefixes.
- Results are published only as aggregate statistics; no individual session is
  identifiable.
- Retention: the dataset is kept until **[thesis defence + publication, e.g. 2 years,
  or per university policy]**, then deleted; the code key list is destroyed when
  data collection ends.

## 8. Voluntary participation and withdrawal

Participation is voluntary. A participant can withdraw during the session or
within **[e.g. 2 weeks]** afterwards by giving their study code; their records
are then deleted. Withdrawal has no consequence.

## 9. Benefits

No direct benefit. Participants contribute to research on protecting websites
from automated abuse.

## 10. Attachments

- `consent_en.md` — information sheet and consent form (English)
- `consent_bn.md` — information sheet and consent form (Bangla)
- `data_dictionary.md` — complete list of data fields
