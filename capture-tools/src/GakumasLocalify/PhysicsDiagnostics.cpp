#include "PhysicsDiagnostics.hpp"
#include "AlgorithmTrace.hpp"
#include "RuntimeReference.hpp"
#include "SnapshotLayout.hpp"
#include "NativeCodeReferences.hpp"
#include "NativeCapturePlan.hpp"
#include "PlayableInspection.hpp"
#include "IdolParameterExport.hpp"

#include "Il2cppUtils.hpp"
#include "Log.h"
#include "../deps/UnityResolve/UnityResolve.hpp"

#include <algorithm>
#include <array>
#include <cmath>
#include <cctype>
#include <cstdint>
#include <filesystem>
#include <fstream>
#include <iomanip>
#include <initializer_list>
#include <locale>
#include <mutex>
#include <sstream>
#include <stdexcept>
#include <string_view>
#include <string>
#include <thread>
#include <type_traits>
#include <unordered_set>
#include <vector>
#include <atomic>
#include "../deps/nlohmann/json.hpp"

#ifdef GKMS_WINDOWS
#include <windows.h>
#include <minhook.h>
#include <tlhelp32.h>
#endif

extern std::filesystem::path gakumasLocalPath;

namespace GakumasLocal::PhysicsDiagnostics {
namespace {
    std::mutex snapshotMutex;
    std::unordered_set<void*> capturedInitializers;
    std::unordered_set<void*> describedClasses;
    std::filesystem::path captureDirectory;
    bool collectingActors = false;
    std::uint64_t captureStarted = 0;
    nlohmann::json captureActors = nlohmann::json::array();
    std::unordered_set<std::uintptr_t> observedActors;
    nlohmann::json runtimeActors = nlohmann::json::array();
    bool runtimeSnapshotReady = false;
    std::size_t runtimeObjectCount = 0;
    std::size_t runtimePhysicalListCount = 0;
    std::size_t runtimeNativeListCount = 0;
    bool runtimeGraphWritten = false;
    bool runtimeJobWritten = false;
    std::ofstream frameTraceOutput;
    CaptureTraceState frameTraceState;
    bool lateUpdateFrameOpen = false;
    std::uint64_t frameSequence = 0;
    std::size_t frameCount = 0;
    std::size_t transformWriteCount = 0;
    std::mutex frameTraceMutex;
    AlgorithmTrace<> algorithmTrace;
    std::size_t algorithmEventsWritten = 0;
    nlohmann::json algorithmHookAudit = nlohmann::json::array();
    std::atomic<std::uint64_t> algorithmRecorderErrors{0};
    struct SavedHookCode {
        std::uintptr_t address;
        std::array<std::uint8_t, 32> bytes;
    };
    std::vector<SavedHookCode> savedHookCode;
    NativeHelperQueue nativeHelperQueue;
    std::size_t nativeHelperCodeCount = 0;
    constexpr std::size_t kMaxNativeHelpers = 65536;
    std::size_t nativeHelperUnknownCapped = 0;

    struct ResolvedClass {
        UnityResolve::Class* klass{};
        const char* assembly{};
    };

    ResolvedClass FindClass(std::initializer_list<const char*> assemblies,
                            const char* nameSpace, const char* className) {
        for (const auto* assembly : assemblies) {
            if (auto* klass = Il2cppUtils::GetClass(assembly, nameSpace, className)) {
                return { klass, assembly };
            }
        }
        return {};
    }

    std::string MethodSignature(const UnityResolve::Method* method) {
        if (!method) return "<null>";
        std::ostringstream signature;
        signature << (method->return_type ? method->return_type->name : "void") << "(";
        for (size_t index = 0; index < method->args.size(); ++index) {
            if (index != 0) signature << ",";
            signature << (method->args[index] && method->args[index]->pType
                ? method->args[index]->pType->name
                : "<unknown>");
        }
        signature << ")";
        return signature.str();
    }

    std::string SafeClassName(void* object) {
        if (!object) return "<null>";
        auto* classHead = Il2cppUtils::get_class_from_instance(object);
        if (!classHead || !classHead->name) return "<unknown>";
        if (!classHead->namespaze || classHead->namespaze[0] == '\0') return classHead->name;
        return std::string(classHead->namespaze) + "." + classHead->name;
    }

    void DescribeClass(void* object) {
        if (!object) return;
        auto* classHead = Il2cppUtils::get_class_from_instance(object);
        if (!classHead) return;
        auto* resolved = Il2cppUtils::GetClass("ActorAnimation.Runtime.dll",
                                               classHead->namespaze ? classHead->namespaze : "",
                                               classHead->name ? classHead->name : "");
        if (!resolved) {
            resolved = Il2cppUtils::GetClass("campus-submodule.Runtime.dll",
                                             classHead->namespaze ? classHead->namespaze : "",
                                             classHead->name ? classHead->name : "");
        }
        if (!resolved) return;

        std::lock_guard lock(snapshotMutex);
        if (!describedClasses.insert(resolved->address).second) return;

        Log::InfoFmt("PHYSICS_DIAG class=%s fields=%zu methods=%zu",
                     SafeClassName(object).c_str(), resolved->fields.size(), resolved->methods.size());
        for (const auto* field : resolved->fields) {
            if (!field) continue;
            Log::InfoFmt("PHYSICS_DIAG field class=%s name=%s offset=%d type=%s static=%d",
                         SafeClassName(object).c_str(), field->name.c_str(), field->offset,
                         field->type ? field->type->name.c_str() : "<unknown>", field->static_field ? 1 : 0);
        }
        for (const auto* method : resolved->methods) {
            if (!method) continue;
            const auto signature = MethodSignature(method);
            Log::InfoFmt("PHYSICS_DIAG method class=%s name=%s signature=%s addr=%p",
                         SafeClassName(object).c_str(), method->name.c_str(), signature.c_str(), method->function);
        }
    }

    void DumpList(void* initializeData, UnityResolve::Class* klass, const char* fieldName) {
        if (!initializeData || !klass) return;
        auto* field = klass->Get<UnityResolve::Field>(fieldName);
        if (!field) {
            Log::InfoFmt("PHYSICS_DIAG list=%s missing", fieldName);
            return;
        }

        auto* list = Il2cppUtils::ClassGetFieldValue<UnityResolve::UnityType::List<void*>*>(initializeData, field);
        if (!list || !list->pList) {
            Log::InfoFmt("PHYSICS_DIAG list=%s count=0 ptr=%p", fieldName, list);
            return;
        }

        const auto count = list->size > 0 ? list->size : 0;
        Log::InfoFmt("PHYSICS_DIAG list=%s count=%d ptr=%p", fieldName, count, list);
        const auto sampleCount = count < 8 ? count : 8;
        for (int index = 0; index < sampleCount; ++index) {
            auto* item = list->pList->At(index);
            Log::InfoFmt("PHYSICS_DIAG list=%s item=%d ptr=%p class=%s",
                         fieldName, index, item, SafeClassName(item).c_str());
            DescribeClass(item);
        }
    }

    void DescribeKnownClass(std::initializer_list<const char*> assemblies,
                            const char* nameSpace, const char* className) {
        const auto resolved = FindClass(assemblies, nameSpace, className);
        if (!resolved.klass) {
            Log::InfoFmt("PHYSICS_DIAG class_missing namespace=%s name=%s",
                         nameSpace, className);
            return;
        }
        auto* klass = resolved.klass;
        Log::InfoFmt("PHYSICS_DIAG class_metadata assembly=%s namespace=%s name=%s fields=%zu methods=%zu",
                     resolved.assembly, nameSpace, className, klass->fields.size(), klass->methods.size());
        for (const auto* field : klass->fields) {
            if (!field) continue;
            Log::InfoFmt("PHYSICS_DIAG metadata_field class=%s name=%s offset=%d type=%s static=%d",
                         className, field->name.c_str(), field->offset,
                         field->type ? field->type->name.c_str() : "<unknown>", field->static_field ? 1 : 0);
        }
        for (const auto* method : klass->methods) {
            if (!method) continue;
            const auto signature = MethodSignature(method);
            Log::InfoFmt("PHYSICS_DIAG metadata_method class=%s name=%s signature=%s addr=%p",
                         className, method->name.c_str(), signature.c_str(), method->function);
        }
    }

#ifdef GKMS_WINDOWS
    std::string PointerText(void* pointer);

    template <typename Function>
    Function DiagnosticApi(const char* name) {
        auto address = GetProcAddress(GetModuleHandleW(L"GameAssembly.dll"), name);
        if (!address) throw std::runtime_error(std::string("missing diagnostic API: ") + name);
        return reinterpret_cast<Function>(address);
    }

    struct SnapshotApi {
        void* (*classFromType)(void*) = DiagnosticApi<decltype(classFromType)>("il2cpp_class_from_type");
        void* (*typeFromClass)(void*) = DiagnosticApi<decltype(typeFromClass)>("il2cpp_class_get_type");
        const char* (*className)(void*) = DiagnosticApi<decltype(className)>("il2cpp_class_get_name");
        const char* (*classNamespace)(void*) = DiagnosticApi<decltype(classNamespace)>("il2cpp_class_get_namespace");
        void* (*parent)(void*) = DiagnosticApi<decltype(parent)>("il2cpp_class_get_parent");
        void* (*fields)(void*, void**) = DiagnosticApi<decltype(fields)>("il2cpp_class_get_fields");
        const char* (*fieldName)(void*) = DiagnosticApi<decltype(fieldName)>("il2cpp_field_get_name");
        void* (*fieldType)(void*) = DiagnosticApi<decltype(fieldType)>("il2cpp_field_get_type");
        std::size_t (*fieldOffset)(void*) = DiagnosticApi<decltype(fieldOffset)>("il2cpp_field_get_offset");
        int (*fieldFlags)(void*) = DiagnosticApi<decltype(fieldFlags)>("il2cpp_field_get_flags");
        int (*typeKind)(void*) = DiagnosticApi<decltype(typeKind)>("il2cpp_type_get_type");
        bool (*isValue)(void*) = DiagnosticApi<decltype(isValue)>("il2cpp_class_is_valuetype");
        int (*valueSize)(void*, std::uint32_t*) = DiagnosticApi<decltype(valueSize)>("il2cpp_class_value_size");
        std::uint32_t (*instanceSize)(void*) = DiagnosticApi<decltype(instanceSize)>("il2cpp_class_instance_size");
        void* (*elementClass)(void*) = DiagnosticApi<decltype(elementClass)>("il2cpp_class_get_element_class");
        int (*elementSize)(void*) = DiagnosticApi<decltype(elementSize)>("il2cpp_class_array_element_size");
        const char* (*typeName)(void*) = DiagnosticApi<decltype(typeName)>("il2cpp_type_get_name");

        std::string Name(void* klass) const {
            if (!klass) return "<unknown>";
            const auto* space = classNamespace(klass);
            const auto* name = className(klass);
            return std::string(space && *space ? space : "") + (space && *space ? "." : "") + (name ? name : "");
        }

        std::string TypeName(void* type) const {
            const auto* name = type ? typeName(type) : nullptr;
            return name ? name : "<unknown>";
        }
    };

    bool ReadSnapshotBytes(const void* address, void* output, std::size_t size) {
        if (!address || !size || size > 1024 * 1024) return false;
        const auto begin = reinterpret_cast<std::uintptr_t>(address);
        if (begin > UINTPTR_MAX - size) return false;
        auto cursor = begin;
        while (cursor < begin + size) {
            MEMORY_BASIC_INFORMATION region{};
            if (!VirtualQuery(reinterpret_cast<void*>(cursor), &region, sizeof(region))
                || region.State != MEM_COMMIT || (region.Protect & PAGE_GUARD)) return false;
            const auto protection = region.Protect & 0xff;
            if (protection != PAGE_READONLY && protection != PAGE_READWRITE && protection != PAGE_WRITECOPY
                && protection != PAGE_EXECUTE_READ && protection != PAGE_EXECUTE_READWRITE
                && protection != PAGE_EXECUTE_WRITECOPY) return false;
            const auto end = reinterpret_cast<std::uintptr_t>(region.BaseAddress) + region.RegionSize;
            if (end <= cursor) return false;
            cursor = (std::min)(end, begin + size);
        }
        SIZE_T copied = 0;
        return ReadProcessMemory(GetCurrentProcess(), address, output, size, &copied) && copied == size;
    }

    template <typename Value>
    bool ReadSnapshotValue(const void* address, Value& result) {
        return ReadSnapshotBytes(address, &result, sizeof(result));
    }

    bool AllowedGraphClass(const SnapshotApi& api, void* klass) {
        const auto name = api.Name(klass);
        return name.starts_with("ActorAnimation.")
            || name == "Campus.Common.CampusActorController"
            || (name.starts_with("Campus.Common.CampusActor")
                && (name.find("Animation") != std::string::npos || name.find("Model") != std::string::npos));
    }

    bool IsSnapshotList(const SnapshotApi& api, void* klass) {
        return api.Name(klass) == "System.Collections.Generic.List" + std::string(1, char(96)) + "1";
    }

    struct GraphItem {
        void* object;
        void* klass;
        int depth;
    };

    struct RuntimeGraph {
        SnapshotApi api;
        nlohmann::json objects = nlohmann::json::array();
        std::vector<GraphItem> pending;
        std::unordered_set<std::uintptr_t> queued;
        std::size_t physicalListCount = 0;
        std::size_t nativeListCount = 0;
        std::size_t skipped = 0;
        std::size_t truncated = 0;
        std::vector<void*> trustedJobClasses;
        nlohmann::json jobReferences = nlohmann::json::array();

        RuntimeGraph() {
            const auto job = FindClass({"campus-submodule.Runtime.dll"}, "ActorAnimation", "CampusActorAnimationJob");
            if (job.klass) trustedJobClasses.push_back(job.klass->address);
        }

        void Record(const nlohmann::json&) {}
    };

    nlohmann::json SnapshotInline(const void* address, void* type, const SnapshotApi& api,
                                  int depth = 0, RuntimeGraph* graph = nullptr);

    UnityResolve::Class* ResolveNamedClass(const std::string& fullName) {
        const auto separator = fullName.rfind('.');
        if (separator == std::string::npos) return nullptr;
        const auto nameSpace = fullName.substr(0, separator);
        const auto className = fullName.substr(separator + 1);
        return FindClass({"ActorAnimation.Runtime.dll", "campus-submodule.Runtime.dll"},
                         nameSpace.c_str(), className.c_str()).klass;
    }

    nlohmann::json ReadNativeArray(RuntimeGraph& graph, const void* address, void* fieldType) {
        const auto genericType = graph.api.TypeName(fieldType);
        const auto elementName = ExtractGenericArgument(genericType);
        nlohmann::json result = {{"status", "unsupported_header_layout"}};
        result["generic_type"] = genericType;
        result["element_type_name"] = elementName;
        auto* arrayClass = graph.api.classFromType(fieldType);
        std::uint32_t headerAlignment = 0;
        const auto headerSize = arrayClass && graph.api.isValue(arrayClass)
            ? graph.api.valueSize(arrayClass, &headerAlignment) : 0;
        result["header_size"] = headerSize;
        if (headerSize != sizeof(NativeArrayHeader64)) return result;
        bool bufferFound = false, lengthFound = false, allocatorFound = false;
        void* iterator = nullptr;
        while (auto* member = graph.api.fields(arrayClass, &iterator)) {
            if (graph.api.fieldFlags(member) & (0x10 | 0x40)) continue;
            const std::string_view name = graph.api.fieldName(member);
            const auto offset = graph.api.fieldOffset(member);
            const auto kind = graph.api.typeKind(graph.api.fieldType(member));
            if (name == "m_Buffer" && offset == 16 && kind == 0x0f) bufferFound = true;
            if (name == "m_Length" && offset == 24 && kind == 0x08) lengthFound = true;
            if (name == "m_AllocatorLabel" && offset == 28) allocatorFound = true;
        }
        if (!bufferFound || !lengthFound || !allocatorFound) return result;
        NativeArrayHeader64 header{};
        if (!ReadSnapshotValue(address, header)) {
            result["status"] = "unreadable_header";
            return result;
        }
        result["buffer_address"] = PointerText(reinterpret_cast<void*>(header.buffer));
        result["length"] = header.length;
        result["allocator"] = header.allocator;
        if (elementName.empty()) {
            result["status"] = "element_type_missing";
            return result;
        }

        auto* elementClass = ResolveNamedClass(elementName);
        if (!elementClass) {
            result["status"] = "element_class_missing";
            return result;
        }
        if (!graph.api.isValue(elementClass->address)) {
            result["status"] = "unsupported_element_type";
            return result;
        }
        auto* elementType = graph.api.typeFromClass(elementClass->address);
        std::uint32_t alignment = 0;
        const auto elementSize = elementType ? graph.api.valueSize(elementClass->address, &alignment) : 0;
        result["element_type"] = graph.api.Name(elementClass->address);
        result["element_size"] = elementSize;
        result["element_alignment"] = alignment;
        if (!elementType || !graph.api.isValue(elementClass->address) || elementSize <= 0 || elementSize > 4096) {
            result["status"] = "unsupported_element_type";
            return result;
        }

        if (!ValidNativeArrayRange(header, elementSize)) {
            result["status"] = "invalid_buffer_or_length";
            return result;
        }

        result["items"] = nlohmann::json::array();
        const auto limit = (std::min)(header.length, 32);
        int itemsRead = 0;
        for (int index = 0; index < limit; ++index) {
            const auto itemAddress = reinterpret_cast<const void*>(header.buffer
                + static_cast<std::uintptr_t>(index) * static_cast<std::uintptr_t>(elementSize));
            auto item = SnapshotInline(itemAddress, elementType, graph.api);
            if (item.contains("raw_hex") || item.value("status", "") == "read") ++itemsRead;
            item["index"] = index;
            result["items"].push_back(std::move(item));
        }
        result["status"] = itemsRead != limit ? "partial_read"
            : header.length == 0 ? "empty" : limit == header.length ? "read" : "truncated";
        result["items_read"] = itemsRead;
        result["items_attempted"] = limit;
        return result;
    }

    bool IsTargetedSwingNativeList(const SnapshotApi& api, void* ownerClass,
                                   const char* fieldName, void* fieldType) {
        if (!ownerClass || api.Name(ownerClass) != "ActorAnimation.ActorAnimationSwingJobSkeleton"
            || !fieldName || !fieldType) return false;
        static constexpr const char* names[] = {
            "dynamicBones", "staticBones", "breastBones", "chainBones"
        };
        if (std::none_of(std::begin(names), std::end(names),
                         [&](const char* name) { return std::string_view(fieldName) == name; })) return false;
        return api.Name(api.classFromType(fieldType))
            == "Unity.Collections.NativeList`1";
    }

    nlohmann::json ReadNativeList(RuntimeGraph& graph, const void* address, void* fieldType) {
        const auto genericType = graph.api.TypeName(fieldType);
        const auto elementName = ExtractGenericArgument(genericType);
        nlohmann::json result = {
            {"container", "NativeList"}, {"status", "unsupported_header_layout"},
            {"generic_type", genericType}, {"element_type_name", elementName}
        };
        if (!address || !fieldType) return result;

        NativeListHeader64 list{};
        if (!ReadSnapshotValue(address, list)) {
            result["status"] = "unreadable_list_wrapper";
            return result;
        }
        result["list_data_address"] = PointerText(reinterpret_cast<void*>(list.listData));
        if (!list.listData) {
            result["status"] = "null_list";
            result["length"] = 0;
            result["capacity"] = 0;
            return result;
        }

        UnsafeListHeader64 header{};
        if (!ReadSnapshotValue(reinterpret_cast<void*>(list.listData), header)) {
            result["status"] = "unreadable_unsafe_list_header";
            return result;
        }
        result["buffer_address"] = PointerText(reinterpret_cast<void*>(header.buffer));
        result["length"] = header.length;
        result["capacity"] = header.capacity;
        if (elementName.empty()) {
            result["status"] = "element_type_missing";
            return result;
        }

        auto* elementClass = ResolveNamedClass(elementName);
        if (!elementClass || !graph.api.isValue(elementClass->address)) {
            result["status"] = "element_class_missing_or_not_value_type";
            return result;
        }
        auto* elementType = graph.api.typeFromClass(elementClass->address);
        std::uint32_t alignment = 0;
        const auto elementSize = elementType
            ? graph.api.valueSize(elementClass->address, &alignment) : 0;
        result["element_type"] = graph.api.Name(elementClass->address);
        result["element_size"] = elementSize;
        result["element_alignment"] = alignment;
        if (!elementType || elementSize <= 0 || elementSize > 4096) {
            result["status"] = "unsupported_element_type";
            return result;
        }
        if (!ValidNativeListRange(header, static_cast<std::size_t>(elementSize))) {
            result["status"] = "invalid_buffer_or_length";
            return result;
        }

        result["items"] = nlohmann::json::array();
        const auto limit = (std::min)(header.length, 256);
        int itemsRead = 0;
        for (int index = 0; index < limit; ++index) {
            const auto itemAddress = reinterpret_cast<const void*>(header.buffer
                + static_cast<std::uintptr_t>(index) * static_cast<std::uintptr_t>(elementSize));
            auto item = SnapshotInline(itemAddress, elementType, graph.api, 0, &graph);
            if (item.contains("raw_hex") || item.value("status", "") == "read"
                || item.value("status", "") == "raw_value_type") ++itemsRead;
            item["index"] = index;
            result["items"].push_back(std::move(item));
        }
        result["items_read"] = itemsRead;
        result["items_attempted"] = limit;
        result["status"] = itemsRead != limit ? "partial_read"
            : header.length == 0 ? "empty" : limit == header.length ? "read" : "truncated";
        ++graph.nativeListCount;
        return result;
    }

    void* InvokeGetter(void* object, const char* className, const char* getter);
    std::string ReadManagedString(void* value);

    bool IsUnityObjectClass(const SnapshotApi& api, void* klass) {
        for (int depth = 0; klass && depth < 32; ++depth) {
            if (api.Name(klass) == "UnityEngine.Object") return true;
            klass = api.parent(klass);
        }
        return false;
    }

    nlohmann::json UnityObjectIdentity(void* object, const std::string& declaredType) {
        nlohmann::json result = {
            {"declared_type", declaredType},
            {"object_name", ""},
            {"transform_ancestors", nlohmann::json::array()}
        };
        if (!object) return result;

        auto* transform = object;
        if (declaredType == "UnityEngine.GameObject") {
            result["object_name"] = ReadManagedString(InvokeGetter(object, "Object", "get_name"));
            transform = InvokeGetter(object, "GameObject", "get_transform");
        } else if (declaredType == "UnityEngine.Transform") {
            result["object_name"] = ReadManagedString(InvokeGetter(object, "Object", "get_name"));
        } else {
            result["object_name"] = ReadManagedString(InvokeGetter(object, "Object", "get_name"));
            transform = InvokeGetter(object, "Component", "get_transform");
        }

        for (int depth = 0; transform && depth < 16; ++depth) {
            result["transform_ancestors"].push_back(
                ReadManagedString(InvokeGetter(transform, "Object", "get_name")));
            transform = InvokeGetter(transform, "Transform", "get_parent");
        }
        return result;
    }

    bool MatchesDeclaredClass(void* object, void* expected) {
        void* actual = nullptr;
        return expected && ReadSnapshotValue(object, actual) && actual == expected;
    }

    void QueueRuntimeObject(RuntimeGraph& graph, void* object, void* klass, int depth) {
        if (!object || !AllowedGraphClass(graph.api, klass)) return;
        if (depth > 8 || graph.queued.size() >= 2048) {
            ++graph.truncated;
            return;
        }
        if (!MatchesDeclaredClass(object, klass)) {
            ++graph.skipped;
            graph.Record({{"event", "skip"}, {"address", PointerText(object)}, {"reason", "declared_class_mismatch_or_unreadable"}});
            return;
        }
        if (graph.queued.insert(reinterpret_cast<std::uintptr_t>(object)).second)
            graph.pending.push_back({object, klass, depth});
    }

    template <typename Value>
    nlohmann::json SnapshotScalar(const void* address) {
        Value result{};
        if (!ReadSnapshotValue(address, result)) return {{"status", "unreadable"}};
        if constexpr (std::is_floating_point_v<Value>) {
            if (!std::isfinite(result)) return {{"status", "non_finite"}};
        }
        return {{"value", result}, {"status", "read"}};
    }

    nlohmann::json SnapshotInline(const void* address, void* type, const SnapshotApi& api,
                                  int depth, RuntimeGraph* graph) {
        const auto kind = api.typeKind(type);
        switch (kind) {
            case 0x02: {
                auto result = SnapshotScalar<std::uint8_t>(address);
                if (result.contains("value")) result["value"] = result["value"].get<unsigned>() != 0;
                return result;
            }
            case 0x03: return SnapshotScalar<std::uint16_t>(address);
            case 0x04: return SnapshotScalar<std::int8_t>(address);
            case 0x05: return SnapshotScalar<std::uint8_t>(address);
            case 0x06: return SnapshotScalar<std::int16_t>(address);
            case 0x07: return SnapshotScalar<std::uint16_t>(address);
            case 0x08: return SnapshotScalar<std::int32_t>(address);
            case 0x09: return SnapshotScalar<std::uint32_t>(address);
            case 0x0a: return SnapshotScalar<std::int64_t>(address);
            case 0x0b: return SnapshotScalar<std::uint64_t>(address);
            case 0x0c: return SnapshotScalar<float>(address);
            case 0x0d: return SnapshotScalar<double>(address);
        }
        auto* klass = api.classFromType(type);
        if (!klass || !api.isValue(klass)) return {{"status", "unsupported_inline_type"}};
        std::uint32_t alignment = 0;
        const auto size = api.valueSize(klass, &alignment);
        if (size <= 0 || size > 4096) return {{"status", "unsupported_value_size"}, {"size", size}};
        std::vector<std::uint8_t> bytes(size);
        if (!ReadSnapshotBytes(address, bytes.data(), bytes.size())) return {{"status", "unreadable"}};
        std::ostringstream hex;
        hex.imbue(std::locale::classic());
        hex << std::hex << std::setfill('0');
        for (const auto byte : bytes) hex << std::setw(2) << static_cast<unsigned>(byte);
        nlohmann::json result = {{"status", "raw_value_type"}, {"raw_hex", hex.str()}, {"size", size},
            {"storage", "inline_value"}, {"object_header_size", 16}};
        if (depth >= 4) return result;

        result["fields"] = nlohmann::json::array();
        void* iterator = nullptr;
        while (auto* field = api.fields(klass, &iterator)) {
            if (api.fieldFlags(field) & (0x10 | 0x40)) continue;
            const auto metadataOffset = api.fieldOffset(field);
            auto* fieldType = api.fieldType(field);
            if (!fieldType) continue;
            auto* fieldClass = api.classFromType(fieldType);
            if (!fieldClass) continue;
            std::uint32_t fieldAlignment = 0;
            const auto fieldSize = api.isValue(fieldClass)
                ? api.valueSize(fieldClass, &fieldAlignment)
                : static_cast<int>(sizeof(void*));
            const auto fieldOffset = FieldMemoryOffset(metadataOffset, size,
                fieldSize > 0 ? fieldSize : 0, SnapshotStorage::InlineValue);

            nlohmann::json fieldResult = {
                {"name", api.fieldName(field)},
                {"offset", metadataOffset},
                {"metadata_offset", metadataOffset},
                {"type", api.Name(fieldClass)},
                {"type_kind", api.typeKind(fieldType)}
            };
            if (!fieldOffset) {
                fieldResult["status"] = "invalid_inline_field_bounds";
                result["fields"].push_back(std::move(fieldResult));
                continue;
            }
            fieldResult["memory_offset"] = *fieldOffset;
            if (graph && IsTargetedSwingNativeList(api, klass, api.fieldName(field), fieldType)) {
                fieldResult["native_list"] = ReadNativeList(
                    *graph, bytes.data() + *fieldOffset, fieldType);
            }
            if (api.isValue(fieldClass)) {
                fieldResult.update(SnapshotInline(
                    bytes.data() + *fieldOffset,
                    fieldType, api, depth + 1, graph));
            } else {
                void* reference = nullptr;
                if (ReadSnapshotValue(bytes.data() + *fieldOffset, reference)) {
                    fieldResult["status"] = reference ? "reference_only" : "null";
                    fieldResult["value_address"] = PointerText(reference);
                } else {
                    fieldResult["status"] = "unreadable";
                }
            }
            result["fields"].push_back(std::move(fieldResult));
        }
        return result;
    }

    void* FindSnapshotField(const SnapshotApi& api, void* klass, const char* name) {
        void* iterator = nullptr;
        while (auto* field = api.fields(klass, &iterator)) {
            if (std::string_view(api.fieldName(field)) == name && !(api.fieldFlags(field) & 0x10)) return field;
        }
        return nullptr;
    }

    nlohmann::json ReadRuntimeArray(RuntimeGraph& graph, void* array, void* arrayClass, int requested, int depth) {
        const auto& api = graph.api;
        if (!MatchesDeclaredClass(array, arrayClass)) return {{"status", "array_class_mismatch"}};
        struct ArrayHeader {
            void* klass;
            void* monitor;
            void* bounds;
            std::uintptr_t capacity;
        };
        ArrayHeader header{};
        if (!ReadSnapshotValue(array, header) || header.bounds || header.capacity > 1048576)
            return {{"status", "unsupported_array_header"}};
        if (requested < -1 || (requested >= 0 && static_cast<std::size_t>(requested) > header.capacity))
            return {{"status", "invalid_list_count"}, {"count", requested}, {"capacity", header.capacity}};
        const auto count = requested < 0 ? header.capacity : static_cast<std::size_t>(requested);
        auto* element = api.elementClass(arrayClass);
        if (!element) return {{"status", "missing_element_metadata"}};
        const auto stride = api.elementSize(arrayClass);
        const bool inlineValue = api.isValue(element);
        nlohmann::json result = {{"count", count}, {"capacity", header.capacity},
            {"element_type", api.Name(element)}, {"element_stride", stride}};
        if (inlineValue) {
            result["status"] = "skipped_value_type_elements";
            ++graph.skipped;
            return result;
        }
        if (stride != sizeof(void*) || !AllowedGraphClass(api, element)) {
            result["status"] = "skipped_element_type";
            ++graph.skipped;
            return result;
        }
        const auto limit = std::min<std::size_t>(count, 512);
        if (limit != count) ++graph.truncated;
        result["items"] = nlohmann::json::array();
        for (std::size_t index = 0; index < limit; ++index) {
            void* item = nullptr;
            const auto slot = reinterpret_cast<std::uintptr_t>(array) + sizeof(ArrayHeader) + index * sizeof(void*);
            if (!ReadSnapshotValue(reinterpret_cast<void*>(slot), item)) {
                result["status"] = "unreadable_array_slot";
                return result;
            }
            result["items"].push_back(PointerText(item));
            QueueRuntimeObject(graph, item, element, depth + 1);
        }
        result["status"] = limit == count ? "read" : "truncated";
        if (count > 0) ++graph.physicalListCount;
        return result;
    }

    nlohmann::json ReadRuntimeList(RuntimeGraph& graph, void* list, void* klass, int depth) {
        const auto& api = graph.api;
        if (!MatchesDeclaredClass(list, klass)) return {{"status", "list_class_mismatch"}};
        auto* itemsField = FindSnapshotField(api, klass, "_items");
        auto* sizeField = FindSnapshotField(api, klass, "_size");
        if (!itemsField || !sizeField || api.typeKind(api.fieldType(itemsField)) != 0x1d
            || api.typeKind(api.fieldType(sizeField)) != 0x08) return {{"status", "unsupported_list_layout"}};
        const auto itemsOffset = api.fieldOffset(itemsField);
        const auto sizeOffset = api.fieldOffset(sizeField);
        const auto objectSize = api.instanceSize(klass);
        if (itemsOffset > objectSize || sizeof(void*) > objectSize - itemsOffset
            || sizeOffset > objectSize || sizeof(int) > objectSize - sizeOffset) return {{"status", "invalid_list_offsets"}};
        void* array = nullptr;
        int count = -1;
        const auto base = reinterpret_cast<std::uintptr_t>(list);
        if (!ReadSnapshotValue(reinterpret_cast<void*>(base + itemsOffset), array)
            || !ReadSnapshotValue(reinterpret_cast<void*>(base + sizeOffset), count))
            return {{"status", "unreadable_list"}};
        if (count < 0) return {{"status", "invalid_list_count"}, {"count", count}};
        return ReadRuntimeArray(graph, array, api.classFromType(api.fieldType(itemsField)), count, depth);
    }

    nlohmann::json ReadRuntimeField(RuntimeGraph& graph, const GraphItem& item, void* field) {
        const auto& api = graph.api;
        auto* type = api.fieldType(field);
        const auto offset = api.fieldOffset(field);
        const auto kind = api.typeKind(type);
        auto* declared = api.classFromType(type);
        nlohmann::json result = {{"name", api.fieldName(field)}, {"offset", offset},
            {"type", api.Name(declared)}, {"type_kind", kind}};
        if (api.fieldFlags(field) & (0x10 | 0x40)) {
            result["status"] = "skipped_static_or_literal";
            return result;
        }
        const bool inlineValue = declared && api.isValue(declared);
        std::uint32_t alignment = 0;
        const auto size = inlineValue ? api.valueSize(declared, &alignment) : static_cast<int>(sizeof(void*));
        const auto objectSize = api.instanceSize(item.klass);
        if (!FieldMemoryOffset(offset, objectSize, size > 0 ? size : 0, SnapshotStorage::ManagedObject)) {
            result["status"] = "invalid_field_bounds";
            ++graph.skipped;
            return result;
        }
        const auto address = reinterpret_cast<void*>(reinterpret_cast<std::uintptr_t>(item.object) + offset);
        if (inlineValue) {
            result.update(SnapshotInline(address, type, api, 0, &graph));
            if (api.Name(item.klass) == "ActorAnimation.CampusActorAnimationJob"
                && api.Name(declared).starts_with("Unity.Collections.NativeArray")) {
                result["native_array"] = ReadNativeArray(graph, address, type);
            }
            return result;
        }
        if (kind != 0x12 && kind != 0x15 && kind != 0x1d) {
            result["status"] = "skipped_non_object_type";
            return result;
        }
        void* target = nullptr;
        if (!ReadSnapshotValue(address, target)) {
            result["status"] = "unreadable";
            ++graph.skipped;
            return result;
        }
        result["value_address"] = PointerText(target);
        result["status"] = target ? "reference_only" : "null";
        if (target && (api.Name(declared) == "UnityEngine.GameObject"
                       || api.Name(declared) == "UnityEngine.Transform")) {
            result["unity_reference"] = UnityObjectIdentity(target, api.Name(declared));
        }
        if (!target || !declared) return result;

        if (api.Name(declared) == "UnityEngine.Animations.IAnimationJob") {
            void* actual = nullptr;
            const bool readable = ReadSnapshotValue(target, actual);
            auto* concrete = readable
                ? SelectAnimationJobClass(api.Name(declared), actual, graph.trustedJobClasses)
                : nullptr;
            result["runtime_class_address"] = PointerText(actual);
            result["status"] = !readable ? "job_header_unreadable"
                : concrete ? "reference_concrete" : "job_class_not_allowlisted";
            if (concrete) {
                result["runtime_type"] = api.Name(concrete);
                result["boxed_value_type"] = api.isValue(concrete);
                result["instance_size"] = api.instanceSize(concrete);
                QueueRuntimeObject(graph, target, concrete, item.depth + 1);
            } else {
                ++graph.skipped;
            }
            auto reference = result;
            reference["owner_address"] = PointerText(item.object);
            reference["owner_type"] = api.Name(item.klass);
            graph.jobReferences.push_back(reference);
            graph.Record({{"event", "animation_job_reference"}, {"reference", reference}});
            return result;
        }
        if (kind == 0x1d) result["collection"] = ReadRuntimeArray(graph, target, declared, -1, item.depth);
        else if (IsSnapshotList(api, declared)) result["collection"] = ReadRuntimeList(graph, target, declared, item.depth);
        else QueueRuntimeObject(graph, target, declared, item.depth + 1);
        return result;
    }

    nlohmann::json InspectPlayable(RuntimeGraph& graph, const GraphItem& owner, const nlohmann::json& field) {
        nlohmann::json result = {{"owner", PointerText(owner.object)}, {"owner_type", graph.api.Name(owner.klass)},
            {"field", field.at("name")}, {"status", "not_inspected"}, {"execution_verified", false},
            {"sampling_semantics", "main_callback_snapshot_not_solver_io"}};
        try {
            const auto handleClass = FindClass({"UnityEngine.CoreModule.dll"}, "UnityEngine.Playables", "PlayableHandle");
            if (!handleClass.klass || graph.trustedJobClasses.empty()) {
                result["status"] = "metadata_missing"; return result;
            }
            const auto& api = graph.api;
            auto* handlePointer = FindSnapshotField(api, handleClass.klass->address, "m_Handle");
            auto* handleVersion = FindSnapshotField(api, handleClass.klass->address, "m_Version");
            std::uint32_t alignment{};
            if (!handlePointer || !handleVersion || api.fieldOffset(handlePointer) != 16
                || api.fieldOffset(handleVersion) != 24 || !api.isValue(handleClass.klass->address)
                || api.valueSize(handleClass.klass->address, &alignment) != sizeof(PlayableHandle64)
                || field.value("size", 0) != sizeof(PlayableHandle64)) {
                result["status"] = "unsupported_handle_layout"; return result;
            }
            const auto offset = field.at("offset").get<std::size_t>();
            std::array<std::uint8_t, 16> bytes{};
            if (!FieldMemoryOffset(offset, api.instanceSize(owner.klass), bytes.size(), SnapshotStorage::ManagedObject)
                || !ReadSnapshotBytes(static_cast<std::uint8_t*>(owner.object) + offset, bytes.data(), bytes.size())) {
                result["status"] = "unreadable_handle"; return result;
            }
            const auto decoded = DecodePlayableHandle(bytes.data(), bytes.size());
            if (!decoded) { result["status"] = "null_handle"; return result; }
            auto handle = *decoded;
            result["handle"] = PointerText(reinterpret_cast<void*>(handle.pointer));
            result["handle_version"] = handle.version;
            const auto declaring = DiagnosticApi<void* (*)(void*)>("il2cpp_method_get_class");
            const auto invoke = DiagnosticApi<void* (*)(void*, void*, void**, void**)>("il2cpp_runtime_invoke");
            const auto unbox = DiagnosticApi<void* (*)(void*)>("il2cpp_object_unbox");
            const auto fromSystemType = DiagnosticApi<void* (*)(void*)>("il2cpp_class_from_system_type");
            const auto invokeGetter = [&](const char* name, const char* returnType) -> void* {
                const UnityResolve::Method* found = nullptr;
                for (const auto* method : handleClass.klass->methods) {
                    if (!method || method->name != name || method->static_function || !method->args.empty()
                        || !method->return_type || method->return_type->name != returnType
                        || declaring(method->address) != handleClass.klass->address) continue;
                    if (found && found->address != method->address) throw std::runtime_error("ambiguous_getter");
                    found = method;
                }
                if (!found) throw std::runtime_error(std::string("getter_missing:") + name);
                void* exception = nullptr;
                auto* value = invoke(found->address, &handle, nullptr, &exception);
                if (exception || !value) throw std::runtime_error(std::string("getter_failed:") + name);
                return value;
            };
            auto* validObject = invokeGetter("IsValid", "System.Boolean");
            void* validClass = nullptr;
            std::uint8_t valid{};
            if (!ReadSnapshotValue(validObject, validClass) || api.Name(validClass) != "System.Boolean"
                || !ReadSnapshotValue(unbox(validObject), valid) || !valid) {
                result["status"] = "invalid_handle"; return result;
            }
            auto* jobClass = fromSystemType(invokeGetter("GetJobType", "System.Type"));
            result["job_type"] = api.Name(jobClass);
            if (std::find(graph.trustedJobClasses.begin(), graph.trustedJobClasses.end(), jobClass)
                == graph.trustedJobClasses.end()) {
                result["status"] = "job_class_not_allowlisted"; return result;
            }
            auto* pointerObject = invokeGetter("GetJobData", "System.IntPtr");
            void* pointerClass = nullptr;
            void* jobData = nullptr;
            if (!ReadSnapshotValue(pointerObject, pointerClass) || api.Name(pointerClass) != "System.IntPtr"
                || !ReadSnapshotValue(unbox(pointerObject), jobData) || !jobData) {
                result["status"] = "null_job_data"; return result;
            }
            const auto size = api.valueSize(jobClass, &alignment);
            if (size <= 0 || size > 65536) { result["status"] = "invalid_job_size"; return result; }
            std::vector<std::uint8_t> copy(size);
            if (!ReadSnapshotBytes(jobData, copy.data(), copy.size())) {
                result["status"] = "unreadable_job_data"; return result;
            }
            result["job_data_address"] = PointerText(jobData);
            result["job_value_size"] = size;
            result["job"] = SnapshotInline(copy.data(), api.typeFromClass(jobClass), api, 0, &graph);
            result["native_arrays"] = nlohmann::json::array();
            void* iterator = nullptr;
            while (auto* member = api.fields(jobClass, &iterator)) {
                if (api.fieldFlags(member) & (0x10 | 0x40)) continue;
                auto* type = api.fieldType(member);
                if (!api.TypeName(type).starts_with("Unity.Collections.NativeArray<")) continue;
                const auto memoryOffset = FieldMemoryOffset(api.fieldOffset(member), copy.size(),
                    sizeof(NativeArrayHeader64), SnapshotStorage::InlineValue);
                if (!memoryOffset) continue;
                result["native_arrays"].push_back({{"name", api.fieldName(member)},
                    {"memory_offset", *memoryOffset}, {"native_array", ReadNativeArray(graph, copy.data() + *memoryOffset, type)}});
            }
            result["status"] = "read";
        } catch (const std::exception& error) {
            result["status"] = "inspection_failed";
            result["error"] = error.what();
        }
        return result;
    }

    nlohmann::json CaptureRuntimeGraph(void* controller) {
        RuntimeGraph graph;
        auto playableJobs = nlohmann::json::array();
        const auto resolved = FindClass({"campus-submodule.Runtime.dll"}, "Campus.Common", "CampusActorController");
        if (!resolved.klass) throw std::runtime_error("controller metadata missing");
        QueueRuntimeObject(graph, controller, resolved.klass->address, 0);
        while (!graph.pending.empty()) {
            const auto item = graph.pending.back();
            graph.pending.pop_back();
            graph.Record({{"event", "object_begin"}, {"address", PointerText(item.object)}, {"type", graph.api.Name(item.klass)}});
            if (!MatchesDeclaredClass(item.object, item.klass)) {
                ++graph.skipped;
                continue;
            }
            nlohmann::json entry = {{"address", PointerText(item.object)}, {"type", graph.api.Name(item.klass)},
                {"fields", nlohmann::json::array()}};
            const auto objectType = graph.api.Name(item.klass);
            if (objectType.find("Bone") != std::string::npos
                && IsUnityObjectClass(graph.api, item.klass)) {
                entry["unity_object"] = UnityObjectIdentity(item.object, objectType);
            }
            auto* declaring = item.klass;
            for (int parentDepth = 0; declaring && parentDepth < 16; ++parentDepth) {
                void* iterator = nullptr;
                std::size_t fieldsRead = 0;
                while (auto* field = graph.api.fields(declaring, &iterator)) {
                    if (++fieldsRead > 256) { ++graph.truncated; break; }
                    auto value = ReadRuntimeField(graph, item, field);
                    value["declaring_type"] = graph.api.Name(declaring);
                    entry["fields"].push_back(std::move(value));
                }
                declaring = graph.api.parent(declaring);
            }
            if (objectType == "ActorAnimation.CampusActorAnimationBuilder") {
                for (const auto& field : entry["fields"]) {
                    if (field.value("type", "") != "UnityEngine.Animations.AnimationScriptPlayable") continue;
                    graph.Record({{"event", "playable_inspection_begin"}, {"owner", entry["address"]}, {"field", field["name"]}});
                    auto playable = InspectPlayable(graph, item, field);
                    graph.Record({{"event", "playable_inspection_complete"}, {"playable", playable}});
                    playableJobs.push_back(std::move(playable));
                }
            }
            graph.Record({{"event", "object_complete"}, {"object", entry}});
            graph.objects.push_back(std::move(entry));
        }
        for (auto& playable : playableJobs) {
            playable["boxed_job_comparisons"] = nlohmann::json::array();
            if (playable.value("status", "") != "read") continue;
            for (const auto& boxed : graph.objects) {
                if (boxed.value("type", "") != playable.value("job_type", "")) continue;
                auto comparisons = nlohmann::json::array();
                for (const auto& native : playable["native_arrays"]) for (const auto& field : boxed["fields"]) {
                    if (field.value("name", "") != native.value("name", "") || !field.contains("native_array")) continue;
                    const auto& first = native["native_array"];
                    const auto& second = field["native_array"];
                    const bool readable = first.contains("buffer_address") && second.contains("buffer_address")
                        && first.contains("length") && second.contains("length")
                        && first.contains("allocator") && second.contains("allocator");
                    const bool same = readable && first["buffer_address"] == second["buffer_address"]
                        && first["length"] == second["length"] && first["allocator"] == second["allocator"];
                    comparisons.push_back({{"name", native["name"]}, {"headers_read", readable}, {"same_buffer_and_shape", same}});
                }
                playable["boxed_job_comparisons"].push_back({{"boxed_job", boxed["address"]},
                    {"association", "same_actor_graph_candidate_not_proven_ownership"}, {"arrays", comparisons}});
            }
        }
        return {{"root", PointerText(controller)}, {"object_count", graph.objects.size()},
            {"physical_list_count", graph.physicalListCount}, {"skipped_count", graph.skipped},
            {"truncation_count", graph.truncated}, {"animation_job_references", std::move(graph.jobReferences)},
            {"targeted_native_list_count", graph.nativeListCount},
            {"playable_jobs", std::move(playableJobs)},
            {"objects", std::move(graph.objects)}};
    }

    std::string PointerText(void* pointer) {
        std::ostringstream text;
        text.imbue(std::locale::classic());
        text << "0x" << std::hex << reinterpret_cast<std::uintptr_t>(pointer);
        return text.str();
    }

    nlohmann::json JsonVector3(const UnityResolve::UnityType::Vector3& value) {
        return {value.x, value.y, value.z};
    }

    nlohmann::json JsonQuaternion(const UnityResolve::UnityType::Quaternion& value) {
        return {value.x, value.y, value.z, value.w};
    }

    bool IsPhysicsTransformName(const std::string& name) {
        static constexpr const char* tokens[] = {
            "Hair", "Skirt", "Jacket", "Poncho", "Bust", "Breast", "Hips", "Pelvis",
            "Spine", "Waist", "Leg", "UpLeg", "Arm", "Hand", "Sleeve", "Shoulder"
        };
        for (const auto* token : tokens) {
            if (name.find(token) != std::string::npos) return true;
        }
        return false;
    }

    std::string TransformPath(UnityResolve::UnityType::Transform* transform,
                              const std::string& leafName) {
        std::vector<std::string> names;
        auto* current = transform;
        for (int depth = 0; current && depth < 24; ++depth) {
            names.push_back(current == transform ? leafName : current->GetName());
            current = current->GetParent();
        }
        std::string path;
        for (auto it = names.rbegin(); it != names.rend(); ++it) {
            if (!path.empty()) path += "/";
            path += *it;
        }
        return path;
    }

    UnityResolve::UnityType::Transform* ActorRootBody(void* controller) {
        if (!controller) return nullptr;
        static auto controllerClass = Il2cppUtils::GetClass(
            "campus-submodule.Runtime.dll", "Campus.Common", "CampusActorController");
        static auto rootBodyField = controllerClass
            ? controllerClass->Get<UnityResolve::Field>("_rootBody") : nullptr;
        if (!rootBodyField) return nullptr;
        return Il2cppUtils::ClassGetFieldValue<UnityResolve::UnityType::Transform*>(
            controller, rootBodyField);
    }

    nlohmann::json CapturePhysicsTransforms(void* controller) {
        nlohmann::json transforms = nlohmann::json::array();
        auto* root = ActorRootBody(controller);
        if (!root) return transforms;

        struct PendingTransform {
            UnityResolve::UnityType::Transform* transform;
            int depth;
        };
        std::vector<PendingTransform> pending{{root, 0}};
        std::unordered_set<void*> visited;
        visited.reserve(512);

        while (!pending.empty() && visited.size() < 1024) {
            const auto current = pending.back();
            pending.pop_back();
            if (!current.transform || !visited.insert(current.transform).second) continue;

            const auto name = current.transform->GetName();
            if (IsPhysicsTransformName(name)) {
                const auto localPosition = current.transform->GetLocalPosition();
                const auto localRotation = current.transform->GetLocalRotation();
                const auto worldPosition = current.transform->GetPosition();
                const auto worldRotation = current.transform->GetRotation();
                transforms.push_back({
                    {"address", PointerText(current.transform)},
                    {"name", name},
                    {"path", TransformPath(current.transform, name)},
                    {"local_position", JsonVector3(localPosition)},
                    {"local_rotation", JsonQuaternion(localRotation)},
                    {"world_position", JsonVector3(worldPosition)},
                    {"world_rotation", JsonQuaternion(worldRotation)}
                });
            }

            if (current.depth >= 32) continue;
            const auto childCount = current.transform->GetChildCount();
            if (childCount < 0 || childCount > 256) continue;
            for (int index = childCount - 1; index >= 0; --index) {
                if (auto* child = current.transform->GetChild(index)) {
                    pending.push_back({child, current.depth + 1});
                }
            }
        }
        return transforms;
    }

    void WriteFrameTrace(const nlohmann::json& record) {
        std::lock_guard lock(frameTraceMutex);
        if (!frameTraceOutput.is_open()) return;
        frameTraceOutput << record.dump(-1, ' ', false, nlohmann::json::error_handler_t::replace) << '\n';
        frameTraceOutput.flush();
        if (!frameTraceOutput) throw std::runtime_error("frame trace write failed");
    }

    nlohmann::json TransformIdentity(UnityResolve::UnityType::Transform* transform) {
        if (!transform) return {{"address", PointerText(nullptr)}};
        const auto name = transform->GetName();
        return {
            {"address", PointerText(transform)},
            {"name", name},
            {"path", TransformPath(transform, name)}
        };
    }

    void FlushAlgorithmTrace() {
        if (!frameTraceOutput.is_open()) return;
        const auto snapshot = algorithmTrace.Snapshot();
        std::string batch;
        for (; algorithmEventsWritten < snapshot.events.size(); ++algorithmEventsWritten) {
            const auto& event = snapshot.events[algorithmEventsWritten];
            const nlohmann::json record = {
                {"event", "algorithm_invocation"}, {"method", AlgorithmNames[static_cast<std::size_t>(event.method)]},
                {"phase", event.exit ? "exit" : "enter"}, {"capture_id", event.captureId}, {"call_id", event.callId},
                {"timestamp_ms", event.timestamp}, {"thread_id", event.thread},
                {"self", PointerText(reinterpret_cast<void*>(event.self))},
                {"animation_stream", PointerText(reinterpret_cast<void*>(event.stream))},
                {"method_info", PointerText(reinterpret_cast<void*>(event.methodInfo))}
            };
            batch += record.dump(-1, ' ', false, nlohmann::json::error_handler_t::replace);
            batch += '\n';
        }
        if (batch.empty()) return;
        std::lock_guard lock(frameTraceMutex);
        frameTraceOutput << batch;
        frameTraceOutput.flush();
        if (!frameTraceOutput) throw std::runtime_error("algorithm trace write failed");
    }

    void CloseFrameTrace(bool completed = false) {
        algorithmTrace.Stop();
        if (frameTraceOutput.is_open()) FlushAlgorithmTrace();
        std::lock_guard lock(frameTraceMutex);
        if (frameTraceOutput.is_open()) frameTraceOutput.flush();
        frameTraceOutput.close();
        frameTraceState.Closed(completed);
        lateUpdateFrameOpen = false;
    }

    void OpenFrameTrace() {
        std::lock_guard lock(frameTraceMutex);
        if (frameTraceOutput.is_open()) return;
        frameTraceOutput.open(captureDirectory / "frame-trace.jsonl",
                              std::ios::out | std::ios::binary | std::ios::trunc);
        if (!frameTraceOutput) {
            throw std::runtime_error("cannot open frame-trace.jsonl");
        }
        const nlohmann::json header = {
            {"event", "header"},
            {"schema_version", 7},
            {"source", "CampusActorController.LateUpdate"},
            {"coordinate_space", "Unity.Transform.local_and_world"},
            {"transform_filter", "physics_named_transforms_under_actor_root_body"},
            {"capture_tick_ms", captureStarted}
        };
        frameTraceOutput << header.dump(-1, ' ', false, nlohmann::json::error_handler_t::replace) << '\n';
        frameTraceOutput.flush();
        if (!frameTraceOutput) {
            throw std::runtime_error("frame-trace header write failed");
        }
        frameTraceState.Opened();
    }

    void* InvokeGetter(void* object, const char* className, const char* getter) {
        if (!object) return nullptr;
        static auto runtimeInvoke = reinterpret_cast<void* (*)(void*, void*, void**, void**)>(
            GetProcAddress(GetModuleHandleW(L"GameAssembly.dll"), "il2cpp_runtime_invoke"));
        if (!runtimeInvoke) return nullptr;
        auto* assembly = UnityResolve::Get("UnityEngine.CoreModule.dll");
        auto* klass = assembly ? assembly->Get(className, "UnityEngine") : nullptr;
        if (!klass) return nullptr;
        for (const auto* method : klass->methods) {
            if (!method || method->name != getter || !method->args.empty() || method->static_function) continue;
            void* exception = nullptr;
            auto* result = runtimeInvoke(method->address, object, nullptr, &exception);
            if (exception) return nullptr;
            return result;
        }
        return nullptr;
    }

    std::string ReadManagedString(void* value) {
        if (!value) return {};
        static auto length = reinterpret_cast<int (*)(void*)>(
            GetProcAddress(GetModuleHandleW(L"GameAssembly.dll"), "il2cpp_string_length"));
        static auto characters = reinterpret_cast<const wchar_t* (*)(void*)>(
            GetProcAddress(GetModuleHandleW(L"GameAssembly.dll"), "il2cpp_string_chars"));
        if (!length || !characters) return {};
        const auto count = length(value);
        if (count <= 0 || count > 4096) return {};
        const auto* buffer = characters(value);
        if (!buffer) return {};
        const auto bytes = WideCharToMultiByte(CP_UTF8, 0, buffer, count, nullptr, 0, nullptr, nullptr);
        if (bytes <= 0) return {};
        std::string result(bytes, '\0');
        WideCharToMultiByte(CP_UTF8, 0, buffer, count, result.data(), bytes, nullptr, nullptr);
        return result;
    }

    nlohmann::json ActorIdentity(void* controller) {
        nlohmann::json actor = {
            {"controller_address", PointerText(controller)},
            {"controller_type", SafeClassName(controller)},
            {"object_name", ReadManagedString(InvokeGetter(controller, "Object", "get_name"))},
            {"transform_ancestors", nlohmann::json::array()},
            {"identity_status", "runtime_names_only_not_verified_idol_id"}
        };
        auto* transform = InvokeGetter(controller, "Component", "get_transform");
        for (int depth = 0; transform && depth < 8; ++depth) {
            actor["transform_ancestors"].push_back(ReadManagedString(InvokeGetter(transform, "Object", "get_name")));
            transform = InvokeGetter(transform, "Transform", "get_parent");
        }
        return actor;
    }

    void WriteRuntimeArtifacts() {
        nlohmann::json runtime = {
            {"schema_version", 6},
            {"capture_mode", "deep_runtime_graph"},
            {"source", "PhysicsDiagnostics.PollCaptureHotkey"},
            {"read_semantics", "read_only_main_thread_snapshot"},
            {"physics_parameters_complete", false},
            {"actors", nlohmann::json::array()}
        };
        for (std::size_t index = 0; index < runtimeActors.size(); ++index) {
            auto actor = runtimeActors[index];
            if (index < captureActors.size()) {
                actor["identity"] = ActorIdentityRecord(captureActors[index]);
            }
            runtime["actors"].push_back(std::move(actor));
        }

        std::ofstream runtimeOutput(captureDirectory / "runtime-data.json",
                                    std::ios::binary | std::ios::trunc);
        runtimeOutput << runtime.dump(2, ' ', false, nlohmann::json::error_handler_t::replace);
        runtimeOutput.flush();
        if (!runtimeOutput) throw std::runtime_error("runtime graph write failed");

        nlohmann::json jobs = {
            {"schema_version", 1},
            {"capture_mode", "playable_job_snapshot"},
            {"source", "CampusActorAnimationBuilder.AnimationScriptPlayable"},
            {"read_semantics", "read_only_main_thread_snapshot"},
            {"actors", nlohmann::json::array()}
        };
        for (std::size_t index = 0; index < runtimeActors.size(); ++index) {
            const auto& actor = runtimeActors[index];
            nlohmann::json job = {
                {"identity", index < captureActors.size()
                    ? ActorIdentityRecord(captureActors[index]) : nlohmann::json::object()},
                {"root", actor.value("root", "")},
                {"object_count", actor.value("object_count", 0)},
                {"animation_job_references", actor.value("animation_job_references", nlohmann::json::array())},
                {"playable_jobs", actor.value("playable_jobs", nlohmann::json::array())}
            };
            jobs["actors"].push_back(std::move(job));
        }
        std::ofstream jobOutput(captureDirectory / "runtime-job-data.json",
                                std::ios::binary | std::ios::trunc);
        jobOutput << jobs.dump(2, ' ', false, nlohmann::json::error_handler_t::replace);
        jobOutput.flush();
        if (!jobOutput) throw std::runtime_error("runtime job write failed");

        runtimeGraphWritten = true;
        runtimeJobWritten = true;
    }

    void WriteCaptureContext(const char* status) {
        const auto algorithmSnapshot = algorithmTrace.Snapshot();
        nlohmann::json algorithmCompletedCallCounts = nlohmann::json::object();
        nlohmann::json algorithmInvocationCounts = nlohmann::json::object();
        nlohmann::json algorithmInvocationPhaseCounts = nlohmann::json::object();
        nlohmann::json algorithmLifetimeCounts = nlohmann::json::object();
        for (std::size_t index = 0; index < AlgorithmNames.size(); ++index) {
            const auto method = static_cast<AlgorithmMethod>(index);
            const auto name = AlgorithmNames[index];
            algorithmCompletedCallCounts[name] = algorithmSnapshot.completed[index];
            const auto lifetime = algorithmTrace.Lifetime(method);
            algorithmLifetimeCounts[name] = {
                {"enter", lifetime.entries}, {"exit", lifetime.exits}
            };
        }
        for (const auto& event : algorithmSnapshot.events) {
            const auto method = AlgorithmNames[static_cast<std::size_t>(event.method)];
            const auto phase = event.exit ? "exit" : "enter";
            algorithmInvocationCounts[method] = algorithmInvocationCounts.value(method, 0) + 1;
            const auto phaseKey = std::string(method) + ":" + phase;
            algorithmInvocationPhaseCounts[phaseKey] = algorithmInvocationPhaseCounts.value(phaseKey, 0) + 1;
        }
        const auto completed = [&](AlgorithmMethod method) {
            return algorithmSnapshot.completed[static_cast<std::size_t>(method)] > 0;
        };
        const auto quartzJobExecutionVerified = completed(AlgorithmMethod::QuartzSkirt)
            || completed(AlgorithmMethod::QuartzHair)
            || completed(AlgorithmMethod::QuartzPoncho);
        const auto processEntryExecutionVerified = completed(AlgorithmMethod::ProcessQuartz)
            && completed(AlgorithmMethod::ProcessSwing);
        const auto algorithmExecutionVerified = completed(AlgorithmMethod::ProcessQuartz)
            || completed(AlgorithmMethod::ProcessSwing) || quartzJobExecutionVerified;
        nlohmann::json context = {
            {"schema_version", 25}, {"build", "deep-runtime-snapshot-v25"}, {"trigger", "F8"},
            {"status", status}, {"process_id", GetCurrentProcessId()},
            {"capture_tick_ms", captureStarted}, {"thread_id", GetCurrentThreadId()},
            {"actor_scope", "controllers_observed_during_capture_not_visibility_filtered"},
            {"algorithm_scope", "shared_runtime_methods_not_per_idol"},
            {"algorithm_hooks", algorithmHookAudit},
            {"algorithm_execution_verified", algorithmExecutionVerified},
            {"process_entry_execution_verified", processEntryExecutionVerified},
            {"quartz_job_execution_verified", quartzJobExecutionVerified},
            {"animation_dispatch_execution_verified", completed(AlgorithmMethod::ProcessAnimation)},
            {"algorithm_io_verified", false},
            {"algorithm_completed_call_counts", algorithmCompletedCallCounts},
            {"algorithm_invocation_count", algorithmSnapshot.events.size()},
            {"algorithm_invocation_counts", algorithmInvocationCounts},
            {"algorithm_invocation_phase_counts", algorithmInvocationPhaseCounts},
            {"algorithm_events_dropped", algorithmSnapshot.dropped},
            {"algorithm_lifetime_counts", algorithmLifetimeCounts},
            {"algorithm_recorder_errors", algorithmRecorderErrors.load(std::memory_order_relaxed)},
            {"shared_solver_exported", false},
            {"parameter_file", "idol-parameters.json"},
            {"runtime_graph_file", "runtime-data.json"},
            {"runtime_job_file", "runtime-job-data.json"},
            {"runtime_graph_written", runtimeGraphWritten},
            {"runtime_job_written", runtimeJobWritten},
            {"physics_parameters_complete", false},
            {"frame_trace_file", "frame-trace.jsonl"},
            {"frame_trace_ready", frameTraceState.ready},
            {"frame_trace_available", frameTraceState.available},
            {"frame_count", frameCount},
            {"transform_write_count", transformWriteCount},
            {"runtime_snapshot_written", runtimeSnapshotReady},
            {"targeted_native_list_count", runtimeNativeListCount},
            {"actors", nlohmann::json::array()}
        };
        for (const auto& actor : captureActors) context["actors"].push_back(ActorIdentityRecord(actor));
        std::ofstream output(captureDirectory / "capture.json", std::ios::binary | std::ios::trunc);
        output << context.dump(2, ' ', false, nlohmann::json::error_handler_t::replace);
        output.flush();
        if (!output) throw std::runtime_error("cannot write capture.json");
    }

    std::string SafeFilePart(const std::string& value) {
        std::string result = value;
        for (auto& character : result) {
            if (!(std::isalnum(static_cast<unsigned char>(character)) || character == '_' || character == '-')) {
                character = '_';
            }
        }
        return result;
    }

    std::filesystem::path NativeCodeDirectory() {
        return captureDirectory;
    }

    bool IsExecutableProtection(const DWORD protection) {
        const auto baseProtection = protection & 0xff;
        return baseProtection == PAGE_EXECUTE || baseProtection == PAGE_EXECUTE_READ
            || baseProtection == PAGE_EXECUTE_READWRITE || baseProtection == PAGE_EXECUTE_WRITECOPY;
    }

    std::string ByteHex(const std::uint8_t* bytes, std::size_t size) {
        std::ostringstream output;
        output.imbue(std::locale::classic());
        output << std::hex << std::setfill('0');
        for (std::size_t index = 0; index < size; ++index) {
            output << std::setw(2) << static_cast<unsigned>(bytes[index]);
        }
        return output.str();
    }

    void CaptureNativeDataReferences(const char* assembly, const char* nameSpace,
                                    const char* className, const UnityResolve::Method* method,
                                    const std::uint8_t* code, std::size_t codeSize,
                                    std::uintptr_t codeAddress, HMODULE moduleBase) {
        const auto references = DecodeRipRelativeReferences(code, codeSize);
        if (references.empty()) return;
        std::ofstream output(captureDirectory / "native-data-references.jsonl",
                             std::ios::out | std::ios::app);
        if (!output) throw std::runtime_error("native data reference file failed");
        for (const auto& reference : references) {
            const auto instructionAddress = codeAddress + reference.instructionOffset;
            const auto targetAddress = instructionAddress + reference.instructionSize
                + static_cast<std::int64_t>(reference.displacement);
            MEMORY_BASIC_INFORMATION targetMemory{};
            std::array<std::uint8_t, 32> data{};
            SIZE_T bytesRead = 0;
            const bool queried = VirtualQuery(reinterpret_cast<void*>(targetAddress),
                                              &targetMemory, sizeof(targetMemory)) != 0;
            const auto protection = queried ? targetMemory.Protect & 0xff : 0;
            const bool readable = queried && targetMemory.State == MEM_COMMIT
                && !(targetMemory.Protect & PAGE_GUARD)
                && (protection == PAGE_READONLY || protection == PAGE_READWRITE
                    || protection == PAGE_WRITECOPY || protection == PAGE_EXECUTE_READ
                    || protection == PAGE_EXECUTE_READWRITE || protection == PAGE_EXECUTE_WRITECOPY)
                && ReadProcessMemory(GetCurrentProcess(), reinterpret_cast<void*>(targetAddress),
                                     data.data(), data.size(), &bytesRead)
                && bytesRead == data.size();
            nlohmann::json record = {
                {"assembly", assembly}, {"namespace", nameSpace}, {"class", className},
                {"method", method ? method->name : "<null>"},
                {"instruction_address", PointerText(reinterpret_cast<void*>(instructionAddress))},
                {"instruction_size", reference.instructionSize},
                {"displacement", reference.displacement},
                {"target_address", PointerText(reinterpret_cast<void*>(targetAddress))},
                {"module_base", PointerText(moduleBase)},
                {"module_rva", targetAddress >= reinterpret_cast<std::uintptr_t>(moduleBase)
                    ? targetAddress - reinterpret_cast<std::uintptr_t>(moduleBase) : 0},
                {"status", readable ? "read" : "unreadable"},
            };
            if (readable) record["raw_hex"] = ByteHex(data.data(), data.size());
            output << record.dump(-1, ' ', false, nlohmann::json::error_handler_t::replace) << '\n';
        }
        output.flush();
    }

    void CaptureNativeCallReferences(const char* assembly, const char* nameSpace,
                                     const char* className, const UnityResolve::Method* method,
                                     const std::uint8_t* code, std::size_t codeSize,
                                     std::uintptr_t codeAddress, HMODULE moduleBase) {
        const auto references = DecodeDirectCallReferences(code, codeSize);
        if (references.empty()) return;
        std::ofstream output(captureDirectory / "native-call-references.jsonl", std::ios::out | std::ios::app);
        if (!output) throw std::runtime_error("native call reference file failed");
        for (const auto& reference : references) {
            const auto instructionAddress = codeAddress + reference.instructionOffset;
            const auto targetAddress = instructionAddress + reference.instructionSize
                + static_cast<std::int64_t>(reference.displacement);
            output << nlohmann::json({
                {"assembly", assembly}, {"namespace", nameSpace}, {"class", className},
                {"method", method ? method->name : "<null>"}, {"instruction_address", PointerText(reinterpret_cast<void*>(instructionAddress))},
                {"instruction_size", reference.instructionSize}, {"displacement", reference.displacement},
                {"target_address", PointerText(reinterpret_cast<void*>(targetAddress))},
                {"module_base", PointerText(moduleBase)},
                {"module_rva", targetAddress >= reinterpret_cast<std::uintptr_t>(moduleBase)
                    ? targetAddress - reinterpret_cast<std::uintptr_t>(moduleBase) : 0}
            }).dump(-1, ' ', false, nlohmann::json::error_handler_t::replace) << '\n';
        }
    }

    std::size_t CaptureNativeScanSize(std::uintptr_t address, std::size_t available) {
        DWORD64 imageBase = 0;
        const auto* function = RtlLookupFunctionEntry(address, &imageBase, nullptr);
        const auto begin = function ? imageBase + function->BeginAddress : 0;
        const auto end = function ? imageBase + function->EndAddress : 0;
        const auto size = NativeScanSize(address, begin, end, available);
        const bool entryBounded = begin == address && end > begin;
        const bool interior = begin < address && end > address;
        const bool unknownCapped = !entryBounded && !interior && available >= 64 * 1024;
        if (unknownCapped) ++nativeHelperUnknownCapped;
        std::ofstream audit(captureDirectory / "native-scan-ranges.jsonl", std::ios::out | std::ios::app);
        if (!audit) throw std::runtime_error("native scan audit open failed");
        audit << nlohmann::json({
            {"address", PointerText(reinterpret_cast<void*>(address))},
            {"scan_bytes", size}, {"captured_bytes", available},
            {"boundary_source", entryBounded ? "windows_unwind"
                : interior ? "windows_unwind_interior" : "fixed_window_unknown_boundary"},
            {"function_end", PointerText(reinterpret_cast<void*>(end))},
            {"truncated", (entryBounded || interior) && end > address && end - address > available},
            {"unknown_boundary_capped", unknownCapped}
        }).dump() << '\n';
        audit.flush();
        if (!audit) throw std::runtime_error("native scan audit write failed");
        return size;
    }

    void EnqueueSplitBodies(std::uintptr_t address, const std::uint8_t* code, std::size_t size,
                            unsigned depth, unsigned hop) {
        if (hop >= kMaxSplitBodyHops) return;
        for (const auto split : CollectSplitBodyTargets(address, code, size)) {
            nativeHelperQueue.Enqueue(split, depth, address, hop + 1);
        }
    }

    void EnqueueDirectCalls(std::uintptr_t address, const std::uint8_t* code, std::size_t size,
                            unsigned depth, unsigned callLevel, std::uintptr_t radius = 0) {
        for (const auto& reference : DecodeDirectCallReferences(code, size)) {
            const auto instructionAddress = address + reference.instructionOffset;
            const auto nextTarget = static_cast<std::uintptr_t>(
                static_cast<std::intptr_t>(instructionAddress + reference.instructionSize) + reference.displacement);
            if (radius != 0 && !IsWithinCallRadius(address, nextTarget, radius)) continue;
            nativeHelperQueue.Enqueue(nextTarget, depth, address, 0, callLevel);
        }
    }

    const char* CaptureNativeHelperCode(std::uintptr_t targetAddress, unsigned depth, unsigned hop, unsigned callLevel) {
        MEMORY_BASIC_INFORMATION memoryInfo{};
        if (!VirtualQuery(reinterpret_cast<void*>(targetAddress), &memoryInfo, sizeof(memoryInfo))
            || memoryInfo.State != MEM_COMMIT || !IsExecutableProtection(memoryInfo.Protect)) return "not_executable";
        const auto regionEnd = reinterpret_cast<std::uintptr_t>(memoryInfo.BaseAddress) + memoryInfo.RegionSize;
        const auto available = regionEnd > targetAddress ? regionEnd - targetAddress : 0;
        DWORD64 imageBase = 0;
        const auto* function = RtlLookupFunctionEntry(targetAddress, &imageBase, nullptr);
        const auto functionBegin = function ? imageBase + function->BeginAddress : 0;
        const auto functionEnd = function ? imageBase + function->EndAddress : 0;
        const auto requested = hop == 0
            ? NativeHelperReadSize(targetAddress, functionBegin, functionEnd, available)
            : NativeContinuationReadSize(targetAddress, functionBegin, functionEnd, available);
        const auto minimum = hop == 0 ? std::size_t{16} : std::size_t{1};
        if (requested < minimum) return "insufficient_readable_bytes";

        std::vector<std::uint8_t> bytes(requested);
        SIZE_T bytesRead = 0;
        if (!ReadProcessMemory(GetCurrentProcess(), reinterpret_cast<void*>(targetAddress), bytes.data(), requested, &bytesRead)
            || bytesRead < minimum) return "read_failed";
        for (const auto& saved : savedHookCode) {
            const auto begin = (std::max)(targetAddress, saved.address);
            const auto end = (std::min)(targetAddress + bytesRead, saved.address + saved.bytes.size());
            if (end > begin) std::copy_n(saved.bytes.begin() + (begin - saved.address), end - begin,
                                        bytes.begin() + (begin - targetAddress));
        }

        const auto scanSize = CaptureNativeScanSize(targetAddress, bytesRead);
        bytes.resize(scanSize);

        std::ostringstream addressText;
        addressText.imbue(std::locale::classic());
        addressText << std::hex << std::uppercase << targetAddress;
        const auto fileName = "native-helper__" + addressText.str() + ".bin";
        const auto filePath = NativeCodeDirectory() / fileName;
        std::ofstream output(filePath, std::ios::binary | std::ios::trunc);
        if (!output) throw std::runtime_error("native helper file open failed");
        output.write(reinterpret_cast<const char*>(bytes.data()), static_cast<std::streamsize>(bytes.size()));
        output.flush();
        if (!output) throw std::runtime_error("native helper file write failed");

        CaptureNativeDataReferences("runtime-native", "Native", "CallTarget", nullptr,
                                   bytes.data(), scanSize, targetAddress,
                                   reinterpret_cast<HMODULE>(memoryInfo.AllocationBase));
        CaptureNativeCallReferences("runtime-native", "Native", "CallTarget", nullptr,
                                    bytes.data(), scanSize, targetAddress,
                                    reinterpret_cast<HMODULE>(memoryInfo.AllocationBase));
        std::ofstream manifest(captureDirectory / "native-helper-manifest.tsv", std::ios::out | std::ios::app);
        manifest.imbue(std::locale::classic());
        manifest << "runtime-native\tNative\tCallTarget\tCallTarget_" << addressText.str()
                 << "\tnative(void)\t0x" << addressText.str() << '\t' << bytes.size() << '\t'
                 << filePath.filename().string() << '\n';
        manifest.flush();
        if (!manifest) throw std::runtime_error("native helper manifest write failed");
        ++nativeHelperCodeCount;

        const bool unwindBounded = functionBegin == targetAddress && functionEnd > functionBegin;
        if (ShouldEnqueueCalls(depth, hop)) {
            EnqueueDirectCalls(targetAddress, bytes.data(), scanSize, NextCallDepth(depth), NextCallLevel(depth, hop));
        } else if (ShouldFollowBoundedCallee(callLevel, unwindBounded)
                   || ShouldFollowDepthCapCallee(depth, hop, callLevel, unwindBounded)) {
            EnqueueDirectCalls(targetAddress, bytes.data(), scanSize, depth, callLevel == 0 ? 1 : callLevel + 1);
        } else if (ShouldFollowLocalUnboundedCallee(callLevel, unwindBounded)) {
            EnqueueDirectCalls(targetAddress, bytes.data(), scanSize, depth, callLevel + 1, kLocalCallRadius);
        }
        EnqueueSplitBodies(targetAddress, bytes.data(), scanSize, depth, hop);
        return "captured";
    }

    void CaptureQueuedNativeHelpers() {
        std::ofstream audit(captureDirectory / "native-helper-audit.jsonl", std::ios::out | std::ios::app);
        if (!audit) throw std::runtime_error("native helper audit open failed");
        NativeHelperTarget target{};
        while (nativeHelperCodeCount < kMaxNativeHelpers && nativeHelperQueue.Pop(target)) {
            const auto* status = CaptureNativeHelperCode(target.address, target.depth, target.hop, target.callLevel);
            audit << nlohmann::json({
                {"address", PointerText(reinterpret_cast<void*>(target.address))},
                {"source", PointerText(reinterpret_cast<void*>(target.source))},
                {"depth", target.depth}, {"hop", target.hop}, {"call_level", target.callLevel}, {"status", status}
            }).dump() << '\n';
        }
        audit.flush();
        if (!audit) throw std::runtime_error("native helper audit write failed");
    }

    void CaptureNativeCode(const char* assembly, const char* nameSpace,
                           const char* className, const UnityResolve::Method* method) {
        if (!method || !method->function) {
            Log::InfoFmt("PHYSICS_DIAG native_code_missing class=%s method=%s",
                         className, method ? method->name.c_str() : "<null>");
            return;
        }

        MEMORY_BASIC_INFORMATION memoryInfo{};
        if (!VirtualQuery(method->function, &memoryInfo, sizeof(memoryInfo))
            || memoryInfo.State != MEM_COMMIT || !IsExecutableProtection(memoryInfo.Protect)) {
            Log::InfoFmt("PHYSICS_DIAG native_code_unreadable class=%s method=%s addr=%p",
                         className, method->name.c_str(), method->function);
            return;
        }

        const auto address = reinterpret_cast<std::uintptr_t>(method->function);
        const auto regionEnd = reinterpret_cast<std::uintptr_t>(memoryInfo.BaseAddress) + memoryInfo.RegionSize;
        const auto available = regionEnd > address ? regionEnd - address : 0;
        const auto requested = available < 4096 ? available : 4096;
        if (requested == 0) return;

        std::vector<std::uint8_t> bytes(requested);
        SIZE_T bytesRead = 0;
        if (!ReadProcessMemory(GetCurrentProcess(), method->function, bytes.data(), requested, &bytesRead)
            || bytesRead == 0) {
            Log::InfoFmt("PHYSICS_DIAG native_code_read_failed class=%s method=%s addr=%p error=%lu",
                         className, method->name.c_str(), method->function, GetLastError());
            return;
        }

        for (const auto& saved : savedHookCode) {
            const auto begin = (std::max)(address, saved.address);
            const auto end = (std::min)(address + bytesRead, saved.address + saved.bytes.size());
            if (end > begin) std::copy_n(saved.bytes.begin() + (begin - saved.address), end - begin,
                                        bytes.begin() + (begin - address));
        }

        const auto scanSize = CaptureNativeScanSize(address, bytesRead);
        bytes.resize(scanSize);

        std::ostringstream addressText;
        addressText.imbue(std::locale::classic());
        addressText << std::hex << std::uppercase << address;
        const auto fileName = SafeFilePart(assembly) + "__" + SafeFilePart(nameSpace) + "__"
            + SafeFilePart(className) + "__" + SafeFilePart(method->name) + "__" + addressText.str() + ".bin";
        const auto filePath = NativeCodeDirectory() / fileName;
        std::ofstream output(filePath, std::ios::binary | std::ios::trunc);
        if (!output) {
            Log::InfoFmt("PHYSICS_DIAG native_code_file_failed file=%s", filePath.string().c_str());
            return;
        }
        output.write(reinterpret_cast<const char*>(bytes.data()), static_cast<std::streamsize>(bytes.size()));
        output.flush();
        if (!output) throw std::runtime_error("native code write failed");

        CaptureNativeDataReferences(assembly, nameSpace, className, method, bytes.data(),
                                    scanSize, address, static_cast<HMODULE>(memoryInfo.AllocationBase));
        CaptureNativeCallReferences(assembly, nameSpace, className, method, bytes.data(),
                                     scanSize, address, static_cast<HMODULE>(memoryInfo.AllocationBase));
        for (const auto& reference : DecodeDirectCallReferences(bytes.data(), scanSize)) {
            const auto instructionAddress = address + reference.instructionOffset;
            const auto targetAddress = instructionAddress + reference.instructionSize
                + static_cast<std::int64_t>(reference.displacement);
            nativeHelperQueue.Enqueue(targetAddress, 0, address);
        }
        EnqueueSplitBodies(address, bytes.data(), scanSize, 0, 0);

        const auto manifestPath = NativeCodeDirectory() / "manifest.tsv";
        std::ofstream manifest(manifestPath, std::ios::out | std::ios::app);
        manifest.imbue(std::locale::classic());
        manifest << assembly << '\t' << nameSpace << '\t' << className << '\t' << method->name << '\t'
                 << MethodSignature(method) << '\t' << method->function << '\t' << bytes.size() << '\t'
                 << filePath.filename().string() << '\n';
        manifest.flush();
        if (!manifest) throw std::runtime_error("manifest write failed");
        Log::InfoFmt("PHYSICS_DIAG native_code_dumped assembly=%s class=%s method=%s signature=%s addr=%p bytes=%zu file=%s",
                     assembly, className, method->name.c_str(), MethodSignature(method).c_str(),
                     method->function, static_cast<size_t>(bytesRead), filePath.string().c_str());
    }
#endif

    void CaptureTargetMethods(std::initializer_list<const char*> assemblies,
                              const char* nameSpace, const char* className,
                              std::initializer_list<const char*> methodNames) {
        const auto resolved = FindClass(assemblies, nameSpace, className);
        if (!resolved.klass) {
            Log::InfoFmt("PHYSICS_DIAG target_missing namespace=%s name=%s", nameSpace, className);
            return;
        }
        for (const auto* methodName : methodNames) {
            bool found = false;
            for (const auto* method : resolved.klass->methods) {
                if (!method || method->name != methodName) continue;
                found = true;
#ifdef GKMS_WINDOWS
                CaptureNativeCode(resolved.assembly, nameSpace, className, method);
#else
                Log::InfoFmt("PHYSICS_DIAG target_method assembly=%s class=%s method=%s signature=%s addr=%p",
                             resolved.assembly, className, method->name.c_str(), MethodSignature(method).c_str(), method->function);
#endif
            }
            if (!found) {
                Log::InfoFmt("PHYSICS_DIAG target_method_missing assembly=%s class=%s method=%s",
                             resolved.assembly, className, methodName);
            }
        }
    }
}

void PollCaptureHotkey(void* controller) {
#ifdef GKMS_WINDOWS
    static bool keyWasDown = true;
    static bool busy = false;
    static DWORD ownerThread = GetCurrentThreadId();
    if (GetCurrentThreadId() != ownerThread || busy) return;
    const bool keyDown = (GetAsyncKeyState(VK_F8) & 0x8000) != 0;
    DWORD foregroundProcess = 0;
    GetWindowThreadProcessId(GetForegroundWindow(), &foregroundProcess);
    const bool pressed = keyDown && !keyWasDown && foregroundProcess == GetCurrentProcessId();
    keyWasDown = keyDown;
    busy = true;
    try {
        if (pressed && !collectingActors) {
            SYSTEMTIME utc{};
            GetSystemTime(&utc);
            std::ostringstream folder;
            folder.imbue(std::locale::classic());
            folder << "capture-" << utc.wYear << '-' << utc.wMonth << '-' << utc.wDay << '-'
                   << utc.wHour << '-' << utc.wMinute << '-' << utc.wSecond << '-'
                   << GetCurrentProcessId() << '-' << GetTickCount64();
            auto root = gakumasLocalPath.empty() ? std::filesystem::path("gakumas-local") : gakumasLocalPath;
            captureDirectory = root / "physics-diagnostics" / folder.str();
            if (!std::filesystem::create_directories(captureDirectory)) {
                throw std::runtime_error("capture directory already exists");
            }
            observedActors.clear();
            runtimeActors = nlohmann::json::array();
            captureActors = nlohmann::json::array();
            captureStarted = GetTickCount64();
            CloseFrameTrace();
            frameTraceState.Begin(algorithmTrace);
            frameSequence = 0;
            frameCount = 0;
            transformWriteCount = 0;
            nativeHelperCodeCount = 0;
            nativeHelperUnknownCapped = 0;
            algorithmEventsWritten = 0;
            runtimeSnapshotReady = false;
            runtimeGraphWritten = false;
            runtimeJobWritten = false;
            runtimeObjectCount = 0;
            runtimePhysicalListCount = 0;
            runtimeNativeListCount = 0;
            collectingActors = true;
            WriteCaptureContext("collecting");
            Log::InfoFmt("PHYSICS_DIAG capture_begin key=F8 directory=%s", captureDirectory.string().c_str());
        }
        if (collectingActors && controller && observedActors.size() < 64
            && observedActors.insert(reinterpret_cast<std::uintptr_t>(controller)).second) {
            auto identity = ActorIdentity(controller);
            Log::InfoFmt("PHYSICS_DIAG capture_actor controller=%p name=%s", controller,
                         identity["object_name"].get<std::string>().c_str());
            captureActors.push_back(std::move(identity));
            WriteCaptureContext("reading_typed_runtime_snapshot");
            auto snapshot = CaptureRuntimeGraph(controller);
            runtimeObjectCount += snapshot["object_count"].get<std::size_t>();
            runtimePhysicalListCount += snapshot["physical_list_count"].get<std::size_t>();
            runtimeNativeListCount += snapshot.value("targeted_native_list_count", std::size_t{0});
            runtimeActors.push_back(std::move(snapshot));
            const auto parameters = ProjectIdolParameters(runtimeActors, captureActors);
            std::ofstream runtimeOutput(captureDirectory / "idol-parameters.json", std::ios::binary | std::ios::trunc);
            runtimeOutput << parameters.dump(2, ' ', false, nlohmann::json::error_handler_t::replace);
            runtimeOutput.flush();
            if (!runtimeOutput) throw std::runtime_error("idol parameter write failed");
            WriteRuntimeArtifacts();
            runtimeSnapshotReady = true;
            captureStarted = GetTickCount64();
            OpenFrameTrace();
            WriteCaptureContext("collecting");
        }
        if (collectingActors) FlushAlgorithmTrace();
        if (collectingActors && GetTickCount64() - captureStarted >= 3000) {
            collectingActors = false;
            algorithmTrace.Stop();
            WriteCaptureContext("exporting");
            WriteRuntimeArtifacts();
            CloseFrameTrace(true);
            WriteCaptureContext("export_finished_idol_parameters");
            Log::Info("PHYSICS_DIAG runtime_export=complete files=idol-parameters.json,runtime-data.json,runtime-job-data.json,capture.json");
            Log::InfoFmt("PHYSICS_DIAG capture_end actors=%zu directory=%s", captureActors.size(),
                         captureDirectory.string().c_str());
        }
    } catch (const std::exception& error) {
        collectingActors = false;
        CloseFrameTrace();
        try { WriteCaptureContext("failed_check_log_and_runtime_progress"); } catch (...) {}
        Log::ErrorFmt("PHYSICS_DIAG capture_failed reason=%s", error.what());
    } catch (...) {
        collectingActors = false;
        CloseFrameTrace();
        try { WriteCaptureContext("failed_check_log_and_runtime_progress"); } catch (...) {}
        Log::Error("PHYSICS_DIAG capture_failed reason=unknown_native_exception");
    }
    busy = false;
#endif
}

void BeginLateUpdateFrame(void* controller) {
#ifdef GKMS_WINDOWS
    if (!collectingActors || !frameTraceState.active || lateUpdateFrameOpen || !controller) return;
    lateUpdateFrameOpen = true;
    const auto frameId = ++frameSequence;
    ++frameCount;
    WriteFrameTrace({
        {"event", "frame_state"},
        {"frame_id", frameId},
        {"phase", "input"},
        {"timestamp_ms", GetTickCount64()},
        {"thread_id", GetCurrentThreadId()},
        {"controller", PointerText(controller)},
        {"transforms", CapturePhysicsTransforms(controller)}
    });
#else
    (void)controller;
#endif
}

void EndLateUpdateFrame(void* controller) {
#ifdef GKMS_WINDOWS
    if (!lateUpdateFrameOpen || !controller) return;
    WriteFrameTrace({
        {"event", "frame_state"},
        {"frame_id", frameSequence},
        {"phase", "output"},
        {"timestamp_ms", GetTickCount64()},
        {"thread_id", GetCurrentThreadId()},
        {"controller", PointerText(controller)},
        {"transforms", CapturePhysicsTransforms(controller)}
    });
    lateUpdateFrameOpen = false;
#else
    (void)controller;
#endif
}

void RecordTransformWrite(void* transform, const char* operation,
                          const void* value, std::size_t valueSize) {
#ifdef GKMS_WINDOWS
    if (!lateUpdateFrameOpen || !transform || !operation || !value) return;
    auto* unityTransform = reinterpret_cast<UnityResolve::UnityType::Transform*>(transform);
    const auto identity = TransformIdentity(unityTransform);
    const auto name = identity.value("name", std::string{});
    if (!IsPhysicsTransformName(name)) return;

    nlohmann::json record = {
        {"event", "transform_write"},
        {"frame_id", frameSequence},
        {"phase", "during_original_late_update"},
        {"timestamp_ms", GetTickCount64()},
        {"thread_id", GetCurrentThreadId()},
        {"operation", operation},
        {"transform", identity}
    };
    if (valueSize == sizeof(UnityResolve::UnityType::Vector3)) {
        record["value"] = JsonVector3(*reinterpret_cast<const UnityResolve::UnityType::Vector3*>(value));
    } else if (valueSize == sizeof(UnityResolve::UnityType::Quaternion)) {
        record["value"] = JsonQuaternion(*reinterpret_cast<const UnityResolve::UnityType::Quaternion*>(value));
    } else {
        record["value_status"] = "unsupported_size";
        record["value_size"] = valueSize;
    }
    WriteFrameTrace(record);
    ++transformWriteCount;
#else
    (void)transform;
    (void)operation;
    (void)value;
    (void)valueSize;
#endif
}

namespace {
#ifdef GKMS_WINDOWS
    using AnimationJobFunction = void (*)(void*, void*, void*);
    std::array<AnimationJobFunction, AlgorithmNames.size()> originalAlgorithmFunctions{};

    template<AlgorithmMethod Method>
    void AlgorithmHook(void* self, void* stream, void* methodInfo) {
        AlgorithmEvent token{};
        try {
            token = algorithmTrace.Begin(Method, reinterpret_cast<std::uintptr_t>(self),
                reinterpret_cast<std::uintptr_t>(stream), reinterpret_cast<std::uintptr_t>(methodInfo),
                GetCurrentThreadId(), GetTickCount64());
        } catch (...) { algorithmRecorderErrors.fetch_add(1, std::memory_order_relaxed); }
        originalAlgorithmFunctions[static_cast<std::size_t>(Method)](self, stream, methodInfo);
        try {
            algorithmTrace.End(Method, token, GetCurrentThreadId(), GetTickCount64());
        } catch (...) { algorithmRecorderErrors.fetch_add(1, std::memory_order_relaxed); }
    }

    void InstallAlgorithmHook(AlgorithmMethod id, const char* assemblyName, const char* className,
                              const char* methodName, AnimationJobFunction hook) {
        nlohmann::json audit = {{"method", AlgorithmNames[static_cast<std::size_t>(id)]},
            {"assembly", assemblyName}, {"class", className}, {"status", "method_missing_or_signature_rejected"}};
        const auto finish = [&] {
            Log::InfoFmt("PHYSICS_DIAG algorithm_hook_audit %s", audit.dump().c_str());
            algorithmHookAudit.push_back(audit);
        };
        auto* klass = Il2cppUtils::GetClass(assemblyName, "ActorAnimation", className);
        const auto declaringClass = reinterpret_cast<void* (*)(void*)>(
            GetProcAddress(GetModuleHandleW(L"GameAssembly.dll"), "il2cpp_method_get_class"));
        if (!klass || !declaringClass) { finish(); return; }
        std::vector<const UnityResolve::Method*> candidates;
        for (const auto* method : klass->methods) {
            if (!method || method->name != methodName || method->static_function || (method->flags & 0x400)
                || method->args.size() != 1 || !method->function || !method->return_type
                || method->return_type->name != "System.Void" || !method->args[0] || !method->args[0]->pType
                || method->args[0]->pType->name != "UnityEngine.Animations.AnimationStream"
                || declaringClass(method->address) != klass->address) continue;
            if (std::none_of(candidates.begin(), candidates.end(), [&](const auto* candidate) {
                return candidate->function == method->function;
            })) candidates.push_back(method);
        }
        audit["candidate_count"] = candidates.size();
        if (candidates.size() != 1) { finish(); return; }
        auto* target = candidates.front()->function;
        audit["address"] = PointerText(target);
        audit["signature"] = MethodSignature(candidates.front());
        if (std::any_of(savedHookCode.begin(), savedHookCode.end(), [&](const auto& saved) {
            return saved.address == reinterpret_cast<std::uintptr_t>(target);
        })) { audit["status"] = "shared_address_rejected"; finish(); return; }
        MEMORY_BASIC_INFORMATION memory{};
        SavedHookCode saved{reinterpret_cast<std::uintptr_t>(target), {}};
        SIZE_T read = 0;
        if (!VirtualQuery(target, &memory, sizeof(memory)) || memory.State != MEM_COMMIT
            || !IsExecutableProtection(memory.Protect) || (memory.Protect & PAGE_GUARD)
            || !ReadProcessMemory(GetCurrentProcess(), target, saved.bytes.data(), saved.bytes.size(), &read)
            || read != saved.bytes.size()) {
            audit["status"] = "unreadable_code"; finish(); return;
        }
        char modulePath[MAX_PATH]{};
        GetModuleFileNameA(static_cast<HMODULE>(memory.AllocationBase), modulePath, MAX_PATH);
        audit["module"] = modulePath;
        audit["module_base"] = PointerText(memory.AllocationBase);
        audit["rva"] = saved.address - reinterpret_cast<std::uintptr_t>(memory.AllocationBase);
        savedHookCode.push_back(saved);
        auto& original = originalAlgorithmFunctions[static_cast<std::size_t>(id)];
        const auto created = MH_CreateHook(target, reinterpret_cast<void*>(hook), reinterpret_cast<void**>(&original));
        audit["create_status"] = MH_StatusToString(created);
        if (created != MH_OK) { audit["status"] = "create_failed"; finish(); return; }
        const auto enabled = MH_EnableHook(target);
        audit["enable_status"] = MH_StatusToString(enabled);
        audit["trampoline"] = PointerText(reinterpret_cast<void*>(original));
        audit["status"] = enabled == MH_OK ? "enabled" : "enable_failed";
        if (enabled != MH_OK) MH_RemoveHook(target);
        finish();
    }

    void WriteModuleInventory() {
        const auto snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPMODULE, GetCurrentProcessId());
        if (snapshot == INVALID_HANDLE_VALUE) return;
        nlohmann::json modules = nlohmann::json::array();
        MODULEENTRY32W entry{};
        entry.dwSize = sizeof(entry);
        try {
            if (Module32FirstW(snapshot, &entry)) do {
                modules.push_back({{"path", std::filesystem::path(entry.szExePath).string()},
                    {"base", PointerText(entry.modBaseAddr)}, {"size", entry.modBaseSize}});
            } while (Module32NextW(snapshot, &entry));
        } catch (...) { CloseHandle(snapshot); throw; }
        CloseHandle(snapshot);
        std::ofstream output(captureDirectory / "modules.json", std::ios::binary | std::ios::trunc);
        output << modules.dump(2, ' ', false, nlohmann::json::error_handler_t::replace);
        output.flush();
        if (!output) throw std::runtime_error("module inventory write failed");
    }
#endif
}

void InstallAlgorithmHooks() {
#ifdef GKMS_WINDOWS
    static bool installed = false;
    if (installed) return;
    installed = true;
    InstallAlgorithmHook(AlgorithmMethod::ProcessQuartz, "campus-submodule.Runtime.dll", "CampusActorAnimationJob",
        "ProcessQuartzDriver", AlgorithmHook<AlgorithmMethod::ProcessQuartz>);
    InstallAlgorithmHook(AlgorithmMethod::ProcessSwing, "campus-submodule.Runtime.dll", "CampusActorAnimationJob",
        "ProcessSwingSkeleton", AlgorithmHook<AlgorithmMethod::ProcessSwing>);
    InstallAlgorithmHook(AlgorithmMethod::QuartzSkirt, "ActorAnimation.Runtime.dll", "ActorAnimationQuartzDriverSkirtJobBone",
        "Execute", AlgorithmHook<AlgorithmMethod::QuartzSkirt>);
    InstallAlgorithmHook(AlgorithmMethod::QuartzHair, "ActorAnimation.Runtime.dll", "ActorAnimationQuartzDriverHairJobBone",
        "Execute", AlgorithmHook<AlgorithmMethod::QuartzHair>);
    InstallAlgorithmHook(AlgorithmMethod::QuartzPoncho, "ActorAnimation.Runtime.dll", "ActorAnimationQuartzDriverPonchoJobBone",
        "Execute", AlgorithmHook<AlgorithmMethod::QuartzPoncho>);
    InstallAlgorithmHook(AlgorithmMethod::ProcessAnimation, "campus-submodule.Runtime.dll", "CampusActorAnimationJob",
        "ProcessAnimation", AlgorithmHook<AlgorithmMethod::ProcessAnimation>);
#endif
}

void DumpResolvedPhysicsMetadata() {
    Log::Info("PHYSICS_DIAG shared_metadata_export=skipped idol_parameters_only");
}

void SnapshotSetup(void* initializeData) {
    if (!initializeData) return;
    {
        std::lock_guard lock(snapshotMutex);
        if (!capturedInitializers.insert(initializeData).second) return;
    }

    auto* classHead = Il2cppUtils::get_class_from_instance(initializeData);
    Log::InfoFmt("PHYSICS_DIAG phase=setup_snapshot thread=%zu initialize=%p class=%s",
                 std::hash<std::thread::id>{}(std::this_thread::get_id()), initializeData,
                 SafeClassName(initializeData).c_str());
    if (!classHead) return;

    auto* klass = Il2cppUtils::GetClass("campus-submodule.Runtime.dll",
                                       classHead->namespaze ? classHead->namespaze : "",
                                       classHead->name ? classHead->name : "");
    if (!klass) return;
    DescribeClass(initializeData);

    static constexpr const char* listNames[] = {
        "swingBreastBones",
        "_quartzDriverRotationBones",
        "_quartzDriverFrillBones",
        "_quartzDriverSkirtBones",
        "_quartzDriverHairBones",
        "_quartzDriverHumanoidHandBones",
        "_quartzDriverHumanoidSleeveBones",
        "_quartzDriverHumanoidUpLegBones",
        "_quartzDriverHumanoidArmBones",
        "_quartzDriverWaistBones",
        "_quartzDriverFurisodeBones",
        "_quartzDriverPonchoBones",
        "_swingDynamicBones",
        "_swingStaticBones",
        "_swingChainLayers",
        "_ikCorrectionColliders",
    };
    for (const auto* listName : listNames) DumpList(initializeData, klass, listName);
    Log::Info("PHYSICS_DIAG phase=setup_snapshot_end");
}
}
