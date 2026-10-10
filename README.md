# DigSync

**Dig once. Know always.**

[![Live Demo](https://img.shields.io/badge/Live%20Demo-Vercel-black?logo=vercel)](https://digsync.vercel.app)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](#license)

Built for the **24-Hour Web Development Hackathon**, IIITDM Kancheepuram (9-10 October 2026) · **Track: CivicTech** · Pilot city: Chennai

- 🌐 **Live app:** [digsync.vercel.app](https://digsync.vercel.app)
- 🎥 **Demo video:** [`video demo link`](https://drive.google.com/file/d/1F0J9gewH2vs-PjuxQuc-c2g9eM8p4zI9/view?usp=sharing)
- 💻 **Source:** [github.com/Shanmukh-joyboy/digsync](https://github.com/Shanmukh-joyboy/digsync)

---

## Problem Statement

**Context:** Roads get dug up and pipelines get laid by many different departments and contractors. Residents see the work happening but rarely know why it is being done, how long it will take, or who is responsible.

**Problem:** Departments often plan work without knowing what others have scheduled, so a road is dug up by one agency, repaved, then dug up again by another. When a project stalls, there is no simple way to follow up, check progress, or hold anyone accountable.

**Impact:** Citizens face repeated disruption, public money is wasted on duplicated work, and trust in civic institutions suffers.

*Hackathon problem statement: "Improving Transparency and Coordination in Public Works Projects."*

---

## Our Solution

DigSync is a public web platform that shows who is digging where. Every project appears on an interactive map and list with its department, purpose, timeline, and status. Departments are warned about overlapping works before they happen, and citizens can report problems and see whether the responsible department replies.

---

## Key Features

**For citizens**
- Browse every project on a map and list, with no login needed
- Search by title, road, department, or contractor, and filter by status or overdue
- **Near me:** use your location to see projects within 1, 2, 5, or 10 km, sorted by distance
- File reports (delay, poor quality, safety hazard, progress update) and confirm other people's reports with **Affects me too**
- See official department replies under each report
- Share a link that opens straight on a project

**For departments**
- Add and update only your own projects, enforced by the database
- **Coordination alert** when a new project is close to other active work with overlapping dates
- Update status and progress, with every change recorded in a public update history
- Reply officially to citizen reports on your projects

**For planners, researchers, and journalists**
- **Stats** page: overdue work by department, most-reported projects, report types, coordination conflicts, and department responsiveness
- Open data: download all projects as CSV

---

## Try It

Anyone can browse without an account. To see the full flow, use the demo logins:

| Role | Email | Password |
|---|---|---|
| Department (CMRL) | `cmrl@demo.com` | `1234567` |
| Department (another agency) | `cmda@demo.com` | `1234567` |
| Citizen | `citizen@demo.com` | `1234567` |

**Suggested walkthrough (about two minutes)**
1. Log in as a department and choose **+ Add project**. Click the map next to an existing project and set overlapping dates. The **coordination alert** appears before you save.
2. Log out, log in as a citizen, open a project, and file a report. Tap **Affects me too** on someone else's report.
3. Log back in as the owning department and post an **official reply**. Only the department that owns the project can reply.
4. Open **Stats** and watch the **department responsiveness** bar move.
5. Tap **📍 Near me** to see projects around you, nearest first.

---

## How the Conflict Detector Works

Two projects are flagged for coordination when all of these are true:

1. Neither project is completed.
2. They are **less than 150 m apart**.
3. Their dates, widened by **180 days** on each side, overlap.

When a conflict is found, DigSync warns the department so the jobs can be merged or reordered instead of repeated.

To keep this fast, projects are placed in a spatial grid and each one is compared only with its neighbours instead of with every other project. The same result feeds the map rings, the list warnings, the Add project alert, and the Stats page. Unit tests check that the grid result matches a brute-force comparison.

---

## Tech Stack

| Layer | Choice |
|---|---|
| Front end | React (Vite), React Router |
| Map | Leaflet via react-leaflet, OpenStreetMap tiles |
| Backend | Supabase: PostgreSQL, Auth, Realtime, Row Level Security |
| Hosting | Vercel |
| Tests | Unit tests for the conflict logic (`npm test`) |

---

## Architecture

DigSync is a single-page React app built with Vite. The frontend talks directly to Supabase through the Supabase JS client: Auth handles login, PostgreSQL stores the data, Row Level Security decides who can change what, and Realtime pushes updates to open pages. Project locations are drawn on a Leaflet map (via react-leaflet) using OpenStreetMap tiles, and the same project data powers both the map and the list view. The app is deployed on Vercel.

```
Browser (React + Vite + React Router)
        │                     │
        ▼                     ▼
 Supabase JS client     react-leaflet / Leaflet
        │                     │
        ▼                     ▼
 Supabase (Postgres,     OpenStreetMap tiles
 Auth, Realtime, RLS)
```

---

## Open-Source Libraries and APIs Used

| Name | Purpose | License |
|------|---------|---------|
| [React](https://react.dev) | UI library for building the frontend | MIT |
| [Vite](https://vitejs.dev) | Build tool and development server | MIT |
| [React Router](https://reactrouter.com) | Client-side routing between pages | MIT |
| [Supabase JS client](https://github.com/supabase/supabase-js) | Connects the app to Supabase (database, auth, realtime) | MIT |
| [Leaflet](https://leafletjs.com) | Interactive map library | BSD-2-Clause |
| [react-leaflet](https://react-leaflet.js.org) | React components for Leaflet | Hippocratic License 2.1 |
| [OpenStreetMap tiles](https://www.openstreetmap.org) | Map tile imagery and map data | ODbL (data); tiles require attribution |

---

## Setup Instructions

### Prerequisites

- [Node.js](https://nodejs.org) (LTS version)
- [Git](https://git-scm.com)

### Steps

1. **Clone the repository**

   ```bash
   git clone https://github.com/Shanmukh-joyboy/digsync.git
   cd digsync
   ```

2. **Install dependencies**

   ```bash
   npm install
   ```

3. **Create a `.env` file** in the project root with your own Supabase project values:

   ```env
   VITE_PUBLIC_SUPABASE_URL=your_supabase_project_url
   VITE_PUBLIC_SUPABASE_PUBLISHABLE_KEY=your_supabase_publishable_key
   ```

4. **Run the SQL scripts** in the Supabase SQL editor to create the tables and policies.

5. **Start the development server**

   ```bash
   npm run dev
   ```

6. **Open the app** at [http://localhost:5173](http://localhost:5173)

To run the tests:

```bash
npm test
```

Department accounts are created by an administrator in Supabase, with the department name stored in the user's `app_metadata`. Citizens can sign up themselves.

---

## Database Schema

| Table | Description |
|-------|-------------|
| `projects` | Each public works project, with its department, purpose, location, timeline, status, and progress. |
| `reports` | Citizen reports on a project (delay, poor quality, safety hazard, progress update). |
| `report_votes` | "Affects me too" confirmations on a report. |
| `report_replies` | Official replies from the owning department to a report. |
| `project_audit` | Public history of every status or progress change, so delays are traceable. |

---

## Security and Trust

- **Row Level Security** on every table. Departments can only change their own projects.
- **Official replies** are tied to the owning department by a database policy, not just by the interface.
- A blocked write shows an error instead of failing silently.
- Every status or progress change is **audited**, and the history is public.
- The CSV export neutralises spreadsheet formulas, so downloaded data is safe to open.
- Your location is used only in the browser to sort and filter the list. It is never sent to the database.

---

## Reliability

- Failed loads, blocked updates, and an offline state all show a message.
- Realtime updates are debounced, so a burst of changes triggers one reload.
- A render error shows a recovery screen instead of a blank page.
- Projects with bad or missing coordinates are skipped instead of crashing the map.
- Database indexes cover the main lookups: reports by project, votes by report, projects by department and status, and audit history.

---

## Demo Data

All data is **simulated for demonstration**. Chennai projects were entered by hand, and dates and locations are indicative, not official records.

---

## Limitations and Future Scope

### Current Limitations

- **Chennai pilot.** Near me works anywhere in India, but outside Chennai there are no projects to show yet.
- **Location accuracy.** Laptops estimate position from Wi-Fi or IP and can be a kilometre or more off. Phones with GPS are much better.
- **Map tiles.** The free OpenStreetMap servers can be slow at busy times.
- **Sign-up emails.** Email confirmation for new citizens depends on the limits of the email service configured in Supabase.
- **Department accounts** are issued manually, and there is no self-service verification yet.

### Future Scope

1. Import official project and tender data from agency portals instead of manual entry.
2. Notify the other agency by email or SMS the moment a conflict appears (Supabase Edge Functions).
3. Photo evidence on citizen reports (Supabase Storage).
4. Road-network-aware conflict detection and a "dig freeze" calendar for newly resurfaced roads.
5. At city scale: move conflict detection into PostGIS (`ST_DWithin` with a GiST index), paginate reports, and subscribe to realtime per table.

---

## Project Structure

```
src/
  App.jsx          Map, list, project detail, reports, replies, stats, login
  supabase.js      Supabase client
  lib/geo.js       Distance, conflict check, and grid-based conflict pairs
  lib/geo.test.js  Unit tests for the conflict logic
  styles.css       Styles, including the mobile layout
```

---

## Team and Acknowledgements

**Team:** Shanmukh Prasad, Vamsi Krishna, Guru Charan, Santosh

Thanks to the organizers of the 24-Hour Web Development Hackathon at IIITDM Kancheepuram, and to the open-source communities behind React, Vite, React Router, Supabase, Leaflet, react-leaflet, and OpenStreetMap. Map data © OpenStreetMap contributors.

---

## License

This project is licensed under the **MIT License**. See the [LICENSE](LICENSE) file for details.