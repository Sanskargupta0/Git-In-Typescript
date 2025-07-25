import * as fs from 'fs';
import { read } from 'node:fs';
import * as crypto from "crypto"
import path from 'node:path';
import { blob } from 'node:stream/consumers';
import zlib from 'node:zlib';


const args = process.argv.slice(2);
const command = args[0];


//commands


enum Commands {
    Init = "init",
    Cat = "cat-file",
    Hash = "hash-object",
    Tree = "ls-tree",
    Write = "write-tree",
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

    case Commands.Cat:
         handleCatFileCommand();
         break;

    case Commands.Hash:
        handleHashCommand();
        break; 

    case Commands.Tree:
        handleTreeInspectCommand();
        break;

    case Commands.Write:
        handleWriteTreeCommand();
        break;
    default:
        throw new Error(`Unknown command ${command}`);
}

function handleCatFileCommand(){
    const folder=args[2].substring(0,2);
    const file=args[2].substring(2);

    const completePath= path.join(process.cwd(), ".git", "objects", folder, file);

    const blob=fs.readFileSync(completePath);

    const decompressedBuffer=zlib.unzipSync(blob);

    const nullByteIndex=decompressedBuffer.indexOf(0);
    const blobContent=decompressedBuffer.subarray(nullByteIndex+1).toString();

    process.stdout.write(blobContent);
}

function generateHash(bufferVal: Buffer, type:string, write:boolean){
     const header = `${type} ${bufferVal.length}\0`;
     const blobStore= Buffer.concat([Buffer.from(header), bufferVal]);
     const hash = crypto.createHash('sha1').update(blobStore).digest('hex');

     if(write===true){
        const folder=hash.slice(0,2);
        const file=hash.slice(2);

        const folderPath=path.join(process.cwd(), ".git", "objects", folder);
        const filePath=path.join(folderPath, file);

        fs.mkdirSync(folderPath, {recursive:true});
        fs.writeFileSync(filePath, zlib.deflateSync(blobStore));
     }
     return hash ;
}

function handleHashCommand(){
    const filePath= args[2];
    const flag=args[1];

    if(!filePath){
        throw new Error(`Error: No file specified.`);
    }

    if(! fs.existsSync(filePath)){
        throw new Error(
            "could not open file path"
        );
    }

    const readingContents=fs.readFileSync(filePath);

    const fileLength=readingContents.length;

    const blobHeader=`blob ${fileLength}\0` ;

    const blob= Buffer.concat([Buffer.from(blobHeader), readingContents]);

    const hash= crypto.createHash("sha1").update(blob).digest('hex');

    if(flag==="-w" ){
        const folder=hash.slice(0,2);
        const file=hash.slice(2);

        const completeFolderPath= path.join(".git", "objects", folder);

        if(!fs.existsSync(completeFolderPath)){
            fs.mkdirSync(completeFolderPath, {recursive:true});
        }

        const compressedData=zlib.deflateSync(blob);
        fs.writeFileSync(path.join(completeFolderPath, file), compressedData);
         
    }
    process.stdout.write(hash);

}

function handleTreeInspectCommand(){
    const flag=args[1];
    const commitSHA=args[2];

    if (!commitSHA) {
    throw new Error("Commit SHA is missing. Usage: ls-tree <commitSHA>");
    }
    const folder=commitSHA.slice(0,2);
    const file=commitSHA.slice(2);
    const folderPath=path.join(process.cwd(),".git","objects",folder);
    const filePath=path.join(folderPath,file);

    if(!fs.existsSync(folderPath))throw new Error(`Not a valid object name ${folderPath}`);
    if(!fs.existsSync(filePath))throw new Error(`Not a valid object name ${filePath}`);

    const fileContents=fs.readFileSync(filePath);
    // console.log(fileContents);

    const decompressed=zlib.inflateSync(fileContents);
    const output=decompressed.toString("utf8");

    const nullByteIdx=output.indexOf("\0");
    if(nullByteIdx===-1)throw new Error("Incorrect tree format");
    const content=output.slice(nullByteIdx+1);

    let result= "";
    let cursor= 0;

    while(cursor < content.length){
        const spaceIndex=content.indexOf(" ", cursor);
        if(spaceIndex === -1)break;

        const nullIndex=content.indexOf("\0",spaceIndex);
        if(nullIndex === -1)break;

        const fileName=content.slice(spaceIndex+1,nullIndex);
        result+=fileName + "\n";

        cursor = nullIndex + 21;
    }

    process.stdout.write(result)
}


function recursiveCreateTree(dir:string):string{
     let treeBuffer= Buffer.alloc(0);
     let entriesArr = [];
     let fileEntries = fs.readdirSync(dir,{withFileTypes:true})
     for(const entry of fileEntries){
        if(entry.name===".git")continue;

        let mode : string;
        let hash : string;

        const pathName = path.join(dir,entry.name);

        if(entry.isFile()){
            mode="100644";
            const fileContent = fs.readFileSync(pathName);
            hash = generateHash(fileContent, "blob", true);

        }
        else {
            mode="40000";
            hash= recursiveCreateTree(pathName);
        }

        entriesArr.push({
            mode:mode,
            hash : hash,
            name : entry.name
        })

    }

    entriesArr.sort((a, b) => a.name.localeCompare(b.name));


    for (const entry of entriesArr){
            const entryHash=Buffer.concat([Buffer.from(`${entry.mode} ${entry.name}\0`),
                Buffer.from(entry.hash, 'hex')
            ])
            treeBuffer=Buffer.concat([treeBuffer, entryHash]);
    }
    return generateHash(treeBuffer, "tree", true);
}

function handleWriteTreeCommand(){
     const basePath=process.cwd();
     const treeHash = recursiveCreateTree(basePath);
     process.stdout.write(treeHash);
}