# Changes

## 1.0.0 (2026-11-06)

* First release: WrkzCoin (WRKZ) pool, replacing an old, unmaintained dvandal cryptonote-nodejs-pool
  deployment (`/home/1wrkz` on srv5) with this project's own hardened fork (adapted from
  kryptokrona-nodejs-pool). Stratum for `cn/upx2` (CryptoNight-UPX2, 128 KB scratchpad, shared with
  uPlexa), plain cryptonote-nodejs-pool JSON-RPC (`login`/`job`/`submit`).
* WrkzCoin's daemon (`Wrkzd`) speaks a standard CryptoNote/bytecoin-style `POST /json_rpc`, method names
  WITHOUT underscores (`getblocktemplate`/`getlastblockheader`/`submitblock`/`getblockcount`/
  `getblockheaderbyheight`) -- confirmed by direct probing of the real, running daemon, not assumed.
* Share checking with a new `hasher/wrkzhash` helper: poolpayminer's own already-shipped, already-
  self-tested `cn/upx2` implementation (vendored verbatim from its `src/crypto/cn/` + `src/base/crypto/`),
  NOT a second independent vendoring -- keeps the pool's own share check and the real miner's PoW
  guaranteed identical by construction. Verified byte-for-byte against poolpayminer's own shipped
  self-test vector before being trusted.
* `blobtool.js` finds the real PoW nonce position inside WrkzCoin's `blocktemplate_blob` (empirically
  confirmed at byte offset 73 -- see its own header comment for exactly how and why, and the one
  honestly-stated limitation of this approach: the exact byte layout of the nested "parent block"
  merge-mining placeholder region was not independently verified against WrkzCoin's own source, since
  no source tree is available for the exact deployed daemon version; this does not block normal pool
  operation, only matters if/when a real block is ever found, which is additionally gated by
  `payments.dryRun` regardless).
* Real WRKZ address decoded directly from a real pool address (not assumed): base58 prefix 999730,
  98-character `Wrkz...` addresses, 71 raw bytes (3-byte varint prefix + 32-byte spend key + 32-byte
  view key + 4-byte checksum) -- no subaddress/integrated-address scheme wired in (a separate,
  longer "integrated address" form exists for exchange deposits, not used for miner login).
* `coinUnits` = 100 atomic units per WRKZ (cross-checked: the real, static 10,000.00 WRKZ block reward
  introduced in WrkzCoin's own v0.4.0.220 release shows up as `reward: 1000000` on a live
  `getblockheaderbyheight`, matching 100 units/coin exactly).
* TCP keepalive on every stratum socket, double-credit protection in the block unlocker (dedup by block
  hash before crediting -- the exact class of bug found+fixed on QWC previously), guarded
  `/get_payments`/`/get_blocks` API endpoints (no crash on a missing `?time=`/`?height=` param), no
  donation address in the live `config.json` (folded into `poolFee` instead, see README.md) -- all
  standing checklist items for every pool in this project, applied from the start here.
* `blockUnlocker.js`'s block-reward lookup reads the daemon's own `getblockheaderbyheight` `reward`
  field directly -- no wallet RPC call needed for this step at all (this coin has no masternode/
  service-node split to separate out of a wallet-reported amount either).
* Real end-to-end tested against the live, fully-synced WRKZ mainnet node and poolpayminer (`-a
  cn/upx2`, poolpayminer's own real built-in algorithm name for this hash -- no algorithm porting
  needed, unlike some other coins in this project): real shares accepted.
* Payments stay `dryRun` until a real block matures and a real payout is rehearsed end to end through
  the pool's own `paymentProcessor.js` -- the wallet-api's real `sendTransaction`/`getBalance` behavior
  (auth header, exact endpoint) is carried over from the old pool's own proven-working convention but
  not yet independently exercised by this new code, see wrkz-project.md.
