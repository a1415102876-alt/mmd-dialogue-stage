export const QUARTZ_HAIR = 'ActorAnimationQuartzDriverHairBone';
export const QUARTZ_SKIRT = 'ActorAnimationQuartzDriverSkirtBone';
export const APPLY_SPRING_ANGLE_LIMITS = true;
export const APPLY_SKIRT_QUARTZ_LIMITS = false;
export const APPLY_SKIRT_INNER_OUTER = false;
// FKTN has skirt Quartz drivers, but no corresponding jacket/Poncho driver.
// The jacket is authored as its own DynamicBone network; copying the skirt's
// UpLeg correction into Jacket3 breaks the authored chain continuity.
export const APPLY_JACKET_SKIRT_FOLLOW = false;
export const RECOVERED_PHYSICS_ALGORITHM = 'gakumas-runtime-recovered-v1';
// ActorSwingChain is solved together with fixed-length bone tails. Applying
// the entire ring correction in one pass makes a small radius change turn
// into a large bone rotation, so carry the correction into subsequent frames.
export const CHAIN_SEPARATION_RESPONSE = 0.35;
export const DEFAULT_SECONDARY_TUNING = Object.freeze({
    gravity: 1,
    damping: 1,
    spring: 1,
    stiffness: 1,
    physics: 1,
    rootFollow: 1,
    chainSkirtRadius: 1,
    chainJacketRadius: 1,
    chainGap: 0,
    chainOrder: 'after-collision',
});

export function chainLayerKind(layer) {
    const name = layer?.bones?.[0] || layer?.items?.[0]?.record?.bone || '';
    if (/Skirt/i.test(name)) return 'skirt';
    if (/Jacket/i.test(name)) return 'jacket';
    return 'other';
}

export function chainLayerMinimumDistance(layer, scale = 1, tuning = DEFAULT_SECONDARY_TUNING) {
    const kind = chainLayerKind(layer);
    const radiusScale = kind === 'skirt'
        ? Number(tuning.chainSkirtRadius)
        : kind === 'jacket'
            ? Number(tuning.chainJacketRadius)
            : 1;
    const safeScale = Number.isFinite(Number(scale)) ? Math.max(0, Number(scale)) : 1;
    const safeRadiusScale = Number.isFinite(radiusScale) ? Math.max(0, radiusScale) : 1;
    const gap = Number.isFinite(Number(tuning.chainGap)) ? Math.max(0, Number(tuning.chainGap)) : 0;
    return (2 * Math.max(0, Number(layer?.radius) || 0) * safeRadiusScale + gap) * safeScale;
}

export function clampAxis(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

export function scaleAndClampEuler(source, coefficient, min, max) {
    const values = Array.isArray(source) ? source : [0, 0, 0];
    const scale = Array.isArray(coefficient) ? coefficient : [0, 0, 0];
    const low = Array.isArray(min) ? min : [-180, -180, -180];
    const high = Array.isArray(max) ? max : [180, 180, 180];
    return [0, 1, 2].map(index => clampAxis((values[index] || 0) * (scale[index] || 0), low[index] ?? -180, high[index] ?? 180));
}

export function driverSide(boneName) {
    if (/^Right/.test(boneName || '')) return 'right';
    if (/^Left/.test(boneName || '')) return 'left';
    return 'center';
}

const LEG_COLLIDER_NAME = /^(Left|Right)(UpLeg|Leg|Foot|ToeBase)\b/;
const HAIR_BONE_NAME = /Hair/i;

export function shouldPreserveHairRestTail(boneName, table = null) {
    if (table?.hairRestTailMode === 'braid-only') {
        const name = boneName || '';
        return /^(?:Left|Right)(?:SideHair|SideBackCHair)/i.test(name) && !/Front/i.test(name);
    }
    if (table?.hairRestTailMode === 'braid-and-back') {
        const name = boneName || '';
        return /(?:SideHair|SideBackCHair|BackHair|BackSideHair|BackUHair)/i.test(name)
            && !/Front/i.test(name);
    }
    return HAIR_BONE_NAME.test(boneName || '');
}

export function gravityScaleForSpring(record, table = null, tuning = DEFAULT_SECONDARY_TUNING) {
    const partGravity = table?.gravityScaleByPart?.[record?.part];
    const base = Number.isFinite(Number(partGravity))
        ? Number(partGravity)
        : Number(tuning.gravity ?? 1) * Number(tuning.physics ?? 1);
    const name = record?.bone || '';
    // The recovered back-hair rest tail already points along world down. Keep
    // its authored sag, but avoid applying the full generic hair gravity a
    // second time to the long rear chains. This is a profile-level correction
    // because the native spring parameters remain shared and untouched.
    const isBackHairGroup = /(?:SideBackCHair|BackSideHair|BackSideCHair|BackUHair)/i.test(name)
        || /(?:^|(?:Center|Left|Right))BackHair/i.test(name);
    const group = isBackHairGroup
        && !/Front/i.test(name)
        ? 'backHair'
        : null;
    const groupScale = group ? table?.gravityScaleByBoneGroup?.[group] : null;
    return base * (groupScale != null && Number.isFinite(Number(groupScale)) ? Number(groupScale) : 1);
}

const THIGH_COLLIDER_NAME = /^(Left|Right)(UpLeg|Leg)$/;

export function skirtThighCollider(particleBone, colliderBone) {
    // The skirt hem uses a separate layer-follow correction in the native
    // job, so its dynamic radius is not added to the thigh capsule. The
    // jacket is intentionally allowed to keep its particle thickness here;
    // that is the small outward shell visible around the jacket in-game.
    return /Skirt/i.test(particleBone || '') && THIGH_COLLIDER_NAME.test(colliderBone || '');
}

export function staticParticleRadius(particleBone, particleRadius, scale = 1) {
    // Skirt particles already receive the native thigh-follow correction and
    // their authored radius is not used as an extra shell against the body's
    // static colliders. Keeping it here balloons the hem (including Kotone).
    if (/Skirt/i.test(particleBone || '')) return 0;
    return Math.max(0, Number(particleRadius) || 0) * Math.max(0, Number(scale) || 0);
}

/**
 * Static-collider thickness of the particle at a spring's tail.
 * Skirts can opt into the native tail particle radius because their frill
 * reaches past the spring segment while sitting.
 */
export function springStaticParticleRadius(record, tailRecord, table = null, scale = 1) {
    if (/Skirt/i.test(record?.bone || '') && table?.skirtStaticParticleRadius === 'tail-particle') {
        const tail = Number(tailRecord?.particleRadius);
        const radius = Number.isFinite(tail) && tail >= 0 ? tail : Number(record?.particleRadius) || 0;
        return Math.max(0, radius) * Math.max(0, Number(scale) || 0);
    }
    return staticParticleRadius(record?.bone, record?.particleRadius, scale);
}

export function skipsContralateralLegCollider(particleBone, colliderBone) {
    if (!LEG_COLLIDER_NAME.test(colliderBone || '')) return false;
    const particle = driverSide(particleBone);
    const collider = driverSide(colliderBone);
    return particle !== 'center' && collider !== 'center' && particle !== collider;
}

export function skipsHairSpineCollider(particleBone, colliderBone, table = null) {
    // Default Kotone braid-root rule. Other idols override via
    // table.hairSpineColliderSkip so SideHair1 is not forced onto every model.
    const override = table?.hairSpineColliderSkip;
    if (override && Array.isArray(override.particles) && override.particles.length) {
        const colliders = Array.isArray(override.colliders) && override.colliders.length
            ? override.colliders
            : ['Spine2', 'Spine02', 'Neck'];
        return override.particles.includes(particleBone || '')
            && colliders.includes(colliderBone || '');
    }
    // Native capture separates the attached braid root from its tail: the
    // SideHair1 node is the anchor, while SideHair2..8 use mask 8, matching
    // the Neck and Spine2 static colliders. Only the root must avoid a
    // projection that would move the whole braid sideways; descendants need
    // the torso collision to be carried toward the front of the body.
    return /^(Left|Right)SideHair1_S$/.test(particleBone || '')
        && /^(Spine2|Spine02|Neck)$/.test(colliderBone || '');
}

export function skipsHairRootFaceCollider(particleBone, colliderBone) {
    // SideHair roots must be constrained by the authored head capsule too.
    // The old root exemption made the first segment bypass Head_Face while
    // SideHair2+ still collided with it, producing a discontinuous chain.
    return false;
}

export function skipsConfiguredHairRootCollider(particleBone, colliderBone, table = null) {
    const configured = table?.hairRootColliderSkip;
    const rules = Array.isArray(configured) ? configured : [configured];
    return rules.some(rule => !!rule
        && Array.isArray(rule.particles) && rule.particles.includes(particleBone || '')
        && Array.isArray(rule.colliders) && rule.colliders.includes(colliderBone || ''));
}

export function skipsLargeSpineSkirtCollider(particleBone, colliderBone, colliderMask) {
    return /Skirt/.test(particleBone || '') && colliderBone === 'Spine2' && (colliderMask | 0) === 16;
}

export function isHairVolumeCollider(record) {
    if (record?.collisionMode === 'hairVolume') return true;
    // Older recovered profiles do not carry the explicit mode yet. The
    // native Spine2 mask-16 capsule is the same authored long hair volume.
    return record?.bone === 'Spine2'
        && (Number(record?.collisionMask) | 0) === 16
        && Number(record?.radiusA) >= 0.25
        && Number(record?.unityLength) >= 0.5;
}

function dynamicRecordMask(record) {
    const direct = Number(record?.collisionMask);
    if (Number.isFinite(direct)) return direct | 0;
    return Number(record?.dynamicCollider?.collisionMask) | 0;
}

function dynamicRecordType(record) {
    const direct = Number(record?.colliderType);
    if (Number.isFinite(direct)) return direct;
    return Number(record?.dynamicCollider?.type) || 0;
}

function dynamicRecordRadius(record) {
    const direct = Number(record?.particleRadius);
    if (Number.isFinite(direct) && direct >= 0) return direct;
    return Number(record?.dynamicCollider?.radiusA) || 0;
}

export function colliderGeometryMoved(current, previous, threshold = 1e-5) {
    if (!Array.isArray(current) || !Array.isArray(previous) || current.length !== previous.length) return false;
    return current.some((collider, index) => {
        const before = previous[index];
        if (!before) return true;
        const points = [collider.start, collider.end, before.start, before.end];
        if (points.some(point => !Array.isArray(point) || point.length < 3)) return false;
        return Math.max(
            vecLength(sub(collider.start, before.start)),
            vecLength(sub(collider.end, before.end)),
        ) > threshold;
    });
}

/**
 * Native dynamic colliders use separate layer masks for the clothing and hair
 * particles. Only the captured hair/jacket path is retained here.
 * Skirt/jacket dynamic pairs are intentionally excluded: the recovered
 * 5573E010 path consumes staticBones, while projecting two live clothing
 * chains would move a parent and then project its descendants again.
 */
export function dynamicParticlePairAllowed(firstRecord, secondRecord) {
    const firstBone = firstRecord?.bone || '';
    const secondBone = secondRecord?.bone || '';
    if (dynamicRecordType(firstRecord) === 4 || dynamicRecordType(secondRecord) === 4) return false;
    if (!masksOverlap(dynamicRecordMask(firstRecord), dynamicRecordMask(secondRecord))) return false;
    const firstHair = /Hair/i.test(firstBone);
    const secondHair = /Hair/i.test(secondBone);
    const firstSkirt = /Skirt/i.test(firstBone);
    const secondSkirt = /Skirt/i.test(secondBone);
    const firstJacket = /Jacket/i.test(firstBone);
    const secondJacket = /Jacket/i.test(secondBone);
    const jacketSkirtPair = (firstJacket && secondSkirt) || (secondJacket && firstSkirt);
    if (jacketSkirtPair) {
        // 5573E010 consumes the captured staticBones list. It does not prove
        // that two dynamic clothing chains are a collision pair. Projecting
        // skirt and jacket particles here makes a parent correction move all
        // descendants, then the next layer projects them again. That is the
        // source of the motion-only jitter and long jumps; their body/leg
        // colliders remain handled by the static collision pass below.
        return false;
    }
    return (firstJacket && secondHair) || (secondJacket && firstHair);
}

export function resolveDynamicParticlePair(first, second, firstRecord, secondRecord, radiusScale = 1, firstPrevious = null, secondPrevious = null, firstRest = null, secondRest = null) {
    if (!dynamicParticlePairAllowed(firstRecord, secondRecord)) {
        return { first: [...first], second: [...second], collided: false };
    }
    const radiusA = Math.max(0, dynamicRecordRadius(firstRecord) * (Number(radiusScale) || 0));
    const radiusB = Math.max(0, dynamicRecordRadius(secondRecord) * (Number(radiusScale) || 0));
    const delta = sub(second, first);
    const distance = vecLength(delta);
    const physicalMinimum = radiusA + radiusB;
    const restDistance = Array.isArray(firstRest) && Array.isArray(secondRest)
        ? vecLength(sub(secondRest, firstRest))
        : Number.NaN;
    // The PMX rest pose can intentionally place neighboring clothing spheres
    // inside their Unity radii. Preserve that authored gap as the contact
    // distance; otherwise the spring target and the pair solver fight forever.
    const minimum = Number.isFinite(restDistance) && restDistance > 1e-8
        ? Math.min(physicalMinimum, restDistance)
        : physicalMinimum;
    if (!(minimum > 1e-8) || distance >= minimum) {
        return { first: [...first], second: [...second], collided: false };
    }
    if (Array.isArray(firstPrevious) && Array.isArray(secondPrevious)) {
        const firstMotion = sub(first, firstPrevious);
        const secondMotion = sub(second, secondPrevious);
        const relativeMotion = sub(secondMotion, firstMotion);
        // The authored PMX rest pose has a few skirt/jacket particle spheres
        // inside each other. Native swing collision is a contact response for
        // particles moving into one another; resolving those static overlaps
        // every frame fights the spring rest pose and creates visible jitter.
        if (dot(delta, relativeMotion) >= -1e-8) {
            return { first: [...first], second: [...second], collided: false };
        }
    }
    const direction = distance > 1e-8 ? scale(delta, 1 / distance) : [0, 1, 0];
    const overlap = minimum - distance;
    const firstJacket = /Jacket/i.test(firstRecord?.bone || '');
    const secondJacket = /Jacket/i.test(secondRecord?.bone || '');
    // The jacket layer is the moving obstacle for the hair/skirt layers. A
    // one-sided response avoids the two independently simulated chains
    // exchanging the same correction every frame and reproducing the old
    // shaking feedback. This is the runtime mask pairing, while the exact
    // recovered E3020 mode 2 remains reserved for native endpoint geometry.
    if (firstJacket && !secondJacket) {
        return {
            first: [...first],
            second: add(second, scale(direction, overlap)),
            collided: true,
            distance,
            radiusA,
            radiusB,
            overlap,
        };
    }
    if (secondJacket && !firstJacket) {
        return {
            first: sub(first, scale(direction, overlap)),
            second: [...second],
            collided: true,
            distance,
            radiusA,
            radiusB,
            overlap,
        };
    }
    const total = radiusA + radiusB;
    const firstMove = overlap * (radiusB / total);
    const secondMove = overlap * (radiusA / total);
    return {
        first: sub(first, scale(direction, firstMove)),
        second: add(second, scale(direction, secondMove)),
        collided: true,
        distance,
        radiusA,
        radiusB,
        overlap,
    };
}

export function hairDriverEuler(headEuler, neckEuler, setting) {
    const head = scaleAndClampEuler(headEuler, setting?.headRotateCoefficient, setting?.headRotateLimitMin, setting?.headRotateLimitMax);
    const neck = scaleAndClampEuler(neckEuler, setting?.neckRotateCoefficient, setting?.neckRotateLimitMin, setting?.neckRotateLimitMax);
    return [head[0] + neck[0], head[1] + neck[1], head[2] + neck[2]];
}

export const SKIRT_OUTER_DEADZONE = 8;

export function quatDot4(a, b) {
    return (a?.[0] || 0) * (b?.[0] || 0) + (a?.[1] || 0) * (b?.[1] || 0) + (a?.[2] || 0) * (b?.[2] || 0) + (a?.[3] || 0) * (b?.[3] || 0);
}

export function quatNegate(q) {
    return [-(q?.[0] || 0), -(q?.[1] || 0), -(q?.[2] || 0), -(q?.[3] || 0)];
}

export function quatShortest(q) {
    return (q?.[3] || 0) < 0 ? quatNegate(q) : q;
}

export function relativeQuaternion(rest, current) {
    return quatShortest(quatNormalize(quatMultiply(quatInverse(rest), current)));
}

export function quatSlerp(a, b, t) {
    const amount = clampAxis(t, 0, 1);
    let end = b;
    let cosom = quatDot4(a, b);
    if (cosom < 0) {
        end = quatNegate(b);
        cosom = -cosom;
    }
    if (cosom > 0.9995) {
        return quatNormalize([
            a[0] + (end[0] - a[0]) * amount,
            a[1] + (end[1] - a[1]) * amount,
            a[2] + (end[2] - a[2]) * amount,
            a[3] + (end[3] - a[3]) * amount,
        ]);
    }
    const omega = Math.acos(Math.min(1, cosom));
    const sinom = Math.sin(omega) || 1;
    const scaleA = Math.sin((1 - amount) * omega) / sinom;
    const scaleB = Math.sin(amount * omega) / sinom;
    return [
        a[0] * scaleA + end[0] * scaleB,
        a[1] * scaleA + end[1] * scaleB,
        a[2] * scaleA + end[2] * scaleB,
        a[3] * scaleA + end[3] * scaleB,
    ];
}

export function skirtTwistAxis(setting) {
    const axis = Number.isInteger(setting?.connectionAxis) ? setting.connectionAxis : 0;
    if (axis === 1) return [0, 0, 1];
    if (axis === 2) return [-1, 0, 0];
    return [0, 1, 0];
}

export function swingTwistDecompose(q, axis) {
    const n = normalize(axis);
    const proj = dot([q[0], q[1], q[2]], n);
    const twist = quatShortest(quatNormalize([n[0] * proj, n[1] * proj, n[2] * proj, q[3]]));
    const swing = quatShortest(quatNormalize(quatMultiply(q, quatInverse(twist))));
    return { swing, twist };
}

export function twistAngleDegrees(q, axis) {
    const { twist } = swingTwistDecompose(q, axis);
    const n = normalize(axis);
    return Math.atan2(twist[0] * n[0] + twist[1] * n[1] + twist[2] * n[2], twist[3]) * 360 / Math.PI;
}

export function femurAbductionDegrees(q, side) {
    const along = quatRotate(quatShortest(quatNormalize(q || [0, 0, 0, 1])), [0, -1, 0]);
    const lateral = side === 'right' ? -along[0] : along[0];
    return Math.atan2(lateral, Math.hypot(along[1], along[2])) * 180 / Math.PI;
}

export function skirtIsOuter(sourceQuat, setting, side, _wasOuter = true) {
    if (!APPLY_SKIRT_INNER_OUTER) return true;
    return femurAbductionDegrees(sourceQuat, side) > -SKIRT_OUTER_DEADZONE;
}

export function skirtCoefficient(sourceQuat, setting, side, wasOuter = true) {
    return skirtIsOuter(sourceQuat, setting, side, wasOuter) ? setting?.outerCoefficient : setting?.innerCoefficient;
}

function coefficientWeight(coefficient, axis, twist) {
    const scale = Array.isArray(coefficient) ? coefficient : [1, 1, 1];
    if (twist) return scale[axis] ?? 1;
    const others = [0, 1, 2].filter(index => index !== axis);
    return 0.5 * ((scale[others[0]] ?? 1) + (scale[others[1]] ?? 1));
}

export function skirtDriverQuaternion(sourceQuat, setting, side, wasOuter = true) {
    const extra = quatShortest(quatNormalize(sourceQuat || [0, 0, 0, 1]));
    const coeff = skirtCoefficient(extra, setting, side, wasOuter);
    const axis = Number.isInteger(setting?.connectionAxis) ? setting.connectionAxis : 0;
    const twistWeight = coefficientWeight(coeff, axis, true);
    const swingWeight = coefficientWeight(coeff, axis, false);
    if (!APPLY_SKIRT_QUARTZ_LIMITS && Math.abs(twistWeight - 1) < 1e-6 && Math.abs(swingWeight - 1) < 1e-6) return extra;
    const { swing, twist } = swingTwistDecompose(extra, skirtTwistAxis(setting));
    return quatShortest(quatNormalize(quatMultiply(
        quatSlerp([0, 0, 0, 1], swing, swingWeight),
        quatSlerp([0, 0, 0, 1], twist, twistWeight),
    )));
}

function wrapRuntimeDegrees(value) {
    if (value > 180) return value - 360;
    if (value < -180) return value + 360;
    return value;
}

function runtimeLimit(value, min, max) {
    return Math.max(min, Math.min(value, max));
}

function quaternionToRuntimeEulerDegrees(q) {
    const x = q?.[0] || 0;
    const y = q?.[1] || 0;
    const z = q?.[2] || 0;
    const negatedW = -(q?.[3] || 0);
    const axisX = (z * y - negatedW * x) * -2;
    const axisXDenom = ((negatedW * negatedW - x * x) - y * y) + z * z;
    const sine = Math.min(1, Math.max(-1, 2 * (negatedW * y + z * x)));
    const axisZ = (y * x - z * negatedW) * -2;
    const axisZDenom = ((negatedW * negatedW + x * x) - y * y) - z * z;
    return [
        -Math.atan2(axisX, axisXDenom) * 180 / Math.PI,
        -Math.asin(sine) * 180 / Math.PI,
        -Math.atan2(axisZ, axisZDenom) * 180 / Math.PI,
    ];
}

function skirtSwingDegrees(euler) {
    const direction = quatRotate(eulerDegreesToQuaternionXYZ(euler), [0, 1, 0]);
    const flexion = 2 * Math.atan2(direction[2], direction[1] + 1) * 180 / Math.PI;
    const abduction = -2 * Math.atan2(direction[0], direction[1] + 1) * 180 / Math.PI;
    return [0, abduction, flexion];
}

function blendSkirtAxis(angle, inner, outer, min, max) {
    const wrapped = wrapRuntimeDegrees(angle || 0);
    let limited = wrapped;
    if (Number.isFinite(max) && !(wrapped < max)) limited = max;
    if (Number.isFinite(min) && !(min < limited)) limited = min;
    return (outer || 0) * wrapped + ((inner || 0) - (outer || 0)) * limited;
}

function runtimeQuatMul(left, right) {
    const lx = left[0] || 0;
    const ly = left[1] || 0;
    const lz = left[2] || 0;
    const lw = left[3] || 0;
    const rx = right[0] || 0;
    const ry = right[1] || 0;
    const rz = right[2] || 0;
    const rw = right[3] || 0;
    return [
        (lz * ry + lw * rx + lx * rw) - ly * rz,
        (lx * rz + lw * ry + ly * rw) - lz * rx,
        (ly * rx + lw * rz + lz * rw) - lx * ry,
        (-(ly * ry + lx * rx) + lw * rw) - lz * rz,
    ];
}

function skirtOutputMul(twist, swing) {
    const bx = twist[0] || 0;
    const by = twist[1] || 0;
    const bz = twist[2] || 0;
    const bw = twist[3] || 0;
    const cx = swing[0] || 0;
    const cy = swing[1] || 0;
    const cz = swing[2] || 0;
    const cw = swing[3] || 0;
    return [
        (by * cz + bx * cw + bw * cx) - bz * cy,
        (bz * cx + by * cw + bw * cy) - bx * cz,
        (bx * cy + bz * cw + bw * cz) - by * cx,
        (-(by * cy + bx * cx) + bw * cw) - bz * cz,
    ];
}

function skirtCalcQuaternion(twistRad, abductionRad, flexionRad) {
    const sinFlex = Math.sin(-flexionRad * 0.5);
    const sinAbd = Math.sin(abductionRad * 0.5);
    const scale = 2 / (sinFlex * sinFlex + sinAbd * sinAbd + 1);
    const swing = quatFromTo([1, 0, 0], [scale - 1, scale * sinFlex, scale * sinAbd]);
    const halfTwist = -twistRad * 0.5;
    return skirtOutputMul([Math.sin(halfTwist), 0, 0, Math.cos(halfTwist)], swing);
}

function unityCalcQuaternionToPmx(q) {
    return quatNormalize([q[2], q[0], q[1], q[3]]);
}

export function skirtReferenceQuaternion(initial, current) {
    const q = quatNormalize(initial || [0, 0, 0, 1]);
    const length2 = q[0] * q[0] + q[1] * q[1] + q[2] * q[2] + q[3] * q[3] || 1;
    const scale = 1 / length2;
    return quatNormalize(runtimeQuatMul(
        [-q[0] * scale, -q[1] * scale, -q[2] * scale, q[3] * scale],
        quatNormalize(current || [0, 0, 0, 1]),
    ));
}

function quaternionToRuntimeEulerOrder2(q) {
    const x = q?.[0] || 0;
    const y = q?.[1] || 0;
    const z = q?.[2] || 0;
    const negatedW = -(q?.[3] || 0);
    const denomYaw = ((negatedW * negatedW - x * x) - y * y) + z * z;
    const denomRoll = ((negatedW * negatedW - x * x) + y * y) - z * z;
    const sine = Math.min(1, Math.max(-1, (z * y - negatedW * x) * -2));
    return [
        -Math.asin(sine) * 180 / Math.PI,
        -Math.atan2(2 * (negatedW * y + z * x), denomYaw) * 180 / Math.PI,
        -Math.atan2(2 * (negatedW * z + y * x), denomRoll) * 180 / Math.PI,
    ];
}

function hairSwingDegrees(q) {
    const quat = quatNormalize(q || [0, 0, 0, 1]);
    const qx = quat[0];
    const qy = quat[1];
    const qz = quat[2];
    const qw = quat[3];
    const denom = qw * qw + qy * qy || 1;
    return [
        quaternionToRuntimeEulerOrder2(quat)[1],
        2 * Math.atan2(qz * qy + qx * qw, denom) * 180 / Math.PI,
        -2 * Math.atan2(qx * qy - qz * qw, denom) * 180 / Math.PI,
    ];
}

function scaleClampedAxis(angle, coefficient, min, max) {
    const wrapped = wrapRuntimeDegrees(angle || 0);
    let limited = wrapped;
    if (Number.isFinite(max) && !(wrapped < max)) limited = max;
    if (Number.isFinite(min) && !(min < limited)) limited = min;
    return (coefficient || 0) * limited;
}

function hairChannel(swing, coefficient, min, max) {
    const scale = Array.isArray(coefficient) ? coefficient : [0, 0, 0];
    const low = Array.isArray(min) ? min : [-180, -180, -180];
    const high = Array.isArray(max) ? max : [180, 180, 180];
    return [
        scaleClampedAxis(swing[1], scale[0], low[0], high[0]),
        scaleClampedAxis(swing[0], scale[1], low[1], high[1]),
        scaleClampedAxis(swing[2], scale[2], low[2], high[2]),
    ];
}

// 30250: connection-axis byte permutes the three scaled channels. Axis 0 is identity.
export function connectionAxisPermute(x, y, z, axis) {
    let param2 = x;
    const param3 = y;
    const param4 = z;
    const param5 = axis & 0xff;
    let uVar1 = param2;
    let uVar2 = param2;
    let uVar3;
    const byteSub2 = (param5 - 2) & 0xff;
    if ((((param5 > 1) && (uVar3 = param4, uVar1 = param3, byteSub2 > 1)) || (uVar3 = uVar1, param5 !== 2))
        && (param5 !== 4 && (uVar2 = param3, param5 !== 0))
        && param5 !== 5) {
        uVar2 = param4;
    }
    if (((param5 - 3) & 0xfd) !== 0 && (param5 === 1 || (param2 = param4, param5 === 4))) {
        return [uVar3, uVar2, param3];
    }
    return [uVar3, uVar2, param2];
}

function hairComposeRadians(headQuat, neckQuat, setting) {
    const head = hairChannel(hairSwingDegrees(headQuat), setting?.headRotateCoefficient, setting?.headRotateLimitMin, setting?.headRotateLimitMax);
    const neck = hairChannel(hairSwingDegrees(neckQuat), setting?.neckRotateCoefficient, setting?.neckRotateLimitMin, setting?.neckRotateLimitMax);
    return [0, 1, 2].map(index => (head[index] + neck[index]) * Math.PI / 180);
}

export function recoveredHairLocalOffset(headQuat, setting) {
    const channel = hairChannel(
        hairSwingDegrees(headQuat),
        setting?.headTranslateCoefficient,
        setting?.headTranslateLimitMin,
        setting?.headTranslateLimitMax,
    );
    const axis = Number.isInteger(setting?.translateConnectionAxis) ? setting.translateConnectionAxis : 0;
    return connectionAxisPermute(channel[0], channel[1], channel[2], axis);
}

export function recoveredHairDriverQuaternion(headQuat, neckQuat, setting) {
    const summed = hairComposeRadians(headQuat, neckQuat, setting);
    // composeType 0 is 2E2F0, the same swing quaternion the skirt writes.
    // rotationOrder 0 and rotateConnectionAxis 0 do not reorder it, so it enters PMX on the skirt's axis map.
    const composed = skirtCalcQuaternion(summed[0], summed[1], summed[2]);
    return unityCalcQuaternionToPmx(composed);
}

export function skirtDriverSwingSigns(table, boneName) {
    const rule = table?.skirtDriverSwingSigns;
    if (!rule || typeof rule !== 'object') return null;
    const side = driverSide(boneName) === 'left' ? 'Left' : driverSide(boneName) === 'right' ? 'Right' : 'Center';
    const pick = value => {
        const raw = value && typeof value === 'object' ? value[side] : value;
        return Number(raw) < 0 ? -1 : 1;
    };
    return [1, pick(rule.abduction), pick(rule.flexion)];
}

export function recoveredSkirtDriverQuaternion(sourceQuat, setting, swingSigns = null) {
    const relative = quatNormalize(sourceQuat || [0, 0, 0, 1]);
    const measured = skirtSwingDegrees(quaternionToRuntimeEulerDegrees(relative));
    const swing = Array.isArray(swingSigns)
        ? measured.map((value, index) => value * (swingSigns[index] < 0 ? -1 : 1))
        : measured;
    const inner = Array.isArray(setting?.innerCoefficient) ? setting.innerCoefficient : [0, 0, 0];
    const outer = Array.isArray(setting?.outerCoefficient) ? setting.outerCoefficient : [0, 0, 0];
    const min = Array.isArray(setting?.limitMin) ? setting.limitMin : [-180, -180, -180];
    const max = Array.isArray(setting?.limitMax) ? setting.limitMax : [180, 180, 180];
    const blended = [0, 1, 2].map(index => blendSkirtAxis(swing[index], inner[index], outer[index], min[index], max[index]));
    const radians = blended.map(degrees => degrees * Math.PI / 180);
    return unityCalcQuaternionToPmx(skirtCalcQuaternion(radians[0], radians[1], radians[2]));
}

export function composeRestAndQuat(rest, extra) {
    return quatNormalize(quatMultiply(rest, extra));
}

function quatFromAxisAngle(axis, degrees) {
    const half = (degrees * Math.PI) / 360;
    const s = Math.sin(half);
    return [axis[0] * s, axis[1] * s, axis[2] * s, Math.cos(half)];
}

function quatMultiply(a, b) {
    return [
        a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
        a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
        a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
        a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
    ];
}

function quatNormalize(q) {
    const length = Math.hypot(q[0], q[1], q[2], q[3]) || 1;
    return [q[0] / length, q[1] / length, q[2] / length, q[3] / length];
}

function quatInverse(q) {
    return [-q[0], -q[1], -q[2], q[3]];
}

function unityLocalRotationToThree(q) {
    if (!Array.isArray(q) || q.length < 4) return [0, 0, 0, 1];
    return quatNormalize([-q[0], q[1], -q[2], q[3]]);
}

function quatRotate(q, v) {
    const u = [q[0], q[1], q[2]];
    const t = cross(u, v).map(value => value * 2);
    return add(v, add(scale(t, q[3]), cross(u, t)));
}

export function eulerDegreesToQuaternionXYZ(euler) {
    const x = quatFromAxisAngle([1, 0, 0], euler[0] || 0);
    const y = quatFromAxisAngle([0, 1, 0], euler[1] || 0);
    const z = quatFromAxisAngle([0, 0, 1], euler[2] || 0);
    return quatMultiply(quatMultiply(x, y), z);
}

export function quaternionToEulerDegreesXYZ(q) {
    const [x, y, z, w] = q;
    const sinp = 2 * (w * y - z * x);
    const pitch = Math.abs(sinp) >= 1 ? Math.sign(sinp) * Math.PI / 2 : Math.asin(sinp);
    const roll = Math.atan2(2 * (w * x + y * z), 1 - 2 * (x * x + y * y));
    const yaw = Math.atan2(2 * (w * z + x * y), 1 - 2 * (y * y + z * z));
    return [roll, pitch, yaw].map(value => value * 180 / Math.PI);
}

export function relativeEulerDegrees(rest, current) {
    return quaternionToEulerDegreesXYZ(quatMultiply(quatInverse(rest), current));
}

export function composeRestAndExtra(rest, extraEuler) {
    return quatMultiply(rest, eulerDegreesToQuaternionXYZ(extraEuler));
}

export function selectQuartzDrivers(table) {
    const useRecoveredAlgorithm = table?.physicsAlgorithm === RECOVERED_PHYSICS_ALGORITHM;
    return (table?.drivers || []).filter(driver => driver?.enabled
        && (driver.className === QUARTZ_HAIR || driver.className === QUARTZ_SKIRT)
        && !(driver.className === QUARTZ_SKIRT && !useRecoveredAlgorithm && /Back/i.test(driver.bone || ''))
        && !(driver.className === QUARTZ_SKIRT && table?.disableSkirtMotion));
}

export function jacketSkirtAnchor(boneName) {
    return (boneName || '').replace('Jacket', 'Skirt').replace(/3_S$/, '_A');
}

export function selectJacketFollowDrivers(table) {
    if (!APPLY_JACKET_SKIRT_FOLLOW || table?.disableJacketSkirtFollow) return [];
    const skirts = new Map(
        (table?.drivers || [])
            .filter(driver => driver?.enabled && driver.className === QUARTZ_SKIRT)
            .map(driver => [driver.bone, driver]),
    );
    const seen = new Set();
    return (table?.springs || []).flatMap(record => {
        const bone = record?.bone;
        if (!/Jacket3_S$/.test(bone || '') || seen.has(bone)) return [];
        seen.add(bone);
        const skirt = skirts.get(jacketSkirtAnchor(bone));
        return skirt ? [{ ...skirt, bone, className: QUARTZ_SKIRT }] : [];
    });
}

export const JACKET_FOLLOW_WEIGHT = 1;
export const FOLLOW_SMOOTH = 0.35;

export function scaleFollowExtra(extra, weight) {
    return quatSlerp([0, 0, 0, 1], quatShortest(extra || [0, 0, 0, 1]), weight);
}

export function smoothFollowExtra(previous, target, amount) {
    if (!previous) return quatShortest(target || [0, 0, 0, 1]);
    return quatSlerp(previous, quatShortest(target || [0, 0, 0, 1]), amount);
}

export function add(a, b) { return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]; }
export function sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
export function scale(a, s) { return [a[0] * s, a[1] * s, a[2] * s]; }
export function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
export function cross(a, b) {
    return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
export function vecLength(a) { return Math.hypot(a[0], a[1], a[2]); }
export function normalize(a) {
    const length = vecLength(a);
    return length < 1e-8 ? [0, 0, 0] : scale(a, 1 / length);
}

export function medianScale(pairs) {
    const ratios = pairs.filter(([unity, pmx]) => unity > 1e-5 && pmx > 1e-5).map(([unity, pmx]) => pmx / unity).sort((a, b) => a - b);
    if (!ratios.length) return 1;
    const mid = Math.floor(ratios.length / 2);
    return ratios.length % 2 ? ratios[mid] : 0.5 * (ratios[mid - 1] + ratios[mid]);
}

export function integrateTail(previous, current, rest, params, dt, worldScale = 1) {
    const damping = clampAxis(params?.damping ?? 0, 0, 0.98);
    const inertia = scale(sub(current, previous), 1 - damping);
    const restore = add(scale(sub(rest, current), params?.stiffness ?? 0), scale(sub(rest, current), (params?.spring ?? 0) * dt));
    const mass = clampAxis(params?.mass ?? 0, 0, 1);
    const gravityWeight = /Hair/i.test(params?.bone || '') ? 0.85 : 0.35;
    // Native values use Unity metres; particle positions in the PMX stage use
    // the model scale. Apply the same scale to gravity so hair can actually
    // sag over its much longer rendered segments.
    const gravity = [0, -0.12 * gravityWeight * (0.35 + 0.65 * mass) * (params?.gravityScale ?? 1) * worldScale * dt, 0];
    const axisCoupling = params?.axisAddXToY || params?.axisAddXToZ
        ? [0, inertia[0] * (params.axisAddXToY || 0), inertia[0] * (params.axisAddXToZ || 0)]
        : [0, 0, 0];
    return add(add(add(add(current, inertia), restore), gravity), axisCoupling);
}

export function constrainLength(origin, point, length) {
    const offset = sub(point, origin);
    const current = vecLength(offset);
    if (current < 1e-8) return add(origin, [0, length, 0]);
    return add(origin, scale(offset, length / current));
}

export function closestOnSegment(point, start, end) {
    const span = sub(end, start);
    const denom = dot(span, span);
    if (denom < 1e-12) return { point: start, t: 0 };
    const t = clampAxis(dot(sub(point, start), span) / denom, 0, 1);
    return { point: add(start, scale(span, t)), t };
}

export function resolveSphere(point, pointRadius, center, radius) {
    const offset = sub(point, center);
    const distance = vecLength(offset);
    const min = (pointRadius || 0) + (radius || 0);
    if (distance >= min || min <= 1e-8) return point;
    if (distance < 1e-8) return add(center, [0, min, 0]);
    return add(center, scale(offset, min / distance));
}

export function resolveCapsule(point, pointRadius, start, end, radiusA, radiusB) {
    const { point: closest, t } = closestOnSegment(point, start, end);
    return resolveSphere(point, pointRadius, closest, radiusA + (radiusB - radiusA) * t);
}

export function resolveCapsuleInside(point, pointRadius, start, end, radiusA, radiusB) {
    if (!Array.isArray(point) || !Array.isArray(start) || !Array.isArray(end)) return point;
    const { point: closest, t } = closestOnSegment(point, start, end);
    const radius = (radiusA || 0) + ((radiusB || 0) - (radiusA || 0)) * t;
    const allowed = Math.max(0, radius - Math.max(0, pointRadius || 0));
    const offset = sub(point, closest);
    const distance = vecLength(offset);
    if (distance <= allowed) return point;
    if (distance < 1e-8) return point;
    return add(closest, scale(offset, allowed / distance));
}

export function resolveCapsuleKeepSide(point, pointRadius, start, end, radiusA, radiusB, restPoint) {
    const { point: closest, t } = closestOnSegment(point, start, end);
    const radius = (radiusA || 0) + ((radiusB || 0) - (radiusA || 0)) * t;
    const min = (pointRadius || 0) + radius;
    if (min <= 1e-8) return point;
    const offset = sub(point, closest);
    const distance = vecLength(offset);
    if (distance >= min) return point;
    const restDir = restPoint ? sub(restPoint, closest) : offset;
    let dir = offset;
    if (distance < 1e-8 || (vecLength(restDir) > 1e-8 && dot(dir, restDir) < 0)) {
        dir = vecLength(restDir) > 1e-8 ? restDir : [0, min, 0];
    }
    return add(closest, scale(normalize(dir), min));
}

export const COLLIDER_AIM_BONE = {
    LeftUpLeg: 'LeftLeg',
    LeftLeg: 'LeftFoot',
    RightUpLeg: 'RightLeg',
    RightLeg: 'RightFoot',
    Spine: 'Spine2',
    Spine1: 'Spine2',
    Spine2: 'Head',
    Neck: 'Head',
    Hips: 'Spine2',
    LeftArm: 'LeftForeArm',
    RightArm: 'RightForeArm',
    LeftForeArm: 'LeftHand',
    RightForeArm: 'RightHand',
};

const TYPE2_LIMB_LENGTH = 0.08;

export function dominantAxis(vector) {
    const values = [Math.abs(vector?.[0] || 0), Math.abs(vector?.[1] || 0), Math.abs(vector?.[2] || 0)];
    if (values[0] >= values[1] && values[0] >= values[2]) return 0;
    if (values[1] >= values[2]) return 1;
    return 2;
}

export function pmxBasisFromChild(childLocal) {
    const along = normalize(childLocal);
    if (vecLength(along) < 1e-6) return { along: [0, 1, 0], side: [1, 0, 0], forward: [0, 0, 1] };
    let side = cross(along, [0, 0, 1]);
    if (vecLength(side) < 0.2) side = cross(along, [1, 0, 0]);
    side = normalize(side);
    return { along, side, forward: normalize(cross(side, along)) };
}

export function remapUnityOffsetToPmx(offset, alongAxis, basis, scaleFactor = 1) {
    const others = [0, 1, 2].filter(index => index !== alongAxis);
    return add(
        add(scale(basis.along, (offset?.[alongAxis] || 0) * scaleFactor), scale(basis.side, (offset?.[others[0]] || 0) * scaleFactor)),
        scale(basis.forward, (offset?.[others[1]] || 0) * scaleFactor),
    );
}

function clampOffsetToAim(local, childLocal) {
    const maxLength = vecLength(childLocal);
    const length = vecLength(local);
    if (maxLength < 1e-4 || length <= maxLength * 1.02) return local;
    return scale(normalize(local), maxLength);
}

function scaledColliderRadii(record, scaleFactor) {
    return {
        radiusA: (record?.radiusA || 0) * scaleFactor,
        radiusB: (record?.radiusB || 0) * scaleFactor,
    };
}

export function authoredColliderShape(record, scaleFactor = 1, childLocal = null) {
    const offsetA = record?.offsetA || [0, 0, 0];
    const offsetB = record?.offsetB || [0, 0, 0];
    const { radiusA, radiusB } = scaledColliderRadii(record, scaleFactor);
    if (record?.space === 'pmxLocal') {
        if (record.kind === 'capsule') {
            return { kind: 'capsule', localA: offsetA, localB: offsetB, radiusA, radiusB, unityLength: record.unityLength || 0 };
        }
        return { kind: 'sphere', localA: offsetA, radiusA: Math.max(radiusA, radiusB), unityLength: record.unityLength || 0 };
    }
    const hasAim = vecLength(childLocal || [0, 0, 0]) > 1e-4;
    const basis = hasAim ? pmxBasisFromChild(childLocal) : { along: [0, 1, 0], side: [1, 0, 0], forward: [0, 0, 1] };
    const mapOffset = (offset, alongAxis) => {
        const mapped = hasAim ? remapUnityOffsetToPmx(offset, alongAxis, basis, scaleFactor) : scale(offset, scaleFactor);
        return hasAim ? clampOffsetToAim(mapped, childLocal) : mapped;
    };
    if (record?.type === 1) {
        const unityLength = vecLength(sub(offsetB, offsetA));
        if (unityLength > 1e-4) {
            const alongAxis = dominantAxis(sub(offsetB, offsetA));
            return { kind: 'capsule', localA: mapOffset(offsetA, alongAxis), localB: mapOffset(offsetB, alongAxis), radiusA, radiusB, unityLength };
        }
        return { kind: 'sphere', localA: mapOffset(offsetA, dominantAxis(offsetA)), radiusA: Math.max(radiusA, radiusB), unityLength };
    }
    if (record?.type === 2) {
        const height = Math.max(Math.abs(offsetA[0] || 0), Math.abs(offsetA[1] || 0), Math.abs(offsetA[2] || 0));
        if (height >= TYPE2_LIMB_LENGTH) {
            const alongAxis = dominantAxis(offsetA);
            return {
                kind: 'capsule',
                localA: [0, 0, 0],
                localB: mapOffset(offsetA, alongAxis),
                radiusA,
                radiusB,
                unityLength: vecLength(offsetA),
            };
        }
        return { kind: 'sphere', localA: mapOffset(offsetA, hasAim ? 0 : dominantAxis(offsetA)), radiusA: Math.max(radiusA, radiusB), unityLength: vecLength(offsetA) };
    }
    return { kind: 'sphere', localA: scale(offsetA, scaleFactor), radiusA: Math.max(radiusA, radiusB), unityLength: vecLength(sub(offsetB, offsetA)) };
}

function colliderAimLocal(boneName, entry, byName) {
    const aim = byName.get(COLLIDER_AIM_BONE[boneName]);
    if (!aim?.bone || !entry?.bone) return null;
    updateWorld(entry.bone);
    updateWorld(aim.bone);
    const local = worldToLocalDir(entry.bone, sub(worldPositionOf(aim.bone), worldPositionOf(entry.bone)));
    return vecLength(local) > 1e-4 ? local : null;
}

export function colliderWorldEnds(record, entry, aim, shape, scaleFactor) {
    const start = worldPointFromLocal(entry.bone, shape.localA);
    if (shape.kind !== 'capsule') return { start, end: start };
    // Limb colliders with aimBone are rebuilt from the driven/aim transform
    // pair every frame. Their baked local segment only describes the rest
    // shape; keeping it here makes a thigh capsule inherit the calf's axis.
    if (record?.aimBone && aim?.bone) {
        updateWorld(aim.bone);
        const origin = worldPositionOf(entry.bone);
        const target = worldPositionOf(aim.bone);
        const span = sub(target, origin);
        const distance = vecLength(span);
        if (distance > 1e-4) {
            const direction = scale(span, 1 / distance);
            const trim = Array.isArray(record.nativePair) ? record.nativePair : null;
            const nativeScale = Number.isFinite(Number(record.nativeScale)) ? Number(record.nativeScale) : 1;
            const trimStart = trim?.[0] > 0 ? trim[0] * nativeScale * scaleFactor : 0;
            const trimEnd = trim?.[1] > 0 ? trim[1] * nativeScale * scaleFactor : 0;
            if (trimStart + trimEnd > 0 && distance - trimStart - trimEnd > 1e-4) {
                return {
                    start: add(origin, scale(direction, trimStart)),
                    end: sub(target, scale(direction, trimEnd)),
                };
            }
            return { start: origin, end: target };
        }
    }
    // 5573E010 writes the transformed native collider endpoints back to
    // position/subPosition. A profile without aimBone already contains
    // those recovered local endpoints, as with the horizontal Spine2 body.
    return { start, end: worldPointFromLocal(entry.bone, shape.localB) };
}

export function applyRecoveredStaticColliderPair(record, first, second) {
    const pair = record?.nativePair;
    if (record?.type !== 2 || !Array.isArray(pair) || pair.length < 2) {
        return { first: [...first], second: [...second], collided: false };
    }
    return recoveredSwingPairCollision(
        first,
        second,
        pair[0],
        pair[1],
        record.nativeScale ?? 1,
    );
}

export function masksOverlap(first, second) {
    return ((first | 0) & (second | 0)) !== 0;
}

export function effectiveSpringCollisionMask(record, table) {
    const mask = Number(record?.collisionMask) | 0;
    if (table?.physicsAlgorithm === RECOVERED_PHYSICS_ALGORITHM
        && table?.skirtCollidesWithThigh
        && /Skirt/i.test(record?.bone || '')) {
        // Kotone thighs sit on layer 64. Other idols (e.g. hski school) keep
        // Leg/UpLeg on whatever mask the native capture used — OR those in too.
        let thighLayers = 64;
        for (const collider of table.colliders || []) {
            if (/^(Left|Right)(UpLeg|Leg)$/.test(collider?.bone || '')) {
                thighLayers |= Number(collider.collisionMask) | 0;
            }
        }
        return mask | thighLayers;
    }
    return mask;
}

export function quatFromTo(from, to) {
    const a = normalize(from);
    const b = normalize(to);
    if (vecLength(a) < 1e-8 || vecLength(b) < 1e-8) return [0, 0, 0, 1];
    const cosine = dot(a, b);
    if (cosine > 0.999999) return [0, 0, 0, 1];
    if (cosine < -0.999999) {
        let axis = cross(a, [1, 0, 0]);
        if (vecLength(axis) < 1e-6) axis = cross(a, [0, 1, 0]);
        return quatFromAxisAngle(normalize(axis), 180);
    }
    const axis = cross(a, b);
    return quatNormalize([axis[0], axis[1], axis[2], 1 + cosine]);
}

export function carryParticleWithRest(current, previous, origin, lastOrigin, restTail, lastRestTail, rotateRestDirection = true) {
    let nextCurrent = current;
    let nextPrevious = previous;
    if (lastOrigin) {
        const carried = sub(origin, lastOrigin);
        nextCurrent = add(nextCurrent, carried);
        nextPrevious = add(nextPrevious, carried);
    }
    if (rotateRestDirection && lastRestTail) {
        const from = sub(lastRestTail, lastOrigin || origin);
        const to = sub(restTail, origin);
        if (vecLength(from) > 1e-6 && vecLength(to) > 1e-6 && dot(normalize(from), normalize(to)) > -0.85) {
            const extra = quatFromTo(from, to);
            nextCurrent = add(origin, quatRotate(extra, sub(nextCurrent, origin)));
            nextPrevious = add(origin, quatRotate(extra, sub(nextPrevious, origin)));
        }
    }
    return { current: nextCurrent, previous: nextPrevious };
}

export function preserveHairRestTail(restTail, origin, lastOrigin, previousRestTail, isHair) {
    if (!isHair || !previousRestTail || !lastOrigin) return restTail;
    return add(previousRestTail, sub(origin, lastOrigin));
}

export function extraAxisAngle(extraQuat) {
    const [x, y, z, w] = extraQuat;
    const clamped = clampAxis(w, -1, 1);
    const angle = 2 * Math.acos(clamped) * 180 / Math.PI;
    const sine = Math.sin(Math.acos(clamped));
    if (angle < 1e-6 || Math.abs(sine) < 1e-8) return { axis: [1, 0, 0], angle: 0 };
    return { axis: [x / sine, y / sine, z / sine], angle };
}

export function remapLimitsToTail(limitInfo, tailLocal) {
    if (!limitInfo?.useLimit) return limitInfo;
    const names = ['axisX', 'axisY', 'axisZ'];
    const locked = names.findIndex(name => {
        const range = limitInfo[name];
        return Array.isArray(range) && range[0] === 0 && range[1] === 0;
    });
    const chain = dominantAxis(tailLocal);
    if (locked < 0 || chain === locked) return limitInfo;
    const unlocked = [0, 1, 2].filter(index => index !== locked);
    const targets = [0, 1, 2].filter(index => index !== chain);
    const next = { ...limitInfo };
    next[names[chain]] = limitInfo[names[locked]];
    next[names[targets[0]]] = limitInfo[names[unlocked[0]]];
    next[names[targets[1]]] = limitInfo[names[unlocked[1]]];
    return next;
}

export function clampExtraByLimits(extraQuat, limitInfo) {
    if (!limitInfo?.useLimit) return extraQuat;
    const names = ['axisX', 'axisY', 'axisZ'];
    const lockedAxis = names.findIndex(name => {
        const range = limitInfo[name];
        return Array.isArray(range) && range[0] === 0 && range[1] === 0;
    });
    if (lockedAxis >= 0) {
        const { axis, angle } = extraAxisAngle(extraQuat);
        axis[lockedAxis] = 0;
        const length = vecLength(axis);
        if (length < 1e-8 || angle < 1e-6) return [0, 0, 0, 1];
        const maxAngle = names
            .map((name, index) => index === lockedAxis ? 0 : Math.max(Math.abs(limitInfo[name]?.[0] ?? 0), Math.abs(limitInfo[name]?.[1] ?? 0)))
            .reduce((max, value) => Math.max(max, value), 0);
        const limited = clampAxis(angle, -maxAngle, maxAngle);
        return quatFromAxisAngle(scale(axis, 1 / length), limited);
    }
    const euler = quaternionToEulerDegreesXYZ(extraQuat);
    return eulerDegreesToQuaternionXYZ([
        clampAxis(euler[0], limitInfo.axisX?.[0] ?? -180, limitInfo.axisX?.[1] ?? 180),
        clampAxis(euler[1], limitInfo.axisY?.[0] ?? -180, limitInfo.axisY?.[1] ?? 180),
        clampAxis(euler[2], limitInfo.axisZ?.[0] ?? -180, limitInfo.axisZ?.[1] ?? 180),
    ]);
}

function isNativeHairFrameSegment(record) {
    const name = record?.bone || '';
      return /^(?:Center|Left|Right)(?:HairSide|SideHair|SideBackHair|BackHair|BackSideHair|BackUHair)(?:[1-9]\d*)_S(?:_End)?$/i.test(name);
}

/**
 * Build the local frame used by the native swing particle after the hair
 * anchor. Unity stores the dynamic axis in boneAxis and the particle's rest
 * orientation in modelingLocalTx.rotation. PMX tailLocal is the stage-side
 * representation of the same chain direction, so this quaternion maps the
 * native simulation axis into the PMX bone-local tail axis.
 */
export function nativeHairLimitFrame(record, tailLocal) {
    if (!isNativeHairFrameSegment(record)) return null;
    const axis = normalize(record?.nativeBoneAxis || [0, 0, 0]);
    const rotation = record?.modelingLocalTx?.rotation;
    const tail = normalize(tailLocal || [0, 0, 0]);
    if (vecLength(axis) < 1e-8 || vecLength(tail) < 1e-8 || !Array.isArray(rotation) || rotation.length < 4) return null;
    const nativeAxisInParent = normalize(quatRotate(unityLocalRotationToThree(rotation), axis));
    if (vecLength(nativeAxisInParent) < 1e-8) return null;
    return quatFromTo(nativeAxisInParent, tail);
}

export function clampExtraByNativeHairFrame(extraQuat, record, tailLocal) {
    const frame = nativeHairLimitFrame(record, tailLocal);
    if (!frame) return clampExtraByLimits(extraQuat, remapLimitsToTail(record?.limitInfo, tailLocal));
    const inverse = quatInverse(frame);
    const nativeExtra = quatMultiply(quatMultiply(inverse, extraQuat), frame);
    const limited = clampExtraByLimits(nativeExtra, record?.limitInfo);
    return quatMultiply(quatMultiply(frame, limited), inverse);
}

export function separateRing(points, minDistance, around, response = 1, restDistances = null) {
    if (!points?.length || minDistance <= 0) return points?.map(point => [...point]) || [];
    const next = points.map(point => [...point]);
    const correctionResponse = Number.isFinite(Number(response))
        ? clampAxis(Number(response), 0, 1)
        : 1;
    const last = around ? next.length : next.length - 1;
    for (let index = 0; index < last; index++) {
        const other = (index + 1) % next.length;
        const offset = sub(next[other], next[index]);
        const distance = vecLength(offset);
        const authoredDistance = Array.isArray(restDistances) ? Number(restDistances[index]) : Infinity;
        const pairMinimum = Number.isFinite(authoredDistance)
            ? Math.min(minDistance, Math.max(0, authoredDistance))
            : minDistance;
        if (distance >= pairMinimum || distance < 1e-8) continue;
        const push = scale(offset, ((pairMinimum - distance) / (2 * distance)) * correctionResponse);
        next[index] = sub(next[index], push);
        next[other] = add(next[other], push);
    }
    return next;
}

/**
 * Port of CallTarget_7FF9660E3020 mode 2, which is the pair-overlap branch
 * called by the recovered 5573E010 body. When the two points are inside the
 * sum of their scaled radii, the native routine moves them toward the
 * contact interval. A later collision stage consumes those points to decide
 * the final response; this function must not be used as a replacement for
 * chain-wide separation. Its second displacement intentionally uses the
 * first displacement in the denominator; preserve that ordering instead of
 * replacing it with a symmetrical solver.
 */
export function recoveredSwingPairCollision(first, second, radiusA, radiusB, radiusScale = 1, epsilon = 1e-8) {
    const pointA = Array.isArray(first) ? first : [0, 0, 0];
    const pointB = Array.isArray(second) ? second : [0, 0, 0];
    const rawA = Number(radiusA);
    const rawB = Number(radiusB);
    if (!(rawA > 0 || rawB > 0)) return { first: [...pointA], second: [...pointB], collided: false };

    const delta = sub(pointB, pointA);
    const distance = vecLength(delta);
    if (!(distance > epsilon)) return { first: [...pointA], second: [...pointB], collided: false };

    const finiteRadius = value => Number.isFinite(value) && value >= 0 ? value : 0;
    const scaleValue = Number.isFinite(Number(radiusScale)) ? Number(radiusScale) : 0;
    const scaledA = finiteRadius(rawA) * scaleValue;
    const scaledB = finiteRadius(rawB) * scaleValue;
    const total = scaledA + scaledB;
    if (!(distance < total) || !(total > epsilon)) return { first: [...pointA], second: [...pointB], collided: false };

    const overlap = total - distance;
    const moveA = Math.max(0, scaledA - (overlap * scaledA) / total);
    const moveBDenominator = scaledB + moveA;
    const moveB = moveBDenominator > epsilon
        ? Math.max(0, scaledB - (overlap * scaledB) / moveBDenominator)
        : 0;
    const direction = scale(delta, 1 / distance);
    return {
        first: add(pointA, scale(direction, moveA)),
        second: sub(pointB, scale(direction, moveB)),
        collided: true,
        distance,
        radiusA: scaledA,
        radiusB: scaledB,
        moveA,
        moveB,
    };
}

function matrixElements(bone) {
    return bone?.matrixWorld?.elements;
}

function worldPositionOf(bone) {
    const m = matrixElements(bone);
    return m ? [m[12], m[13], m[14]] : [0, 0, 0];
}

function worldToLocalDir(bone, v) {
    const m = matrixElements(bone);
    if (!m) return v;
    return [
        m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
        m[4] * v[0] + m[5] * v[1] + m[6] * v[2],
        m[8] * v[0] + m[9] * v[1] + m[10] * v[2],
    ];
}

function localToWorldDir(bone, v) {
    const m = matrixElements(bone);
    if (!m) return v;
    return [
        m[0] * v[0] + m[4] * v[1] + m[8] * v[2],
        m[1] * v[0] + m[5] * v[1] + m[9] * v[2],
        m[2] * v[0] + m[6] * v[1] + m[10] * v[2],
    ];
}

function worldPointFromLocal(bone, local) {
    const m = matrixElements(bone);
    if (!m) return local;
    const x = local[0];
    const y = local[1];
    const z = local[2];
    return [
        m[0] * x + m[4] * y + m[8] * z + m[12],
        m[1] * x + m[5] * y + m[9] * z + m[13],
        m[2] * x + m[6] * y + m[10] * z + m[14],
    ];
}

function localPositionOf(bone, restEntry) {
    if (restEntry?.position?.toArray) return restEntry.position.toArray();
    if (bone?.position?.toArray) return bone.position.toArray();
    return [0, 0, 0];
}

function modelingWorldPositionOf(record) {
    const position = record?.modelingWorldPosition;
    if (!Array.isArray(position) || position.length < 3) return null;
    const values = position.slice(0, 3).map(Number);
    return values.every(Number.isFinite) ? values : null;
}

function modelingRestTailLocal(parentRecord, childRecord, worldScale) {
    const parent = modelingWorldPositionOf(parentRecord);
    const child = modelingWorldPositionOf(childRecord);
    if (!parent || !child) return null;
    // modelingLocalTx is in Unity's parent space. Converting its resolved
    // world rest positions avoids applying the Unity parent rotation twice to
    // the PMX skeleton, whose rest quaternions are identity-based.
    return [
        (parent[0] - child[0]) * worldScale,
        (child[1] - parent[1]) * worldScale,
        (child[2] - parent[2]) * worldScale,
    ];
}

function nativeChainKind(item) {
    return /Skirt/i.test(item?.record?.bone || '') ? 'skirt'
        : /Jacket/i.test(item?.record?.bone || '') ? 'jacket'
            : 'other';
}

function nativeChainMinimumDistance(link, source, target, scaleFactor, tuning) {
    const kind = nativeChainKind(source) !== 'other'
        ? nativeChainKind(source)
        : nativeChainKind(target);
    const radiusScale = kind === 'skirt'
        ? Number(tuning.chainSkirtRadius)
        : kind === 'jacket'
            ? Number(tuning.chainJacketRadius)
            : 1;
    const safeRadiusScale = Number.isFinite(radiusScale) ? Math.max(0, radiusScale) : 1;
    const radiusA = Number(link?.radiusA);
    const radiusB = Number(link?.radiusB);
    const authoredRadius = Number.isFinite(radiusA) && Number.isFinite(radiusB)
        ? Math.max(0, radiusA) + Math.max(0, radiusB)
        : 0;
    const fallbackRadius = Number(link?.layerRadius) > 0 ? Number(link.layerRadius) * 2 : 0;
    const gap = Number.isFinite(Number(tuning.chainGap)) ? Math.max(0, Number(tuning.chainGap)) : 0;
    return (Math.max(authoredRadius, fallbackRadius) * safeRadiusScale + gap) * scaleFactor;
}

function updateWorld(bone) {
    bone?.updateMatrixWorld?.(true);
}

function writeQuat(bone, q) {
    bone?.quaternion?.set?.(q[0], q[1], q[2], q[3]);
}

function writeVec3(vector, value) {
    if (!value) return;
    vector?.set?.(value[0], value[1], value[2]);
}

function firstChildBone(bone, byName) {
    if (bone?.name) {
        const prefix = bone.name.replace(/_S(?:_End)?$/, '').replace(/\d+$/, '');
        const index = Number((/(\d+)_S/.exec(bone.name) || [])[1] || 0);
        const named = byName.get(`${prefix}${index + 1}_S`)?.bone || byName.get(`${prefix}${index + 1}_S_End`)?.bone;
        if (named) return named;
    }
    return (bone?.children || []).find(child => child?.isBone || child?.isBone === undefined && child?.quaternion) || null;
}

function usesModelingHairRest(record, table) {
    if (table?.useModelingHairRestPose !== true) return false;
      return /^(?:Left|Right)(?:HairSide|SideHair|SideBackHair)/i.test(record?.bone || '');
}

function terminalTailLocal(bone, record, scaleFactor, length) {
    const safeLength = Math.abs(Number(length) || 0) * (scaleFactor || 1);
    if (safeLength < 1e-4) return null;
    const parent = bone?.parent;
    if (parent) {
        updateWorld(bone);
        updateWorld(parent);
        const incoming = sub(worldPositionOf(bone), worldPositionOf(parent));
        const localIncoming = worldToLocalDir(bone, incoming);
        if (vecLength(localIncoming) > 1e-4) return scale(normalize(localIncoming), safeLength);
    }
    const axis = normalize(record?.nativeBoneAxis || [0, 0, 0]);
    if (vecLength(axis) > 1e-4) return scale(axis, safeLength);
    return null;
}

export function continueAlongRest(local, unityLength, scaleFactor) {
    const length = Math.abs(unityLength || 0) * (scaleFactor || 1);
    if (length < 1e-4) return [0, 0, 0];
    if (vecLength(local) > 1e-4) return scale(normalize(local), length);
    return [0, -length, 0];
}

export class SecondaryMotion {
    constructor(table = { drivers: [], springs: [], colliders: [], chains: [] }) {
        this.table = table;
        this.tuning = { ...DEFAULT_SECONDARY_TUNING };
        this.bindings = [];
        this.springs = [];
        this.colliders = [];
        this.chains = [];
        this.nativeChainLinks = [];
        this.nativeChainGroups = [];
        this.enabled = true;
        this.missing = [];
        this.scale = 1;
        this.clothingTrace = null;
        this.lastColliderGeometry = null;
    }

    bind(restPose) {
        const byName = new Map((restPose || []).map(entry => [entry.bone?.name, entry]));
        const springRecords = new Map((this.table.springs || []).map(record => [record.bone, record]));
        this.missing = [];
        this.bindings = [];
        this.springs = [];
        this.colliders = [];
        this.chains = [];
        this.nativeChainLinks = [];
        this.nativeChainGroups = [];
        let root = restPose?.[0]?.bone;
        while (root?.parent) root = root.parent;
        root?.updateMatrixWorld?.(true);
        this.scale = medianScale((this.table.springs || []).map(record => [
            vecLength(record.unityLocalPosition || [0, 0, 0]),
            vecLength(localPositionOf(byName.get(record.bone)?.bone, byName.get(record.bone))),
        ]));
        for (const driver of [...selectQuartzDrivers(this.table), ...selectJacketFollowDrivers(this.table)]) {
            const target = byName.get(driver.bone);
            if (!target) {
                this.missing.push(driver.bone);
                continue;
            }
            const sources = driver.className === QUARTZ_HAIR
                ? [byName.get('Head'), byName.get('Neck')]
                : [byName.get(driver.setting?.referenceBone?.name)];
            if (sources.some(entry => !entry)) {
                this.missing.push(`${driver.bone}←${driver.className === QUARTZ_HAIR ? 'Head/Neck' : driver.setting?.referenceBone?.name}`);
                continue;
            }
            this.bindings.push({
                driver,
                target,
                sources,
                skirtOuter: true,
                restPosition: localPositionOf(target.bone, target),
            });
        }
        for (const record of this.table.springs || []) {
            if (this.table.disableHairSprings && record.part === 'hair') continue;
            if (this.table.disableSkirtMotion && (record.part === 'skirt' || /Skirt/i.test(record.bone || ''))) continue;
            if (this.table.disabledSpringBones?.includes(record.bone)) continue;
            const entry = byName.get(record.bone);
            if (!entry) {
                this.missing.push(record.bone);
                continue;
            }
            const child = firstChildBone(entry.bone, byName);
            const childRest = child ? byName.get(child.name) : null;
            const childRecord = child ? springRecords.get(child.name) : null;
            const useModelingRest = this.table.useModelingRestPose !== false && /Jacket/i.test(record.bone || '');
            const useModelingHair = usesModelingHairRest(record, this.table);
            let tailLocal = useModelingRest || useModelingHair
                ? modelingRestTailLocal(record, childRecord, this.scale)
                : null;
            if (!tailLocal) tailLocal = childRest ? localPositionOf(child, childRest) : [0, 0, 0];
            if (vecLength(tailLocal) < 1e-4) {
                if (childRest) continue;
                tailLocal = useModelingHair
                    ? terminalTailLocal(entry.bone, record, this.scale, vecLength(record.unityLocalPosition || [0, 0, 0]))
                    : continueAlongRest(localPositionOf(entry.bone, entry), vecLength(record.unityLocalPosition || [0, 0, 0]), this.scale);
            }
            if (vecLength(tailLocal) < 1e-4) continue;
            this.springs.push({
                record,
                entry,
                tailLocal,
                restLength: vecLength(tailLocal),
                current: [0, 0, 0],
                previous: [0, 0, 0],
                lastOrigin: null,
                lastRestTail: null,
                physicsRestTail: null,
                collided: false,
                collisionHold: 0,
                tailBone: child?.name || null,
                tailParent: child?.parent?.name || null,
                tailRecord: childRecord || null,
            });
        }
        const depth = bone => {
            let count = 0;
            let node = bone?.parent;
            while (node) {
                count += 1;
                node = node.parent;
            }
            return count;
        };
        this.springs.sort((a, b) => depth(a.entry.bone) - depth(b.entry.bone));
        for (const record of this.table.colliders || []) {
            const sourceEntry = byName.get(record.bone);
            // Some recovered colliders are stage aliases rather than PMX
            // bones. Keep the bake reference and runtime carrier separate:
            // the native Head_Face endpoints are authored in Head rest space,
            // while the native driven handle points at the face helper. A
            // profile can therefore set carrierBone when the helper has its
            // own runtime transform; otherwise restBone remains the carrier.
            const carrierName = record.carrierBone || record.restBone || record.bone;
            const entry = byName.get(carrierName) || sourceEntry;
            if (!entry) {
                this.missing.push(record.bone);
                continue;
            }
            // Head_Face is a stage-only native collider. Its local endpoints
            // stay in the captured bake frame; carrierBone only selects the
            // transform that moves that frame at runtime.
            this.colliders.push({
                record,
                entry,
                childLocal: colliderAimLocal(record.bone, entry, byName),
                aim: record.aimBone ? byName.get(record.aimBone) : null,
            });
        }
        for (const chain of this.table.chains || []) {
            this.chains.push({
                ...chain,
                layers: (chain.layers || []).filter(layer => layer.active).map(layer => ({
                    ...layer,
                    items: (layer.bones || []).map(name => this.springs.find(item => item.record.bone === name)).filter(Boolean),
                })),
            });
        }
        const nativeChainRecords = this.table.nativeChainGeometry?.records || [];
        const springByNativeIndex = new Map(this.springs
            .filter(item => Number.isInteger(Number(item.record.nativeDynamicIndex)))
            .map(item => [Number(item.record.nativeDynamicIndex), item]));
        const nativeGroups = new Map();
        for (const native of nativeChainRecords) {
            if (native.active === false || Number(native.active) === 0) continue;
            const source = springByNativeIndex.get(Number(native.dynamicBoneIndex));
            const targetIndex = Number(native.dynamicBoneIndex) + Number(native.chainOffsetIndex);
            const target = springByNativeIndex.get(targetIndex);
            if (!source || !target || source === target) continue;
            const key = `${native.depth}:${native.around ? 1 : 0}:${nativeChainKind(source)}`;
            const group = nativeGroups.get(key) || {
                depth: Number(native.depth) || 0,
                around: !!native.around,
                kind: nativeChainKind(source),
                initialLoopLength: Number(native.initialLoopLength) || 0,
                links: [],
            };
            group.links.push({
                source,
                target,
                radiusA: Number(native.radiusA),
                radiusB: Number(native.radiusB),
                smoothing: Number(native.smoothing) || 0,
                chainOffsetIndex: Number(native.chainOffsetIndex) || 0,
            });
            nativeGroups.set(key, group);
        }
        this.nativeChainGroups = [...nativeGroups.values()]
            .filter(group => group.links.length > 0)
            .sort((first, second) => first.depth - second.depth);
        this.nativeChainLinks = this.nativeChainGroups.flatMap(group => group.links);
        for (const chain of this.chains) {
            for (const layer of chain.layers) {
                const restPoints = layer.items.map(item => worldPointFromLocal(item.entry.bone, item.tailLocal));
                const edgeCount = layer.around ? restPoints.length : Math.max(0, restPoints.length - 1);
                layer.restDistances = Array.from({ length: edgeCount }, (_, index) => {
                    const other = (index + 1) % restPoints.length;
                    return vecLength(sub(restPoints[other], restPoints[index]));
                });
            }
        }
        this.reset();
        this.#traceBindings();
        return this;
    }

    setTuning(values = {}) {
        for (const key of ['gravity', 'damping', 'spring', 'stiffness', 'physics', 'rootFollow']) {
            const value = Number(values[key]);
            if (Number.isFinite(value)) this.tuning[key] = Math.max(0, value);
        }
        for (const key of ['chainSkirtRadius', 'chainJacketRadius']) {
            const value = Number(values[key]);
            if (Number.isFinite(value)) this.tuning[key] = clampAxis(value, 0, 2);
        }
        const gap = Number(values.chainGap);
        if (Number.isFinite(gap)) this.tuning.chainGap = clampAxis(gap, 0, 0.06);
        if (values.chainOrder === 'before-collision' || values.chainOrder === 'after-collision') {
            this.tuning.chainOrder = values.chainOrder;
        }
    }

    getTuning() {
        return { ...this.tuning };
    }

    setInitialRotation(boneName, euler = [0, 0, 0]) {
        const record = (this.table.springs || []).find(item => item.bone === boneName);
        if (!record) return;
        record.initialRotationEuler = euler.map(value => Number.isFinite(Number(value)) ? Number(value) : 0);
        this.reset();
    }

    startClothingTrace(metadata = {}) {
        this.clothingTrace = { metadata: { schemaVersion: 1, startedAt: new Date().toISOString(), ...metadata }, resets: [], droppedResets: 0, frames: [], bindings: [], ticks: 0, complete: false };
        this.#traceBindings();
    }

    clearClothingTrace() { this.clothingTrace = null; }
    getClothingTraceStatus() { const t=this.clothingTrace; return t ? {active:true,ticks:t.ticks,frames:t.frames.length,complete:t.complete,droppedResets:t.droppedResets} : {active:false,ticks:0,complete:false}; }
    getClothingTrace() { return this.clothingTrace ? JSON.parse(JSON.stringify(this.clothingTrace)) : null; }
    #traceBindings() { if (!this.clothingTrace) return; this.clothingTrace.bindings=this.springs.map(item=>({bone:item.record.bone,part:item.record.part,tailBone:item.tailBone,tailParent:item.tailParent,tailLocal:[...item.tailLocal],restLength:item.restLength,restQuaternion:item.entry.quaternion.toArray(),record:{...item.record}})); }
    #traceReset() { if (!this.clothingTrace) return; const e={tick:this.clothingTrace.ticks,bones:this.springs.map(item=>({bone:item.record.bone,origin:worldPositionOf(item.entry.bone),tail:worldPointFromLocal(item.entry.bone,item.tailLocal),quaternion:item.entry.bone.quaternion.toArray()}))}; if(this.clothingTrace.resets.length<8)this.clothingTrace.resets.push(e);else this.clothingTrace.droppedResets++; }
    reset() {
        this.#traceReset();
        this.lastColliderGeometry = null;
        for (const binding of this.bindings) binding.extra = null;
        for (const item of this.springs) {
            // The captured localTx is an initial dynamic state. Seed it once
            // during reset; applying it again on every frame would compound
            // the snapshot rotation and make the chain drift.
            writeQuat(item.entry.bone, this.enabled ? this.#followedRest(item, true) : item.entry.quaternion.toArray());
            updateWorld(item.entry.bone);
            const origin = worldPositionOf(item.entry.bone);
            const tail = worldPointFromLocal(item.entry.bone, item.tailLocal);
            item.current = tail;
            item.previous = [...tail];
            item.lastOrigin = origin;
            item.lastRestTail = tail;
            item.physicsRestTail = tail;
        }
    }

    update(delta = 1 / 60) {
        if (!this.enabled) {
            this.#restoreRest();
            this.reset();
            return;
        }
        this.#applyQuartz();
        this.#refreshWorld();
        this.#applySprings(Math.min(Math.max(delta || 1 / 60, 1 / 240), 1 / 20));
    }

    #restoreRest() {
        for (const binding of this.bindings) {
            const rest = binding.target.quaternion.toArray();
            writeQuat(binding.target.bone, rest);
            if (binding.hairShifted) writeVec3(binding.target.bone?.position, binding.restPosition);
        }
        for (const item of this.springs) {
            const rest = item.entry.quaternion.toArray();
            writeQuat(item.entry.bone, rest);
        }
    }

    #applyQuartz() {
        for (const binding of this.bindings) {
            const { driver, target, sources } = binding;
            if (driver.className === QUARTZ_HAIR) {
                if (this.table.disableHairQuartz) continue;
                const headRest = sources[0].quaternion.toArray();
                const neckRest = sources[1].quaternion.toArray();
                const headLive = sources[0].bone.quaternion.toArray();
                const neckLive = sources[1].bone.quaternion.toArray();
                if (this.table.physicsAlgorithm === RECOVERED_PHYSICS_ALGORITHM) {
                    const headRelative = relativeQuaternion(headRest, headLive);
                    const neckRelative = relativeQuaternion(neckRest, neckLive);
                    writeQuat(target.bone, composeRestAndQuat(
                        target.quaternion.toArray(),
                        recoveredHairDriverQuaternion(headRelative, neckRelative, driver.setting),
                    ));
                    binding.hairShifted = true;
                    writeVec3(target.bone?.position, binding.restPosition);
                } else {
                    writeQuat(target.bone, composeRestAndExtra(
                        target.quaternion.toArray(),
                        hairDriverEuler(
                            relativeEulerDegrees(headRest, headLive),
                            relativeEulerDegrees(neckRest, neckLive),
                            driver.setting,
                        ),
                    ));
                }
                continue;
            }
            const side = driverSide(driver.bone);
            const recovered = this.table.physicsAlgorithm === RECOVERED_PHYSICS_ALGORITHM;
            const restRotation = sources[0].quaternion.toArray();
            const liveRotation = sources[0].bone.quaternion.toArray();
            const relative = recovered
                ? skirtReferenceQuaternion(restRotation, liveRotation)
                : relativeQuaternion(restRotation, liveRotation);
            const outer = skirtIsOuter(relative, driver.setting, side, binding.skirtOuter);
            binding.skirtOuter = outer;
            let extra = recovered
                ? recoveredSkirtDriverQuaternion(relative, driver.setting, skirtDriverSwingSigns(this.table, driver.bone))
                : skirtDriverQuaternion(relative, driver.setting, side, outer);
            if (/Jacket3_S$/.test(driver.bone || '')) {
                const skirtExtra = this.bindings.find(item => item.driver.bone === jacketSkirtAnchor(driver.bone))?.extra;
                extra = scaleFollowExtra(skirtExtra || extra, JACKET_FOLLOW_WEIGHT);
                binding.extra = extra;
            } else {
                binding.extra = recovered ? extra : smoothFollowExtra(binding.extra, extra, FOLLOW_SMOOTH);
            }
            writeQuat(target.bone, composeRestAndQuat(target.quaternion.toArray(), binding.extra));
        }
    }

    #refreshWorld() {
        for (const { sources, target } of this.bindings) {
            sources.forEach(entry => updateWorld(entry.bone));
            updateWorld(target.bone);
        }
        for (const item of this.colliders) {
            updateWorld(item.entry.bone);
            if (item.aim?.bone) updateWorld(item.aim.bone);
        }
    }

    #applySprings(dt) {
        const worldColliders = this.colliders.map(({ record, entry, childLocal, aim }) => {
            const shape = authoredColliderShape(record, this.scale, childLocal);
            let { start, end } = colliderWorldEnds(record, entry, aim, shape, this.scale);
            return {
                mask: record.collisionMask,
                start,
                end,
                radiusA: shape.radiusA,
                radiusB: shape.kind === 'capsule' ? shape.radiusB : shape.radiusA,
                shape,
                bone: entry.bone,
                record,
            };
        });
        this.#traceFrameStart(dt, worldColliders);
        const movingBody = colliderGeometryMoved(worldColliders, this.lastColliderGeometry);
        this.lastColliderGeometry = worldColliders.map(collider => ({
            start: [...collider.start],
            end: [...collider.end],
        }));
        for (const item of this.springs) {
            writeQuat(item.entry.bone, this.#followedRest(item, false));
            updateWorld(item.entry.bone);
            const origin = worldPositionOf(item.entry.bone);
            const restTail = worldPointFromLocal(item.entry.bone, item.tailLocal);
            const isHairParticle = shouldPreserveHairRestTail(item.record.bone, this.table);
            const physicsRestTail = preserveHairRestTail(
                restTail,
                origin,
                item.lastOrigin,
                item.physicsRestTail,
                isHairParticle,
            );
            const carried = carryParticleWithRest(
                item.current,
                item.previous,
                origin,
                item.lastOrigin,
                restTail,
                item.lastRestTail,
                !isHairParticle,
            );
            item.current = carried.current;
            item.previous = carried.previous;
            item.lastOrigin = origin;
            item.lastRestTail = restTail;
            item.physicsRestTail = physicsRestTail;
            const tuning = this.tuning;
            const gravityScale = gravityScaleForSpring(item.record, this.table, tuning);
            const params = { ...item.record, damping: (item.record.damping ?? 0) * tuning.damping, spring: (item.record.spring ?? 0) * tuning.spring, stiffness: (item.record.stiffness ?? 0) * tuning.stiffness, gravityScale, bone: item.record.bone };
            let next = integrateTail(item.previous, item.current, physicsRestTail, params, dt * tuning.physics, this.scale);
            const traceFrame = this.clothingTrace?.frames.at(-1);
            const traceBone = traceFrame?.bones.find(entry => entry.bone === item.record.bone);
            if (traceBone) { traceBone.before = { current: [...item.current], previous: [...item.previous], origin: [...origin], restTail: [...restTail] }; traceBone.afterIntegration = [...next]; traceBone.parameters = { damping: params.damping, spring: params.spring, stiffness: params.stiffness, gravityScale: params.gravityScale, dt: dt * tuning.physics }; }
            if (/1_S$/.test(item.record.bone || '')) {
                const rootWeight = clampAxis((item.record.rootWeight ?? 0) * this.tuning.rootFollow, 0, 1);
                next = add(scale(next, 1 - rootWeight), scale(physicsRestTail, rootWeight));
            }
            next = constrainLength(origin, next, item.restLength);
            // Stage adaptation: keep the angular constraint active before contact.
            // The legacy contact/3-frame-hold switch repeatedly snaps hair back
            // inside a collider as soon as its angle limit is re-enabled.
            const stableContact = this.table.stableHairContacts === true && HAIR_BONE_NAME.test(item.record.bone || '');
            const unconstrainedTail = next;
            if (stableContact && APPLY_SPRING_ANGLE_LIMITS) next = this.#limitTail(item, origin, restTail, next);
            const collisionBeforeChain = this.tuning.chainOrder !== 'before-collision';
            const collisionResult = collisionBeforeChain
                ? this.#resolveStaticCollisions(item, next, worldColliders, physicsRestTail, traceBone)
                : { next, collided: false };
            next = collisionResult.next;
            const collided = collisionResult.collided;
            if (collided) item.collisionHold = 3;
            else item.collisionHold = Math.max(0, (item.collisionHold || 0) - 1);
            const free = collided || item.collisionHold > 0;
            if (!stableContact && !free && APPLY_SPRING_ANGLE_LIMITS) next = this.#limitTail(item, origin, restTail, next);
            if (traceBone) { traceBone.afterAngleLimit = [...next]; traceBone.collided = free; traceBone.collisionHold = item.collisionHold; }
            item.collided = free;
            item.previous = item.current;
            const appliedExtra = this.#writeBoneToward(item, origin, next, !stableContact && !free);
            if (traceBone) traceBone.appliedExtra = [...appliedExtra];
            updateWorld(item.entry.bone);
            item.current = worldPointFromLocal(item.entry.bone, item.tailLocal);
            if (collided || stableContact) {
                // A contact/constraint correction is not velocity. Include the
                // rendered displacement (after fixed length/writeback) in both
                // samples. Without this, the next integration frame treats the
                // outward projection as a real impulse and alternates between
                // re-entering and leaving the collider.
                item.previous = add(item.previous, sub(item.current, unconstrainedTail));
            }
        }
        this.#applyDynamicClothingPairs(movingBody);
        this.#applyChains();
        if (this.tuning.chainOrder === 'before-collision') this.#applyStaticCollisionsAfterChains(worldColliders);
        this.#traceFrameEnd(dt, worldColliders);
    }

    #resolveStaticCollisions(item, next, worldColliders, restTail, traceBone, traceKey = 'afterCollision') {
        if (item.record.colliderType === 4) return { next, collided: false };
        const collisionMask = effectiveSpringCollisionMask(item.record, this.table);
        if (!collisionMask) return { next, collided: false };
        const before = next;
        for (const collider of worldColliders) {
            if (!masksOverlap(collisionMask, collider.mask)) continue;
            if (skipsContralateralLegCollider(item.record.bone, collider.record.bone)) continue;
            if (skipsHairSpineCollider(item.record.bone, collider.record.bone, this.table)) continue;
            if (skipsConfiguredHairRootCollider(item.record.bone, collider.record.bone, this.table)) continue;
            if (skipsHairRootFaceCollider(item.record.bone, collider.record.bone)) continue;
            if (skipsLargeSpineSkirtCollider(item.record.bone, collider.record.bone, collider.mask)) continue;
            // The native swing job folds the dynamic particle radius into the
            // static collider query for the jacket. The skirt hem has a
            // separate thigh-follow correction and keeps zero extra radius;
            // applying its 0.05 Unity radius here would expand the whole hem
            // by a visible extra ring.
            const clothRadius = springStaticParticleRadius(item.record, item.tailRecord, this.table, this.scale);
            // The native Spine2 mask-16 collider is an authored outer hair
            // volume. It contains the hair envelope, so an escaped particle
            // must be brought back toward the capsule axis. Applying the
            // generic outside projection here makes side hair flare outward.
            if (isHairVolumeCollider(collider.record)) {
                next = resolveCapsuleInside(next, clothRadius, collider.start, collider.end, collider.radiusA, collider.radiusB);
                continue;
            }
            next = resolveCapsuleKeepSide(next, clothRadius, collider.start, collider.end, collider.radiusA, collider.radiusB, restTail);
        }
        next = constrainLength(worldPositionOf(item.entry.bone), next, item.restLength);
        const collided = vecLength(sub(next, before)) > 1e-5;
        if (traceBone) traceBone[traceKey] = [...next];
        return { next, collided };
    }

    #applyStaticCollisionsAfterChains(worldColliders) {
        for (const item of this.springs) {
            if (item.record.colliderType === 4) continue;
            const origin = worldPositionOf(item.entry.bone);
            const current = worldPointFromLocal(item.entry.bone, item.tailLocal);
            const restTail = item.physicsRestTail || current;
            const traceFrame = this.clothingTrace?.frames.at(-1);
            const traceBone = traceFrame?.bones.find(entry => entry.bone === item.record.bone);
            const result = this.#resolveStaticCollisions(item, current, worldColliders, restTail, traceBone, 'afterPostChainCollision');
            if (!result.collided) {
                item.collided = item.collisionHold > 0;
                item.current = current;
                continue;
            }
            const correction = sub(result.next, current);
            item.previous = add(item.previous, correction);
            item.collisionHold = 3;
            item.collided = true;
            this.#writeBoneToward(item, origin, result.next, false);
            updateWorld(item.entry.bone);
            item.current = worldPointFromLocal(item.entry.bone, item.tailLocal);
        }
    }

    #applyDynamicClothingPairs(movingBody = false) {
        if (this.table.nativeDynamicCollision !== true || !movingBody) return;
        const candidates = this.springs.filter(item => item.record.colliderType !== 4);
        const applyPoint = (item, point) => {
            const origin = worldPositionOf(item.entry.bone);
            const corrected = constrainLength(origin, point, item.restLength);
            const correction = sub(corrected, item.current);
            if (vecLength(correction) <= 1e-7) return false;
            // Carry the contact correction into the previous sample so the
            // next integration frame does not turn a static contact into a
            // velocity spike.
            item.previous = add(item.previous, correction);
            item.current = corrected;
            item.collisionHold = 3;
            item.collided = true;
            this.#writeBoneToward(item, origin, corrected, false);
            updateWorld(item.entry.bone);
            item.current = worldPointFromLocal(item.entry.bone, item.tailLocal);
            return true;
        };
        for (let firstIndex = 0; firstIndex < candidates.length; firstIndex += 1) {
            const first = candidates[firstIndex];
            for (let secondIndex = firstIndex + 1; secondIndex < candidates.length; secondIndex += 1) {
                const second = candidates[secondIndex];
                const result = resolveDynamicParticlePair(
                    first.current,
                    second.current,
                    first.record,
                    second.record,
                    this.scale,
                    first.previous,
                    second.previous,
                    first.physicsRestTail,
                    second.physicsRestTail,
                );
                if (!result.collided) continue;
                const traceFrame = this.clothingTrace?.frames.at(-1);
                if (traceFrame) {
                    traceFrame.dynamicPairs ??= [];
                    traceFrame.dynamicPairs.push({
                        first: first.record.bone,
                        second: second.record.bone,
                        distance: result.distance,
                        overlap: result.overlap,
                        firstCurrent: [...first.current],
                        secondCurrent: [...second.current],
                        firstPrevious: [...first.previous],
                        secondPrevious: [...second.previous],
                        firstRest: Array.isArray(first.physicsRestTail) ? [...first.physicsRestTail] : null,
                        secondRest: Array.isArray(second.physicsRestTail) ? [...second.physicsRestTail] : null,
                    });
                }
                applyPoint(first, result.first);
                applyPoint(second, result.second);
            }
        }
    }

    #traceFrameStart(dt, worldColliders) { if(!this.clothingTrace||this.clothingTrace.ticks>=300)return; const n=this.clothingTrace.ticks; const sample=this.clothingTrace.metadata?.allFrames||n===0||[1,2,3,6,12,30,60,120,180,240,299].includes(n); if(sample)this.clothingTrace.frames.push({tick:n,delta:dt,enabled:this.enabled,tuning:{...this.tuning},colliders:worldColliders.map(c=>({bone:c.record.bone,mask:c.mask,start:[...c.start],end:[...c.end],radiusA:c.radiusA,radiusB:c.radiusB})),dynamicPairs:[],bones:[]}); }
    #traceFrameEnd() { if(!this.clothingTrace)return; const f=this.clothingTrace.frames.at(-1); if(f) for(const i of this.springs) if(i.record.part==='body'||i.record.part==='clothing'||/Skirt|Jacket/i.test(i.record.bone)) { let b=f.bones.find(x=>x.bone===i.record.bone); if(!b){b={bone:i.record.bone,part:i.record.part,collisions:[]}; f.bones.push(b);} b.final={quaternion:i.entry.bone.quaternion.toArray(),current:[...i.current],collided:i.collided,collisionHold:i.collisionHold}; } this.clothingTrace.ticks++; if(this.clothingTrace.ticks>=300)this.clothingTrace.complete=true; }

    #followedRest(item, includeInitialOffset = false) {
        const rest = item.entry.quaternion.toArray();
        const offset = includeInitialOffset && Array.isArray(item.record.initialRotationEuler)
            ? eulerDegreesToQuaternionXYZ(item.record.initialRotationEuler)
            : includeInitialOffset && Array.isArray(item.record.initialRotationOffset)
                ? quatSlerp([0, 0, 0, 1], item.record.initialRotationOffset, clampAxis(item.record.initialRotationWeight ?? 1, 0, 1))
                : null;
        const base = offset ? composeRestAndQuat(rest, offset) : rest;
        const extra = this.bindings.find(binding => binding.target.bone === item.entry.bone)?.extra;
        return extra ? composeRestAndQuat(base, extra) : base;
    }

    #limitTail(item, origin, restTail, next) {
        const extra = this.#extraToward(item, origin, next, true);
        const localDir = quatRotate(extra, item.tailLocal);
        return add(origin, scale(normalize(localToWorldDir(item.entry.bone, localDir)), item.restLength));
    }

    #extraToward(item, origin, next, useLimits = true) {
        const restDir = item.tailLocal;
        const nextDir = worldToLocalDir(item.entry.bone, sub(next, origin));
        if (vecLength(restDir) < 1e-8 || vecLength(nextDir) < 1e-8) return [0, 0, 0, 1];
        const extra = quatFromTo(restDir, nextDir);
        if (!useLimits || !APPLY_SPRING_ANGLE_LIMITS) return extra;
        if (isNativeHairFrameSegment(item.record)) {
            return clampExtraByNativeHairFrame(extra, item.record, item.tailLocal);
        }
        const limitInfo = /Skirt|Jacket|Hair/i.test(item.record.bone || '')
            ? remapLimitsToTail(item.record.limitInfo, item.tailLocal)
            : item.record.limitInfo;
        return clampExtraByLimits(extra, limitInfo);
    }

    #writeBoneToward(item, origin, next, useLimits = true) {
        const extra = this.#extraToward(item, origin, next, useLimits);
        writeQuat(item.entry.bone, quatMultiply(this.#followedRest(item, false), extra));
        return extra;
    }

    debugState() {
        const colliders = this.colliders.map(({ record, entry, childLocal, aim }) => {
            updateWorld(entry.bone);
            const shape = authoredColliderShape(record, this.scale, childLocal);
            let { start, end } = colliderWorldEnds(record, entry, aim, shape, this.scale);
            return {
                bone: record.bone,
                type: record.type,
                mask: record.collisionMask,
                kind: shape.kind,
                start,
                end,
                radiusA: shape.radiusA,
                radiusB: shape.kind === 'capsule' ? shape.radiusB : shape.radiusA,
                unityRadius: record.radiusA,
            };
        });
        const particles = this.springs.filter(item => item.record.colliderType !== 4 && effectiveSpringCollisionMask(item.record, this.table)).map(item => ({
            bone: item.record.bone,
            mask: effectiveSpringCollisionMask(item.record, this.table),
            position: item.current,
            radius: (item.record.particleRadius || 0) * this.scale,
            unityRadius: item.record.particleRadius,
        }));
        return { scale: this.scale, colliders, particles };
    }

    #applyChains() {
        if (this.table.disableChainSeparation) return;
        if (this.nativeChainGroups.length) {
            this.#applyNativeChains();
            return;
        }
        const beforeChain = new Map(this.springs.map(item => [item, [...item.current]]));
        for (const chain of this.chains) {
            for (const layer of chain.layers) {
                if (layer.items.length < 2) continue;
                const points = layer.items.map(item => worldPointFromLocal(item.entry.bone, item.tailLocal));
                const separated = separateRing(
                    points,
                    chainLayerMinimumDistance(layer, this.scale, this.tuning),
                    !!layer.around,
                    CHAIN_SEPARATION_RESPONSE,
                    layer.restDistances,
                );
                if (!separated.some((point, index) => vecLength(sub(point, points[index])) > 1e-7)) continue;
                layer.items.forEach((item, index) => {
                    const origin = worldPositionOf(item.entry.bone);
                    const restTail = worldPointFromLocal(item.entry.bone, item.tailLocal);
                    item.current = constrainLength(origin, separated[index], item.restLength);
                    if (!item.collided && APPLY_SPRING_ANGLE_LIMITS) item.current = this.#limitTail(item, origin, restTail, item.current);
                    this.#writeBoneToward(item, origin, item.current, !item.collided);
                    updateWorld(item.entry.bone);
                });
            }
        }
        for (const item of this.springs) {
            const renderedTail = worldPointFromLocal(item.entry.bone, item.tailLocal);
            const correction = sub(renderedTail, beforeChain.get(item));
            item.previous = add(item.previous, correction);
            item.current = renderedTail;
        }
    }

    #applyNativeChains() {
        const beforeChain = new Map(this.springs.map(item => [item, [...item.current]]));
        const response = clampAxis(CHAIN_SEPARATION_RESPONSE, 0, 1);
        const applyPoint = (item, point) => {
            const origin = worldPositionOf(item.entry.bone);
            const constrained = constrainLength(origin, point, item.restLength);
            if (vecLength(sub(constrained, item.current)) <= 1e-7) return;
            item.current = constrained;
            if (!item.collided && APPLY_SPRING_ANGLE_LIMITS) {
                item.current = this.#limitTail(item, origin, worldPointFromLocal(item.entry.bone, item.tailLocal), item.current);
            }
            this.#writeBoneToward(item, origin, item.current, !item.collided);
            updateWorld(item.entry.bone);
            item.current = worldPointFromLocal(item.entry.bone, item.tailLocal);
        };

        for (const group of this.nativeChainGroups) {
            for (const link of group.links) {
                const first = link.source;
                const second = link.target;
                const firstPoint = worldPointFromLocal(first.entry.bone, first.tailLocal);
                const secondPoint = worldPointFromLocal(second.entry.bone, second.tailLocal);
                const offset = sub(secondPoint, firstPoint);
                const distance = vecLength(offset);
                if (distance < 1e-8) continue;
                const minimum = nativeChainMinimumDistance(link, first, second, this.scale, this.tuning);
                if (!(minimum > 0) || distance >= minimum) continue;
                const push = scale(offset, ((minimum - distance) / (2 * distance)) * response);
                applyPoint(first, sub(firstPoint, push));
                applyPoint(second, add(secondPoint, push));
            }
        }

        for (const item of this.springs) {
            const renderedTail = worldPointFromLocal(item.entry.bone, item.tailLocal);
            const previous = beforeChain.get(item);
            if (previous) item.previous = add(item.previous, sub(renderedTail, previous));
            item.current = renderedTail;
        }
    }
}
