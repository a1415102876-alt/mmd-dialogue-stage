#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

function numberArray(value, length) {
    return Array.isArray(value) && value.length === length && value.every(Number.isFinite)
        ? value
        : null;
}

function distance(a, b) {
    const left = numberArray(a, 3);
    const right = numberArray(b, 3);
    if (!left || !right) return null;
    return Math.hypot(left[0] - right[0], left[1] - right[1], left[2] - right[2]);
}

function quaternionAngleDegrees(a, b) {
    const left = numberArray(a, 4);
    const right = numberArray(b, 4);
    if (!left || !right) return null;
    const leftLength = Math.hypot(...left);
    const rightLength = Math.hypot(...right);
    if (!(leftLength > 0) || !(rightLength > 0)) return null;
    if (left.every((value, index) => value === right[index])
        || left.every((value, index) => value === -right[index])) return 0;
    const dot = Math.abs((left[0] * right[0] + left[1] * right[1] + left[2] * right[2] + left[3] * right[3])
        / (leftLength * rightLength));
    return 2 * Math.acos(Math.min(1, Math.max(-1, dot))) * 180 / Math.PI;
}

function readTrace(filePath) {
    const records = fs.readFileSync(filePath, 'utf8')
        .split(/\r?\n/)
        .filter(Boolean)
        .map((line, lineNumber) => {
            try {
                return JSON.parse(line);
            } catch (error) {
                throw new Error(`第 ${lineNumber + 1} 行不是有效 JSON: ${error.message}`);
            }
        });
    const frames = new Map();
    const writes = [];
    const algorithmInvocations = [];
    let header = null;
    for (const record of records) {
        if (record.event === 'trace_header' || record.event === 'header') header = record;
        if (record.event === 'transform_write') writes.push(record);
        if (record.event === 'algorithm_invocation') algorithmInvocations.push(record);
        if (record.event !== 'frame_state' || !Number.isInteger(record.frame_id)) continue;
        const frame = frames.get(record.frame_id) ?? {};
        frame[record.phase] = record;
        frames.set(record.frame_id, frame);
    }
    return {header, frames, writes, algorithmInvocations};
}

function indexTransforms(record) {
    const result = new Map();
    for (const transform of record?.transforms ?? []) {
        const key = transform.address ?? transform.path;
        if (key) result.set(key, transform);
    }
    return result;
}

function compareTransformRecords(beforeRecord, afterRecord) {
    const beforeTransforms = indexTransforms(beforeRecord);
    const afterTransforms = indexTransforms(afterRecord);
    const deltas = [];
    for (const [key, before] of beforeTransforms) {
        const after = afterTransforms.get(key);
        if (!after) continue;
        deltas.push({
            address: after.address ?? before.address ?? key,
            name: after.name ?? before.name,
            path: after.path ?? before.path,
            local_position_delta: distance(before.local_position, after.local_position),
            world_position_delta: distance(before.world_position, after.world_position),
            local_rotation_delta_degrees: quaternionAngleDegrees(before.local_rotation, after.local_rotation),
            world_rotation_delta_degrees: quaternionAngleDegrees(before.world_rotation, after.world_rotation),
        });
    }
    return deltas;
}

function updateBoneStats(boneStats, deltas, controller) {
    for (const item of deltas) {
        const statKey = JSON.stringify([controller, item.address ?? item.path]);
        const stat = boneStats.get(statKey) ?? {
            controller,
            address: item.address,
            name: item.name,
            path: item.path,
            samples: 0,
            max_world_position_delta: 0,
            max_world_rotation_delta_degrees: 0,
            total_world_position_delta: 0,
            total_world_rotation_delta_degrees: 0,
        };
        stat.samples += 1;
        if (item.world_position_delta !== null) {
            stat.max_world_position_delta = Math.max(stat.max_world_position_delta, item.world_position_delta);
            stat.total_world_position_delta += item.world_position_delta;
        }
        if (item.world_rotation_delta_degrees !== null) {
            stat.max_world_rotation_delta_degrees = Math.max(stat.max_world_rotation_delta_degrees,
                item.world_rotation_delta_degrees);
            stat.total_world_rotation_delta_degrees += item.world_rotation_delta_degrees;
        }
        boneStats.set(statKey, stat);
    }
}

function summarizeTrace(trace) {
    const frameDeltas = [];
    const interFrameDeltas = [];
    const boneStats = new Map();
    const interFrameBoneStats = new Map();
    const previousByController = new Map();
    const orderedFrames = [...trace.frames.entries()].sort(([left], [right]) => left - right);
    for (const [frameId, frame] of orderedFrames) {
        if (!frame.input?.controller || frame.input.controller !== frame.output?.controller) continue;
        const deltas = compareTransformRecords(frame.input, frame.output);
        updateBoneStats(boneStats, deltas, frame.input.controller);
        frameDeltas.push({frame_id: frameId, controller: frame.input.controller, bones: deltas});
        const previous = previousByController.get(frame.input.controller);
        if (previous) {
            const interDeltas = compareTransformRecords(previous.output, frame.input);
            updateBoneStats(interFrameBoneStats, interDeltas, frame.input.controller);
            interFrameDeltas.push({
                from_frame_id: previous.frameId,
                to_frame_id: frameId,
                controller: frame.input.controller,
                phase_transition: 'previous_output_to_next_input',
                elapsed_ms: Number.isFinite(frame.input.timestamp_ms) && Number.isFinite(previous.output.timestamp_ms)
                    ? frame.input.timestamp_ms - previous.output.timestamp_ms : null,
                bones: interDeltas,
            });
        }
        previousByController.set(frame.input.controller, {frameId, output: frame.output});
    }

    function summarizeBones(stats) {
        const summaries = [...stats.values()].map((stat) => ({
        ...stat,
        average_world_position_delta: stat.samples ? stat.total_world_position_delta / stat.samples : 0,
        average_world_rotation_delta_degrees: stat.samples
            ? stat.total_world_rotation_delta_degrees / stat.samples : 0,
    })).map(({total_world_position_delta, total_world_rotation_delta_degrees, ...stat}) => stat);
        summaries.sort((left, right) =>
        right.max_world_rotation_delta_degrees - left.max_world_rotation_delta_degrees
        || right.max_world_position_delta - left.max_world_position_delta);
        return summaries;
    }

    const writeCounts = {};
    const writeBoneCounts = {};
    for (const write of trace.writes) {
        writeCounts[write.operation] = (writeCounts[write.operation] ?? 0) + 1;
        const key = write.transform?.address ?? write.transform?.path ?? '<unknown>';
        writeBoneCounts[key] = (writeBoneCounts[key] ?? 0) + 1;
    }
    const algorithmInvocationCounts = {};
    const algorithmInvocationPhaseCounts = {};
    const algorithmCompletedCallCounts = {};
    const pendingCalls = new Map();
    const completedCalls = new Set();
    for (const invocation of trace.algorithmInvocations ?? []) {
        const method = invocation.method ?? '<unknown>';
        const phase = invocation.phase ?? '<unknown>';
        algorithmInvocationCounts[method] = (algorithmInvocationCounts[method] ?? 0) + 1;
        const phaseKey = `${method}:${phase}`;
        algorithmInvocationPhaseCounts[phaseKey] = (algorithmInvocationPhaseCounts[phaseKey] ?? 0) + 1;
        if (!Number.isSafeInteger(invocation.call_id) || invocation.call_id <= 0
            || !Number.isSafeInteger(invocation.capture_id) || !Number.isInteger(invocation.thread_id)
            || !invocation.self || !invocation.animation_stream) continue;
        const callKey = JSON.stringify([invocation.capture_id, invocation.call_id, method,
            invocation.thread_id, invocation.self, invocation.animation_stream]);
        if (completedCalls.has(callKey)) continue;
        if (phase === 'enter') pendingCalls.set(callKey, invocation);
        if (phase === 'exit' && pendingCalls.has(callKey)) {
            algorithmCompletedCallCounts[method] = (algorithmCompletedCallCounts[method] ?? 0) + 1;
            pendingCalls.delete(callKey);
            completedCalls.add(callKey);
        }
    }
    const completed = method => (algorithmCompletedCallCounts[method] ?? 0) > 0;
    const processEntryExecutionVerified = completed('ProcessQuartzDriver') && completed('ProcessSwingSkeleton');
    const quartzJobExecutionVerified = ['QuartzSkirtJob.Execute', 'QuartzHairJob.Execute', 'QuartzPonchoJob.Execute']
        .some(completed);
    const algorithmExecutionVerified = completed('ProcessQuartzDriver') || completed('ProcessSwingSkeleton')
        || quartzJobExecutionVerified;
    return {
        schema_version: 3,
        algorithm_execution_verified: algorithmExecutionVerified,
        process_entry_execution_verified: processEntryExecutionVerified,
        quartz_job_execution_verified: quartzJobExecutionVerified,
        animation_dispatch_execution_verified: completed('ProcessAnimation'),
        algorithm_io_verified: false,
        algorithm_completed_call_counts: algorithmCompletedCallCounts,
        algorithm_hooks: trace.header?.algorithm_hooks ?? [],
        comparison_semantics: {
            frames: 'within_one_LateUpdate_callback_not_verified_physics_io',
            inter_frame_transitions: 'same_controller_between_callbacks_includes_animation_parent_motion_and_physics',
            elapsed_ms: 'wall_clock_record_timestamps_not_simulation_deltaTime',
        },
        source: trace.header?.source ?? 'unknown',
        frame_count: frameDeltas.length,
        complete_input_output_pairs: frameDeltas.length,
        inter_frame_transition_count: interFrameDeltas.length,
        transform_write_count: trace.writes.length,
        transform_write_counts_by_operation: writeCounts,
        transform_write_counts_by_bone: writeBoneCounts,
        algorithm_invocation_count: trace.algorithmInvocations?.length ?? 0,
        algorithm_invocation_counts: algorithmInvocationCounts,
        algorithm_invocation_phase_counts: algorithmInvocationPhaseCounts,
        frames: frameDeltas,
        inter_frame_transitions: interFrameDeltas,
        bones_sorted_by_observed_rotation_change: summarizeBones(boneStats),
        inter_frame_bones_sorted_by_observed_rotation_change: summarizeBones(interFrameBoneStats),
    };
}

function main() {
    const inputPath = process.argv[2];
    if (!inputPath) {
        console.error('用法: node physics-trace-report.mjs <frame-trace.jsonl> [report.json]');
        process.exitCode = 2;
        return;
    }
    const trace = readTrace(path.resolve(inputPath));
    const report = summarizeTrace(trace);
    const outputPath = process.argv[3] ? path.resolve(process.argv[3]) : null;
    if (outputPath) fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);
    console.log(JSON.stringify({
        algorithm_execution_verified: report.algorithm_execution_verified,
        quartz_job_execution_verified: report.quartz_job_execution_verified,
        process_entry_execution_verified: report.process_entry_execution_verified,
        animation_dispatch_execution_verified: report.animation_dispatch_execution_verified,
        algorithm_completed_call_counts: report.algorithm_completed_call_counts,
        frame_count: report.frame_count,
        inter_frame_transition_count: report.inter_frame_transition_count,
        transform_write_count: report.transform_write_count,
        within_callback_top_bones: report.bones_sorted_by_observed_rotation_change.slice(0, 3),
        between_callbacks_top_bones: report.inter_frame_bones_sorted_by_observed_rotation_change.slice(0, 6),
    }, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main();

export {quaternionAngleDegrees, readTrace, summarizeTrace};
