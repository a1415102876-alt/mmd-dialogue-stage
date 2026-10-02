#include "../src/GakumasLocalify/AlgorithmTrace.hpp"
#include "../src/GakumasLocalify/PhysicsDiagnostics.hpp"
#include <cassert>
#include <iostream>
#include <thread>
#include <vector>

using namespace GakumasLocal::PhysicsDiagnostics;

int main() {
    CaptureTraceState lifecycle;
    AlgorithmTrace<16> lifecycleTrace;
    lifecycle.Begin(lifecycleTrace);
    assert(!lifecycle.active);
    assert(!lifecycle.available);
    assert(!lifecycle.ready);
    const auto lifecycleToken = lifecycleTrace.Begin(AlgorithmMethod::QuartzHair, 1, 2, 3, 4, 5);
    lifecycleTrace.End(AlgorithmMethod::QuartzHair, lifecycleToken, 4, 6);
    assert(lifecycleTrace.Snapshot().events.size() == 2);
    lifecycle.Opened();
    assert(lifecycle.active);
    assert(lifecycle.available);
    assert(!lifecycle.ready);
    lifecycle.Closed(true);
    assert(!lifecycle.active);
    assert(lifecycle.available);
    assert(lifecycle.ready);

    CaptureTraceState failedLifecycle;
    AlgorithmTrace<16> failedTrace;
    failedLifecycle.Begin(failedTrace);
    failedLifecycle.Opened();
    failedLifecycle.Closed(false);
    assert(!failedLifecycle.active);
    assert(failedLifecycle.available);
    assert(!failedLifecycle.ready);

    AlgorithmTrace<16> trace;
    const auto inactive = trace.Begin(AlgorithmMethod::QuartzHair, 10, 20, 30, 1, 100);
    trace.End(AlgorithmMethod::QuartzHair, inactive, 1, 101);
    assert(trace.Snapshot().events.empty());
    assert(trace.Lifetime(AlgorithmMethod::QuartzHair).entries == 1);
    trace.Start();
    const auto first = trace.Begin(AlgorithmMethod::QuartzHair, 10, 20, 30, 1, 102);
    const auto second = trace.Begin(AlgorithmMethod::QuartzHair, 10, 20, 30, 2, 103);
    trace.End(AlgorithmMethod::QuartzHair, second, 2, 104);
    trace.End(AlgorithmMethod::QuartzHair, first, 1, 105);
    trace.Stop();
    auto snapshot = trace.Snapshot();
    assert(snapshot.events.size() == 4);
    assert(snapshot.events[0].callId != snapshot.events[1].callId);
    assert(snapshot.events[0].callId == snapshot.events[3].callId);
    assert(snapshot.completed[static_cast<std::size_t>(AlgorithmMethod::QuartzHair)] == 2);
    trace.Start();
    trace.End(AlgorithmMethod::QuartzHair, first, 1, 106);
    assert(trace.Snapshot().events.empty());
    trace.Stop();
    AlgorithmTrace<2> bounded;
    bounded.Start();
    const auto accepted = bounded.Begin(AlgorithmMethod::QuartzSkirt, 1, 2, 3, 4, 5);
    bounded.End(AlgorithmMethod::QuartzSkirt, accepted, 4, 6);
    const auto dropped = bounded.Begin(AlgorithmMethod::QuartzSkirt, 1, 2, 3, 4, 7);
    bounded.End(AlgorithmMethod::QuartzSkirt, dropped, 4, 8);
    bounded.Stop();
    assert(bounded.Snapshot().events.size() == 2);
    assert(bounded.Snapshot().dropped > 0);
    assert(bounded.Snapshot().completed[static_cast<std::size_t>(AlgorithmMethod::QuartzSkirt)] == 1);
    AlgorithmTrace<2048> concurrent;
    concurrent.Start();
    std::vector<std::thread> workers;
    for (unsigned int thread = 1; thread <= 4; ++thread) {
        workers.emplace_back([&concurrent, thread] {
            for (unsigned int index = 0; index < 100; ++index) {
                const auto token = concurrent.Begin(AlgorithmMethod::QuartzPoncho, 1, 2, 3, thread, index);
                concurrent.End(AlgorithmMethod::QuartzPoncho, token, thread, index + 1);
            }
        });
    }
    for (auto& worker : workers) worker.join();
    concurrent.Stop();
    assert(concurrent.Snapshot().events.size() == 800);
    assert(concurrent.Snapshot().completed[static_cast<std::size_t>(AlgorithmMethod::QuartzPoncho)] == 400);
    assert(concurrent.Lifetime(AlgorithmMethod::QuartzPoncho).exits == 400);
    std::cout << "algorithm trace: pairing, epochs, bounds, lifetime and concurrency passed\n";
}
