#include "../src/GakumasLocalify/NativeCapturePlan.hpp"
#include <cassert>
#include <iostream>

using namespace GakumasLocal::PhysicsDiagnostics;

int main() {
    NativeHelperQueue queue(5);
    assert(queue.Enqueue(0x1000, 0, 0x10));
    assert(queue.Enqueue(0x2000, 0, 0x20));
    NativeHelperTarget target{};
    assert(queue.Pop(target) && target.address == 0x1000 && target.depth == 0);
    assert(queue.Enqueue(0x3000, 1, 0x1000));
    assert(!queue.Enqueue(0x2000, 1, 0x1000));
    assert(queue.Pop(target) && target.address == 0x2000 && target.source == 0x20);
    assert(queue.Pop(target) && target.address == 0x3000 && target.depth == 1);
    assert(queue.Enqueue(0x4000, 2, 0x3000));
    assert(queue.Enqueue(0x4100, 3, 0x4000));
    assert(!queue.Enqueue(0, 0, 0));
    assert(queue.Pending() == 2);

    NativeHelperQueue capacityQueue(5);
    assert(capacityQueue.Enqueue(0x5000, 0, 0));
    assert(capacityQueue.Enqueue(0x6000, 0, 0));
    assert(capacityQueue.Enqueue(0x7000, 0, 0));
    assert(capacityQueue.Enqueue(0x7100, 0, 0));
    assert(capacityQueue.Enqueue(0x7200, 0, 0));
    assert(!capacityQueue.Enqueue(0x7300, 0, 0));
    assert(!capacityQueue.Enqueue(0x7400, 0, 0));
    assert(capacityQueue.Dropped() == 2 && capacityQueue.Pending() == 5);
    queue.Clear();
    assert(queue.Pending() == 0 && queue.Dropped() == 0);
    assert(queue.Enqueue(0x1000, 0, 0));
    assert(NativeScanSize(0x1000, 0x1000, 0x1080, 4096) == 128);
    assert(NativeScanSize(0x1000, 0x1000, 0x1080, 64) == 64);
    assert(NativeScanSize(0x1010, 0x1000, 0x1080, 4096) == 4096);
    assert(NativeScanSize(0x1000, 0, 0, 4096) == 4096);
    assert(NativeScanSize(0x1000, 0x1000, 0x900, 4096) == 4096);

    NativeHelperQueue depthQueue(8);
    assert(NativeHelperReadSize(0x1000, 0x1000, 0x905e, 0x20000) == 0x805e);
    assert(NativeHelperReadSize(0x201000, 0x201000, 0x20905e, 0x20000) == 0x805e);
    assert(NativeHelperReadSize(0x1000, 0x1000, 0x1080, 0x20000) == 128);
    assert(NativeHelperReadSize(0x1000, 0x1000, 0x905e, 0x4000) == 0x4000);
    assert(NativeHelperReadSize(0x1000, 0x1000, 0x21000, 0x30000) == 0x10000);
    assert(NativeHelperReadSize(0x1000, 0, 0, 0x20000) == 0x10000);
    assert(NativeHelperReadSize(0x1010, 0x1000, 0x905e, 0x20000) == 0x804e);
    assert(NativeHelperReadSize(0x1000, 0x1000, 0x900, 0x20000) == 0x10000);
    assert(NativeHelperReadSize(0x1000, 0, 0, 128) == 128);
    assert(NativeHelperReadSize(0x1000, 0, 0, 0) == 0);
    assert(depthQueue.Enqueue(0x8000, 3, 0x7000));
    assert(!depthQueue.Enqueue(0x8100, 4, 0x8000));
    assert(depthQueue.Enqueue(0x8200, 3, 0x8000, 1));
    assert(depthQueue.Pop(target) && target.address == 0x8000 && target.hop == 0);
    assert(depthQueue.Pop(target) && target.address == 0x8200 && target.depth == 3 && target.hop == 1);
    assert(!depthQueue.Enqueue(0x8300, 3, 0x8200, 3));

    assert(NativeContinuationReadSize(0x1000, 0x1000, 0x1800, 0x20000) == 0x800);
    assert(NativeContinuationReadSize(0x1200, 0x1000, 0x2000, 0x20000) == 0xe00);
    assert(NativeContinuationReadSize(0x1000, 0, 0, 0x20000) == 0x10000);
    assert(NativeContinuationReadSize(0x1000, 0x1000, 0x30000, 0x40000) == 0x10000);
    assert(NativeContinuationReadSize(0x1000, 0x1000, 0x5000, 0x100) == 0x100);
    assert(ShouldEnqueueCalls(2, 0) && NextCallDepth(2) == 3);
    assert(!ShouldEnqueueCalls(3, 0));
    assert(ShouldEnqueueCalls(3, 1) && NextCallDepth(3) == 3);
    assert(!ShouldEnqueueCalls(4, 1));
    assert(NextCallLevel(3, 1) == 1);
    assert(NextCallLevel(3, 0) == 0);
    assert(NextCallLevel(2, 1) == 0);
    assert(ShouldFollowBoundedCallee(1, true));
    assert(ShouldFollowBoundedCallee(2, true));
    assert(ShouldFollowBoundedCallee(15, true));
    assert(!ShouldFollowBoundedCallee(16, true));
    assert(!ShouldFollowBoundedCallee(1, false));
    assert(ShouldFollowLocalUnboundedCallee(1, false));
    assert(!ShouldFollowLocalUnboundedCallee(1, true));
    assert(ShouldFollowDepthCapCallee(3, 0, 0, true));
    assert(!ShouldFollowDepthCapCallee(3, 0, 0, false));
    assert(!ShouldFollowDepthCapCallee(3, 1, 0, true));
    assert(!ShouldFollowDepthCapCallee(2, 0, 0, true));
    assert(IsWithinCallRadius(0x1000, 0x2000));
    assert(!IsWithinCallRadius(0x1000, 0x1000 + (64 * 1024) + 1));
    std::cout << "native capture breadth-first queue and boundary tests passed\n";
}
