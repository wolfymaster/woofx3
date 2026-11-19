// A schema bound read from the document the validator reads, not copied: a wrong path throws at first use.
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { StreamOnlineEventType } from "../gen/ts/nats.31";

const doc = JSON.parse(readFileSync(`${import.meta.dir}/../work/nats.31.json`, "utf8"));
const bound = (pointer: string): number => {
  const v = pointer.split("/").reduce((n: any, k) => n?.[k], doc);
  if (typeof v !== "number") { throw new Error(`no numeric bound at ${pointer}`); }
  return v;
};

test("a bound and an enum list come from the contract", () => {
  expect(bound("components/schemas/StreamOnlineEvent/properties/twitchUserId/maxLength")).toBe(200);
  expect(Object.values(StreamOnlineEventType)).toEqual(["stream.online"]);
});
