#include "../src/GakumasLocalify/IdolParameterExport.hpp"

#include <cassert>
#include <iostream>
#include <fstream>
#include <string>

using namespace GakumasLocal::PhysicsDiagnostics;

int main(int argc, char** argv) {
    const nlohmann::json runtimeActors = nlohmann::json::parse(R"({
        "actors": [{
            "truncation_count": 0,
            "skipped_count": 0,
            "objects": [
                {
                    "address": "0x1",
                    "type": "Campus.Common.CampusActorModelParts",
                    "fields": [
                        {
                            "name": "dynamicBones",
                            "collection": {
                                "count": 1,
                                "element_type": "ActorAnimation.ActorSwingDynamicBone",
                                "status": "read",
                                "items": ["0x2"]
                            }
                        },
                        {
                            "name": "initialTransforms",
                            "collection": {
                                "count": 1,
                                "element_type": "ActorAnimation.InitialTransform",
                                "status": "skipped_value_type_elements"
                            }
                        },
                        {"name": "_color", "status": "read", "value": 7}
                    ]
                },
                {
                    "address": "0x2",
                    "type": "ActorAnimation.ActorSwingDynamicBone",
                    "unity_object": {
                        "object_name": "LeftHair1_S",
                        "transform_ancestors": ["LeftHair1_S", "fktn | CampusActorController[0]"]
                    },
                    "fields": [
                        {"name": "damping", "status": "read", "value": 0.9},
                        {"name": "setting", "status": "reference_only", "value_address": "0x3"},
                        {"name": "target", "status": "reference_only", "value_address": "0x4"},
                        {"name": "m_CachedPtr", "status": "read", "value": 1},
                        {
                            "name": "collider",
                            "status": "raw_value_type",
                            "raw_hex": "abcd",
                            "fields": [
                                {"name": "radiusA", "status": "read", "value": 0.02},
                                {"name": "collisionMask", "status": "read", "value": 8}
                            ]
                        }
                    ]
                },
                {
                    "address": "0x3",
                    "type": "ActorAnimation.ActorAnimationQuartzDriverHairSetting",
                    "fields": [
                        {
                            "name": "headRotateCoefficient",
                            "status": "raw_value_type",
                            "fields": [{"name": "x", "status": "read", "value": 0.5}]
                        }
                    ]
                },
                {
                    "address": "0x4",
                    "type": "UnityEngine.Transform",
                    "unity_object": {
                        "object_name": "LeftHair1_S",
                        "transform_ancestors": ["LeftHair1_S"]
                    },
                    "fields": [{"name": "m_CachedPtr", "status": "read", "value": 99}]
                },
                {
                    "address": "0x9",
                    "type": "Campus.Common.CampusActorController",
                    "fields": [{"name": "_color", "status": "read", "value": 7}]
                }
            ],
            "playable_jobs": [{
                "status": "read",
                "execution_verified": false,
                "sampling_semantics": "main_callback_snapshot_not_solver_io",
                "job": {
                    "fields": [{
                        "name": "dynamicBones",
                        "native_list": {
                            "status": "read",
                            "length": 1,
                            "buffer_address": "0x555",
                            "element_type": "ActorAnimation.ActorSwingDynamicBone",
                            "items": [{"index": 0, "fields": [
                                {"name": "radiusA", "status": "read", "value": 0.02},
                                {"name": "active", "status": "read", "value": true}
                            ]}]
                        }
                    }]
                },
                "native_arrays": [{
                    "name": "_quartzDriverHairJobBones",
                    "native_array": {
                        "status": "read",
                        "length": 2,
                        "buffer_address": "0xabc",
                        "element_type": "ActorAnimation.ActorAnimationQuartzDriverHairJobBone",
                        "items": [
                            {"index": 0, "fields": [
                                {"name": "_isActive", "status": "read", "value": true},
                                {"name": "coefficient", "status": "read", "value": 0.2}
                            ]},
                            {"index": 1, "fields": [
                                {"name": "_isActive", "status": "read", "value": false},
                                {"name": "coefficient", "status": "read", "value": 9}
                            ]}
                        ]
                    }
                }]
            }]
        }]
    })");
    const nlohmann::json identities = nlohmann::json::parse(R"([
        {
            "controller_address": "0xdead",
            "object_name": "fktn | CampusActorController[0]",
            "transform_ancestors": ["fktn | CampusActorController[0]"],
            "identity_status": "runtime_names_only_not_verified_idol_id"
        }
    ])");

    const auto projected = ProjectIdolParameters(runtimeActors["actors"], identities);
    const auto text = projected.dump();
    assert(projected["schema_version"] == 2);
    assert(projected["capture_mode"] == "idol_parameters");
    assert(projected["shared_solver_exported"] == false);
    assert(projected["physics_parameters_complete"] == false);
    assert(projected["omitted"].size() == 5);
    const auto& actor = projected["actors"][0];
    assert(actor["identity"]["object_name"] == "fktn | CampusActorController[0]");
    assert(!actor["identity"].contains("controller_address"));
    assert(actor["components"][0]["bone"] == "LeftHair1_S");
    assert(actor["components"][0]["parameters"]["damping"] == 0.9);
    assert(actor["components"][0]["parameters"]["collider"]["radiusA"] == 0.02);
    assert(actor["components"][0]["parameters"]["collider"]["collisionMask"] == 8);
    assert(actor["components"][0]["parameters"]["setting"]["headRotateCoefficient"]["x"] == 0.5);
    assert(actor["components"][0]["parameters"]["target"]["name"] == "LeftHair1_S");
    assert(!actor["components"][0]["parameters"].contains("m_CachedPtr"));
    assert(text.find("raw_hex") == std::string::npos);
    assert(text.find("_color") == std::string::npos);
    assert(text.find("0xdead") == std::string::npos);
    assert(text.find("0xabc") == std::string::npos);
    assert(text.find("native-helper") == std::string::npos);
    assert(actor["native_lists"].size() == 1);
    assert(actor["native_lists"][0]["name"] == "dynamicBones");
    assert(actor["native_lists"][0]["items"][0]["radiusA"] == 0.02);
    assert(!actor["native_lists"][0].contains("buffer_address"));
    assert(actor["native_component_mapping"]["status"] == "read");
    assert(actor["native_component_mapping"]["unmatched"] == 1);
    const auto& quartz = actor["quartz_jobs"][0];
    assert(quartz["name"] == "_quartzDriverHairJobBones");
    assert(quartz["length"] == 2);
    assert(quartz["items"].size() == 1);
    assert(quartz["items"][0]["coefficient"] == 0.2);
    assert(quartz["execution_verified"] == false);
    bool sawInitialTransformGap = false;
    for (const auto& gap : actor["gaps"]) {
        if (gap["status"] == "skipped_value_type_elements") sawInitialTransformGap = true;
    }
    assert(sawInitialTransformGap);

    const auto mappingComponents = nlohmann::json::parse(R"([
        {
            "list": "swingDynamicBones", "index": 7, "status": "read",
            "bone": "CenterRibbon1_S", "path": ["CenterRibbon1_S", "Head"],
            "parameters": {
                "<hierarchyDepth>k__BackingField": 3,
                "damping": 0.5, "mass": 1.0, "spring": 0.25, "stiffness": 0.75,
                "rootWeight": 0.0, "pendulum": 0.0, "pendulumRange": 1.0, "wind": 0.0,
                "dynamicCollider": {"type": 0, "collisionMask": -1, "float_A": 0.01},
                "<initialTransform>k__BackingField": {
                    "localPosition": {"x": 0.0, "y": 0.1, "z": 0.2},
                    "localRotation": {"value": {"w": 1.0, "x": 0.0, "y": 0.0, "z": 0.0}}
                },
                "modelingTransform": {
                    "localPosition": {"x": 0.0, "y": 0.1, "z": 0.2},
                    "localRotation": {"value": {"w": 1.0, "x": 0.0, "y": 0.0, "z": 0.0}}
                },
                "limitInfo": {
                    "axisX": {"m_X": 0, "m_Y": 0},
                    "axisY": {"m_X": -20, "m_Y": 20},
                    "axisZ": {"m_X": -10, "m_Y": 0}
                }
            }
        }
    ])");
    auto mappingLists = nlohmann::json::parse(R"([
        {
            "name": "dynamicBones", "items": [{
                "index": 11, "depth": 3,
                "damping": 0.5, "mass": 1.0, "spring": 0.25, "stiffness": 0.75,
                "rootWeight": 0.0, "pendulum": 0.0, "pendulumRange": 1.0, "wind": 0.0,
                "collider": {"type": 0, "collisionMask": -1, "float_A": 0.01},
                "localTx": {
                    "translation": {"x": 0.0, "y": 0.1, "z": 0.2},
                    "rotation": {"value": {"w": 1.0, "x": 0.0, "y": 0.0, "z": 0.0}}
                },
                "modelingLocalTx": {
                    "translation": {"x": 0.0, "y": 0.1, "z": 0.2},
                    "rotation": {"value": {"w": 1.0, "x": 0.0, "y": 0.0, "z": 0.0}}
                },
                "limit": {
                    "negative": {"x": -0.0, "y": -20.0, "z": -10.0},
                    "positive": {"x": 0.0, "y": 20.0, "z": 0.0}
                }
            }]
        }
    ])");
    const auto mappingSummary = AnnotateNativeDynamicMappings(mappingLists, mappingComponents);
    assert(mappingSummary["resolved"] == 1);
    assert(mappingSummary["ambiguous"] == 0);
    assert(mappingLists[0]["items"][0]["mapping_status"] == "resolved");
    assert(mappingLists[0]["items"][0]["resolved_component"]["index"] == 7);
    assert(mappingLists[0]["items"][0]["resolved_component"]["native_index"] == 11);

    auto duplicate = mappingLists[0]["items"][0];
    duplicate["index"] = 12;
    mappingLists[0]["items"].push_back(duplicate);
    const auto ambiguous = AnnotateNativeDynamicMappings(mappingLists, mappingComponents);
    assert(ambiguous["resolved"] == 0 && ambiguous["ambiguous"] == 2);
    assert(!mappingLists[0]["items"][0].contains("resolved_component"));
    auto incomplete = mappingComponents[0];
    incomplete["parameters"].erase("mass");
    assert(DynamicComponentMappingSignature(incomplete).empty());

    // Replay compact captures without touching their source files or PMX indices.
    if (argc == 3) {
        std::ifstream input(argv[1]);
        nlohmann::json capture;
        input >> capture;
        auto report = nlohmann::json::array();
        for (auto& captured : capture["actors"]) {
            auto summary = AnnotateNativeDynamicMappings(captured["native_lists"], captured["components"]);
            report.push_back({{"identity", captured["identity"]}, {"mapping", summary},
                              {"native_lists", captured["native_lists"]}});
            std::cout << captured["identity"]["object_name"] << " " << summary.dump() << "\n";
        }
        std::ofstream output(argv[2]);
        output << report.dump(2);
        assert(output.good());
    }

    std::cout << "idol parameter export keeps per-idol values and drops shared capture files\n";
}
