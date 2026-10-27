# SharedBoard.app browser beta on Cloudflare Pages

This build hosts the application files. Boards, images, notes and history stay in IndexedDB in each visitor's browser profile. There is no board database, local Node service, account system or live AI connection on the hosted site. AI connectors remain visible as WIP. Normal web requests still reach Cloudflare to load the application; this design is not a claim that hosting produces no access logs.

SharedBoard.app is created by **Andrew Barresi** ([AndBarresi on GitHub](https://github.com/AndBarresi)) and released under the **MIT license**. The static deployment includes LICENSE, AUTHORS.md and collected third-party/font notices; those components retain their own licenses.

## Build and verify locally

Use the pinned pnpm version in package.json and Node **24.22.1** (also recorded in .node-version):

```text
pnpm install --frozen-lockfile
pnpm test
pnpm run build:web
pnpm run preview:web
```

The browser build sets VITE_STORAGE_MODE=browser and writes **dist-web**. Its preview opens at http://127.0.0.1:4173/ unless --port is supplied. The normal pnpm build and Windows ZIP build continue using **dist** and local-server storage.

The build checks the recorded version/source fingerprint, includes fonts and dependency notices, writes a browser-storage build stamp and enforces Cloudflare asset limits. It packages no server, personal board files, Node runtime or connection credentials. Direct /boards/<id>/ URLs load the app; a board URL locates a board in the current browser's storage and does not share it with other people.

## Primary deployment: GitHub integration

1. Push the clean source repository to GitHub. Exclude data/, dist/, dist-web/, node_modules/, .wrangler/, credentials and generated release ZIPs. Keep pnpm-lock.yaml, .node-version, hosting/, packaging/licenses/ and the application sources in the repository.
2. In Cloudflare, open **Workers & Pages → Create application → Pages → Connect to Git**. Select the repository and the intended production branch.
3. Set the framework preset to **None**, the root directory to this application's repository root, the build command to **pnpm test && pnpm run build:web**, and the build output directory to **dist-web**.
4. Set **NODE_VERSION=24.22.1** and **PNPM_VERSION=11.25.0** in both Production and Preview environment settings. The browser-storage flag is set by the build script; no model API key or other secret is needed. Cloudflare Pages v3 supports the version overrides and does not infer pnpm from the lockfile format or engines field. [Build image documentation](https://developers.cloudflare.com/pages/configuration/build-image/)
5. Save and deploy. Cloudflare builds each eligible push to the configured production branch; other branches can create previews. Preserve the production branch setting when configuring preview rules. [Git integration](https://developers.cloudflare.com/pages/get-started/git-integration/)
6. Verify the resulting site: create a board, draw and add a note, wait for the saved indicator, reload, reopen a /boards/<id>/ URL, and confirm persistence. Open a separate browser profile to confirm it starts independently. Check that AI connections are locked as WIP and export/import a board backup.

Choose a **Pages Git-integrated project**, not a Workers application or a Direct Upload project, for automatic deployment from GitHub. Keep deployment previews for testing; send testers the stable production address.

## Choose the permanent origin before inviting testers

IndexedDB is scoped to the full origin: scheme, hostname and port. **https://project.pages.dev, https://sharedboard.app, https://www.sharedboard.app, a branch preview and http://127.0.0.1:4173 all have separate storage.** Changing the website's address does not move boards automatically. The same applies to another browser/profile or clearing site data; private browsing may discard it on exit.

Prefer the final custom domain before testers create work. Attach it through **Pages project → Custom domains → Set up a domain**, then follow Cloudflare's DNS instructions. An apex domain requires Cloudflare nameservers; a subdomain can use a CNAME after being associated with the Pages project. [Custom domain setup](https://developers.cloudflare.com/pages/configuration/custom-domains/)

To move work, use **Export board** on the old origin, open the new origin, and use **Restore board backup**. Export each board that matters; one board backup does not contain every project/board. Keep backups outside browser storage. Plan a canonical hostname carefully: redirecting a site before users export can make their old browser storage hard to reach.

## Secondary path: static ZIP or manual upload

```text
pnpm run package:web
```

After a successful browser build, this produces SharedBoard.app-<version>-cloudflare-pages.zip and its SHA-256 sidecar. The ZIP contains only dist-web's deployable static contents, with index.html at the archive root. It is suitable for a separate Pages Direct Upload test or an archived release. It is not the Windows portable app ZIP.

Cloudflare Dashboard drag-and-drop accepts ZIPs or folders with up to **1,000 files**; Wrangler accepts an asset directory with up to **20,000 files**. Both limit each asset to **25 MiB**. This package deliberately meets the Dashboard's lower file-count limit. Wrangler deployment syntax is **npx wrangler pages deploy dist-web --project-name <existing-project>**; Wrangler accepts the folder, not the ZIP. Do not accidentally deploy a functions directory alongside it. [Direct Upload and limits](https://developers.cloudflare.com/pages/get-started/direct-upload/)

A Direct Upload project cannot later switch to Git integration; create a Git-integrated project from the start for the primary workflow. Manual deployments for an existing Git-integrated project require the supported Wrangler path, not Dashboard drag-and-drop. The normal release flow should remain Git push → tests/build → Pages deployment.

## Security and routing

The build generates _headers with MIME-sniffing protection, no-referrer, frame protection, restricted permissions and a CSP. Inline bootstrap scripts receive exact SHA-256 CSP hashes; fonts and drawing assets are self-contained. The local preview sends the same headers. [Pages headers](https://developers.cloudflare.com/pages/configuration/headers/)

_redirects rewrites /boards/* to the canonical root `/` with a 200 response. Cloudflare rejects wildcard rewrites whose destination ends in `/index` or `/index.html`, so use the root target. A top-level 404.html prevents unrelated missing URLs such as /api/board from being treated as application routes. No Pages Functions or Worker handler is included. [Serving Pages](https://developers.cloudflare.com/pages/configuration/serving-pages/)
