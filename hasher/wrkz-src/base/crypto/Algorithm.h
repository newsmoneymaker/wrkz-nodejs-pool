/* XMRig
 * Copyright (c) 2018      Lee Clagett <https://github.com/vtnerd>
 * Copyright (c) 2018-2021 SChernykh   <https://github.com/SChernykh>
 * Copyright (c) 2016-2021 XMRig       <https://github.com/xmrig>, <support@xmrig.com>
 *
 *   This program is free software: you can redistribute it and/or modify
 *   it under the terms of the GNU General Public License as published by
 *   the Free Software Foundation, either version 3 of the License, or
 *   (at your option) any later version.
 *
 *   This program is distributed in the hope that it will be useful,
 *   but WITHOUT ANY WARRANTY; without even the implied warranty of
 *   MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 *   GNU General Public License for more details.
 *
 *   You should have received a copy of the GNU General Public License
 *   along with this program. If not, see <http://www.gnu.org/licenses/>.
 */

#ifndef XMRIG_ALGORITHM_H
#define XMRIG_ALGORITHM_H


#include <functional>
#include <vector>


// rapidjson stripped: not needed by wrkzhash (no JSON (de)serialization of Algorithm here)
namespace rapidjson { class Value; class Document; }


namespace xmrig {


class Algorithm
{
public:
    // Changes in following file may required if this enum changed:
    //
    // src/backend/opencl/cl/cn/algorithm.cl
    //
    // Id encoding:
    // 1 byte: family
    // 1 byte: L3 memory as power of 2 (if applicable).
    // 1 byte: L2 memory for RandomX algorithms as power of 2, base variant for CryptoNight algorithms or 0x00.
    // 1 byte: extra variant (coin) id.
    enum Id : uint32_t {
        INVALID         = 0,
        CN_0            = 0x63150000,   // "cn/0"             CryptoNight (original).
        CN_1            = 0x63150100,   // "cn/1"             CryptoNight variant 1 also known as Monero7 and CryptoNightV7.
        CN_2            = 0x63150200,   // "cn/2"             CryptoNight variant 2.
        CN_R            = 0x63150272,   // "cn/r"             CryptoNightR (Monero's variant 4).
        CN_FAST         = 0x63150166,   // "cn/fast"          CryptoNight variant 1 with half iterations.
        CN_HALF         = 0x63150268,   // "cn/half"          CryptoNight variant 2 with half iterations (Masari/Torque).
        CN_XAO          = 0x63150078,   // "cn/xao"           CryptoNight variant 0 (modified, Alloy only).
        CN_RTO          = 0x63150172,   // "cn/rto"           CryptoNight variant 1 (modified, Arto only).
        CN_RWZ          = 0x63150277,   // "cn/rwz"           CryptoNight variant 2 with 3/4 iterations and reversed shuffle operation (Graft).
        CN_ZLS          = 0x6315027a,   // "cn/zls"           CryptoNight variant 2 with 3/4 iterations (Zelerius).
        CN_DOUBLE       = 0x63150264,   // "cn/double"        CryptoNight variant 2 with double iterations (X-CASH).
        CN_CCX          = 0x63150063,   // "cn/ccx"           Conceal (CCX)
        CN_LITE_0       = 0x63140000,   // "cn-lite/0"        CryptoNight-Lite variant 0.
        CN_LITE_1       = 0x63140100,   // "cn-lite/1"        CryptoNight-Lite variant 1.
        CN_HEAVY_0      = 0x63160000,   // "cn-heavy/0"       CryptoNight-Heavy (4 MB).
        CN_HEAVY_TUBE   = 0x63160172,   // "cn-heavy/tube"    CryptoNight-Heavy (modified, TUBE only).
        CN_HEAVY_XHV    = 0x63160068,   // "cn-heavy/xhv"     CryptoNight-Heavy (modified, Haven Protocol only).
        CN_PICO_0       = 0x63120200,   // "cn-pico"          CryptoNight-Pico
        CN_PICO_TLO     = 0x63120274,   // "cn-pico/tlo"      CryptoNight-Pico (TLO)
        CN_UPX2         = 0x63110200,   // "cn/upx2"          Uplexa (UPX2)
        CN_GR_0         = 0x63130100,   // "cn/dark"          GhostRider
        CN_GR_1         = 0x63130101,   // "cn/dark-lite"     GhostRider
        CN_GR_2         = 0x63150102,   // "cn/fast"          GhostRider
        CN_GR_3         = 0x63140103,   // "cn/lite"          GhostRider
        CN_GR_4         = 0x63120104,   // "cn/turtle"        GhostRider
        CN_GR_5         = 0x63120105,   // "cn/turtle-lite"   GhostRider
        GHOSTRIDER_RTM  = 0x6c150000,   // "ghostrider"       GhostRider
        YESPOWER_R16    = 0x79170000,   // "yespower-r16"     yespower 1.0, N=4096, r=16, 8 MB (Yenten).
        YESPOWER_TIDE   = 0x79150000,   // "yespowertide"     yespower 1.0, N=2048, r=8, no personalization, 2 MB (Tidecoin).
        // The second byte here (as with every other id above) is log2(memory bytes) for l3()/auto thread-count sizing, NOT the
        // algorithm's "r" parameter -- 128*r*N bytes of smix scratch space: r8 N=2048 -> 2 MB (2^21), r16 N=4096 -> 8 MB (2^23),
        // r32 N=4096 -> 16 MB (2^24). An earlier version of this file used 0x08/0x16/0x32 (the literal r digits, read as hex),
        // which silently starved or over-committed the auto thread count -- found from a real user's Windows run.
        YESCRYPT_R8     = 0x7a150000,   // "yescryptr8"       yescrypt (pwxform), N=2048, r=8, p=1, 2 MB (MateableCoin / MTBC).
        YESCRYPT_R16    = 0x7a170000,   // "yescryptr16"      yescrypt (pwxform), N=4096, r=16, p=1, 8 MB (Fennec / FNNC, Gold Cash / GOLD).
        YESCRYPT_R32    = 0x7a180000,   // "yescryptr32"      yescrypt (pwxform), N=4096, r=32, p=1, 16 MB, pers "WaviBanana" (LuckyPepe / LPEPE).
        FLEX_KCN        = 0x66150000,   // "flex"             Flex: 18 chained SPH/CryptoNight rounds selected by the header's own keccak512, 2 MB scratchpad (Kylacoin). Lyncoin uses its own, not-yet-ported Flex variant -- do not alias it to this id.
        FLEX_LCN        = 0x66150001,   // "flex-lcn"         Flex (Lyncoin's OWN vendored src/crypto/flex/ -- genuinely different cnfn.c/aesb.c/flex.cpp from Kylacoin's, see critical-wrong-randomx-variant-bug). Same 18-round shape as FLEX_KCN but never alias the two together.
        X16RS_HAC       = 0x78010000,   // "x16rs"            X16RS: x16rs_hash(repeat, sha3_256(data)), repeat = min(height/50000+1, 16); no real memory requirement, not Bitcoin Stratum -- see Pool::MODE_HACASH (Hacash).
        RX_0            = 0x72151200,   // "rx/0"             RandomX (reference configuration).
        RX_V2           = 0x72151202,   // "rx/2"             RandomX (Monero v2).
        RX_WOW          = 0x72141177,   // "rx/wow"           RandomWOW (Wownero).
        RX_ARQ          = 0x72121061,   // "rx/arq"           RandomARQ (Arqma).
        RX_GRAFT        = 0x72151267,   // "rx/graft"         RandomGRAFT (Graft).
        RX_SFX          = 0x72151273,   // "rx/sfx"           RandomSFX (Safex Cash).
        RX_YADA         = 0x72151279,   // "rx/yada"          RandomYada (YadaCoin).
        RX_EPIC         = 0x72151257,   // "rx/epic"          RandomX with Wownero instruction frequencies (Epic Cash).
        RX_C64          = 0x72151264,   // "rx/c64"           RandomX variant of C64 Chain.
        RX_XLA          = 0x72151254,   // "rx/xla"           Panthera (DefyX): RandomX variant of Scala, input hash blake2b + yespower + K12.
        RX_SCASH        = 0x72151253,   // "rx/scash"         RandomX with its own Argon2 salt over the 112 byte block header, block valid by the RandomX commitment (Satoshi Cash).
        RX_PP           = 0x72151270,   // "rx/pp"            RandomX with its own Argon2 salt over the 112 byte block header, block valid by the RandomX commitment (PoolPayCoin). Same construction as RX_SCASH, own salt.
        RX_KEVA         = 0x7215126b,   // "rx/keva"          RandomKeva: RandomX with its own Argon2 salt and smaller L2/L3 scratchpad (Kevacoin).
        RX_VEIL         = 0x72151201,   // "rx/veil"          RandomX (reference configuration) over the double SHA-256 of the block header (Veil).
        AR2_CHUKWA      = 0x61130000,   // "argon2/chukwa"    Argon2id (Chukwa).
        AR2_CHUKWA_V2   = 0x61140000,   // "argon2/chukwav2"  Argon2id (Chukwa v2).
        AR2_WRKZ        = 0x61120000,   // "argon2/wrkz"      Argon2id (WRKZ)
        KAWPOW_RVN      = 0x6b0f0000,   // "kawpow/rvn"       KawPow (RVN)
        VERUSHASH       = 0x760e0000,   // "verushash"        VerusHash2.2 (VerusCoin / VRSC). The second byte (0x0e -> 1<<14 = 16 KB, NOT the literal "2.2"
                                        // version this id originally and wrongly used -- see critical-wrong-coin-unit-scale-style lesson, this byte is
                                        // log2(memory bytes) for l3()/auto thread-count sizing, same convention noted on YESPOWER_R16 above) reflects
                                        // VerusHash2.2's real, tiny memory footprint (VERUSKEYSIZE ~8.8 KB, the CLMUL key table) -- it is CPU-bound
                                        // (Haraka+CLMUL), not memory-hard like RandomX/CN. The original 0x32 byte made CpuBackend compute a ~1 PB
                                        // "scratchpad" and hang on first real job -- found+fixed the same session this algorithm was added, see
                                        // vrsc-project.md. Hash function ported+byte-verified against the real node's own
                                        // compiled output (see vrsc-project.md). Wire format is VRSC's real "Equihash-compatible" stratum protocol (see
                                        // vrsc-nodejs-pool's pool.js and EthStratumClient.cpp's VERUSHASH-specific mining.notify/submit branches), NOT classic
                                        // Bitcoin-stratum -- 9 field mining.notify (no coinb1/coinb2/branches, the pool already computed the merkle root),
                                        // mining.set_target instead of set_difficulty, 5 field mining.submit, 140 byte Zcash-style header with a 32 byte nonce
                                        // field (extranonce1+extranonce2 fill it completely) and a separate 1344 byte "solution" (Job::verusSolution(), kept
                                        // outside the shared m_blob -- see Job.h).
        RX_XCB          = 0x43120001,   // "rx/xcb"           "RandomY" (Core Blockchain / XCB, coreblockchain.net): the real RandomX engine, but NOT this
                                        // project's own vendored RandomX (src/crypto/randomx/) and NOT the RANDOM_X family -- RandomY's real
                                        // configuration.h differs from the reference config in more than the Argon2 salt (ArgonIterations,
                                        // ProgramSize, ProgramIterations, ScratchpadL1/L2/L3 all differ too); reconstructing it inside this
                                        // project's own heavily-refactored engine produced a DIFFERENT hash than the real library for the
                                        // standard RandomX README test vector -- a real [[critical-wrong-randomx-variant-bug]] instance caught
                                        // before being wired in (see xcb-project.md). Fixed instead: this coin's own real prebuilt
                                        // go-randomy/librandomx.a, vendored byte-for-byte under src/crypto/xcb_randomy/ with every randomx_*
                                        // symbol renamed xcbrndy_* (objcopy --redefine-syms on the .a itself, not a recompile) to avoid colliding
                                        // with this project's own randomx_* symbols -- see critical-vendored-lib-symbol-collision. Own
                                        // dedicated family (not RANDOM_X) since it bypasses RxQueue/RxCache/RxDataset entirely: a single,
                                        // process-wide, lazily-built cache keyed with the fixed, NEVER-rotated ASCII key "56789" (go-randomy's
                                        // own NewRandomYVMWithKeyAndMutex()), one randomx_vm per CPU worker thread (see CpuWorker's m_xcbVm).
                                        // Hash input is SHA3-512(sealhash(32 bytes) || nonce(8 bytes, native x86 little-endian)) -- real NIST
                                        // SHA3 (OpenSSL EVP_sha3_512, 0x06 padding), NOT this project's other vendored Keccak-512 (0x01 padding)
                                        // -- fed as RandomX's input buffer, matching go-randomy's own RandomY() in vm.go exactly. Verified: (1)
                                        // a real NIST SHA3-512 test vector, (2) the vendored library's own real test vector (randomy_test.go),
                                        // (3) a full end-to-end cross-check of THIS wrapper against a live Go program linked against the SAME
                                        // real go-randomy module (fixed key, 32 zero byte header, nonce=42) -- byte-identical output both ways.
                                        // L3 byte 0x12 (256 KB) is a deliberately small, VERUSHASH-style placeholder for l3()/thread-count
                                        // sizing -- the real ~256 MiB Argon2 cache is ONE SHARED allocation across all threads, not a per-thread
                                        // cost, same reasoning as VERUSHASH's own tiny-footprint byte above. Cache-only (light) mode only for
                                        // now -- FULL_MEM/dataset mode not attempted (would need faithfully reconstructing RandomY's dataset
                                        // addressing too, not just re-vendoring the cache-only path); slower than a full-dataset miner would be,
                                        // but verified-correct, which full-dataset mode is not yet. Wire protocol: a dedicated EthStratumClient
                                        // branch (gated on this exact id, not family) speaking THIS project's own invented eth-getWork-shaped
                                        // mining.notify/submit (5/3 fields respectively) matching xcb-nodejs-pool's pool.js -- see
                                        // EthStratumClient.cpp and Pool.cpp's createClient().
        CN_GPU          = 0x67150001,   // "cn/gpu"           CryptoNight-GPU (Ryo Currency Project's cn_pow_hash_v3 = cn_slow_hash<2 MB, 0xC000
                                        // iterations, version 2>): Conceal (CCX)'s real algorithm since the network's block_major_version 8
                                        // hard fork (LWMA1, CN-GPU, Halving) -- NOT Algorithm::CN_CCX/CRYPTONIGHT_CONCEAL below, which only
                                        // matches the OLD, pre-fork chain (found 2026-10-31 after the local conceal-core source checkout
                                        // turned out to be 6 years stale -- see ccx-project.md). Own dedicated family (top byte 0x67, NOT the
                                        // CN family's 0x63) since it does not fit the templated CnAlgo/CryptoNight_x86.h engine at all: totally
                                        // different explode/implode (keccak-expanded 512 byte blocks, not AES-based), a main loop that is
                                        // almost entirely floating-point division/sqrt (deliberately GPU-favoring, CPU-hostile), and no final
                                        // blake/groestl/jh/skein family-select step (just keccakf -> raw 32 bytes). Vendored verbatim under
                                        // src/crypto/ccx_gpu/ (own namespace ccxgpu, see ccxgpu_rename.h), cross-checked byte-for-byte against
                                        // a pristine build of the same upstream files for 3 test vectors -- see critical-wrong-randomx-variant-bug.
        KRYPTOKRONA_V2  = 0x4b120000,   // "kryptokrona"      Kryptokrona (XKR): real cn_turtle_lite_slow_hash_v2 as used by the coin's own node --
                                        // NOT this project's own Algorithm::CN_PICO_0 ("cn-pico"/"cryptonight-turtle"), despite matching memory
                                        // (256 KB)/iteration(131072)/mask(0x1FFF0) parameters: a real cross-check against the coin's own compiled
                                        // node code showed CN_PICO_0 produces a DIFFERENT hash for the same input -- see
                                        // critical-wrong-randomx-variant-bug and kryptokrona-project.md. Vendored verbatim under
                                        // src/crypto/kryptokrona/ (own xkr_ prefixed symbols, see xkr_rename.h). L3 byte 0x12 (256 KB) matches
                                        // the algorithm's real per-thread scratchpad, unlike VERUSHASH/RX_XCB's placeholder bytes above. Plain
                                        // cryptonote-nodejs-pool wire protocol (blob+target via the generic Client::parseJob(), default 39 byte
                                        // nonce offset) -- no dedicated EthStratumClient/Pool.cpp branch needed, unlike VERUSHASH/RX_XCB.
    };

    enum Family : uint32_t {
        UNKNOWN         = 0,
        CN_ANY          = 0x63000000,
        CN              = 0x63150000,
        CN_LITE         = 0x63140000,
        CN_HEAVY        = 0x63160000,
        CN_PICO         = 0x63120000,
        CN_FEMTO        = 0x63110000,
        RANDOM_X        = 0x72000000,
        ARGON2          = 0x61000000,
        KAWPOW          = 0x6b000000,
        GHOSTRIDER      = 0x6c000000,
        YESPOWER        = 0x79000000,
        YESCRYPT        = 0x7a000000,
        FLEX            = 0x66000000,
        X16RS           = 0x78000000,
        VERUS           = 0x76000000,
        RANDOMY         = 0x43000000,
        KRYPTOKRONA     = 0x4b000000,
        CN_GPU_FAM      = 0x67000000
    };

    static const char *kINVALID;
    static const char *kCN;
    static const char *kCN_0;
    static const char *kCN_1;
    static const char *kCN_2;
    static const char *kCN_R;
    static const char *kCN_FAST;
    static const char *kCN_HALF;
    static const char *kCN_XAO;
    static const char *kCN_RTO;
    static const char *kCN_RWZ;
    static const char *kCN_ZLS;
    static const char *kCN_DOUBLE;
    static const char *kCN_CCX;

#   ifdef XMRIG_ALGO_CN_LITE
    static const char *kCN_LITE;
    static const char *kCN_LITE_0;
    static const char *kCN_LITE_1;
#   endif

#   ifdef XMRIG_ALGO_CN_HEAVY
    static const char *kCN_HEAVY;
    static const char *kCN_HEAVY_0;
    static const char *kCN_HEAVY_TUBE;
    static const char *kCN_HEAVY_XHV;
#   endif

#   ifdef XMRIG_ALGO_CN_PICO
    static const char *kCN_PICO;
    static const char *kCN_PICO_0;
    static const char *kCN_PICO_TLO;
#   endif

#   ifdef XMRIG_ALGO_CN_FEMTO
    static const char *kCN_UPX2;
#   endif

#   ifdef XMRIG_ALGO_RANDOMX
    static const char *kRX;
    static const char *kRX_0;
    static const char* kRX_V2;
    static const char *kRX_WOW;
    static const char *kRX_ARQ;
    static const char *kRX_GRAFT;
    static const char *kRX_SFX;
    static const char *kRX_EPIC;
    static const char *kRX_VEIL;
    static const char *kRX_SCASH;
    static const char *kRX_PP;
    static const char *kRX_XLA;
    static const char *kRX_C64;
    static const char *kRX_KEVA;
    static const char *kRX_YADA;
#   endif

#   ifdef XMRIG_ALGO_ARGON2
    static const char *kAR2;
    static const char *kAR2_CHUKWA;
    static const char *kAR2_CHUKWA_V2;
    static const char *kAR2_WRKZ;
#   endif

#   ifdef XMRIG_ALGO_KAWPOW
    static const char *kKAWPOW;
    static const char *kKAWPOW_RVN;
#   endif

#   ifdef XMRIG_ALGO_GHOSTRIDER
    static const char* kGHOSTRIDER;
    static const char* kGHOSTRIDER_RTM;
#   endif

#   ifdef XMRIG_ALGO_YESPOWER
    static const char* kYESPOWER;
    static const char* kYESPOWER_R16;
    static const char* kYESPOWER_TIDE;
#   endif

#   ifdef XMRIG_ALGO_YESCRYPT
    static const char* kYESCRYPT;
    static const char* kYESCRYPT_R8;
    static const char* kYESCRYPT_R16;
    static const char* kYESCRYPT_R32;
#   endif

#   ifdef XMRIG_ALGO_FLEX
    static const char* kFLEX;
    static const char* kFLEX_KCN;
    static const char* kFLEX_LCN;
#   endif

#   ifdef XMRIG_ALGO_X16RS
    static const char* kX16RS;
    static const char* kX16RS_HAC;
#   endif

#   ifdef XMRIG_ALGO_VERUSHASH
    static const char* kVERUSHASH;
#   endif

#   ifdef XMRIG_ALGO_XCB
    static const char* kRX_XCB;
#   endif

#   ifdef XMRIG_ALGO_KRYPTOKRONA
    static const char* kKRYPTOKRONA_V2;
#   endif

#   ifdef XMRIG_ALGO_CCX_GPU
    static const char* kCN_GPU;
#   endif

    inline Algorithm() = default;
    inline Algorithm(const char *algo) : m_id(parse(algo))  {}
    inline Algorithm(Id id) : m_id(id)                      {}
    Algorithm(uint32_t id);

    static inline constexpr bool isCN(Id id)                { return (id & 0xff000000) == CN_ANY; }
    static inline constexpr Id base(Id id)                  { return isCN(id) ? static_cast<Id>(CN_0 | (id & 0xff00)) : INVALID; }
    static inline constexpr size_t l2(Id id)                { return family(id) == RANDOM_X ? (1U << ((id >> 8) & 0xff)) : 0U; }
    static inline constexpr size_t l3(Id id)                { return 1ULL << ((id >> 16) & 0xff); }
    static inline constexpr uint32_t family(Id id)          { return id & (isCN(id) ? 0xffff0000 : 0xff000000); }

    inline bool isCN() const                                { return isCN(m_id); }
    inline bool isEqual(const Algorithm &other) const       { return m_id == other.m_id; }
    inline bool isValid() const                             { return m_id != INVALID && family() > UNKNOWN; }
    inline Id base() const                                  { return base(m_id); }
    inline Id id() const                                    { return m_id; }
    inline size_t l2() const                                { return l2(m_id); }
    inline uint32_t family() const                          { return family(m_id); }
    // the algorithms that speak Bitcoin's Stratum (mining.subscribe/notify with coinb1/coinb2, see EthStratumClient) and are mined over an 80 byte header
    static inline constexpr bool isBitcoinStratum(Id id)    { return id == GHOSTRIDER_RTM || id == YESPOWER_R16 || id == YESPOWER_TIDE || id == YESCRYPT_R8 || id == YESCRYPT_R16 || id == YESCRYPT_R32 || id == FLEX_KCN || id == FLEX_LCN || id == VERUSHASH; }
    inline bool isBitcoinStratum() const                    { return isBitcoinStratum(m_id); }
    inline uint32_t minIntensity() const                    { return ((m_id == GHOSTRIDER_RTM) ? 8 : 1); };
    inline uint32_t maxIntensity() const                    { return isCN() ? 5 : ((m_id == GHOSTRIDER_RTM) ? 8 : 1); };

    inline size_t l3() const                                { return l3(m_id); }

    inline bool operator!=(Algorithm::Id id) const          { return m_id != id; }
    inline bool operator!=(const Algorithm &other) const    { return !isEqual(other); }
    inline bool operator==(Algorithm::Id id) const          { return m_id == id; }
    inline bool operator==(const Algorithm &other) const    { return isEqual(other); }
    inline operator Algorithm::Id() const                   { return m_id; }

    const char *name() const;

    static Id parse(const char *name);
    static size_t count();
    static std::vector<Algorithm> all(const std::function<bool(const Algorithm &algo)> &filter = nullptr);

private:
    Id m_id = INVALID;
};


using Algorithms = std::vector<Algorithm>;


} /* namespace xmrig */


#endif /* XMRIG_ALGORITHM_H */
