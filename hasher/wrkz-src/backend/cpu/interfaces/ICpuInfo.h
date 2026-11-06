// Minimal stub: wrkzhash never calls into real CPU-feature detection (it always takes the portable
// SOFT_AES=true single-hash path). This satisfies CryptoNight_x86.h's syntax for a template branch
// (cryptonight_double_hash's ARCH_ZEN3 check) that is never instantiated by wrkzhash.cpp.
#ifndef XMRIG_ICPUINFO_H
#define XMRIG_ICPUINFO_H
namespace xmrig {
class ICpuInfo {
public:
    enum Arch { ARCH_UNKNOWN, ARCH_ZEN3 };
    virtual Arch arch() const { return ARCH_UNKNOWN; }
    virtual int assembly() const { return 0; }
};
}
#endif
