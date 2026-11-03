---
name: push-every-commit-to-staging
description: "Zoldify: every new commit is pushed to GitHub right away, and merged into staging once checks pass; prod still needs explicit approval"
metadata:
  node_type: memory
  type: feedback
  originSessionId: <session>
  modified: 2026-11-02T15:46:05.248Z
---

From 2026-11-02 the user wants: every commit on Zoldify code, however small, is pushed to GitHub immediately (its own branch). As soon as the checks pass (build/typecheck/lint/tests of the repo), merge it into `staging` and push so CD deploys staging. No need to ask first for push or staging.

**Why:** the user said "code mới giờ cứ có cái gì commit đẩy liền lên github luôn nha kể cả nhỏ, xong không lỗi đẩy luôn lên staging". Local-only commits kept piling up across worktrees and got lost to restarts/cleaners.

**How to apply:** this overrides the global GIT.md "commit local only" rule for Zoldify repos (backend, frontend, admin, mobile), push and staging only. Prod (backend `chore/soat-cau-hinh-payos-firebase`, frontend `deploy-prod`, admin `chore/deploy-docker`) still needs the user's explicit OK each time. Before pushing backend `staging`, `docker tag zoldify-backend:latest zoldify-backend:prod-<sha>` on the VPS so prod keeps a rollback image (see [[deploy-vps-backend]]). Tell subagents this rule in their prompts.
