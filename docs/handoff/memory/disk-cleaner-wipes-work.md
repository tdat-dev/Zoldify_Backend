---
name: disk-cleaner-wipes-work
description: "Something on this machine deletes node_modules, android/app/build AND scratchpad subfolders; keep durable seed scripts/manifests in D:\\Zoldify\\seed-data"
metadata:
  node_type: memory
  type: project
  originSessionId: <session>
  modified: 2026-11-02T07:36:13.592Z
---

An unknown cleaner on the user's Windows box repeatedly deletes `wt-mobile/node_modules`, `android/app/build`, and whole subfolders of the Claude scratchpad (D:\Temp\claude\...). On 2026-11-02 the `scratchpad\seed1k` folder (seed manifests manifest-staging/prod.json, delete-seed.mjs) was gone.

**Why:** lost the only list of seeded product ids, needed to undo the seed.
**How to apply:** keep anything that must survive (seed manifests, delete scripts) in `D:\Zoldify\seed-data\`, not in the scratchpad; expect `npm ci` before any mobile rebuild. Related: [[mobile-e2e-emulator]]
