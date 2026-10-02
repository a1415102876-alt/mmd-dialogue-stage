#pragma once
#include "SnapshotLayout.hpp"
#include <array>
#include <cstring>
#include <optional>

namespace GakumasLocal::PhysicsDiagnostics {
    struct PlayableHandle64 {
        std::uint64_t pointer{};
        std::uint32_t version{};
        std::uint32_t padding{};
    };
    static_assert(sizeof(PlayableHandle64) == 16);

    inline std::optional<PlayableHandle64> DecodePlayableHandle(const void* bytes, std::size_t size) {
        if (!bytes || size != sizeof(PlayableHandle64)) return std::nullopt;
        PlayableHandle64 handle{};
        std::memcpy(&handle, bytes, sizeof(handle));
        if (!handle.pointer) return std::nullopt;
        return handle;
    }

    inline bool SameNativeArrayHeader(const NativeArrayHeader64& first, const NativeArrayHeader64& second) {
        return first.buffer == second.buffer && first.length == second.length && first.allocator == second.allocator;
    }
}
