// Minimal stub, see ICpuInfo.h's header comment.
#ifndef XMRIG_CPU_H
#define XMRIG_CPU_H
#include "backend/cpu/interfaces/ICpuInfo.h"
namespace xmrig {
class Cpu {
public:
    static ICpuInfo *info() { static ICpuInfo i; return &i; }
};
}
#endif
