import ghidra.app.decompiler.DecompInterface;
import ghidra.app.decompiler.DecompileResults;
import ghidra.app.script.GhidraScript;
import ghidra.program.model.address.Address;
import ghidra.program.model.listing.Function;
import ghidra.program.model.listing.Instruction;
import ghidra.program.model.listing.Program;

import java.io.BufferedWriter;
import java.io.FileWriter;
import ghidra.program.model.listing.InstructionIterator;
import ghidra.program.model.symbol.RefType;
import ghidra.program.model.symbol.SourceType;
import ghidra.program.model.symbol.Reference;
import java.util.ArrayList;
import java.util.List;
import java.nio.file.Files;
import java.nio.file.Path;

public class ExportPhysicsDecomp extends GhidraScript {
    @Override
    public void run() throws Exception {
        String[] args = getScriptArgs();
        if (args.length != 2) {
            printerr("usage: <output-file> <target-tsv>");
            return;
        }

        Program program = currentProgram;
        long imageBase = program.getImageBase().getOffset();
        DecompInterface decompiler = new DecompInterface();
        List<String[]> targets = new ArrayList<>();
        for (String line : Files.readAllLines(Path.of(args[1]))) {
            if (line.isBlank()) continue;
            String[] columns = line.split("\t", 2);
            if (columns.length != 2) throw new IllegalArgumentException("Malformed target row: " + line);
            columns[0] = columns[0].replace("\uFEFF", "").trim();
            targets.add(columns);
            String value = columns[0].replaceFirst("^0[xX]", "");
            Address entry = toAddr(Long.parseLong(value, 16) + (value.length() > 8 ? 0 : imageBase));
            disassemble(entry);
            if (getFunctionAt(entry) == null) createFunction(entry, columns[1]);
        }
        decompiler.openProgram(program);

        try (BufferedWriter output = new BufferedWriter(new FileWriter(args[0]));
             BufferedWriter audit = new BufferedWriter(new FileWriter(args[0] + ".audit.tsv"))) {
            audit.write("function\tentry\tinstruction\tkind\ttarget\tbytes_available\n");
            output.write("image_base=0x" + Long.toHexString(imageBase) + "\n");
            output.write("program=" + program.getName() + "\n\n");
            output.write("compiler=" + program.getCompilerSpec().getCompilerSpecID() + "\n");
            output.write("Unresolved calls, globals and prototypes are evidence gaps, not recovered source.\n\n");
            for (String[] target : targets) {
                String addressArgument = target[0].replaceFirst("^0[xX]", "");
                long addressValue = Long.parseLong(addressArgument, 16);
                String name = target[1];
                long addressOffset = addressArgument.length() > 8 ? addressValue : imageBase + addressValue;
                Address address = program.getAddressFactory().getDefaultAddressSpace().getAddress(addressOffset);
                Function function = getFunctionAt(address);
                if (function == null) {
                    try {
                        disassemble(address);
                        createFunction(address, name);
                    } catch (Exception error) {
                        output.write("===== " + name + " ADDRESS=0x" + Long.toHexString(addressOffset)
                            + " ERROR=" + error + " =====\n\n");
                        continue;
                    }
                    function = getFunctionAt(address);
                }
                if (function == null) {
                    output.write("===== " + name + " ADDRESS=0x" + Long.toHexString(addressOffset)
                        + " ERROR=function-not-found =====\n\n");
                    continue;
                }
                output.write("===== " + name + " ADDRESS=0x" + Long.toHexString(addressOffset)
                    + " ENTRY=" + function.getEntryPoint() + " SIZE="
                    + function.getBody().getNumAddresses() + " =====\n");
                output.write("-- disassembly --\n");
                InstructionIterator instructions = program.getListing().getInstructions(function.getBody(), true);
                int instructionCount = 0;
                while (instructions.hasNext()) {
                    Instruction instruction = instructions.next();
                    instructionCount++;
                    output.write(instruction.getAddress() + "  " + instruction + "\n");
                    for (Reference reference : instruction.getReferencesFrom()) {
                        if (!reference.getReferenceType().isFlow()) continue;
                        Address referenceTarget = reference.getToAddress();
                        audit.write(name + "\t" + address + "\t" + instruction.getAddress() + "\t"
                            + reference.getReferenceType() + "\t" + referenceTarget + "\t"
                            + program.getMemory().contains(referenceTarget) + "\n");
                    }
                    if (instruction.getFallThrough() != null && !program.getMemory().contains(instruction.getFallThrough())) {
                        audit.write(name + "\t" + address + "\t" + instruction.getAddress()
                            + "\tMISSING_FALLTHROUGH\t" + instruction.getFallThrough() + "\tfalse\n");
                    }
                }
                output.write("-- decompilation --\n");
                DecompileResults result = decompiler.decompileFunction(function, 120, monitor);
                if (result.decompileCompleted() && result.getDecompiledFunction() != null) {
                    output.write(result.getDecompiledFunction().getC());
                } else {
                    output.write("/* decompile failed: " + result.getErrorMessage() + " */\n");
                }
                output.write("\n\n");
                output.flush();
                println("decompile_completed=" + result.decompileCompleted() + " " + name);
            }
        } finally {
            decompiler.dispose();
        }
    }
}
