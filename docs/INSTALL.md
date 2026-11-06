# Installing the WrkzCoin pool

This project's own real deployment: the pool runs on the MAIN server (95.216.18.84), the WrkzCoin
daemon (`Wrkzd`) and wallet service (`wrkz-wallet-api`) run on a different server (`srv5`,
144.76.186.203, SSH alias `srv5`) that already had a whole pre-existing coin family running on it --
see `wrkz-project.md` for how that was found. The pool reaches them across servers through an SSH
tunnel, never by exposing either RPC on a public interface.

## 1. WrkzCoin daemon + wallet (already running on srv5 in this deployment)

`Wrkzd` is a prebuilt binary (`/root/wrkz/linux-gcc-8_cli_wrkzcoin_x64_0.4.0.220/Wrkzd
--enable-blockexplorer-detailed`) kept alive by that server's own watchdog script
(`/root/demoncrash.sh`, NOT systemd -- see `wrkz-project.md` before trying to stop/restart it). Its RPC
is a standard CryptoNote/bytecoin-style `POST /json_rpc` on port 17856, no auth, plus a couple of
simple `GET /info`/`GET /height` convenience routes. Confirm it's actually synced before trusting
anything: `curl -s 127.0.0.1:17856/info` and check `"height"` equals `"network_height"`.

The real pool wallet file (`pool.wallet`, same directory, years of real transaction history -- treat
as sensitive) is opened by `wrkz-wallet-api -p 47857 -r '<rpc password>' --no-console --log-file
<file>`. **Do not redirect its stdin from `/dev/null`** -- this binary shares its interactive-console
code with the CLI wallet tool and treats stdin EOF as a shutdown request even with `--no-console`;
redirect from `/dev/zero` instead (never produces a line, so it just blocks forever, which is what a
non-interactive service should do). It answers two shapes: a REST API (turtlecoin-wallet-backend-js
"wallet-api" family -- `/wallet/open`, `/balance`, `/transactions/send/basic`, etc, auth via an
`X-API-KEY` header) AND, for backward compatibility, the SAME older `POST /json_rpc` shape
(`getBalance`/`sendTransaction`/`getTransactionHashes`/`getTransaction`) the daemon itself uses -- this
pool's `rpc.js` uses that second shape, matching the real convention the OLD `/home/1wrkz` pool (a
stock dvandal cryptonote-nodejs-pool fork) already used successfully against this exact wallet for
years of real sends.

If the node and the pool run on different machines, forward both RPC ports over SSH instead of
exposing them -- this project's own `wrkz-tunnel.service` (two `-L` forwards over one SSH connection,
127.0.0.1:17856 and 127.0.0.1:47857, both into `srv5`) is the exact unit used in production here; copy
its pattern (same one `xkr-tunnel.service` uses for Kryptokrona) for any other split-server coin.

## 2. blobtool.js (no C++ helper here, read its header comment first)

Unlike Kryptokrona (where the daemon's `getblocktemplate` genuinely doesn't hand back a ready-to-hash
blob and a real C++ helper linked against the node's own compiled source is needed), WrkzCoin's
situation is different and NOT fully resolved the same clean way: no source tree is available for this
exact deployed daemon version (only a prebuilt binary), so `blobtool.js` is a pure-JS module that
splices the miner's nonce into the real `blocktemplate_blob` at a byte offset (73) confirmed
empirically (several independently-fetched templates all decode a believable Unix timestamp right
before an all-zero 4-byte field at that exact position). **Read `blobtool.js`'s own header comment
before touching this again** -- it states plainly what is and isn't independently verified here.

## 3. Hasher

`hasher/wrkzhash` is poolpayminer's own already-shipped, already-self-tested `cn/upx2` implementation
(`Algorithm::CN_UPX2`), vendored verbatim from its `src/crypto/cn/` + `src/base/crypto/` (NOT a second
independent vendoring from WrkzCoin's own source, which isn't available) -- this keeps the pool's own
share check and the real miner's PoW guaranteed identical by construction. Build with `cd hasher &&
make` (needs a CPU with AES-NI; no key/dataset setup needed, unlike a RandomX-based pool's hasher).
Verified against poolpayminer's own shipped self-test vector (`test_input[0:76]` ->
`test_output_femto_upx2`, see `CryptoNight_test.h`) before being trusted -- re-run that check
(`./wrkzhash --hash <the 76-byte hex test vector>`) after any rebuild.

## 4. Redis

A dedicated instance with a password and AOF: this deployment's own `wrkz-pool-redis.service`
(`/root/claude/wrkz/redis.conf`, port 6407).

## 5. The pool

```
cd wrkz-nodejs-pool && npm install --production
make -C hasher
cp config_examples/wrkz.json config.json      # then edit it for real
```

Edit `config.json`: `poolHost`, `poolServer.poolAddress`, the ports and the certificate for TLS
(`poolServer.sslCert`/`sslKey`), `redis`, `api.password`, `blockUnlocker.poolFee` and `donations`,
`payments`, `node`, `wallet` (including `wallet.rpcPassword`), `hasher.path`.
**Keep `payments.dryRun: true` until the rehearsal below.**

The pool runs as separate modules (`init.js -module=pool|api|unlocker|payments|chartsDataCollector`),
each in its own systemd unit, same pattern as every other coin in this project.

## 6. Website

Copy `website_example/` to the web root, set `poolHost`, the contact and links in `config.js`, and
proxy `/api` to the pool API (127.0.0.1:8767 in this deployment).

## 7. Rehearse the payments

1. `payments.dryRun: true`: the log of the payments module shows what would be paid.
2. Fund the pool wallet with a few coins (or wait for the first block), credit a small balance in
   Redis to your own test addresses (`<coin>:workers:<address>`, field `balance`), set
   `payments.onlyAccounts` to them, `dryRun: false`, and watch the payout confirm.
3. Remove the test accounts from Redis and set `onlyAccounts` to `[]`.

Good to know: `sendTransaction`'s `fee`/`anonymity` fields have no automatic default the way a
Monero-style wallet infers them (`payments.sendFee`/`sendAnonymity` in config.json carry over the OLD
pool's own real, already-tuned values: fee 553 atoms, anonymity/mixin 1); `deployment/pause-payments.sh`
stops new payouts at once; a wallet cannot abandon a transaction, so a payout that stays unconfirmed
for `pendingTimeoutHours` is only reported in the log and must be checked by hand.
