/**
 * WrkzCoin (WRKZ) Pool (based on cryptonote-nodejs-pool, GPL-2.0)
 *
 * Builds the job + submission data from a raw `blocktemplate_blob` -- replaces the Kryptokrona
 * template's SSH-to-the-node-source `blobtool` helper (not possible here: WrkzCoin's daemon on srv5
 * is only a prebuilt binary, no node source tree on that server at all -- see wrkz-project.md).
 *
 * WrkzCoin's block template is NOT the simple "header + nonce" shape some newer CryptoNote forks use.
 * Reverse-engineering the real blob confirmed (bytes[0]=major_version, bytes[1]=minor_version,
 * bytes[2:34]=prev_id, then a nested "parent block" style sub-header: majorVersion(varint, observed
 * always 0x00), minorVersion(varint, observed always 0x00), timestamp(varint, ~5 bytes for any
 * plausible real-world timestamp), prev_id again (32 bytes, observed all-zero -- a placeholder, not a
 * copy of the outer prev_id), **the real PoW nonce (4 bytes) right here**, then more structure (a
 * small region that looks like "numberOfTransactions" plus the parent block's own placeholder
 * transaction/branch data for a merge-mining mechanism this coin's pool has never actually used) before
 * the REAL miner transaction (with the real block reward output) and the real block's own transaction
 * hash list.
 *
 * The nonce position (byte offset 73 -- stable: major/minor/parent-major/parent-minor are always
 * 1-byte varints in practice, prev_id is a fixed 32 bytes, and the timestamp varint is a stable 5
 * bytes for any timestamp between ~1992 and ~3057) was confirmed empirically: at that position the
 * daemon always hands back the 4 all-zero bytes a template's nonce field should have before anyone
 * has mined it, with a believable Unix timestamp decoding cleanly right before it -- cross-checked on
 * multiple independently-fetched templates.
 *
 * **Known, stated limitation** (see wrkz-project.md, read before touching this again): the exact
 * byte-for-byte content of the nested "parent block" merge-mining placeholder region PAST the nonce
 * (what a from-source build would call getParentBlockHashingBinaryArray) was NOT independently,
 * byte-for-byte verified against WrkzCoin's own source (no source tree available locally; the public
 * GitHub repo's current `master` branch structure didn't resolve cleanly against this exact prebuilt
 * 0.4.0.220 binary's real wire bytes in the time available, and this daemon's own `submitblock` gives
 * the same generic "Block not accepted" error for both a malformed blob and a correctly-formed one
 * that simply doesn't meet difficulty, so it can't be used to validate this by trial and error either).
 * To stay safe, this file does NOT attempt to reconstruct a separate, shorter "true" consensus hashing
 * blob at all -- `hashing` and `template` below are the SAME bytes (the entire, untouched
 * `blocktemplate_blob` the daemon gave us, nonce spliced in at the one position that IS confirmed).
 * This is self-consistent (the pool's own share-difficulty accounting only ever needs to hash the same
 * bytes the same way every time, which this does) and submission-safe (a found block is submitted as
 * the daemon's own blob with only the nonce changed -- nothing is reconstructed for that path either).
 * The one thing this does NOT guarantee is that the pool's own PoW check runs over the exact bytes the
 * real network hashes -- so a share that looks like a genuine network-difficulty block to this pool
 * might not actually be accepted by `submitblock`. Payments stay `dryRun: true` regardless of this
 * until a real block is found and rehearsed end to end (standard policy anyway) -- if/when that
 * happens and a submission is ever rejected, get WrkzCoin's real source at the exact commit/tag this
 * binary was built from (ask the user; check for a VERSION/build-info string in the binary, or just
 * `wrkz-wallet-api --version` / the daemon's own `/info`'s `"version"` field as a starting point) and
 * revisit this file properly rather than guessing further.
 *
 * run(blobHex, cb)  cb(err, {template, hashing, templateNonceOffset, hashingNonceOffset, prevHash})
 **/
const NONCE_OFFSET = 73;   // bytes; see header comment -- empirically confirmed, not guessed

exports.run = function (blobHex, callback) {
	if (typeof blobHex !== 'string' || blobHex.length < (NONCE_OFFSET + 4) * 2) {
		return callback(new Error('block template too short (' + (blobHex && blobHex.length) + ' hex chars)'));
	}
	let prevHash = blobHex.slice(4, 4 + 64);   // bytes[2:34], the outer prev_id -- matches getlastblockheader's tip hash

	callback(null, {
		template: blobHex,
		hashing: blobHex,
		templateNonceOffset: NONCE_OFFSET,
		hashingNonceOffset: NONCE_OFFSET,
		prevHash: prevHash
	});
};
