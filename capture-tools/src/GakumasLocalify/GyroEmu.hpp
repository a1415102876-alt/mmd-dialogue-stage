#pragma once
#include "../deps/UnityResolve/UnityResolve.hpp"

// 用鼠标右键拖动 / 小键盘模拟手机陀螺仪姿态（PC 版无陀螺仪）
namespace GakumasLocal::GyroEmu {
    // 读一次输入并返回当前 Input.gyro.attitude
    UnityResolve::UnityType::Quaternion Attitude();
    UnityResolve::UnityType::Vector3 Gravity();
    void Reset();
}
