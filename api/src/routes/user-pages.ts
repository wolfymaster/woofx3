import type { UserPageSubmissionDelivery, UserPageSubmissionReceipt } from "@woofx3/api";
import { userPageSubmissionRefusedMessage } from "@woofx3/api/rpc";
import type * as user_page_submission from "@woofx3/db/user_page_submission.pb";
import { z } from "zod";
import { DbError } from "../db-client";
import { routeModule } from "./context";
import { timestampFromDate } from "./helpers";

/**
 * Limits of one delivery. `fields` and `value` mirror USER_PAGE_LIMITS in
 * woofx3-ui's shared/user-pages/limits.ts, and every limit must match
 * db/app/services/user_page_submission_service.go.
 */
const SUBMISSION_LIMITS = {
  id: 255,
  text: 255,
  fields: 20,
  value: 5000,
  platform: 50,
  platformUser: 100,
  roles: 50,
} as const;

/**
 * Postgres can hold neither NUL nor a lone surrogate in JSONB, so a delivery
 * carrying one would fail on every resend as if the failure were transient.
 */
function storable(limit: number) {
  return z
    .string()
    .max(limit)
    .refine((text) => !text.includes("\0") && !/\p{Cs}/u.test(text), "not storable");
}

const fieldBase = {
  /** A key of the event's `answers`, so limited to what a workflow path can name. */
  id: z
    .string()
    .max(SUBMISSION_LIMITS.id)
    .regex(/^[A-Za-z0-9_-]+$/),
  label: storable(SUBMISSION_LIMITS.text),
};

const fieldSchema = z.discriminatedUnion("type", [
  z.object({
    ...fieldBase,
    type: z.enum(["text", "textarea", "select"]),
    value: storable(SUBMISSION_LIMITS.value),
  }),
  z.object({ ...fieldBase, type: z.literal("checkbox"), value: z.boolean() }),
]);

const requiredId = (limit: number) => storable(limit).min(1);

const deliverySchema = z.object({
  submissionId: requiredId(SUBMISSION_LIMITS.id),
  pageId: requiredId(SUBMISSION_LIMITS.id),
  formId: requiredId(SUBMISSION_LIMITS.id),
  formTitle: storable(SUBMISSION_LIMITS.text).optional(),
  submittedAt: z.iso.datetime({ offset: true }),
  viewer: z
    .object({
      platform: requiredId(SUBMISSION_LIMITS.platform),
      platformUserId: requiredId(SUBMISSION_LIMITS.platformUser),
      displayName: storable(SUBMISSION_LIMITS.text),
      roles: z.array(storable(SUBMISSION_LIMITS.text)).max(SUBMISSION_LIMITS.roles),
    })
    .nullable(),
  fields: z
    .array(fieldSchema)
    .max(SUBMISSION_LIMITS.fields)
    .refine((fields) => new Set(fields.map((field) => field.id)).size === fields.length, "repeated field id"),
});

/**
 * Names each problem by path and code only. A refusal reaches the api's error
 * log, and zod's own messages can quote what they were given.
 */
function refusalOf(error: z.ZodError): Error {
  const problems = error.issues.map((issue) => `${issue.path.join(".") || "delivery"}: ${issue.code}`);
  return new Error(userPageSubmissionRefusedMessage(problems.join("; ")));
}

function toRecordRequest(delivery: UserPageSubmissionDelivery): user_page_submission.RecordUserPageSubmissionRequest {
  return {
    submissionId: delivery.submissionId,
    pageId: delivery.pageId,
    formId: delivery.formId,
    formTitle: delivery.formTitle,
    submittedAt: timestampFromDate(new Date(delivery.submittedAt)),
    viewer: delivery.viewer,
    fields: delivery.fields.map((field) => ({
      id: field.id,
      label: field.label,
      type: field.type,
      textValue: typeof field.value === "string" ? field.value : undefined,
      checkedValue: typeof field.value === "boolean" ? field.value : undefined,
    })),
  };
}

export const userPagesRoutes = routeModule({
  async deliverUserPageSubmission(delivery: UserPageSubmissionDelivery): Promise<UserPageSubmissionReceipt> {
    const parsed = deliverySchema.safeParse(delivery);
    if (!parsed.success) {
      throw refusalOf(parsed.error);
    }
    try {
      const created = await this.db.recordUserPageSubmission(toRecordRequest(parsed.data));
      return { status: created ? "recorded" : "duplicate" };
    } catch (err) {
      if (err instanceof DbError && err.code === "invalid_argument") {
        throw new Error(userPageSubmissionRefusedMessage(err.message));
      }
      throw err;
    }
  },
});
