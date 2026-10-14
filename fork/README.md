# Actual Budget with multi-currency accounts

A personal fork of [Actual Budget](https://github.com/actualbudget/actual)
that adds accounts in other currencies. The budget stays in one currency;
each account can hold its own, with amounts converted using daily rates from
[Frankfurter](https://frankfurter.dev) (free, no key) or rates you enter.

This branch is not meant for upstream pull requests. Every difference from
upstream is logged in [DEVIATIONS.md](DEVIATIONS.md) so the fork can switch
to upstream's own implementation as it lands.

## Status

| Piece                                                                        | State         |
| ---------------------------------------------------------------------------- | ------------- |
| Account currency, account-currency amounts, rate cache (database)            | Done          |
| Automatic and manual exchange rates                                          | Done          |
| Conversion on every save, transfers between currencies, splits               | Done          |
| Starting balance and backfill when an account gets a currency                | Done (server) |
| Screens: currency picker, register in the account's currency, rates settings | In progress   |
| CSV import and reconcile in the account's currency                           | Planned       |
| Reports with a display-currency selector                                     | Planned       |

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

An official Actual client can still open and sync the budget: it ignores the
fork's data. Avoid editing foreign-currency transactions there, because it
can't keep both amounts in step.

## Updating from upstream

See _Syncing with upstream_ in [DEVIATIONS.md](DEVIATIONS.md).
