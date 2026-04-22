---
name: Runner launch command
description: The command used to start the claude-runner for the slotforge project
type: reference
---

Start the runner with:
```
npx tsx bin/claude-runner.ts run-all --project slotforge
```

For resuming from a specific story within an epic:
```
npx tsx bin/claude-runner.ts run-epic <epic-name> --project slotforge --start-from <n>
```
