import { describe, it, expect } from 'vitest'
import { findConflicts, meters } from './geo'

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