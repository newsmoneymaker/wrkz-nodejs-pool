/**
 * WrkzCoin (WRKZ) Pool (based on cryptonote-nodejs-pool, GPL-2.0)
 *
 * Builds the job + submission data from a raw `blocktemplate_blob`.
 *
 * **2026-11-10 fix**: this file used to treat the daemon's raw, untouched `blocktemplate_blob` as
 * BOTH the submission blob AND the PoW-hashing blob (nonce spliced in at byte 73 either way). That
 * was correct for submission but WRONG for hashing: got WrkzCoin's real source (tag
 * wrkzcoin_v0.4.8.280-dev, matches this daemon's own `--version` output) and confirmed via
 * `CachedBlock::getBlockLongHash()` / `CryptoNoteSerialization.cpp`'s `serialize(ParentBlockSerializer&, ...)`
 * that the real network PoW hash is over a much SHORTER, DIFFERENT blob: the parent block's
 * majorVersion/minorVersion/timestamp/prevId(placeholder)/nonce, followed by a COMPUTED merkleRoot
 * (= cn_fast_hash of the parent block's own placeholder "base transaction" -- since
 * transactionCount is hardcoded to 1 by this daemon's own block-template code (`Core.cpp`'s
 * `b.parentBlock.transactionCount = 1`), the tree is just that one leaf, no combining needed:
 * `tree_hash_from_branch` with depth 0 just returns the leaf), then numberOfTransactions. The raw
 * baseTransactionBranch/minerTx/blockchainBranch bytes the full template carries are NOT part of
 * this -- see `getParentBlockHashingBinaryArray(true)` (headerOnly).
 *
 * Symptom this explains: the pool's own vardiff/share accounting kept working fine (any
 * reasonably-distributed 32 byte value clears a low vardiff target at roughly the right rate
 * whether or not it's computed over the "real" bytes), but every full block solution this pool
 * ever found was rejected by the daemon ("Block not accepted") -- the pool's "found a block!"
 * signal was effectively decoupled from what the real network actually validates. Confirmed live:
 * 11 real block solutions submitted between 2026-11-10 19:43 and 22:04, all 11 rejected.
 *
 * **CRITICAL, found while verifying the fix**: the placeholder base transaction's content (so its
 * `extra`, which carries the merge-mining tag's depth + the tag's own stored merkleRoot) is NOT a
 * universal constant across blocks, even though a freshly-requested, not-yet-mined
 * `getblocktemplate` happens to show a trivial all-zero/depth-0 one right now. Pulled a real,
 * already-mined, already-accepted historical block via the daemon's `/getrawblocks` endpoint
 * (height 4300100) and its placeholder tx had version=1 and a merge-mining tag with depth=4 and a
 * real (non-zero) stored merkleRoot -- nothing like the live template's version=0/depth=0/all-zero
 * one. **Never hardcode or cache the placeholder tx bytes (or the merkleRoot derived from them)
 * across templates -- always re-extract and re-hash them from the SPECIFIC blob being processed.**
 * (This file already does that correctly -- the fastHash call below is per-blob -- this note is so
 * a future edit doesn't "optimize" it into a cached constant.) Verified end to end against that
 * real height-4300100 block: reconstructing the hashing blob from ITS OWN placeholder tx bytes and
 * its real nonce (1018287) gives a hash that genuinely clears its real recorded difficulty
 * (60759692) -- proof the construction below is correct, not just plausible.
 *
 * The placeholder base transaction's version/unlockTime/vin/vout shape (present in every block
 * checked, mined or template) is hardcoded trivial by this daemon's template builder (`Core.cpp`:
 * only `appendMergeMiningTagToExtra` touches `b.parentBlock.baseTransaction`, version/unlockTime
 * are left default and vin/vout are never populated) -- version itself can apparently still vary
 * (0 vs 1 observed), so this file parses it generically rather than assuming a fixed byte pattern,
 * and only asserts the parts that must hold for the rest of the parse to be well-defined
 * (vin == vout == 0, so there is no per-input/per-output structure to walk).
 *
 * run(blobHex, cb)  cb(err, {template, hashing, templateNonceOffset, hashingNonceOffset, prevHash})
 **/
let hasher = require('./hasher.js');

const OUTER_HEADER_LEN = 34;   // majorVersion(1) + minorVersion(1) + prevId(32), majorVersion >= 2
const PREVID_LEN = 32;
const NONCE_LEN = 4;

function readVarint (buf, off) {
	let val = 0n, shift = 0n, start = off;
	for (;;) {
		if (off >= buf.length) throw new Error('varint runs past end of blob (started at ' + start + ')');
		let b = buf[off++];
		val |= BigInt(b & 0x7f) << shift;
		if (!(b & 0x80)) break;
		shift += 7n;
	}
	return {value: val, end: off};
}

exports.run = function (blobHex, callback) {
	let fail = function (msg) { callback(new Error(msg)); };

	let blob;
	try {
		blob = Buffer.from(blobHex, 'hex');
	} catch (e) {
		return fail('bad hex blob: ' + e.message);
	}
	if (blob.length < OUTER_HEADER_LEN + 2 + 5 + PREVID_LEN + NONCE_LEN) {
		return fail('block template too short (' + blob.length + ' bytes)');
	}

	let prevHash = blob.slice(2, 2 + 32).toString('hex');   // outer prev_id, matches getlastblockheader's tip hash

	// --- parent block header (majorVersion >= 2 path: majorVersion, minorVersion, timestamp, prevId, nonce) ---
	let off = OUTER_HEADER_LEN;
	let parentHeaderStart = off;
	off += 2;   // parent majorVersion + minorVersion (1 byte each -- always small values in practice)
	let ts;
	try {
		ts = readVarint(blob, off);
	} catch (e) {
		return fail('cannot parse parent block timestamp: ' + e.message);
	}
	off = ts.end;
	off += PREVID_LEN;   // parent prevId placeholder
	let nonceOffset = off;
	off += NONCE_LEN;
	let parentHeaderEnd = off;   // majorVersion..nonce, the part that goes into the hashing blob verbatim

	// --- numberOfTransactions, then (if >1) a baseTransactionBranch this file does not know how to
	//     rebuild -- this daemon's own template builder always sets transactionCount=1 (Core.cpp), so
	//     fail loudly rather than guess if that is ever not the case. ---
	let numTxStart = off;
	let numTx;
	try {
		numTx = readVarint(blob, off);
	} catch (e) {
		return fail('cannot parse numberOfTransactions: ' + e.message);
	}
	off = numTx.end;
	let numTxBytes = blob.slice(numTxStart, numTx.end);
	if (numTx.value !== 1n) {
		return fail('parent block transactionCount is ' + numTx.value + ', not the expected 1 -- ' +
			'a real baseTransactionBranch would need to be hashed in, not supported, refusing to guess');
	}

	// --- the placeholder base transaction (parentBlock.baseTransaction): version, unlock_time, vin,
	//     vout, extra. vin/vout are always empty (this daemon's template builder never populates
	//     them -- only the merge-mining tag is appended to extra), so there is no per-input/output
	//     structure to walk -- but version/the extra payload itself DO vary between blocks (a real
	//     already-mined block was seen with version=1 and a non-trivial merge-mining tag), so those
	//     are read generically, not assumed constant. ---
	let placeholderTxStart = off;
	let version, unlockTime, vinSize, voutSize, extraSize;
	try {
		version = readVarint(blob, off); off = version.end;
		unlockTime = readVarint(blob, off); off = unlockTime.end;
		vinSize = readVarint(blob, off); off = vinSize.end;
		voutSize = readVarint(blob, off); off = voutSize.end;
		extraSize = readVarint(blob, off); off = extraSize.end;
	} catch (e) {
		return fail('cannot parse the parent block\'s placeholder base transaction: ' + e.message);
	}
	if (vinSize.value !== 0n || voutSize.value !== 0n) {
		return fail('parent block placeholder base transaction has a non-empty vin/vout ' +
			'(vin=' + vinSize.value + ' vout=' + voutSize.value + '), refusing to guess at a real vin/vout parse');
	}
	if (off + Number(extraSize.value) > blob.length) {
		return fail('placeholder base transaction extra field runs past end of blob');
	}
	off += Number(extraSize.value);
	let placeholderTxEnd = off;

	let hashingPrefix = blob.slice(parentHeaderStart, parentHeaderEnd);   // majorVersion..nonce
	let placeholderTxHex = blob.slice(placeholderTxStart, placeholderTxEnd).toString('hex');

	hasher.fastHash(placeholderTxHex, function (err, merkleRootHex) {
		if (err) return fail('cannot compute the placeholder transaction\'s cn_fast_hash: ' + err.message);
		if (!/^[0-9a-f]{64}$/.test(merkleRootHex)) return fail('cn_fast_hash returned something that is not a 32 byte hash');

		let hashing = Buffer.concat([hashingPrefix, Buffer.from(merkleRootHex, 'hex'), numTxBytes]);

		callback(null, {
			template: blobHex,
			hashing: hashing.toString('hex'),
			templateNonceOffset: nonceOffset,
			hashingNonceOffset: nonceOffset - parentHeaderStart,
			prevHash: prevHash
		});
	});
};
