# Actual Budget with multi-currency accounts

> [!WARNING]
> **AI-built and for personal use only. Please don't use it.**
>
> This fork was written by an AI coding assistant (Claude, by Anthropic) at
> its owner's request, for the owner's own budget. Actual's maintainers have
> not reviewed it, nothing here is supported, and it can damage budget data.
> It is not a proposal for upstream: please don't open issues or pull
> requests about it on
> [actualbudget/actual](https://github.com/actualbudget/actual).
>
> If you want multi-currency in Actual, follow the official work instead:
> [currency feedback issue #5191](https://github.com/actualbudget/actual/issues/5191).

A personal fork of [Actual Budget](https://github.com/actualbudget/actual)
that adds accounts in other currencies. The budget stays in one currency;
each account can hold its own, with amounts converted using daily rates from
[Frankfurter](https://frankfurter.dev) (free, no key) or rates you enter.

Every difference from upstream is logged in [DEVIATIONS.md](DEVIATIONS.md) so
the fork can switch to upstream's own implementation as it lands.

## Status

| Piece                                                                          | State   |
| ------------------------------------------------------------------------------ | ------- |
| Account currency, account-currency amounts, rate cache (database)              | Done    |
| Automatic and manual exchange rates                                            | Done    |
| Conversion on every save, transfers between currencies, splits                 | Done    |
| Starting balance and backfill when an account gets a currency                  | Done    |
| Settings: turning it on, exchange rates, budget-currency lock                  | Done    |
| Accounts: currency when creating or changing, balances in that currency        | Done    |
| Register (desktop): entering and showing amounts in the account's currency     | Done    |
| Reconcile in the account's currency (desktop)                                  | Done    |
| Imports (CSV, OFX, QIF, CAMT) in the account's currency                        | Done    |
| Mobile: amounts and reconcile in the account's currency                        | Done    |
| Exchange rate adjustment to today's value (desktop)                            | Done    |
| Net worth report: accounts valued at each period's rate, shown in any currency | Done    |
| Cash flow report (page and card) in any currency                               | Done    |
| Custom and spending reports in another currency                                | Planned |

## Log

What was done, newest first. All of it was implemented by an AI assistant;
[DEVIATIONS.md](DEVIATIONS.md) has the details of every change.

- **2026-10-14** · Cash flow report (page and dashboard card) in any
  currency, each day or month at its own rate.
- **2026-10-14** · Net worth report: accounts in other currencies are
  valued at the rate of each period, and the report (page and dashboard
  card) can be shown in any currency.
  [546ca7b](https://github.com/jessedyck/actual/commit/546ca7b)
- **2026-10-14** · Exchange rate adjustment: one click records the
  difference between what an account in another currency is worth today and
  its value in the budget.
  [57a5e2b](https://github.com/jessedyck/actual/commit/57a5e2b)
- **2026-10-14** · Mobile: an account with its own currency shows its
  balances, transactions and running balances in that currency; amounts are
  entered in the currency of the chosen account; reconciling works in that
  currency. [7ee0afb](https://github.com/jessedyck/actual/commit/7ee0afb)
- **2026-10-14** · Importing files into an account with its own currency:
  amounts are read in that currency, converted at each transaction's date,
  and matched against existing transactions in that currency.
  [ba7e827](https://github.com/jessedyck/actual/commit/ba7e827)
- **2026-10-14** · Register: accounts in currencies without decimals (yen,
  won) store what is typed, and scheduled transactions continue the running
  balance in the account's currency.
  [a097733](https://github.com/jessedyck/actual/commit/a097733)
- **2026-10-14** · Reconcile in the account's currency (desktop): the
  statement balance is typed in that currency and the adjustment transaction
  is stored in it. [ea38712](https://github.com/jessedyck/actual/commit/ea38712)
- **2026-10-14** · README: notice that the fork is AI-built and for personal
  use only, and this log.
  [021e2ff](https://github.com/jessedyck/actual/commit/021e2ff)
- **2026-10-14** · Register in the account's currency (desktop): amounts,
  splits and running balance in the account's currency, budget amount in the
  tooltip.
  [8a4a59f](https://github.com/jessedyck/actual/commit/8a4a59f)
- **2026-10-14** · Fixed a test snapshot recorded on a Node build without full
  ICU, which had blocked the image build.
  [add2742](https://github.com/jessedyck/actual/commit/add2742)
- **2026-10-14** · Accounts: pick a currency when creating one, change it
  later (existing transactions are converted), balances in the account's
  currency with "worth today" and "in budget".
  [926f99a](https://github.com/jessedyck/actual/commit/926f99a)
- **2026-10-14** · Settings: turning the feature on, automatic rate downloads,
  the rate service, manual rates, converting pending transactions; the budget
  currency is locked while accounts use other currencies.
  [160086b](https://github.com/jessedyck/actual/commit/160086b)
- **2026-10-14** · The Docker image is only published after typecheck and
  tests pass. [e820747](https://github.com/jessedyck/actual/commit/e820747)
- **2026-10-14** · Docker image built on every push:
  `ghcr.io/jessedyck/actual-server:multicurrency`.
  [3f3d811](https://github.com/jessedyck/actual/commit/3f3d811)
- **2026-10-14** · Server side: account currency and account-currency amounts
  in the database, exchange rates (Frankfurter and manual), conversion on
  every save, transfers between currencies, splits, converting existing
  accounts. [b536b3f](https://github.com/jessedyck/actual/commit/b536b3f)
- **2026-10-14** · Fork created from upstream `master` at `832f43da`
  (26.10.0), with this README and the deviation log.
  [ac46416](https://github.com/jessedyck/actual/commit/ac46416)

## Running it

The image is built by GitHub Actions on every push to `multicurrency`. Copy
[docker-compose.yml](docker-compose.yml) to a folder on your server and run
`docker compose up -d`, or change an existing setup's image from
`actualbudget/actual-server` to
`ghcr.io/jessedyck/actual-server:multicurrency`. Your data folder works with
both images. Back it up before switching anyway: this is experimental code.

The first time the workflow publishes, GitHub makes the package private. To
pull without logging in, open the package's settings on GitHub
(_Packages → actual-server → Package settings_) and make it public, or run
`docker login ghcr.io` with a personal access token.

To build the image yourself instead:

```bash
docker build -f sync-server.Dockerfile -t actual-server:multicurrency .
```

## Turning it on

1. _Settings → Show advanced settings → Experimental features_: enable
   **Currency support** and **Multi-currency accounts**.
2. _Settings → Currency_: choose your budget currency (for example EUR).
3. Create an account and pick its currency.

## How amounts are stored

Every transaction keeps `amount` in the budget currency, exactly like
upstream, so budgets and reports are unaffected. Accounts in another currency
also store the amount in their own currency. Editing that amount converts it
again at the transaction's date; editing the budget amount directly records
what your bank actually charged.

## Using official Actual on the same budget

An official Actual client of the **same or an older version** than the fork's
upstream base can open and sync the budget: it ignores the fork's data. Avoid
editing foreign-currency transactions there, because it can't keep both
amounts in step.

An official client that is **newer** than the fork's upstream base (for
example an auto-updated desktop app) can refuse to open the budget with an
`out-of-sync-migrations` error: the file contains the fork's migration but is
missing the newer official one. Use the fork's web app on every device.

### Going back to official Actual

The fork only adds to the database, so official Actual can take over a budget
the fork has used, as long as the fork build you last ran was based on the
same or a newer upstream version:

1. Sync the fork with upstream up to (at least) the official version you want
   to run, let the image rebuild, and open the budget with it once.
2. Switch the image back to `actualbudget/actual-server`.

Official Actual then shows budget-currency amounts everywhere and leaves the
fork's extra data untouched, so switching back to the fork later still works.

## GitHub Actions in the fork

Only `Fork Docker image` matters for this fork. It checks types and runs the
tests before it builds and publishes, so a broken commit never becomes the
`multicurrency` image. The other workflows come from upstream and target its
infrastructure: they skip themselves, fail, or wait forever for a runner when
`master` is synced. To silence them, open the fork's _Actions_ tab, pick each
workflow, then _… → Disable workflow_.

## Updating from upstream

See _Syncing with upstream_ in [DEVIATIONS.md](DEVIATIONS.md).
