export const day = 86400000

export function meters(a, b) {
    const R = 6371000, rad = (x) => (x * Math.PI) / 180
    const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng)
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2
    return 2 * R * Math.asin(Math.sqrt(h))
}

// Another active project within 150 m and within 180 days of the given one
export function findConflicts(d, projects) {
    if (!d.lat || !d.start_date || !d.end_date) return []
    const s = new Date(d.start_date).getTime() - 180 * day
    const e = new Date(d.end_date).getTime() + 180 * day
    return projects.filter(
        (p) =>
            p.status !== 'completed' &&
            meters(d, p) < 150 &&
            new Date(p.start_date).getTime() <= e &&
            new Date(p.end_date).getTime() >= s
    )
}