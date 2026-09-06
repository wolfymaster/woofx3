# Welcome to Remix!

- 📖 [Remix docs](https://remix.run/docs)

## Development

Run the dev server:

```shellscript
npm run dev
```

## Deployment

First, build your app for production:

```sh
npm run build
```

Then run the app in production mode:

```sh
npm start
```

Now you'll need to pick a host to deploy it to.

### DIY

If you're familiar with deploying Node applications, the built-in Remix app server is production-ready.

Make sure to deploy the output of `npm run build`

- `build/server`
- `build/client`

## Styling

This template comes with [Tailwind CSS](https://tailwindcss.com/) already configured for a simple default starting experience. You can use whatever css framework you prefer. See the [Vite docs on css](https://vitejs.dev/guide/features.html#css) for more information.

## Logging

Server-side code uses the shared logger from `@woofx3/common/logging` via the
module singleton in `logger.ts`, so streamlabs writes the same
`logs/streamlabs_YYYYMMDD_HHMM.log` records as every other woofx3 service and
picks up the same `WOOFX3_LOG_*` / `WOOFX3_OTEL_*` configuration. See
`shared/common/typescript/logging/README.md` for the full variable list.

Two things are specific to this app:

- **Server only.** `logger.ts` opens a log file on the local filesystem at
  import time. Import it from `server.ts`, `app/entry.server.tsx`, and the
  `obs/` helpers — never from `app/routes/*` or `app/components/*`, which run
  in the browser. Those keep their `console.*` calls.
- **Remix/Node.** Unlike the other services, streamlabs' Remix SSR bundle is
  built by Vite and executed by Node. `@woofx3/common` is a `file:` dependency,
  so Vite inlines its TypeScript into `build/server/index.js` and externalizes
  `pino` and `@opentelemetry/*` as ordinary node_modules imports. No transport
  or bundler configuration is needed.

`Context.logger` (the `(msg: string) => void` shape the OBS/SLOBS managers
expect) is supplied by the `contextLogger()` adapter in `logger.ts`.
