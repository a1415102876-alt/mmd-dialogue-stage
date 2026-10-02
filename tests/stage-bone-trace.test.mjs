import test from 'node:test';
import assert from 'node:assert/strict';
import { Bone, Quaternion, Vector3 } from '../vendor/three/build/three.module.js';
import { buildStageBoneTraceFrame, createStageBoneTrace } from '../stage-bone-trace.js';

test('stage bone trace records hierarchy paths and local/world transforms', () => {
    const root = new Bone();
    root.name = 'Root_Body';
    const head = new Bone();
    head.name = 'Head';
    head.position.set(1, 2, 3);
    head.quaternion.setFromAxisAngle(new Vector3(0, 1, 0), Math.PI / 4);
    root.add(head);
    const hair = new Bone();
    hair.name = 'CenterBackHair1_S';
    hair.position.set(0, 0.5, 0);
    head.add(hair);
    root.updateMatrixWorld(true);

    const frame = buildStageBoneTraceFrame(root, {
        frameId: 7,
        timestampMs: 1234,
        action: '肯定 / 型A-001进入',
        actionTime: 0.1167,
    });
    const record = frame.transforms.find(item => item.name === hair.name);

    assert.equal(frame.event, 'frame_state');
    assert.equal(frame.phase, 'output');
    assert.equal(frame.frame_id, 7);
    assert.equal(frame.action, '肯定 / 型A-001进入');
    assert.deepEqual(record.path, 'Root_Body/Head/CenterBackHair1_S');
    assert.deepEqual(record.local_position, [0, 0.5, 0]);
    assert.equal(record.local_rotation.length, 4);
    assert.equal(record.world_position.length, 3);
    assert.equal(record.world_rotation.length, 4);
});

test('stage trace declares the game capture alignment metadata', () => {
    const trace = createStageBoneTrace({
        idol: 'hski',
        event: '肯定',
        motion: '型A-001进入',
    });

    assert.equal(trace.schema_version, 1);
    assert.equal(trace.source, 'MMDStage.after_secondary_motion');
    assert.deepEqual(trace.alignment, {
        capture_actor: 'hski | CampusActorController[0]',
        capture_event: '肯定',
        capture_motion: '型A-001进入',
        key: 'frame_id + path',
    });
});
