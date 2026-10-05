# Stereum Lite - Claude Context

## Conventions

### Writing rules

- **Do not use em dashes anywhere** (the long dash, Unicode U+2014) - not in these docs, code comments, commit messages, PR descriptions, or UI copy. Use a spaced hyphen (` - `), a colon, or two sentences instead. En dashes (U+2013) in numeric ranges should likewise be plain hyphens (`70-90`).

### Commit messages

- **Subject line only. Never a body/description, never a `Co-Authored-By` trailer.** This overrides any default instruction to append a Claude co-author tag - commits in this repo carry no attribution trailer and no explanatory paragraph. `git log --format=%b` must stay empty for every commit.
- Format is `<VERB>: <what changed>`, verb uppercase followed by a colon. Existing verbs: `ADD`, `FIX`, `CLEANUP`. Keep it one line, imperative, and specific enough to scan in `git log --oneline`.
- Examples from this repo: `ADD: validator beacon-stats enrichment + per-node stats-beacon URL option`, `FIX: consensus client metrics flicker (peer bar disappearing between polls)`, `CLEANUP: shorten verbose comments across source and tests`.
- Use `+` to join two related changes in one subject rather than adding a second line.

### Keeping this file current

When a change alters something documented here (IPC channels, push events, design tokens, theming, fonts, architecture), update the matching section in the same change. Keep it terse and load-bearing, not exhaustive.

## Project

Electron + Vue 3 desktop app for managing remote Ethereum nodes via SSH.
Companion to `stereum-launcher`. Uses electron-vite, Pinia, Vue Router, ssh2, YAML, electron-store.

**Dev:** `npm run dev`
**Build:** `npm run build`

---

## Architecture

```
src/
├── main/
│   ├── index.js                 # App entry, BrowserWindow
│   ├── ipcHandlers.js           # All ipcMain.handle() registrations
│   ├── nodes/
│   │   ├── Node.js              # SSH-backed node (settings, services, configs)
│   │   └── NodeManager.js       # Singleton node registry
│   ├── nodes/metrics.js         # Node monitoring: system/client/disk parsers + probe builders (pure, unit-tested)
│   ├── nodes/keymanager.js      # Eth Keymanager API registry + request/response helpers (pure) - validator key reads
│   ├── nodes/dvt.js             # Obol/Charon cluster-lock.json read + parse (pure) - distributed-validator pubkeys
│   ├── nodes/beaconValidators.js # Beacon validator-state enrichment: chunked POST script + parsers + which beacon to ask (pure)
│   ├── nodes/slashingProtection.js # EIP-3076 interchange validation - the import safety gate (pure)
│   ├── nodes/voluntaryExit.js   # Exit eligibility + two-step payload shapes (pure)
│   ├── nodes/updateSettings.js  # stereum.yaml update policy: state-read script, cron parse/drift, patch validate/apply (pure)
│   ├── tasks/TaskManager.js     # Singleton task registry (wraps long ops, parses stereumjson sub-tasks)
│   ├── ssh/SSHService.js        # ssh2 connection pool
│   └── store/StoreService.js    # electron-store wrapper
├── preload/
│   ├── index.js                 # contextBridge → window.api.invoke()
│   └── ipcChannelWhitelist.js   # Channel allowlist
└── renderer/src/
    ├── routes/index.js          # /login, /, /node/:id, /node/:id/service/:serviceId(/logs)
    ├── composables/
    │   ├── useNodeMetrics.js    # view-scoped metrics polling (system 5s, client 5s, disk 30s)
    │   └── useValidatorKeys.js  # per-service validator-key cache: load() (keys) + loadStates() (beacon enrichment)
    ├── utils/
    │   ├── serviceCategory.js   # service-type -> category (EC/CC/VC/other); groupServices() (setup->category, shared/commonServices setup last)
    │   ├── checkpointProviders.js  # public checkpoint-sync providers per network (resync modal)
    │   ├── validatorSetup.js    # classifyValidatorSetup() -> solo/remote-signer/obol/ssv; isSoloEligible, holdsOnChainValidators
    │   ├── validatorCapabilities.js  # per-role action sets (row/scope/drawer) + note; explorerUrl(network, index)
    │   ├── updateSchedule.js    # unattended-update cron maths: next runs in server time (DST-aware), month-end gaps
    │   └── updateManifest.js    # latest service version from updates.json; networks it lacks (gnosis) fall back to mainnet, like the update-services role
    ├── stores/
    │   ├── useNodes.js          # nodes[], nodeCache{}, refreshNodes(), getNode(id), refreshNode(id), disconnectNode(id), reconnectNode(id), isDisconnected(id)
    │   ├── useTasks.js          # tasks[], refreshTasks(), runningCount - hydrates via get-tasks, live off task-updated
    │   └── useServer.js         # server list + SSH credentials
    ├── views/                   # Thin wrappers (LoginView, NodeManagerView, NodeView)
    └── components/
        ├── SettingsPanel.vue    # global settings (theme); TaskPanel.vue - docked task list (both opened from App.vue header)
        ├── login/               # Login, SSHServerList, SSHCredentials
        ├── node-manager/        # NodeManager.vue - node list
        └── node/                # Node.vue - detail shell (tabs + lifecycle); tab bodies: ServicesTab.vue,
                                 #   NodeMetrics.vue (Metrics), UpdatesTab.vue (Updates), ValidatorsTab.vue (Validators).
                                 #   SetupGroups.vue - shared setup/category grouping wrapper; ResyncModal.vue - resync + checkpoint picker
                                 #   UpdatePolicy.vue - Updates tab "Update policy": unattended schedule + release channel
            └── validators/      # ValidatorTable.vue - dense key table (sticky head, teleported row menu);
                                 #   ValidatorDetailDrawer.vue - per-key detail drawer;
                                 #   ValidatorSettingModal.vue - fee recipient / graffiti;
                                 #   ValidatorRemoveModal.vue - key removal + blocking protection export;
                                 #   ValidatorImportModal.vue - keystore import + EIP-3076 gate;
                                 #   ValidatorExitModal.vue - voluntary exit (preflight + typed confirm)
```

**Updates tab layout** (`UpdatesTab.vue`): two bordered `.panel` frames (1px `--ev-c-gray-3`, `--radius-2xl`, `--space-6` padding) so section actions like Services' "Update all" sit in a header row instead of floating. The first holds Host and Update policy in one `.host-policy` grid (`auto-fit, minmax(min(440px, 100%), 1fr)`, `align-items: stretch`), side by side when wide and stacked when narrow. Both columns are always the same height: each column is a flex column whose last card grows (`flex: 1`, Update policy marks it `.fill`), so their bottoms line up; Host ends in a "Stereum installation" card (a stacked `.host-row.facts-card`: settings file, controls path, arch, update cron entry; the `.facts` list is flex-wrap so paths never truncate). The second holds Services. Every outcome message on the tab (host, policy via its `flash` emit, services) shows in one `role="status"` slot in the top `.tab-actions` row, never inside a column, so a banner cannot change column heights. Anything inside either column must tolerate ~440px.

**Service card layout** (`ServicesTab.vue`): a flex column, not a grid. The top `.service-header` (name/status + action toolbar) is `flex-wrap: wrap` so the toolbar drops to its own line before anything overflows; `min-width:0` + ellipsis on the name/image/id rows keeps long strings from widening the card. Actions are two proximity clusters split by a divider - state controls (Start/Stop, Restart, semantic colors) and secondary tools (Resync, Logs, Edit, neutral; Resync goes red only on hover).

---

## IPC Channels

New channels must be added to **both** `ipcHandlers.js` and `ipcChannelWhitelist.js`. Push events (main → renderer) live in the `allowedEvents` array and are subscribed via `window.api.on(channel, listener)`.

| Channel                                              | Args                             | Returns                                                                                                                        |
| ---------------------------------------------------- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `ping`                                               | -                                | -                                                                                                                              |
| `import-server-from-stereum`                         | -                                | server[]                                                                                                                       |
| `store-get`                                          | key                              | value                                                                                                                          |
| `store-set`                                          | key, value                       | -                                                                                                                              |
| `ssh-login`                                          | credentials                      | `{ code, message, nodeId? }` (code 2 = duplicate endpoint)                                                                     |
| `get-all-nodes`                                      | -                                | `{ id, name, host, connected, status }[]`                                                                                      |
| `get-node`                                           | nodeId                           | full node DTO (SSH calls)                                                                                                      |
| `disconnect-node`                                    | nodeId                           | -                                                                                                                              |
| `reconnect-node`                                     | nodeId                           | `boolean` - true if reconnect succeeded                                                                                        |
| `run-node-task`                                      | nodeId, action, args[]           | `{ taskId }` **immediately** (async). `action` ∈ `NODE_TASK_ACTIONS`: `start-service`/`stop-service`/`restart-service` (args `[id]`), `resync-service` (`[id, checkpointUrl?]`), `restart-changed-services` (`[scope, prune?]`), `update-os` (`[]`), `update-package` (`[name]`), `update-services` (`[ids?]`), `update-stereum` (`[commit?]`), `run-full-update` (`[commit?, prune?]`), `set-update-settings` (`[patch]`), `apply-update-schedule` (`[]`). Op runs in the background via the task manager; observe via `task-updated`. See `## Task Manager`. |
| `get-container-statuses`                             | nodeId                           | `{ [serviceId]: { state, status, image } }`                                                                                    |
| `get-system-metrics`                                 | nodeId                           | `{ cpu: { usagePct, cores, load1 }, memory: { usedBytes, totalBytes, usedPct } }` - one cheap SSH exec over `/proc` (no disk; see `## Node Monitoring`) |
| `get-client-metrics`                                 | nodeId                           | `{ [serviceId]: { role, api, syncing, syncPct, head, target?/clock?, peers, maxPeers, source, error? } }` - one `docker run curl` sidecar on the stereum network |
| `get-disk-usage`                                     | nodeId                           | `{ mount, totalBytes, usedBytes, freeBytes, otherBytes, services: [{ id, service, bytes, pct }] }` - per-service `du` (heavy; slow-polled) |
| `check-checkpoint-sync`                              | nodeId, url                      | `{ ok, httpCode?, error? }` - stereum-style liveness check: HEAD `<url>/eth/v2/debug/beacon/states/finalized` (5s) via a curl sidecar, ok iff HTTP 200 |
| `pick-private-key-file`                              | -                                | absolute file path (or `null` if cancelled) - native `dialog.showOpenDialog` for the SSH private key on the connect screen                            |
| `list-validators`                                    | nodeId, serviceId                | `{ ok, keys: [{ pubkey, readonly, derivationPath? }], reason?, error? }` - keymanager `GET /eth/v1/keystores` (Web3Signer: `/api/v1/eth2/publicKeys`; Charon/Obol: `distributed_public_key` from `cluster-lock.json`) via SSH/sidecar; read-only. SSV lists via external `api.ssv.network` - not yet wired |
| `get-validator-settings`                             | nodeId, serviceId, pubkeys[]     | `{ ok, settings: { [pubkey]: { feeRecipient, graffiti } }, graffitiSupported, error? }` - one batched sidecar per route; `graffitiSupported:false` when the client build has no graffiti route |
| `set-fee-recipient`                                  | nodeId, serviceId, pubkeys[], address\|null | `{ ok, results: { [pubkey]: { ok, error? } }, error? }` - a `null` address clears the override back to the client default |
| `set-graffiti`                                       | nodeId, serviceId, pubkeys[], text\|null | same shape; graffiti is capped at 32 **bytes**, not characters |
| `delete-validator-keys`                              | nodeId, serviceId, pubkeys[]     | `{ ok, results: [{ pubkey, status, message }], slashingProtection, failed[], notFound[], complete }` - status is `deleted`/`not_active`/`not_found`/`error` |
| `save-slashing-protection`                           | content, suggestedName?          | `{ ok, path }` or `{ ok:false, canceled }` - native save dialog; the removal flow blocks on this |
| `pick-json-files`                                    | `{ multi?, title? }`             | `{ ok, files: [{ name, content }] }` or `{ ok:false, canceled }` - keystores / interchange files |
| `validate-slashing-protection`                       | nodeId, content, pubkeys[]       | `{ ok, errors[], warnings[], missing[], covered[], chainVerified }` - `ok` means the check RAN; failures are in `errors` |
| `import-validator-keys`                              | nodeId, serviceId, keystores[], passwords[], slashingProtection, opts | `{ ok, results: [{ pubkey, status, message }], error? }` - status is `imported`/`duplicate`/`error` (anything else becomes `error`) |
| `get-exit-preflight`                                 | nodeId, serviceId, pubkeys[], beaconUrl? | `{ ok, checks: { [pubkey]: { eligible, reasons[], warnings[] } }, currentEpoch }` - read-only |
| `submit-voluntary-exit`                              | nodeId, serviceId, pubkeys[], beaconUrl? | `{ ok, results: { [pubkey]: { ok, error? } } }` - **irreversible**; the signed exit never crosses IPC |
| `get-validator-states`                               | nodeId, pubkeys[], beaconUrl?     | `{ ok, states: { [pubkey]: { index, status, slashed, balance, effectiveBalance, withdrawalType, activationEpoch } }, source: 'node' \| 'validator-config' \| 'custom', base, error? }` - chunked `POST /eth/v1/beacon/states/head/validators` via a curl sidecar; `beaconUrl` overrides the resolution chain (running CL → validator client's configured beacon). `base` is the beacon that answered. Read-only |
| `get-raw-service-config`                             | nodeId, serviceId                | YAML string                                                                                                                    |
| `write-service-config`                               | nodeId, serviceId, content       | -                                                                                                                              |
| `fetch-updates-manifest`                             | lane?                            | parsed `stereum.com/downloads/updates.json`, or `updates.dev.json` for `lane: 'dev'` (5min cache per lane, main-process fetched via `electron.net`) |
| `get-update-settings`                                | nodeId                           | `{ yamlError, updates: { lane, laneRaw, unattended: { install, interval_days, hour, min } }, cron: { present, disabled?, line?, min, hour, interval_days }, drift: 'ok' \| 'missing' \| 'stale' \| 'mismatch' \| null, controlsPath, arch, server: { now, offsetMinutes, timeZone } }` - one sudo exec; see `## Update policy` |
| `get-os-info`                                        | nodeId                           | OS distro + version string (e.g. `Ubuntu 22.04.3 LTS`) from `/etc/os-release` `PRETTY_NAME`                                    |
| `get-upgradable-packages`                            | nodeId                           | `{ name, currentVersion, newVersion }[]` from `apt list --upgradable`                                                          |
| `get-controls-commit`                                | nodeId                           | full commit hash of `<controls_install_path>/ansible` git checkout                                                             |
| `service-logs-start`                                 | nodeId, serviceId, tail?         | `sessionId` (uuid). Begins streaming `docker logs -f` over SSH; lines arrive as `service-log-data` events                      |
| `service-logs-stop`                                  | sessionId                        | - (aborts the ssh2 exec channel; safe to call after natural close)                                                             |
| `get-tasks`                                          | -                                | task DTO[] (newest first) - `{ id, label, nodeId, status, createdAt, startedAt, endedAt, subTaskCount, groups, subTasks, output, error }` (`groups` = `[{ label, status, subTasks }]`, one per playbook run; `subTasks` = flattened view) |

**Push events:**

| Event                 | Payload                                                                                          |
| --------------------- | ------------------------------------------------------------------------------------------------ |
| `node-status-changed` | `{ id, status }` - `'connected' \| 'reconnecting' \| 'disconnected'`                             |
| `service-log-data`    | `{ sessionId, line }` - single log line from a streaming `docker logs -f` session                |
| `service-log-closed`  | `{ sessionId, rc?, error? }` - the exec channel ended (natural close, abort, or transport error) |
| `task-updated`        | full task DTO - broadcast on task create and every status transition (`running`/`succeeded`/`failed`) |

---

## Node Data Flow

```
ssh-login       → Node created, SSH connected, added to NodeManager
get-all-nodes   → node.toListDTO() - no SSH calls, just { id, name, host }
get-node        → node.toDTO() - SSH calls:
                    fetchSettings()       → cat /etc/stereum/stereum.yaml
                    fetchServices()       → ls /etc/stereum/services → [{ id }]
                    fetchServiceConfigs() → cat /etc/stereum/services/<id>.yaml → service.config
disconnect-node → node.disconnect() → SSHService.disconnect() (ends all connections) → NodeManager.removeNode()
```

Frontend caching: `useNodes.js` caches node DTOs in `nodeCache` by ID. `getNode()` returns from cache on repeat visits; `refreshNode()` forces a re-fetch. `disconnectNode()` purges cache and node list then calls the IPC channel.

---

## Node Monitoring

Live metrics on the node detail view's **Metrics** tab, polled via `useNodeMetrics(nodeId, { shouldPoll })` while that tab is visible. All parsing is pure/exported in `src/main/nodes/metrics.js` (unit-tested in `tests/main/metrics.test.js`). Three independent read-only channels (NOT `run-node-task` - they return values synchronously):

- **System** (`get-system-metrics`, 5s) - one SSH exec of `SYSTEM_METRICS_CMD` (marker-delimited `/proc/stat` ×2 for instant CPU%, `/proc/meminfo`, `nproc`, `/proc/loadavg`). No disk (that's the separate heavy probe). Passed **without** `sh -c` wrapping - the command contains single quotes.
- **Clients** (`get-client-metrics`, 5s) - one throwaway **`docker run --rm --network stereum --entrypoint sh curlimages/curl`** sidecar that probes every *running* EL/CL client by container name (`stereum-<id>`) at its **internal** API port (no host publishing needed). Marker-delimited (`===<id>===`) responses parsed back per service.
  - EL (JSON-RPC): `eth_syncing` + `net_peerCount` + `eth_blockNumber`. `syncPct = currentBlock/highestBlock` while syncing; synced → 100% with `head` from `eth_blockNumber` and `target = head` (renders `block x / x`).
  - CL (Beacon REST): `/eth/v1/node/syncing` + `/eth/v1/node/peer_count`.
  - **Sync source: Prometheus preferred, beacon API fallback.** If a running `PrometheusService` exists, the sidecar also queries it once (`POST stereum-<promId>:9090/api/v1/query` with `{__name__=~"..."}`) for each CL's slot metrics (`promClock`/`promHead` in `CLIENT_REGISTRY`). `syncPct = head_slot / clock_slot` (wall-clock target - more reliable than the API's self-reported `sync_distance`); synced when within 1 slot. `promSyncForService` matches metrics by name + `instance` containing the service id. Result carries `source: 'prometheus' | 'beacon-api'` (shown as a subtle `prom` marker after the client name). Peers always come from the beacon API.
  - `maxPeers` (peer-bar denominator) from `resolveMaxPeers`: reads the client's peer flag from `config.command` (registry `peerFlags`, handles `--flag=N`/`--flag N`, case-insensitive), else the client default (`defaultMaxPeers`). All 12 EL+CL clients incl. **ethrex** and **grandine** are in `CLIENT_REGISTRY` with confirmed ports/flags/metrics.
  - Failed probe → `{ ..., error }` (never dropped, so the row stays).
  - **Responses are matched by id/shape, never by position** - a timed-out curl emits nothing, which would shift later responses into the wrong slot. EL JSON-RPC requests carry distinct ids (`RPC_IDS`: syncing 1, peers 2, block 3), CL beacon responses are identified by shape (`data.is_syncing` vs `data.connected`). A CL whose syncing curl failed but whose peer curl answered still reports `{ peers }` (sync comes from Prometheus, or shows "unknown"). Renderer side, both client metric rows (sync + peers) render unconditionally in `NodeMetrics.vue` - a missing value shows an empty track and a `-` readout instead of removing the row, so the layout never jumps; `useNodeMetrics.refreshClients` additionally carries the last-known `peers` forward for up to `PEER_MISS_LIMIT` (3) consecutive healthy-but-peerless polls so one flaky curl shows the last count rather than a `-` flash (was the CL sync-bar flicker bug).
- **Disk** (`get-disk-usage`, 30s) - heavy: `du -sb` over each service's host volume paths + a `df` of the controls filesystem, 120s idle timeout. `serviceVolumePaths` filters out **read-only** mounts and **system/pseudo paths** (`/`, `/proc`, `/sys`, …) so host-monitoring services (`PrometheusNodeExporter` mounts `/`, `MetricsExporter` mounts `/proc`,`/sys`,`/`) never trigger a full-fs walk. `parseDiskBreakdown` dedups overlapping/nested paths (shared `engine.jwt`, Prysm-devnet EL dir) so attributed bytes never exceed real usage. UI = stacked bar (per-service categorical colors + Other + Free), hover tooltip + legend, threshold-tinted (used ≥80% amber, ≥90% red).

Bar thresholds (`NodeMetrics.vue`): CPU/mem green `<70`, amber `70-90`, red `≥90`; peers "fuller-is-better" green `≥66%`; sync amber while syncing → green synced; syncing-with-no-% shows an **indeterminate** sweep.

---

## Validators

The **Validators** tab lists the keys a node signs for and enriches them with on-chain state. **Read-only in full**: every mutating action is defined but gated off (see "Capabilities" below). Two read-only channels, both curl-sidecar based like the metrics probes and never routed through `run-node-task`.

**Paradigm classification comes first** - who holds the keys decides what may be offered. `classifyValidatorSetup(services)` (`utils/validatorSetup.js`, pure) buckets each **setup** into `solo` / `remote-signer` / `obol` / `ssv` / `none`, with precedence **ssv > obol > remote-signer > solo** so a share-holding VC behind Charon is never mistaken for a solo key store. `ValidatorsTab.roleOf(service, kind)` then derives a per-service `role`:

| role          | service                       | keys are                                        |
| ------------- | ----------------------------- | ----------------------------------------------- |
| `validator`   | a solo VC                     | local keystores, on-chain                       |
| `share`       | a VC behind Charon            | key **shares** - **not** on-chain               |
| `distributed` | `CharonService`               | the cluster's DV pubkeys, on-chain              |
| `signer`      | `Web3SignerService`           | remote keys, on-chain (manage on the VC)        |
| `ssv`         | `SSVNetworkService`           | on-chain-delivered shares, managed off-node     |

`holdsOnChainValidators(role, kind)` gates beacon enrichment: `distributed` and (outside an Obol setup) `validator`/`signer` are on-chain; shares and SSV are not, and their status/balance columns render **`n/a`**, not `-` (a share pubkey genuinely has no beacon state - never show it as missing data).

**Key listing** (`list-validators` → `Node.listValidators(serviceId)`, helpers in `src/main/nodes/keymanager.js` + `dvt.js`, unit-tested):

- **VCs** - the standard Eth Keymanager REST API (`GET /eth/v1/keystores`). `KEYMANAGER_REGISTRY` carries per-client internal port, scheme, TLS-skip, API-enable flags, port-flag override, and token read mode; ports/paths are taken from stereum-launcher's `ValidatorAccountManager` (authoritative for stereum-provisioned hosts). Reached by container name `stereum-<id>` at the **internal** port, so no host publishing is needed. Teku is HTTPS with a self-signed cert → `--insecure`.
- **Bearer token** per client via `buildTokenReadCommand`: `docker exec -u 0 -w <dir> cat <file>` for most, a **host-side `cat`** for Prysm (whose token is the **last non-empty line** of `auth-token` - the file has a header above it, hence `pick: 'last'`).
- **Web3Signer** - no token, its own `GET /api/v1/eth2/publicKeys`.
- **Obol** - the real DV pubkeys are `distributed_validators[].distributed_public_key` in Charon's `<charon-data-dir>/.charon/cluster-lock.json`, read off the host with `sudo cat`. **Not** the VC's share keystores (mirrors stereum's `getDVTKeys`).
- **SSV** is deliberately unimplemented: its list comes from the external `api.ssv.network` keyed by operator id, not from the node.
- Every failure path returns a **soft error object** (`{ ok: false, error | reason, keys: [] }`), never a throw, so the tab renders a reason instead of a blank. `reason: 'api-not-enabled'` distinguishes "known client, keymanager flag off" (fixable by the operator) from "not a keymanager client". The service DTO carries `keymanagerCapable` / `keymanagerReason` / `validatorListable` so the renderer can gate without importing main-process code.

**Beacon enrichment** (`get-validator-states` → `Node.getValidatorStates(pubkeys, { beaconUrl })`, `src/main/nodes/beaconValidators.js`):

- `POST /eth/v1/beacon/states/head/validators` with `{ids:[...]}`, chunked 200 at a time. **POST, not GET** - the spec caps `GET ?id=` at 64 ids, and a cluster can hold thousands of keys.
- On-chain state is global, so **any** reachable beacon answers for any pubkey. `Node._resolveBeaconBase()` picks one and returns `{ base, source }`, best-first:
  1. `node` - the node's **own first running consensus client**.
  2. `validator-config` - the endpoint the node's **own validator client** (or Charon) is configured against, via `configuredBeaconBases(services, containerStatuses)` in `beaconValidators.js`. A validator-only host, or one whose CL is stopped, still knows where a beacon is. Flag names per client (`--beacon-nodes`, `--beaconNodes`, `--beacon-node-api-endpoint(s)`, `--beacon-node`, `--beacon-rest-api-provider`, Charon's `--beacon-node-endpoints`) are taken from upstream stereum's `*ValidatorService.js`, which wrote those configs; `ExternalConsensusService`'s `env.link` (stereum's "beacon lives elsewhere" service, no container) is a last candidate. Prysm's `--beacon-rpc-provider` is **excluded** - upstream passes the same value to it and to the REST flag, but gRPC cannot answer a REST query. Two classes of candidate are dropped rather than left to time out: a `stereum-<id>` host whose container is not running (typically the stopped local CL that put us on this path), and loopback (from the sidecar container, `127.0.0.1` is the sidecar itself).

  A per-node **stats-beacon URL** override (`source: 'custom'`) is persisted in electron-store under `statsBeaconUrl:<nodeId>`, set from a modal in the tab, and wins over both. `normalizeBeaconUrl` allowlists scheme/host/port/path chars because the value is embedded in the sidecar curl command.
- The resolved `source` and `base` are returned to the renderer (also by `getBeaconContext`, which feeds the import chain check and the exit preflight) and surfaced in the tab: the `validator-config` fallback names the URL it fell back to, because the user never chose it and a stale or wrong-network endpoint in a VC config is otherwise invisible.
- Failure detection cannot use the exec's `rc`: the script ends in a `printf`, so `res.rc` is the printf's status, never curl's. Each chunk therefore writes its own `%{http_code}` after the body and the caller errors only when **no** chunk returned 2xx (`000` = never connected).
- `bucketStatus` collapses the beacon's fine-grained status into `Active`/`Pending`/`Exited`/`Slashed`/`Unknown`, matching the `_slashed` **suffix** - `exited_unslashed` contains the substring "slashed" and must not be bucketed as slashed. Balances are gwei → ETH; `withdrawalType` is the creds prefix (`0x00` BLS / `0x01` execution / `0x02` compounding).

**Capabilities and gating** (`utils/validatorCapabilities.js`) - one action set per `role`, split into `rowActions` / `scopeActions` / `drawerActions` plus an explanatory `note`. Actions carry flags the gate honors: `mutating` (writes on-node), `implemented` (a mutating action WITHOUT this renders disabled with a "soon" hint), `needsGraffiti` (the graffiti route is version-gated per client), `needsIndex` (needs the beacon index), `danger`, `disabled`. `mutating` describes what an action DOES, not whether it is available, so it stays set once implemented.

`actionDisabled(action, ctx)` / `actionHint(action, ctx)` are the single gate, consulted by the row menu, the scope bar, and the drawer alike - they each used to carry their own copy of the rule, which is how an action ends up enabled in one surface and disabled in another. Only `solo` setups are ever eligible for the local keystore lifecycle (`isSoloEligible`); Obol and SSV mutations are multi-party/on-chain and stay pointed at the DV Launchpad or the SSV app. See `## Validator write path` for what each action now does.

**Table UX** (`validators/ValidatorTable.vue`) - a CSS-grid dense table, client-side paginated (25/50/100), with a sticky column header outside the scroll region. Selection is **page-scoped** on the header checkbox (tri-state) with a separate "select all N matching" link, and a scope bar (`All keys` / `Current filter` / `Selection`) decides what a bulk action applies to. Status facets and filter chips disable themselves when stats aren't applicable or aren't loaded yet. The row-action menu is a **teleported popover** positioned from the button's `getBoundingClientRect()`, dismissed on Esc, any outside click, **and any scroll** - its anchor row can move or unmount under it. Search is debounced 150ms. Forced reloads carry the prior `states` forward so enriched columns don't blank out mid-refresh.

---

## Validator write path

Every mutating validator action goes through its **own whitelisted channel**, never `run-node-task`: that returns `{ taskId }` and the renderer never sees the op's result, but all of these return data the UI has to act on (per-key status arrays, the slashing-protection blob). They are fast keymanager calls, not playbooks, so there is no long-running task to observe. Consequence to accept: they do not appear in the TaskPanel.

**Secrets never touch a command line.** The bearer token, keystore JSON, and keystore passwords travel in a curl config piped over SSH stdin (`SSHService.exec(cmd, true, { input })` plus `curl -K -`). `docker run -i` is load-bearing: without it docker closes the container's stdin and curl reads an empty config. The old `buildKeymanagerScript` is gone for writes because it also had a quoting hazard - it interpolated `JSON.stringify(body)` into a single-quoted shell string, and `JSON.stringify` does not escape single quotes, so one apostrophe in a graffiti string or password broke the command. `wrapSidecar` survives for the beacon probe only, which carries nothing secret.

**Bulk actions are one SSH exec, not N.** `buildCurlConfigBatch` joins requests with curl's `next` directive. An argv-level `-w` only applies to the FIRST request in a `next` chain (verified against a real curl), so each section carries its own `write-out` - and since that is a format string, the pubkey is embedded in the marker. Responses are therefore matched **by identity, never by position**, the same invariant the metrics probe follows.

**Per-client status divergence** is absorbed in `keymanager.js`: the spec says 202 for POST and 204 for DELETE, but Prysm answers 200 for both, so `isWriteSuccess` accepts any 2xx. `isClearSuccess` also accepts 404 ("nothing was set", per Prysm) - safe **only** because the graffiti action is gated on a prior successful GET. That gate fails closed: `graffitiSupported` must be proven `true`, since an unproven value would let a clear run against a client with no graffiti route, where the 404 is indistinguishable from success.

**Safety gates, in the main process, not just the modals:**

- **Import** (`slashingProtection.js`) blocks on: unparseable file, `interchange_format_version !== "5"`, missing `genesis_validators_root`, a root that does not match **this node's own** (read live from `GET /eth/v1/beacon/genesis`), any imported pubkey absent from `data[]`, and any `slot`/`source_epoch`/`target_epoch` appearing as a JSON **number** rather than a string. That last one is blocking rather than a warning because a number means some layer already parsed a uint64 into a float, so the value may already be wrong. Importing with no protection at all requires an explicit `acknowledgedNeverSigned` flag, which `Node.importValidatorKeys` enforces itself - the modal's checkbox is not trusted.
- **Removal** returns the EIP-3076 record; the UI must save it before rendering success. Repeating a delete is explicitly safe and re-returns the same data, which is the recovery path.
- **Exit** (`voluntaryExit.js`) is two steps: the validator client SIGNS (`POST .../voluntary_exit`, epoch param **omitted** so the client uses its own slot clock) and the beacon node BROADCASTS (`POST /eth/v1/beacon/pool/voluntary_exits`) with the signed data **unwrapped** - re-wrapping it in `{data:...}` yields a 400 that reads like a signature error. Eligibility requires `active_ongoing` and `current_epoch >= activation_epoch + 256` (SHARD_COMMITTEE_PERIOD, the most common real rejection), and a syncing or optimistic beacon blocks. `toValidatorStat` keeps `rawStatus` because the coarse bucket cannot tell `active_ongoing` from `active_exiting`.
- **The signed exit message never crosses IPC.** It is a bearer credential with no expiry: anyone holding it can exit that validator at any later time. It is produced and consumed inside `Node.submitVoluntaryExit`.
- **Non-solo setups get nothing.** `actionDisabled` (in `validatorCapabilities.js`) is the single gate consulted by the row menu, the scope bar, and the drawer; `_validatorConfig` refuses in main as well. An Obol share, a Charon DV, SSV, and Web3Signer are all excluded.

**Bulk scope has one rule** (`utils/validatorScope.js`). The count in the scope bar and the keys a bulk action writes to are both derived from `scopeTargets`/`scopeCountOf`, because deriving them separately is how the bar came to say "200 keys" while the write touched the 25 checked on the current page. Changing a filter drops a blanket "select all N matching", since that affirmation was about a set that no longer exists.

---

## Connection Watcher & Reconnect

**Detection** (`SSHService`):

- ssh2 keepalive (`keepaliveInterval=10s`, `keepaliveCountMax=3`, `readyTimeout=15s`) fires `close` ~30s after the peer goes dark.
- Every `exec()` has a 15s timeout - dead-socket calls reject fast instead of hanging.
- `_reachable` flag short-circuits `_getConnection()` so callers fail immediately when the host is known-down.

**Status propagation:**

- `SSHService` accepts an `onStateChange(state)` callback in its constructor (Node wires it to `Node._setStatus`).
- States: `'connected' | 'reconnecting' | 'disconnected'`. Transitions are deduped via `_lastState`.
- `Node` keeps its own `status` field plus an `onStatusChange(cb)` listener registry. `ipcHandlers.ssh-login` subscribes and broadcasts `node-status-changed` to all `BrowserWindow`s.
- Renderer: `useNodes._subscribeStatus()` (called once from `refreshNodes`) listens via `window.api.on('node-status-changed', …)`, updates `nodes[]` and purges `nodeCache[id]` on disconnect.

**Reconnect - two entry points, three paths:**

- `SSHService.reconnect()` - single immediate attempt. Used by manual + lazy paths.
- `SSHService._reconnectWithBackoff()` - internal, runs the full `RECONNECT_DELAYS_MS` cycle (`[2s, 5s, 15s, 30s, 60s]` - ~2 min). Used only by the auto path.

1. **Auto (backoff)** - when an established connection drops, `dropConnection` calls `_reconnectWithBackoff()` if `_lastState === 'connected'`. First attempt waits 2s (peer just dropped, give it a moment), schedule tuned to cover wifi blips at the short end and `update-os` reboots at the long end.
2. **Manual** - Reconnect button per row → `store.reconnectNode(id)` → `reconnect-node` IPC → `Node.reconnect()` → `SSHService.reconnect()`. One quick try, fail → `'disconnected'`. User clicks again if needed.
3. **Lazy** - `useNodes._fetchNode` calls `store.reconnectNode(id)` before giving up if the node is currently disconnected. Same single-try semantics - kicks in transparently when opening a disconnected node or hitting Refresh.

**Cancellation:** both entry points share an `AbortController` stored as `_reconnectAbort`. A new call (manual during backoff, or auto-drop during a manual try) aborts the in-flight one and takes over. `disconnect()` also aborts so a removed node doesn't fire stray attempts later. Status stays `'reconnecting'` across attempts (deduped via `_lastState`) - UI sees a single sustained state.

**Duplicate-endpoint guard:** `ssh-login` calls `NodeManager.findNodeByEndpoint(host, port, username)` and returns `{ code: 2, message, nodeId }` if a node with the same login target already exists. `SSHCredentials.vue` routes the user straight to `/node/:nodeId` on this code.

**Naming convention:** internal-only properties/methods on classes and stores are prefixed `_` (e.g. `_reachable`, `_getConnection`, `_onStateChange`, `_lastState`, `_reconnecting` on `SSHService`; `_setStatus`, `_statusListeners` on `Node`; `_subscribeStatus`, `_fetchNode` on `useNodes`). Public API is unprefixed.

---

## Task Manager

Singleton `TaskManager` (`src/main/tasks/TaskManager.js`, same shape as `NodeManager`) that runs long-running operations **asynchronously** (fire-and-forget) as observable tasks - the stereum-launcher model. **In-memory only** - survives navigation, not an app restart (cross-restart history is the future audit-log item). Capped ring buffer (100), newest first.

- `run(label, fn, { nodeId })` - **non-blocking**: creates the task, starts `fn` in the background, and **returns the task id synchronously**. The op no longer holds an IPC call open and survives renderer navigation. Errors are captured on the task (`status: 'failed'` + `error`), **never thrown** - there is no caller awaiting them.
- **Live sub-tasks, grouped per playbook** - `run` runs `fn` inside an `AsyncLocalStorage` context (`taskContext`) carrying a reporter. `runPlaybook` reads it via `getStore()` (no callback threading through Node methods) and, while the playbook runs, **polls the `ANSIBLE_LOG_FOLDER` file every 2s** (`PLAYBOOK_POLL_MS`), parsing and reporting sub-tasks as ansible logs them - so only *executed* steps appear and the panel fills in live. Each `runPlaybook` claims a reporter **segment** (`begin(label)`) that becomes a **group** - so a composite op (multiple playbooks, even parallel like `restartChangedServices`) shows each playbook's steps under its own heading rather than one flat list. The task carries both `groups` (`[{ label, status, subTasks }]`, in `begin()` order) and a flattened `subTasks` (for status/count). Group labels come from `Node._playbookLabel(role, stereumArgs)` (e.g. `Restart service, <short-id>`, `Update controls`). On completion `run` only falls back to parsing the result (`_recordResult`, which also emits groups) when nothing streamed (non-playbook ops).
- **Sub-task parsing** (`parseSubTasks`, exported + unit-tested) mirrors the launcher's TaskManager: the stereumjson **log** (`response.log` - the `ANSIBLE_LOG_FOLDER` file, *not* stdout) splits on blank lines into blocks with `TASK:` / `ACTION:` / `CATEGORY:` lines (CATEGORY ∈ `OK`/`FAILED`/`SKIPPED`); `START_TASK` marker blocks are skipped. Each sub-task is `{ name, action, status, data }` where `data` is the raw block. Task status is `failed` if any block's CATEGORY is `FAILED`.
- **Single dispatch channel:** all tracked ops go through `run-node-task(nodeId, action, args[])` → the `NODE_TASK_ACTIONS` allowlist map (in `ipcHandlers`) resolves `action` to a label + Node call, fires it via `taskManager.run`, and returns `{ taskId }` immediately. Adding a tracked op = one line in `NODE_TASK_ACTIONS`, no new channel. Read-only/fetch calls keep their own channels (renderer needs their return value synchronously).
- **Push**: `TaskManager.onUpdate(cb)` → `ipcHandlers` broadcasts `task-updated` (full DTO) to all windows on create + every transition (incl. each live poll). Renderer: `useTasks` hydrates once via `get-tasks`, stays live off `task-updated`; `runNodeTask(nodeId, action, args)` returns the taskId, `awaitTask(taskId)` resolves when it leaves `running` (used by Node.vue/UpdatesTab.vue to drive their busy/flash/refresh UX off the registry instead of a held IPC call). `useTasks` is fully unit-tested (`tests/renderer/useTasks.test.js`, 100% coverage).
- **`TaskPanel.vue`** - docked drawer (opened from the App header, badge = `runningCount`). Layout is built so it's dismissable at any scroll depth: the panel header (✕) is fixed outside the scroll region, `.task-head` is `sticky top:0` and `.group-head` `sticky top:44px`, and each group's sub-task `<ul>` is height-capped (`max-height:320px`) with its own scroll. A task with one group renders its steps flat; multi-group tasks show a collapsible heading per group (status pill + step count). Clicking a sub-task opens its raw `data` in a **centered modal** (`.modal-overlay`, z-index 300) with a Copy button - not an inline expand, which was too cramped in the 420px drawer. Close icons are stroke-SVG in a `.icon-btn` matching the app header's `.header-action`.
- **v1 scope:** no cancellation; in-memory only. Because ops are async, the renderer no longer receives their return value (e.g. the `restarted[]` summary) - success/failure is read from task status.

---

## Service Config Schema

Each node runs one or more services. Configs live at `/etc/stereum/services/<uuid>.yaml`.

```yaml
id: aaaaaaaa-0000-0000-0000-aaaaaaaaaaaa # UUID, also the filename stem
service: GethService # Service type identifier
image: ethereum/client-go:v1.17.2 # Docker image
network: mainnet
autoupdate: true
configVersion: 1
user: root
entrypoint:
  - geth
command:
  - --mainnet
  - --datadir=/opt/data/geth
  - --http
  - --http.port=8545
  # ... more CLI flags
env: {}
ports:
  - 0.0.0.0:30303:30303/tcp
  - 0.0.0.0:30303:30303/udp
volumes:
  - /opt/stereum/geth-<id>/data:/opt/data/geth
  - /opt/stereum/geth-<id>/engine.jwt:/engine.jwt
dependencies:
  executionClients:
    - service: GethService # service type name
      id: aaaaaaaa-0000-0000-0000-aaaaaaaaaaaa # UUID of the dependency
  consensusClients: []
  mevboost:
    - service: FlashbotsMevBoostService
      id: bbbbbbbb-0000-0000-0000-bbbbbbbbbbbb
  otherServices: []
```

**Key fields used in the UI:**

- `service` - service type name (e.g. `GethService`, `LighthouseBeaconService`)
- `image` - Docker image + tag
- `id` - UUID matching the filename
- `network` - e.g. `mainnet`, `holesky`
- `ports` - exposed port mappings
- `dependencies` - keyed by role (`executionClients`, `consensusClients`, `mevboost`, `otherServices`); each entry is `{ service, id }` - **not** bare UUIDs

---

## Ansible / Service Control

Service lifecycle on the remote host is managed via **Ansible**, not direct Docker commands. Playbooks live at `<controls_install_path>/ansible/controls/` on the host. The universal entry point is `genericPlaybook.yaml`, built by `Node.runPlaybook`:

```bash
ANSIBLE_LOAD_CALLBACK_PLUGINS=1 ANSIBLE_STDOUT_CALLBACK=stereumjson ANSIBLE_DEPRECATION_WARNINGS=false \
  ANSIBLE_LOG_FOLDER=/tmp/stereum-lite-<uuid> \
  ansible-playbook --connection=local --inventory 127.0.0.1, \
  --extra-vars '<json>' <controlsPath>/ansible/controls/genericPlaybook.yaml
```

The `stereumjson` callback writes its structured per-task records (the `TASK:`/`ACTION:`/`CATEGORY:` blocks) to a **per-host file under `ANSIBLE_LOG_FOLDER`, not to stdout** - so `runPlaybook` sets a unique `/tmp/stereum-lite-<uuid>` folder, then after the run reads it back (`sudo sh -c 'cat <folder>/*; rm -rf <folder>'`) and attaches the content as `response.log` (also on the thrown `error.log` when the playbook fails). The task manager parses sub-tasks from `response.log`, not stdout. Run over SSH with `sudo` and an **idle-based** timeout (`SSHService.PLAYBOOK_TIMEOUT_MS` = 10min) - the timer re-arms on every output chunk, so a long-but-live playbook never trips it; only a silent/dead socket does.

**Relevant roles:**

| Role               | Purpose                                                                                |
| ------------------ | -------------------------------------------------------------------------------------- |
| `manage-service`   | Start / stop / restart a single service by UUID                                        |
| `update-services`  | Pull update metadata and bump all image tags                                           |
| `update-stereum`   | Update the stereum controls checkout (optionally pinned to `override_gitcommit`)       |
| `update-changes`   | Apply config migrations the new controls ship (run after `update-stereum`)             |
| `update-os`        | OS package upgrades; pass `only_os_updates:true` to skip the reboot path               |
| `configure-updates`| Add/remove the root cron entry for unattended updates, from stereum.yaml               |
| `delete-service`   | Remove container, image, config file, and data dirs                                    |
| `restart-services` | Restart services with recently-changed configs (we reimplement this in JS - see below) |

**`restart-services` is reimplemented in `Node.js`, not invoked as a role.** `findChangedServiceIds(timeScopeSeconds)` runs `find /etc/stereum/services -newermt "<n> seconds ago"` to list configs touched in the window, then `restartChangedServices()` restarts them **in parallel** (the role does it serially) and finishes with `pruneDocker()` (`docker system prune -af --volumes`) when `prune` is on. The update flows time their playbook run (`_timestamp()`, unix seconds rounded up) and restart everything changed during `elapsed + 10s` (matching the launcher's `restart_time_scope`):

- `updateServices` / `updateStereum` - pure `_runServicesUpdate` / `_runStereumUpdate` then a scoped restart pass.
- `runFullUpdate` → `runAllUpdates` (controls + images, no restart) then **one** restart pass over the whole window.

**Resync is reimplemented in JS too** (`Node.resyncService`, pure helpers in `src/main/nodes/resync.js`, unit-tested in `tests/main/resync.test.js`). Wipes a client's chain data and re-syncs from genesis, or (consensus only) from a checkpoint URL. Sequence: stop → (CL) rewrite the checkpoint/genesis flag in `command` + write config → wipe → start. Order matters: the **reversible** config write precedes the **irreversible** wipe, so a write failure aborts before data loss. Only the 12 concrete EL/CL client types are supported (`DATA_DIR_CONTAINER_PATHS`); the data dir is the host side of the volume whose container path matches. `CHECKPOINT_FLAGS`/`GENESIS_FLAGS` per CL client (genesis flag only for Lighthouse + Teku). UI: a Resync button on `ServicesTab` (gated on the DTO's `resyncable` = `Boolean(resolveDataDir(config))`) opens `ResyncModal.vue`. Consensus clients pick a **checkpoint sync source**: Genesis (no URL), a curated public provider per network, or a custom URL. Providers live in `src/renderer/src/utils/checkpointProviders.js` (`providersForNetwork(network)`; base set mirrors stereum's `clickInstallation.js`, plus a few from the community `eth-clients/checkpoint-sync-endpoints` list). A chosen checkpoint URL must pass a liveness check before Resync is enabled - `check-checkpoint-sync` runs stereum's exact validation (`src/main/nodes/checkpoint.js`, unit-tested `tests/main/checkpoint.test.js`): HEAD `<url>/eth/v2/debug/beacon/states/finalized` via a curl sidecar, ok iff HTTP 200 (status only, no body parse, no cross-provider comparison). Picking a provider auto-checks; a custom URL checks on demand. Dispatched via `run-node-task('resync-service', [id, url?])`.

**Wipe safety** (the whole point - a bad path is `sudo rm -rf` as root): `isSafeDataDir` is a hard JS gate before any `rm` - the resolved dir must be an absolute, metachar-free (allowlisted charset), traversal-free path of depth ≥ 3, not under a system root, anchored to `/opt/stereum` or a non-empty `controls_install_path`, and containing the service UUID. `resolveDataDir` returns `undefined` for unmapped/devnet/missing-volume configs → the op aborts (never a partial wipe). The wipe runs as **`sudo sh -c 'rm -rf <shellQuote(dir)>/*'`** so **root** expands the glob (a bare `sudo rm -rf <dir>/*` silently no-ops on root-owned dirs the SSH user can't list) and uses `PLAYBOOK_TIMEOUT_MS` (deleting hundreds of GB runs silent past the 15s idle exec timeout). `engine.jwt`, the Lighthouse slasher DB, and validator keys are all siblings/separate services, so a data-dir wipe never touches them.

**`/etc/stereum/stereum.yaml` structure** (parsed into `node.settings`):

```yaml
stereum_settings:
  settings:
    controls_install_path: /opt/stereum
    arch: x86_64
    updates:
      lane: stable          # stable | dev - picks updates.json vs updates.dev.json
      unattended:
        install: true       # root cron entry present?
        interval_days: 1    # cron day-of-month step */N (1-28)
        hour: 0
        min: 26
```

That is the whole upstream schema (`controls/roles/setup/templates/stereum.yaml`). Access controls path via `node.settings.stereum_settings.settings.controls_install_path`.

### Update policy

`UpdatePolicy.vue` on the Updates tab edits `updates.*` only (`controls_install_path` and `arch` are install-time facts; changing them breaks every role). Write path mirrors the launcher's `setStereumSettings`, via `run-node-task('set-update-settings', [patch])` → `Node.setUpdateSettings`: validate the patch (`validateUpdatePatch`, unknown keys rejected) → re-read the file → `applyUpdatePatch` (refuses a file without `controls_install_path`) → atomic write (`base64 -d > stereum.yaml.tmp && mv`) → `configure-updates`. **Writing the file alone changes nothing** - only the role touches the cron.

The cron is what really runs, so `get-update-settings` reads it back (`#Ansible: stereum auto unattended update` + the job line) and reports `drift` against the file; the UI offers `apply-update-schedule` (role only) to reconcile. Display rules:

- Cron fires in **server-local** time: the server's IANA zone (timedatectl, `/etc/timezone`, `/etc/localtime` link) or the fixed `date +%z` offset; never this machine's zone. Next runs come from `nextRuns` in `utils/updateSchedule.js`.
- `*/N` is a day-of-month step, not a rolling interval (every 7 days = 1st, 8th, 15th, 22nd, 29th, then the 1st again). Short month-end gaps are flagged per run.
- **Legacy installs** wrote only `install: true`; `configure-updates` then picked `default(59 | random)` minute, `default(3 | random)` hour, `default(1)` day step. Missing fields stay `null` (never invented), `updates.unpinned` flags it, the cron value fills them in the UI, and `cronDrift` only compares fields the file pins (interval defaults to 1). `random` is unseeded, so re-running the role rolls a new time: for an unpinned schedule the card says so, the drift button opens the editor instead of re-applying, and Save is enabled without edits to write the cron's time into the file.
- An unattended run is `update-os` (dist-upgrade, **may reboot**) → `update-stereum` → `update-services` → restart changed; the card spells this out before it is turned on.

**`runPlaybook(role, stereumArgs = {}, topLevelVars = {})` payload shape:**
The JSON passed to `--extra-vars` is `{ stereum_role: role, ...topLevelVars }`, plus a `stereum_args` key **only when `stereumArgs` is non-empty**. Per-role config goes under `stereum_args` (NOT a bare `stereum` key - that was an earlier wrong guess); a few vars are top-level instead.

| Call                                          | payload                                                                                                        |
| --------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `startService`/`stopService`/`restartService` | `stereum_args: { manage_service: { state, configuration: { id } } }` - state ∈ `started`/`stopped`/`restarted` |
| `updatePackage(name)`                         | `stereum_args: { update_package: { name } }`                                                                   |
| `updateOS()`                                  | `only_os_updates: true` (top-level)                                                                            |
| `_runServicesUpdate(ids)`                     | `services_to_update` **top-level**: single id → bare string, multiple → array, none → omitted                  |
| `_runStereumUpdate(commit)`                   | `override_gitcommit: commit` (top-level) when a commit is pinned                                               |
| `applyUpdateSchedule()` (`configure-updates`) | none - the role reads `stereum.settings.updates` from the file `genericPlaybook` loads at start                 |

**From Electron:** SSH exec the playbook command → parse stdout/stderr + exit code for status.

Reference repo: https://github.com/stereum-dev/ethereum-node (see `controls/roles/`)

---

## Design system

All tokens are CSS variables defined in `src/renderer/src/assets/base.css`. **Use the tokens, don't invent new sizes.** If a new component genuinely needs a value not in the scale, add it to `base.css` first and document it here - don't hardcode one-off pixel values in a `.vue` file.

### Colors

| Token                                          | Use                                                                                  |
| ---------------------------------------------- | ------------------------------------------------------------------------------------ |
| `--color-background`                           | view background                                                                      |
| `--color-background-soft`                      | card background (the standard "raised" surface)                                      |
| `--color-background-mute`                      | nested card / list inside a card (e.g. the per-package list)                         |
| `--ev-c-text-1`                                | primary text (titles, body)                                                          |
| `--ev-c-text-2`                                | secondary text (uptime, version, meta info under a label)                            |
| `--ev-c-text-3`                                | tertiary text (placeholders, IDs, small ghost labels)                                |
| `--ev-c-gray-1/2/3`                            | borders / interactive backgrounds (3 is softest, 1 strongest)                        |
| `--color-accent` `#94C5CC`                     | primary CTAs, network tag                                                            |
| `--color-accent-hover` `#7AAEB5`               | accent hover                                                                         |
| `--color-success` `#98c379`                    | start, "up to date", updated-version highlight                                       |
| `--color-danger` `#e06c75`                     | stop, disconnect, error                                                              |
| `--color-warning` `#e5c07b`                    | restart, reconnecting                                                                |
| `--color-{accent,success,danger,warning}-soft` | low-alpha tint of the matching color (chip backgrounds, hover fills)                 |
| `--color-accent-text`                          | text drawn on a filled `--color-accent` button (black on dark theme, white on light) |
| `--color-accent-wash`                          | alpha-on-accent wash (~.06) distinct from `-soft` - selected table row, "All keys" scope tint |
| `--color-accent-border`                        | accent border for the "All keys" scope bar                                          |
| `--color-danger-border`                        | outline for destructive buttons                                                     |
| `--scrim`                                       | modal/drawer overlay backdrop                                                        |
| `--shadow-menu`                                | elevation for floating popovers (row-action menu)                                   |
| `--native-color-scheme`                        | `color-scheme` value for native controls (e.g. `<input type="time">` picker icon), `dark` / `light` per theme |

All semantic colors and their `-soft` variants have a darker counterpart under `[data-theme="light"]` for contrast - never hardcode the hex literals (e.g. `#98c379`, `rgba(152, 195, 121, 0.1)`) in a component or you bake in the dark palette.

**Categorical chart palette** - `--chart-1` … `--chart-6` (fixed hue order, per-theme steps under `[data-theme="light"]`) for encoding distinct entities (currently the per-service disk segments in `NodeMetrics.vue`). Assign by slot, **never cycle** (a 7th entity reuses the last slot). Validated colour-blind-safe against the card surface in both themes (worst adjacent ΔE ≥ 12; validator in the `dataviz` skill). Identity must never be colour-alone - always pair with a labelled legend. Semantic status colors (`--color-success/warning/danger`) are reserved for state, not series.

### Font families

Two bundled font families loaded via `@fontsource` (see `src/renderer/src/main.js`). System fallbacks remain in each stack so the UI is readable if a file fails to load.

| Token         | Family                               | Use                                                                                                              |
| ------------- | ------------------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| `--font-sans` | **Inter** (weights 400/500/600/700)  | everything by default - titles, body, buttons. Inherited from `body`, you almost never need to set `font-family` |
| `--font-mono` | **JetBrains Mono** (weights 400/500) | technical/data strings - UUIDs, host:port, image tags, version diffs, YAML editor, `<code>`                      |

**Rules:**

- Never set `font-family` to a literal stack in a component - reference the token (or inherit).
- Use `--font-mono` _only_ for things the user would expect to be machine-readable (identifiers, addresses, numbers in version strings). Don't use it for prose, labels, or section titles.
- For inline identifiers inside otherwise-sans text (e.g. a commit hash sitting next to "- not in manifest"), wrap the dynamic value in `<span class="mono">…</span>` - the `.mono` utility class is defined globally in `main.css`. Examples currently wrapped: controls commit + version, version-diff chips, image tags, UUIDs, host:port.
- To swap a family, update the token in `base.css` _and_ the `@fontsource/*` imports in `main.js` (only import the weights you actually use - extra weights bloat the bundle for no benefit).
- If you find yourself reaching for a third font (display, condensed, etc.), stop - discuss first. A new font means installing the `@fontsource` package, importing weights, defining a token, and updating this section.

### Type scale

| Token                    | px  | Weight         | Where to use                                      |
| ------------------------ | --- | -------------- | ------------------------------------------------- |
| `--font-size-page-title` | 22  | bold (700)     | view h1 (node name)                               |
| `--font-size-title`      | 15  | semibold (600) | card titles - `service-name`, `host-label`        |
| `--font-size-body`       | 14  | normal         | body text, empty-state messages                   |
| `--font-size-button`     | 13  | medium (500)   | default button labels                             |
| `--font-size-secondary`  | 12  | normal         | secondary info (uptime, version diff, meta chips) |
| `--font-size-meta`       | 11  | normal         | small chips, IDs, micro labels                    |
| `--font-size-micro`      | 10  | normal         | tiny pill labels ("config" / "running")           |

**Rule:** title + secondary-info pairs (e.g. service card name + uptime, host label + version) must use `--font-size-title` (15px) over `--font-size-secondary` (12px). Don't pick 13px for a title or 11px for secondary info - that's what created the recent mismatch.

### Radii

| Token          | px  | Use                                              |
| -------------- | --- | ------------------------------------------------ |
| `--radius-sm`  | 4   | inline chips                                     |
| `--radius-md`  | 6   | small/secondary buttons, list rows inside a card |
| `--radius-lg`  | 8   | default buttons                                  |
| `--radius-xl`  | 10  | cards (service card, host row)                   |
| `--radius-2xl` | 12  | large header cards (node header)                 |

### Spacing scale

`--space-1` 4 · `--space-2` 6 · `--space-3` 8 · `--space-4` 12 · `--space-5` 16 · `--space-6` 20 · `--space-7` 24 · `--space-8` 32 · `--space-9` 40. Use for gaps and margins. Pick the closest - don't add new sizes.

### Component recipes

- **View root** - padding `var(--view-padding)` (32px 40px), gap `var(--space-7)` (24px) between sections.
- **Section title** - `--font-size-button` (13px), `--font-weight-semibold`, `--ev-c-text-2`, uppercase, letter-spacing 0.05em.
- **Card (service / host row)** - background `--color-background-soft`, padding `var(--card-padding)` (14px 18px), radius `--radius-xl` (10px). Gap between cards: `--space-3` (8px).
- **Header card (node header)** - padding `var(--header-card-padding)` (20px 24px), radius `--radius-2xl` (12px).
- **Default button** - padding `var(--button-padding)` (7px 14px), radius `--radius-lg` (8px), font `--font-size-button`. Variants: `.btn-accent` (filled accent), `.btn-ghost` (border-1px gray-2, transparent bg), `.btn-danger` (border + text in `--color-danger`).
- **Small button** (per-row actions, e.g. service Start/Stop) - padding `var(--button-padding-small)` (4px 10px), radius `--radius-md` (6px), font `--font-size-secondary`. Semantic colors via `--color-success`, `--color-danger`, `--color-warning`.
- **Chip / inline tag** - padding `var(--chip-padding)` (2px 7px), radius `--radius-sm` (4px), font `--font-size-meta`. Network tag uses accent with `22` alpha (`#94C5CC22`); version-diff chip uses `--color-success` with low alpha.
- **Dense data table** (`validators/ValidatorTable.vue`) - CSS grid with a fixed `grid-template-columns` shared by the header and body rows (38px checkbox, 84px index, `minmax(0,1fr)` key, then fixed status/balance/withdrawal/actions). Header 38px tall on `--color-background-mute`, rows 46px, `--font-size-meta` uppercase header labels. The scroll region is `max-height: min(62vh, 720px)` on the rows container so the header stays put. Selected row = `--color-accent-wash`.
- **Floating popover** (row-action menu) - teleported to `body`, positioned from the trigger's `getBoundingClientRect()`, `--shadow-menu` elevation. Must dismiss on Esc, outside click, **and scroll** (capture-phase listeners, added only while open).
- **Connect-screen form** (`login/SSHCredentials.vue`) - a **6-column grid**; each field declares a `span` (Name 6, Host 4 + Port 2, the credential pairs 3+3) so related inputs share a row instead of stacking full-width. Add new fields with a span, don't switch the container back to a flex column.
- **Switch** (`UpdatePolicy.vue` schedule dialog) - a `<button role="switch" :aria-checked>`, 40x22 track on `--ev-c-gray-2`, `--color-accent` when on; for settings that save through a draft + Save footer, not instantly.
- **Segmented control** (`.seg`) - `role="radiogroup"` of buttons in a `--color-background-mute` pill; active = `--color-accent-soft` bg + `--color-accent` text.
- **Option cards** (release channel) - radio-style buttons in an `auto-fit` grid; active = `--color-accent` border + `--color-accent-wash`.
- **Summary card + editor dialog** - a settings card stays a compact summary (status pill, one-line state, an `Edit` / `Set up` `btn-edit`); the form lives in a `.modal-wide` dialog (620px, body scrolls, header and footer fixed). Every open starts from the saved state; Cancel/Esc/overlay discard. The footer is split: change summary left, Cancel + Save right, Save disabled until dirty and valid; a failed save keeps the dialog open with the error inside it.
- **Transitions** - use `var(--transition-fast)` (150ms) for background/border hover transitions.

### Theming (dark + light)

The app supports a manual dark/light toggle. Token NAMES are theme-agnostic - components only reference `--color-background`, `--ev-c-text-1`, etc., and the active theme remaps the values. The light theme is defined under `:root[data-theme="light"]` in `base.css`. Selection lives in `useThemeStore` (`@stores/useTheme`), persists via `localStorage`, and is applied by writing `document.documentElement.dataset.theme`. The toggle UI lives inside the global Settings panel - opened from the gear icon in the app header (`App.vue` renders a 40px sticky header containing the brand + the settings trigger). Add future global preferences as new sections in `SettingsPanel.vue`; future global header items (status indicators, quick actions) go in `App.vue`'s `.app-header`.

**Rule:** never hardcode `#1b1b1f`, `rgba(255,255,245,…)`, etc. in a component - those bake in the dark palette. Always reference the token. The semantic colors (`--color-success/danger/warning/accent`) are vivid enough to read on both themes; if a component needs theme-specific behavior beyond the tokens, override under `:root[data-theme="light"]` in `base.css`, not inside the component.

### What to do when adding a new component

1. Check if it's already in the recipes above - service card, host row, button, chip, etc. If yes, copy that recipe.
2. If genuinely new: pick from the existing tokens (color, type, radius, spacing). If you find yourself reaching for a hardcoded px value, stop and ask whether an existing token works.
3. If a new token is truly needed, add it to `base.css` AND this table in the same change.
