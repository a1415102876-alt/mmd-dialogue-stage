#pragma once

#include <cstddef>

namespace GakumasLocal::PhysicsDiagnostics {
    struct CaptureTraceState {
        bool active{};
        bool available{};
        bool ready{};

        void Reset() {
            active = false;
            available = false;
            ready = false;
        }

        template<typename Trace>
        void Begin(Trace& trace) {
            Reset();
            trace.Start();
        }

        void Opened() {
            active = true;
            available = true;
            ready = false;
        }

        void Closed(bool completed) {
            active = false;
            ready = completed && available;
        }
    };

    void PollCaptureHotkey(void* controller);
    void BeginLateUpdateFrame(void* controller);
    void EndLateUpdateFrame(void* controller);
    void RecordTransformWrite(void* transform, const char* operation,
                              const void* value, std::size_t valueSize);
    void InstallAlgorithmHooks();
    void DumpResolvedPhysicsMetadata();
    void SnapshotSetup(void* initializeData);
}
