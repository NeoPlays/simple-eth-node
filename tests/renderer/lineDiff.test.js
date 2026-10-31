import { describe, it, expect } from 'vitest'
import { diffLines, hasChanges, withContext } from '../../src/renderer/src/utils/lineDiff'

describe('diffLines', () => {
    it('marks a changed line as removed then added, the rest unchanged', () => {
        expect(diffLines('a\nb\nc\n', 'a\nB\nc\n')).toEqual([
            { type: 'same', text: 'a' },
            { type: 'del', text: 'b' },
            { type: 'add', text: 'B' },
            { type: 'same', text: 'c' },
        ])
    })

    it('handles pure additions and removals at the ends', () => {
        expect(diffLines('a\n', 'a\nb\n').map((d) => d.type)).toEqual(['same', 'add'])
        expect(diffLines('x\na\n', 'a\n').map((d) => d.type)).toEqual(['del', 'same'])
    })

    it('finds no change in identical text, ignoring the trailing newline', () => {
        expect(hasChanges(diffLines('a\nb\n', 'a\nb\n'))).toBe(false)
        expect(hasChanges(diffLines('a\nb', 'a\nb\n'))).toBe(false)
        expect(hasChanges(diffLines('a', 'b'))).toBe(true)
    })
})

describe('withContext', () => {
    it('folds long unchanged runs and keeps context around changes', () => {
        const before = Array.from({ length: 20 }, (_, i) => `l${i}`).join('\n')
        const after = before.replace('l10', 'L10')
        const view = withContext(diffLines(before, after), 2)
        expect(view[0]).toEqual({ type: 'skip', count: 8 })
        expect(view.filter((d) => d.type === 'same').map((d) => d.text)).toEqual(['l8', 'l9', 'l11', 'l12'])
        expect(view[view.length - 1]).toEqual({ type: 'skip', count: 7 })
    })
})
