#include "../src/GakumasLocalify/NativeCodeReferences.hpp"

#include <cassert>
#include <cstdint>
#include <iostream>
#include <vector>

int main() {
    const std::uint8_t code[] = {
        0xf3, 0x0f, 0x10, 0x05, 0x74, 0x9c, 0x32, 0x00,
        0x90,
        0x0f, 0x10, 0x0d, 0x01, 0x00, 0x00, 0x00,
        0x48, 0x8b, 0x05, 0xfe, 0xff, 0xff, 0xff,
    };
    const auto references = GakumasLocal::PhysicsDiagnostics::DecodeRipRelativeReferences(
        code, sizeof(code));
    assert(references.size() == 3);
    assert(references[0].instructionOffset == 0);
    assert(references[0].instructionSize == 8);
    assert(references[0].displacement == 0x329c74);
    assert(references[1].instructionOffset == 9);
    assert(references[1].instructionSize == 7);
    assert(references[1].displacement == 1);
    assert(references[2].instructionOffset == 16);
    assert(references[2].instructionSize == 7);
    assert(references[2].displacement == -2);
    const std::uint8_t extendedRegister[] = {0xf3, 0x44, 0x0f, 0x10, 0x25, 0xfc, 0xff, 0xff, 0xff};
    const auto extended = GakumasLocal::PhysicsDiagnostics::DecodeRipRelativeReferences(
        extendedRegister, sizeof(extendedRegister));
    assert(extended.size() == 1 && extended[0].instructionSize == 9 && extended[0].displacement == -4);
    const std::uint8_t falsePositive[] = {0x48, 0xb8, 0x0f, 0x10, 0x05, 0, 0, 0, 0, 0};
    assert(GakumasLocal::PhysicsDiagnostics::DecodeRipRelativeReferences(falsePositive, sizeof(falsePositive)).empty());
    const std::uint8_t absoluteAddress[] = {0x67, 0x0f, 0x10, 0x05, 0, 0, 0, 0};
    assert(GakumasLocal::PhysicsDiagnostics::DecodeRipRelativeReferences(absoluteAddress, sizeof(absoluteAddress)).empty());
    assert(GakumasLocal::PhysicsDiagnostics::DecodeRipRelativeReferences(extendedRegister, 8).empty());
    const std::uint8_t calls[] = {0xe8,0xfb,0xff,0xff,0xff,0x48,0xb8,0xe8,0,0,0,0,0,0,0};
    const auto targets = GakumasLocal::PhysicsDiagnostics::DecodeDirectCallReferences(calls, sizeof(calls));
    assert(targets.size() == 1 && targets[0].displacement == -5 && targets[0].instructionSize == 5);

    std::vector<std::uint8_t> swingPrologue(0x83, 0x90);
    const std::uint8_t swingJump[] = {0x0f, 0x84, 0x69, 0x05, 0x00, 0x00};
    swingPrologue.insert(swingPrologue.end(), std::begin(swingJump), std::end(swingJump));
    const auto swingBodies = GakumasLocal::PhysicsDiagnostics::CollectSplitBodyTargets(
        0x7ffb5573e010, swingPrologue.data(), swingPrologue.size());
    assert(swingBodies.size() == 2);
    assert(swingBodies[0] == 0x7ffb5573e099);
    assert(swingBodies[1] == 0x7ffb5573e602);
    const std::uint8_t returns[] = {0xc3};
    assert(GakumasLocal::PhysicsDiagnostics::CollectSplitBodyTargets(0x4000, returns, sizeof(returns)).empty());
    const std::uint8_t tailJump[] = {0xe9, 0x10, 0x00, 0x00, 0x00};
    const auto tail = GakumasLocal::PhysicsDiagnostics::CollectSplitBodyTargets(0x5000, tailJump, sizeof(tailJump));
    assert(tail.size() == 1 && tail[0] == 0x5015);

    const std::uint8_t internalJump[] = {0x75, 0x02, 0x90, 0x90, 0x90, 0x90};
    assert(GakumasLocal::PhysicsDiagnostics::CollectSplitBodyTargets(
        0x2000, internalJump, sizeof(internalJump)).empty());
    const std::uint8_t farJump[] = {0xe9, 0xff, 0xff, 0x01, 0x00};
    assert(GakumasLocal::PhysicsDiagnostics::CollectSplitBodyTargets(
        0x2000, farJump, sizeof(farJump)).empty());
    const std::uint8_t backwardJump[] = {0xeb, 0xf0, 0x90, 0x90, 0x90, 0x90};
    const auto backward = GakumasLocal::PhysicsDiagnostics::CollectSplitBodyTargets(
        0x2000, backwardJump, sizeof(backwardJump));
    assert(backward.size() == 1 && backward[0] == 0x1ff2);

    const std::uint8_t callsOnly[] = {0xe8, 0x10, 0x00, 0x00, 0x00};
    assert(GakumasLocal::PhysicsDiagnostics::CollectSplitBodyTargets(0x3000, callsOnly, sizeof(callsOnly)).empty());
    std::cout << "native code reference decoder passed\n";
}
