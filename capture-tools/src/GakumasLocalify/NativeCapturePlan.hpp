#pragma once

#include <algorithm>
#include <cstddef>
#include <cstdint>
#include <deque>
#include <unordered_set>

namespace GakumasLocal::PhysicsDiagnostics {
    inline constexpr unsigned kNativeHelperMaxDepth = 3;

    inline constexpr unsigned kMaxSplitBodyHops = 2;
    inline constexpr unsigned kMaxCallLevel = 16;
    inline constexpr std::uintptr_t kLocalCallRadius = 64 * 1024;

    // Continuations discovered at the depth cap still need their direct calls.
    // Those calls stay at the same depth and do not extend the call chain again.
    inline bool ShouldEnqueueCalls(unsigned depth, unsigned hop) {
        return depth < kNativeHelperMaxDepth || (hop > 0 && depth <= kNativeHelperMaxDepth);
    }

    inline unsigned NextCallDepth(unsigned depth) {
        return depth < kNativeHelperMaxDepth ? depth + 1 : depth;
    }

    // Calls taken from a depth-cap continuation start at level 1.
    // Bounded callees keep their direct calls until the level cap, so one capture closes the chain.
    inline unsigned NextCallLevel(unsigned depth, unsigned hop) {
        return hop > 0 && depth >= kNativeHelperMaxDepth ? 1u : 0u;
    }

    inline bool ShouldFollowBoundedCallee(unsigned callLevel, bool unwindBounded) {
        return callLevel >= 1 && callLevel < kMaxCallLevel && unwindBounded;
    }

    // A normal call that has already reached depth 3 still keeps its own direct calls.
    inline bool ShouldFollowDepthCapCallee(unsigned depth, unsigned hop, unsigned callLevel, bool unwindBounded) {
        return depth == kNativeHelperMaxDepth && hop == 0 && callLevel == 0 && unwindBounded;
    }

    inline bool ShouldFollowLocalUnboundedCallee(unsigned callLevel, bool unwindBounded) {
        return callLevel >= 1 && callLevel < kMaxCallLevel && !unwindBounded;
    }

    inline bool IsWithinCallRadius(std::uintptr_t entry, std::uintptr_t target,
                                   std::uintptr_t radius = kLocalCallRadius) {
        if (!entry || !target) return false;
        const auto distance = target > entry ? target - entry : entry - target;
        return distance <= radius;
    }

    struct NativeHelperTarget {
        std::uintptr_t address{};
        unsigned depth{};
        std::uintptr_t source{};
        unsigned hop{};
        unsigned callLevel{};
    };

    class NativeHelperQueue {
        std::deque<NativeHelperTarget> pending;
        std::unordered_set<std::uintptr_t> seen;
        std::size_t limit;
        std::size_t dropped{};
    public:
        explicit NativeHelperQueue(std::size_t capacity = 131072) : limit(capacity) {}

        bool Enqueue(std::uintptr_t address, unsigned depth, std::uintptr_t source, unsigned hop = 0, unsigned callLevel = 0) {
            if (!address || depth > kNativeHelperMaxDepth || hop > kMaxSplitBodyHops
                || callLevel > kMaxCallLevel || seen.count(address)) return false;
            if (seen.size() >= limit) {
                ++dropped;
                return false;
            }
            seen.insert(address);
            pending.push_back({address, depth, source, hop, callLevel});
            return true;
        }

        bool Pop(NativeHelperTarget& target) {
            if (pending.empty()) return false;
            target = pending.front();
            pending.pop_front();
            return true;
        }

        std::size_t Pending() const { return pending.size(); }
        std::size_t Dropped() const { return dropped; }

        void Clear() {
            pending.clear();
            seen.clear();
            dropped = 0;
        }
    };

    inline std::size_t NativeHelperReadSize(std::uintptr_t entry, std::uintptr_t begin,
                                          std::uintptr_t end, std::size_t available) {
        constexpr std::size_t cap = 64 * 1024;
        if (begin <= entry && end > entry) {
            return (std::min)(available, (std::min)(static_cast<std::size_t>(end - entry), cap));
        }
        return (std::min)(available, cap);
    }

    inline std::size_t NativeContinuationReadSize(std::uintptr_t entry, std::uintptr_t begin,
                                                  std::uintptr_t end, std::size_t available) {
        constexpr std::size_t cap = 64 * 1024;
        if (begin <= entry && end > entry) {
            return (std::min)(available, (std::min)(static_cast<std::size_t>(end - entry), cap));
        }
        return (std::min)(available, cap);
    }

    inline std::size_t NativeScanSize(std::uintptr_t entry, std::uintptr_t begin,
                                      std::uintptr_t end, std::size_t available) {
        if (begin != entry || end <= begin) return available;
        return (std::min)(available, static_cast<std::size_t>(end - begin));
    }
}
