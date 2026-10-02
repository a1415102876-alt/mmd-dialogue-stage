const DEFAULT_ALIGNMENT = Object.freeze({
    capture_actor: 'hski | CampusActorController[0]',
    capture_event: '肯定',
    capture_motion: '型A-001进入',
    key: 'frame_id + path',
});

function numberArray(values) {
    return values.map(value => Number(value));
}

function isBone(object) {
    return !!object && (object.isBone === true || object.type === 'Bone');
}

function bonePath(bone) {
    const names = [];
    let current = bone;
    while (current) {
        if (isBone(current)) names.unshift(current.name || current.uuid || 'unnamed');
        current = current.parent;
    }
    return names.join('/');
}

function collectBones(source) {
    if (Array.isArray(source)) return source.filter(isBone);
    const result = [];
    source?.traverse?.(object => {
        if (isBone(object)) result.push(object);
    });
    return result;
}

export function buildStageBoneTraceFrame(source, options = {}) {
    const transforms = collectBones(source).map(bone => {
        const worldPosition = bone.position.clone().applyMatrix4(bone.matrixWorld);
        const worldQuaternion = bone.quaternion.clone();
        bone.getWorldQuaternion(worldQuaternion);
        return {
            address: bone.uuid || null,
            name: bone.name || bone.uuid || 'unnamed',
            path: bonePath(bone),
            local_position: numberArray(bone.position.toArray()),
            local_rotation: numberArray(bone.quaternion.toArray()),
            world_position: numberArray(worldPosition.toArray()),
            world_rotation: numberArray(worldQuaternion.toArray()),
        };
    });
    return {
        event: 'frame_state',
        phase: options.phase || 'output',
        frame_id: Number.isInteger(options.frameId) ? options.frameId : 0,
        timestamp_ms: Number.isFinite(Number(options.timestampMs)) ? Number(options.timestampMs) : Date.now(),
        action: options.action || null,
        action_time: Number.isFinite(Number(options.actionTime)) ? Number(options.actionTime) : null,
        coordinate_space: 'Three.js.local_and_world',
        transforms,
    };
}

export function createStageBoneTrace(metadata = {}) {
    return {
        schema_version: 1,
        source: 'MMDStage.after_secondary_motion',
        started_at: new Date().toISOString(),
        metadata: { ...metadata },
        alignment: { ...DEFAULT_ALIGNMENT },
        phase_semantics: {
            input: 'after_animation_before_secondary_motion',
            output: 'after_secondary_motion_and_matrix_refresh',
        },
        frame_count: 0,
        frames: [],
    };
}
