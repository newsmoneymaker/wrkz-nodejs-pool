# wrkzhash: cn/upx2 (CryptoNight-UPX2) share validation helper of the WRKZ pool.
# Sources in wrkz-src/ are vendored verbatim from poolpayminer's own crypto/cn/ + base/crypto/ +
# base/tools/cryptonote/ (Algorithm::CN_UPX2), stripped of the generic CnHash CPU-dispatch/VirtualMemory
# machinery (not needed: wrkzhash.cpp always uses the portable SOFT_AES=true path, byte-identical to the
# AES-NI path by construction -- same CryptoNight spec, see wrkzhash.cpp's own header comment). Using
# poolpayminer's own copy (rather than re-vendoring from WrkzCoin's node, which only ships a prebuilt
# binary with no public source tree on srv5) keeps the pool's share check and the real miner's PoW
# guaranteed identical by construction. Verified against poolpayminer's own shipped self-test vector
# (test_input[0:76] -> test_output_femto_upx2, see CryptoNight_test.h) before this was trusted.
#
# No symbol renaming needed (unlike poolpayminer itself, which vendors MANY coins' crypto in one binary):
# this is a single, standalone CN/upx2-only tree with nothing else to collide with.
#   make            (STATIC=-static makes a binary that runs on any Linux)
CXX ?= g++
CC ?= gcc
STATIC ?=

WRKZ_DIR = wrkz-src
ISA_FLAGS = -maes -msse2 -msse4.1 -mssse3

C_SOURCES = crypto/cn/c_blake256.c crypto/cn/c_groestl.c crypto/cn/c_jh.c crypto/cn/c_skein.c
C_OBJS = $(addprefix $(WRKZ_DIR)/,$(C_SOURCES:.c=.o))

CXX_SOURCES = base/crypto/keccak.cpp
CXX_OBJS = $(addprefix $(WRKZ_DIR)/,$(CXX_SOURCES:.cpp=.o))

DEFINES = -DHAVE_ROTR -DHAVE_POSIX_MEMALIGN -DRAPIDJSON_SSE2 -DRAPIDJSON_WRITE_DEFAULT_FLAGS=6 \
          -DXMRIG_64_BIT -DXMRIG_ALGO_CN_FEMTO -DXMRIG_ALGO_CN_PICO -DXMRIG_ALGO_CN_LITE -DXMRIG_ALGO_CN_HEAVY \
          -DXMRIG_FEATURE_SSE4_1 -DXMRIG_OS_LINUX -DXMRIG_OS_UNIX -D_GNU_SOURCE -D__STDC_FORMAT_MACROS

CFLAGS = -O2 -w -std=gnu11 $(ISA_FLAGS) $(DEFINES) -I$(WRKZ_DIR)
CXXFLAGS_VENDORED = -O2 -w $(ISA_FLAGS) -std=c++11 $(DEFINES) -I$(WRKZ_DIR)
CXXFLAGS = -Wall -fexceptions -fno-rtti -Wno-strict-aliasing -Wno-class-memaccess -O2 -std=c++11 \
           $(ISA_FLAGS) $(DEFINES) -include $(WRKZ_DIR)/base/tools/cryptonote/umul128.h -I$(WRKZ_DIR)

wrkzhash: wrkzhash.o $(C_OBJS) $(CXX_OBJS)
	$(CXX) -O2 $(STATIC) -o $@ wrkzhash.o $(C_OBJS) $(CXX_OBJS) -lpthread

wrkzhash.o: wrkzhash.cpp
	$(CXX) $(CXXFLAGS) -c -o $@ $<

$(WRKZ_DIR)/%.o: $(WRKZ_DIR)/%.c
	$(CC) $(CFLAGS) -c -o $@ $<

$(WRKZ_DIR)/%.o: $(WRKZ_DIR)/%.cpp
	$(CXX) $(CXXFLAGS_VENDORED) -c -o $@ $<

clean:
	rm -f wrkzhash wrkzhash.o $(C_OBJS) $(CXX_OBJS)
