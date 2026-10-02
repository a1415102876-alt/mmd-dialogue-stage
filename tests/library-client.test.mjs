import test from 'node:test';
import assert from 'node:assert/strict';
import { indexMotionFiles } from '../core.js';
import { idolAssetUrls, joinLibraryUrl, libraryFileUrl, motionAssetUrls, motionAvailability, resolveLibrarySource, selectIdolModel } from '../library-client.js';
import { safeJoinLibraryPath } from '../../../src/endpoints/mmd-library.js';

const config = {
    source: 'local',
    localBase: '/mmd-dialogue-stage/library/file',
    r2: { baseUrl: 'https://cdn.example.com/gakumas' },
    packs: {
        'idols/fktn': { r2Prefix: 'idols/fktn' },
        'motions/cmmn-body': { r2Prefix: 'motions/cmmn-body' },
        'motions/cmmn-face': { r2Prefix: 'motions/cmmn-face' },
    },
};

test('library urls stay inside the configured pack', () => {
    assert.equal(
        libraryFileUrl(config, 'idols/fktn', 'Texture2D/face.png'),
        '/mmd-dialogue-stage/library/file/idols/fktn/Texture2D/face.png',
    );
    assert.equal(libraryFileUrl(config, 'idols/fktn', '../secret.pmx'), '/mmd-dialogue-stage/library/file/idols/fktn/secret.pmx');
});

test('r2 source uses the public bucket prefix', () => {
    const url = libraryFileUrl(config, 'motions/cmmn-body', 'mot_all_chr_cmmn_yes-001_in_b.vmd', {
        source: 'r2',
        r2Base: 'https://cdn.example.com/gakumas',
    });
    assert.equal(url, 'https://cdn.example.com/gakumas/motions/cmmn-body/mot_all_chr_cmmn_yes-001_in_b.vmd');
    assert.equal(resolveLibrarySource(config, { source: 'r2', r2Base: '' }).source, 'local');
});

test('idol assets include the glb and texture folder', () => {
    const assets = idolAssetUrls({
        pack: 'idols/fktn',
        model: 'fktn-casl.glb',
        textureDir: 'Texture2D',
    }, config, ['t_chr_fktn-base-0000_fce_col.png']);
    assert.match(assets.modelUrl, /fktn-casl\.glb$/);
    assert.match(assets.textures[0].url, /Texture2D\/t_chr_fktn-base-0000_fce_col\.png$/);
});

test('idol load prefers the outfit glb over pmx', () => {
    const idol = { id: 'hski', outfit: 'SCHL-0000', model: 'hski-schl-0000-vmd.pmx' };
    const picked = selectIdolModel(idol, [
        'hski-schl-0000-vmd.pmx',
        'Texture2D/t_chr_hski-base-0000_bdy_sdw.png',
        'other-room.glb',
        'hski-schl-0000-glb-hair-layer.glb',
    ]);
    assert.deepEqual(picked, { name: 'hski-schl-0000-glb-hair-layer.glb', format: 'glb' });
    assert.deepEqual(selectIdolModel({ id: 'fktn', model: 'fktn-casl.glb' }, []), { name: 'fktn-casl.glb', format: 'glb' });
});

test('motion lookup maps kebab ids back to original vmd names', () => {
    const indexByPack = new Map([
        ['motions/cmmn-body', indexMotionFiles(['mot_all_chr_cmmn_yes-001_in_b.vmd'])],
        ['motions/cmmn-face', indexMotionFiles(['mot_all_chr_cmmn_yes-001_in_f.vmd'])],
    ]);
    const item = {
        label: 'mot_all_chr_cmmn_yes-001_in',
        body: 'mot-all-chr-cmmn-yes-001-in-b',
        face: 'mot-all-chr-cmmn-yes-001-in-f',
    };
    const files = motionAssetUrls(item, config, indexByPack);
    assert.equal(files.length, 2);
    assert.equal(files[0].name, 'mot_all_chr_cmmn_yes-001_in_b.vmd');
    assert.equal(motionAvailability(item, indexByPack).ready, true);
    assert.equal(joinLibraryUrl('/base/', 'a', 'b/c'), '/base/a/b/c');
});

test('motion lookup ignores nested library directories', () => {
    const indexByPack = new Map([
        ['motions/hski-dedicated-body', indexMotionFiles([
            'body/mot_all_chr_hski_yubisasi-001_in_b.vmd',
        ])],
    ]);
    const item = {
        label: 'mot_all_chr_hski_yubisasi-001_in',
        body: 'mot-all-chr-hski-yubisasi-001-in-b',
    };
    const files = motionAssetUrls(item, {
        ...config,
        packs: {
            ...config.packs,
            'motions/hski-dedicated-body': { r2Prefix: 'motions/hski-dedicated-body' },
        },
    }, indexByPack);
    assert.equal(files[0].packId, 'motions/hski-dedicated-body');
    assert.equal(files[0].name, 'body/mot_all_chr_hski_yubisasi-001_in_b.vmd');
    assert.equal(files[0].guessed, undefined);
});

test('library file paths cannot escape the pack root', () => {
    const root = 'E:/gakumas-pmx-workflow/output/fktn-casl-reference-matched';
    assert.equal(safeJoinLibraryPath(root, '../../../Windows/win.ini'), '');
    assert.match(safeJoinLibraryPath(root, 'Texture2D/t_chr_fktn-base-0000_fce_col.png').replace(/\\/g, '/'), /Texture2D\/t_chr_fktn-base-0000_fce_col\.png$/);
});

test('library route serves the kotone glb from the pack root', async () => {
    const { default: express } = await import('express');
    const { mountMmdLibrary } = await import('../../../src/endpoints/mmd-library.js');
    const app = express();
    mountMmdLibrary(app);
    const server = await new Promise(resolve => {
        const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
    });
    const { port } = server.address();
    const url = `http://127.0.0.1:${port}/mmd-dialogue-stage/library/file/idols/fktn/fktn-casl.glb`;
    try {
        const status = await fetch(`http://127.0.0.1:${port}/mmd-dialogue-stage/library/status`);
        assert.equal(status.status, 200);
        const payload = await status.json();
        assert.equal(payload.packs['idols/fktn']?.available, true);
        assert.ok(payload.packs['idols/fktn'].files.some(name => name === 'fktn-casl.glb'));
        assert.ok(payload.packs['idols/fktn'].files.some(name => name.startsWith('Texture2D/')));
        const response = await fetch(url);
        const bytes = Buffer.from(await response.arrayBuffer());
        assert.equal(response.status, 200);
        assert.equal(bytes.subarray(0, 4).toString('ascii'), 'glTF');
        assert.ok(bytes.length > 1000);
    } finally {
        await new Promise(resolve => server.close(resolve));
    }
});
