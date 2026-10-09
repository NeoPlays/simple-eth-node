import { describe, it, expect } from 'vitest'
import { statusDetail, roughDuration } from '@renderer/utils/validatorStatus'

describe('statusDetail', () => {
    it('places a queued deposit, with an estimate', () => {
        const d = statusDetail({ rawStatus: 'deposit_queued', depositQueue: { position: 913, length: 942, amountEth: 32, aheadEth: 2058.5, etaSeconds: 58 * 384 } })
        expect(d.short).toBe('Deposit #913/942')
        expect(d.long).toContain('32 ETH, 2,058.5 ETH ahead')
        expect(d.long).toContain('about 6 h (estimate)')
    })
    it('covers the pending states after the deposit', () => {
        expect(statusDetail({ rawStatus: 'pending_initialized' }).short).toBe('Deposit processed')
        expect(statusDetail({ rawStatus: 'pending_queued', activationEligibilityEpoch: '128470' })).toMatchObject({ short: 'Activation queue' })
        expect(statusDetail({ rawStatus: 'pending_queued', activationEligibilityEpoch: '128470' }).long).toContain('since epoch 128470')
        expect(statusDetail({ rawStatus: 'pending_queued', activationEpoch: '128480' }).short).toBe('Activates epoch 128480')
    })
    it('adds nothing for settled states', () => {
        expect(statusDetail({ rawStatus: 'active_ongoing' })).toBeNull()
        expect(statusDetail(null)).toBeNull()
    })
})

describe('roughDuration', () => {
    it('rounds to what an estimate can claim', () => {
        expect(roughDuration(45 * 60)).toBe('about 45 min')
        expect(roughDuration(6.2 * 3600)).toBe('about 6 h')
        expect(roughDuration(3 * 86400)).toBe('about 3 d')
        expect(roughDuration(0)).toBe('')
    })
})
