#pragma once

#include <cmath>

namespace GakumasLocal::PhysicsReference {

struct Vector3 {
    float x;
    float y;
    float z;

    constexpr bool operator==(const Vector3& other) const {
        return x == other.x && y == other.y && z == other.z;
    }
};

struct Quaternion {
    float x;
    float y;
    float z;
    float w;
};

constexpr float kDegreesToRadians = 0.017453292519943295f;
constexpr float kRadiansToDegrees = 57.29577951308232f;
constexpr float kPi = 3.14159265358979323846f;
constexpr float kTwoPi = 6.28318530717958647692f;

inline Quaternion Multiply(const Quaternion& left, const Quaternion& right) {
    return {
        left.w * right.x + left.x * right.w + left.y * right.z - left.z * right.y,
        left.w * right.y - left.x * right.z + left.y * right.w + left.z * right.x,
        left.w * right.z + left.x * right.y - left.y * right.x + left.z * right.w,
        left.w * right.w - left.x * right.x - left.y * right.y - left.z * right.z,
    };
}

inline Quaternion Inverse(const Quaternion& value) {
    const float lengthSquared = value.x * value.x + value.y * value.y + value.z * value.z + value.w * value.w;
    if (lengthSquared <= 1.0e-12f) {
        return {0.0f, 0.0f, 0.0f, 1.0f};
    }
    const float scale = 1.0f / lengthSquared;
    return {-value.x * scale, -value.y * scale, -value.z * scale, value.w * scale};
}

inline bool NearlyEqual(const Quaternion& left, const Quaternion& right, float epsilon = 1.0e-5f) {
    return std::fabs(left.x - right.x) <= epsilon
        && std::fabs(left.y - right.y) <= epsilon
        && std::fabs(left.z - right.z) <= epsilon
        && std::fabs(left.w - right.w) <= epsilon;
}

inline float WrapDegrees(float value) {
    value = std::fmod(value + 180.0f, 360.0f);
    if (value < 0.0f) {
        value += 360.0f;
    }
    return value - 180.0f;
}

inline float Clamp01(float value) {
    if (value < 0.0f) {
        return 0.0f;
    }
    if (value > 1.0f) {
        return 1.0f;
    }
    return value;
}

inline Vector3 Lerp(const Vector3& from, const Vector3& to, float amount) {
    return {
        from.x + (to.x - from.x) * amount,
        from.y + (to.y - from.y) * amount,
        from.z + (to.z - from.z) * amount,
    };
}

}
