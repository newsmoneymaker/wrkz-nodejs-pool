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
 * call(method, params, callback(err, result), options). err is {code, message} for an RPC error (the other side said no),
 * an Error for a transport problem (outcome unknown). options: {wallet: true} talks to the wallet, timeout in ms.
 **/
exports.call = function (method, params, callback, options) {
	options = options || {};
	let target = (options.wallet ? config.wallet : config.node) || {};
	let body = JSON.stringify({jsonrpc: '2.0', id: '0', method: method, params: params || {}});
	let done = false;
	let finish = function (err, result) {
		if (done) return;
		done = true;
		callback(err, result);
	};

	let headers = {'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body)};
	// wrkz-wallet-api is started with -r/--rpc-password; its REST routes want this as an X-API-KEY
	// header (confirmed from its own route list) -- best-effort reuse for its /json_rpc route too,
	// NOT yet exercised against a real call (the wallet was busy resyncing when this was written, see
	// wrkz-project.md). If real sends ever fail with an auth error, check this first.
	if (options.wallet && target.rpcPassword) headers['X-API-KEY'] = target.rpcPassword;

	let req = http.request({
		host: target.host || '127.0.0.1',
		port: target.port || (options.wallet ? 8198 : 8197),
		path: '/json_rpc',
		method: 'POST',
		headers: headers,
		timeout: options.timeout || 30000
	}, function (res) {
		let chunks = [];
		res.on('data', function (c) { chunks.push(c); });
		res.on('end', function () {
			let text = Buffer.concat(chunks).toString('utf8');
			let parsed;
			try {
				parsed = JSON.parse(text);
			} catch (e) {
				return finish(new Error('Bad answer from the ' + (options.wallet ? 'wallet' : 'daemon') + ' (HTTP ' + res.statusCode + '): ' + text.slice(0, 120)));
			}
			if (parsed.error) return finish(parsed.error);
			finish(null, parsed.result);
		});
	});
	req.on('timeout', function () { req.destroy(new Error('RPC timeout: ' + method)); });
	req.on('error', function (e) { finish(e); });
	req.end(body);
};
