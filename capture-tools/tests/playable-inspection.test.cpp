#include "../src/GakumasLocalify/PlayableInspection.hpp"
#include <cassert>
#include <iostream>

using namespace GakumasLocal::PhysicsDiagnostics;

int main() {
    const std::array<std::uint8_t, 16> bytes{0x30,0xd3,0,0x30,0xe6,1,0,0,6,0,0,0,0,0,0,0};
    const auto handle = DecodePlayableHandle(bytes.data(), bytes.size());
    assert(handle && handle->pointer == 0x1e63000d330 && handle->version == 6);
    assert(!DecodePlayableHandle(bytes.data(), 8));
    assert(!DecodePlayableHandle(nullptr, 16));
    const std::array<std::uint8_t, 16> nullHandle{};
    assert(!DecodePlayableHandle(nullHandle.data(), nullHandle.size()));
    assert(SameNativeArrayHeader({0x1000,8,4}, {0x1000,8,4}));
    assert(!SameNativeArrayHeader({0x1000,8,4}, {0x2000,8,4}));
    assert(!SameNativeArrayHeader({0x1000,8,4}, {0x1000,4,4}));
    assert(!SameNativeArrayHeader({0x1000,8,4}, {0x1000,8,3}));
    std::cout << "playable handles and array identity checks passed\n";
}
