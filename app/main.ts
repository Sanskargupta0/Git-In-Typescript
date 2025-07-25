import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { unzipSync, deflateSync } from "node:zlib";

const args = process.argv.slice(2);
const command = args[0];

enum Commands {
    Init = "init",
    CatFile = "cat-file",
    HashObject = "hash-object",
    LsTree = "ls-tree",
    WriteTree = "write-tree",
    CommitTree = "commit-tree",
}

switch (command) {
    case Commands.Init:
        init();
        break;
    case Commands.CatFile:
        catFile(args);
        break;
    case Commands.HashObject: {
        const [, , fileName] = args;
        const sha = hashObject(fileName);
        console.log(sha);
        break;
    }
    case Commands.LsTree:
       const tree = readLsTree(args);
        tree.blobs.forEach((blob) => {
            // console.log(`${blob.mode} tree ${blob.sha} ${blob.name}`);
            console.log(`${blob.name}`);
        });
       break;
   case Commands.WriteTree: {
       const sha = writeTree();
       console.log(`${sha}`);
       break;
   }
   case Commands.CommitTree: {
       const sha = commitTree(args);
       console.log(`${sha}`);
       break;
   }
   default:
       throw new Error(`Unknown command ${command}`);
}

type Sha = string & { _brand: 'sha' }
type LsTree = {
    size: number;
    blobs: {
        mode: string;
        name: string;
        sha: Sha;
    }[];
}


function commitTree(args: string[]): Sha {
    const [_cmd, treeSha, _p, parentSha, _m, message] = args;

    const contents = `\
tree ${treeSha}
parent ${parentSha}
author My Name <my_name@gmail.com> 946684800 -0800
committer My Name <my_name@gmail.com> 946684800 -0800

${message}
`;
    const size = Buffer.byteLength(contents);
    const fullBuffer = `commit ${size}\0${contents}`;

    return writeObjectContents(fullBuffer);
}


function writeTree(dirPath: string = '.'): Sha {
    const contents: LsTree["blobs"] = [];

    const files = fs.readdirSync(dirPath, { withFileTypes: true })
        .filter((file) => file.name !== '.git')
        .sort((a, b) => a.name.localeCompare(b.name));

    for (const file of files) {
        const subPath = path.join(dirPath, file.name)
        if (file.isDirectory()) {
            let sha = writeTree(subPath);
            // console.debug(`recursive writeTree returned: ${subPath} @ ${sha}`);
            contents.push({ mode: "40000", name: file.name, sha });
        } else {
            let sha = hashObject(subPath);
            const mode = ((file) => {
                if (file.isSymbolicLink()) return "120000";
                if (file.isFile()) return "100644";
                return "100755";
            })(file)
            contents.push({ mode, name: file.name, sha });
        }
    }

    return hashTree(contents)
}


function readLsTree(args: string[]): LsTree {
    const [_ls, _nameOnly, treeSha] = args;
    const treePath = objectPathFromSha(treeSha as Sha);
    const file = unzipSync(fs.readFileSync(treePath));
    return parseTreeFile(file);
}


function parseTreeFile(file: Buffer): LsTree {
    const headerEndIndex = file.indexOf(0, 0);
    const [type, size] = file.toString('ascii', 0, headerEndIndex).split(' ');
    if (type !== 'tree') throw new Error("not a tree file");

    const blobs: LsTree['blobs'] = []

    let startOfBlob = headerEndIndex + 1;
    while (true) {
        let endOfName = file.indexOf(0, startOfBlob);
        if (endOfName === -1) break;
        const fileInfo = file.toString('ascii', startOfBlob, endOfName);
        const modeIndex = fileInfo.indexOf(' ')
        const mode = fileInfo.substring(0, modeIndex);
        const name = fileInfo.substring(modeIndex + 1);

        const startOfSha = endOfName + 1;
        const endOfSha = startOfSha + 20;
        const sha = file.toString('hex', startOfSha, endOfSha + 1) as Sha;

        blobs.push({ mode, name, sha })

        startOfBlob = endOfSha;
    }

    return { size: +size, blobs };
}


function hashObject(fileName: string): Sha {
    const file = fs.readFileSync(fileName, { encoding: 'ascii' });
    const sizeBytes = file.length; //Buffer.byteLength(file);

    const content = `blob ${sizeBytes}\0${file}`;
    return writeObjectContents(content);
}


function writeObjectContents(content: string | Buffer): Sha {
    const sha = createSha(content);
    const writePath = objectPathFromSha(sha);
    try {
        const dir = path.dirname(writePath);
        fs.mkdirSync(dir);
    } catch (error: unknown) {
        if (!(error instanceof Error)) throw error;
        if (!('code' in error) || error.code !== 'EEXIST') throw error;
    }

    const zlibContents = deflateSync(content);
    fs.writeFileSync(writePath, zlibContents);
    return sha;
}


function hashTree(tree: LsTree["blobs"]): Sha {
    const contents: Buffer[] = []
    for (let blob of tree) {
        contents.push(Buffer.from(`${blob.mode} ${blob.name}\0`, 'ascii'));
        contents.push(Buffer.from(binarySha(blob.sha), 'binary'));
    }

    const size = contents.reduce((length, buffer) => {
        return length + buffer.byteLength;
    }, 0);
    contents.unshift(Buffer.from(`tree ${size}\0`, 'ascii'));

    const fullBuffer = Buffer.concat(contents);
    return writeObjectContents(fullBuffer);
}


function createSha(contents: string | Buffer): Sha {
    const sha = crypto.createHash('sha1').update(contents).digest('hex');
    return sha as Sha
}


function binarySha(sha: Sha): string {
    return Buffer.from(sha, 'hex').toString('binary');
}


function catFile(args: string[]): void {
   const [,, sha] = args;
   const path = objectPathFromSha(sha as Sha);
   const fileBuffer = fs.readFileSync(path);

   const fileUnzip = unzipSync(fileBuffer);
   const [, content] = splitBlob(fileUnzip);
    process.stdout.write(content);
}


function objectPathFromSha(sha: Sha): string {
    return path.join('.git', 'objects', sha.slice(0, 2), sha.slice(2));
}


function splitBlob(file: Buffer): [number, string] {
   const sizeLineDelimiter = file.indexOf(0);
   const blobSizeLine = file.toString('utf8', 0, sizeLineDelimiter);
   const size = Number.parseInt(blobSizeLine.slice(5), 10);

    const content = file.toString('utf8', sizeLineDelimiter + 1);

    return [size, content];
}


function init(): void {
    fs.mkdirSync(".git", { recursive: true });
    fs.mkdirSync(".git/objects", { recursive: true });
    fs.mkdirSync(".git/refs", { recursive: true });
    fs.writeFileSync(".git/HEAD", "ref: refs/heads/main\n");
    console.log("Initialized git directory");
}