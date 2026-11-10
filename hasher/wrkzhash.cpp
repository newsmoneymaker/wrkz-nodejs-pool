// wrkzhash: share validation helper of the WrkzCoin (WRKZ) pool.
// Calls poolpayminer's OWN cn/upx2 (Algorithm::CN_UPX2) implementation directly (src/crypto/cn/ in the
// poolpayminer tree), stripped of the generic CnHash dispatch/CPU-feature-detection machinery (which this
// verifier does not need: SOFT_AES=true is used, a portable path that is byte-identical to the AES-NI path
// by construction -- same algorithm, same CryptoNight spec, just a different way of computing AES rounds).
// This keeps the pool's share check and the real miner's PoW guaranteed identical by construction (same
// source, not a second independent vendoring) -- see critical-wrong-randomx-variant-bug.md and the same
// pattern already used by ccxhash.cpp (Conceal) and xkrhash.cpp (Kryptokrona).
//
// Reads commands on stdin, writes answers on stdout (one line each):
//   H <id> <hex>   the exact blob bytes WRKZ's own cn/upx2 hashes (nonce already spliced in);
//                  answers "H <id> <64 hex>" (32 byte hash) or "H <id> err"
//   Q              quit
// Command line: --hash <hex> prints the hash.
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <cstdint>
#include <vector>

#include "crypto/cn/CnAlgo.h"
#include "crypto/common/Assembly.h"
#include "crypto/cn/CryptoNight.h"
#include "crypto/cn/CryptoNight_monero.h"
#include "crypto/cn/CryptoNight_x86.h"
#include "base/crypto/keccak.h"

// CnHash.cpp's own global, consulted only by the CN_GR_* branch (dead code for CN_UPX2 with SOFT_AES=true,
// but the symbol must still resolve at link time) -- not linking CnHash.cpp itself (full CPU-dispatch table,
// not needed here).
bool cn_sse41_enabled = false;

using namespace xmrig;

static int hexval(int c)
{
	if (c >= '0' && c <= '9') return c - '0';
	if (c >= 'a' && c <= 'f') return c - 'a' + 10;
	if (c >= 'A' && c <= 'F') return c - 'A' + 10;
	return -1;
}

static int from_hex(const char *s, std::vector<unsigned char> &out)
{
	size_t n = strlen(s);
	if (n % 2) return -1;
	out.resize(n / 2);
	for (size_t i = 0; i < out.size(); i++) {
		int a = hexval(s[2 * i]), b = hexval(s[2 * i + 1]);
		if (a < 0 || b < 0) return -1;
		out[i] = (unsigned char)(a * 16 + b);
	}
	return 0;
}

static void to_hex(const unsigned char *in, size_t n, char *out)
{
	static const char d[] = "0123456789abcdef";
	for (size_t i = 0; i < n; i++) { out[2 * i] = d[in[i] >> 4]; out[2 * i + 1] = d[in[i] & 15]; }
	out[2 * n] = 0;
}

// Minimal cryptonight_ctx setup: no huge pages, no JIT-compiled mainloop (generated_code is only
// consulted for the "cn/r" variant family, which CN_UPX2 is not -- see CnAlgo<CN_UPX2>'s specialization
// in poolpayminer's own CnAlgo.h, only iterations()/mask() are overridden, isR() stays false).
static cryptonight_ctx *allocCtx()
{
	constexpr size_t MEM = CnAlgo<Algorithm::CN_UPX2>().memory();
	auto *ctx = static_cast<cryptonight_ctx *>(malloc(sizeof(cryptonight_ctx)));
	memset(ctx, 0, sizeof(cryptonight_ctx));
	void *mem = nullptr;
	if (posix_memalign(&mem, 4096, MEM)) { fprintf(stderr, "alloc failed\n"); exit(2); }
	ctx->memory = static_cast<uint8_t *>(mem);
	ctx->generated_code = nullptr;
	ctx->generated_code_data.algo = -1;
	ctx->generated_code_data.height = UINT64_MAX;
	return ctx;
}

static void wrkzHash(const std::vector<unsigned char> &data, unsigned char hash[32], cryptonight_ctx *ctxSingle)
{
	cryptonight_ctx *ctxArr[1] = { ctxSingle };
	cryptonight_single_hash<Algorithm::CN_UPX2, true, 0>(data.data(), data.size(), hash, ctxArr, 0);
}

int main(int argc, char **argv)
{
	unsigned char hash[32];
	char hex[65];
	std::vector<unsigned char> data;
	cryptonight_ctx *ctx = allocCtx();

	if (argc == 3 && strcmp(argv[1], "--hash") == 0) {
		if (from_hex(argv[2], data)) { fprintf(stderr, "bad hex\n"); return 1; }
		wrkzHash(data, hash, ctx);
		to_hex(hash, 32, hex);
		puts(hex);
		return 0;
	}

	if (argc == 3 && strcmp(argv[1], "--fast-hash") == 0) {
		if (from_hex(argv[2], data)) { fprintf(stderr, "bad hex\n"); return 1; }
		xmrig::keccak(data.data(), static_cast<int>(data.size()), hash, 32);
		to_hex(hash, 32, hex);
		puts(hex);
		return 0;
	}

	char line[8192];
	while (fgets(line, sizeof(line), stdin)) {
		if (line[0] == 'Q') break;
		if (line[0] != 'H' && line[0] != 'F') continue;
		char id[64], hexdata[8000];
		if (sscanf(line, "%*c %63s %7999s", id, hexdata) != 2 || from_hex(hexdata, data)) {
			printf("%c %s err\n", line[0], (strlen(line) > 2) ? id : "0");
			fflush(stdout);
			continue;
		}
		if (line[0] == 'H') {
			wrkzHash(data, hash, ctx);
		} else {
			xmrig::keccak(data.data(), static_cast<int>(data.size()), hash, 32);
		}
		to_hex(hash, 32, hex);
		printf("%c %s %s\n", line[0], id, hex);
		fflush(stdout);
	}
	return 0;
}
