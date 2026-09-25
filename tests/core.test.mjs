import test from 'node:test';
import assert from 'node:assert/strict';
import { EXPRESSION_PRESETS, annotatePlaylistItem, buildMotionCatalogTable, buildPlaylist, classifyClipTracks, classifyMotionName, fadeDurationForClip, fadeDurationForTransition, findFacePlaylistIndex, findIdlePlaylistIndex, findPhaseFollowupIndex, findPresetMorph, groupPlaylistByCatalog, motionPairKey, normalizeActionId, parsePerformanceCommand, playlistClipIds, playlistSlot, shouldLoopMotion, shouldReturnToIdle } from '../core.js';

test('clip kind comes from the track names, not the file name', () => {
    assert.equal(classifyClipTracks(['.bones[Hips].position', '.bones[Hips].quaternion']).kind, 'body');
    assert.equal(classifyClipTracks(['.morphTargetInfluences[3]']).kind, 'face');
    assert.equal(classifyClipTracks(['.bones[Hips].position', '.morphTargetInfluences[0]']).kind, 'mixed');
    assert.equal(classifyClipTracks([]).kind, 'empty');
    assert.equal(classifyClipTracks(undefined).kind, 'empty');
    assert.deepEqual(classifyClipTracks(['.bones[A].position', '.morphTargetInfluences[1]', '.morphTargetInfluences[2]']),
        { bones: 1, morphs: 2, kind: 'mixed' });
});

test('only a trailing -b or -f marks a pair, not one inside the name', () => {
    assert.deepEqual(motionPairKey('mot-all-chr-cmmn-yes-b-002-in-b'), { key: 'mot-all-chr-cmmn-yes-b-002-in', suffix: 'b' });
    assert.deepEqual(motionPairKey('mot-all-chr-cmmn-yes-b-002-in-f'), { key: 'mot-all-chr-cmmn-yes-b-002-in', suffix: 'f' });
    assert.deepEqual(motionPairKey('mot-all-chr-cmmn-yes-b-002-in'), { key: 'mot-all-chr-cmmn-yes-b-002-in', suffix: '' });
    assert.deepEqual(motionPairKey(''), { key: '', suffix: '' });
});

test('body and facial clips sharing a base name become one playlist item', () => {
    const playlist = buildPlaylist([
        { id: 'mot-yes-b-002-in-b', label: 'mot_yes-b-002_in_b', kind: 'body' },
        { id: 'mot-yes-b-002-in-f', label: 'mot_yes-b-002_in_f', kind: 'face' },
    ]);
    assert.equal(playlist.length, 1);
    assert.equal(playlist[0].key, 'mot-yes-b-002-in');
    assert.equal(playlist[0].label, 'mot_yes-b-002_in');
    assert.deepEqual(playlistClipIds(playlist[0]), ['mot-yes-b-002-in-b', 'mot-yes-b-002-in-f']);
});

test('a facial clip loaded before its body clip still pairs', () => {
    const playlist = buildPlaylist([
        { id: 'mot-a-in-f', label: 'mot_a_in_f', kind: 'face' },
        { id: 'mot-a-in-b', label: 'mot_a_in_b', kind: 'body' },
    ]);
    assert.equal(playlist.length, 1);
    assert.deepEqual(playlistClipIds(playlist[0]), ['mot-a-in-b', 'mot-a-in-f']);
});

test('unpaired and mismatched clips stay as their own items', () => {
    const playlist = buildPlaylist([
        { id: 'mot-a-in-b', label: 'mot_a_in_b', kind: 'body' },
        { id: 'mot-b-in-f', label: 'mot_b_in_f', kind: 'face' },
        { id: 'legacy-dance', label: 'legacy dance', kind: 'body' },
        { id: 'weird-clip', label: 'weird clip', kind: 'mixed' },
    ]);
    assert.deepEqual(playlist.map(item => item.key), ['mot-a-in', 'mot-b-in', 'legacy-dance', 'weird-clip']);
    assert.deepEqual(playlist.map(item => playlistClipIds(item).length), [1, 1, 1, 1]);
    assert.equal(playlist[3].other, 'weird-clip');
});

test('a second body clip for the same base does not overwrite the first', () => {
    const playlist = buildPlaylist([
        { id: 'mot-a-in-b', label: 'first', kind: 'body' },
        { id: 'mot-a-in-b-2', label: 'second', kind: 'body' },
    ]);
    assert.equal(playlist.length, 2);
    assert.deepEqual(playlist.map(item => item.body), ['mot-a-in-b', 'mot-a-in-b-2']);
});

test('filename suffix pairs even when tracks failed to bind', () => {
    assert.equal(playlistSlot({ id: 'mot-a-in-f', kind: 'empty' }), 'face');
    assert.equal(playlistSlot({ id: 'mot-a-in-b', kind: 'mixed' }), 'body');
    const playlist = buildPlaylist([
        { id: 'mot-a-in-b', label: 'mot_a_in_b', kind: 'mixed' },
        { id: 'mot-a-in-f', label: 'mot_a_in_f', kind: 'empty' },
    ]);
    assert.equal(playlist.length, 1);
    assert.deepEqual(playlistClipIds(playlist[0]), ['mot-a-in-b', 'mot-a-in-f']);
});

test('playlist ignores entries without an id', () => {
    assert.deepEqual(buildPlaylist([null, {}, { label: 'x' }]), []);
    assert.deepEqual(buildPlaylist(undefined), []);
});

test('normalizes VMD filenames into stable action ids', () => {
    assert.equal(normalizeActionId('Wave Hand_01.vmd'), 'wave-hand-01');
    assert.equal(normalizeActionId('  お辞儀.vmd '), 'お辞儀');
});

test('parses and clamps a performance command', () => {
    assert.deepEqual(parsePerformanceCommand(JSON.stringify({
        expression: 'HAPPY',
        intensity: 2,
        action: 'Wave Hand.vmd',
        morphs: { '照れ': 0.4, blink: -1, bad: 'x' },
    })), {
        expression: 'happy',
        intensity: 1,
        action: 'wave-hand',
        morphs: { '照れ': 0.4, blink: 0 },
    });
});

test('rejects malformed commands and morph collections', () => {
    assert.throws(() => parsePerformanceCommand('{bad json}'), /有效的 JSON/);
    assert.throws(() => parsePerformanceCommand({ morphs: [] }), /morphs/);
});

test('matches exact morph names before partial candidates', () => {
    const names = ['笑顔大', '笑い', '照れ'];
    assert.equal(findPresetMorph(names, EXPRESSION_PRESETS.happy), '笑い');
    assert.equal(findPresetMorph(names, EXPRESSION_PRESETS.shy), '照れ');
    assert.equal(findPresetMorph(names, { candidates: ['missing'] }), '');
});

test('pairs emotion motions with their facial clips and labels them in Chinese', () => {
    const [item] = buildPlaylist([
        { id: 'mot-all-chr-cmmn-angry-a-001-in-b', label: 'mot_all_chr_cmmn_angry-a-001_in_b', kind: 'body' },
        { id: 'mot-all-chr-cmmn-angry-a-001-in-f', label: 'mot_all_chr_cmmn_angry-a-001_in_f', kind: 'face' },
    ]);
    assert.equal(item.catalog.bucket, 'emotion');
    assert.equal(item.catalog.family, 'angry');
    assert.equal(item.catalog.pairing, 'paired');
    assert.equal(item.catalog.title, '生气 型A-001 进入');
});

test('keeps talk motions without faces in the unpaired body bucket', () => {
    const [item] = buildPlaylist([
        { id: 'mot-all-chr-cmmn-talk-003-in-b', label: 'mot_all_chr_cmmn_talk-003_in_b', kind: 'body' },
    ]);
    assert.equal(item.catalog.bucket, 'bodyOnly');
    assert.equal(item.catalog.family, 'talk');
    assert.equal(item.catalog.familyLabel, '说话');
    assert.equal(item.catalog.pairing, 'bodyOnly');
});

test('picks a facial-all clip for an emotion cue', () => {
    const catalog = [
        { face: 'mot-all-chr-cmmn-facial-all-ikari1-egao1-in-f', brow: 'ikari1', mouth: 'egao1', family: 'facial:ikari1-egao1', catalog: { family: 'facial:ikari1-egao1', brow: 'ikari1', mouth: 'egao1', phase: 'in' } },
        { face: 'mot-all-chr-cmmn-facial-all-normal1-egao1-in-f', brow: 'normal1', mouth: 'egao1', family: 'facial:normal1-egao1', catalog: { family: 'facial:normal1-egao1', brow: 'normal1', mouth: 'egao1', phase: 'in' } },
        { face: 'mot-all-chr-cmmn-facial-all-ikari1-ikari1-in-f', brow: 'ikari1', mouth: 'ikari1', family: 'facial:ikari1-ikari1', catalog: { family: 'facial:ikari1-ikari1', brow: 'ikari1', mouth: 'ikari1', phase: 'in' } },
    ];
    assert.equal(findFacePlaylistIndex(catalog, 'happy'), 1);
    assert.equal(findFacePlaylistIndex(catalog, 'angry'), 2);
    assert.equal(findFacePlaylistIndex(catalog, 'unknown'), -1);
});

test('randomizes among equally ranked facial clips for the same emotion', () => {
    const catalog = [
        { stem: 'happy-a', face: 'a', brow: 'normal1', mouth: 'egao1', catalog: { family: 'facial:normal1-egao1', brow: 'normal1', mouth: 'egao1', phase: 'in' } },
        { stem: 'angry-a', face: 'b', brow: 'ikari1', mouth: 'ikari1', catalog: { family: 'facial:ikari1-ikari1', brow: 'ikari1', mouth: 'ikari1', phase: 'in' } },
        { stem: 'happy-b', face: 'c', brow: 'normal1', mouth: 'egao1', catalog: { family: 'facial:normal1-egao1', brow: 'normal1', mouth: 'egao1', phase: 'in' } },
    ];
    assert.equal(findFacePlaylistIndex(catalog, 'happy', { random: () => 0 }), 0);
    assert.equal(findFacePlaylistIndex(catalog, 'happy', { random: () => 0.99 }), 2);
    assert.equal(findFacePlaylistIndex(catalog, 'happy', { random: () => 0, avoidKey: 'happy-a' }), 2);
});

test('classifies standalone facial-all clips by brow and mouth', () => {
    const parsed = classifyMotionName('mot_all_chr_cmmn_facial-all-ikari1-egao1_in_f');
    assert.equal(parsed.family, 'facial');
    assert.equal(parsed.brow, 'ikari1');
    assert.equal(parsed.mouth, 'egao1');
    assert.equal(parsed.title, '怒眉1 + 笑嘴1 进入');
    const [item] = buildPlaylist([
        { id: 'mot-all-chr-cmmn-facial-all-ikari1-egao1-in-f', label: 'mot_all_chr_cmmn_facial-all-ikari1-egao1_in_f', kind: 'face' },
    ]);
    assert.equal(item.catalog.bucket, 'faceOnly');
});

test('classifies lesson, audition and yes-b variants without eating the family name', () => {
    assert.equal(classifyMotionName('mot_lesson_chr_cmmn_cmmn-ex-buff-a-001_in_b').family, 'ex-buff');
    assert.equal(classifyMotionName('mot_lesson_chr_cmmn_cmmn-ex-buff-a-001_in_b').intentBucket, 'lesson');
    assert.equal(classifyMotionName('mot_aud_chr_cmmn_cmmn-result-failed-ac-001_in_b').family, 'result-failed');
    assert.equal(classifyMotionName('mot_all_chr_cmmn_yes-b-002_in_b').family, 'yes');
    assert.equal(classifyMotionName('mot_all_chr_cmmn_yes-b-002_in_b').variant, 'b');
    assert.equal(classifyMotionName('mot_all_chr_cmmn_no-001-add_in_b').additive, true);
});

test('groups a mixed playlist into paired emotions and unpaired leftover clips', () => {
    const groups = groupPlaylistByCatalog(buildPlaylist([
        { id: 'mot-all-chr-cmmn-talk-001-in-b', label: 'mot_all_chr_cmmn_talk-001_in_b', kind: 'body' },
        { id: 'mot-all-chr-cmmn-sad-001-in-b', label: 'mot_all_chr_cmmn_sad-001_in_b', kind: 'body' },
        { id: 'mot-all-chr-cmmn-sad-001-in-f', label: 'mot_all_chr_cmmn_sad-001_in_f', kind: 'face' },
        { id: 'mot-all-chr-cmmn-facial-all-normal1-egao1-in-f', label: 'mot_all_chr_cmmn_facial-all-normal1-egao1_in_f', kind: 'face' },
    ]));
    assert.deepEqual(groups.map(group => group.id), ['emotion', 'bodyOnly', 'faceOnly']);
    assert.equal(groups[0].items[0].catalog.family, 'sad');
});

test('splits standalone facial clips by brow and mouth in the catalog table', () => {
    const table = buildMotionCatalogTable([
        { id: 'mot-all-chr-cmmn-facial-all-ikari1-egao1-in-f', label: 'mot_all_chr_cmmn_facial-all-ikari1-egao1_in_f', kind: 'face' },
        { id: 'mot-all-chr-cmmn-facial-all-toji1-ikari1-in-f', label: 'mot_all_chr_cmmn_facial-all-toji1-ikari1_in_f', kind: 'face' },
    ]);
    const face = table.buckets.find(bucket => bucket.id === 'faceOnly');
    assert.deepEqual(face.families.map(family => family.label).sort(), ['怒眉1 + 笑嘴1', '闭眼1 + 怒嘴1']);
});

function clip(label, body) {
    return annotatePlaylistItem({
        key: body.replace(/-b$/, ''),
        label,
        body,
        face: '',
    });
}

test('standing gestures fade, same family fades shorter, sitting loops do not lerp to idle', () => {
    const idle = clip('mot_all_chr_fktn_idle-001_in', 'mot-all-chr-fktn-idle-001-in-b');
    const yes = clip('mot_all_chr_cmmn_yes-001_in', 'mot-all-chr-cmmn-yes-001-in-b');
    const yes2 = clip('mot_all_chr_cmmn_yes-003_in', 'mot-all-chr-cmmn-yes-003-in-b');
    const sitLoop = clip('mot_home_chr_cmmn_sit-001_lp', 'mot-home-chr-cmmn-sit-001-lp-b');
    assert.equal(fadeDurationForTransition(null, idle), 0.6);
    assert.equal(fadeDurationForTransition(idle, yes), 0.6);
    assert.equal(fadeDurationForTransition(yes, yes2), 0.3);
    assert.equal(fadeDurationForTransition(sitLoop, idle), 0);
    assert.equal(fadeDurationForClip('face', 0.6), 0.24);
    assert.equal(fadeDurationForClip('body', 0.6), 0.6);
});

test('enter clips return to idle, loops stay, sitting holds', () => {
    const yes = clip('mot_all_chr_cmmn_yes-001_in', 'mot-all-chr-cmmn-yes-001-in-b');
    const idle = clip('mot_all_chr_fktn_idle-001_in', 'mot-all-chr-fktn-idle-001-in-b');
    const cry = clip('mot_all_chr_cmmn_cry-001_lp', 'mot-all-chr-cmmn-cry-001-lp-b');
    const sit = clip('mot_home_chr_cmmn_sit-001_lp', 'mot-home-chr-cmmn-sit-001-lp-b');
    assert.equal(shouldReturnToIdle(yes), true);
    assert.equal(shouldReturnToIdle(idle), false);
    assert.equal(shouldReturnToIdle(cry), false);
    assert.equal(shouldReturnToIdle(sit), false);
    assert.equal(shouldLoopMotion(idle, false), true);
    assert.equal(shouldLoopMotion(yes, false), false);
    assert.equal(shouldLoopMotion(yes, true), true);
    assert.equal(shouldLoopMotion(cry, false), true);
});

test('picks character idle and in-to-lp followups from the playlist', () => {
    const playlist = [
        clip('mot_all_chr_cmmn_cry-001_in', 'mot-all-chr-cmmn-cry-001-in-b'),
        clip('mot_all_chr_cmmn_yes-001_in', 'mot-all-chr-cmmn-yes-001-in-b'),
        clip('mot_all_chr_fktn_idle-001_in', 'mot-all-chr-fktn-idle-001-in-b'),
        clip('mot_all_chr_cmmn_cry-001_lp', 'mot-all-chr-cmmn-cry-001-lp-b'),
    ];
    assert.equal(findIdlePlaylistIndex(playlist, 'fktn'), 2);
    assert.equal(findPhaseFollowupIndex(playlist, playlist[0], 'lp', 0), 3);
    assert.equal(findPhaseFollowupIndex(playlist, playlist[1], 'lp', 1), -1);
});
