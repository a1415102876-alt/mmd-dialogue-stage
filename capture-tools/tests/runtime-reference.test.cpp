#include "../src/GakumasLocalify/RuntimeReference.hpp"
#include "../src/GakumasLocalify/RecoveredPhysics.hpp"

#include <cassert>
#include <iostream>
#include <vector>

using GakumasLocal::PhysicsDiagnostics::SelectAnimationJobClass;
using GakumasLocal::PhysicsDiagnostics::ExtractGenericArgument;
using GakumasLocal::PhysicsReference::Quaternion;
using GakumasLocal::PhysicsReference::Vector3;

int main() {
    int jobMetadata = 1;
    int unknownMetadata = 2;
    const std::vector<void*> trusted{&jobMetadata};
    assert(SelectAnimationJobClass("UnityEngine.Animations.IAnimationJob", &jobMetadata, trusted) == &jobMetadata);
    assert(SelectAnimationJobClass("UnityEngine.Animations.IAnimationJob", &unknownMetadata, trusted) == nullptr);
    assert(SelectAnimationJobClass("System.Object", &jobMetadata, trusted) == nullptr);
    assert(SelectAnimationJobClass("UnityEngine.Animations.IAnimationJob", nullptr, trusted) == nullptr);
    assert(SelectAnimationJobClass("UnityEngine.Animations.IAnimationJob", &jobMetadata, {}) == nullptr);
    assert(ExtractGenericArgument("Unity.Collections.NativeArray<ActorAnimation.SkirtBone>")
        == "ActorAnimation.SkirtBone");
    assert(ExtractGenericArgument("Unity.Collections.NativeList<System.Int32>") == "System.Int32");
    assert(ExtractGenericArgument("Unity.Collections.NativeArray`1") == "");

    const Quaternion rotation{0.2f, -0.3f, 0.4f, 0.8f};
    const Quaternion inverse = GakumasLocal::PhysicsReference::Inverse(rotation);
    const Quaternion identity = GakumasLocal::PhysicsReference::Multiply(rotation, inverse);
    assert((GakumasLocal::PhysicsReference::NearlyEqual(identity, Quaternion{0, 0, 0, 1})));
    assert(GakumasLocal::PhysicsReference::WrapDegrees(190.0f) == -170.0f);
    assert(GakumasLocal::PhysicsReference::WrapDegrees(-190.0f) == 170.0f);
    assert(GakumasLocal::PhysicsReference::Clamp01(-0.5f) == 0.0f);
    assert(GakumasLocal::PhysicsReference::Clamp01(1.5f) == 1.0f);
    assert((GakumasLocal::PhysicsReference::Lerp(Vector3{0, 0, 0}, Vector3{10, 20, 30}, 0.25f)
        == Vector3{2.5f, 5.0f, 7.5f}));
    std::cout << "runtime reference resolution rules passed\n";
}
