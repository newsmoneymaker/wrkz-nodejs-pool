/**
 * WrkzCoin (WRKZ) Pool (based on cryptonote-nodejs-pool, GPL-2.0)
 *
 * JSON-RPC 2.0 client of the WrkzCoin daemon (Wrkzd, real daemon RPC confirmed: standard CryptoNote/
 * bytecoin-style POST /json_rpc, method names WITHOUT underscores -- getblocktemplate/getlastblockheader/
 * submitblock/getblockcount, NOT get_block_template etc) and of the pool wallet (wrkz-wallet-api, which
 * besides its modern REST routes also answers this SAME POST /json_rpc shape for backward
 * compatibility -- confirmed via `strings` on the binary; method names getBalance/sendTransaction/
 * getTransactionHashes/getTransaction, same convention the OLD /home/1wrkz pool's own
 * `daemonType: "bytecoin"` branch already used successfully against this exact daemon+wallet for
 * years of real mining). Settings: config.node {host, port} (default 127.0.0.1:17856, reached through
 * the wrkz-tunnel SSH forward to srv5 -- see wrkz-project.md, the real daemon RPC has no auth and is
 * not exposed on any public interface), config.wallet {host, port} (default 127.0.0.1:47857, same tunnel,
 * auth via `X-API-KEY` header + `--rpc-password` -- see wrkz-project.md for what's actually verified).
 **/
let http = require('http');

/**
 * REAL, CONFIRMED wrkz-wallet-api shape (verified 2026-11-07 against the live wallet-api, not guessed):
 * it does NOT answer the bytecoin-style POST /json_rpc at all (confirmed: 404) -- it is REST-only
 * (turtlecoin-wallet-backend-js "wallet-api" family). Auth is the `X-API-KEY` header (confirmed working,
 * same value as --rpc-password). Confirmed working calls: POST /wallet/create {filename,password},
 * POST /wallet/open {filename,password}, GET /addresses, GET /addresses/primary, GET /balance ->
 * {locked, unlocked} (atomic units, the wallet's own single address), GET /keys/<address> ->
 * {privateSpendKey, publicSpendKey}, GET /keys/mnemonic/<address> -> {mnemonicSeed}.
 * paymentProcessor.js's own method names (getBalance/sendTransaction/getTransactionHashes/getTransaction
 * -- carried over from Kryptokrona's differently-shaped wallet-service) are translated to this REST shape
 * below, so paymentProcessor.js itself did not need to change. Still NOT exercised against a REAL send
 * (payments.dryRun stays true) -- the exact body shape of POST /transactions/send/advanced (used for a
 * batch of several destinations in one transaction, since the pool pays everyone due in ONE tx) is a
 * best-effort guess at the standard turtlecoin-wallet-backend-js shape, not confirmed call-by-call like
 * the others above. If a real send ever 400s, check this first.
 **/
let WALLET_REST = {
	getBalance: {method: 'GET', path: function () { return '/balance'; }},
	sendTransaction: {method: 'POST', path: function () { return '/transactions/send/advanced'; }, body: function (p) {
		return {
			addresses: p.sourceAddresses,
			destinations: (p.transfers || []).map(function (t) { return {address: t.address, amount: t.amount}; }),
			changeAddress: p.changeAddress,
			fee: p.fee,
			mixin: p.anonymity,
			unlockTime: p.unlockTime || 0
		};
	}},
	// Reconcile path only (an in-flight payout whose outcome was unknown after a crash/timeout) -- rare.
	getTransactionHashes: {method: 'GET', path: function (p) { return '/transactions/address/' + encodeURIComponent((p.addresses || [])[0] || '') + '/' + (p.firstBlockIndex || 0) + '/' + (p.blockCount || 1000); }},
	getTransaction: {method: 'GET', path: function (p) { return '/transactions/hash/' + p.transactionHash; }}
};

/**
 * call(method, params, callback(err, result), options). err is {code, message} for an RPC error (the other side said no),
 * an Error for a transport problem (outcome unknown). options: {wallet: true} talks to the wallet, timeout in ms.
 **/
exports.call = function (method, params, callback, options) {
	options = options || {};
	let target = (options.wallet ? config.wallet : config.node) || {};
	let done = false;
	let finish = function (err, result) {
		if (done) return;
		done = true;
		callback(err, result);
	};

	let httpMethod, path, bodyObj;
	if (options.wallet) {
		let mapping = WALLET_REST[method];
		if (!mapping) return finish(new Error('No REST mapping for wallet method ' + method));
		httpMethod = mapping.method;
		path = mapping.path(params || {});
		bodyObj = mapping.body ? mapping.body(params || {}) : null;
	} else {
		httpMethod = 'POST';
		path = '/json_rpc';
		bodyObj = {jsonrpc: '2.0', id: '0', method: method, params: params || {}};
	}
	let body = bodyObj ? JSON.stringify(bodyObj) : '';

	let headers = {'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body)};
	// wrkz-wallet-api is started with -r/--rpc-password; its REST routes want this as an X-API-KEY header.
	if (options.wallet && target.rpcPassword) headers['X-API-KEY'] = target.rpcPassword;

	let req = http.request({
		host: target.host || '127.0.0.1',
		port: target.port || (options.wallet ? 8198 : 8197),
		path: path,
		method: httpMethod,
		headers: headers,
		timeout: options.timeout || 30000
	}, function (res) {
		let chunks = [];
		res.on('data', function (c) { chunks.push(c); });
		res.on('end', function () {
			let text = Buffer.concat(chunks).toString('utf8');
			if (res.statusCode >= 400) {
				return finish({code: res.statusCode, message: 'HTTP ' + res.statusCode + ' from the ' + (options.wallet ? 'wallet' : 'daemon') + ': ' + text.slice(0, 200)});
			}
			if (!options.wallet) {
				let parsed;
				try {
					parsed = JSON.parse(text);
				} catch (e) {
					return finish(new Error('Bad answer from the daemon (HTTP ' + res.statusCode + '): ' + text.slice(0, 120)));
				}
				if (parsed.error) return finish(parsed.error);
				return finish(null, parsed.result);
			}
			// wallet-api: plain REST JSON body, no jsonrpc envelope -- normalize the handful of shapes
			// paymentProcessor.js actually reads (see WALLET_REST comment above).
			let parsed;
			try {
				parsed = text ? JSON.parse(text) : {};
			} catch (e) {
				return finish(new Error('Bad answer from the wallet (HTTP ' + res.statusCode + '): ' + text.slice(0, 120)));
			}
			if (method === 'getBalance') return finish(null, {availableBalance: parsed.unlocked, lockedAmount: parsed.locked});
			if (method === 'sendTransaction') return finish(null, {transactionHash: parsed.transactionHash});
			return finish(null, parsed);
		});
	});
	req.on('timeout', function () { req.destroy(new Error('RPC timeout: ' + method)); });
	req.on('error', function (e) { finish(e); });
	req.end(body);
};
