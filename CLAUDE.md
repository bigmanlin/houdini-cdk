# houdini-cdk

The AWS infrastructure for Houdini: tables, buckets, queues, schedules, the ECS
service, and the Lambda triggers that poke it.

**Docs hold constraints, never state.** No stack inventories, no table counts, no
resource catalogues — `lib/app.ts` is the list, and every written copy of it drifts
within weeks. When a change makes a line here false, delete the line.

This repo deploys stateful, shared infrastructure. Most mistakes here are not
revertable by a redeploy, so the rules below matter more than they would in a
service repo.

## The rules that protect data

- **Every table has a custom `tableName`, so CloudFormation cannot replace it.** A
  key or schema change is not an edit — it is a new table plus a data migration.
  Renaming the table in code is the only way the stack will accept the new schema.
- **Tables are `RETAIN`.** Destroying a stack leaves the data behind, which is the
  point, but it also means an orphaned table keeps the name reserved.
- **A table deleted out of band leaves the stack unable to update at all** — `GetAtt`
  on a missing resource fails before anything else runs. Recreate a placeholder
  matching the stack's current schema first, then deploy.
- **A cross-stack export cannot change or disappear while another stack imports it.**
  Reworking one is a three-deploy dance: pin the export with `exportValue()` in the
  producing stack while removing the consumer's grant and deploy both, then apply the
  new schema and drop the pin, then restore the grant.
- **Removing a stack from `app.ts` does not delete the deployed stack.** It only
  stops managing it. Deleting requires an explicit `cdk destroy`, and forgetting
  leaves resources running and billing.

## Ordering

**Infrastructure ships before the code that uses it.** A new table or index must
exist and finish backfilling before the backend deploy that queries it, or every
affected request 400s. The backend cannot check this — it is a human step that
spans two repos.

Always read `cdk diff` before `cdk deploy`. On stateful stacks, a replacement shows
up there and nowhere else.

## Layout

- One folder per AWS resource type under `lib/`. Types and constants live beside the
  stack that owns them.
- One stack per resource type by default — it keeps blast radius small. Split
  further only when use cases genuinely differ, as the snapshot Lambdas do.
- Named imports only; wildcard imports fail the lint.

## Working in these repos

- **Never merge or push to `main`.** Push the branch, hand over a PR link, stop.
- **One-line commit subjects**, conventional prefix, no body, no `Co-Authored-By`
  trailer. Squash a branch to one commit before opening its PR.

Commands: `npm run build` (lint, compile, test, synth) · `npm run diff` · `npm run deploy`.
