import ghidra.app.script.GhidraScript;
import ghidra.program.model.address.Address;
import ghidra.program.model.mem.MemoryBlock;
import java.nio.file.Files;
import java.nio.file.Path;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.util.Map;
import java.util.TreeMap;
import com.google.gson.JsonParser;
import com.google.gson.JsonObject;
import com.google.gson.JsonElement;
import ghidra.program.model.data.*;

public class ImportCapture extends GhidraScript {
    @Override
    public void run() throws Exception {
        Path directory = Path.of(getScriptArgs()[0]);
        if (Files.exists(directory.resolve("memory.tsv"))) {
            importEvidence(directory);
            return;
        }
        TreeMap<Long, Byte> bytes = new TreeMap<>();
        for (String line : Files.readAllLines(directory.resolve("manifest.tsv"))) {
            String[] columns = line.split("\t");
            if (columns.length != 8) continue;
            long start = Long.parseLong(columns[5].replaceFirst("^0[xX]", ""), 16);
            byte[] code = Files.readAllBytes(directory.resolve(columns[7]));
            for (int index = 0; index < code.length; ++index) {
                Byte previous = bytes.putIfAbsent(start + index, code[index]);
                if (previous != null && previous != code[index]) {
                    throw new IllegalStateException("Conflicting capture bytes at " + Long.toHexString(start + index));
                }
            }
        }
        long runStart = -1;
        long previousAddress = -1;
        ByteArrayOutputStream run = new ByteArrayOutputStream();
        for (Map.Entry<Long, Byte> entry : bytes.entrySet()) {
            long location = entry.getKey();
            Address address = toAddr(location);
            if (currentProgram.getMemory().contains(address)) {
                if (getByte(address) != entry.getValue()) throw new IllegalStateException("Existing block mismatch");
                continue;
            }
            if (runStart != -1 && location != previousAddress + 1) {
                addBlock(runStart, run.toByteArray());
                run.reset();
                runStart = -1;
            }
            if (runStart == -1) runStart = location;
            run.write(entry.getValue());
            previousAddress = location;
        }
        if (runStart != -1) addBlock(runStart, run.toByteArray());
    }

    private void importEvidence(Path directory) throws Exception {
        for (String line : Files.readAllLines(directory.resolve("memory.tsv"))) {
            String[] columns = line.split("\t");
            long start = Long.parseLong(columns[1], 16);
            byte[] bytes = Files.readAllBytes(directory.resolve(columns[3]));
            if (currentProgram.getMemory().contains(toAddr(start))) {
                for (int index = 0; index < bytes.length; index++) {
                    if (getByte(toAddr(start + index)) != bytes[index]) throw new IllegalStateException("Existing evidence mismatch");
                }
                continue;
            }
            MemoryBlock block = currentProgram.getMemory().createInitializedBlock(columns[0] + "_" + columns[1],
                toAddr(start), new ByteArrayInputStream(bytes), bytes.length, monitor, false);
            block.setExecute(columns[0].equals("code"));
            block.setWrite(columns[0].equals("data"));
        }
        for (JsonElement element : JsonParser.parseString(Files.readString(directory.resolve("layouts.json"))).getAsJsonArray()) {
            JsonObject layout = element.getAsJsonObject();
            StructureDataType structure = new StructureDataType(new CategoryPath("/CapturedJobLayouts"),
                layout.get("type").getAsString().replace('.', '_'), layout.get("size").getAsInt());
            for (JsonElement fieldElement : layout.getAsJsonArray("fields")) {
                JsonObject field = fieldElement.getAsJsonObject();
                DataType type;
                String name = field.get("type").getAsString();
                if (name.equals("System.Single")) type = FloatDataType.dataType;
                else if (name.equals("System.Boolean") || name.equals("System.Byte")) type = ByteDataType.dataType;
                else if (name.equals("System.Int32")) type = IntegerDataType.dataType;
                else if (field.has("size")) type = new ArrayDataType(ByteDataType.dataType, field.get("size").getAsInt(), 1);
                else continue;
                structure.replaceAtOffset(field.get("memory_offset").getAsInt(), type, type.getLength(),
                    field.get("name").getAsString(), "Captured metadata type: " + name);
            }
            currentProgram.getDataTypeManager().addDataType(structure, DataTypeConflictHandler.DEFAULT_HANDLER);
        }
    }

    private void addBlock(long address, byte[] bytes) throws Exception {
        MemoryBlock block = currentProgram.getMemory().createInitializedBlock("capture_" + Long.toHexString(address),
            toAddr(address), new ByteArrayInputStream(bytes), bytes.length, monitor, false);
        block.setExecute(true);
    }
}
