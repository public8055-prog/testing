# Local startup and Docker recovery — 26 October 2026

Run `npm run dev` for development, or `npm run build -- --webpack` followed by `npm start` for the production build. A separate `npm run infra:up` is optional. All three host launchers check the configured local MongoDB/Redis endpoints, start Docker Desktop if needed, wait for its engine, start this project's persistent data services, verify their readiness and initialize missing indexes/catalogue records before serving the application.

`npm install` and `npm ci` run the same setup when a local environment file already exists. Installation remains successful if Docker is missing or cannot start; its warning explains recovery, and the next `dev` or `start` retries. Those application commands fail before serving when managed local services remain unavailable. Installation skips infrastructure work in CI, Docker builds, production-only installations, without local configuration, or with `AUTO_START_LOCAL_INFRA=false`.

## Scope and existing processes

Automatic management applies only to uncredentialed loopback MongoDB on port 27018 and Redis on 6380. Remote/authenticated/custom-port services are operator-managed. The helper never runs volume deletion or Docker teardown, never kills unrelated Node processes and never creates an administrator account implicitly. `db:init` is idempotent; seeding an administrator remains a protected explicit command.

Repeated dev launches reuse this folder's existing server and exit successfully with its actual URL/PID. The launcher uses its own private process metadata, plus Windows process/listener identity for older direct Next launches. Next's native lock remains a fallback for simultaneous launches. Use Ctrl+C in the original terminal before changing options. On Windows the default development bundler is Webpack after an observed Turbopack filesystem-cache stall on this machine; explicit `--turbopack`, `--turbo` and `--webpack` options are respected.

Stopping the app leaves MongoDB/Redis available. Both containers use `restart: unless-stopped`. Docker/WSL must be installed, and a first-run setup or Windows permission prompt may still require the operator. A new terminal is generally appropriate after installing Docker; the helper also recognizes its standard installation paths when the current terminal's PATH predates installation.

## Executed checks

| Check | Result / evidence |
| --- | --- |
| Startup control-flow tests | Nine focused tests cover endpoint scope, CI/install skips, healthy reuse, cold-engine startup, missing/disappearing Docker, initializer errors and explicit bundler options. `artifacts/local-runtime-tests.log` |
| TypeScript and focused lint | Passed. `artifacts/local-startup-types.log`, `artifacts/local-startup-lint.log` |
| Docker reinstallation | Authorized by the operator; official 4.96.3 installer checksum verified, installation completed, Linux engine became ready. Windows permission was approved by the operator. |
| Cold Docker/database startup | Helper started Docker Desktop and the MongoDB replica set/Redis, then verified a writable primary and PING. `artifacts/infra-reinstalled.log` |
| Real installation hook | `npm install --no-audit --no-fund` invoked postinstall and initialized the existing data successfully. `artifacts/install-autostart-check.log` |
| Development | Database initialization passed; Next started; `/api/health` and `/` returned HTTP 200 using Webpack. `artifacts/dev-webpack-live.log` |
| Duplicate development command | `npm run dev` reused the running localhost:3000 server and exited 0 without starting a second Next process. `artifacts/dev-reuse-verified.log` |
| Production startup with stopped data services | After explicitly stopping this project's MongoDB/Redis, `npm start -- --port 3010` restarted them and returned HTTP 200 with transactions/Redis healthy. The temporary production server was stopped afterwards. `artifacts/start-autostart-live.log` |
| CI install behavior | The postinstall command with CI enabled exited successfully without service startup. |

These checks cover the launcher changes. The broader application validation from 25 October is retained separately in [VALIDATION.md](VALIDATION.md); it was not rerun in full for this script-only change.

## Database recovery performed

The Docker executable and installation directory disappeared during the original diagnosis. Windows Package Manager reported no installed Docker package. After reinstallation, Docker had no existing data volumes and `urbankare_mongo` was empty. Before catalogue initialization, the retained authenticated/encrypted snapshot from **25 October 2026, 20:46:52 IST** was restored into that empty local database. No populated target was overwritten or dropped.

The encrypted file checksum and AES-GCM authentication were verified, then every restored collection's document digest was compared and saved indexes recreated. The snapshot contains **49 collections and 179 documents**. Its SHA-256 is `d523831ef8485b2b37272fb039cf26266eeb3de5b6007600deb6d25fcc5f78c3`; evidence is `artifacts/docker-reinstall-data-recovery.log`. The post-recovery initializer confirmed 48 services, 12 categories and 4 professionals. Redis starts fresh, so prior sessions need a new sign-in. Records newer than that saved snapshot cannot be recovered from this snapshot; no newer saved snapshot was found locally.

The current locations remain MongoDB `urbankare_mongo` at `127.0.0.1:27018` and Redis at `127.0.0.1:6380`, backed by `urbankare-infra_mongo_data` and `urbankare-infra_redis_data`. The encrypted backup and protected key remain retained separately.
