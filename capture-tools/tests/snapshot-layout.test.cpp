#include "../src/GakumasLocalify/SnapshotLayout.hpp"
#include "../src/deps/nlohmann/json.hpp"
#include <cassert>
#include <cmath>
#include <cstring>
#include <fstream>
#include <iostream>
#include <vector>

using namespace GakumasLocal::PhysicsDiagnostics;

std::vector<unsigned char> DecodeHex(const std::string& hex) {
    std::vector<unsigned char> bytes;
    for (std::size_t offset = 0; offset < hex.size(); offset += 2)
        bytes.push_back(static_cast<unsigned char>(std::stoul(hex.substr(offset, 2), nullptr, 16)));
    return bytes;
}

int main(int argc, char** argv) {
    assert(FieldMemoryOffset(16, 112, 1, SnapshotStorage::InlineValue) == 0);
    assert(FieldMemoryOffset(56, 112, 16, SnapshotStorage::InlineValue) == 40);
    assert(FieldMemoryOffset(116, 112, 12, SnapshotStorage::InlineValue) == 100);
    assert(FieldMemoryOffset(56, 2576, 16, SnapshotStorage::ManagedObject) == 56);
    assert(!FieldMemoryOffset(15, 112, 1, SnapshotStorage::InlineValue));
    assert(!FieldMemoryOffset(127, 112, 2, SnapshotStorage::InlineValue));
    assert(!FieldMemoryOffset(SIZE_MAX, 112, 12, SnapshotStorage::InlineValue));
    assert(!FieldMemoryOffset(16, 112, 0, SnapshotStorage::InlineValue));
    const auto bytes = DecodeHex("30e585eded0100000c00000004000000");
    NativeArrayHeader64 header{};
    assert(sizeof(header) == bytes.size());
    std::memcpy(&header, bytes.data(), sizeof(header));
    assert(header.buffer == 0x1eded85e530);
    assert(header.length == 12 && header.allocator == 4);
    assert(ValidNativeArrayRange(header, 112));
    header.length = -1;
    assert(!ValidNativeArrayRange(header, 112));
    header.length = 4097;
    assert(!ValidNativeArrayRange(header, 112));
    header.length = 1;
    header.buffer = UINT64_MAX - 8;
    assert(!ValidNativeArrayRange(header, 112));
    header = {0, 0, 4};
    assert(ValidNativeArrayRange(header, 112));
    header.length = 1;
    assert(!ValidNativeArrayRange(header, 112));
    assert(!ValidNativeArrayRange(header, 0));

    NativeListHeader64 list{};
    assert(sizeof(list) == sizeof(void*));
    assert(ValidNativeListRange({0x2000, 12, 24}, 0x88));
    assert(!ValidNativeListRange({0, 1, 1}, 0x88));
    assert(!ValidNativeListRange({0x2000, -1, 1}, 0x88));
    assert(!ValidNativeListRange({0x2000, 25, 24}, 0x88));
    assert(!ValidNativeListRange({0x2000, 1, 4097}, 0x88));
    assert(!ValidNativeListRange({0x2000, 1, 2}, 0));
    std::cout << "snapshot layout: offsets, exact header size and bounds passed\n";
    if (argc < 2) return 0;
    std::ifstream input(argv[1]);
    assert(input.good());
    const auto capture = nlohmann::json::parse(input);
    const auto& objects = capture.at("actors").at(0).at("objects");
    int matchedRecords = 0;
    int matchedFields = 0;
    for (const auto& object : objects) {
        if (object.at("type") != "ActorAnimation.CampusActorAnimationJob") continue;
        for (const auto& field : object.at("fields")) {
            const auto name = field.at("name").get<std::string>();
            if (name != "_quartzDriverSkirtJobBones" && name != "_quartzDriverHairJobBones") continue;
            const auto settingType = name == "_quartzDriverSkirtJobBones"
                ? "ActorAnimation.ActorAnimationQuartzDriverSkirtSetting"
                : "ActorAnimation.ActorAnimationQuartzDriverHairSetting";
            for (const auto& item : field.at("native_array").at("items")) {
                const auto raw = DecodeHex(item.at("raw_hex"));
                if (raw.at(0) != 1) continue;
                int candidates = 0;
                int count = 0;
                for (const auto& setting : objects) {
                    if (setting.at("type") != settingType) continue;
                    int compared = 0;
                    bool matches = true;
                    for (const auto& expected : setting.at("fields")) {
                        if (!expected.contains("raw_hex")) continue;
                        for (const auto& member : item.at("fields")) {
                            if (member.at("name") != expected.at("name")) continue;
                            const auto wanted = DecodeHex(expected.at("raw_hex"));
                            const auto offset = FieldMemoryOffset(member.at("offset"), raw.size(),
                                wanted.size(), SnapshotStorage::InlineValue);
                            assert(offset);
                            matches = matches && std::memcmp(raw.data() + *offset, wanted.data(), wanted.size()) == 0;
                            ++compared;
                        }
                    }
                    if (matches && compared > 0) { ++candidates; count = compared; }
                }
                assert(candidates == 1);
                ++matchedRecords;
                matchedFields += count;
            }
        }
    }
    assert(matchedRecords == 10 && matchedFields == 74);
    std::cout << "capture replay: 10 Skirt/Hair records, 74 independent setting fields matched\n";
}
