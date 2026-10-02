#pragma once

#include <cstddef>
#include <cstdint>
#include <array>
#include <algorithm>
#include <cstring>
#include <vector>
#include "../../deps/minhook/src/hde/hde64.h"

namespace GakumasLocal::PhysicsDiagnostics {
    struct RipRelativeReference {
        std::size_t instructionOffset{};
        std::size_t instructionSize{};
        std::int32_t displacement{};
    };

    enum class NativeReferenceMode { Data, Call, Branch };

    inline bool IsConditionalBranch(const hde64s& instruction) {
        if (!(instruction.flags & F_RELATIVE)) return false;
        if (instruction.opcode >= 0x70 && instruction.opcode <= 0x7f) return true;
        return instruction.opcode == 0x0f && instruction.opcode2 >= 0x80 && instruction.opcode2 <= 0x8f;
    }

    inline bool IsDirectBranch(const hde64s& instruction) {
        if (!(instruction.flags & F_RELATIVE)) return false;
        if (instruction.opcode == 0xe9 || instruction.opcode == 0xeb) return true;
        return IsConditionalBranch(instruction);
    }

    inline std::int32_t BranchDisplacement(const hde64s& instruction) {
        if (instruction.flags & F_IMM32) {
            std::int32_t displacement{};
            std::memcpy(&displacement, &instruction.imm.imm32, sizeof(displacement));
            return displacement;
        }
        return static_cast<std::int8_t>(instruction.imm.imm8);
    }

    inline std::vector<RipRelativeReference> DecodeNativeReferences(
        const std::uint8_t* code, std::size_t size, NativeReferenceMode mode) {
        std::vector<RipRelativeReference> result;
        if (!code) return result;
        for (std::size_t offset = 0; offset < size;) {
            std::array<std::uint8_t, 32> padded{};
            std::copy_n(code + offset, (std::min)(padded.size(), size - offset), padded.data());
            hde64s instruction{};
            hde64_disasm(padded.data(), &instruction);
            if (!instruction.len || instruction.flags & F_ERROR || instruction.len > size - offset) break;
            if (mode == NativeReferenceMode::Call && instruction.opcode == 0xe8 && (instruction.flags & F_RELATIVE)) {
                std::int32_t displacement{};
                std::memcpy(&displacement, &instruction.imm.imm32, sizeof(displacement));
                result.push_back({offset, instruction.len, displacement});
            } else if (mode == NativeReferenceMode::Branch && IsDirectBranch(instruction)) {
                result.push_back({offset, instruction.len, BranchDisplacement(instruction)});
            } else if (mode == NativeReferenceMode::Data && (instruction.flags & F_MODRM) && (instruction.flags & F_DISP32)
                && !instruction.p_67 && instruction.modrm_mod == 0 && instruction.modrm_rm == 5) {
                std::int32_t displacement{};
                std::memcpy(&displacement, &instruction.disp.disp32, sizeof(displacement));
                result.push_back({offset, instruction.len, displacement});
            }
            offset += instruction.len;
        }
        return result;
    }

    inline std::vector<RipRelativeReference> DecodeRipRelativeReferences(const std::uint8_t* code, std::size_t size) {
        return DecodeNativeReferences(code, size, NativeReferenceMode::Data);
    }

    inline std::vector<RipRelativeReference> DecodeDirectCallReferences(const std::uint8_t* code, std::size_t size) {
        return DecodeNativeReferences(code, size, NativeReferenceMode::Call);
    }

    inline std::vector<RipRelativeReference> DecodeDirectBranchReferences(const std::uint8_t* code, std::size_t size) {
        return DecodeNativeReferences(code, size, NativeReferenceMode::Branch);
    }

    inline constexpr std::size_t kSplitBodyRadius = 64 * 1024;
    inline constexpr std::size_t kMaxSplitBranchesPerFunction = 16;

    // The swing prologues end on a conditional jump. Its target is a tiny return epilogue.
    // The particle body is the not-taken fallthrough at the first byte after the unwind range.
    inline std::uintptr_t ConditionalFallthrough(std::uintptr_t entry, const std::uint8_t* code, std::size_t size) {
        if (!entry || !code || !size) return 0;
        std::size_t offset = 0;
        bool conditional = false;
        while (offset < size) {
            std::array<std::uint8_t, 32> padded{};
            std::copy_n(code + offset, (std::min)(padded.size(), size - offset), padded.data());
            hde64s instruction{};
            hde64_disasm(padded.data(), &instruction);
            if (!instruction.len || (instruction.flags & F_ERROR) || instruction.len > size - offset) return 0;
            conditional = IsConditionalBranch(instruction);
            offset += instruction.len;
        }
        return conditional ? entry + size : 0;
    }

    // Direct JMP/Jcc targets outside the captured bytes but within 64 KiB of the entry,
    // plus the fallthrough when the captured range itself ends on a conditional branch.
    inline std::vector<std::uintptr_t> CollectSplitBodyTargets(
        std::uintptr_t entry, const std::uint8_t* code, std::size_t size,
        std::size_t radius = kSplitBodyRadius, std::size_t limit = kMaxSplitBranchesPerFunction) {
        std::vector<std::uintptr_t> result;
        if (!entry || !code || !size || !limit) return result;
        if (const auto fallthrough = ConditionalFallthrough(entry, code, size)) {
            if (fallthrough - entry <= radius) result.push_back(fallthrough);
        }
        for (const auto& reference : DecodeDirectBranchReferences(code, size)) {
            if (result.size() >= limit) break;
            const auto instruction = entry + reference.instructionOffset;
            const auto target = static_cast<std::uintptr_t>(
                static_cast<std::intptr_t>(instruction + reference.instructionSize) + reference.displacement);
            if (target >= entry && target < entry + size) continue;
            const auto distance = target > entry ? target - entry : entry - target;
            if (distance > radius) continue;
            if (std::find(result.begin(), result.end(), target) != result.end()) continue;
            result.push_back(target);
        }
        return result;
    }
}
