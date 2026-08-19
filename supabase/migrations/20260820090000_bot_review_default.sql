-- New WhatsApp bots review before sending.
--
-- whatsapp_bot_settings.review_mode defaulted to 'auto', so a business that
-- connected WhatsApp had an assistant replying to real clients, in the
-- business's name, before anyone had seen a single draft. Review-first is the
-- safer starting position; auto-send stays one tap away in Bot Setup.
--
-- Only the default changes. Every existing row holds an explicit value already,
-- so no business that has chosen a mode has it changed underneath them.

ALTER TABLE public.whatsapp_bot_settings
  ALTER COLUMN review_mode SET DEFAULT 'approval_required';
