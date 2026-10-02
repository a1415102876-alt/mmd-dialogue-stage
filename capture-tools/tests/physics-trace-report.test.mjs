import test from 'node:test';
import assert from 'node:assert/strict';
import {quaternionAngleDegrees, summarizeTrace} from '../physics-trace-report.mjs';

function stillCallback(controller, position, timestamp) {
    const state = {
        controller,
        timestamp_ms: timestamp,
        transforms: [{
            address: 'bone', name: 'Hair', path: 'Hips/Hair',
            local_position: [0, 0, 0], world_position: [position, 0, 0],
            local_rotation: [0, 0, 0, 1], world_rotation: [0, 0, 0, 1],
        }],
    };
    return {input: state, output: structuredClone(state)};
}

test('separates unchanged callback poses from moving inter-callback poses', () => {
    const report = summarizeTrace({frames: new Map([
        [1, stillCallback('actor', 0, 10)], [2, stillCallback('actor', 1, 30)],
    ]), writes: []});
    assert.equal(report.bones_sorted_by_observed_rotation_change[0].samples, 2);
    assert.equal(report.bones_sorted_by_observed_rotation_change[0].max_world_position_delta, 0);
    assert.equal(report.inter_frame_bones_sorted_by_observed_rotation_change[0].samples, 1);
    assert.equal(report.inter_frame_bones_sorted_by_observed_rotation_change[0].average_world_position_delta, 1);
    assert.equal(report.inter_frame_transitions[0].elapsed_ms, 20);
    assert.equal(report.algorithm_execution_verified, false);
});

test('pairs interleaved callbacks only for the same controller and isolates stats', () => {
    const report = summarizeTrace({frames: new Map([
        [1, stillCallback('actorA', 0, 10)], [2, stillCallback('actorB', 100, 12)],
        [3, stillCallback('actorA', 1, 30)], [4, stillCallback('actorB', 102, 32)],
    ]), writes: []});
    assert.deepEqual(report.inter_frame_transitions.map(record => [record.from_frame_id, record.to_frame_id]),
        [[1, 3], [2, 4]]);
    assert.deepEqual(report.inter_frame_bones_sorted_by_observed_rotation_change.map(record =>
        [record.controller, record.max_world_position_delta]), [['actorB', 2], ['actorA', 1]]);
});

test('rejects callback pairs with missing or inconsistent controller identity', () => {
    const mismatched = stillCallback('actorA', 0, 10);
    mismatched.output.controller = 'actorB';
    const report = summarizeTrace({frames: new Map([
        [1, mismatched], [2, stillCallback(undefined, 1, 30)],
    ]), writes: []});
    assert.equal(report.complete_input_output_pairs, 0);
    assert.equal(report.inter_frame_transition_count, 0);
});

test('identical and sign-inverted quaternion samples have exactly zero angle', () => {
    const rotation = [0.123, 0.234, 0.345, 0.876];
    assert.equal(quaternionAngleDegrees(rotation, rotation), 0);
    assert.equal(quaternionAngleDegrees(rotation, rotation.map(value => -value)), 0);
});

test('summarizes paired frame states and transform writes', () => {
    const report = summarizeTrace({
        header: {source: 'CampusActorController.LateUpdate'},
        frames: new Map([[7, {
            input: {
                controller: 'actor',
                transforms: [{
                    address: 'bone',
                    name: 'RightFrontHair1_S',
                    path: 'Hips/RightFrontHair1_S',
                    local_position: [0, 0, 0],
                    local_rotation: [0, 0, 0, 1],
                    world_position: [0, 0, 0],
                    world_rotation: [0, 0, 0, 1],
                }],
            },
            output: {
                controller: 'actor',
                transforms: [{
                    address: 'bone',
                    name: 'RightFrontHair1_S',
                    path: 'Hips/RightFrontHair1_S',
                    local_position: [0, 0, 0],
                    local_rotation: [0, 0.3826834, 0, 0.9238795],
                    world_position: [0, 0.1, 0],
                    world_rotation: [0, 0.3826834, 0, 0.9238795],
                }],
            },
        }]]),
        writes: [{
            operation: 'set_localRotation_Injected',
            transform: {address: 'bone', name: 'RightFrontHair1_S'},
        }],
    });

    assert.equal(report.frame_count, 1);
    assert.equal(report.transform_write_count, 1);
    assert.equal(report.transform_write_counts_by_operation.set_localRotation_Injected, 1);
    assert.equal(report.frames[0].bones[0].world_position_delta, 0.1);
    assert.ok(Math.abs(report.frames[0].bones[0].world_rotation_delta_degrees - 45) < 0.01);
    assert.equal(report.bones_sorted_by_observed_rotation_change[0].name, 'RightFrontHair1_S');
});

test('unpaired legacy entry and exit events do not prove completed calls', () => {
    const trace = {
        frames: new Map(),
        writes: [],
        algorithmInvocations: [
            {event: 'algorithm_invocation', method: 'ProcessQuartzDriver', phase: 'enter'},
            {event: 'algorithm_invocation', method: 'ProcessQuartzDriver', phase: 'exit'},
            {event: 'algorithm_invocation', method: 'ProcessSwingSkeleton', phase: 'enter'},
            {event: 'algorithm_invocation', method: 'ProcessSwingSkeleton', phase: 'exit'},
        ],
    };
    const report = summarizeTrace(trace);
    assert.equal(report.algorithm_execution_verified, false);
    assert.equal(report.algorithm_invocation_count, 4);
    assert.equal(report.algorithm_invocation_counts.ProcessQuartzDriver, 2);
    assert.equal(report.algorithm_invocation_phase_counts['ProcessSwingSkeleton:exit'], 1);
});

function invocation(method, phase, callId = 1, thread = 4) {
    return {event: 'algorithm_invocation', method, phase, call_id: callId,
        capture_id: 1, thread_id: thread, self: 'job', animation_stream: 'stream'};
}

test('a paired concrete Quartz job is verified without claiming Swing or full solver IO', () => {
    const report = summarizeTrace({frames: new Map(), writes: [], algorithmInvocations: [
        invocation('QuartzSkirtJob.Execute', 'enter'), invocation('QuartzSkirtJob.Execute', 'exit'),
    ]});
    assert.equal(report.algorithm_execution_verified, true);
    assert.equal(report.quartz_job_execution_verified, true);
    assert.equal(report.process_entry_execution_verified, false);
    assert.equal(report.algorithm_io_verified, false);
    assert.equal(report.algorithm_completed_call_counts['QuartzSkirtJob.Execute'], 1);
});

test('entry only, cross-thread and mismatched call IDs never verify execution', () => {
    for (const events of [
        [invocation('QuartzSkirtJob.Execute', 'enter')],
        [invocation('QuartzSkirtJob.Execute', 'enter'), invocation('QuartzSkirtJob.Execute', 'exit', 2)],
        [invocation('QuartzSkirtJob.Execute', 'enter'), invocation('QuartzSkirtJob.Execute', 'exit', 1, 5)],
        [invocation('QuartzSkirtJob.Execute', 'exit'), invocation('QuartzSkirtJob.Execute', 'enter')],
    ]) {
        assert.equal(summarizeTrace({frames: new Map(), writes: [], algorithmInvocations: events})
            .algorithm_execution_verified, false);
    }
});

test('dispatcher hits alone do not verify physics execution', () => {
    const report = summarizeTrace({frames: new Map(), writes: [], algorithmInvocations: [
        invocation('ProcessAnimation', 'enter'), invocation('ProcessAnimation', 'exit'),
    ]});
    assert.equal(report.animation_dispatch_execution_verified, true);
    assert.equal(report.algorithm_execution_verified, false);
});
