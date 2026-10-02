#include "../src/GakumasLocalify/AlgorithmTrace.hpp"
#include <Windows.h>
#include <MinHook.h>
#include <array>
#include <cassert>
#include <iostream>

using namespace GakumasLocal::PhysicsDiagnostics;

struct StreamValue { std::array<std::uint64_t, 7> words; };
struct JobState { StreamValue received{}; void* metadata{}; unsigned int calls{}; };

__declspec(noinline) void GameStyleJob(void* self, StreamValue stream, void* metadata) {
    auto& job = *static_cast<JobState*>(self);
    job.received = stream;
    job.metadata = metadata;
    ++job.calls;
}

using PointerAbi = void (*)(void*, void*, void*);
PointerAbi original{};
AlgorithmTrace<16> trace;

void Hook(void* self, void* stream, void* metadata) {
    const auto token = trace.Begin(AlgorithmMethod::QuartzSkirt, reinterpret_cast<std::uintptr_t>(self),
        reinterpret_cast<std::uintptr_t>(stream), reinterpret_cast<std::uintptr_t>(metadata),
        GetCurrentThreadId(), GetTickCount64());
    original(self, stream, metadata);
    trace.End(AlgorithmMethod::QuartzSkirt, token, GetCurrentThreadId(), GetTickCount64());
}

int main() {
    static_assert(sizeof(StreamValue) == 56);
    JobState job;
    StreamValue stream{{11, 22, 33, 44, 55, 66, 77}};
    void* metadata = &stream;
    auto target = &GameStyleJob;
    assert(MH_Initialize() == MH_OK);
    assert(MH_CreateHook(reinterpret_cast<void*>(target), reinterpret_cast<void*>(&Hook),
        reinterpret_cast<void**>(&original)) == MH_OK);
    assert(MH_EnableHook(reinterpret_cast<void*>(target)) == MH_OK);
    trace.Start();
    target(&job, stream, metadata);
    trace.Stop();
    assert(job.calls == 1);
    assert(job.received.words == stream.words);
    assert(job.metadata == metadata);
    assert(trace.Snapshot().events.size() == 2);
    assert(trace.Snapshot().completed[static_cast<std::size_t>(AlgorithmMethod::QuartzSkirt)] == 1);
    assert(MH_DisableHook(reinterpret_cast<void*>(target)) == MH_OK);
    target(&job, stream, metadata);
    assert(job.calls == 2);
    assert(trace.Lifetime(AlgorithmMethod::QuartzSkirt).entries == 1);
    assert(MH_RemoveHook(reinterpret_cast<void*>(target)) == MH_OK);
    assert(MH_Uninitialize() == MH_OK);
    std::cout << "native x64 MinHook: 56-byte value argument, self, MethodInfo forwarding and original call passed\n";
}
