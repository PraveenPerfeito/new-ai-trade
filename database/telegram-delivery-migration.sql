-- TELEGRAM.RELIABILITY.1 WS2 — delivery ground truth
-- telegram_sent (existing)      = alert was QUEUED for delivery
-- telegram_delivered = true     = Telegram API returned 200 (confirmed send)
-- telegram_delivered = false    = send failed after retries (error recorded)
-- telegram_delivered IS NULL    = pre-migration rows / queued-but-unresolved
--
-- Written best-effort by the drain worker in telegram_notifier.py — the code
-- tolerates this migration not being run (failures are debug-logged), so it
-- can be applied before or after deploy with zero risk.

ALTER TABLE signals
  ADD COLUMN IF NOT EXISTS telegram_delivered BOOLEAN,
  ADD COLUMN IF NOT EXISTS telegram_delivery_error TEXT;
