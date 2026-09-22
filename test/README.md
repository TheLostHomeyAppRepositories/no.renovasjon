# Adapter tests for Renovasjon Homey app

## Files

The test suite consists of four files:
- `adapters-config.js`: Creates a list of all adapters with their configuration. Adapters that support a large set of municipalities can be set to only test one randomly chosen one.
- `valid-addresses.json`: Holds a JSON array of municipalities and a working address within it that can be used for testing. Does not exist initially, must be built. It is NOT included in the repo as it contains private addresses, even if randomly picked.
- `test-adapters.js`: The main file that defines and executes the tests.
- `report.js`: Formats the output: the table rows and the summary.

## How to run

`npm test` runs all tests. This requires a fully populated `valid-addresses.json`, but for adapters configured to only test one random municipality it picks one in the intersection of its supported municipalities and the ones in `valid-addresses.json`.

A few adapters are tested at a time. `npm test` shows a table with one row per adapter, which is updated as the adapters are tested:

```
  Adapter          Municipality                  Interface  Fetch  Next pickup    Time
  ──────────────────────────────────────────────────────────────────────────────────
✔ avfallsor        4204 KRISTIANSAND             ✔          ✔      Tue 22 Sep     1.2s
✖ minrenovasjon    3450 ETNEDAL                  ✔          ✖                     2.1s
⠋ ngir             1508 ÅLESUND                  ✔          …
◼ remidt           queued                        ·          ·
```

*Interface* is whether the adapter agrees with itself on which municipalities it covers. *Fetch* is whether the stored address is covered and gives at least one future pickup date, and *Next pickup* is the earliest of them. With `--full` the municipality column counts the municipalities tested instead.

When all adapters are done, a summary lists each failure with its reason and the address used. If `npm test` says `0 failed` the test has fully succeeded, and the exit code is non-zero when anything failed. When the output is not a terminal (redirected to a file, or in CI) no table is redrawn, and each row is instead printed once, when its adapter is done.

To build `valid-addresses.json` from random addresses, run `npm test -- --update-addresses`. This shows one row per adapter with the progress, and the summary lists the municipalities it did not find a working address for. This process is accumulative, and if it fails to find a working address for some municipalities, it can be rerun until it has found one for all. If an address has gone out of service or stopped working for other legitimate reasons, it can be manually removed from the file before rerunning the command. Addresses can of course also be manually added to the file if care is taken to get it exactly right. If it consistently fails for some municipalities or adapters, this can be an indication that something is wrong with the adapter.

To limit testing or address updating to specific adapters, include the argument `--adapters [...]` where `[...]` is a comma separated list of adapters given by their filename (without extension). Example: `npm test -- --adapters remidt,trv`. An unknown name is an error.
