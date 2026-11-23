# Engine logs

The engine reads back its own log files so a dashboard can show them. This is
for dashboards and operators; services keep writing logs exactly as before.

## What is read

Every service writes one JSON record per line to
`<log dir>/<service>_YYYYMMDD_HHMM.log` (see `shared/common/*/logging`). The log
directory is the one the logger resolves: `WOOFX3_LOG_DIR`, anchored in the data
directory when relative. Span files, `<service>_traces_*.log`, are not records;
they are left out of the listing and the search, and included in the export.

A line that is not a JSON object (a printed stack trace, a half-written line) is
returned as a record of level `unknown` holding the raw text, never dropped.
Records with no `service` take the service named by their file.

## RPC

| Method | Does |
|---|---|
| `listLogFiles()` | The record files, newest write first, with size and last write time. |
| `queryLogs(query)` | Records newest first. Filters: `levels`, `services`, `from` (inclusive), `to` (exclusive), `text` (case-insensitive substring over the whole line, metadata included). Pages by `cursor` / `nextCursor`. |
| `createLogAccess(scope)` | A token for `GET /logs/stream` (scope `stream`) or `GET /logs/export` (scope `export`). |

A query reads files from the end, so a page costs about what it returns. It also
stops after a fixed amount of log (`scanBudgetBytes`) and returns what it found
with a cursor, so a search for something rare never holds a request open. A page
can therefore hold fewer than `limit` records and still have a `nextCursor`;
keep asking until it is null.

The engine does not decide who may read logs. The caller is an authenticated
client, and a dashboard that serves other people checks that they may read logs
and, for `export`, that they administer the engine, before it asks for a token.

## HTTP routes

A browser's `EventSource` and download link cannot send headers or speak the RPC
protocol, so two plain routes take a short-lived token in the query string:

- `GET /logs/stream?token=...&levels=error,warn&services=api&text=...` is a
  server-sent event stream of lines written after it connects. Each event has
  `event: log`, the record as JSON in `data`, and an `id` that is a resume
  position. A client that reconnects sends `Last-Event-ID` (an `EventSource` does
  this itself) and receives what it missed, once. A bad filter or resume position
  answers 400 rather than opening an empty stream.
- `GET /logs/export?token=...` streams a zip of every log file, trace files
  included, as it reads them.

Both answer `401` for a missing, expired, tampered or wrong-scope token and `405`
for anything but GET. A token names one scope and lives for a minute; the signing
key exists only in memory, so a restart voids every token.

## Cursors

A record's `cursor` is `<file>:<byte offset of its line>`. Cursors name files
through the listing, never by joining the given name onto the directory, so a
cursor cannot point outside the log directory. One naming a file that has since
been removed is an error.
