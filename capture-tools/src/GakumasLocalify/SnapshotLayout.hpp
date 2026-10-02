#pragma once

#include <cstddef>
#include <cstdint>
#include <optional>

namespace GakumasLocal::PhysicsDiagnostics {

enum class SnapshotStorage { ManagedObject, InlineValue };

inline std::optional<std::size_t> FieldMemoryOffset(std::size_t metadataOffset,
    std::size_t size, std::size_t fieldSize, SnapshotStorage storage) {
    constexpr std::size_t objectHeaderSize = 16;
    if (metadataOffset < objectHeaderSize || fieldSize == 0) return std::nullopt;
    const auto offset = storage == SnapshotStorage::InlineValue
        ? metadataOffset - objectHeaderSize : metadataOffset;
    if (offset > size || fieldSize > size - offset) return std::nullopt;
    return offset;
}

struct NativeArrayHeader64 {
    std::uint64_t buffer;
    std::int32_t length;
    std::int32_t allocator;
};

static_assert(sizeof(NativeArrayHeader64) == 16);

// NativeList<T> is an eight-byte wrapper around an UnsafeList<T>*.
// The pointed-to header starts with the element buffer, length and capacity.
struct NativeListHeader64 {
    std::uint64_t listData;
};

struct UnsafeListHeader64 {
    std::uint64_t buffer;
    std::int32_t length;
    std::int32_t capacity;
};

static_assert(sizeof(NativeListHeader64) == 8);
static_assert(sizeof(UnsafeListHeader64) == 16);

inline bool ValidNativeArrayRange(const NativeArrayHeader64& header, std::size_t stride) {
    if (stride == 0 || stride > 4096 || header.length < 0 || header.length > 4096) return false;
    const auto bytes = static_cast<std::uint64_t>(header.length) * stride;
    return bytes <= 1024 * 1024 && (bytes == 0 || header.buffer != 0)
        && header.buffer <= UINT64_MAX - bytes;
}

inline bool ValidNativeListRange(const UnsafeListHeader64& header, std::size_t stride) {
    if (stride == 0 || stride > 4096 || header.length < 0 || header.capacity < 0
        || header.length > header.capacity || header.capacity > 4096) return false;
    const auto bytes = static_cast<std::uint64_t>(header.length) * stride;
    return bytes <= 1024 * 1024 && (bytes == 0 || header.buffer != 0)
        && header.buffer <= UINT64_MAX - bytes;
}

}
