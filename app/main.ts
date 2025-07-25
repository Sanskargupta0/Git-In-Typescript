import * as fs from 'fs';
import zlib from 'zlib';

const args = process.argv.slice(2);

function parseArgs(args: string[]): { [key: string]: string | boolean } {
    const argMap: { [key: string]: string | boolean } = {};
    for (let i = 0; i < args.length; i++) {
        if (args[i].startsWith('--')) {
            const key = args[i].substring(2);
            const value = (i + 1 < args.length && !args[i + 1].startsWith('-')) ? args[i + 1] : true;
            argMap[key] = value;
            if (value !== true) i++; // Skip the next argument as it is a value
        } else if (args[i].startsWith('-')) {
            const key = args[i].substring(1);
            const value = (i + 1 < args.length && !args[i + 1].startsWith('-')) ? args[i + 1] : true;
            argMap[key] = value;
            if (value !== true) i++; // Skip the next argument as it is a value
        }
    }
    return argMap;
}

const parsedArgs = parseArgs(args);
const command = args[0];

enum Commands {
    Init = "init",
    CatFile = "cat-file",
}

switch (command) {
    case Commands.Init:
        // You can use print statements as follows for debugging, they'll be visible when running tests.
        console.error("Logs from your program will appear here!");

        // Uncomment this block to pass the first stage
        fs.mkdirSync(".git", { recursive: true });
        fs.mkdirSync(".git/objects", { recursive: true });
        fs.mkdirSync(".git/refs", { recursive: true });
        fs.writeFileSync(".git/HEAD", "ref: refs/heads/main\n");
        console.log("Initialized git directory");
        break;
    case Commands.CatFile:
        const hash = parsedArgs["p"] as string;
        
        const dir = hash.substring(0, 2);
        const file = hash.substring(2);

        const blob = fs.readFileSync(`.git/objects/${dir}/${file}`);
        const decompressedBuffer = zlib.unzipSync(blob);
        const nullbytebuffer = decompressedBuffer.indexOf(0);
        const blobContent = decompressedBuffer.subarray(nullbytebuffer+1).toString();
        process.stdout.write(blobContent);
        break;
    default:
        throw new Error(`Unknown command ${command}`);
}