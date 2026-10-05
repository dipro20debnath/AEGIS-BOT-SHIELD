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
- **Devices:** both computer and phone users are invited, so that results are not limited to one kind
  of device. The device used is recorded (section 5).
- **Recruitment:** voluntary invitation to students and acquaintances (notice in
  class / message). No pressure, no academic credit or grade effect, no payment
  **[or state any small token of appreciation]**. Students taught by the supervisor
  are told explicitly that participation has no effect on their marks.

## 4. Procedure (about 10–15 minutes per participant)

The study runs on a dedicated test website (the "study shop", source code in
`study/` of the project repository), on a lab computer or the participant's
own computer or phone.

1. The researcher gives the participant a **study code** (random, e.g.
   `H-7KQ2M9XA`). The name ↔ code list is kept only by the researcher, on paper
   or in an encrypted file, never on the study server.
2. On the website the participant chooses Bangla or English. They then read the
   information sheet (`consent_bn.md` / `consent_en.md`, shown word for word)
   and give consent by ticking four required boxes. One **optional** box covers
   raw timing events (section 5). **Nothing about their behaviour is recorded
   before consent.** **[If the committee requires a signature: the participant
   also signs the paper form, which carries the study code.]**
3. A short survey with fixed answer options, all optional: age group, device,
   pointing device, how often they use a browser, keyboard language, hand.
4. Six ordinary tasks in the test shop, shown one at a time in a bar at the top
   of the page. Every task can be skipped.
   1. Log in with a **dummy username and password shown on the screen**.
   2. Search for a given product and open it.
   3. Find the cheapest product rated 4.0 or more in a category and add it to the cart.
   4. In the cart, set a quantity and remove an item.
   5. Copy given (invented) delivery details into a checkout form and write a
      one-sentence delivery note. No real payment or personal details are asked for.
   6. Write a one- or two-sentence review of a product and give stars.
5. A closing survey, also optional:
   - Did the browser or a password manager fill in fields?
   - Were any automation tools used?
   - Were any assistive tools used?
   - Was the participant interrupted?
   - How easy were the tasks?

   These answers identify sessions that may not represent ordinary use.
6. A thank-you page repeats the study code, needed for withdrawal.

A participant may do a second session with the same code on another device
(e.g. phone after computer), if they wish.

The test shop never blocks or challenges anyone: the detection software only
records what it *would* have decided.

**Bot sessions** are produced by the researcher with automation tools, against
this test website only, using separate bot codes:
- Python requests;
- Selenium;
- Puppeteer with a stealth plugin;
- Playwright, including a mode that imitates human mouse movement and typing.

No third-party website is targeted. Requests from unknown visitors of the
public test website (e.g. web crawlers) carry no study code. They are stored
without any link to a participant and analysed separately.

## 5. Data collected

Listed field by field in `data_dictionary.md`, which is generated from the
software itself. In summary:

- **Every participant:**
  - **Summary numbers** about mouse, keyboard, scroll and touch use per page
    (e.g. average mouse speed, how long keys are held). See the data
    dictionary, §1.
  - **Session, survey and task progress:** study code, language, consent
    version, survey answers, task times and outcomes, browser family and
    operating system family. See §2.
  - **Request metadata:** page pattern, time, header names. See §4.
- **Only with the optional consent (raw timing events):** the time and screen
  position of each pointer movement, click, scroll and key press within the
  study website (§3).
  - **Keys:** only a category is recorded (character, space, Backspace, …),
    never which key or what was typed.
  - **Why:** these events let the summary numbers be recomputed and verified,
    and new measures be tested, without asking participants to come back.
- **Not stored:** IP address, the full browser identification string, header
  values, anything typed into the shop (search text, form contents, reviews),
  device fingerprint.
- **Never collected:**
  - which keys were pressed or any typed text;
  - screenshots or recordings;
  - camera, microphone, location;
  - clipboard content;
  - activity outside the study website.

## 6. Risks and how they are reduced

| Risk | Level | Mitigation |
|------|-------|------------|
| Re-identification from behaviour data | Low | Summary numbers by default. Raw timings only with separate opt-in, without key identities or text. Data are pseudonymous: the exported dataset uses a salted hash of the study code, and the code list is kept apart from the data. No IP addresses. The dataset is not published in raw form without the committee's approval |
| Exposure of personal data or credentials | Very low | Dummy accounts and invented delivery details are shown on screen; participants are told not to enter real data. Typed form contents are checked and discarded, never stored |
| Discomfort / time | Minimal | 10–15 min; every task can be skipped; participants can stop at any time without giving a reason |
| Data breach | Low | HTTPS only; no admin web interface; no access logs; server access limited to the researcher; encrypted copies off the server; server deleted after data collection |

No deception is used. The study is believed to be **minimal risk**; the
researcher requests **[expedited/exempt]** review if the committee's rules allow it.

## 7. Confidentiality and storage

- **Kept apart from the data:** the code key list (name ↔ study code) and any
  signed paper forms. They are kept by the researcher in a locked place or an
  encrypted file.
- **Study server:**
  - The data are stored in a database on the study server, hosted at
    **[provider and region, e.g. a university server in Bangladesh / a cloud
    server in Singapore]**.
  - Only the researcher can log in.
  - The web server writes no access logs.
  - Daily backups stay on the same server.
- **After data collection:**
  - The dataset is exported, and stored on an encrypted drive and in a private
    repository accessible only to the researcher and supervisor.
  - The server, with its backups, is deleted.
- **Publication:** results are published only as aggregate statistics. No
  individual session is identifiable.
- **Retention:** the dataset is kept until **[thesis defence + publication, e.g.
  2 years, or per university policy]**, then deleted. The code key list is
  destroyed when the withdrawal period has ended.

## 8. Voluntary participation and withdrawal

Participation is voluntary. A participant can stop at any time by closing the
website. They can also withdraw within **[e.g. 2 weeks]** afterwards by giving
their study code. All of their records are then deleted from the server (and
from any export), using the study software's `withdraw` command. Withdrawal
has no consequence.

## 9. Benefits

No direct benefit. Participants contribute to research on protecting websites
from automated abuse.

## 10. Attachments

- `consent_en.md` — information sheet and consent form (English)
- `consent_bn.md` — information sheet and consent form (Bangla)
- `data_dictionary.md` — complete list of data fields (generated from the software)
- `screenshots/` — screenshots of the study website, all pages in order ([`screenshots/README.md`](screenshots/README.md) shows them on one page for printing):

| # | File | Shows |
|---|------|-------|
| 1 | [`01_landing.png`](screenshots/01_landing.png) | Start page: purpose in one sentence, language choice (Bangla / English) |
| 2 | [`02_consent_bn.png`](screenshots/02_consent_bn.png) | Information sheet in Bangla (shown word for word from `consent_bn.md`), the four required consent boxes, the optional raw-timing box and the study code field. The yellow DRAFT notice appears until the placeholders are filled in |
| 3 | [`03_consent_en.png`](screenshots/03_consent_en.png) | The same page in English (`consent_en.md`) |
| 4 | [`04_survey_before.png`](screenshots/04_survey_before.png) | Survey before the tasks: fixed options, every question optional ("Prefer not to say") |
| 5 | [`05_task1_login.png`](screenshots/05_task1_login.png) | Task 1: the dark bar at the top shows the task and the dummy username and password; every task has a "Skip this task" button |
| 6 | [`06_task2_search.png`](screenshots/06_task2_search.png) | Task 2: search results |
| 7 | [`07_task3_compare.png`](screenshots/07_task3_compare.png) | Task 3: a category list, where the participant compares prices and ratings |
| 8 | [`08_task4_cart.png`](screenshots/08_task4_cart.png) | Task 4: the cart, with quantity and remove buttons |
| 9 | [`09_task5_checkout.png`](screenshots/09_task5_checkout.png) | Task 5: checkout form with the invented delivery details to copy from the task bar; no payment fields |
| 10 | [`10_task6_review.png`](screenshots/10_task6_review.png) | Task 6: writing a short review and choosing stars |
| 11 | [`11_survey_after.png`](screenshots/11_survey_after.png) | Closing survey (autofill, automation tools, assistive tools, interruptions, difficulty), all optional |
| 12 | [`12_done.png`](screenshots/12_done.png) | Thank-you page repeating the study code, which is needed to withdraw |
| 13 | [`13_phone_consent_bn.png`](screenshots/13_phone_consent_bn.png) | Consent page on a phone |
| 14 | [`14_phone_task1_login.png`](screenshots/14_phone_task1_login.png) | A task page on a phone |

The consent pages carry a yellow DRAFT notice until the placeholders in the information sheets are filled in. Re-take the screenshots afterwards with `node docs/thesis/irb/screenshots/capture.mjs`.
