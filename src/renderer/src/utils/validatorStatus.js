// Readable detail for validators that are not active yet: where in the onboarding pipeline they
// are. The coarse status bucket says "Pending" for all of these; the operator's question is
// "how far along, and how long".
//
//   deposit_queued      deposit seen, waiting in Electra's pending_deposits queue - no validator yet
//   pending_initialized deposit processed, validator created, not yet eligible
//   pending_queued      eligible, waiting for an activation epoch (or scheduled for one)

/** "about 6 h" / "about 45 min" / "about 2 d" - coarse on purpose, the input is an estimate. */
export function roughDuration(seconds) {
    if (!Number.isFinite(seconds) || seconds <= 0) return ''
    const min = Math.round(seconds / 60)
    if (min < 60) return `about ${Math.max(1, min)} min`
    const h = Math.round(seconds / 3600)
    if (h < 48) return `about ${h} h`
    return `about ${Math.round(seconds / 86400)} d`
}

const eth = (v) => (Number.isFinite(v) ? Number(v).toLocaleString('en-US', { maximumFractionDigits: 2 }) : '?')

/**
 * `{ short, long }` for a row, or null when its status needs no detail.
 * @param {{ rawStatus?, depositQueue?, activationEpoch?, activationEligibilityEpoch? }} row
 */
export function statusDetail(row) {
    const raw = row?.rawStatus
    if (raw === 'deposit_queued' && row.depositQueue) {
        const q = row.depositQueue
        const when = roughDuration(q.etaSeconds)
        return {
            short: `Deposit #${q.position}/${q.length}`,
            long: `Deposit #${q.position} of ${q.length} in the beacon chain's deposit queue (${eth(q.amountEth)} ETH, ${eth(q.aheadEth)} ETH ahead of it).`
                + (when ? ` Processed in ${when} (estimate); the validator, and its index, appear after that.` : ''),
        }
    }
    if (raw === 'pending_initialized') {
        return { short: 'Deposit processed', long: 'Deposit processed and the validator created; it becomes eligible for activation at the next epoch.' }
    }
    if (raw === 'pending_queued') {
        if (row.activationEpoch != null) {
            return { short: `Activates epoch ${row.activationEpoch}`, long: `Scheduled: active from epoch ${row.activationEpoch}.` }
        }
        return {
            short: 'Activation queue',
            long: `Eligible${row.activationEligibilityEpoch != null ? ` since epoch ${row.activationEligibilityEpoch}` : ''}; waiting for the chain to schedule its activation.`,
        }
    }
    return null
}
