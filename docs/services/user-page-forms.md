# User page forms

A streamer's public page can carry forms. The dashboard's backend owns the
pages and keeps a durable outbox of what viewers send; it hands each submission
to the engine and resends until the engine confirms. Viewers never cause an
engine call directly. Workflows act on the result through the
`userpage.form.submitted` trigger.

Engines advertise this as the `userPages.formSubmissions` capability.

## Delivery

```ts
deliverUserPageSubmission(delivery: UserPageSubmissionDelivery): Promise<UserPageSubmissionReceipt>
```

`UserPageSubmissionDelivery` is declared in `shared/clients/typescript/api/api.ts`.
The route validates it (`api/src/routes/user-pages.ts`) and db-proxy's
`UserPageSubmissionService.RecordUserPageSubmission` writes it.

The answer is a commitment: the row in `user_page_submissions` and the outbox
event that queues the trigger commit in one transaction before the route
answers. `submissionId` is the row's primary key, so racing or repeated
deliveries resolve in the database.

| Outcome | Over capnweb | Sender should |
|---|---|---|
| New submission | resolves `{ status: "recorded" }` | mark it delivered |
| `submissionId` already recorded | resolves `{ status: "duplicate" }`, and no event | mark it delivered |
| Malformed | rejects with a message starting `UserPageSubmissionRefused: `, which `isUserPageSubmissionRefused` from `@woofx3/api/rpc` recognises | fail it permanently |
| Anything else (db-proxy, connection, session) | rejects with any other error; nothing was recorded | resend |

capnweb carries only an error's message, so the refusal is carried by its
marker, as with `registerClient` and `authenticate`. A refusal names the
offending paths and codes (`fields.3.value: too_big`).

A delivery is malformed when it breaks the shape in `api.ts` or any of:

- at most 20 fields, with unique ids of `[A-Za-z0-9_-]`, up to 255 characters
- each value at most 5000 characters, a boolean on a `checkbox` and a string on
  any other type
- `submissionId`, `pageId` and `formId` non-empty, up to 255 characters
- `formTitle`, labels, the viewer's display name and roles up to 255 characters;
  `viewer.platform` 1 to 50 and `viewer.platformUserId` 1 to 100
- no NUL character or lone surrogate in any string, since Postgres cannot store
  them and the failure would otherwise look transient on every resend

Unknown keys in a delivery are dropped, so a newer sender is not refused.

Answers and the viewer's identity are untrusted and personal: neither the route
nor db-proxy logs them, only ids.

## The trigger

`woofx3:trigger:userpage_form_submitted`, event `userpage.form.submitted`:

```json
{
  "submissionId": "sub-1",
  "pageId": "page-1",
  "formId": "form-1",
  "formTitle": "Song requests",
  "submittedAt": "2026-10-31T12:00:00Z",
  "viewer": { "platform": "twitch", "platformUserId": "42", "displayName": "Wolfy", "roles": ["moderator"] },
  "fields": [
    { "id": "song", "label": "Song", "type": "text", "value": "Never gonna" },
    { "id": "agree", "label": "I agree", "type": "checkbox", "value": false }
  ],
  "answers": { "song": "Never gonna", "agree": false }
}
```

`formTitle` is empty when the form has none, and `submittedAt` is normalized to
UTC. Each submission fires once.

`delivery.viewer` is `null` for an anonymous viewer, and the event then carries:

```json
{ "platform": null, "platformUserId": null, "displayName": "anonymous", "roles": [] }
```

So `${trigger.data.viewer.displayName}` always resolves, and gives `anonymous`
with no fallback needed. To tell anonymous submissions apart or replace the name,
test `viewer.platformUserId` for null:
`${trigger.data.viewer.platformUserId == null ? 'friend' : trigger.data.viewer.displayName}`.
Do not test `displayName`: a signed-in viewer can really be called `anonymous`.

- `${trigger.data.answers.song}` reads an answer by field id, which `fields`
  cannot do because a path only indexes an array by position. An id made only of
  digits is read as an array index, so it cannot be read this way.
- The trigger's optional `form` field matches `formId`.
- `viewer.platformUserId` is the viewer's identity, and `viewer.platform` also
  goes on the event's `platform` extension, so `${viewer.*}` and viewer facts
  work. An anonymous submission has no `platform` extension and names no viewer:
  it counts toward no fact, no facts are read, and every `${viewer.*}` path,
  `id` and `name` included, is null. Use `trigger.data.viewer` for the name.

`userpage.` is a reserved subject namespace
([Engine integrity](./engine-integrity.md#reserved-subjects)), so only db-proxy
can assert a submission: `triggerEvent` and `simulateTwitchEvent` refuse it. To
test a workflow, use `triggerWorkflowByName` with sample `triggerData`.

## Retention

Submissions are kept indefinitely. The primary key is also what recognizes a
resend, so any pruning has to outlast the sender's retry window. The outbox copy
of each event is pruned with the rest of `worker_events`.
