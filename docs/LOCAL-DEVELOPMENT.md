# Website and relay development

[← SharedBoard.app](../README.md) · [Connections](../CONNECTIONS.md) · [Hosting](../HOSTING.md)

People using SharedBoard start at the website and connect a compatible existing AI conversation through the hosted relay. This guide is for contributors working on the source. It is not an end-user installation guide.

## Prepare an isolated preview

Use Node **24.22.1** from [`.node-version`](../.node-version) and pnpm **11.25.0**:

```sh
pnpm install --frozen-lockfile
pnpm test
pnpm build:web
pnpm preview:web
```

The browser build writes `dist-web/`. The default preview origin is `http://127.0.0.1:4173/`; it has its own browser storage. Keep development relay origins explicitly configured and separate from production authorization. Do not open or alter a user’s production board for a fixture test.

The relay has its own Worker configuration and bindings. Use the commands committed with that source when deploying or running it for development. See [HOSTING.md](../HOSTING.md) for deployment order, secrets, and acceptance. A frontend preview alone does not prove that remote MCP authorization or a real client works.

`pnpm dev` runs the browser-storage frontend for development, normally on port **4317**. `pnpm relay:dev` runs Wrangler on port **8787**. Local integration needs explicitly matched development origins (`APP_ORIGIN` and `RELAY_ORIGIN`) and a frontend pointed at that test relay; the production origin defaults must remain strict. Deploy the Worker with `pnpm relay:deploy`, using `cloudflare/wrangler.jsonc` and its `BOARD_RELAY` / `RELAY_AUTH` Durable Object bindings.

## Browser data and connection state

The browser stores the drawing, image files, notes, areas, work cards, reusable blocks, project catalog, checkpoints, recovery, and mini-chat history. Stable `/boards/<id>/` addresses locate boards in that browser profile; the address does not publish or share their contents.

Each connection is scoped to one board. Relay credentials must have a distinct storage namespace and must never reuse or upload private credentials from a retired local connection. Existing user drawings and history must survive the connection change. Do not silently retarget old captured requests to a replacement grant.

Use the authenticated board transport and tool handlers rather than writing browser records or historical disk data directly during normal operation. An unavailable board must fail clearly; no alternate drawing database or simulated assistant response is an acceptable fallback.

Keep all private state out of source control and static deployments. Developer data, service tokens, authorization grants, captured requests, logs, and environment secrets are not release assets.

## Test the collaboration contract

| Area | Meaningful check |
| --- | --- |
| Drawing storage | Edit actual elements, retain image bytes, reload, and reopen a stable board address. |
| Planning | Save notes/requirements/areas/blocks; reject stale updates without losing drafts. |
| Context | Capture the requested board, selection, or named area with the exact planning revision and PNG. |
| Permissions | Read-only cannot edit; requested-edit operations require current versions and preserve overlapping human work. |
| Client setup | Pair through the generated hosted URL and instructions; check actual client capabilities. |
| Explicit handoff | Copy a saved request, read it through the connected tools, and return a real reply. |
| Automatic events | Enable only for a supported hosted Work Cloud client; distinguish transport acknowledgement, read, and reply. |
| Failure recovery | Preserve request IDs and immutable context through disconnects, reloads, timeouts, and uncertain outcomes. |
| Authorization | Reject wrong-board, expired, revoked, and replaced grants; never expose secrets through tool outputs or backups. |
| Backups | Export/import a synthetic board; validate malformed input and capture recovery before replacement. |

Use separate browser profiles/databases and temporary fixture directories. Never delete a real board or clear real site storage to simplify testing. Automated protocol fixtures prepare for real provider/account acceptance; they do not establish it.

## Release app changes

After a completed batch, record the changes before building:

```sh
pnpm run change minor "Change title" --added "What changed" --fixed "What was fixed"
pnpm test
pnpm build:web
```

Use `minor` for capabilities and `patch` for fixes. `releases.json` supplies application/tool versions and generates [CHANGELOG.md](../CHANGELOG.md). The build checks the source fingerprint, package version, and generated notes. Create the next entry instead of restamping an older version. Drawing revisions are independent of app versions.

Retain [authorship](../AUTHORS.md), the [MIT license](../LICENSE), and [third-party notices](../THIRD_PARTY_NOTICES.md). Public-facing documentation should describe only supported website behavior. Historical local runtime and packaging sources must not reappear in the end-user connection flow.
