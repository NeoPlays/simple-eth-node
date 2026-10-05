// Version lookups against the stereum updates manifest (updates.json / updates.dev.json).
//
// The manifest only lists some networks (mainnet, holesky, hoodi, sepolia, ...). Gnosis and any
// other network it lacks fall back to the mainnet list - exactly what the `update-services` role
// does when it picks the new image tag:
//   update_data.json.get(network, {}).get(service, update_data.json.get('mainnet', {}).get(service, []))
// and what the launcher's version.js does. Without the fallback a gnosis node always reads "up to
// date" here while the role would in fact move it to the newest mainnet tag.

/** Manifest versions for a service type on a network, mainnet as fallback; null when unlisted. */
export function manifestVersions(manifest, network, serviceType) {
    if (!manifest || !serviceType) return null
    const own = manifest[network]?.[serviceType]
    if (Array.isArray(own) && own.length) return own
    const fallback = manifest.mainnet?.[serviceType]
    return Array.isArray(fallback) && fallback.length ? fallback : null
}

/** The latest manifest version for a service type (last entry), or null. */
export function latestVersion(manifest, network, serviceType) {
    return manifestVersions(manifest, network, serviceType)?.at(-1) ?? null
}
