import { describe, expect, test } from "bun:test";
import type { UserPageSubmissionDelivery, UserPageSubmissionReceipt } from "@woofx3/api";
import { isUserPageSubmissionRefused } from "@woofx3/api/rpc";
import type * as user_page_submission from "@woofx3/db/user_page_submission.pb";
import { RPC_METHODS } from "../src/api-session";
import { DbError } from "../src/db-client";
import { userPagesRoutes } from "../src/routes/user-pages";

const delivery: UserPageSubmissionDelivery = {
  submissionId: "sub-1",
  pageId: "page-1",
  formId: "form-1",
  formTitle: "Song requests",
  submittedAt: "2026-10-31T12:00:00.000Z",
  viewer: { platform: "twitch", platformUserId: "42", displayName: "Wolfy", roles: ["moderator"] },
  fields: [
    { id: "song", label: "Song", type: "text", value: "Secret answer" },
    { id: "agree", label: "Agree", type: "checkbox", value: false },
  ],
};

type RecordRequest = user_page_submission.RecordUserPageSubmissionRequest;

/** The route touches only `db`, so that is all the host needs here. */
function deliver(input: unknown, record: (req: RecordRequest) => Promise<boolean>): Promise<UserPageSubmissionReceipt> {
  const route = userPagesRoutes.deliverUserPageSubmission as unknown as (
    delivery: unknown
  ) => Promise<UserPageSubmissionReceipt>;
  return route.call({ db: { recordUserPageSubmission: record } }, input);
}

function neverRecorded(): Promise<boolean> {
  throw new Error("a malformed delivery reached the db");
}

describe("deliverUserPageSubmission", () => {
  test("is reachable over RPC", () => {
    expect(RPC_METHODS).toContain("deliverUserPageSubmission");
  });

  test("answers recorded once the db wrote it, carrying each answer in its own type", async () => {
    let request: RecordRequest | undefined;
    const receipt = await deliver(delivery, async (req) => {
      request = req;
      return true;
    });

    expect(receipt).toEqual({ status: "recorded" });
    expect(request?.submissionId).toBe("sub-1");
    expect(request?.submittedAt?.seconds).toBe(BigInt(Date.parse(delivery.submittedAt) / 1000));
    expect(request?.fields[0]).toMatchObject({ id: "song", textValue: "Secret answer", checkedValue: undefined });
    expect(request?.fields[1]).toMatchObject({ id: "agree", textValue: undefined, checkedValue: false });
  });

  test("takes an anonymous viewer and an empty form", async () => {
    let request: RecordRequest | undefined;
    await deliver({ ...delivery, viewer: null, fields: [] }, async (req) => {
      request = req;
      return true;
    });

    expect(request?.viewer).toBeNull();
    expect(request?.fields).toEqual([]);
  });

  test("answers duplicate when the id was already recorded", async () => {
    expect(await deliver(delivery, async () => false)).toEqual({ status: "duplicate" });
  });

  const answer = (value: unknown) => [{ id: "song", label: "Song", type: "text", value }];
  const malformed: [string, unknown][] = [
    ["not an object", "nope"],
    ["no submission id", { ...delivery, submissionId: "" }],
    ["a date that is not ISO 8601", { ...delivery, submittedAt: "yesterday" }],
    ["no viewer key", { ...delivery, viewer: undefined }],
    ["a viewer without an id", { ...delivery, viewer: { ...delivery.viewer, platformUserId: "" } }],
    ["an unknown field type", { ...delivery, fields: [{ id: "a", label: "A", type: "file", value: "x" }] }],
    ["a checkbox with a string", { ...delivery, fields: [{ id: "a", label: "A", type: "checkbox", value: "x" }] }],
    ["a text field with a boolean", { ...delivery, fields: answer(true) }],
    ["a value over 5000 characters", { ...delivery, fields: answer("x".repeat(5001)) }],
    ["a NUL in a value", { ...delivery, fields: answer("a\0b") }],
    ["a lone surrogate in a value", { ...delivery, fields: answer("a\ud800b") }],
    ["a field id no workflow path can name", { ...delivery, fields: [{ ...answer("x")[0], id: "a.b" }] }],
    ["a repeated field id", { ...delivery, fields: [...answer("x"), ...answer("y")] }],
    [
      "more than 20 fields",
      {
        ...delivery,
        fields: Array.from({ length: 21 }, (_, i) => ({ id: `f${i}`, label: "F", type: "text", value: "" })),
      },
    ],
  ];
  for (const [name, input] of malformed) {
    test(`refuses ${name}`, async () => {
      const failure = await deliver(input, neverRecorded).catch((err: unknown) => err);
      expect(isUserPageSubmissionRefused(failure)).toBe(true);
    });
  }

  test("accepts exactly 20 fields and a value of exactly 5000 characters", async () => {
    const fields = Array.from({ length: 20 }, (_, i) => ({
      id: `f${i}`,
      label: "F",
      type: "textarea",
      value: "x".repeat(5000),
    }));
    expect(await deliver({ ...delivery, fields }, async () => true)).toEqual({ status: "recorded" });
  });

  test("names a problem without quoting the answer", async () => {
    const secret = "Secret answer";
    const failure = await deliver(
      { ...delivery, fields: [{ id: "a", label: "A", type: "checkbox", value: secret }] },
      neverRecorded
    ).catch((err: unknown) => err);

    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toContain("fields.0.value");
    expect((failure as Error).message).not.toContain(secret);
  });

  test("refuses what the db calls invalid", async () => {
    const failure = await deliver(delivery, async () => {
      throw new DbError("recordUserPageSubmission", "invalid_argument", "fields[0].id is invalid");
    }).catch((err: unknown) => err);

    expect(isUserPageSubmissionRefused(failure)).toBe(true);
  });

  test("leaves a failed write unconfirmed and retryable", async () => {
    const failure = await deliver(delivery, async () => {
      throw new DbError("recordUserPageSubmission", "internal", "transaction failed");
    }).catch((err: unknown) => err);

    expect(failure).toBeInstanceOf(DbError);
    expect(isUserPageSubmissionRefused(failure)).toBe(false);
  });
});
