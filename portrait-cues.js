import { PAIRED_CUES, BODY_ONLY_CUES, FACE_ONLY_CUES } from './dialogue-intent.js?v=20260911-cue11';
import { DEFAULT_MOTION_VARIANTS, findFacePlaylistIndex, findGesturePlaylistIndex } from './core.js?v=20260914-idol-types';
import { isLivePortraitSpeaker } from './live-portrait-policy.js';
import { sceneIdolId, buildStageRules } from './scene-protocol.js';
export { sceneIdolId, buildStageRules, splitStageStory, parseStageTag, stageSnapshot, detectSceneCast } from './scene-protocol.js';

function canonicalWords(table) {
    const seen = new Set();
    return Object.freeze(Object.fromEntries(Object.entries(table).filter(([, id]) => {
        if (seen.has(id)) return false;
        seen.add(id);
        return true;
    })));
}

export const PAIRED_WORDS = canonicalWords(PAIRED_CUES);
export const BODY_WORDS = canonicalWords(BODY_ONLY_CUES);
export const FACE_WORDS = canonicalWords(FACE_ONLY_CUES);

export { DEFAULT_MOTION_VARIANTS };

export function parsePortraitCue(speaker, slideType = '', idolId = 'fktn') {
    if (slideType === 'narration' || sceneIdolId(speaker) !== idolId) return null;
    const raw = String(speaker || '').trim();
    const fallback = { mode: 'paired', gesture: 'idle', face: '', invalid: true };
    if (!/[（(]/u.test(raw)) return { mode: 'keep' };
    const match = raw.match(/^[^（(]+\s*(?:\(([^()]*)\)|（([^（）]*)）)$/u);
    if (!match) return fallback;
    const token = (match[1] ?? match[2]).trim();
    if (Object.hasOwn(PAIRED_WORDS, token)) return { mode: 'paired', gesture: PAIRED_WORDS[token], face: '' };
    if (Object.hasOwn(BODY_WORDS, token)) return { mode: 'mixed', gesture: BODY_WORDS[token], face: 'neutral' };
    const parts = token.split(/[;；]/u).map(part => part.trim());
    const fields = parts.map(part => part.match(/^(动作|表情)\s*=\s*([^=]+)$/u));
    if (fields.length !== 2 || fields.some(field => !field) || fields[0][1] === fields[1][1]) return fallback;
    const values = Object.fromEntries(fields.map(field => [field[1], field[2].trim()]));
    if (!Object.hasOwn(BODY_WORDS, values.动作) || !Object.hasOwn(FACE_WORDS, values.表情)) return fallback;
    return { mode: 'mixed', gesture: BODY_WORDS[values.动作], face: FACE_WORDS[values.表情] };
}

export function selectPortraitPerformance(cue, catalog, idolId = 'fktn') {
    if (!cue || cue.mode === 'keep') return null;
    const eligible = catalog.filter(item => ['cmmn', idolId].includes(item.character || item.catalog?.character));
    const pairing = cue.mode === 'mixed' ? 'bodyOnly' : 'paired';
    const candidates = eligible.filter(item => (item.pairing || item.catalog?.pairing) === pairing && item.body);
    const dedicated = candidates.filter(item => (item.character || item.catalog?.character) === idolId
        && (item.family || item.catalog?.family) === cue.gesture);
    const bodies = dedicated.length ? dedicated : candidates;
    const bodyIndex = findGesturePlaylistIndex(bodies, cue.gesture, idolId, {
        preferPairing: pairing,
        preferredVariant: DEFAULT_MOTION_VARIANTS[idolId] || '',
        random: () => 0,
    });
    const body = bodies[bodyIndex];
    if (!body) return null;
    let face = body.face;
    if (cue.mode === 'mixed') {
        const faces = eligible.filter(item => (item.pairing || item.catalog?.pairing) === 'faceOnly' && item.face);
        face = faces[findFacePlaylistIndex(faces, cue.face, { random: () => 0 })]?.face;
    }
    if (!face) return null;
    return { ...body, key: `${body.body}|${face}`, face, pairing: cue.mode === 'mixed' ? 'mixed' : 'paired' };
}

export function buildIdol3dRules(idolName = '偶像', availableTags = []) {
    const tags = availableTags.length ? availableTags.join('、') : [...new Set([...Object.keys(PAIRED_WORDS), ...Object.keys(BODY_WORDS), ...Object.keys(FACE_WORDS)])].join('、');
    return [
        '<idol_3d_performance_rules>',
        `适用角色：${idolName}。本规则控制3D身体动作、表情、口型和舞台注意方向。`,
        `VN台词使用 <dialogue char="${idolName}(功能词)">台词</dialogue>；NIA台词 speaker 使用相同格式，旁白不填角色名。`,
        `功能词只允许使用实际动作库白名单：${tags}。优先使用该角色专属动作；有配套身体与表情时使用成套动作，否则才组合独立动作和表情。不得输出文件名、内部ID或不存在的动作。`,
        '动作应服务于剧情：普通说话保持说话，倾听使用待机或应答，明确点头、摇头、递交、鞠躬、坐下、起身或转身时才调用对应动作。连续情绪没有变化时沿用当前功能词，不要每句随机切换。',
        '多人对话时，当前说话者看向实际听话者；听话者看向说话者并用待机、应答、点头或情绪动作做轻微回应。向制作人、观众、舞台或直播镜头表达时才看向camera。',
        '注意方向变化使用独立舞台标签 <stage-look idol="偶像全名" target="偶像全名|camera|none"/>；在场但未发言者的明确反应使用 <stage-action idol="偶像全名" cue="功能词"/>。标签只在目标或动作变化时输出，不要每句重复。',
        '模型由前端扫描回复中的偶像姓名并预加载；不要输出stage-preload。角色只有真实出现时才stage-enter，真实离开时才stage-exit；被提及、回忆、电话或画外音不进场。',
        buildStageRules(),
        '</idol_3d_performance_rules>',
    ].join('\n');
}

export function buildPortraitRules() {
    return [
        '<fujita_kotone_portrait_rules>',
        '适用角色：藤田琴音。括号只控制3D表现，不属于姓名或台词；名字框只显示藤田琴音。',
        buildIdol3dRules('藤田琴音', [...Object.keys(PAIRED_WORDS), ...Object.keys(BODY_WORDS)]),
        'VN：<dialogue char="藤田琴音(功能词)">台词</dialogue>。NIA网络直播：beats[].speaker 使用同样的姓名格式；电视营业的 lines[].speaker 也相同。旁白不填姓名；本规则不得用于其他角色。',
        '同一功能词有可用的琴音专属动作时，前端优先使用琴音专属；没有才选择通用动作。不得拿其他偶像的专属动作代替。',
        '每次只输出一个准确功能词，不输出文件名、多个标签或动作=...;表情=...组合语法。',
        '根据语境优先选择合适的成套功能词，同时播放对应身体动作与配套表情；普通交谈没有突出情绪时用说话，倾听、等待或无法判断时用待机。不要为了成套动作虚构行为。',
        '成套词：' + Object.keys(PAIRED_WORDS).join('、') + '。',
        '纯动作词：' + Object.keys(BODY_WORDS).join('、') + '。',
        '讨好、定格已经补齐专属表情，属于成套功能词，不再作为纯动作。',
        '示例：藤田琴音(害羞)；藤田琴音(讨好)；藤田琴音(说话)。',
        '仅使用白名单准确写法，不输出文件名、旧立绘词或自造词。无变化沿用标签；无法判断使用待机。只有剧情确实发生时才选择移动、递交、课程等动作，不为动作虚构道具和事件。',
        '</fujita_kotone_portrait_rules>',
        buildStageRules(),
    ].join('\n');
}
