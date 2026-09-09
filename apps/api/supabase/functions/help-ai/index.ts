/**
 * POST /functions/v1/help-ai — KB-grounded help answers (V2_PLAN §1 support, §6.3).
 *
 * headers: Authorization: Bearer <jwt>, x-device-hash
 * body:    { question, context?: string[] }   context = help.json entries the client's search matched
 *          (plain text or json strings { title, url?, body }); at most 12 are used.
 * returns: { answer, sources: string[], model }
 * env:     GROQ_API_KEY (required), HELP_AI_MODEL (optional, default openai/gpt-oss-120b)
 *
 * every question is logged as an `events` row (kind help_ai_question) so the admin sees what people
 * ask and what the KB could not answer.
 */
import { authenticate, enforceRateLimit } from "../_shared/auth.ts";
import { deviceFromRequest } from "../_shared/device.ts";
import { optionalEnv } from "../_shared/env.ts";
import { emitEvent } from "../_shared/events.ts";
import {
  buildHelpMessages,
  extractSources,
  groqChat,
  HELP_AI_MAX_QUESTION_CHARS,
  HELP_AI_MODEL,
} from "../_shared/groq.ts";
import { HELP_AI_PER_HOUR, RATE_WINDOW_SECONDS } from "../_shared/limits.ts";
import { HttpError, json, readJsonObject, serve } from "../_shared/response.ts";

interface HelpRequest extends Record<string, unknown> {
  question?: unknown;
  context?: unknown;
}

serve(async (req) => {
  const ctx = await authenticate(req);
  const body = await readJsonObject<HelpRequest>(req);
  if (
    typeof body.question !== "string" || body.question.trim().length < 3 ||
    body.question.length > HELP_AI_MAX_QUESTION_CHARS
  ) {
    throw new HttpError(400, "invalid_question", `question must be 3..${HELP_AI_MAX_QUESTION_CHARS} characters`);
  }
  const context = body.context === undefined ? [] : body.context;
  if (!Array.isArray(context) || context.length > 50) {
    throw new HttpError(400, "invalid_context", "context must be an array of ≤ 50 strings");
  }

  const apiKey = optionalEnv("GROQ_API_KEY");
  if (!apiKey) {
    throw new HttpError(503, "help_ai_unavailable", "the assistant is not configured; please contact support instead");
  }

  await enforceRateLimit(ctx.db, `help_ai:${ctx.userId}`, HELP_AI_PER_HOUR, RATE_WINDOW_SECONDS, 1);
  const { deviceHash } = await deviceFromRequest(req, ctx);

  const question = body.question.trim();
  const { messages, sources } = buildHelpMessages(question, context);
  const model = optionalEnv("HELP_AI_MODEL", HELP_AI_MODEL);
  const result = await groqChat(messages, { apiKey, model });

  await emitEvent(ctx.db, ctx.userId, deviceHash, "help_ai_question", {
    question: question.slice(0, 300),
    context_count: sources.length,
    model,
    ok: result.ok,
    error: result.ok ? null : `${result.status}: ${result.error.slice(0, 120)}`,
  });

  if (!result.ok) {
    throw new HttpError(502, "help_ai_failed", "the assistant did not answer; please try again or contact support", {
      upstream_status: result.status,
    });
  }
  return json({ answer: result.answer, sources: extractSources(result.answer, sources), model: result.model });
});
