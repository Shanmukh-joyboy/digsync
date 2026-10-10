import { describe, it, expect } from 'vitest'
import { findConflicts, conflictPairs, meters } from './geo'

const base = { id: 1, status: 'ongoing', lat: 12.84, lng: 80.08, start_date: '2027-01-01', end_date: '2027-06-30' }

describe('findConflicts', () => {
    it('flags a nearby project with overlapping dates', () => {
        const other = { ...base, id: 2, lat: 12.8405 }
        expect(findConflicts(base, [other])).toHaveLength(1)
    })
    it('ignores a project more than 150 m away', () => {
        const far = { ...base, id: 2, lat: 12.846 }
        expect(findConflicts(base, [far])).toHaveLength(0)
    })
    it('ignores completed projects', () => {
        const done = { ...base, id: 2, status: 'completed' }
        expect(findConflicts(base, [done])).toHaveLength(0)
    })
    it('ignores projects whose dates are far apart', () => {
        const later = { ...base, id: 2, start_date: '2030-01-01', end_date: '2030-06-30' }
        expect(findConflicts(base, [later])).toHaveLength(0)
    })
    it('returns nothing when the location or dates are missing', () => {
        expect(findConflicts({ ...base, lat: null }, [base])).toEqual([])
        expect(findConflicts({ ...base, end_date: '' }, [base])).toEqual([])
    })
})

describe('meters', () => {
    it('is zero for the same point and about 111 m per 0.001 degree of latitude', () => {
        expect(meters(base, base)).toBe(0)
        expect(meters(base, { lat: 12.841, lng: 80.08 })).toBeGreaterThan(105)
        expect(meters(base, { lat: 12.841, lng: 80.08 })).toBeLessThan(115)
    })
})

describe('conflictPairs', () => {
    it('returns each conflicting pair once', () => {
        const a = { ...base, id: 1 }, b = { ...base, id: 2, lat: 12.8405 }, c = { ...base, id: 3, lat: 12.9 }
        expect(conflictPairs([a, b, c])).toHaveLength(1)
    })
    it('matches the brute-force result', () => {
        const list = Array.from({ length: 30 }, (_, i) => ({
            ...base, id: i + 1, lat: 12.84 + (i % 5) * 0.0006, lng: 80.08 + Math.floor(i / 5) * 0.0006,
        }))
        let brute = 0
        list.forEach((a, i) => list.slice(i + 1).forEach((b) => { if (findConflicts(a, [b]).length) brute++ }))
        expect(conflictPairs(list)).toHaveLength(brute)
    })
    it('skips completed projects and missing coordinates', () => {
        expect(conflictPairs([base, { ...base, id: 2, status: 'completed' }])).toHaveLength(0)
        expect(conflictPairs([base, { ...base, id: 2, lat: null }])).toHaveLength(0)
    })
})