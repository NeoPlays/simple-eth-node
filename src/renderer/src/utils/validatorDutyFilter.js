// Which validator rows carry which upcoming duty.
//
// Extracted for the same reason as validatorScope: the chip shows a COUNT and the table shows the
// FILTERED rows, and those are two derivations of one rule. If they drift, the chip reads
// "Proposing 3" and clicking it lists two keys - a discrepancy nobody can debug from the screen.
// Both now come from the predicates below.
//
// A row's `duty` is null when the key has no on-chain index (nothing scheduled for something the
// beacon has never heard of), and EMPTY_DUTY when it is on chain with nothing due.

/** One predicate per duty chip, keyed by the chip's key. */
export const DUTY_PREDICATES = {
    dutyPropose: (duty) => Boolean(duty?.proposals?.length),
    dutySync: (duty) => duty?.syncCurrent === true,
    dutySyncNext: (duty) => duty?.syncNext === true,
}

export const DUTY_KEYS = Object.keys(DUTY_PREDICATES)

/** Does this row carry the duty named by `key`? Unknown keys are never a match. */
export function hasDuty(row, key) {
    return DUTY_PREDICATES[key]?.(row?.duty) ?? false
}

/**
 * How many of `rows` carry each duty. Always counted over every row, never the filtered view -
 * an overview that shrank as you filtered would not be an overview.
 * @returns {{ dutyPropose: number, dutySync: number, dutySyncNext: number }}
 */
export function countDuties(rows = []) {
    const out = Object.fromEntries(DUTY_KEYS.map((k) => [k, 0]))
    for (const row of rows) {
        for (const k of DUTY_KEYS) if (hasDuty(row, k)) out[k]++
    }
    return out
}

/**
 * Does the row survive the active duty chips? Chips AND together (matching the other chips in the
 * toolbar), and no active duty chip means no duty constraint at all.
 */
export function matchesDutyChips(row, chips = {}) {
    for (const k of DUTY_KEYS) if (chips[k] && !hasDuty(row, k)) return false
    return true
}

/**
 * Every proposal across all rows, earliest slot first, tagged with the validator index that draws
 * it. This is what the "what is about to happen" line reads from.
 * @returns {{ slot: number, time: number|null, index: number|null }[]}
 */
export function allProposals(rows = []) {
    const out = []
    for (const row of rows) {
        for (const p of (row?.duty?.proposals || [])) out.push({ ...p, index: row.index ?? null })
    }
    return out.sort((a, b) => a.slot - b.slot)
}
