import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import * as THREE from '../vendor/three/build/three.module.js';
import * as core from '../core.js';
import * as library from '../library-client.js';
import * as policy from '../live-portrait-policy.js';
import * as cues from '../portrait-cues.js';

const source = readFileSync(new URL('../live-portrait.js', import.meta.url), 'utf8');
const executable = source.replace(/^import\s[\s\S]*?;\r?\n/gm, '').replace(/export\s*\{[\s\S]*?\};/g, '').replace(/export /g, '');
const sandbox = { THREE, ...core, ...library, ...policy, ...cues, console };
vm.runInNewContext(executable + '\nglobalThis.Runtime = LivePortraitRuntime;', sandbox);
const map = JSON.parse(readFileSync(new URL('../gakumas-motion-map.json', import.meta.url)));

function runtime() {
    const player = Object.create(sandbox.Runtime.prototype);
    const geometry = new THREE.BoxGeometry();
    geometry.morphAttributes.position = [geometry.getAttribute('position').clone()];
    const model = new THREE.Mesh(geometry);
    const mixer = new THREE.AnimationMixer(model);
    Object.assign(player, { model, map, ready: true, config: { packs: { 'motions/test': {} } }, indexByPack: new Map(), actions: new Map(), playlist: [], playlistIndex: -1, liveActions: [], fadingActions: [], playGeneration: 0 });
    const entries = player.catalogItems();
    player.indexByPack.set('motions/test', new Map(entries.flatMap(item => [item.body, item.face].filter(Boolean).map(id => [id, `${id}.vmd`]))));
    player.helper = { objects: new Map([[model, { mixer }]]), update: delta => mixer.update(delta) };
    player.importMotionEntries = async files => {
        for (const file of files) {
            const body = file.kind === 'body';
            const tracks = body
                ? [new THREE.VectorKeyframeTrack('.position', [0, 1], [0, 0, 0, 2, 0, 0]), new THREE.NumberKeyframeTrack('.morphTargetInfluences[0]', [0, 1], [0, 0.1])]
                : [new THREE.NumberKeyframeTrack('.morphTargetInfluences[0]', [0, 1], [0, 1])];
            player.actions.set(file.id, { clip: new THREE.AnimationClip(file.id, 1, tracks), kind: file.kind });
        }
    };
    return { player, mixer, model };
}

test('a combined cue advances body and face together on the actual Three mixer', async () => {
    const { player, mixer, model } = runtime();
    assert.equal(await player.playSpeakerCue('藤田琴音(动作=讨好;表情=开心)'), true);
    assert.equal(player.liveActions.length, 2);
    mixer.update(0.5);
    assert.ok(model.position.x > 0.8);
    assert.ok(model.morphTargetInfluences[0] > 0.4, 'body morph tracks must not dilute the face clip');
    const playing = [...player.liveActions];
    await player.setTalking(true);
    assert.deepEqual(player.liveActions, playing, 'typing state must not start talk');
    const elapsed = playing[0].time;
    await player.playSpeakerCue('藤田琴音(动作=讨好;表情=开心)');
    assert.equal(playing[0].time, elapsed, 'same cue must not restart');
    await player.playSpeakerCue('藤田琴音');
    assert.deepEqual(player.liveActions, playing, 'missing suffix retains the current performance');
});

test('paired playback uses exactly the paired face and ignores other speakers', async () => {
    const { player } = runtime();
    await player.playSpeakerCue('藤田琴音(害羞)');
    assert.equal(player.liveActions.length, 2);
    assert.match(player.liveActions[1].getClip().name, /tereru/);
    const key = player.performanceKey;
    await player.playSpeakerCue('月村手毬(高兴)');
    await player.playSpeakerCue('藤田琴音(高兴)', { slideType: 'narration' });
    assert.equal(player.performanceKey, key);
});

test('a stale asynchronous load cannot overwrite the new speaker cue', async () => {
    const { player } = runtime();
    const load = player.importMotionEntries;
    let release;
    player.importMotionEntries = async files => {
        if (files.some(file => file.id.includes('tereru'))) await new Promise(resolve => { release = resolve; });
        await load(files);
    };
    const old = player.playSpeakerCue('藤田琴音(害羞)');
    await player.playSpeakerCue('藤田琴音(动作=说话;表情=开心)');
    release();
    assert.equal(await old, false);
    assert.equal(player.performanceKey, 'mixed:talk:happy');
    assert.equal(await player.playSpeakerCue('藤田琴音(生气)', { isCurrent: () => false }), false);
    assert.equal(player.performanceKey, 'mixed:talk:happy');
});

test('unavailable or partially loaded resources never start an incomplete performance', async () => {
    const { player } = runtime();
    player.importMotionEntries = async () => {};
    assert.equal(await player.playSpeakerCue('藤田琴音(害羞)'), false);
    assert.equal(player.liveActions.length, 0);
    player.indexByPack.set('motions/test', new Map());
    assert.equal(await player.playSpeakerCue('藤田琴音(动作=说话;表情=开心)'), false);
});

test('other idol speakers use the shared live portrait policy and common motion catalog', async () => {
    assert.equal(policy.isLivePortraitSpeaker('月村手毬(高兴)'), true);
    assert.equal(policy.isLivePortraitSpeaker('有村麻央'), true);
    assert.equal(policy.canUseLivePortrait('月村手毬', { packs: { 'idols/ttmr': { available: true } } }), true);
    assert.equal(policy.canUseLivePortrait('月村手毬', { packs: { 'idols/fktn': { available: true } } }), false);
    const { player } = runtime();
    player.idolId = 'ttmr';
    assert.ok(player.catalogItems().some(item => item.character === 'cmmn'));
    player.bindSecondaryMotion = async function (model) { return true; };
    assert.equal(await player.playSpeakerCue('月村手毬(高兴)'), true);
});

test('runtime exposes shared talking-morph support for every idol', () => {
    const source = readFileSync(new URL('../live-portrait.js', import.meta.url), 'utf8');
    assert.match(source, /bindVisemeMorphs/);
    assert.match(source, /updateTalkingMorph/);
    assert.match(source, /this\.talking = Boolean\(talking\)/);
});
