#pragma once

#include "../deps/nlohmann/json.hpp"

#include <cmath>
#include <iomanip>
#include <sstream>
#include <string>
#include <unordered_map>
#include <unordered_set>
#include <vector>

namespace GakumasLocal::PhysicsDiagnostics {

// Projects one actor snapshot down to the parameters that differ per idol,
// costume and hair. Shared solver code, module inventories and process
// addresses are not part of this document.
inline bool IsIdolParameterType(const std::string& type) {
    return type.find("ActorSwing") != std::string::npos
        || type.find("QuartzDriver") != std::string::npos
        || type.find("IKCorrection") != std::string::npos
        || type.find("ActorSwingChain") != std::string::npos
        || type.find("ChainInfo") != std::string::npos
        || type.find("ChainLayer") != std::string::npos
        || type.find("LimitInfo") != std::string::npos
        || type.find("Breast") != std::string::npos
        || type.find("InitialTransform") != std::string::npos;
}

inline bool IsSharedRuntimeField(const std::string& name) {
    return name == "m_CachedPtr" || name == "m_CancellationTokenSource"
        || name == "kInstanceID_None" || name == "OffsetOfInstanceIDInCPlusPlusObject"
        || name == "objectIsNullMessage" || name == "cloneDestroyedMessage"
        || name == "UpdateDecalProfilingSampler" || name == "_scheduleJobSampler"
        || name == "_completeJobSampler" || name == "_aabbScheduleProfilingSampler";
}

inline nlohmann::json CompactParameter(const nlohmann::json& node);

// The boxed ActorSwing list and the solver NativeList are built by different
// code paths. Their order is therefore not a stable association. Keep the
// comparison deliberately limited to authored/runtime state that is present
// in both representations; handles and process addresses are not used here.
inline nlohmann::json MappingNumber(const nlohmann::json& node) {
    if (!node.is_number()) return nullptr;
    const auto value = node.get<double>();
    if (!std::isfinite(value)) return nullptr;
    return std::round(value * 1000000.0) / 1000000.0;
}

inline nlohmann::json MappingField(const nlohmann::json& node, const char* name) {
    return node.is_object() && node.contains(name) ? node.at(name) : nlohmann::json(nullptr);
}

// JSON text distinguishes integer/float and signed zero; solver values do not.
// Require every signature leaf and canonicalize before using it as a key.
inline bool CanonicalizeMappingSignature(nlohmann::json& node) {
    if (node.is_array()) {
        for (auto& value : node) if (!CanonicalizeMappingSignature(value)) return false;
        return true;
    }
    if (!node.is_number()) return false;
    node = MappingNumber(node);
    if (node.is_null()) return false;
    if (node.get<double>() == 0.0) node = 0.0;
    return true;
}

inline std::string MappingSignatureKey(nlohmann::json signature) {
    return CanonicalizeMappingSignature(signature) ? signature.dump() : std::string{};
}

inline nlohmann::json MappingEnum(const nlohmann::json& node) {
    if (node.is_object() && node.contains("value__")) return MappingEnum(node["value__"]);
    if (node.is_number_integer() || node.is_number_unsigned()) return node;
    if (node.is_number_float()) return MappingNumber(node);
    return nullptr;
}

inline nlohmann::json MappingVector3(const nlohmann::json& node) {
    if (!node.is_object()) return nullptr;
    return nlohmann::json::array({
        MappingNumber(MappingField(node, "x")),
        MappingNumber(MappingField(node, "y")),
        MappingNumber(MappingField(node, "z"))
    });
}

inline nlohmann::json MappingQuaternion(const nlohmann::json& node) {
    const auto* value = &node;
    if (node.is_object() && node.contains("value")) value = &node["value"];
    if (!value->is_object()) return nullptr;
    return nlohmann::json::array({
        MappingNumber(MappingField(*value, "w")),
        MappingNumber(MappingField(*value, "x")),
        MappingNumber(MappingField(*value, "y")),
        MappingNumber(MappingField(*value, "z"))
    });
}

inline nlohmann::json MappingLimitComponent(const nlohmann::json& node) {
    if (!node.is_object()) return nullptr;
    const auto axisX = node.value("axisX", nlohmann::json::object());
    const auto axisY = node.value("axisY", nlohmann::json::object());
    const auto axisZ = node.value("axisZ", nlohmann::json::object());
    return nlohmann::json::array({
        MappingField(axisX, "m_X"), MappingField(axisX, "m_Y"),
        MappingField(axisY, "m_X"), MappingField(axisY, "m_Y"),
        MappingField(axisZ, "m_X"), MappingField(axisZ, "m_Y")
    });
}

inline nlohmann::json MappingLimitNative(const nlohmann::json& node) {
    if (!node.is_object()) return nullptr;
    const auto negative = node.value("negative", nlohmann::json::object());
    const auto positive = node.value("positive", nlohmann::json::object());
    return nlohmann::json::array({
        MappingField(negative, "x"), MappingField(positive, "x"),
        MappingField(negative, "y"), MappingField(positive, "y"),
        MappingField(negative, "z"), MappingField(positive, "z")
    });
}

inline std::string DynamicComponentMappingSignature(const nlohmann::json& component) {
    const auto parameters = component.value("parameters", nlohmann::json::object());
    const auto collider = parameters.value("dynamicCollider", nlohmann::json::object());
    const auto initial = parameters.value("<initialTransform>k__BackingField", nlohmann::json::object());
    const auto modeling = parameters.value("modelingTransform", nlohmann::json::object());
    const auto limit = parameters.value("limitInfo", nlohmann::json::object());
    if (!initial.is_object() || !modeling.is_object()
        || !initial.contains("localPosition") || !initial.contains("localRotation")
        || !modeling.contains("localPosition") || !modeling.contains("localRotation")) return {};

    const nlohmann::json signature = nlohmann::json::array({
        MappingField(parameters, "<hierarchyDepth>k__BackingField"),
        MappingNumber(MappingField(parameters, "damping")),
        MappingNumber(MappingField(parameters, "mass")),
        MappingNumber(MappingField(parameters, "spring")),
        MappingNumber(MappingField(parameters, "stiffness")),
        MappingNumber(MappingField(parameters, "rootWeight")),
        MappingNumber(MappingField(parameters, "pendulum")),
        MappingNumber(MappingField(parameters, "pendulumRange")),
        MappingNumber(MappingField(parameters, "wind")),
        MappingEnum(MappingField(collider, "type")),
        MappingEnum(MappingField(collider, "collisionMask")),
        MappingNumber(MappingField(collider, "float_A")),
        MappingVector3(initial["localPosition"]),
        MappingQuaternion(initial["localRotation"]),
        MappingVector3(modeling["localPosition"]),
        MappingQuaternion(modeling["localRotation"]),
        MappingLimitComponent(limit)
    });
    return MappingSignatureKey(signature);
}

inline std::string DynamicNativeMappingSignature(const nlohmann::json& item) {
    const auto collider = item.value("collider", nlohmann::json::object());
    const auto local = item.value("localTx", nlohmann::json::object());
    const auto modeling = item.value("modelingLocalTx", nlohmann::json::object());
    const auto limit = item.value("limit", nlohmann::json::object());
    if (!local.is_object() || !modeling.is_object()
        || !local.contains("translation") || !local.contains("rotation")
        || !modeling.contains("translation") || !modeling.contains("rotation")) return {};

    const nlohmann::json signature = nlohmann::json::array({
        MappingField(item, "depth"),
        MappingNumber(MappingField(item, "damping")),
        MappingNumber(MappingField(item, "mass")),
        MappingNumber(MappingField(item, "spring")),
        MappingNumber(MappingField(item, "stiffness")),
        MappingNumber(MappingField(item, "rootWeight")),
        MappingNumber(MappingField(item, "pendulum")),
        MappingNumber(MappingField(item, "pendulumRange")),
        MappingNumber(MappingField(item, "wind")),
        MappingEnum(MappingField(collider, "type")),
        MappingEnum(MappingField(collider, "collisionMask")),
        MappingNumber(MappingField(collider, "float_A")),
        MappingVector3(local["translation"]),
        MappingQuaternion(local["rotation"]),
        MappingVector3(modeling["translation"]),
        MappingQuaternion(modeling["rotation"]),
        MappingLimitNative(limit)
    });
    return MappingSignatureKey(signature);
}

inline nlohmann::json CompactContainer(const nlohmann::json& container, bool omitInactiveSlots) {
    nlohmann::json result = {
        {"status", container.value("status", "missing")},
        {"element_type", container.value("element_type", container.value("element_type_name", ""))}
    };
    if (container.contains("length")) result["length"] = container["length"];
    if (container.contains("capacity")) result["capacity"] = container["capacity"];
    if (container.contains("count")) result["count"] = container["count"];
    if (container.contains("items_read")) result["items_read"] = container["items_read"];
    if (container.contains("items_attempted")) result["items_attempted"] = container["items_attempted"];
    result["items"] = nlohmann::json::array();
    if (!container.contains("items") || !container["items"].is_array()) return result;
    for (const auto& item : container["items"]) {
        const auto compacted = CompactParameter(item);
        if (!compacted.is_object()) continue;
        const bool inactive = (compacted.contains("_isActive") && compacted["_isActive"] == false)
            || (compacted.contains("isActive") && compacted["isActive"] == false)
            || (compacted.contains("active") && (compacted["active"] == false || compacted["active"] == 0));
        if (omitInactiveSlots && inactive) continue;
        result["items"].push_back(compacted);
    }
    return result;
}

inline nlohmann::json CompactParameter(const nlohmann::json& node) {
    if (node.is_array()) {
        nlohmann::json values = nlohmann::json::array();
        for (const auto& item : node) values.push_back(CompactParameter(item));
        return values;
    }
    if (!node.is_object()) return node;
    if (node.contains("fields") && node["fields"].is_array()) {
        nlohmann::json fields = nlohmann::json::object();
        for (const auto& field : node["fields"]) {
            if (!field.is_object() || !field.contains("name")) continue;
            const auto name = field["name"].get<std::string>();
            if (IsSharedRuntimeField(name)) continue;
            const auto status = field.value("status", "");
            if (status == "skipped_static_or_literal" || status == "skipped_non_object_type") continue;
            auto compacted = CompactParameter(field);
            if (compacted.is_null()) continue;
            fields[name] = std::move(compacted);
        }
        if (node.contains("index")) fields["index"] = node["index"];
        if (node.contains("native_list")) fields["native_list"] = CompactContainer(node["native_list"], false);
        if (node.contains("native_array")) {
            const auto name = node.value("name", "");
            fields["native_array"] = CompactContainer(node["native_array"], name.find("JobBones") != std::string::npos);
        }
        return fields;
    }

    const auto status = node.value("status", "");
    if (status == "skipped_static_or_literal" || status == "skipped_non_object_type") return nullptr;
    if (node.contains("native_list")) return CompactContainer(node["native_list"], false);
    if (node.contains("native_array")) {
        const auto name = node.value("name", "");
        const bool quartzSlot = name.find("JobBones") != std::string::npos;
        return CompactContainer(node["native_array"], quartzSlot);
    }
    if (node.contains("collection")) return CompactContainer(node["collection"], false);
    if (node.contains("value") && (status == "read" || status.empty())) return node["value"];
    if (status == "null") return nullptr;
    if (status == "reference_only" && node.contains("value_address")) return node["value_address"];
    if (node.contains("unity_object") && node["unity_object"].is_object()) {
        const auto& unity = node["unity_object"];
        return {
            {"name", unity.value("object_name", "")},
            {"path", unity.value("transform_ancestors", nlohmann::json::array())}
        };
    }
    return nullptr;
}

inline void InlineReferences(nlohmann::json& node,
                             const std::unordered_map<std::string, nlohmann::json>& objects,
                             std::unordered_set<std::string>& seen) {
    if (node.is_array()) {
        for (auto& item : node) InlineReferences(item, objects, seen);
        return;
    }
    if (!node.is_object()) return;
    for (auto& item : node.items()) {
        if (item.value().is_string()) {
            const auto address = item.value().get<std::string>();
            if (address.rfind("0x", 0) != 0 && address.rfind("0X", 0) != 0) continue;
            const auto found = objects.find(address);
            if (found != objects.end() && found->second.contains("unity_object")
                && found->second["unity_object"].is_object()) {
                const auto& unity = found->second["unity_object"];
                const auto type = found->second.value("type", "");
                if (!IsIdolParameterType(type)) {
                    item.value() = {
                        {"name", unity.value("object_name", "")},
                        {"path", unity.value("transform_ancestors", nlohmann::json::array())}
                    };
                    continue;
                }
            }
            const auto idolType = found != objects.end() && found->second.contains("type")
                && found->second["type"].is_string()
                && IsIdolParameterType(found->second["type"].get<std::string>());
            if (!idolType) {
                item.value() = {{"status", "unresolved_reference"}};
                continue;
            }
            if (!seen.insert(address).second) {
                item.value() = {{"status", "already_inlined"}};
                continue;
            }
            auto inlined = CompactParameter(found->second);
            InlineReferences(inlined, objects, seen);
            seen.erase(address);
            item.value() = std::move(inlined);
            continue;
        }
        InlineReferences(item.value(), objects, seen);
    }
}

inline nlohmann::json ActorIdentityRecord(const nlohmann::json& identity) {
    return {
        {"object_name", identity.value("object_name", "")},
        {"transform_ancestors", identity.value("transform_ancestors", nlohmann::json::array())},
        {"identity_status", identity.value("identity_status", "missing")}
    };
}

inline void CollectGaps(const nlohmann::json& node, const std::string& path, nlohmann::json& gaps) {
    if (node.is_array()) {
        for (std::size_t index = 0; index < node.size(); ++index)
            CollectGaps(node[index], path + "[" + std::to_string(index) + "]", gaps);
        return;
    }
    if (!node.is_object() || !node.contains("status")) return;
    const auto status = node["status"].get<std::string>();
    if (status != "read" && status != "empty" && status != "null" && status != "already_inlined") {
        gaps.push_back({{"path", path}, {"status", status},
            {"length", node.value("length", -1)}, {"items_read", node.value("items_read", -1)}});
    }
    for (const auto& item : node.items()) {
        if (item.key() == "status") continue;
        CollectGaps(item.value(), path + "." + item.key(), gaps);
    }
}

inline void CollectNativeLists(const nlohmann::json& node, const std::string& owner, nlohmann::json& lists) {
    if (node.is_array()) {
        for (const auto& item : node) CollectNativeLists(item, owner, lists);
        return;
    }
    if (!node.is_object()) return;
    if (node.contains("native_list") && node.contains("name") && node["name"].is_string()) {
        auto list = CompactContainer(node["native_list"], false);
        list["name"] = node["name"];
        list["owner_type"] = owner;
        lists.push_back(std::move(list));
    }
    for (const auto& item : node.items()) {
        if (item.key() == "native_list") continue;
        CollectNativeLists(item.value(), owner, lists);
    }
}

inline nlohmann::json AnnotateNativeDynamicMappings(nlohmann::json& nativeLists,
                                                    const nlohmann::json& components) {
    struct ComponentEntry {
        std::size_t index{};
        std::string signature;
        nlohmann::json record;
    };
    std::vector<ComponentEntry> dynamicComponents;
    for (const auto& component : components) {
        if (component.value("list", "") != "swingDynamicBones"
            || component.value("status", "") != "read") continue;
        const auto signature = DynamicComponentMappingSignature(component);
        if (signature.empty()) continue;
        ComponentEntry entry;
        entry.index = component.value("index", dynamicComponents.size());
        entry.signature = signature;
        entry.record = {
            {"list", "swingDynamicBones"},
            {"index", entry.index},
            {"bone", component.value("bone", "")},
            {"path", component.value("path", nlohmann::json::array())},
            {"match_method", "runtime_signature"}
        };
        dynamicComponents.push_back(std::move(entry));
    }

    nlohmann::json summary = {
        {"method", "runtime_signature"},
        {"status", "no_dynamic_list"},
        {"native_items", 0},
        {"resolved", 0},
        {"ambiguous", 0},
        {"unmatched", 0}
    };
    for (auto& list : nativeLists) {
        if (list.value("name", "") != "dynamicBones" || !list.contains("items")
            || !list["items"].is_array()) continue;
        summary["status"] = "read";
        summary["native_items"] = list["items"].size();
        std::unordered_map<std::string, std::size_t> nativeSignatureCounts;
        for (const auto& item : list["items"]) ++nativeSignatureCounts[DynamicNativeMappingSignature(item)];
        for (auto& item : list["items"]) {
            item.erase("resolved_component");
            const auto signature = DynamicNativeMappingSignature(item);
            nlohmann::json candidates = nlohmann::json::array();
            if (!signature.empty()) {
                for (const auto& component : dynamicComponents) {
                    if (component.signature == signature) candidates.push_back(component.record);
                }
            }
            item["component_candidates"] = candidates;
            if (candidates.size() == 1 && nativeSignatureCounts[signature] == 1) {
                item["mapping_status"] = "resolved";
                item["resolved_component"] = candidates.front();
                item["resolved_component"]["native_index"] = item.value("index", -1);
                summary["resolved"] = summary.value("resolved", 0) + 1;
            } else if (candidates.empty()) {
                item["mapping_status"] = signature.empty() ? "signature_missing" : "unmatched";
                summary["unmatched"] = summary.value("unmatched", 0) + 1;
            } else {
                item["mapping_status"] = "ambiguous";
                summary["ambiguous"] = summary.value("ambiguous", 0) + 1;
            }
        }
    }
    return summary;
}

inline nlohmann::json ProjectActorParameters(const nlohmann::json& actor, const nlohmann::json& identity) {
    std::unordered_map<std::string, nlohmann::json> objects;
    nlohmann::json components = nlohmann::json::array();
    nlohmann::json nativeLists = nlohmann::json::array();
    if (actor.contains("objects") && actor["objects"].is_array()) {
        for (const auto& object : actor["objects"]) {
            if (object.contains("address")) objects.emplace(object["address"].get<std::string>(), object);
        }
        for (const auto& object : actor["objects"]) {
            const auto type = object.value("type", "");
            if (!object.contains("fields") || !object["fields"].is_array()) continue;
            for (const auto& field : object["fields"]) {
                if (!field.is_object() || !field.contains("name")) continue;
                const auto name = field["name"].get<std::string>();
                if (!field.contains("collection") || !field["collection"].is_object()) continue;
                const auto elementType = field["collection"].value("element_type", "");
                if (!IsIdolParameterType(elementType) && !IsIdolParameterType(name)) continue;
                int index = 0;
                const auto& items = field["collection"].contains("items") && field["collection"]["items"].is_array()
                    ? field["collection"]["items"] : nlohmann::json::array();
                if (!items.empty()) {
                    for (const auto& item : items) {
                        if (!item.is_string()) continue;
                        const auto found = objects.find(item.get<std::string>());
                        nlohmann::json record = {{"list", name}, {"index", index++}, {"element_type", elementType}};
                        if (found == objects.end()) {
                            record["status"] = "object_missing";
                        } else {
                            record["type"] = found->second.value("type", elementType);
                            record["status"] = "read";
                            if (found->second.contains("unity_object")) {
                                record["bone"] = found->second["unity_object"].value("object_name", "");
                                record["path"] = found->second["unity_object"].value(
                                    "transform_ancestors", nlohmann::json::array());
                            }
                            record["parameters"] = CompactParameter(found->second);
                        }
                        components.push_back(std::move(record));
                    }
                } else if (field["collection"].value("status", "") != "read") {
                    components.push_back({{"list", name}, {"element_type", elementType},
                        {"status", field["collection"].value("status", "missing")},
                        {"count", field["collection"].value("count", 0)}});
                }
            }
        }
    }

    if (actor.contains("objects")) CollectNativeLists(actor["objects"], "object", nativeLists);
    nlohmann::json quartzJobs = nlohmann::json::array();
    if (actor.contains("playable_jobs") && actor["playable_jobs"].is_array()) {
        for (const auto& playable : actor["playable_jobs"]) {
            if (playable.contains("job")) CollectNativeLists(playable["job"], playable.value("job_type", "job"), nativeLists);
            if (!playable.contains("native_arrays") || !playable["native_arrays"].is_array()) continue;
            for (const auto& entry : playable["native_arrays"]) {
                if (!entry.contains("native_array")) continue;
                const auto name = entry.value("name", "");
                auto array = CompactContainer(entry["native_array"], name.find("JobBones") != std::string::npos);
                array["name"] = name;
                array["job_status"] = playable.value("status", "missing");
                array["sampling"] = playable.value("sampling_semantics", "unspecified");
                array["execution_verified"] = playable.value("execution_verified", false);
                quartzJobs.push_back(std::move(array));
            }
        }
    }

    nlohmann::json uniqueLists = nlohmann::json::array();
    std::unordered_map<std::string, std::size_t> listSlots;
    for (auto& list : nativeLists) {
        const auto name = list.value("name", "");
        if (name.empty()) {
            uniqueLists.push_back(std::move(list));
            continue;
        }
        const auto existing = listSlots.find(name);
        const auto readable = list.value("status", "") == "read" || list.value("status", "") == "empty";
        if (existing == listSlots.end()) {
            listSlots.emplace(name, uniqueLists.size());
            uniqueLists.push_back(std::move(list));
            continue;
        }
        const auto previous = uniqueLists[existing->second].value("status", "");
        if (readable && previous != "read" && previous != "empty") uniqueLists[existing->second] = std::move(list);
    }
    nativeLists = std::move(uniqueLists);

    std::unordered_set<std::string> seen;
    InlineReferences(components, objects, seen);
    seen.clear();
    InlineReferences(nativeLists, objects, seen);
    seen.clear();
    InlineReferences(quartzJobs, objects, seen);

    const auto nativeMapping = AnnotateNativeDynamicMappings(nativeLists, components);

    nlohmann::json gaps = nlohmann::json::array();
    if (actor.value("truncation_count", 0) > 0)
        gaps.push_back({{"path", "actor"}, {"status", "truncated"}, {"length", actor["truncation_count"]}});
    if (actor.value("skipped_count", 0) > 0)
        gaps.push_back({{"path", "actor"}, {"status", "skipped"}, {"length", actor["skipped_count"]}});
    CollectGaps(components, "components", gaps);
    CollectGaps(nativeLists, "native_lists", gaps);
    CollectGaps(quartzJobs, "quartz_jobs", gaps);

    return {
        {"identity", ActorIdentityRecord(identity)},
        {"parameters_complete", false},
        {"components", std::move(components)},
        {"native_lists", std::move(nativeLists)},
        {"native_component_mapping", nativeMapping},
        {"quartz_jobs", std::move(quartzJobs)},
        {"gaps", std::move(gaps)}
    };
}

inline nlohmann::json ProjectIdolParameters(const nlohmann::json& runtimeActors,
                                            const nlohmann::json& identities) {
    nlohmann::json actors = nlohmann::json::array();
    for (std::size_t index = 0; index < runtimeActors.size(); ++index) {
        const auto& identity = index < identities.size() ? identities[index] : nlohmann::json::object();
        actors.push_back(ProjectActorParameters(runtimeActors[index], identity));
    }
    return {
        {"schema_version", 2},
        {"capture_mode", "idol_parameters"},
        {"shared_solver_exported", false},
        {"physics_parameters_complete", false},
        {"omitted", nlohmann::json::array({"native_code", "modules", "frame_trace", "class_metadata", "runtime_object_graph"})},
        {"actors", std::move(actors)}
    };
}

}
