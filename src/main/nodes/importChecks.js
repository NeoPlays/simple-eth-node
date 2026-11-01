/**
 * Pure helpers around key import and removal: request chunking and Prysm's wallet bootstrap.
 * (Whether a key is signing elsewhere is onchainCheck.js.) The exec side lives in Node.js.
 * Sizes and client behaviour are taken from upstream stereum's Validators.js, which was tested
 * against real clients.
 */
// Keys per DELETE: large deletes ran validator clients out of memory (curl exit 52), and each
// answer carries its keys' full signing history.
export const DELETE_CHUNK = 20
// Keystores per import request: the client decrypts each one, which is slow for many at once.
export const IMPORT_CHUNK = 50
// Keystore + password + protection bytes per import request, well under curl's ~10 MB config limit
// and any client's request body limit.
export const IMPORT_BYTES = 1_000_000

export const chunked = (list, size) =>
    Array.from({ length: Math.ceil(list.length / size) }, (_, i) => list.slice(i * size, (i + 1) * size))

/**
 * [start, end) ranges of keystores per import request, by count and by size. A single keystore
 * larger than the byte budget still gets a chunk of its own rather than being dropped.
 * @param {number[]} sizes - bytes per keystore (keystore + password + its protection share)
 */
export function importChunks(sizes, { maxCount = IMPORT_CHUNK, maxBytes = IMPORT_BYTES } = {}) {
    const chunks = []
    let start = 0
    let bytes = 0
    sizes.forEach((size, i) => {
        if (i > start && (i - start >= maxCount || bytes + size > maxBytes)) {
            chunks.push([start, i])
            start = i
            bytes = 0
        }
        bytes += size
    })
    if (sizes.length) chunks.push([start, sizes.length])
    return chunks
}

// ---------------------------------------------------------------------------------------------
// Prysm wallet bootstrap. Prysm's keymanager answers 503 "wallet not initialized" until a wallet
// exists, and the first import has to create one (mirrors upstream ValidatorAccountManager.initWallet).
// ---------------------------------------------------------------------------------------------

const PRYSM_WALLETS = '/opt/app/data/wallets'
const PRYSM_PASSWORDS = '/opt/app/data/passwords'
const SAFE_PATH = /^\/[A-Za-z0-9._\-/]+$/

export const isPrysmWalletMissing = (body) => {
    try { return /wallet not initialized/i.test(String(JSON.parse(body)?.message ?? '')) } catch { return false }
}

function hostPath(config, containerPath) {
    for (const v of (config?.volumes || [])) {
        const [host, container] = String(v).split(':')
        if (container?.replace(/\/+$/, '') === containerPath && SAFE_PATH.test(host) && !host.split('/').includes('..')) {
            return host.replace(/\/+$/, '')
        }
    }
    return null
}

/**
 * The commands to create a Prysm wallet, or null when the config does not map both volumes or the
 * id/network are not plain tokens. Paths are allowlisted, so they go into `sh -c` unquoted safely.
 */
export function prysmWalletCommands(serviceId, config) {
    const wallets = hostPath(config, PRYSM_WALLETS)
    const passwords = hostPath(config, PRYSM_PASSWORDS)
    const network = String(config?.network ?? '')
    if (!wallets || !passwords || !/^[a-z0-9-]+$/.test(network) || !/^[A-Za-z0-9-]+$/.test(String(serviceId))) return null
    const password = `${passwords}/wallet-password`
    return {
        // READY: a wallet and its password exist. ORPHAN: a wallet without its password, which a
        // new password would brick - refused rather than "repaired".
        check: `sh -c 'if [ -d ${wallets}/direct/accounts ]; then if [ -s ${password} ]; then echo WALLET_READY; else echo WALLET_ORPHAN; fi; else echo WALLET_MISSING; fi'`,
        // The password goes over stdin, never on a command line.
        writePassword: `tee ${password} > /dev/null`,
        securePassword: `sh -c 'chmod 700 ${password} && chown 2000:2000 ${password}'`,
        create: `docker exec stereum-${serviceId} /app/cmd/validator/validator wallet create --wallet-dir=${PRYSM_WALLETS} --wallet-password-file=${PRYSM_PASSWORDS}/wallet-password --accept-terms-of-use --keymanager-kind=direct --${network}`,
        ownWallet: `chown -R 2000:2000 ${wallets}`,
    }
}
