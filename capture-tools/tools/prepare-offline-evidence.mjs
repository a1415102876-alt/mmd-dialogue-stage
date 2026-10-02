import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

function addressOf(value) {
    if (!/^(?:0x)?[0-9a-f]+$/i.test(value)) throw new Error(`Invalid address: ${value}`);
    const address = Number.parseInt(value, 16);
    if (!Number.isSafeInteger(address)) throw new Error(`Unsafe address: ${value}`);
    return address;
}

export function mergeRegions(regions) {
    const memory = new Map();
    const conflicts = new Set();
    for (const region of regions) {
        for (let offset = 0; offset < region.bytes.length; offset++) {
            const address = region.address + offset;
            const value = region.bytes[offset];
            if (memory.has(address) && memory.get(address) !== value) conflicts.add(address);
            memory.set(address, value);
        }
    }
    const merged = [];
    for (const address of [...memory.keys()].sort((left, right) => left - right)) {
        if (conflicts.has(address)) continue;
        let current = merged.at(-1);
        if (!current || current.address + current.bytes.length !== address) {
            current = { address, bytes: [] };
            merged.push(current);
        }
        current.bytes.push(memory.get(address));
    }
    return { regions: merged.map(region => ({ ...region, bytes: Buffer.from(region.bytes) })), conflicts: [...conflicts].sort((left, right) => left - right) };
}

export function groupMethods(manifest) {
    const methods = new Map();
    for (const line of manifest.split(/\r?\n/).filter(Boolean)) {
        const columns = line.split('\t');
        if (columns.length !== 8) throw new Error('Malformed manifest row');
        const address = addressOf(columns[5]);
        if (!methods.has(address)) methods.set(address, { address, aliases: [] });
        methods.get(address).aliases.push({ assembly: columns[0], namespace: columns[1], class: columns[2], method: columns[3], signature: columns[4], size: Number(columns[6]), file: columns[7] });
    }
    return [...methods.values()];
}

export function groupManifestFiles(manifestFiles) {
    return groupMethods(manifestFiles.join('\n'));
}

export function formatDecompTargets(methods) {
    return methods.map(method => {
        const alias = method.aliases[0];
        const name = `${alias.class}_${alias.method}`;
        return `0x${method.address.toString(16)}\t${name}`;
    }).join('\n') + (methods.length ? '\n' : '');
}

export function excludeCodeOverlap(dataRegions, codeRegions) {
    const remaining = [];
    for (const region of dataRegions) {
        for (let offset = 0; offset < region.bytes.length; offset++) {
            const address = region.address + offset;
            const code = codeRegions.find(candidate => address >= candidate.address && address < candidate.address + candidate.bytes.length);
            if (code) {
                if (region.bytes[offset] !== code.bytes[address - code.address]) throw new Error(`Conflicting code/data at ${address.toString(16)}`);
                continue;
            }
            remaining.push({ address, bytes: region.bytes.subarray(offset, offset + 1) });
        }
    }
    return mergeRegions(remaining).regions;
}

export function prepareEvidence(capture, output) {
    const readJsonLines = name => fs.readFileSync(path.join(capture, name), 'utf8').split(/\r?\n/).filter(Boolean).map(JSON.parse);
    const manifestPaths = ['manifest.tsv', 'native-helper-manifest.tsv']
        .map(name => path.join(capture, name)).filter(file => fs.existsSync(file));
    const methods = groupManifestFiles(manifestPaths.map(file => fs.readFileSync(file, 'utf8')));
    const codeRegions = [];
    for (const method of methods) {
        for (const alias of method.aliases) {
            const file = path.resolve(capture, alias.file);
            if (path.dirname(file) !== path.resolve(capture)) throw new Error('Manifest file outside capture');
            const bytes = fs.readFileSync(file);
            if (bytes.length !== alias.size) throw new Error(`Size mismatch: ${file}`);
            codeRegions.push({ address: method.address, bytes });
        }
    }
    const code = mergeRegions(codeRegions);
    if (code.conflicts.length) throw new Error('Conflicting machine code within one capture');
    const references = readJsonLines('native-data-references.jsonl');
    const data = mergeRegions(references.filter(row => row.status === 'read' && row.raw_hex).map(row => {
        if (!/^(?:[0-9a-f]{2})+$/i.test(row.raw_hex)) throw new Error('Malformed raw_hex');
        return { address: addressOf(row.target_address), bytes: Buffer.from(row.raw_hex, 'hex') };
    }));
    const calls = readJsonLines('native-call-references.jsonl');
    data.regions = excludeCodeOverlap(data.regions, code.regions);
    const containsCode = address => code.regions.some(region => address >= region.address && address < region.address + region.bytes.length);
    const targets = [...new Set(calls.map(row => row.target_address))].map(target => ({ address: target, code_available: containsCode(addressOf(target)) }));
    const snapshot = JSON.parse(fs.readFileSync(path.join(capture, 'runtime-data.json'), 'utf8'));
    const layouts = new Map();
    for (const actor of snapshot.actors ?? []) {
        for (const playable of actor.playable_jobs ?? []) {
            for (const entry of playable.native_arrays ?? []) {
                const array = entry.native_array;
                if (array.status !== 'read' || !array.items?.length) continue;
                layouts.set(array.element_type, { type: array.element_type, size: array.element_size, fields: array.items[0].fields });
            }
        }
    }
    fs.mkdirSync(output, { recursive: true });
    const memoryRows = [];
    for (const [kind, regions] of [['code', code.regions], ['data', data.regions]]) {
        for (const region of regions) {
            if (kind === 'data' && code.regions.some(codeRegion => region.address < codeRegion.address + codeRegion.bytes.length && region.address + region.bytes.length > codeRegion.address)) throw new Error('Code/data overlap requires manual review');
            const filename = `${kind}-${region.address.toString(16)}.bin`;
            fs.writeFileSync(path.join(output, filename), region.bytes);
            memoryRows.push([kind, region.address.toString(16), region.bytes.length, filename].join('\t'));
        }
    }
    const summary = { source: path.resolve(capture), manifest_files: manifestPaths.map(file => path.basename(file)), raw_manifest_rows: methods.reduce((total, method) => total + method.aliases.length, 0), unique_method_entries: methods.length, code_bytes: code.regions.reduce((total, region) => total + region.bytes.length, 0), data_bytes: data.regions.reduce((total, region) => total + region.bytes.length, 0), conflicting_data_addresses: data.conflicts.map(address => `0x${address.toString(16)}`), direct_targets: targets, limitations: ['References are decoded from fixed windows, not function boundaries.', 'Data windows may contain pointers, flags, and padding; not all bytes are constants.', 'Shared entry aliases are not evidence of separate implementations.', 'A helper window can still be truncated at a section boundary; inspect the audit file before translating a formula.'] };
    fs.writeFileSync(path.join(output, 'memory.tsv'), memoryRows.join('\n') + '\n');
    fs.writeFileSync(path.join(output, 'methods.json'), JSON.stringify(methods, null, 2));
    fs.writeFileSync(path.join(output, 'decomp-targets.tsv'), formatDecompTargets(methods));
    fs.writeFileSync(path.join(output, 'layouts.json'), JSON.stringify([...layouts.values()], null, 2));
    fs.writeFileSync(path.join(output, 'evidence-summary.json'), JSON.stringify(summary, null, 2));
    return summary;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
    if (process.argv.length !== 4) throw new Error('Usage: node prepare-offline-evidence.mjs <capture> <output>');
    const summary = prepareEvidence(process.argv[2], process.argv[3]);
    console.log(JSON.stringify({ ...summary, direct_targets: { total: summary.direct_targets.length, available: summary.direct_targets.filter(target => target.code_available).length } }, null, 2));
}
