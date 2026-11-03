---
name: docker-in-wsl-test-db
description: Docker on this machine lives inside WSL Ubuntu (no Docker Desktop); how to run Zoldify DB tests (zoldify-test-mysql :3307) and the side effects
metadata:
  node_type: memory
  type: reference
  originSessionId: <session>
  modified: 2026-10-05T07:59:12.456Z
---

As of 2026-10-05 there is no Docker Desktop and `docker` is not on the Windows PATH. Docker runs inside WSL distro `Ubuntu` (normally Stopped). Container `zoldify-test-mysql` (mysql:8, root/<pass>, db zoldify_test, port 3307) exists there for jest DB specs (ledger.service.spec, orders.service.spec).

Gotchas:
- Starting WSL auto-starts other projects' containers with restart policies (wakerflow-*, bw-redis); `wakerflow-api` takes port 3000, which clashes with the Zoldify backend dev port. Run `wsl --terminate Ubuntu` when done.
- WSL shuts the VM down as soon as the `wsl` command exits, killing MySQL. Keep a hidden `wsl -d Ubuntu -- sleep 1800` running while tests run.
- With the VM alive, 127.0.0.1:3307 is forwarded to Windows; orders.service.spec also accepts TEST_DB_HOST.
- The Bash hook blocks any command containing ".env" (even process.env); use Edit/PowerShell for those.

Related: [[ghn-multiseller-and-local-db]] (that memory names a dev container zoldify-mysql that was not present in WSL docker on 2026-10-05).

- 26/10: sau khi WSL khởi động lại, 127.0.0.1:3307 có thể bị từ chối dù docker báo đã map cổng; nối bằng IP WSL (`wsl -d Ubuntu -- hostname -I`, cột đầu, vd <IP>) qua TEST_DB_HOST / DB_HOST.
