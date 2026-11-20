# Personal Cash-Flow & UPI Expense Tracker — Project Blueprint

## 1. Project Overview
A zero-expiration personal finance Progressive Web App (PWA) paired with iOS Shortcuts automation, hosted on DigitalOcean with PostgreSQL.
- **Core Problem:** Frictionless Google Pay / UPI payments (₹2 to ₹1,42,000) and family obligations leak cash without clear context on bank statements.
- **Core Solution:** Automatically capture every bank SMS (`DEBIT` and `CREDIT`), sort transactions into **Month Buckets**, prompt the user immediately on iPhone after manual UPI spends to record a short free-text description (*"What was this for?"*), and run an AI audit at month-end to cluster spending and identify leakage.
- **Zero-Expiration Design:** Built as an HTTPS Home Screen Web App (PWA) + Apple Shortcuts Personal Automation—never expires after 7 days and requires ₹0 in Apple Developer fees.

---

## 2. Core Business Logic: Month Buckets & Salary Carryover

### A. Automatic Month Bucket Creation
Before saving any incoming transaction, the backend resolves its target `month_key` (`YYYY-MM` in `Asia/Kolkata`):
1. Check if `month_buckets` contains `month_key`.
2. If not, create the bucket automatically and carry forward the closing balance from the previous month's bucket as `opening_balance`.
3. Insert the transaction under that `bucket_id`.

### B. The 25th–31st Salary Carryover Rule ("Month-Ahead" Method)
- **Salary Window:** Salary (₹1,42,000 NEFT) lands between the **26th and 29th** of the month.
- **Rule:** When a `SALARY` credit arrives between the **25th and 31st** of Month N, assign it to **Month N+1's bucket** (e.g., salary arriving Nov 27, 2026 goes directly into the `2026-12` bucket).
- **Operational Habit:** Hold off on manual debt repayments and family transfers until the **1st of the new month** so all debt EMIs, obligations, and daily expenses deduct cleanly inside the new month's bucket (while keeping bank auto-debit EMIs on their official due dates).

### C. SMS Classification & Notification Filtering
| SMS Type | Detection Keywords | Bucket Action | Buzzes iPhone? |
|---|---|---|---|
| **Salary Credit** | `credited` + `NEFT` + amount >= ₹1,40,000 | `type: IN`, `channel: SALARY` -> assigned to **Next Month** (if 25th–31st) | **No** (Silent) |
| **Other Credits** | `credited` (refunds, transfers in) | `type: IN`, `channel: OTHER_IN` -> Current Month | **No** (Silent) |
| **Auto-Debit / EMI** | `debited` + (`ACH`, `NACH`, `EMI`, `ECS`, `SI`) | `type: OUT`, `channel: EMI_AUTOPAY`, auto-noted `"Auto-Debit / EMI"` | **No** (Silent) |
| **Manual UPI / Card** | `debited` / `sent` / `spent` + (`UPI`, `VPA`, `POS`) | `type: OUT`, `channel: UPI`, `needs_note: true` | **Yes** (Asks *"What was this for?"*) |
| **Noise / Reminders** | `OTP`, `due on`, `reminder`, `scheduled`, `declined` | Ignored at API gateway (`200 OK`, not saved) | **No** (Dropped) |

---

## 3. Tech Stack & Infrastructure
- **Frontend / PWA & Admin Portal:** Next.js (App Router) + Tailwind CSS (configured with `manifest.json` `"display": "standalone"` and Service Worker for iOS Web Push).
- **Backend API:** Next.js API Routes (or Node.js / Fastify) with `web-push` (VAPID keys).
- **Database:** PostgreSQL 16 (running via Docker on a $4–$6/month DigitalOcean Droplet).
- **Reverse Proxy & SSL:** Caddy (automatic Let's Encrypt HTTPS—mandatory for iOS Web Push).
- **Month-End AI Audit:** Gemini API (or OpenAI API) batch-processing free-text notes + merchant VPAs into dynamic spending clusters.

---

## 4. Database Schema (PostgreSQL)

    -- 1. Monthly Buckets (Created automatically on first transaction of a cycle)
    CREATE TABLE month_buckets (
      id SERIAL PRIMARY KEY,
      month_key VARCHAR(7) UNIQUE NOT NULL,        -- Format: '2026-12'
      label VARCHAR(32) NOT NULL,                  -- Format: 'December 2026'
      opening_balance NUMERIC(12, 2) DEFAULT 0.00, -- Carryover from prior month
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    -- 2. Individual Transactions
    CREATE TABLE transactions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      bucket_id INT NOT NULL REFERENCES month_buckets(id) ON DELETE CASCADE,
      txn_type VARCHAR(10) NOT NULL CHECK (txn_type IN ('IN', 'OUT')),
      channel VARCHAR(20) NOT NULL,                -- 'SALARY', 'OTHER_IN', 'EMI_AUTOPAY', 'UPI', 'CARD'
      amount NUMERIC(12, 2) NOT NULL,
      merchant_vpa TEXT,                           -- Extracted UPI ID or merchant name
      raw_sms TEXT NOT NULL,
      sms_hash VARCHAR(64) UNIQUE NOT NULL,        -- SHA-256 hash to prevent duplicate SMS ingestion
      user_note TEXT,                              -- Free-text description entered via iPhone prompt
      ai_cluster TEXT,                             -- Populated at month-end by AI audit
      needs_note BOOLEAN DEFAULT FALSE,
      transacted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    -- 3. iOS Web Push Subscriptions
    CREATE TABLE push_subscriptions (
      id SERIAL PRIMARY KEY,
      endpoint TEXT UNIQUE NOT NULL,
      p256dh TEXT NOT NULL,
      auth TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    -- 4. Learned Merchant Auto-Tag Rules (Optional convenience)
    CREATE TABLE merchant_rules (
      merchant_vpa TEXT PRIMARY KEY,
      default_note TEXT NOT NULL,
      skip_prompt BOOLEAN DEFAULT FALSE
    );

    CREATE INDEX idx_transactions_bucket ON transactions (bucket_id, transacted_at DESC);

---

## 5. Security & Data Backup Plan
1. **Database Isolation:** Bind PostgreSQL strictly to `127.0.0.1` / Docker internal network. Block port `5432` on the DigitalOcean Cloud Firewall.
2. **Webhook Authentication:** Require a secret header `X-Webhook-Secret: <64-char-random-token>` on `POST /api/log-transaction` (configured inside the iOS Shortcut).
3. **Admin Dashboard Protection:** Protect `/admin` and dashboard routes behind HTTP Basic Auth + secure `HttpOnly` session cookie (or Cloudflare Access Zero Trust).
4. **Automated Daily Encrypted Backups:**
   - Estimated DB size: **~3.7 MB/year** (~19 MB over 5 years at 15 txns/day).
   - Run a daily `cron` job at `02:00 IST` executing `pg_dump`, encrypting with `gpg`/`age`, and uploading to DigitalOcean Spaces (or private storage) with 30-day retention.

---

## 6. iPhone Configuration (One-Time Setup)

### Step 1: Install PWA & Enable Web Push
1. Open `https://your-domain.com` in **Safari** on iPhone.
2. Tap **Share -> Add to Home Screen**.
3. Launch the app from the Home Screen icon (standalone mode) and tap **Enable Notifications** to register the iOS Web Push subscription.

### Step 2: Configure iOS Shortcuts Automations
Open Apple **Shortcuts -> Automation** (or **Library -> Automation** on iOS 27) and create two Personal Automations:
1. **Debit Automation:**
   - **Trigger:** *Message* -> *Message Contains* `"debited"` (add `"sent"` if your bank uses `"Sent Rs..."`).
   - **Execution:** Set to **Run Immediately** (or **Confirm Before Run: Off** + **Allow Running When Locked: On** in iOS 27).
   - **Action:** *Get Contents of URL* -> `POST` to `https://your-domain.com/api/log-transaction` with header `X-Webhook-Secret` and JSON body `{"sms": Shortcut Input}`.
2. **Credit Automation:**
   - **Trigger:** *Message* -> *Message Contains* `"credited"`.
   - **Execution:** **Run Immediately** / **Confirm Before Run: Off**.
   - **Action:** Same `POST` request to `/api/log-transaction`.

---

## 7. Implementation Roadmap (Nov 20 – Dec 1, 2026)
- [ ] **Phase 1 (Nov 20–21): Infrastructure & Database**
  - Provision DigitalOcean Droplet + Docker Compose (`postgres`, `app`, `caddy`).
  - Run PostgreSQL schema migration and configure automated `pg_dump` backup cron.
- [ ] **Phase 2 (Nov 22–23): Backend API & SMS Parser**
  - Build `POST /api/log-transaction` with SHA-256 deduplication, Indian bank SMS regex parser (amount, VPA, NEFT salary, EMI), month-bucket auto-creator, and 25th–31st salary carryover logic.
  - Integrate `web-push` to trigger iOS notifications for `needs_note = true` transactions.
- [ ] **Phase 3 (Nov 24–25): PWA Mobile UI & Month-End Admin Portal**
  - Build `/note/[id]` quick-reply screen (tapping notification opens directly to a single text input + Save button).
  - Build `/` Month Buckets home view (showing Money In, Money Out, Remaining Balance per month).
  - Build `/admin` portal with transaction table, unannotated filter, and 1-click **AI Month-End Audit** button.
- [ ] **Phase 4 (Nov 26–29): Go-Live on Salary Credit**
  - Receive Nov 26–29 NEFT salary (`₹1,42,000`) -> verifies automatic creation of **`December 2026`** bucket.
  - Hold manual debt payments until **December 1**, then run on full autopilot.