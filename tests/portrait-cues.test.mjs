import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parsePortraitCue, selectPortraitPerformance, buildPortraitRules, PAIRED_WORDS, BODY_WORDS, FACE_WORDS } from '../portrait-cues.js';
import { SCENE_IDOLS, detectSceneCast, parseStageTag, stageSnapshot, buildStageRules } from '../scene-protocol.js';

const map = JSON.parse(readFileSync(new URL('../gakumas-motion-map.json', import.meta.url)));
const catalog = map.buckets.flatMap(bucket => bucket.families.flatMap(family => family.items.map(item => ({ ...item, family: family.id }))));

test('speaker suffix is strict data, not dialogue text with a talk fallback', () => {
    assert.equal(parsePortraitCue('藤田琴音(害羞)').gesture, 'tereru');
    assert.equal(parsePortraitCue('藤田琴音（动作=说话；表情=开心）').face, 'happy');
    assert.equal(parsePortraitCue('藤田琴音(动作=点头;表情=开心)').invalid, true);
    assert.equal(parsePortraitCue('藤田琴音(动作=讨好;表情=生气)').invalid, true);
    assert.equal(parsePortraitCue('藤田琴音(动作=说话;动作=讨好;表情=开心)').invalid, true);
    assert.equal(parsePortraitCue('藤田琴音(不存在)').gesture, 'idle');
    assert.equal(parsePortraitCue('藤田琴音').mode, 'keep');
    assert.equal(parsePortraitCue('月村手毬(害羞)'), null);
    assert.equal(parsePortraitCue('藤田琴音(害羞)', 'narration'), null);
});

test('all advertised words select real catalog channels without mixing paired faces', () => {
    for (const word of Object.keys(PAIRED_WORDS)) {
        const plan = selectPortraitPerformance(parsePortraitCue(`藤田琴音(${word})`), catalog);
        assert.ok(plan?.body && plan?.face, word);
        assert.ok(catalog.some(item => item.pairing === 'paired' && item.body === plan.body && item.face === plan.face), word);
    }
    for (const body of Object.keys(BODY_WORDS)) for (const face of Object.keys(FACE_WORDS)) {
        const plan = selectPortraitPerformance(parsePortraitCue(`藤田琴音(动作=${body};表情=${face})`), catalog);
        assert.ok(plan?.body && plan?.face, `${body}/${face}`);
        assert.ok(catalog.some(item => item.pairing === 'bodyOnly' && item.body === plan.body));
        assert.ok(catalog.some(item => item.pairing === 'faceOnly' && item.face === plan.face));
    }
});

test('missing resources never silently select a different pairing', () => {
    const paired = catalog.filter(item => item.pairing === 'paired');
    assert.equal(selectPortraitPerformance(parsePortraitCue('藤田琴音(动作=说话;表情=开心)'), paired), null);
});

test('rules offer equal modes and separate whitelists', () => {
    const rules = buildPortraitRules();
    assert.match(rules, /琴音专属动作时.*优先使用琴音专属/);
    assert.match(rules, /纯动作词/);
    assert.match(rules, /自动扫描本段剧情文本/);
    assert.doesNotMatch(rules, /首个beat必须是预加载|先输出一次演员预加载名单|只允许名单内/);
    assert.doesNotMatch(rules, /不够用时|俏皮推销/);
});

test('Kotone dedicated actions use their newly restored paired facial clips', () => {
    for (const word of ['讨好', '撒娇', '定格', '亮相', '定格亮相', '特殊演出']) {
        const plan = selectPortraitPerformance(parsePortraitCue(`藤田琴音(${word})`), catalog);
        assert.ok(plan?.body && plan?.face, word);
        assert.equal(parsePortraitCue(`藤田琴音(${word})`).mode, 'paired');
    }
    assert.deepEqual(Object.keys(BODY_WORDS), ['说话']);
});

test('stage look and action tags preserve attention and reaction cues', () => {
    assert.deepEqual(parseStageTag('<stage-look idol="藤田琴音" target="秦谷美铃" duration="240"/>'), { type: 'stage', action: 'look', idolId: 'fktn', target: 'hmsz', duration: 240, speaker: '', text: '' });
    assert.deepEqual(parseStageTag('<stage-action idol="秦谷美铃" cue="点头"/>'), { type: 'stage', action: 'action', idolId: 'hmsz', cue: '点头', speaker: '', text: '' });
    const snapshot = stageSnapshot([{ type: 'stage', action: 'enter', idolId: 'fktn', position: 'left', speaker: '', text: '' }, { type: 'stage', action: 'enter', idolId: 'hmsz', position: 'right', speaker: '', text: '' }, { type: 'stage', action: 'look', idolId: 'fktn', target: 'hmsz', duration: 240, speaker: '', text: '' }, { type: 'stage', action: 'action', idolId: 'hmsz', cue: '点头', speaker: '', text: '' }], 3);
    assert.equal(snapshot.actors.fktn.look, 'hmsz');
    assert.equal(snapshot.actors.fktn.duration, 240);
    assert.equal(snapshot.actors.hmsz.action, '点头');
});

test('stage tags preload without showing actors, then enter and exit explicitly', () => {
    const preload = parseStageTag('<stage-preload idols="藤田琴音,月村手毬"/>');
    assert.deepEqual(preload, { type: 'stage', action: 'preload', cast: ['fktn', 'ttmr'], speaker: '', text: '' });
    const slides = [preload, parseStageTag('<stage-enter idol="藤田琴音" position="left"/>'), { type: 'dialogue', speaker: '藤田琴音(说话)', text: '你好' }, parseStageTag('<stage-exit idol="藤田琴音"/>')];
    assert.deepEqual(stageSnapshot(slides, 0), { cast: ['fktn', 'ttmr'], actors: {} });
    assert.deepEqual(stageSnapshot(slides, 2), { cast: ['fktn', 'ttmr'], actors: { fktn: { position: 'left' } } });
    assert.deepEqual(stageSnapshot(slides, 3), { cast: ['fktn', 'ttmr'], actors: {} });
});

test('names in narration and tagged speakers preload once without showing actors', () => {
    const slides = [
        { type: 'dialogue', speaker: '藤田琴音(说话)', text: '今天月村手毬没有来。' },
        { type: 'narration', text: '电话里传来了花海咲季的声音。藤田琴音认真听着。' },
    ];
    assert.deepEqual(stageSnapshot(slides, -1), { cast: ['fktn', 'hski', 'ttmr'], actors: {} });
    assert.deepEqual(stageSnapshot(slides, 1).actors, {});
    assert.deepEqual(detectSceneCast('制作人和路人'), []);
    assert.deepEqual(detectSceneCast(Object.keys(SCENE_IDOLS).join('、')), Object.values(SCENE_IDOLS));
});

test('stage-only roles enter and exit without a preload declaration or dialogue', () => {
    const slides = [
        parseStageTag('<stage-enter idol="月村手毬" position="right"/>'),
        parseStageTag('<stage-exit idol="月村手毬"/>'),
        parseStageTag('<stage-enter idol="路人"/>'),
    ];
    assert.deepEqual(stageSnapshot(slides, -1), { cast: ['ttmr'], actors: {} });
    assert.deepEqual(stageSnapshot(slides, 0).actors, { ttmr: { position: 'right' } });
    assert.deepEqual(stageSnapshot(slides, 2).actors, {});
    assert.match(buildStageRules(), /不需要输出stage-preload/);
});
