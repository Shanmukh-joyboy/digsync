export const day = 86400000
export const RADIUS_M = 150
export const WINDOW_DAYS = 180

export function meters(a, b) {
    const R = 6371000, rad = (x) => (x * Math.PI) / 180
    const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng)
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2
    return 2 * R * Math.asin(Math.sqrt(h))
}

function overlaps(a, b) {
    const s = new Date(a.start_date).getTime() - WINDOW_DAYS * day
    const e = new Date(a.end_date).getTime() + WINDOW_DAYS * day
    return new Date(b.start_date).getTime() <= e && new Date(b.end_date).getTime() >= s
}

// Other active projects within 150 m and overlapping dates (±180 days) of the given one
export function findConflicts(d, projects) {
    if (!d.lat || !d.start_date || !d.end_date) return []
    return projects.filter((p) => p.status !== 'completed' && meters(d, p) < RADIUS_M && overlaps(d, p))
}

// Every conflicting pair, each once. A grid means each project is compared only with
// its neighbours instead of with all other projects, so it scales to thousands.
export function conflictPairs(projects) {
    const CELL = 0.002 // about 220 m, larger than the 150 m radius, so the 3x3 neighbourhood is enough
    const ok = (p) =>
        p.status !== 'completed' && p.start_date && p.end_date &&
        Number.isFinite(Number(p.lat)) && Number.isFinite(Number(p.lng))
    const active = projects.filter(ok)
    const key = (i, j) => i + ':' + j
    const cell = (p) => [Math.floor(Number(p.lat) / CELL), Math.floor(Number(p.lng) / CELL)]

    const grid = new Map()
    active.forEach((p) => {
        const k = key(...cell(p))
        if (!grid.has(k)) grid.set(k, [])
        grid.get(k).push(p)
    })

    const pairs = []
    active.forEach((a) => {
        const [i, j] = cell(a)
        for (let di = -1; di <= 1; di++) {
            for (let dj = -1; dj <= 1; dj++) {
                ; (grid.get(key(i + di, j + dj)) || []).forEach((b) => {
                    if (String(a.id) < String(b.id) && meters(a, b) < RADIUS_M && overlaps(a, b)) pairs.push([a, b])
                })
            }
        }
    })
    return pairs
}