# Fork deviations from upstream Actual

This log lists every place the `multicurrency` branch of
[jessedyck/actual](https://github.com/jessedyck/actual) differs from
[actualbudget/actual](https://github.com/actualbudget/actual). Its purpose is
to let the fork adopt upstream's own multi-currency work piece by piece and
retire fork code as it does.

- **Forked from:** `832f43da` (upstream `master`, 2026-10-13)
- **Last upstream sync:** `832f43da`
- **Branches:** `master` mirrors upstream and is never committed to. All fork
  work lives on `multicurrency`, which is what the Docker image is built from.

## Finding fork code

- Every edit to an upstream file carries a `[fork:mc D-xxx]` comment pointing
  at an entry below: `git grep -n "\[fork:mc"`.
- Fork-owned files (no upstream counterpart, so they never conflict):
  - `fork/`
  - `.github/workflows/fork-docker.yml`
  - `packages/loot-core/migrations/1791961050603_mc_multi_currency.sql`
  - `packages/loot-core/src/server/multi-currency/`
  - `packages/loot-core/src/shared/multi-currency.ts` (and its test)
  - `packages/loot-core/src/types/models/mc-exchange-rate.ts`
- Everything the fork stores is prefixed `mc_` (columns, the rate table,
  synced preference keys). An upstream migration can therefore never collide
  with fork data, even if upstream picks names like `currency`.

## Core decision: what `amount` means

`transactions.amount` keeps its upstream meaning: the value in the **budget
currency**. Budgets, balances, transfers and reports keep working unchanged
and older or official clients still see correct numbers. A foreign-currency
account additionally stores `mc_amount`, the amount in the account's own
currency (in that currency's minor units). Upstream may choose the opposite
(make `amount` the account currency); if so, reconciling needs a data
migration, described under D-002.

## Deviation register

| ID    | Area                                                          | Upstream files touched                                                                                                                                              | Status                          |
| ----- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------- |
| D-001 | `multiCurrency` experimental flag                             | `loot-core/src/types/prefs.ts`, `desktop-client/src/hooks/useFeatureFlag.ts`                                                                                        | Done (toggle UI pending, D-007) |
| D-002 | Schema: account currency, account-currency amount, rate table | `loot-core/src/server/aql/schema/index.ts`, `loot-core/src/server/db/types/index.ts`, `loot-core/src/types/models/{account,transaction,index}.ts`, 4 snapshot files | Done                            |
| D-003 | Shared conversion helpers                                     | none (fork-owned)                                                                                                                                                   | Done                            |
| D-004 | Exchange rates: synced cache, Frankfurter, manual rates       | `loot-core/src/types/prefs.ts` (pref keys)                                                                                                                          | Done                            |
| D-005 | Server handlers, account currency on creation, backfill       | `loot-core/src/server/main.ts`, `loot-core/src/types/handlers.ts`, `loot-core/src/server/accounts/app.ts`                                                           | Done                            |
| D-006 | Keep `amount` and `mc_amount` consistent on every write       | `loot-core/src/server/transactions/index.ts`                                                                                                                        | Done                            |
| D-007 | Client UI: formatting, register, accounts, settings           | (in progress)                                                                                                                                                       | Planned                         |
| D-008 | CSV import and reconcile in the account currency              | (in progress)                                                                                                                                                       | Planned                         |
| D-009 | Docker image built from this branch                           | none (fork-owned workflow)                                                                                                                                          | Done                            |
| D-010 | Fork docs                                                     | none (`fork/`)                                                                                                                                                      | Done                            |

### D-001: `multiCurrency` flag

Adds `'multiCurrency'` to `FeatureFlag` and its default (`false`). The
feature only activates with the flag on **and** a budget currency set through
upstream's experimental _Currency support_ (`defaultCurrencyCode`).

_Reconcile:_ when upstream ships per-account currencies, remove the flag and
its checks; the stored data stays valid.

### D-002: Schema

Migration `1791961050603_mc_multi_currency.sql`:

- `accounts.mc_currency` TEXT: ISO 4217 code, NULL = budget currency.
- `transactions.mc_amount` INTEGER: amount in the account currency, in its
  minor units (JPY has none, KWD has three). NULL for budget-currency
  accounts.
- `mc_exchange_rates` (synced): `id` = `YYYYMMDD:BASE:QUOTE`, `date`, `base`,
  `quote`, `rate` (1 base = rate quote), `source` (`frankfurter` | `manual`).

Exposed with the same names in the AQL schema and TypeScript types. Adding a
column changes `SELECT *` results, so these snapshot files were regenerated
(the only change is `"mc_amount": null` and shifted diff offsets):
`server/__snapshots__/main.test.ts.snap`,
`server/accounts/__snapshots__/sync.test.ts.snap`,
`server/transactions/__snapshots__/transfer.test.ts.snap`,
`server/transactions/import/__snapshots__/parse-file.test.ts.snap`.

_Reconcile:_ when upstream adds its own columns, add a fork migration that
copies `mc_currency` / `mc_amount` (and rates) into upstream's fields,
switch fork code to them, and stop writing the `mc_` columns. Never drop
them: upstream's migrations must stay additive-only for cross-version sync.
If upstream redefines `amount` as the account currency, the copy becomes
`amount := mc_amount` for foreign accounts, with the budget value moved to
whatever field upstream uses.

### D-003: Shared helpers

`shared/multi-currency.ts`: account currency lookup, minor-unit conversion
with symmetric rounding (so transfers mirror exactly), implied rate, rate id.

### D-004: Exchange rates

`server/multi-currency/rates.ts` and `frankfurter.ts`. Lookup order: local
synced table (reusing a rate up to 7 days old, for weekends) → Frankfurter v2
(`/v2/rates`) when online rates are on → nothing (conversion stays pending).
Future dates use today's rate. Bulk work fetches one date range per currency.
A downloaded rate never replaces a manual one. Rates are stored outside undo.

Synced preferences: `mcRatesOnline` (`'false'` disables downloads; default
on) and `mcRatesUrl` (default `https://api.frankfurter.dev/v2`; Frankfurter
can be self-hosted). Requests only carry currency codes and dates.

_Reconcile:_ if upstream adds a rate table or provider, migrate the rows and
switch lookups to it.

### D-005: Handlers and account currency

New handlers (`server/multi-currency/app.ts`, registered in `server/main.ts`,
typed in `types/handlers.ts`): `mc-get-context`, `mc-get-rate`, `mc-convert`,
`mc-rates-list`, `mc-rate-set`, `mc-rate-delete`, `mc-rates-fetch`,
`mc-account-set-currency`, `mc-recompute-pending`.

`account-create` (`server/accounts/app.ts`) accepts `mc_currency`; the
starting balance is then taken in that currency and converted.

`mc-account-set-currency` backfills existing transactions: it reads the
amount written by the documented rule-template workaround
(`52.43 AUD (FX rate: 0.65) • …`) when present, otherwise converts the budget
amount at each transaction's date. Notes are left untouched.

### D-006: Consistent amounts on every write

`prepareMultiCurrencyChanges` runs first in `batchUpdateTransactions`, and
`fillTransferMirrors` runs after transfers are processed
(`server/transactions/index.ts`). Rules, for a foreign-currency account:

- A new transaction with only `mc_amount` gets `amount` derived; with only
  `amount` (older clients, API, transfer mirrors) gets `mc_amount` derived.
- Editing `mc_amount` re-derives `amount`; editing `amount` alone is kept as
  a manual override (the real bank conversion).
- In a transfer with a budget-currency side, that side's amount is
  authoritative and the foreign side mirrors it; between two foreign
  accounts the sending side derives and the receiving side mirrors. A
  receiving side's `mc_amount` is only filled when empty, never overwritten.
- Moving to an account in another currency re-derives `mc_amount`; moving to
  a budget-currency account clears it.
- No rate: `amount` is 0 until `mc-recompute-pending` finds one.
- Split children are rounded to add up exactly to the parent.

Writes that bypass `batchUpdateTransactions` (bank-sync fast path, account
starting balance) are covered separately or not at all; see D-008.

_Reconcile:_ remove both call sites once upstream converts amounts itself.

### D-009: Docker image

`.github/workflows/fork-docker.yml` builds the same image as upstream's
nightly workflow (`packages/sync-server/docker/ubuntu.Dockerfile`) on every
push to `multicurrency` and publishes
`ghcr.io/jessedyck/actual-server:multicurrency` (plus `sha-…` tags) for
`linux/amd64` and `linux/arm64`. Upstream's own Docker workflows only run on
upstream or on manual dispatch, so they don't interfere.

## Syncing with upstream

```bash
git fetch upstream
git switch master && git merge --ff-only upstream/master && git push origin master

# Before merging, look for upstream currency work worth adopting:
git log --oneline -i --grep=currenc master..upstream/master
git diff --stat master@{1} master -- packages/loot-core/migrations

git switch multicurrency && git merge master
# Snapshot conflicts: take upstream's file, then regenerate
#   git checkout --theirs <file>.snap
#   (cd packages/loot-core && ENV=node npx vitest --run -u)
git grep -n "\[fork:mc"            # check each touch point still fits
yarn typecheck && yarn lint && yarn test
git push origin multicurrency      # publishes a new image
```

Update "Last upstream sync" above after each merge.

## Known upstream test quirk

`parse-file.test.ts › csv import accepts iso-8859-1 as a windows-1252 alias`
fails in some Node builds without full ICU (the `€` sign isn't decoded). It
fails the same way on unmodified upstream and is unrelated to this fork.
