/** Raw Telegram message sender shared by internal modules (manager, alerts). */
export async function sendMessage(text: string): Promise<void> {
  const TOKEN   = process.env.TELEGRAM_BOT_TOKEN;
  const CHAT_ID = process.env.TELEGRAM_CHAT_ID;
  if (!TOKEN || !CHAT_ID) return;
  try {
    await fetch(`https://api.telegram.org/bot${TOKEN}/sendMessage`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id:                  CHAT_ID,
        text,
        parse_mode:               'HTML',
        disable_web_page_preview: true,
      }),
    });
  } catch {
    /* non-fatal */
  }
}
