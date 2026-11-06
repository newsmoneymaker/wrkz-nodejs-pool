/**
 * Payment processor for WrkzCoin (adapted from cryptonote-nodejs-pool, GPL-2.0).
 *
 * IMPORTANT (wrkz-project.md): wrkz-wallet-api is a REST service (turtlecoin-wallet-backend-js
 * "wallet-api" family) that ALSO answers the older bytecoin-style POST /json_rpc shape for backward
 * compatibility (confirmed via `strings` on the binary) -- the wallet(...) calls below use THAT json_rpc
 * path (getTransactionHashes/getTransaction/sendTransaction/getBalance), the same convention the OLD
 * /home/1wrkz pool's own `daemonType: "bytecoin"` branch used successfully for years of real sends
 * against this exact wallet. Still NOT independently exercised by THIS code yet -- payments.dryRun
 * stays true (so newPayouts() never reaches sendBatch's wallet call) until verified end-to-end against
 * a real matured block, per the new-coin-launch-checklist. `fee`/`anonymity` defaults below
 * (sendFee=10 atoms, anonymity=3 i.e. mixin) match the OLD pool's own real config.json
 * (`payments.transferFee`/`payments.mixin`), not re-guessed.
 *
 * Payouts are ordinary wallet transactions of the pool wallet (wallet-rpc `transfer`): all miners that are due are paid in ONE
 * transaction per round (up to maxPaymentsPerRound outputs), which makes the network fee a small part of the payouts instead
 * of a fee per miner. A batch is tracked in redis, because a crash between "money left the wallet" and "we know it"
 * must neither lose nor double a payout:
 *
 *   balance -> [debit + record in <coin>:payments:pending, state "sending"]
 *           -> wallet transfer -> state "sent" (txid known) -> confirmations >= minConfirmations -> paid
 *           -> or: the wallet refused / the transaction failed -> the amounts go back to the balances.
 *
 * Safety rules: the balance is debited BEFORE anything is sent (a crash can lose a payout attempt, never double it);
 * a batch whose outcome is unknown ("sending" for more than unknownAfterSeconds) is matched against the wallet's outgoing
 * transfers by its destinations (Monero style wallets have no transaction comments), and only refunded when the wallet has no
 * such transfer. An account with an open payout is skipped. dryRun logs what would be paid and sends nothing.
 * A transaction that stays unconfirmed for very long is only reported (the wallet cannot abandon it): check it by hand.
 *
 * config.payments: enabled, dryRun (true = only log), interval (s), minPayment (atoms), maxTransactionAmount (per account
 * and payout), maxPaymentsPerRound (accounts in one transaction), minConfirmations, pendingTimeoutHours, reserve (atoms kept
 * in the wallet), minerPayFee (true = the network fee is shared by the paid miners, false = the pool pays it),
 * onlyAccounts (if not empty only these are paid: for rehearsals), stopFile (emergency brake).
 **/

let async = require('async');
let crypto = require('crypto');
let fs = require('fs');
let path = require('path');

let rpc = require('./rpc.js');
let utils = require('./utils.js');

let logSystem = 'payments';
require('./exceptionWriter.js')(logSystem);

let pc = config.payments;
let sendFee = pc.sendFee >= 0 ? pc.sendFee : 10;          // MINIMUM_FEE in the node's own CryptoNoteConfig.h
let sendAnonymity = pc.sendAnonymity >= 0 ? pc.sendAnonymity : 3;
let UNITS = config.coinUnits || 100000000;
let interval = (pc.interval || 300) * 1000;
let minConfirmations = pc.minConfirmations || 10;   // the wallet spends coins only after 10 confirmations anyway
let timeoutHours = pc.pendingTimeoutHours || 48;
let reserve = pc.reserve >= 0 ? pc.reserve : 1000000;
let maxPerRound = pc.maxPaymentsPerRound || 8;
let dryRun = pc.dryRun !== false;              // anything but an explicit false means: do not send
let minerPayFee = pc.minerPayFee !== false;
let onlyAccounts = pc.onlyAccounts || [];
// Emergency brake: while this file exists no NEW payout is started (payouts already in flight are still settled).
// deployment/pause-payments.sh creates it, deployment/resume-payments.sh removes it. Checked before every payout.
let stopFile = pc.stopFile || path.join(__dirname, '..', 'STOP_PAYMENTS');
let paused = function () { return fs.existsSync(stopFile); };
let UNKNOWN_AFTER = (pc.unknownAfterSeconds || 120) * 1000;

let pendingKey = config.coin + ':payments:pending';
let workerKey = function (account) { return config.coin + ':workers:' + account; };
let coins = function (amount) { return utils.getReadableCoins(amount); };
let errText = function (e) { return e ? (e.message || JSON.stringify(e)) : 'unknown error'; };
let wallet = function (method, params, callback, timeout) { rpc.call(method, params, callback, {wallet: true, timeout: timeout}); };
// an RPC error object with a code = the node answered "no"; anything else (timeout, connection lost) = outcome unknown
let isRefusal = function (e) { return e && typeof e.code === 'number' && !(e instanceof Error); };

log('info', logSystem, 'Started%s: min payment %s, at most %s per account, up to %d accounts per transaction, every %ds, fee %s',
	[dryRun ? ' in DRY RUN mode (nothing is sent)' : '', coins(pc.minPayment), coins(pc.maxTransactionAmount || 0), maxPerRound, interval / 1000,
	minerPayFee ? 'paid by the miners' : 'paid by the pool']);

/**
 * Bookkeeping in redis (every change is one transaction)
 **/
function savePending (entry, callback) {
	redisClient.hset(pendingKey, entry.id, JSON.stringify(entry), callback);
}

function refund (entry, reason, callback) {
	log('warn', logSystem, 'Payout %s (%d account(s), %s) is returned to the balances: %s', [entry.id, entry.items.length, coins(entry.items.reduce(function (s, i) { return s + i.amount; }, 0)), reason]);
	let commands = [];
	entry.items.forEach(function (item) {
		commands.push(['hincrby', workerKey(item.account), 'balance', item.amount]);
		commands.push(['hincrby', workerKey(item.account), 'pending', -item.amount]);
	});
	commands.push(['hdel', pendingKey, entry.id]);
	redisClient.multi(commands).exec(function (error) {
		if (error) log('error', logSystem, 'Could not return payout %s to the balances %j', [entry.id, error]);
		callback();
	});
}

function complete (entry, tx, height, callback) {
	let now = Math.floor(Date.now() / 1000);
	let totalFee = Math.abs(parseInt(tx.fee) || 0) || entry.fee || 0;
	let feeShare = Math.floor(totalFee / entry.items.length);
	let commands = [];
	entry.items.forEach(function (item) {
		// member layout of the payments lists: txid:amount:fee:mixin:recipients:height (the website reads it)
		let member = [tx.txid, item.amount, feeShare, 0, entry.items.length, height].join(':');
		commands.push(['hincrby', workerKey(item.account), 'pending', -item.amount]);
		commands.push(['hincrby', workerKey(item.account), 'paid', item.amount]);
		commands.push(['zadd', config.coin + ':payments:all', now, member]);
		commands.push(['zadd', config.coin + ':payments:' + item.account, now, member]);
	});
	commands.push(['hdel', pendingKey, entry.id]);
	log('info', logSystem, 'Paid %d account(s) in transaction %s (fee %s)', [entry.items.length, tx.txid, coins(totalFee)]);
	redisClient.multi(commands).exec(function (error) {
		if (error) log('error', logSystem, 'Could not record the payment %s %j', [entry.id, error]);
		callback();
	});
}

/**
 * Step 1: settle what is in flight
 **/
function reconcileEntry (entry, callback) {
	let age = Date.now() - entry.ts;

	// The outcome of sendTransaction is unknown (crash, timeout): look for it among the wallet's recent
	// transactions on its own address (this wallet-service has no Monero-style get_transfers; see the
	// header comment).
	if (entry.state === 'sending') {
		if (age < UNKNOWN_AFTER) return callback();
		rpc.call('getlastblockheader', {}, function (hErr, last) {
			let tip = last && last.block_header && last.block_header.height;
			if (hErr || typeof tip !== 'number') {
				log('error', logSystem, 'Cannot reconcile payout %s: no chain height (%s)', [entry.id, errText(hErr)]);
				return callback();
			}
			wallet('getTransactionHashes', {addresses: [poolConfig.poolAddress], firstBlockIndex: Math.max(0, tip - 100), blockCount: 101}, function (error, result) {
				if (error) {
					log('error', logSystem, 'Cannot reconcile payout %s: %s', [entry.id, errText(error)]);
					return callback();
				}
				let hashes = [];
				((result && result.items) || []).forEach(function (block) {
					(block.transactionHashes || []).forEach(function (h) { hashes.push(h); });
				});
				let wanted = {};
				let wantedTotal = 0;
				entry.items.forEach(function (item) { wanted[item.dest] = item.amount; wantedTotal += item.amount; });

				async.detectSeries(hashes, function (hash, cb) {
					wallet('getTransaction', {transactionHash: hash}, function (gErr, r) {
						let tx = r && r.transaction;
						if (gErr || !tx || tx.isBase || tx.timestamp * 1000 < entry.ts - 120000) return cb(null, false);
						let transfers = tx.transfers || [];
						if (transfers.length !== entry.items.length) return cb(null, false);
						let total = 0;
						let ok = transfers.every(function (d) {
							if (!(d.address in wanted) || d.amount > wanted[d.address] || d.amount < wanted[d.address] - UNITS) return false;
							total += d.amount;
							return true;
						});
						cb(null, ok && total <= wantedTotal);
					});
				}, function (err, match) {
					if (!match) return refund(entry, 'the wallet has no such transaction', callback);
					entry.state = 'sent';
					entry.txid = match;
					log('info', logSystem, 'Payout %s found in the wallet log as transaction %s', [entry.id, entry.txid]);
					savePending(entry, function () { callback(); });
				});
			});
		});
		return;
	}

	rpc.call('getlastblockheader', {}, function (hErr, last) {
		let tip = last && last.block_header && last.block_header.height;
		wallet('getTransaction', {transactionHash: entry.txid}, function (error, result) {
			if (error || hErr) {
				log('error', logSystem, 'Payout %s: cannot read transaction %s (%s), leaving it for a manual check', [entry.id, entry.txid, errText(error || hErr)]);
				return callback();
			}
			let tx = (result && result.transaction) || {};
			// this wallet-service reports a transaction's blockIndex, not a ready-made confirmation count
			let confirmations = (tx.blockIndex > 0 && typeof tip === 'number') ? (tip - tx.blockIndex + 1) : 0;
			// WalletTransactionState (include/IWallet.h): SUCCEEDED=0, FAILED=1, CANCELLED=2, CREATED=3, DELETED=4
			if (tx.state === 1 || tx.state === 2) return refund(entry, 'the transaction failed', callback);
			if (confirmations >= minConfirmations) {
				tx.txid = entry.txid;
				return complete(entry, tx, tx.blockIndex || '', callback);
			}
			if (confirmations === 0 && age > timeoutHours * 3600 * 1000) {
				// a wallet cannot abandon a transaction: nothing is refunded by itself, somebody must look at it
				log('error', logSystem, 'Payout %s: transaction %s is not confirmed after %d hours, check it by hand (the amounts stay booked as pending)', [entry.id, entry.txid, timeoutHours]);
			}
			callback();
		});
	});
}

function reconcile (callback) {
	redisClient.hgetall(pendingKey, function (error, all) {
		if (error) {
			log('error', logSystem, 'Cannot read the open payouts %j', [error]);
			return callback(true);
		}
		let entries = Object.keys(all || {}).map(function (id) { return JSON.parse(all[id]); });
		if (entries.length) log('info', logSystem, '%d payout transaction(s) in flight', [entries.length]);
		async.eachSeries(entries, reconcileEntry, function () { callback(null); });
	});
}

/**
 * Step 2: new payouts, all due accounts in one transaction
 **/
function sendBatch (entry, callback) {
	// Unlike Monero-style wallets, this wallet-service's sendTransaction has no "subtract_fee_from_outputs"
	// -- the fee is a single explicit field, paid out of the source's own funds. Split it proportionally
	// across the destinations ourselves when minerPayFee is set, same end result.
	let feeShare = minerPayFee ? Math.floor(sendFee / entry.items.length) : 0;
	let transfers = entry.items.map(function (item) { return {address: item.dest, amount: Math.max(1, item.amount - feeShare)}; });

	redisClient.multi([].concat.apply([], entry.items.map(function (item) {
		return [['hincrby', workerKey(item.account), 'balance', -item.amount], ['hincrby', workerKey(item.account), 'pending', item.amount]];
	})).concat([['hset', pendingKey, entry.id, JSON.stringify(entry)]])).exec(function (error) {
		if (error) {
			log('error', logSystem, 'Could not book the payout %s %j', [entry.id, error]);
			return callback();
		}

		wallet('sendTransaction', {
			sourceAddresses: [poolConfig.poolAddress], transfers: transfers, changeAddress: poolConfig.poolAddress,
			fee: sendFee, anonymity: sendAnonymity, unlockTime: 0
		}, function (error, result) {
			if (error && isRefusal(error)) {
				// the wallet said no (not enough funds, invalid address ...): nothing was sent
				log('error', logSystem, 'The wallet refused the payout: %s', [errText(error)]);
				return refund(entry, 'the wallet refused it: ' + errText(error), callback);
			}
			if (error || !result || typeof result.transactionHash !== 'string') {
				// outcome unknown: the record stays in state "sending" and is reconciled with the wallet log later
				log('error', logSystem, 'Sending to %d account(s) failed or is unclear: %s (the record is kept, it is checked against the wallet)', [entry.items.length, errText(error || 'no txid')]);
				return callback();
			}
			entry.state = 'sent';
			entry.txid = result.transactionHash;
			entry.fee = sendFee;
			log('info', logSystem, 'Sent %s to %d account(s) in transaction %s (fee %s)', [coins(entry.items.reduce(function (s, i) { return s + i.amount; }, 0)), entry.items.length, entry.txid, coins(entry.fee)]);
			savePending(entry, function () { callback(); });
		}, 180000);
	});
}

function newPayouts (callback) {
	if (paused()) {
		log('warn', logSystem, 'PAUSED: %s exists, no new payouts are started', [stopFile]);
		return callback(null);
	}

	redisClient.keys(workerKey('*'), function (error, keys) {
		if (error) {
			log('error', logSystem, 'Cannot list the accounts %j', [error]);
			return callback(true);
		}
		let commands = keys.map(function (k) { return ['hmget', k, 'balance', 'pending', 'minPayoutLevel']; });
		redisClient.multi(commands).exec(function (error, replies) {
			if (error) {
				log('error', logSystem, 'Cannot read the balances %j', [error]);
				return callback(true);
			}

			let due = [];
			keys.forEach(function (key, i) {
				let account = key.substring((config.coin + ':workers:').length);
				let balance = parseInt(replies[i][0]) || 0;
				let pending = parseInt(replies[i][1]) || 0;
				let level = Math.max(pc.minPayment, parseInt(replies[i][2]) || 0);
				if (pending > 0 || balance < level) return;
				if (!utils.validateMinerAddress(account)) return;
				if (onlyAccounts.length && onlyAccounts.indexOf(account) === -1) return;
				due.push({account: account, dest: account, amount: Math.min(balance, pc.maxTransactionAmount || balance)});
			});

			if (due.length === 0) {
				log('info', logSystem, 'Nobody is due for a payment');
				return callback(null);
			}

			due.sort(function (a, b) { return b.amount - a.amount; });
			due = due.slice(0, maxPerRound);

			if (dryRun) {
				due.forEach(function (d) { log('info', logSystem, '[dry run] would pay %s to %s', [coins(d.amount), d.dest]); });
				return callback(null);
			}

			wallet('getBalance', {address: poolConfig.poolAddress}, function (error, balances) {
				if (error) {
					log('error', logSystem, 'Cannot read the wallet balance: %s', [errText(error)]);
					return callback(true);
				}
				let spendable = parseInt(balances && balances.availableBalance) || 0;
				let budget = spendable - reserve;
				log('info', logSystem, 'Wallet: %s spendable (%s kept in reserve), %d account(s) due', [coins(spendable), coins(reserve), due.length]);

				// the batch must fit into the wallet (largest payouts first)
				let items = [];
				due.forEach(function (d) {
					if (d.amount > budget) {
						log('warn', logSystem, 'Not enough spendable funds for %s to %s (budget %s)', [coins(d.amount), d.account, coins(Math.max(budget, 0))]);
						return;
					}
					budget -= d.amount;
					items.push(d);
				});
				if (items.length === 0) return callback(null);
				if (paused()) {
					log('warn', logSystem, 'PAUSED: %s appeared, this round is skipped', [stopFile]);
					return callback(null);
				}

				let id = crypto.randomBytes(6).toString('hex');
				sendBatch({id: id, comment: 'pool-payout:' + id, items: items, ts: Date.now(), state: 'sending'}, function () { callback(null); });
			});
		});
	});
}

/**
 * Run payment processor
 **/
function runInterval () {
	async.waterfall([reconcile, newPayouts], function () {
		setTimeout(runInterval, interval);
	});
}

runInterval();
