#pragma once

#include <algorithm>
#include <string>
#include <string_view>
#include <vector>

namespace GakumasLocal::PhysicsDiagnostics {

inline void* SelectAnimationJobClass(std::string_view declaredType, void* actualClass,
                                    const std::vector<void*>& trustedClasses) {
    if (declaredType != "UnityEngine.Animations.IAnimationJob" || !actualClass) return nullptr;
    return std::find(trustedClasses.begin(), trustedClasses.end(), actualClass) != trustedClasses.end()
        ? actualClass : nullptr;
}

inline std::string ExtractGenericArgument(std::string_view typeName) {
    const auto open = typeName.find('<');
    const auto close = typeName.rfind('>');
    if (open == std::string_view::npos || close <= open + 1) return {};
    return std::string(typeName.substr(open + 1, close - open - 1));
}

}
