import test from 'node:test';
import assert from 'node:assert/strict';
import { annotatePlaylistItem } from '../core.js';
import { findGesturePlaylistIndex } from '../core.js';
import {
    bindVisemeMorphs,
    estimateVisemeTrack,
    looksLikeMotionFile,
    visemeFromChar,
    normalizeFaceCue,
    normalizeGestureCue,
    parseAiCue,
    restoreVisemeInfluences,
    shouldClearFacialNoise,
    snapshotVisemeInfluences,
    visemeWeightAt,
} from '../dialogue-intent.js';

test('closed Chinese cues map to face and gesture ids, never VMD files', () => {
    assert.equal(normalizeFaceCue('开心'), 'happy');
    assert.equal(normalizeFaceCue('微笑'), 'happy');
    assert.equal(normalizeFaceCue('愤怒'), '');
    assert.equal(normalizeGestureCue('愤怒'), 'angry');
    assert.equal(normalizeGestureCue('点头'), 'yes');
    assert.equal(normalizeGestureCue('走路'), 'walk');
    assert.equal(normalizeGestureCue('安心'), 'anshin');
    assert.equal(normalizeGestureCue('课程开始'), 'all-start');
    assert.equal(normalizeGestureCue('试镜完美'), 'result-perfect');
    assert.equal(normalizeGestureCue('说话'), 'talk');
    assert.equal(normalizeGestureCue('mot_all_chr_cmmn_yes-001_in_b.vmd'), '');
    assert.equal(looksLikeMotionFile('mot-all-chr-cmmn-yes-001-in-b'), true);
});

test('parses bracket tags and leading keyword sentences', () => {
    const tagged = parseAiCue('【开心】【点头】你可是知道这些事、还来劝诱');
    assert.equal(tagged.face, 'happy');
    assert.equal(tagged.gesture, 'yes');
    assert.equal(tagged.pairing, 'mixed');
    assert.equal(tagged.skipFace, true);
    assert.equal(tagged.text, '你可是知道这些事、还来劝诱');

    const dotted = parseAiCue('害羞。思考。先别急着下结论');
    assert.equal(dotted.face, '');
    assert.equal(dotted.gesture, 'tereru');
    assert.equal(dotted.pairing, 'paired');
    assert.equal(dotted.skipFace, false);
    assert.equal(dotted.text, '先别急着下结论');

    const dual = parseAiCue('【难过】先别这样');
    assert.equal(dual.face, '');
    assert.equal(dual.gesture, 'sad');
    assert.equal(dual.pairing, 'paired');
    assert.equal(dual.skipFace, false);
    assert.equal(dual.text, '先别这样');

    const faceOnly = parseAiCue('【开心】你好');
    assert.equal(faceOnly.face, 'happy');
    assert.equal(faceOnly.gesture, 'talk');
    assert.equal(faceOnly.pairing, 'mixed');
    assert.equal(faceOnly.skipFace, true);

    const staging = parseAiCue('【走路】【坐下】到这边来');
    assert.equal(staging.face, '');
    assert.equal(staging.gesture, 'walk');
    assert.equal(staging.pairing, 'paired');
    assert.equal(staging.skipFace, false);
    assert.equal(staging.text, '到这边来');
});

test('plain speech defaults to talk and ignores motion filenames in JSON', () => {
    const plain = parseAiCue('你好呀');
    assert.equal(plain.face, '');
    assert.equal(plain.gesture, 'talk');
    assert.equal(plain.pairing, 'bodyOnly');
    assert.equal(plain.skipFace, true);
    assert.equal(plain.text, '你好呀');

    const json = parseAiCue({
        face: '生气',
        action: 'mot_all_chr_cmmn_angry-001_in_b.vmd',
        text: '不行',
    });
    assert.equal(json.face, '');
    assert.equal(json.gesture, 'angry');
    assert.equal(json.pairing, 'paired');
    assert.equal(json.skipFace, false);
    assert.equal(json.warnings.length > 0, true);
});

test('estimates a viseme track and blends weights over time', () => {
    const track = estimateVisemeTrack('啊一呜');
    assert.equal(track[0].viseme, 'A');
    assert.equal(track[1].viseme, 'I');
    assert.equal(track[2].viseme, 'U');
    assert.equal(track.at(-1).viseme, 'rest');
    assert.equal(visemeWeightAt(track, track[0].t + 0.02).A > 0, true);
    assert.equal(visemeWeightAt(track, track.at(-1).t + 0.01).A, 0);
});

test('binds viseme morphs by short Japanese or English mouth names', () => {
    const bound = bindVisemeMorphs(['笑い', 'あ', 'い', 'Mouth_O', 'ん']);
    assert.equal(bound.A[0].name, 'あ');
    assert.equal(bound.I[0].name, 'い');
    assert.equal(bound.O[0].name, 'Mouth_O');
    assert.equal(bound.M[0].name, 'ん');
});

test('maps Chinese dialogue onto Japanese vowel visemes, not morph names', () => {
    assert.equal(visemeFromChar('你'), 'I');
    assert.equal(visemeFromChar('可'), 'O');
    assert.equal(visemeFromChar('是'), 'I');
    assert.equal(visemeFromChar('知'), 'U');
    assert.equal(visemeFromChar('道'), 'U');
    assert.equal(visemeFromChar('还'), 'A');
    assert.equal(visemeFromChar('劝'), 'A');
    assert.equal(visemeFromChar('诱'), 'O');
    assert.equal(visemeFromChar('あ'), 'A');
    assert.equal(visemeFromChar('ん'), 'M');
});

test('maps shared Gakumas numbered mouths to the common viseme layout', () => {
    const names = ['b_brow.brow_001', 'b_eye.eye_001', 'b_iris.iris_001', 'mouth_001', 'mouth_002', 'mouth_003', 'mouth_004', 'mouth_005'];
    const bound = bindVisemeMorphs(names);
    assert.deepEqual(bound, { A: [], I: [], U: [], E: [], O: [], M: [{ name: 'mouth_001', weight: 1 }] });
});

test('maps other exported models that use b_mouth numbered morph names', () => {
    const bound = bindVisemeMorphs([
        'b_mouth.mouth_001', 'b_mouth.mouth_021', 'b_mouth.mouth_023',
        'b_mouth.mouth_025', 'b_mouth.mouth_026', 'b_mouth.mouth_032',
    ]);
    assert.deepEqual(bound.A, [{ name: 'b_mouth.mouth_032', weight: 1 }]);
    assert.deepEqual(bound.I, [{ name: 'b_mouth.mouth_025', weight: 1 }, { name: 'b_mouth.mouth_026', weight: 1 }]);
    assert.deepEqual(bound.U, [{ name: 'b_mouth.mouth_021', weight: 1 }]);
    assert.deepEqual(bound.E, [{ name: 'b_mouth.mouth_025', weight: 1 }]);
    assert.deepEqual(bound.O, [{ name: 'b_mouth.mouth_023', weight: 1 }]);
});

test('keeps the canonical numbered-mouth namespace explicit', () => {
    const names = ['b_mouth.mouth_001', 'b_mouth.mouth_021', 'b_mouth.mouth_023', 'b_mouth.mouth_025', 'b_mouth.mouth_026', 'b_mouth.mouth_032'];
    const bound = bindVisemeMorphs(names);
    assert.equal(bound.A[0].name.startsWith('b_mouth.'), true);
    assert.equal(bound.M[0].name, 'b_mouth.mouth_001');
});

test('binds numbered mouths only from an explicit viseme map', () => {
    const names = ['mouth_001', 'mouth_014', 'mouth_017', 'mouth_031'];
    const bound = bindVisemeMorphs(names, { A: 'mouth_017', I: 'mouth_014', U: 'missing' });
    assert.equal(bound.A[0].name, 'mouth_017');
    assert.equal(bound.I[0].name, 'mouth_014');
    assert.deepEqual(bound.U, []);
    assert.deepEqual(bound.E, []);
});

test('stacks multiple numbered mouths for one viseme', () => {
    const names = ['mouth_021', 'mouth_023', 'mouth_025', 'mouth_026', 'mouth_032'];
    const bound = bindVisemeMorphs(names, {
        A: 'mouth_032',
        I: '25+26',
        U: 'mouth_021',
        E: 'mouth_025',
        O: 23,
    });
    assert.deepEqual(bound.A, [{ name: 'mouth_032', weight: 1 }]);
    assert.deepEqual(bound.I, [{ name: 'mouth_025', weight: 1 }, { name: 'mouth_026', weight: 1 }]);
    assert.equal(bound.U[0].name, 'mouth_021');
    assert.equal(bound.E[0].name, 'mouth_025');
    assert.equal(bound.O[0].name, 'mouth_023');
});

test('does not bind visemes to blink, pupil, eyebrow, or other face noise', () => {
    const bound = bindVisemeMorphs([
        'blink',
        'EyeBlink',
        'pupil',
        'eyebrow',
        'happy',
        'まばたき',
        '瞳孔',
        'あ',
        'い',
        'Mouth_O',
        'ん',
    ]);
    assert.equal(bound.A[0].name, 'あ');
    assert.equal(bound.I[0].name, 'い');
    assert.deepEqual(bound.U, []);
    assert.deepEqual(bound.E, []);
    assert.equal(bound.O[0].name, 'Mouth_O');
    assert.equal(bound.M[0].name, 'ん');

    const unbound = bindVisemeMorphs(['blink', 'pupil', 'eyebrow', 'happy', 'EyeBlinkLeft']);
    assert.deepEqual(unbound, { A: [], I: [], U: [], E: [], O: [], M: [] });
});

test('picks an enter clip for a gesture family', () => {
    const playlist = [
        annotatePlaylistItem({ key: 'yes-lp', label: 'mot_all_chr_cmmn_yes-001_lp', body: 'yes-lp-b' }),
        annotatePlaylistItem({ key: 'yes-in', label: 'mot_all_chr_fktn_yes-002_in', body: 'yes-in-b' }),
        annotatePlaylistItem({ key: 'no-in', label: 'mot_all_chr_cmmn_no-001_in', body: 'no-in-b' }),
    ];
    assert.equal(playlist[1].catalog.family, 'yes');
    assert.equal(findGesturePlaylistIndex(playlist, 'yes', 'fktn'), 1);
    assert.equal(findGesturePlaylistIndex(playlist, 'wave'), -1);
});

test('lip sync snapshots only mouth visemes and restores them after speech', () => {
    const bound = bindVisemeMorphs(['あ', 'い', '笑い', 'blink']);
    const names = ['あ', 'い', '笑い', 'blink'];
    const dictionary = Object.fromEntries(names.map((name, index) => [name, index]));
    const influences = [0.4, 0, 0.7, 0.3];

    assert.equal(shouldClearFacialNoise(''), false);
    assert.equal(shouldClearFacialNoise('neutral'), false);
    assert.equal(shouldClearFacialNoise('happy'), true);

    const saved = snapshotVisemeInfluences(influences, dictionary, bound);
    assert.deepEqual(saved, { 'あ': 0.4, 'い': 0 });
    influences[0] = 1;
    influences[1] = 0.8;
    influences[2] = 0.1;
    influences[3] = 0;
    restoreVisemeInfluences(influences, dictionary, saved);
    assert.deepEqual(influences, [0.4, 0, 0.1, 0]);
});

test('finds yes clips from the library catalog shape, not only loaded playlist items', () => {
    const catalog = [
        { stem: 'mot-all-chr-cmmn-idle-001-lp', catalog: { family: 'idle', character: 'cmmn', phase: 'lp' }, character: 'cmmn', phase: 'lp' },
        { stem: 'mot-all-chr-cmmn-yes-001-in', catalog: { family: 'yes', character: 'cmmn', phase: 'in' }, character: 'cmmn', phase: 'in' },
    ];
    assert.equal(findGesturePlaylistIndex(catalog, 'yes'), 1);
});

test('prefers paired or body-only clips when the cue asks for one pairing', () => {
    const catalog = [
        { stem: 'talk-b', catalog: { family: 'talk', character: 'cmmn', phase: 'in', pairing: 'bodyOnly' } },
        { stem: 'yes-b', catalog: { family: 'yes', character: 'cmmn', phase: 'in', pairing: 'bodyOnly' } },
        { stem: 'yes-pair', catalog: { family: 'yes', character: 'cmmn', phase: 'in', pairing: 'paired' } },
    ];
    assert.equal(findGesturePlaylistIndex(catalog, 'yes', '', { preferPairing: 'paired' }), 2);
    assert.equal(findGesturePlaylistIndex(catalog, 'yes', '', { preferPairing: 'bodyOnly' }), 1);
    assert.equal(findGesturePlaylistIndex(catalog, 'talk', '', { preferPairing: 'bodyOnly' }), 0);
});

test('filters motion variants when a character profile specifies one', () => {
    const catalog = [
        { stem: 'yes-a', catalog: { family: 'yes', character: 'cmmn', variant: 'a', phase: 'in', pairing: 'paired' } },
        { stem: 'yes-b', catalog: { family: 'yes', character: 'cmmn', variant: 'b', phase: 'in', pairing: 'paired' } },
        { stem: 'yes-d', catalog: { family: 'yes', character: 'cmmn', variant: 'd', phase: 'in', pairing: 'paired' } },
    ];
    assert.equal(findGesturePlaylistIndex(catalog, 'yes', 'fktn', { preferredVariant: 'b', random: () => 0.99 }), 1);
    assert.equal(findGesturePlaylistIndex(catalog, 'yes', 'hmsz', { preferredVariant: 'd', random: () => 0 }), 2);
    assert.equal(findGesturePlaylistIndex(catalog, 'yes', '', { random: () => 0 }), 0);
});
test('randomizes among equally ranked clips in the same family', () => {
    const catalog = [
        { stem: 'angry-003', catalog: { family: 'angry', character: 'cmmn', phase: 'in', pairing: 'paired' } },
        { stem: 'yes-other', catalog: { family: 'yes', character: 'cmmn', phase: 'in', pairing: 'paired' } },
        { stem: 'angry-a-001', catalog: { family: 'angry', character: 'cmmn', phase: 'in', pairing: 'paired' } },
        { stem: 'angry-b-001', catalog: { family: 'angry', character: 'cmmn', phase: 'in', pairing: 'paired' } },
    ];
    assert.equal(findGesturePlaylistIndex(catalog, 'angry', '', { random: () => 0 }), 0);
    assert.equal(findGesturePlaylistIndex(catalog, 'angry', '', { random: () => 0.99 }), 3);
    assert.equal(findGesturePlaylistIndex(catalog, 'angry', '', { random: () => 0, avoidKey: 'angry-003' }), 2);
    catalog.push({ stem: 'angry-fktn', catalog: { family: 'angry', character: 'fktn', phase: 'in', pairing: 'paired' } });
    assert.equal(findGesturePlaylistIndex(catalog, 'angry', 'fktn', { random: () => 0.99 }), 4);
});
