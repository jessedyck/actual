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
  - `packages/desktop-client/src/components/multi-currency/`
  - `packages/desktop-client/src/hooks/useMultiCurrency.ts`
  - `packages/desktop-client/src/hooks/useMultiCurrencyFormat.ts`
  - `packages/desktop-client/src/hooks/useMcAccountBalance.ts`
  - `packages/desktop-client/src/hooks/useMcRate.ts`
  - `packages/desktop-client/src/hooks/useAccountCurrencyRegister.ts`
  - `packages/desktop-client/src/hooks/useMcBudgetAmountTitle.ts`
  - `packages/desktop-client/src/hooks/useMcAccountListView.ts`
  - `packages/desktop-client/src/accounts/mcReconciliation.ts`
  - `packages/desktop-client/src/transactions/mcRules.ts`
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

| ID    | Area                                                          | Upstream files touched                                                                                                                                                                                                                                                                                                                                                             | Status |
| ----- | ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| D-001 | `multiCurrency` experimental flag                             | `loot-core/src/types/prefs.ts`, `desktop-client/src/hooks/useFeatureFlag.ts`                                                                                                                                                                                                                                                                                                       | Done   |
| D-002 | Schema: account currency, account-currency amount, rate table | `loot-core/src/server/aql/schema/index.ts`, `loot-core/src/server/db/types/index.ts`, `loot-core/src/types/models/{account,transaction,index}.ts`, 4 snapshot files                                                                                                                                                                                                                | Done   |
| D-003 | Shared conversion helpers                                     | none (fork-owned)                                                                                                                                                                                                                                                                                                                                                                  | Done   |
| D-004 | Exchange rates: synced cache, Frankfurter, manual rates       | `loot-core/src/types/prefs.ts` (pref keys)                                                                                                                                                                                                                                                                                                                                         | Done   |
| D-005 | Server handlers, account currency on creation, backfill       | `loot-core/src/server/main.ts`, `loot-core/src/types/handlers.ts`, `loot-core/src/server/accounts/app.ts`                                                                                                                                                                                                                                                                          | Done   |
| D-006 | Keep `amount` and `mc_amount` consistent on every write       | `loot-core/src/server/transactions/index.ts`                                                                                                                                                                                                                                                                                                                                       | Done   |
| D-007 | Settings: flag toggle, rate settings, budget-currency lock    | `desktop-client/src/components/settings/{Experimental,index,Currency}.tsx`                                                                                                                                                                                                                                                                                                         | Done   |
| D-008 | Reconcile and imports in the account currency                 | `desktop-client/src/components/accounts/{Header,Account}.tsx`, `desktop-client/src/components/modals/{AccountReconcileModal,ImportTransactionsModal/ImportTransactionsModal}.tsx`, `desktop-client/src/components/mobile/accounts/{AccountTransactions,ReconcilingBanner}.tsx`, `loot-core/src/server/accounts/sync.ts`                                                            | Done   |
| D-009 | Docker image built from this branch                           | none (fork-owned workflow)                                                                                                                                                                                                                                                                                                                                                         | Done   |
| D-010 | Fork docs and notices                                         | `README.md` (notice at the top)                                                                                                                                                                                                                                                                                                                                                    | Done   |
| D-011 | Client hooks: multi-currency state, per-currency formatting   | none (fork-owned)                                                                                                                                                                                                                                                                                                                                                                  | Done   |
| D-012 | Accounts: currency on create and change, balances             | `loot-core/src/server/accounts/app.ts` (`accounts-get`), `desktop-client/src/accounts/mutations.ts`, `desktop-client/src/modals/modalsSlice.ts`, `desktop-client/src/components/{Modals,modals/CreateLocalAccountModal,modals/AccountMenuModal,accounts/Header,accounts/Account,sidebar/Account,mobile/accounts/AccountsPage,mobile/transactions/TransactionListWithBalances}.tsx` | Done   |
| D-013 | Register: amounts in the account's currency                   | `desktop-client/src/components/transactions/{TransactionList,TransactionsTable}.tsx`, `desktop-client/src/components/accounts/Account.tsx`, `desktop-client/src/components/mobile/{accounts/AccountTransactions,transactions/TransactionEdit}.tsx`                                                                                                                                 | Done   |

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

Writes that bypass `batchUpdateTransactions` get no account amount until
`mc-recompute-pending` derives one from `amount`: the API's
`addTransactions` without `runTransfers`, and bank sync's starting balance
for a newly linked account (which is then read as a budget amount; not
handled). A new account's starting balance is handled by D-005, imports by
D-008.

_Reconcile:_ remove both call sites once upstream converts amounts itself.

### D-007: Settings

- _Experimental features_: **Multi-currency accounts** is a sub-feature of
  upstream's **Currency support**, which can't be switched off while it is on
  (`settings/Experimental.tsx`).
- _Settings_ shows the fork's **Multi-currency accounts** group when the flag
  is on, and no longer clears `defaultCurrencyCode` when Currency support is
  off while multi-currency is on (`settings/index.tsx`; upstream clears it
  whenever the currency flag is off).
- The default-currency picker is disabled while any account has
  `mc_currency` (`settings/Currency.tsx`): existing budget amounts would
  otherwise be read in the wrong currency.
- Fork-owned rows in `components/multi-currency/`: automatic downloads
  (`mcRatesOnline`), service URL (`mcRatesUrl`), convert pending
  (`mc-recompute-pending`), and the stored rates with manual entry and
  deletion. Saving a manual rate also converts pending transactions.

_Reconcile:_ remove the nesting and both guards with the flag. If upstream
adds rate settings, move `mcRatesOnline` / `mcRatesUrl` into them.

### D-008: Reconcile and imports in the account's currency

**Reconcile** (desktop). For a foreign-currency account the statement
balance is typed in the account's currency and compared with the cleared sum
of `mc_amount`:

- `accounts/Header.tsx` renders the fork's `McReconcileMenu` and
  `McReconcilingMessage` instead of upstream's `ReconcileMenu` and
  `ReconcilingMessage`. The last balance from bank sync is shown in the
  account's currency, since that is what the bank reports.
- `accounts/Account.tsx` finishes reconciling and creates the adjustment
  through the fork's `accounts/mcReconciliation.ts` (prop
  `isAccountCurrencyView`, D-013). The adjustment stores `mc_amount`; the
  server derives its budget amount (D-006).

**Reconcile** (mobile), same rules:

- `modals/AccountReconcileModal.tsx` starts from the cleared sum of
  `mc_amount` and hands on the statement balance in the currency's minor
  units (its input counts hundredths, like every amount input).
- `mobile/accounts/ReconcilingBanner.tsx` compares with the cleared sum of
  `mc_amount` and formats in the account's currency.
- `mobile/accounts/AccountTransactions.tsx` finishes and creates the
  adjustment through `mcReconciliation.ts`.

**Imports** (CSV, OFX, QIF and CAMT files, bank sync, and the API's
`importTransactions`). Amounts sent for a foreign-currency account are read
in the account's currency, in hundredths like every amount the API takes:

- `server/accounts/sync.ts` (`matchTransactions`): right after the
  transactions are normalized, the fork's `readImportedAmounts`
  (`server/multi-currency/imports.ts`) moves each amount to `mc_amount` and
  converts `amount` at the transaction's date, so rules and duplicate
  matching see the budget value the transaction will have. A transaction
  that already carries `mc_amount` keeps both amounts. Split children only
  get `mc_amount`; D-006 derives and rounds their budget amounts.
- Duplicate matching compares account amounts, falling back to `amount` for
  rows whose conversion is pending: both fuzzy-match queries also select
  `mc_amount` and take their amount condition from `getImportAmountMatch`
  (upstream's `amount = ?` for other accounts).
- `reconcileTransactions`: the import preview shows a matched transaction's
  amount in the account's currency (`getImportPreviewAmount`), like the
  file's amounts next to it.
- `ImportTransactionsModal.tsx`: a note under _Amount options_ says which
  currency the file's amounts are read in (`McImportCurrencyNote`).

The API's `addTransactions` and transactions posted by schedules still take
budget amounts, as everywhere else in the API (D-006 derives the account
amount).

_Reconcile:_ remove the fork components, `mcReconciliation.ts` and the
branches in `Header.tsx`, `Account.tsx`, `AccountReconcileModal.tsx`,
`ReconcilingBanner.tsx` and the mobile `AccountTransactions.tsx` once
upstream reconciles in the account's currency; remove the `readImportedAmounts` call, the amount
conditions and the preview amount from `sync.ts` once upstream imports into
account currencies. Upstream will most likely read imported amounts in the
account's currency too, so imports into converted accounts keep working.

### D-012: Accounts

- **New accounts** (`modals/CreateLocalAccountModal.tsx`,
  `accounts/mutations.ts`): a currency picker (fork
  `AccountCurrencyField`); the starting balance is typed in that currency
  and converted by the server (D-005).
- **Changing an account's currency**: _Change currency…_ in the account
  menu (`accounts/Header.tsx`, handled in `accounts/Account.tsx`) and in the
  mobile account menu (`modals/AccountMenuModal.tsx`) opens the fork modal
  `mc-account-currency` (registered in `modals/modalsSlice.ts` and
  `components/Modals.tsx`), which calls `mc-account-set-currency` (backfill,
  D-005).
- **Balances**: the sidebar (`sidebar/Account.tsx`) and the mobile account
  list (`mobile/accounts/AccountsPage.tsx`) render the fork's `McCellValue`
  instead of `CellValue`: the account's own currency for foreign accounts,
  upstream's `CellValue` otherwise. The account header (`accounts/Header.tsx`)
  renders the fork's `McAccountBalances` instead of `Balances` for foreign
  accounts: balance in the account currency, its value today in the budget
  currency, and _In budget_ (the sum of `amount`). Group totals (On budget,
  Off budget, All accounts) stay budget-currency sums of `amount`. The
  mobile account page (`mobile/transactions/TransactionListWithBalances.tsx`,
  new prop `mcAccount`) shows balance, cleared and uncleared the same way.
- **Server**: `accounts-get` (`server/accounts/app.ts`) maps account rows
  field by field; it now includes `mc_currency`.

Not yet: selected balances show budget-currency sums.

_Reconcile:_ swap `McCellValue` / `McAccountBalances` back to upstream's
components once upstream formats balances per account currency; keep the
`accounts-get` field until upstream returns the account currency itself.

### D-013: Register in the account's currency

The register's logic (inputs, splits, running balance, new rows) only knows
`amount`. For a single foreign-currency account the fork swaps the two
amounts at the register's boundary instead of changing that logic:

- `TransactionList.tsx` passes transactions through
  `useAccountCurrencyRegister` (fork hook over `toAccountCurrencyView` in the
  fork's shared helpers): `amount` holds the account amount and the budget
  amount waits in `_mcBudgetAmount`. Changes going up (`onChange`) are
  swapped back; diffs going to the server go through
  `diffFromAccountCurrencyView`, which turns an edited `amount` into
  `mc_amount` and leaves the budget amount for the server to derive (D-006).
  Rules run on real fields and can't change the amount being typed.
- The register counts amounts in hundredths whatever the currency, while
  `mc_amount` uses the currency's own minor units. For currencies without
  decimals (JPY, KRW, IRR) the view scales amounts on the way in and out
  (`minorUnitsToHundredths` / `hundredthsToMinorUnits`); for two-decimal
  currencies nothing changes.
- Rows with no stored account amount (schedule previews, pending
  conversions) show an estimate at today's rate, never stored.
- `Account.tsx`: running and filtered balances sum `mc_amount` for these
  accounts (new prop `isAccountCurrencyView`). `AllTransactions` puts the
  running balances and scheduled previews into the view before adding them
  up, so previews continue the balance in the account's currency.
- `TransactionsTable.tsx`: the Payment and Deposit tooltips show the budget
  amount (`useMcBudgetAmountTitle`).
- Views with several accounts (All accounts, On budget, categories) keep
  showing budget amounts, as upstream does.

Mobile:

- `mobile/accounts/AccountTransactions.tsx`: a foreign-currency account's
  page lists its transactions and scheduled previews in its currency, with
  running balances recomputed from those amounts (fork hook
  `useMcAccountListView`).
- `mobile/transactions/TransactionEdit.tsx`: the editor holds each
  transaction with its amount in its account's currency
  (`toAccountCurrencyViews`) and waits for the accounts to load before
  fetching. On save, `diffFromAccountCurrencyViews` stores a typed amount in
  the currency of the account the transaction ends up in: `mc_amount` for a
  foreign-currency account, `amount` otherwise. A change that doesn't touch
  the amount (for example moving to another account) keeps the stored
  amounts, and the server converts as in D-006. The currency is named under
  the amount (`McAmountCurrencyHint`).
- Rules on a transaction typed in a foreign-currency account (desktop and
  mobile) run through `transactions/mcRules.ts`: they see the account amount
  as `mc_amount` and a budget amount of 0, and can't change the amount
  being typed.

Not yet: rules and schedules compare budget amounts, so amount conditions
don't match transactions being typed in a foreign-currency account, and
split rules don't apply to them.

_Reconcile:_ remove the swap from `TransactionList.tsx`, the prop, both
sums and the `AllTransactions` conversion in `Account.tsx`, and the tooltip
in `TransactionsTable.tsx` once upstream's register handles account
currencies.

### D-009: Docker image

`.github/workflows/fork-docker.yml` builds the same image as upstream's
nightly workflow (`packages/sync-server/docker/ubuntu.Dockerfile`) on every
push to `multicurrency` and publishes
`ghcr.io/jessedyck/actual-server:multicurrency` (plus `sha-…` tags) for
`linux/amd64` and `linux/arm64`. Upstream's own Docker workflows only run on
upstream or on manual dispatch, so they don't interfere.

A `verify` job (typecheck, core tests, web-client tests) gates the build, so
a failing commit never replaces the published image.

### D-011: Client hooks

- `hooks/useMultiCurrency.ts`: whether the feature is on (flag plus budget
  currency, same rule as the server's `getMultiCurrencyContext`), an
  account's currency state, and whether any account has its own currency.
- `hooks/useMultiCurrencyFormat.ts`: formats and parses amounts in any
  currency with the user's number format, symbol position and spacing, using
  that currency's symbol and decimal places. Upstream's `useFormat` only
  knows the budget currency.

Both live in `src/hooks/` because desktop-client's `#components/*` import
alias only resolves `.tsx` files; this avoids editing `package.json`.

_Reconcile:_ switch to upstream's formatter once it accepts a currency.

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

Two tests in `parse-file.test.ts` (`handles windows-1252 charset` and
`csv import accepts iso-8859-1 as a windows-1252 alias`) fail in Node builds
without full ICU, because `€` and `—` aren't decoded. They fail the same way
on unmodified upstream and pass in CI.

**Never regenerate snapshots (`vitest -u`) on such a Node**: it records the
wrongly decoded text. That happened once with
`parse-file.test.ts.snap`, which broke the CI gate; the fix was to restore
upstream's text so the snapshot differs from upstream only by
`"mc_amount": null` lines. Check with
`node -e "new TextDecoder('windows-1252').decode(Buffer.from([0x80]))"`:
it must print `€`.
