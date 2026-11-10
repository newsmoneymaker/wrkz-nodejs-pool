/**
 * WrkzCoin (WRKZ) Pool (based on cryptonote-nodejs-pool, GPL-2.0)
 *
 * Wrapper around the wrkzhash helper (hasher/wrkzhash.cpp -- poolpayminer's own cn/upx2 (CryptoNight-UPX2) code, vendored verbatim): wrkzHash(blob) for share
 * validation. Settings in config.hasher: {path, threads}: `threads` helper processes, requests go
 * round robin. hash(blobHex, cb)  cb(err, hashHex): 32 bytes as computed. No key/dataset setup needed
 * (unlike RandomX-based coins' hasher.js) -- this is a fixed-parameter CryptoNight-family hash. A
 * helper is restarted when it dies.
 **/
let spawn = require('child_process').spawn;
let path = require('path');

let hasherConfig = config.hasher || {};
let log_ = function (level, text, args) { log(level, 'hasher', text, args || []); };

let helpers = [];
let next = 0;
let nextId = 1;

function start (index) {
	let file = hasherConfig.path || path.join(__dirname, '..', 'hasher', 'wrkzhash');
	let helper = {index: index, child: null, buffer: '', pending: new Map(), restartTimer: null};
	helpers[index] = helper;

	let child = spawn(file, [], {stdio: ['pipe', 'pipe', 'inherit']});
	helper.child = child;
	child.stdout.setEncoding('utf8');
	child.stdout.on('data', function (data) {
		helper.buffer += data;
		let idx;
		while ((idx = helper.buffer.indexOf('\n')) !== -1) {
			let line = helper.buffer.slice(0, idx);
			helper.buffer = helper.buffer.slice(idx + 1);
			let parts = line.split(' ');
			if (parts[0] !== 'H' && parts[0] !== 'F') continue;
			let key = parts[0] + parts[1];
			let cb = helper.pending.get(key);
			if (!cb) continue;
			helper.pending.delete(key);
			if (parts[2] === 'err' || !parts[2]) cb(new Error('hasher error')); else cb(null, parts[2]);
		}
	});
	child.stdin.on('error', function () {});
	child.on('error', function (err) {
		log_('error', 'Cannot run %s: %s', [file, err.message]);
	});
	child.on('exit', function (code, signal) {
		log_('error', 'wrkzhash exited (code %s, signal %s), restarting in 3 s', [code, signal]);
		helper.child = null;
		helper.pending.forEach(function (cb) { cb(new Error('hasher restarted')); });
		helper.pending.clear();
		clearTimeout(helper.restartTimer);
		helper.restartTimer = setTimeout(function () { start(index); }, 3000);
	});
}

for (let i = 0; i < (hasherConfig.threads || 2); i++) start(i);

exports.isReady = function () { return helpers.some(function (h) { return h && h.child; }); };

exports.hash = function (blobHex, callback) {
	for (let tries = 0; tries < helpers.length; tries++) {
		let helper = helpers[next++ % helpers.length];
		if (!helper || !helper.child) continue;
		let id = 'j' + (nextId++);
		helper.pending.set('H' + id, callback);
		helper.child.stdin.write('H ' + id + ' ' + blobHex + '\n');
		return;
	}
	callback(new Error('hasher not ready'));
};

// cn_fast_hash (Keccak-256, original/CN padding) of arbitrary bytes -- needed by blobtool.js to
// rebuild the real PoW "hashing" blob (merkleRoot substitution), see wrkzhash.cpp's own header
// comment for why.
exports.fastHash = function (blobHex, callback) {
	for (let tries = 0; tries < helpers.length; tries++) {
		let helper = helpers[next++ % helpers.length];
		if (!helper || !helper.child) continue;
		let id = 'j' + (nextId++);
		helper.pending.set('F' + id, callback);
		helper.child.stdin.write('F ' + id + ' ' + blobHex + '\n');
		return;
	}
	callback(new Error('hasher not ready'));
};
