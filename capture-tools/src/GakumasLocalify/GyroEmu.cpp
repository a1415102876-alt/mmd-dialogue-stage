#include "GyroEmu.hpp"
#include "config/Config.hpp"
#include <windows.h>
#include <algorithm>
#include <chrono>

namespace GakumasLocal::GyroEmu {
    using Quaternion = UnityResolve::UnityType::Quaternion;
    using Vector3 = UnityResolve::UnityType::Vector3;

    static float pitch = 0, yaw = 0, roll = 0;   // 度，Unity 相机欧拉角
    static POINT lastCursor{};
    static bool dragging = false;
    static auto lastTick = std::chrono::steady_clock::now();

    static bool Down(int vk) { return (GetAsyncKeyState(vk) & 0x8000) != 0; }

    void Reset() { pitch = yaw = roll = 0; }

    static void PollInput() {
        const auto now = std::chrono::steady_clock::now();
        const float dt = (std::min)(std::chrono::duration<float>(now - lastTick).count(), 0.1f);
        lastTick = now;

        const float sx = Config::gyroSensitivity * (Config::gyroInvertX ? -1.f : 1.f);
        const float sy = Config::gyroSensitivity * (Config::gyroInvertY ? -1.f : 1.f);

        // 右键拖动：鼠标位移 -> yaw/pitch
        if (Down(VK_RBUTTON)) {
            POINT cur; GetCursorPos(&cur);
            if (dragging) {
                yaw   += (cur.x - lastCursor.x) * 0.1f * sx;
                pitch += (cur.y - lastCursor.y) * 0.1f * sy;
            }
            lastCursor = cur;
            dragging = true;
        } else {
            dragging = false;
        }

        // 小键盘：7/9 翻滚, 5 复位。4/6/8/2 是游戏自己拍摄页的镜头键，不占用
        const float step = 60.f * dt * Config::gyroSensitivity;
        if (Down(VK_NUMPAD7)) roll += step;
        if (Down(VK_NUMPAD9)) roll -= step;
        if (Down(VK_NUMPAD5)) Reset();

        pitch = std::clamp(pitch, -89.f, 89.f);
    }

    Quaternion Attitude() {
        PollInput();
        Quaternion q; q.Euler(pitch, yaw, roll);
        // 反汇编 VLGyro.get_gyroRotationRaw：raw = gyroBaseRotation * Quaternion(-a.x, -a.y, a.z, a.w)；
        // CampusGyroController.Rotation = Inverse(raw@reset) * raw，base 被消掉，所以直接把相机欧拉角编码进 a 即可。
        return Quaternion(-q.x, -q.y, q.z, q.w);
    }

    Vector3 Gravity() {
        // ponytail: 竖持手机时重力恒指向设备 -Y，VLGyro 没用到重力，够用
        return Vector3(0.f, -1.f, 0.f);
    }
}
