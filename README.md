# wrkz-nodejs-pool

Mining pool software for **WrkzCoin (WRKZ)** written in Node.js: a stratum server for WrkzCoin's own
`cn/upx2` (CryptoNight-UPX2, a small-memory CryptoNight-family variant, 128 KB scratchpad, shared with
uPlexa) with share checking, block accounting through the pool wallet, and batch payouts. It is a fork
of [cryptonote-nodejs-pool](https://github.com/dvandal/cryptonote-nodejs-pool) by Dvandal (GNU GPL v2)
and of its adaptation [kryptokrona-nodejs-pool](https://github.com/newsmoneymaker/kryptokrona-nodejs-pool).
Live example: <https://wrkz.pool-pay.com>.

This replaces an older, unmaintained [dvandal cryptonote-nodejs-pool](https://github.com/dvandal/cryptonote-nodejs-pool)
deployment of WRKZ with this project's own hardened fork (TCP keepalive on every stratum socket,
double-credit protection in the block unlocker, guarded `/get_payments`/`/get_blocks` API params, no
live-config donation address, see "Developer donation" below) -- it is an independent rewrite of the
pool logic itself, not a copy of that old pool's code.

## What it does

* **Stratum server** (plain TCP and TLS ports, the plain cryptonote-nodejs-pool JSON-RPC shape --
  `login`/`job`/`submit`): the pool asks the WrkzCoin daemon for a block template (`getblocktemplate`),
  splices the miner's nonce into it at a byte offset confirmed empirically (see `blobtool.js`'s own
  header comment for exactly how, and its one honestly-stated limitation), gives every miner that blob
  and a share target that follows the miner's hashrate (vardiff), and checks every share itself with a
  small C++ helper (`hasher/wrkzhash`) that is poolpayminer's own already-shipped, already-self-tested
  `cn/upx2` implementation, vendored verbatim (not re-derived) -- this keeps the pool's own share check
  and the real miner's PoW guaranteed identical by construction. A share that meets the network
  difficulty is submitted to the node with `submitblock`.
  **Use poolpayminer with `-a cn/upx2`** (this is XMRig/poolpayminer's own real, built-in algorithm name
  for this hash -- no algorithm porting was needed for this coin, unlike some others in this project).
* **Accounts** are WrkzCoin addresses (`Wrkz...`, 98 characters, Keccak checksum verified -- the real
  base58 prefix, 999730, was decoded directly from a real pool address, not assumed), optionally
  `+worker`, with a reward mode prefix `prop:` (shared, default) or `solo:`.
* **Rewards:** PROP (default) or SOLO.
* **Block unlocker:** a block is settled after `depth` blocks (depth defaults to 70; the coinbase itself
  matures faster, this just adds margin). The reward is read directly from the daemon's own
  `getblockheaderbyheight` (its `reward` field) -- no wallet call needed for this step, and no
  masternode/service-node split to account for on this coin. A block that is no longer on the chain at
  that height, or whose `orphan_status` the daemon now reports as true, is marked orphaned and nothing
  is credited. Protected against the double-credit class of bug (crediting the same found block twice
  via a duplicate candidate entry) -- see the comment in `blockUnlocker.js`.
* **Payment processor:** everyone who is due is paid in **one wallet `sendTransaction` per round** (the
  network fee is shared by the paid miners or paid by the pool). The balance is debited before sending;
  a batch whose outcome is unknown (crash, timeout) is found again among the wallet's recent
  transactions and never sent twice; refused or failed batches go back to the balances. Dry-run mode, a
  whitelist for rehearsals and an emergency brake (`deployment/pause-payments.sh`).
* **Website and API:** a ready website (`website_example/`) with the dashboard and its graphs, blocks,
  payments, top miners, worker statistics, and the public read-only JSON API.
* **Protection against connection floods:** limits per IP, a login deadline, an optional IP allow list,
  banning of miners with many invalid shares, `setKeepAlive` on every stratum socket (a dead client
  connection does not become a permanent zombie).

## Developer donation (please read)

Configured in `config.json` (see `config_examples/wrkz.json` for the public template -- this project's
own **live** `config.json` keeps `donations: {}` and folds the same revenue into one point of `poolFee`
instead, see that file's comments):

```json
"blockUnlocker": {
  "poolFee": 1,
  "donations": { "WrkzXQdPh3H9HmGooT6oWp5doxYQYwpYWK8wPuCYyHKvVgPAEiVb8BDXcirLkcFWmvRJ4brBJyC5x7afGY5kh8vX6RL4fuScNQ": 1 }
}
```

* `poolFee` is the fee of the pool operator (percent). `donations` is a table `WrkzCoin address ->
  percent of the block reward` (up to 10% per entry); the entry above is this project's own pool address.
* It is included in the "Pool Fee" figure a website/API should show to miners.
* You are free to change the percentage, the address, or to empty the table (`"donations": {}`): it is
  your pool and the license is the GPL. Please tell your miners the truth about your pool's fees.
* This has nothing to do with the miner poolpayminer (a separate project with its own, separate fee).

## Installation

Requirements: Linux, Node.js 18 or newer, Redis, a WrkzCoin node (`Wrkzd`, from
[github.com/wrkzcoin/wrkzcoin](https://github.com/wrkzcoin/wrkzcoin)) synchronised with the network and
its own `wrkz-wallet-api` wallet service with the pool wallet open, a C++11 compiler + an AES-NI capable
x86_64 CPU (to build `hasher/wrkzhash` -- see `hasher/Makefile`'s own header comment for exactly what it
vendors and why), a web server for the website, and a TLS certificate for the TLS stratum port.

```
npm install
make -C hasher
cp config_examples/wrkz.json config.json   # then edit it for real
node init.js
```

## Miners

**Stock [XMRig](https://github.com/xmrig/xmrig) does NOT support this algorithm out of the box on every
build**, but [poolpayminer](https://github.com/newsmoneymaker/poolpayminer) (a maintained XMRig fork,
Windows and Linux, free, has its own separate fee) does, as `cn/upx2` -- the SAME real algorithm name
XMRig itself uses upstream, no custom port was needed for this coin. Example:
`poolpayminer -o wrkz.pool-pay.com:5301 --tls -u YOUR_WRKZ_ADDRESS+rigname -p x -a cn/upx2`.

## Tests

```
npm install
node test/test-account.js                 # address handling (base58 + Keccak checksum), needs nothing else
```

## Money warning

The payment processor moves real coins. Rehearse first: `"dryRun": true`, then a whitelist
(`onlyAccounts`) with a few small payouts, then enable it. A transaction sent to the network cannot be
cancelled. Keep the wallet's mnemonic seed backup private.

## License and credits

GNU GPL v2 (see [LICENSE](LICENSE)). Based on cryptonote-nodejs-pool, Copyright (c) Dvandal and
contributors. WrkzCoin itself is a separate program and is not included.
