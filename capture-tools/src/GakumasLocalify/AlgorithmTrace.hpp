#pragma once

#include <array>
#include <atomic>
#include <cstddef>
#include <cstdint>
#include <mutex>
#include <vector>

namespace GakumasLocal::PhysicsDiagnostics {
    enum class AlgorithmMethod : std::size_t {
        ProcessQuartz, ProcessSwing, QuartzSkirt, QuartzHair, QuartzPoncho, ProcessAnimation, Count
    };

    inline constexpr std::array<const char*, static_cast<std::size_t>(AlgorithmMethod::Count)> AlgorithmNames{
        "ProcessQuartzDriver", "ProcessSwingSkeleton", "QuartzSkirtJob.Execute",
        "QuartzHairJob.Execute", "QuartzPonchoJob.Execute", "ProcessAnimation"
    };

    struct AlgorithmEvent {
        std::uint64_t captureId{};
        std::uint64_t callId{};
        AlgorithmMethod method{};
        bool exit{};
        std::uintptr_t self{}, stream{}, methodInfo{};
        std::uint32_t thread{};
        std::uint64_t timestamp{};
    };

    struct AlgorithmLifetime {
        std::uint64_t entries{}, exits{};
    };

    struct AlgorithmSnapshot {
        std::vector<AlgorithmEvent> events;
        std::array<std::uint64_t, AlgorithmNames.size()> completed{};
        std::uint64_t dropped{};
    };

    template<std::size_t Capacity = 16384>
    class AlgorithmTrace {
        std::mutex mutex;
        std::atomic_bool active{false};
        std::array<std::atomic<std::uint64_t>, AlgorithmNames.size()> entries{};
        std::array<std::atomic<std::uint64_t>, AlgorithmNames.size()> exits{};
        std::array<AlgorithmEvent, Capacity> events{};
        std::array<std::uint64_t, AlgorithmNames.size()> completed{};
        std::size_t size{};
        std::uint64_t generation{}, sequence{}, dropped{};

    public:
        void Start() {
            std::lock_guard lock(mutex);
            ++generation;
            size = 0;
            dropped = 0;
            completed.fill(0);
            active.store(true, std::memory_order_release);
        }

        void Stop() {
            std::lock_guard lock(mutex);
            active.store(false, std::memory_order_release);
        }

        AlgorithmEvent Begin(AlgorithmMethod method, std::uintptr_t self, std::uintptr_t stream,
                             std::uintptr_t methodInfo, std::uint32_t thread, std::uint64_t timestamp) {
            entries[static_cast<std::size_t>(method)].fetch_add(1, std::memory_order_relaxed);
            if (!active.load(std::memory_order_acquire)) return {};
            std::lock_guard lock(mutex);
            if (!active.load(std::memory_order_relaxed)) return {};
            if (size == Capacity) { ++dropped; return {}; }
            AlgorithmEvent event{generation, ++sequence, method, false, self, stream, methodInfo, thread, timestamp};
            events[size++] = event;
            return event;
        }

        void End(AlgorithmMethod method, AlgorithmEvent event, std::uint32_t thread, std::uint64_t timestamp) {
            exits[static_cast<std::size_t>(method)].fetch_add(1, std::memory_order_relaxed);
            if (!event.callId || !active.load(std::memory_order_acquire)) return;
            std::lock_guard lock(mutex);
            if (!active.load(std::memory_order_relaxed) || event.captureId != generation
                || event.method != method || event.thread != thread) return;
            if (size == Capacity) { ++dropped; return; }
            event.exit = true;
            event.timestamp = timestamp;
            events[size++] = event;
            ++completed[static_cast<std::size_t>(method)];
        }

        AlgorithmSnapshot Snapshot() {
            std::lock_guard lock(mutex);
            return {{events.begin(), events.begin() + size}, completed, dropped};
        }

        AlgorithmLifetime Lifetime(AlgorithmMethod method) const {
            const auto index = static_cast<std::size_t>(method);
            return {entries[index].load(std::memory_order_relaxed), exits[index].load(std::memory_order_relaxed)};
        }
    };
}
