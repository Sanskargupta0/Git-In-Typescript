import * as fs from 'node:fs';
import zlib from "node:zlib";
// import stream from "node:stream";
// import crypto from "node:crypto";
import process from "node:process";
import path from "path";

const NULL_BYTE = "\0";

const Commands = {
    Init: "init",
    CatFile: "cat-file",
    HashObject: "hash-object"
    LsTrees: "ls-trees",
} as const;

const GIT = {
    types: {
        blob: "blob",
    }
} as const;

type HashObjectArgs = [typeof Commands.HashObject, "-w", string];
type CatFileArgs = [typeof Commands.CatFile, string, string];
type LsTreesArgs = [typeof Commands.LsTrees, string];

const args = process.argv.slice(2);
const command = args[0];

const exit = (error: Error | undefined = undefined) => {
    if (!error) {
        process.exit(0);
    } else {
        process.stderr.write(error.message);
        process.exit(1);
    }
}

const print = (message: string) => process.stdout.write(message);

const findNearbyGitDir = (initialPath: string) => {
    if (!fs.existsSync(initialPath)) exit(new Error(`Path ${initialPath} does not exist`));
    let gitDir = "";

    fs.readdirSync(initialPath).forEach((file) => {
        if (file === ".git") {
            gitDir = path.resolve(initialPath, file);
        }
    });

    if (gitDir) return gitDir;

    const parentDir = path.resolve(initialPath, "..");
    if (parentDir === "/") exit(new Error(`No .git directory found in ${initialPath}`));

    return findNearbyGitDir(parentDir);
}

const handleError = <T>(fn: () => T) => {
    try {
        return fn();
    } catch (error) {
        exit(error as Error);
        return undefined as T;
    }
}

switch (command) {
    case Commands.Init: {
        // You can use print statements as follows for debugging, they'll be visible when running tests.
        console.error("Logs from your program will appear here!");

        // Uncomment this block to pass the first stage
        fs.mkdirSync(".git", { recursive: true });
        fs.mkdirSync(".git/objects", { recursive: true });
        fs.mkdirSync(".git/refs", { recursive: true });
        fs.writeFileSync(".git/HEAD", "ref: refs/heads/main\n");
        console.log("Initialized git directory");
        break;
    }
    case Commands.CatFile: {
        const dotGitPath = findNearbyGitDir(process.cwd());

        const commandArgs = args as CatFileArgs;
        const objectHash = commandArgs[2];
        const objectFilepath = `${dotGitPath}/objects/${objectHash.slice(0, 2)}/${objectHash.slice(2)}`;

        const blob = await Bun.file(objectFilepath).arrayBuffer();
        const decompressedBuffer = handleError(() => zlib.unzipSync(blob));
        const nullByteIndex = decompressedBuffer.indexOf(NULL_BYTE);
        const blobContent = decompressedBuffer.subarray(nullByteIndex + 1).toString();

        print(blobContent);
        break;
    }
    case Commands.HashObject: {
        const dotGitPath = findNearbyGitDir(process.cwd());

        const commandArgs = args as HashObjectArgs;
        const filepath = path.resolve(commandArgs[2]);

        if (!await Bun.file(filepath).exists()) {
            exit(new Error(`File ${filepath} does not exist`));
        }

        const fileContent = await Bun.file(filepath).arrayBuffer();
        const header = await new Blob([`${GIT.types.blob} ${fileContent.byteLength}${NULL_BYTE}`]).arrayBuffer();
        const resultingObjectBuffer = await new Blob([header, fileContent]).arrayBuffer();

        const hash = new Bun.CryptoHasher("sha1").update(resultingObjectBuffer).digest("hex");

        const objectHash = `${hash.slice(0, 2)}/${hash.slice(2)}`;
        const objectFilepath = `${dotGitPath}/objects/${objectHash}`;

        fs.mkdirSync(path.dirname(objectFilepath), { recursive: true });

        const compressed = zlib.deflateSync(resultingObjectBuffer);

        const bytesWritten = await Bun.write(objectFilepath, new Uint8Array(compressed));
        
        if (bytesWritten !== compressed.byteLength) {
            exit(new Error(`Failed to write object file ${objectFilepath}. Expected ${compressed.byteLength} bytes, wrote ${bytesWritten} bytes.`));
        }

        print(hash);
        break;
    }
    case Commands.LsTrees: {
        const dotGitPath = findNearbyGitDir(process.cwd());

        const commandArgs = args as LsTreesArgs;
        const treeHash = commandArgs[2];
        const treeFilepath = `${dotGitPath}/objects/${treeHash.slice(0, 2)}/${treeHash.slice(2)}`;

        const tree = await Bun.file(treeFilepath).arrayBuffer();
        const decompressedBuffer = handleError(() => zlib.unzipSync(tree));
        const nullByteIndex = decompressedBuffer.indexOf(NULL_BYTE);
        const treeContent = decompressedBuffer.subarray(nullByteIndex + 1).toString();

        print(treeContent);
        break;
    }
    default:
        throw new Error(`Unknown command ${command}`);
}